#!/usr/bin/env python3
"""build_kb_index.py — 银芯知识库运行时导航索引（KB navigation index）生成器。

守密人 2026-07-04 裁定：把静态 OKF bundle 升级为「艾瑞卡运行时可动态导航的
知识库」。本脚本是那层的**底座生产者**——扫描 ``okf/`` bundle（concept 前置
元数据 + 正文 + ``graph.json`` 关系边），产出一份自包含的静态索引
``okf/kb_index.json``，供运行时唯一动态平面（MCP，见 ``scripts/kb_navigator.py``）
按需检索 / 取概念 / 遍历邻居。

思想溯源：
  - **OKF**（Open Knowledge Format）：知识 = 一目录带 frontmatter 的 concept；
    本索引不复刻本体，只索引 concept 的元数据 + 正文，``resource`` 指针照旧指向
    仓内权威源（放指针不放本体）。
  - **LLMwiki**（LLM 可动态导航的知识库）：wiki 结构化到 LLM 能顺关系图逐跳导航、
    按需取概念，而非一次性灌全文。本索引给出倒排表 + 邻接表两把「导航钥匙」。

红线：纯词典分词（复用 ``silver_tokenizer``）+ 算术打分，**确定性、零 ML、零常驻**。
与 ``build_community_index`` / ``build_story_index`` 同一「词典法」家族。

生成物，重跑覆盖。``python3 scripts/build_okf_bundle.py`` 末尾自动调用本模块，
故 bundle 一次构建即含导航索引；亦可 ``python3 scripts/build_kb_index.py`` 单独
就已存在的 ``okf/`` 重建。
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "okf"
INDEX_PATH = BUNDLE / "kb_index.json"

RESERVED = {"index.md", "log.md"}
_FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
# strip a leading frontmatter block to leave the searchable body
_BODY_RE = re.compile(r"^---\n.*?\n---\n", re.DOTALL)
# lightweight markdown noise removal so tokenizer sees words, not syntax
_MD_NOISE = re.compile(r"[#>|*`_\[\]()]+")


def _tokenize(text: str) -> list[str]:
    """Deterministic dictionary tokenizer (shared with the other static indexes)."""
    from silver_tokenizer import tokenize  # scripts/ is on sys.path when run/imported

    return tokenize(text)


def _read_frontmatter(text: str) -> dict:
    """Minimal flat-YAML frontmatter parser (same shape as build_okf_bundle)."""
    m = _FM_RE.match(text)
    fields: dict = {}
    if not m:
        return fields
    for line in m.group(1).splitlines():
        if not line.strip() or line.startswith(" ") or ":" not in line:
            continue
        key, _, val = line.partition(":")
        key, val = key.strip(), val.strip()
        if val.startswith("[") and val.endswith("]"):
            fields[key] = [v.strip().strip('"') for v in val[1:-1].split(",") if v.strip()]
        else:
            fields[key] = val.strip('"')
    return fields


def _body_of(text: str) -> str:
    return _MD_NOISE.sub(" ", _BODY_RE.sub("", text, count=1))


def _section_of(concept_id: str) -> str:
    """'/characters/125346.md' -> 'characters'; '/README.md' -> '' (bundle root)."""
    parts = concept_id.strip("/").split("/")
    return parts[0] if len(parts) > 1 else ""


def _load_graph() -> list[dict]:
    """Reuse the visualizer graph edges (produced by build_okf_bundle) if present."""
    gp = BUNDLE / "graph.json"
    if not gp.exists():
        return []
    try:
        return json.loads(gp.read_text(encoding="utf-8")).get("edges", [])
    except (json.JSONDecodeError, OSError):
        return []


def build_kb_index() -> dict:
    """Scan ``okf/`` into a runtime navigation index and write ``okf/kb_index.json``.

    Returns the in-memory index dict (also written to disk).
    """
    if not BUNDLE.is_dir():
        raise FileNotFoundError(
            f"OKF bundle missing at {BUNDLE} — run scripts/build_okf_bundle.py first"
        )

    concepts: dict[str, dict] = {}
    # inverted indexes: term -> sorted list of concept ids
    postings: dict[str, set[str]] = defaultdict(set)       # title + desc + tags + body
    title_postings: dict[str, set[str]] = defaultdict(set)  # title + tags only (boost)
    by_type: dict[str, list[str]] = defaultdict(list)
    sections: dict[str, dict] = {}

    for f in sorted(BUNDLE.rglob("*.md")):
        if f.name in RESERVED:
            continue
        cid = "/" + str(f.relative_to(BUNDLE))
        text = f.read_text(encoding="utf-8")
        fm = _read_frontmatter(text)
        title = fm.get("title", f.stem)
        desc = fm.get("description", "")
        tags = fm.get("tags", []) if isinstance(fm.get("tags"), list) else []
        ctype = fm.get("type", "unknown")
        section = _section_of(cid)

        concepts[cid] = {
            "type": ctype,
            "title": title,
            "description": desc,
            "resource": fm.get("resource", ""),
            "tags": tags,
            "section": section,
            "degree": 0,  # filled after edges
        }
        by_type[ctype].append(cid)

        # postings: title + description + tags + body
        title_tag_text = " ".join([title] + tags)
        for tok in set(_tokenize(title_tag_text)):
            title_postings[tok].add(cid)
            postings[tok].add(cid)
        for tok in set(_tokenize(desc + " " + _body_of(text))):
            postings[tok].add(cid)

    # ---- adjacency from the OKF graph edges (undirected, keep relation label) ----
    neighbors: dict[str, list[list[str]]] = defaultdict(list)
    seen_pairs: set[tuple[str, str, str]] = set()
    edges = _load_graph()
    for e in edges:
        s, t, rel = e.get("source"), e.get("target"), e.get("rel", "link")
        if s not in concepts or t not in concepts or s == t:
            continue
        for a, b in ((s, t), (t, s)):
            key = (a, b, rel)
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            neighbors[a].append([b, rel])
    for cid, adj in neighbors.items():
        concepts[cid]["degree"] = len(adj)

    # ---- section index entry points (LLMwiki floor-plan) ----
    for cid in concepts:
        sec = concepts[cid]["section"]
        if sec:
            entry = sections.setdefault(
                sec, {"index": f"/{sec}/index.md", "count": 0}
            )
            entry["count"] += 1

    index = {
        "generated": date.today().isoformat(),
        "meta": {
            "data_layer": "curated_knowledge",
            "source": "okf/ bundle (concept frontmatter + body + graph edges)",
            "note": "运行时导航索引；放指针不放本体，本体经 concept.resource 指向仓内权威源。",
            "tokenizer": "silver_tokenizer FMM（领域词典，零 ML）",
        },
        "stats": {
            "concepts": len(concepts),
            "edges": len(edges),
            "terms": len(postings),
            "by_type": {k: len(v) for k, v in sorted(by_type.items())},
            "sections": {k: v["count"] for k, v in sorted(sections.items())},
        },
        "sections": dict(sorted(sections.items())),
        "concepts": dict(sorted(concepts.items())),
        "neighbors": {k: neighbors[k] for k in sorted(neighbors)},
        "by_type": {k: sorted(v) for k, v in sorted(by_type.items())},
        "postings": {k: sorted(v) for k, v in sorted(postings.items())},
        "title_postings": {k: sorted(v) for k, v in sorted(title_postings.items())},
    }
    INDEX_PATH.write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return index


def main() -> None:
    idx = build_kb_index()
    s = idx["stats"]
    print(f"KB navigation index built at {INDEX_PATH.relative_to(REPO)}")
    print(f"  concepts: {s['concepts']}")
    print(f"  edges:    {s['edges']}")
    print(f"  terms:    {s['terms']} (inverted index)")
    print(f"  by_type:  {s['by_type']}")
    print(f"  sections: {s['sections']}")


if __name__ == "__main__":
    main()
