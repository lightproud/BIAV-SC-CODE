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


def search(query: str, limit: int = 8, type_filter: str | None = None) -> dict:
    """Rank concepts against a free-text query using the inverted index.

    Deterministic scoring: +1 per query term hitting a concept's body postings,
    +2 extra if the term hits title/tags, +5 if the whole query is a title
    substring. Ties break by node degree (graph centrality) then id.
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
        {"id": nid, "rel": rel,
         "title": idx["concepts"].get(nid, {}).get("title", nid),
         "type": idx["concepts"].get(nid, {}).get("type")}
        for nid, rel in adj
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
        _summary(nid, concepts.get(nid, {}), {"rel": rel})
        for nid, rel in adj[:limit]
    ]
    return {
        "id": cid,
        "title": concepts.get(cid, {}).get("title"),
        "total_neighbors": len(idx.get("neighbors", {}).get(cid, [])),
        "returned": len(items),
        "rel_filter": rel_filter,
        "neighbors": items,
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
            "kb_overview": "本总览（分区 / 类型 / 两层结构）",
        },
    }
