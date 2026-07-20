"""kb_navigator.py — 银芯知识库运行时导航（KB navigation, import-only 库）。

消费 ``okf/kb_index.json``（由 ``scripts/build_kb_index.py`` 生成），提供艾瑞卡在
运行时唯一动态平面（MCP）上**动态导航**知识库的四个原语：

  - ``search``    ：按词检索 concept（倒排表打分，词典法零 ML）—— 「你问，它带你到对的书架」。
  - ``get``       ：取单个 concept 的全档（元数据 + 正文 + resource 指针 + 邻居）。
  - ``neighbors`` ：顺 OKF 关系图遍历某 concept 的邻居 —— 「从这本书走到相关的书」。
  - ``overview``  ：知识库总览（分区 / 类型 / 入口索引）—— LLMwiki 的「楼层平面图」。

放指针不放本体：本模块**不返回本体数据**，只返回 concept 元信息 + ``resource``
指针；艾瑞卡拿到指针后再按需 fetch 仓内权威源。红线：纯查表 + 算术，确定性、
零 ML、零常驻。本模块**无 __main__**（import-only 部件，非独立组件），由
``scripts/mcp_server.py`` 注册为 MCP 工具后端；CLI 自测走 ``build_kb_index.py``。
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "okf"
INDEX_PATH = BUNDLE / "kb_index.json"

RESERVED = {"index.md", "log.md"}
_BODY_RE = re.compile(r"^---\n.*?\n---\n", re.DOTALL)


class KBIndexMissing(FileNotFoundError):
    """Raised when the navigation index has not been built yet."""


@lru_cache(maxsize=1)
def load_index() -> dict:
    if not INDEX_PATH.exists():
        raise KBIndexMissing(
            "okf/kb_index.json 未生成 — 先运行 scripts/build_kb_index.py"
            "（或 scripts/build_okf_bundle.py）。"
        )
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def _summary(cid: str, concept: dict, extra: dict | None = None) -> dict:
    out = {
        "id": cid,
        "type": concept.get("type"),
        "title": concept.get("title"),
        "description": concept.get("description"),
        "resource": concept.get("resource"),
        "tags": concept.get("tags", []),
        "tier": concept.get("tier"),  # skeleton（可遍历）vs search（参考层）
        "degree": concept.get("degree", 0),
    }
    if extra:
        out.update(extra)
    return out


def normalize_id(raw: str) -> str | None:
    """Resolve a loose reference to a concept id present in the index.

    Accepts the canonical ``/characters/125346.md`` as well as looser forms:
    ``characters/125346.md`` / ``/characters/125346`` / ``125346`` / ``125346.md``
    / a bare title. Returns the canonical id or ``None`` if unresolved.
    """
    if not raw:
        return None
    idx = load_index()
    concepts = idx["concepts"]
    raw = raw.strip()

    # 1) direct / near-direct forms
    candidates = [raw, "/" + raw.lstrip("/")]
    for c in candidates:
        if c in concepts:
            return c
        if c + ".md" in concepts:
            return c + ".md"

    # 2) bare stem or filename → match any id ending in it
    stem = raw.lstrip("/")
    if not stem.endswith(".md"):
        stem_md = stem + ".md"
    else:
        stem_md = stem
    hits = [cid for cid in concepts if cid.endswith("/" + stem_md)]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        return sorted(hits)[0]

    # 3) exact title match (unique)
    title_hits = [cid for cid, c in concepts.items() if c.get("title") == raw]
    if title_hits:
        return sorted(title_hits)[0]
    return None


def _title_anchors(query: str) -> dict[str, str]:
    """概念标题逐字出现在查询里 → 锚概念（{cid: title}）。

    kb_anchor「先锚后扩」哲学的库内形态：查询点名了谁，谁就是锚。两条纪律：
    - **最长匹配优先**：短标题若只作为更长已锚标题的内部子串出现，不独立成锚
      （「本源萝坦」点名的是本源萝坦，不是「萝坦」——实体链接经典规则）；
    - 单字标题仅认 CJK（如角色「徐」——分词器丢单字、倒排表够不到，标题锚是其唯一入口），
      拉丁单字母不作锚（噪声）。确定性纯查表。
    """
    out: dict[str, str] = {}
    if not query:
        return out
    idx = load_index()
    cands: list[tuple[str, str]] = []
    for cid, c in idx["concepts"].items():
        t = (c.get("title") or "").strip()
        if not t or len(t) > len(query):
            continue
        if len(t) == 1 and not ("一" <= t <= "鿿"):
            continue
        if t in query:
            cands.append((t, cid))
    claimed = [False] * len(query)
    for t, cid in sorted(cands, key=lambda x: (-len(x[0]), x[1])):
        anchored = False
        start = query.find(t)
        while start >= 0:
            if not all(claimed[start:start + len(t)]):
                anchored = True
                for j in range(start, start + len(t)):
                    claimed[j] = True
            start = query.find(t, start + 1)
        if anchored:
            out[cid] = t
    return out


def search(query: str, limit: int = 8, type_filter: str | None = None) -> dict:
    """Rank concepts against a free-text query using the inverted index.

    Deterministic scoring: +1 per query term hitting a concept's body postings,
    +2 extra if the term hits title/tags, +5 if the whole query is a title
    substring, +4 if a concept title appears verbatim inside the query
    (title anchor — the only path to single-CJK-char titles the tokenizer
    drops, e.g. 角色「徐」). Ties break by node degree then id.
    """
    idx = load_index()
    concepts = idx["concepts"]
    postings = idx["postings"]
    tpost = idx["title_postings"]

    from silver_tokenizer import tokenize

    terms = list(dict.fromkeys(tokenize(query)))  # dedupe, keep order
    scores: dict[str, float] = {}
    matched: dict[str, set] = {}
    for t in terms:
        for cid in postings.get(t, ()):
            scores[cid] = scores.get(cid, 0.0) + 1.0
            matched.setdefault(cid, set()).add(t)
        for cid in tpost.get(t, ()):
            scores[cid] = scores.get(cid, 0.0) + 2.0
            matched.setdefault(cid, set()).add(t)

    ql = query.strip().lower()
    if ql:
        for cid, c in concepts.items():
            if ql in (c.get("title") or "").lower():
                scores[cid] = scores.get(cid, 0.0) + 5.0
    for cid, t in _title_anchors(query).items():
        scores[cid] = scores.get(cid, 0.0) + 4.0
        matched.setdefault(cid, set()).add(t)

    ranked = []
    for cid, sc in scores.items():
        c = concepts[cid]
        if type_filter and c.get("type") != type_filter:
            continue
        ranked.append((sc, c.get("degree", 0), cid))
    ranked.sort(key=lambda r: (-r[0], -r[1], r[2]))

    limit = max(1, min(int(limit or 8), 50))
    results = [
        _summary(cid, concepts[cid],
                 {"score": round(sc, 2), "matched_terms": sorted(matched.get(cid, []))})
        for sc, _deg, cid in ranked[:limit]
    ]
    return {
        "query": query,
        "tokens": terms,
        "type_filter": type_filter,
        "total_matches": len(ranked),
        "returned": len(results),
        "results": results,
    }


def get(concept_id: str) -> dict:
    """Return a concept's full record: metadata + body markdown + neighbors."""
    idx = load_index()
    cid = normalize_id(concept_id)
    if cid is None:
        return {"error": f"未找到 concept: {concept_id}",
                "hint": "用 kb_search 先检索，或传规范 id 如 /characters/125346.md"}
    concept = idx["concepts"][cid]

    body = ""
    fpath = BUNDLE / cid.lstrip("/")
    if fpath.exists():
        body = _BODY_RE.sub("", fpath.read_text(encoding="utf-8"), count=1).strip()

    adj = idx.get("neighbors", {}).get(cid, [])
    neigh = [
        {"id": pair[0], "rel": pair[1],
         "rel_type": pair[2] if len(pair) > 2 else "link",
         "title": idx["concepts"].get(pair[0], {}).get("title", pair[0]),
         "type": idx["concepts"].get(pair[0], {}).get("type")}
        for pair in adj
    ]
    out = _summary(cid, concept)
    out["body"] = body
    out["neighbors"] = neigh
    out["neighbor_count"] = len(neigh)
    return out


