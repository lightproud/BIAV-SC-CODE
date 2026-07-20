"""Tests for the runtime knowledge-base navigation layer.

Covers two halves of the 2026-07-04 dynamic-orchestration feature:
1. Producer (`scripts/build_kb_index.py`) — the static index `okf/kb_index.json`
   is well-formed and internally consistent with the OKF bundle it indexes.
2. Navigator (`scripts/kb_navigator.py`) + MCP wrappers — the four runtime
   primitives (search / get / neighbors / overview) behave and the MCP tools
   are wired and return well-formed JSON.

Zero-ML discipline: search is deterministic dictionary scoring, so a known
title must rank its own concept first.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"
BUNDLE = REPO / "okf"
INDEX_PATH = BUNDLE / "kb_index.json"
sys.path.insert(0, str(SCRIPTS))


# ---------------------------------------------------------------------------
# Producer: okf/kb_index.json shape + integrity
# ---------------------------------------------------------------------------

def _index() -> dict:
    assert INDEX_PATH.exists(), (
        "okf/kb_index.json missing — run scripts/build_kb_index.py "
        "(or scripts/build_okf_bundle.py)"
    )
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def test_index_exists_and_has_concepts():
    idx = _index()
    assert idx["concepts"], "index has no concepts"
    assert idx["postings"], "index has no postings (inverted index empty)"
    assert idx["stats"]["concepts"] == len(idx["concepts"])
    assert idx["stats"]["terms"] == len(idx["postings"])


def test_meta_marks_curated_layer():
    """Data-discipline: the KB layer is curated knowledge, labelled as such."""
    assert _index()["meta"]["data_layer"] == "curated_knowledge"


def test_every_concept_id_maps_to_an_okf_file():
    idx = _index()
    for cid in idx["concepts"]:
        assert (BUNDLE / cid.lstrip("/")).exists(), f"concept id dangles: {cid}"


def test_neighbor_ids_are_known_concepts():
    idx = _index()
    ids = set(idx["concepts"])
    for cid, adj in idx["neighbors"].items():
        assert cid in ids, f"neighbor host {cid} not a concept"
        for pair in adj:  # [nid, rel, rel_type]
            assert pair[0] in ids, f"neighbor {pair[0]} of {cid} not a concept"


def test_postings_reference_known_concepts():
    idx = _index()
    ids = set(idx["concepts"])
    for term, plist in idx["postings"].items():
        for cid in plist:
            assert cid in ids, f"posting term {term!r} -> unknown concept {cid}"


def test_by_type_partitions_concepts():
    idx = _index()
    flat = [cid for group in idx["by_type"].values() for cid in group]
    assert sorted(flat) == sorted(idx["concepts"]), "by_type is not a partition of concepts"


def test_degree_matches_adjacency():
    idx = _index()
    for cid, c in idx["concepts"].items():
        assert c["degree"] == len(idx["neighbors"].get(cid, [])), (
            f"degree mismatch for {cid}"
        )


# ---------------------------------------------------------------------------
# Navigator: runtime primitives
# ---------------------------------------------------------------------------

def test_search_ranks_exact_title_first():
    import kb_navigator as kb

    res = kb.search("徐", limit=5)
    assert res["results"], "search returned nothing for a known title"
    top = res["results"][0]
    assert top["title"] == "徐" and top["type"] == "character"
    assert top["resource"], "result should carry a resource pointer (放指针不放本体)"


def test_search_type_filter():
    import kb_navigator as kb

    res = kb.search("lore 剧情", limit=10, type_filter="dataset")
    assert res["results"], "type-filtered search returned nothing"
    assert all(r["type"] == "dataset" for r in res["results"])


def test_get_returns_body_and_neighbors_via_loose_id():
    import kb_navigator as kb

    g = kb.get("125346")  # loose bare id
    assert g["id"] == "/characters/125346.md"
    assert g["title"] == "徐"
    assert g["body"], "get should return concept body markdown"
    assert isinstance(g["neighbors"], list)
    assert g["neighbor_count"] == len(g["neighbors"])


def test_get_unknown_returns_error_not_crash():
    import kb_navigator as kb

    assert "error" in kb.get("does-not-exist-xyz")


def test_neighbors_traversal():
    import kb_navigator as kb

    n = kb.neighbors("/characters/125346.md", limit=5)
    assert "neighbors" in n
    assert n["returned"] <= 5


def test_overview_reports_sections_and_tiers():
    import kb_navigator as kb

    ov = kb.overview()
    assert "characters" in ov["sections"]
    assert ov["stats"]["concepts"] >= 70
    assert set(ov["tiers"]) == {"skeleton", "search"}
    assert ov["stats"]["by_tier"]["skeleton"] >= 1


# --- 扩散激活（Pillar D）-----------------------------------------------------

def test_activate_from_concept_spreads_over_skeleton():
    """从骨架概念种子扩散，返回跨层联想邻域（同平台/抽样自/聚合于），且带激活分。"""
    import kb_navigator as kb

    r = kb.activate("discord", hops=2, limit=8)
    assert r["resolved_seeds"], "种子未解析"
    ids = {a["id"] for a in r["activated"]}
    # discord 应联想点亮其全量档案镜头（community）与输出抽样（news-output）——搜索连不到的跨层结构
    assert any("/community/community-discord" in i for i in ids)
    assert all(a["activation"] > 0 for a in r["activated"])


def test_activate_ranks_high_signal_edges_above_low():
    """高信号边（cross/variant）传导的激活应高于低信号（cv）——剪枝即加权。"""
    import kb_navigator as kb

    r = kb.activate("discord", hops=1, limit=10)
    acts = {a["id"]: a["activation"] for a in r["activated"]}
    # 同平台（cross,0.7*0.5=0.35）应明显高于任何 cv 边（0.15*0.5=0.075）
    cross_hit = max((v for i, v in acts.items() if "community-discord" in i), default=0)
    assert cross_hit >= 0.3, f"跨层高信号边激活偏低：{cross_hit}"


def test_activate_query_seed_and_determinism():
    """检索词种子可用；连算两次逐字节相同（确定性零 ML）。"""
    import json

    import kb_navigator as kb

    r = kb.activate("沙耶", hops=2, limit=5)
    assert r["seed_kind"] in ("concept", "query")
    a = json.dumps(kb.activate("discord"), ensure_ascii=False)
    b = json.dumps(kb.activate("discord"), ensure_ascii=False)
    assert a == b


def test_activate_unknown_seed_graceful():
    import kb_navigator as kb

    r = kb.activate("zzz-nonexistent-xyz-000")
    assert r["activated"] == []


# ---------------------------------------------------------------------------
# MCP wrappers: the four kb_* tools are wired and return valid JSON
# ---------------------------------------------------------------------------

def _install_mcp_stub():
    if "mcp.server.fastmcp" in sys.modules:
        return

    class _FastMCP:
        def __init__(self, *_a, **_k):
            pass

        def tool(self, *_a, **_k):
            def _decorator(fn):
                return fn
            return _decorator

        def run(self, *_a, **_k):
            pass

    mcp_pkg = types.ModuleType("mcp")
    server_pkg = types.ModuleType("mcp.server")
    fastmcp_pkg = types.ModuleType("mcp.server.fastmcp")
    fastmcp_pkg.FastMCP = _FastMCP
    server_pkg.fastmcp = fastmcp_pkg
    mcp_pkg.server = server_pkg
    sys.modules["mcp"] = mcp_pkg
    sys.modules["mcp.server"] = server_pkg
    sys.modules["mcp.server.fastmcp"] = fastmcp_pkg


def test_mcp_kb_tools_present_and_valid_json():
    _install_mcp_stub()
    import mcp_server

    for name in ("kb_search", "kb_get", "kb_neighbors", "kb_overview", "kb_activate"):
        assert callable(getattr(mcp_server, name, None)), f"缺少导航工具 {name}"

    assert json.loads(mcp_server.kb_overview())["stats"]["concepts"] >= 70
    search = json.loads(mcp_server.kb_search("徐", limit=3))
    assert search["results"][0]["title"] == "徐"
    got = json.loads(mcp_server.kb_get("125346"))
    assert got["title"] == "徐"
    neigh = json.loads(mcp_server.kb_neighbors("125346"))
    assert "neighbors" in neigh


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
