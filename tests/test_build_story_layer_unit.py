"""build_story_layer 纯函数单测（_unit 后缀）。

只测纯解析/分类函数（load_desc / chapter_title_maps / make_parser / classify_unit /
unlock_type）。main() 会写真实 OUT 文件、依赖多份解包源，故不在单测触发，避免污染
仓内产物。所有断言基于合成输入，零网络、零 IO（load_desc 除外，走 tmp 文件）。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_story_layer as bsl


# --- load_desc --------------------------------------------------------------

def test_load_desc_parses_collection_lines(tmp_path, monkeypatch):
    f = tmp_path / "收藏馆_CollectionHall.txt"
    f.write_text(
        "CollectionHall_12_Desc|some desc text\n"
        "CollectionHall_34_Desc|另一段描述|含管道\n"
        " unrelated line\n"
        "CollectionHall_bad_Desc|skip\n",
        encoding="utf-8")
    # load_desc opens the module-level DESC_SRC path
    monkeypatch.setattr(bsl, "DESC_SRC", str(f))
    descs = bsl.load_desc()
    assert descs[12] == "some desc text"
    assert descs[34] == "另一段描述|含管道"
    assert "bad" not in descs


# --- chapter_title_maps -----------------------------------------------------

def test_chapter_title_maps_extracts_main_and_star():
    entries = [
        {"lock_tip": "调查行动第3章「迷雾」开放后解锁"},
        {"lock_tip": "星辰篇第2章「群星」开放"},
        {"lock_tip": "无关条目"},
    ]
    main, star = bsl.chapter_title_maps(entries)
    assert main == {3: "迷雾"}
    assert star == {2: "群星"}


def test_chapter_title_maps_star_takes_precedence():
    # a tip matching star should not also land in main
    entries = [{"lock_tip": "星辰篇第1章『起源』"}]
    main, star = bsl.chapter_title_maps(entries)
    assert star == {1: "起源"}
    assert main == {}


# --- make_parser / unit_of --------------------------------------------------

@pytest.fixture
def parser():
    return bsl.make_parser({3: "迷雾"}, {2: "群星"})


def test_unit_of_none_and_empty(parser):
    assert parser(None) is None
    assert parser("") is None


def test_unit_of_prologue(parser):
    assert parser("于序章中解锁") == "序章"


def test_unit_of_mind_dive(parser):
    assert parser("意识潜游「深海」中解锁") == "意识潜游「深海」"


def test_unit_of_main_chapter_with_title(parser):
    assert parser("调查行动第3章 开放") == "调查行动第3章「迷雾」"


def test_unit_of_main_chapter_without_title(parser):
    assert parser("调查行动第7章 开放") == "调查行动第7章"


def test_unit_of_main_chapter_community_title(parser):
    # chapter 9 has a community-supplied title
    assert parser("调查行动第9章 开放") == "调查行动第9章「长梦尽时」"


def test_unit_of_star_chapter(parser):
    assert parser("星辰篇第2章 开放") == "调查行动星辰篇第2章「群星」"


def test_unit_of_star_chapter_no_title(parser):
    assert parser("星辰篇第5章 开放") == "调查行动星辰篇第5章"


def test_unit_of_stage_number_format(parser):
    # 调查行动 with N-M stage number, no 第X章
    assert parser("调查行动 3-2 通关") == "调查行动第3章「迷雾」"


def test_unit_of_generic_unlocalizable(parser):
    assert parser("可于调查行动中解锁") is None


def test_unit_of_unmatched_returns_none(parser):
    assert parser("特遣纪录中解锁") is None


# --- classify_unit ----------------------------------------------------------

def test_classify_prologue():
    assert bsl.classify_unit("序章") == ("prologue", 0, "序章")


def test_classify_star_chapter():
    assert bsl.classify_unit("调查行动星辰篇第2章「群星」") == ("star_chapter", 2, "群星")


def test_classify_star_chapter_no_title():
    typ, no, short = bsl.classify_unit("调查行动星辰篇第4章")
    assert typ == "star_chapter" and no == 4 and short == "第4章"


def test_classify_main_chapter():
    assert bsl.classify_unit("调查行动第3章「迷雾」") == ("main_chapter", 3, "迷雾")


def test_classify_main_chapter_no_title():
    typ, no, short = bsl.classify_unit("调查行动第8章")
    assert typ == "main_chapter" and no == 8 and short == "第8章"


def test_classify_mind_dive():
    assert bsl.classify_unit("意识潜游「深海」") == ("mind_dive", None, "深海")


def test_classify_other():
    assert bsl.classify_unit("某个特殊单元") == ("other", None, "某个特殊单元")


# --- unlock_type (nested in main; reconstruct via a small standalone) --------
# unlock_type is defined inside main(); we exercise the equivalent logic paths
# only through classify/make_parser above. To still cover the public surface we
# verify the module-level constants the parser depends on.

def test_community_titles_constant():
    assert bsl.COMMUNITY_TITLES_MAIN.get(9) == "长梦尽时"


# --- main() against real read-only sources, writing to a tmp OUT -------------
# main() reads PROCESSED/* via cwd-relative paths (pytest runs at repo root) and
# writes to OUT. We redirect OUT to tmp so the real story/ outputs are untouched.
# This exercises the full lore/unit/stage/link/index pipeline incl. unlock_type.

def test_main_writes_all_outputs(tmp_path, monkeypatch):
    repo = Path(__file__).resolve().parent.parent
    if not (repo / bsl.DESC_SRC).exists():
        pytest.skip("Game-Unpacked source absent (sparse checkout) — real-data main() run excluded")
    out = tmp_path / "story_out"
    out.mkdir()
    monkeypatch.setattr(bsl, "OUT", str(out))
    monkeypatch.chdir(repo)
    bsl.main()
    expected = {
        "lore_entries.json", "story_units.json", "lore_by_unit.json",
        "stages_by_unit.json", "character_story_links.json", "index.json",
    }
    written = {p.name for p in out.glob("*.json")}
    assert expected <= written
    # structural invariants
    import json
    lore = json.loads((out / "lore_entries.json").read_text(encoding="utf-8"))
    assert lore["_meta"]["total"] > 0
    units = json.loads((out / "story_units.json").read_text(encoding="utf-8"))
    assert units["_meta"]["total_units"] > 0
    links = json.loads((out / "character_story_links.json").read_text(encoding="utf-8"))
    # unlock_type populated for every link
    for lk in links["links"]:
        assert "unlock_type" in lk
    idx = json.loads((out / "index.json").read_text(encoding="utf-8"))
    assert idx["_meta"]["total_units"] == units["_meta"]["total_units"]