def neighbors(concept_id: str, limit: int = 20, rel_filter: str | None = None) -> dict:
    """Traverse the OKF relation graph from a concept to its adjacent concepts."""
    idx = load_index()
    cid = normalize_id(concept_id)
    if cid is None:
        return {"error": f"未找到 concept: {concept_id}"}
    adj = idx.get("neighbors", {}).get(cid, [])
    if rel_filter:
        adj = [pair for pair in adj if pair[1] == rel_filter]
    limit = max(1, min(int(limit or 20), 200))
    concepts = idx["concepts"]
    items = [
        _summary(pair[0], concepts.get(pair[0], {}),
                 {"rel": pair[1], "rel_type": pair[2] if len(pair) > 2 else "link"})
        for pair in adj[:limit]
    ]
    return {
        "id": cid,
        "title": concepts.get(cid, {}).get("title"),
        "total_neighbors": len(idx.get("neighbors", {}).get(cid, [])),
        "returned": len(items),
        "rel_filter": rel_filter,
        "neighbors": items,
    }


# ---------------------------------------------------------------------------
# 扩散激活检索（Pillar D）—— 符号底座上的神经式动态（北极星 §五）
# 「概念网络 ≠ 搜索」的杀手级消费：从种子概念沿带类型的边多跳扩散、带衰减，
# 返回被点亮的子图 = 联想召回（平铺搜索与单跳查都给不了的第三种检索原语）。
# 剪枝即加权：高信号边类型传导更多激活，低信号（cv）几近不传。
# ---------------------------------------------------------------------------

