"""Conformance tests for 银芯 static analysis indexes (community + story).

These indexes are build-time generated artifacts (零 ML / 零常驻) that fill the
"全量档案层无检索工具" gap — see scripts/build_community_index.py /
build_story_index.py. Discipline guarded here:

1. Both carry _meta.data_layer == "full_archive" (§4.1 / lesson #30: 绝不与输出
   层 168 条样本混淆).
2. Structural integrity (inverted ids resolve, timeline sorted, counts consistent).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
COMMUNITY = REPO / "projects/news/index/community_index.json"
STORY = REPO / "projects/wiki/data/processed/story/story_search_index.json"


# --- story index (always present; cheap to rebuild) --------------------------

@pytest.fixture(scope="module")
def story():
    if not STORY.exists():
        pytest.skip("story index missing — run scripts/build_story_index.py")
    return json.loads(STORY.read_text(encoding="utf-8"))


def test_story_data_layer(story):
    assert story["_meta"]["data_layer"] == "full_archive"


def test_story_inverted_ids_resolve(story):
    """Every lore id in the inverted table must exist in lore_meta."""
    meta_ids = set(story["lore_meta"])
    assert meta_ids, "no lore_meta"
    for term, ids in story["inverted"].items():
        for lid in ids:
            assert lid in meta_ids, f"inverted term {term!r} -> unknown lore {lid}"


def test_story_inverted_sorted_deterministic(story):
    """Inverted posting lists are sorted (reproducible build)."""
    for term, ids in story["inverted"].items():
        assert ids == sorted(ids), f"inverted {term!r} not sorted"


def test_story_counts_consistent(story):
    assert story["_meta"]["lore_count"] == len(story["lore_meta"])
    assert story["_meta"]["term_count"] == len(story["inverted"])


# --- community index (large; may be absent in a light checkout) --------------

@pytest.fixture(scope="module")
def community():
    if not COMMUNITY.exists():
        pytest.skip("community index missing — run scripts/build_community_index.py")
    return json.loads(COMMUNITY.read_text(encoding="utf-8"))


def test_community_data_layer(community):
    assert community["_meta"]["data_layer"] == "full_archive"


def test_community_has_records(community):
    assert community["_meta"]["total_records"] > 0
    assert community["platforms"], "no platforms aggregated"


def test_community_timeline_sorted(community):
    months = list(community["timeline"])
    assert months == sorted(months), "timeline months not chronological"


def test_community_platform_month_consistency(community):
    """Per-platform total equals the sum of its monthly counts."""
    for name, pdat in community["platforms"].items():
        s = sum(m["count"] for m in pdat["by_month"].values())
        assert s == pdat["total"], f"{name}: month sum {s} != total {pdat['total']}"


def test_community_sentiment_method_labeled(community):
    """Sentiment must be labeled coarse/non-semantic (honesty guard)."""
    method = community["_meta"]["method"].lower()
    assert "lexic" in method or "coarse" in method, "method not labeled lexical/coarse"


def test_community_coverage_present(community):
    """采集覆盖信号必须在场（防 2026-02/03 缺口被误读为社区静默）。"""
    for name, pdat in community["platforms"].items():
        for ym, m in pdat["by_month"].items():
            cov = m.get("coverage")
            assert cov and {"active_days", "month_days", "ratio"} <= set(cov), \
                f"{name} {ym} missing coverage signal"
            assert 0 < cov["ratio"] <= 1.0, f"{name} {ym} coverage ratio out of range"
    for ym, t in community["timeline"].items():
        assert "vol_index" in t, f"timeline {ym} missing vol_index (volume anomaly signal)"
