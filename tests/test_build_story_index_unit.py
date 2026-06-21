"""build_story_index 纯函数与构建逻辑单测（_unit 后缀）。

锁定 _clean 富文本剥标签、_load 容错、build 倒排索引/单元画像/角色链聚合的
确定性契约。build 默认读真实只读源（story/*.json），亦提供合成 STORY 目录路径
覆盖。零网络、零 ML、零写入。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_story_index as bsi


# --- _clean -----------------------------------------------------------------

def test_clean_strips_markup_tags():
    out = bsi._clean("<Title:物质维度> 正文 <OrangeQuality:深渊通信>")
    assert "Title" not in out
    assert "OrangeQuality" not in out
    assert "物质维度" in out
    assert "深渊通信" in out


def test_clean_none_returns_empty():
    assert bsi._clean(None) == ""


def test_clean_plain_text_unchanged():
    assert bsi._clean("plain text") == "plain text"


# --- _load ------------------------------------------------------------------

def test_load_missing_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(bsi, "STORY", tmp_path)
    assert bsi._load("nope.json", "entries") == []


def test_load_dict_key(tmp_path, monkeypatch):
    monkeypatch.setattr(bsi, "STORY", tmp_path)
    (tmp_path / "x.json").write_text(json.dumps({"entries": [1, 2, 3]}), encoding="utf-8")
    assert bsi._load("x.json", "entries") == [1, 2, 3]


def test_load_bare_list(tmp_path, monkeypatch):
    monkeypatch.setattr(bsi, "STORY", tmp_path)
    (tmp_path / "y.json").write_text(json.dumps([4, 5]), encoding="utf-8")
    assert bsi._load("y.json", "entries") == [4, 5]


# --- build (synthetic STORY dir) --------------------------------------------

@pytest.fixture
def synth_story(tmp_path, monkeypatch):
    s = tmp_path / "story"
    s.mkdir()
    (s / "lore_entries.json").write_text(json.dumps({"entries": [
        {"id": 1, "title": "物质维度", "desc": "<Title:深渊> 通信记录",
         "story_unit": "序章", "category": "lore", "lock_tip": "于序章中解锁"},
        {"id": 2, "title": "无描述", "desc": "", "story_unit": "",
         "category": "uncategorized", "lock_tip": ""},
    ]}, ensure_ascii=False), encoding="utf-8")
    (s / "story_units.json").write_text(json.dumps({"units": [
        {"unit": "序章", "type": "prologue"},
    ]}), encoding="utf-8")
    (s / "character_story_links.json").write_text(json.dumps({"links": [
        {"character": "艾瑞卡", "bio_lore_id": 1, "story_unit": "序章",
         "unlock_condition": "于序章中解锁"},
    ]}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(bsi, "STORY", s)
    return s


def test_build_synthetic_structure(synth_story):
    idx = bsi.build()
    m = idx["_meta"]
    assert m["data_layer"] == "full_archive"
    assert m["lore_count"] == 2
    assert m["lore_with_desc"] == 1
    assert m["unit_count"] == 1
    assert m["term_count"] >= 1


def test_build_inverted_index_sorted(synth_story):
    idx = bsi.build()
    inv = idx["inverted"]
    # markup tag names should not appear as terms
    assert "Title" not in inv
    # each posting list sorted
    for ids in inv.values():
        assert ids == sorted(ids)
    # keys sorted
    assert list(inv.keys()) == sorted(inv.keys())


def test_build_lore_meta(synth_story):
    idx = bsi.build()
    meta = idx["lore_meta"]
    assert meta["1"]["has_desc"] is True
    assert meta["2"]["has_desc"] is False
    assert meta["1"]["unit"] == "序章"


def test_build_unit_profiles(synth_story):
    idx = bsi.build()
    profiles = idx["unit_profiles"]
    assert "序章" in profiles
    assert "top_terms" in profiles["序章"]


def test_build_character_links(synth_story):
    idx = bsi.build()
    links = idx["character_links"]
    assert "艾瑞卡" in links
    entry = links["艾瑞卡"][0]
    assert entry["bio_lore_id"] == 1
    assert entry["unit"] == "序章"


def test_build_empty_sources(tmp_path, monkeypatch):
    monkeypatch.setattr(bsi, "STORY", tmp_path)
    idx = bsi.build()
    assert idx["_meta"]["lore_count"] == 0
    assert idx["inverted"] == {}
    assert idx["lore_meta"] == {}


def test_build_against_real_sources():
    """Smoke test against the real read-only story layer (no writes)."""
    idx = bsi.build()
    assert idx["_meta"]["lore_count"] > 0
    assert idx["_meta"]["term_count"] > 0
    assert isinstance(idx["inverted"], dict)


def test_main_writes_index(monkeypatch, capsys):
    """main() builds from real sources and writes to a redirected OUT.

    OUT must live under REPO because main() prints OUT.relative_to(REPO).
    Use a unique repo-local temp file and clean it up.
    """
    import tempfile, os
    repo = Path(__file__).resolve().parent.parent
    fd, name = tempfile.mkstemp(suffix=".json", prefix="_unit_si_", dir=repo)
    os.close(fd)
    out = Path(name)
    monkeypatch.setattr(bsi, "OUT", out)
    try:
        bsi.main()
        written = json.loads(out.read_text(encoding="utf-8"))
        assert written["_meta"]["lore_count"] > 0
        captured = capsys.readouterr()
        assert "story index" in captured.out
    finally:
        out.unlink(missing_ok=True)