# 每条边类型的传导权重（信号越高传得越远；对齐北极星「为信号剪枝」）
_EDGE_WEIGHT = {
    "variant": 1.0,   # 本体↔异变，最高信号
    "lore": 0.9,      # 同篇 lore 共现
    "cross": 0.7,     # 跨层结构（同平台/聚合/入口）
    "mention": 0.6,   # 策展正文点名（提及边，白盒联想）
    "link": 0.5,      # 显式 markdown 链接
    "cv": 0.15,       # 同声优，弱信号（已降权，近乎不传）
}


_ANCHOR_ENERGY = 1.5   # 标题锚种子能量（查询逐字点名的概念应主导扩散——先锚后扩）
_LABEL_BOOST = 1.5     # 边标签命中查询词 → 传导加成（顺「所问之物」的边扩散更强）


def activate(seed: str, hops: int = 2, decay: float = 0.5, limit: int = 15) -> dict:
    """扩散激活：从种子（概念 id 或检索词）沿骨架多跳带衰减扩散，返回被点亮子图。

    种子解析：先当概念 id（normalize_id）；不中则当检索词，取 search 前若干命中为种子
    （按检索分归一化为初始激活），且**标题锚**（查询逐字点名的概念）种子能量升至
    _ANCHOR_ENERGY——先锚后扩。传导：每跳激活 = 上游激活 × decay × 边类型权重；检索词
    模式下边标签命中查询原文再乘 _LABEL_BOOST（顺所问之边传导更强）。**累加取最强路径
    （max）而非求和**——和值会让多路径再汇聚的高度数枢纽（如被众文档共同提及的热门角色）
    淹没一跳直达目标（2026-07-11 修正枢纽淹没）。排名并列时低度数优先（越专属的关联越靠前，
    与 max 同一反枢纽哲学）。确定性、零 ML：纯查表 + 算术。骨架层最有效；search-tier
    概念多为孤立、需经检索作种子进入。

    Args:
        seed: 概念 id（如 /characters/125346.md 或 125346）或检索词（如 "沙耶" / "discord 社区"）
        hops: 扩散跳数（默认 2，封顶 4）
        decay: 每跳衰减（默认 0.5，(0,1]）
        limit: 返回被点亮概念上限（默认 15，封顶 50）

    Returns:
        JSON: {seed, resolved_seeds, hops, decay, activated:[{id,title,type,tier,activation,via}...]}
    """
    idx = load_index()
    concepts = idx["concepts"]
    neighbors = idx.get("neighbors", {})
    hops = max(1, min(int(hops or 2), 4))
    decay = decay if (isinstance(decay, (int, float)) and 0 < decay <= 1) else 0.5
    limit = max(1, min(int(limit or 15), 50))

    # --- 种子解析 ---
    seeds: dict[str, float] = {}
    cid = normalize_id(seed)
    if cid is not None:
        seeds[cid] = 1.0
        seed_kind = "concept"
    else:
        res = search(seed, limit=5)
        hits = res.get("results", [])
        if not hits:
            return {"seed": seed, "resolved_seeds": [], "activated": [],
                    "note": "种子无法解析为概念、检索也零命中"}
        top = hits[0]["score"] or 1.0
        for h in hits:
            seeds[h["id"]] = max(0.2, (h["score"] or 0) / top)  # 归一化初始激活
        for aid in _title_anchors(seed):
            seeds[aid] = _ANCHOR_ENERGY  # 标题锚主导扩散（先锚后扩）
        seed_kind = "query"

    # --- 逐跳扩散（最强路径取 max，记录首达关系）---
    activation = dict(seeds)
    via: dict[str, str] = {}
    frontier = dict(seeds)
    for _h in range(hops):
        nxt: dict[str, float] = {}
        for node, act in frontier.items():
            for pair in neighbors.get(node, []):
                nid = pair[0]
                rel = pair[1] or ""
                rel_type = pair[2] if len(pair) > 2 else "link"
                w = _EDGE_WEIGHT.get(rel_type, 0.4)
                if seed_kind == "query" and rel:
                    label = rel.split(":", 1)[-1].strip()
                    if len(label) >= 2 and label in seed:
                        w *= _LABEL_BOOST  # 边标签命中查询原文：顺所问之边传导更强
                contrib = act * decay * w
                if contrib <= 0.01:
                    continue
                if contrib > nxt.get(nid, 0.0):
                    nxt[nid] = contrib
                via.setdefault(nid, f"{pair[1]} ({rel_type})")
        for nid, add in nxt.items():
            if add > activation.get(nid, 0.0):
                activation[nid] = add
        frontier = nxt
        if not frontier:
            break

    # --- 排名（种子外，激活降序；并列时低度数优先=专属关联，末位 tie-break by id）---
    ranked = sorted(
        ((nid, sc) for nid, sc in activation.items() if nid not in seeds),
        key=lambda kv: (-kv[1], len(neighbors.get(kv[0], [])), kv[0]),
    )[:limit]
    activated = [
        _summary(nid, concepts.get(nid, {}),
                 {"activation": round(sc, 3), "via": via.get(nid, "")})
        for nid, sc in ranked
    ]
    return {
        "seed": seed,
        "seed_kind": seed_kind,
        "resolved_seeds": sorted(seeds),
        "hops": hops,
        "decay": decay,
        "returned": len(activated),
        "activated": activated,
    }


