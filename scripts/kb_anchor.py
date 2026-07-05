"""kb_anchor.py — 先锚后扩合流（§八 8.3「厚锚撑向量」检索侧合流，import-only 库）。

守密人 2026-07-05 chunk3：把三条腿合成一次调用——
  1. **先锚**（脊柱）：``kb_navigator.search`` 锚定概念（身份 / 边界），角色锚附带
     厚锚侧表别名（``silver_aliases``）；
  2. **别名扩词**：已确认别名进扩词集（「冰系奶妈大招被削」类不含本名的散句因
     脊柱审定的别名可被捞进候选）；未确认别名只随锚返回、标记供 LLM 掂量，不进扩词；
  3. **后扩**（向量）：``kb_vector.search`` 在锚周边捞长尾正文 + **据锚去杂**——
     tail 命中若含锚词 / 别名则标 ``anchored: true`` 并排前，未命中锚词的**降序不删**
     （最终判「其实在讲别的实体」的是 LLM 总指挥，本模块不擅自丢召回）。

降级契约（对抗 critique 致命洞的防护，必须函数内）：**扩腿 embed / 向量检索的任何
异常（含 ImportError / 无 VOYAGE_API_KEY / 索引缺失）都在本函数内吞掉**，锚 + 别名
照常返回——「有真 voyage 索引 + 运行时无 key」场景绝不能把脊柱托底一起带崩
（只在 MCP 边界降级不够：合流调用方在 MCP 之内）。脊柱索引缺失同理优雅降级。

消费失败喂料（§8.4）：零锚查询 best-effort 写入 gitignored
``Public-Info-Pool/Rough/alias_gaps.jsonl``（``extract_aliases.feed_gap``），
成为别名 AI 自动识别的下一轮候选——人零维护闭环的进料口。

本模块**无 __main__**（import-only 部件），由 ``scripts/mcp_server.py`` 注册为
MCP 工具 ``kb_anchor``。
"""
from __future__ import annotations

import re

_CHAR_PREFIX = "/characters/"


def _anchor_hits(query: str, anchor_limit: int) -> tuple[list[dict], str | None]:
    """脊柱锚定。索引缺失 / 任何异常 → 空锚 + 原因，不抛穿。"""
    try:
        from kb_navigator import search as _kb_search

        res = _kb_search(query, limit=anchor_limit)
        return list(res.get("results", [])), None
    except Exception as e:
        return [], f"{type(e).__name__}: {e}"


def _feed_gap(query: str) -> None:
    """零锚 → 喂别名候选（best-effort，绝不抛）。"""
    try:
        from extract_aliases import feed_gap

        feed_gap(query)
    except Exception:
        pass


def anchor_expand(query: str, anchor_limit: int = 3, tail_limit: int = 8,
                  path: str | None = None, backend: str | None = None) -> dict:
    """先锚后扩：脊柱锚定 → 别名扩词 → 向量捞长尾 + 据锚去杂。

    返回形状：
      {query, anchors:[{id,title,type,resource,score,aliases:[{alias,confirmed}]}],
       expansion_terms:[...], spine_degraded, spine_reason?,
       tail:{backend?, degraded, results:[{..., anchored, anchor_matched}]}}

    任何一条腿垮掉都只降级自己：脊柱缺索引 → anchors=[] 照走向量；向量缺
    索引 / 缺 key / 缺包 → tail.degraded=true，锚 + 别名原样返回。
    """
    anchor_limit = max(1, min(int(anchor_limit or 3), 10))
    tail_limit = max(1, min(int(tail_limit or 8), 50))

    # ---- 1) 先锚（脊柱，白盒托底）----
    hits, spine_reason = _anchor_hits(query, anchor_limit)
    anchors: list[dict] = []
    expansion_terms: list[str] = []
    for h in hits:
        cid = h.get("id") or ""
        anchor = {
            "id": cid,
            "type": h.get("type"),
            "title": h.get("title"),
            "resource": h.get("resource"),
            "score": h.get("score"),
            "aliases": [],
        }
        title = (h.get("title") or "").strip()
        if title:
            expansion_terms.append(title)
        if cid.startswith(_CHAR_PREFIX) and cid.endswith(".md"):
            char_id = cid[len(_CHAR_PREFIX):-3]
            try:
                from silver_aliases import aliases_for

                rows = aliases_for(char_id, include_unconfirmed=True)
            except Exception:
                rows = []
            anchor["aliases"] = rows
            # 只有已确认别名进扩词集（未确认压权重：随锚返回但不扩）
            expansion_terms += [r["alias"] for r in rows if r.get("confirmed")]
        anchors.append(anchor)
    expansion_terms = list(dict.fromkeys(t for t in expansion_terms if t))

    if not anchors:
        _feed_gap(query)  # §8.4 锚不到 → 自动喂别名候选

    # ---- 2) 后扩（向量长尾）——函数内吞全异常，锚 + 别名照常返回 ----
    expanded_query = " ".join([query] + expansion_terms)
    try:
        import kb_vector

        tail = kb_vector.search(expanded_query, limit=tail_limit,
                                path=path, backend=backend)
    except Exception as e:  # 扩腿任何形态的垮（导入 / key / 索引 / 网络）都不许穿透
        tail = {
            "degraded": True,
            "reason": f"向量扩腿不可用：{type(e).__name__}: {e}",
            "fallback": "锚 + 别名仍有效；长尾改用 kb_search / ripgrep 白盒回退",
            "results": [],
        }

    # ---- 3) 据锚去杂：命中锚词 / 别名的 tail 排前并标记；未命中降序不删 ----
    if expansion_terms and tail.get("results"):
        matchers = []
        for t in expansion_terms:
            if re.fullmatch(r"[A-Za-z0-9 .'\-]+", t):
                matchers.append((t, re.compile(
                    rf"(?<![A-Za-z0-9]){re.escape(t)}(?![A-Za-z0-9])", re.IGNORECASE)))
            else:
                matchers.append((t, None))
        annotated = []
        for r in tail["results"]:
            blob = f"{r.get('preview') or ''} {r.get('source') or ''}"
            matched = [t for t, pat in matchers
                       if (pat.search(blob) if pat else t in blob)]
            r = dict(r)
            r["anchored"] = bool(matched)
            r["anchor_matched"] = matched
            annotated.append(r)
        # 稳定排序：anchored 在前，组内保持向量分序
        tail = dict(tail)
        tail["results"] = ([r for r in annotated if r["anchored"]]
                           + [r for r in annotated if not r["anchored"]])

    out = {
        "query": query,
        "anchors": anchors,
        "expansion_terms": expansion_terms,
        "spine_degraded": not hits and spine_reason is not None,
        "tail": tail,
    }
    if spine_reason:
        out["spine_reason"] = spine_reason
    return out