def overview() -> dict:
    """The knowledge-base floor plan: sections, type breakdown, entry indexes."""
    idx = load_index()
    return {
        "generated": idx.get("generated"),
        "meta": idx.get("meta", {}),
        "stats": idx.get("stats", {}),
        "sections": idx.get("sections", {}),
        "tiers": {
            "skeleton": "可遍历骨架层（characters/sources/community/news-output）——有真高信号边，扩散激活/kb_neighbors 在此展开",
            "search": "参考层（memory/assets/wiki-data/story/extracted/resource/projects/unpacked）——靠 kb_search 命中即可达，不强连边（避噪声星）；孤立是有意 search-tier",
        },
        "usage": {
            "kb_search": "按词检索概念（返回排序摘要 + resource 指针，含 tier）",
            "kb_get": "取单个概念全档（元数据 + 正文 + 邻居 + tier）",
            "kb_neighbors": "顺关系图遍历某概念的邻居（骨架层最有效）",
            "kb_activate": "扩散激活联想召回（从种子沿关系图多跳带衰减）",
            "kb_overview": "本总览（分区 / 类型 / 两层结构 / 模式路由）",
        },
        "routing": {
            "note": "检索模式匹配问题类型（A/B 实测：KB 只在联想维度胜 grep，关键词维度打平）——别对关系题用关键词搜索，那等于退化成 grep、白瞎了 KB。",
            "identity_or_keyword": "身份/关键词查（『X 是谁』『含某词』）→ kb_search / kb_get（此维度 grep 就够，用不用 KB 一样）",
            "relational_or_design": "关系/探索/设计题（『X 与什么相关』『围绕 Y 探索』『顺这条线还连着什么』『谁跟这个共现』）→ **直接用 kb_activate / kb_neighbors**——KB 独占、grep 结构上到不了的联想维度",
        },
    }
