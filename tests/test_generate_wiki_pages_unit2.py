"""Coverage for the large orchestrators in generate_wiki_pages.py:
generate_characters -> generate_awakener_pages + generate_playstyle, and
generate_story. Synthetic minimal datasets in tmp_path; no real wiki tree.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import generate_wiki_pages as gwp


@pytest.fixture
def wiki_tmp(tmp_path, monkeypatch):
    processed = tmp_path / "processed"
    docs = tmp_path / "docs"
    processed.mkdir()
    docs.mkdir()
    (docs / "public").mkdir()
    monkeypatch.setattr(gwp, "PROCESSED_DIR", str(processed))
    monkeypatch.setattr(gwp, "DOCS_DIR", str(docs))
    return {"processed": processed, "docs": docs}


def _wj(path: Path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def _read(docs: Path, name: str) -> str:
    return (docs / name).read_text(encoding="utf-8")


SKILLS_MD = (
    "# 角色技能\n"
    "## 混沌界域\n"
    "**艾瑞卡 / Erica**（注） — 过牌型。核心循环正文。\n"
    "## 深海界域\n"
    "**深海者**（备） — 触腕型。深渊号令。\n"
)


def _seed_characters(processed: Path, with_index=True, with_skills=True,
                     with_story_index=True):
    chars = {
        "_meta": {"total_characters": 4},
        "characters": [
            {
                "id": 1,
                "name": "艾瑞卡",
                "title": "数据库终端",
                "gender": "女",
                "birthday": "1-1",
                "height": "160",
                "weight": "50",
                "gi": "999",
                "voice_actor": "CV甲",
                "painter": "画师甲",
                "characteristic": "扫描",
                "introduction": "弥萨格大学终端。",
                "gameplay_intro": "过牌机制。",
                "summon_slogan": "数据归位。",
                "category": "playable",
            },
            {
                "id": 2,
                "name": "深海者",
                "title": "深海者",  # title == name
                "category": "playable",
            },
            {
                "id": 3,
                "name": "无玩法卡",  # playable but no playstyle entry -> 玩法待补
                "title": "幽灵",
                "category": "playable",
            },
            {
                "id": 4,
                "name": "彩蛋君",
                "title": "NPC",
                "voice_actor": "CV乙",
                "painter": "画师乙",
                "category": "easter_egg",
            },
            {
                "id": 5,
                "name": "未上线角",
                "title": "草稿",
                "category": "unreleased",
            },
        ],
    }
    _wj(processed / "characters.json", chars)

    if with_index:
        cidx = {
            "characters": [
                {
                    "id": 1,
                    "name": "艾瑞卡",
                    "category": "playable",
                    "story_unlock_type": "main_story",
                    "gossip_about_count": 5,
                },
                {"id": 2, "name": "深海者", "category": "playable"},
            ]
        }
        _wj(processed / "character_index.json", cidx)

    if with_skills:
        (processed / "character_skills.md").write_text(SKILLS_MD, encoding="utf-8")

    if with_story_index:
        story_dir = processed / "story"
        story_dir.mkdir(exist_ok=True)
        _wj(story_dir / "index.json", {
            "index": [
                {"unit": "序章", "characters": ["艾瑞卡"]},
                {"unit": "第一章", "characters": ["深海者"]},
            ]
        })


def test_generate_characters_full(wiki_tmp):
    _seed_characters(wiki_tmp["processed"])
    gwp.generate_characters()
    docs = wiki_tmp["docs"]

    main = _read(docs, "characters.md")
    assert "唤醒体图鉴" in main
    assert "可玩唤醒体（按界域）" in main
    assert "混沌界域（1）" in main
    assert "深海界域（1）" in main
    assert "界域待考（暂无玩法卡）" in main  # 无玩法卡 character
    assert "彩蛋 / NPC（1）" in main
    assert "未上线唤醒体（1）" in main
    assert "彩蛋君" in main

    # awakener detail pages
    awk_dir = docs / "zh" / "awakeners"
    erica = (awk_dir / "1.md").read_text(encoding="utf-8")
    assert "title: 艾瑞卡 - 唤醒体详情" in erica
    assert "数据库终端" in erica
    assert "GI 值" in erica
    assert "故事解锁 | 主线剧情解锁" in erica
    assert "被提及（闲话） | 5 条" in erica
    assert "简介" in erica
    assert "玩法定位" in erica  # has playstyle card
    assert "官方战斗机制描述" in erica
    assert "summon-slogan" in erica
    assert "登场剧情" in erica  # from story index
    assert "返回唤醒体图鉴" in erica

    # character with no playstyle -> 玩法待补 warning branch
    ghost = (awk_dir / "3.md").read_text(encoding="utf-8")
    assert "玩法待补" in ghost

    # index list page
    idx = (awk_dir / "index.md").read_text(encoding="utf-8")
    assert "唤醒体列表" in idx
    assert "混沌" in idx

    # playstyle page (generated because character_skills.md exists)
    play = _read(docs, "playstyle.md")
    assert "玩法图鉴" in play
    assert "/zh/awakeners/1" in play  # name linked to detail page
    assert "realm-legend" in play


def test_generate_characters_removes_stale_pandia(wiki_tmp):
    awk_dir = wiki_tmp["docs"] / "zh" / "awakeners"
    awk_dir.mkdir(parents=True)
    (awk_dir / "pandia.md").write_text("stale", encoding="utf-8")
    _seed_characters(wiki_tmp["processed"])
    gwp.generate_characters()
    assert not (awk_dir / "pandia.md").exists()


def test_generate_characters_no_index_no_story(wiki_tmp):
    _seed_characters(wiki_tmp["processed"], with_index=False,
                     with_story_index=False)
    gwp.generate_characters()
    erica = (wiki_tmp["docs"] / "zh" / "awakeners" / "1.md").read_text(
        encoding="utf-8")
    assert "故事解锁" not in erica  # no character_index
    assert "登场剧情" not in erica  # no story index


def test_generate_playstyle_missing_src_returns(wiki_tmp):
    # character_skills.md absent -> generate_playstyle returns without writing
    gwp.generate_playstyle([], {})
    assert not (wiki_tmp["docs"] / "playstyle.md").exists()


def test_generate_playstyle_unknown_name_not_linked(wiki_tmp):
    (wiki_tmp["processed"] / "character_skills.md").write_text(
        "# T\n**陌生人** — 未知。\n", encoding="utf-8")
    gwp.generate_playstyle([{"id": 9, "name": "在册"}], {})
    out = _read(wiki_tmp["docs"], "playstyle.md")
    # 陌生人 not in name2id -> left as plain bold, no link
    assert "**陌生人**" in out
    assert "/zh/awakeners/" not in out.split("陌生人")[1][:40]


# ---------------------------------------------------------------------------
# generate_story
# ---------------------------------------------------------------------------
def _seed_story(processed: Path, with_char_index=True, with_stages=True):
    sd = processed / "story"
    sd.mkdir(exist_ok=True)
    _wj(sd / "index.json", {
        "index": [
            {
                "unit": "序章",
                "type": "prologue",
                "chapter_no": None,
                "lore_count": 2,
                "stage_group_count": 1,
                "lore_ids": [100, 101],
                "stage_group_ids": [10],
                "characters": ["艾瑞卡"],
            },
            {
                "unit": "第一章",
                "type": "main_chapter",
                "chapter_no": 1,
                "lore_count": 1,
                "stage_group_count": 0,
                "lore_ids": [101],
                "stage_group_ids": [],
                "characters": [],
            },
            {
                "unit": "星辰篇",
                "type": "star_chapter",
                "chapter_no": None,
                "lore_count": 1,
                "stage_group_count": 0,
                "lore_ids": [102],
                "stage_group_ids": [],
                "characters": [],
            },
        ]
    })
    _wj(sd / "lore_entries.json", {
        "entries": [
            {"id": 100, "title": "<Title:开端>",
             "desc": "这是一段足够长的叙事正文内容用于通过三十个字符阈值检测以走进剧情正文渲染分支。",
             "lock_tip": "通关序章"},
            {"id": 101, "title": "短", "desc": "短文", "lock_tip": ""},
            {"id": 102, "title": "星辰", "desc": "星辰篇的叙事正文也要超过三十个字符的阈值才行哦哦哦。",
             "lock_tip": ""},
            {"id": 999, "title": "孤儿正文",
             "desc": "这是未编入任何章节的孤儿叙事正文内容长度务必足够长以越过三十个字符的阈值检测才行。",
             "lock_tip": ""},
        ]
    })
    _wj(sd / "stages_by_unit.json", {
        "by_unit": {
            "序章": [
                {"group_id": 10, "name": "起始关", "type": "主线"},
                {"group_id": 10, "name": "起始关", "type": "主线"},  # dup
            ]
        }
    })
    if with_char_index:
        _wj(processed / "character_index.json", {
            "characters": [
                {"id": 1, "name": "艾瑞卡", "category": "playable"},
                {"id": 2, "name": "非可玩", "category": "easter_egg"},
            ]
        })
    if with_stages:
        _wj(processed / "stages.json", {
            "_meta": {"total_groups": 1, "total_stages": 1},
            "groups": [{"id": 10, "name": "起始关", "desc": "<Bold:序章引言>"}],
        })


def test_generate_story_full(wiki_tmp):
    _seed_story(wiki_tmp["processed"])
    gwp.generate_story()
    out = _read(wiki_tmp["docs"], "story.md")
    assert "剧情正文读本" in out
    assert "章节概览" in out
    assert "序章" in out
    assert "{#chapter-0}" in out
    assert "关联角色" in out
    assert "[艾瑞卡](/zh/awakeners/1)" in out  # playable char linked
    assert "关卡引言" in out
    assert "起始关" in out
    assert "序章引言" in out  # stage desc cleaned
    assert "剧情正文" in out
    assert "开端" in out
    assert "通关序章" in out  # lock_tip rendered in <small>解锁：...</small>
    assert "词条速览" in out  # short entry
    assert "星辰篇" in out
    assert "番外" in out  # orphan lore 999
    assert "孤儿正文" in out


def test_generate_story_missing_layer(wiki_tmp, capsys):
    # no story/index.json
    gwp.generate_story()
    assert not (wiki_tmp["docs"] / "story.md").exists()
    assert "Story layer not found" in capsys.readouterr().out


def test_generate_story_no_char_index_no_stages(wiki_tmp):
    _seed_story(wiki_tmp["processed"], with_char_index=False, with_stages=False)
    gwp.generate_story()
    out = _read(wiki_tmp["docs"], "story.md")
    # char name not linked when index absent
    assert "艾瑞卡" in out
    assert "[艾瑞卡](/zh/awakeners/" not in out


def test_module_main_runs(tmp_path, monkeypatch):
    """Drive __main__ block end-to-end with a fully synthetic dataset so the
    top-level orchestration lines execute."""
    processed = tmp_path / "processed"
    docs = tmp_path / "docs"
    processed.mkdir()
    docs.mkdir()
    (docs / "public").mkdir()
    monkeypatch.setattr(gwp, "PROCESSED_DIR", str(processed))
    monkeypatch.setattr(gwp, "DOCS_DIR", str(docs))

    _seed_characters(processed)
    _seed_story(processed)
    # minimal inputs for the remaining generators
    _wj(processed / "voice_lines.json", {
        "_meta": {"total_lines": 0, "character_groups": 0}, "characters": []})
    _wj(processed / "world_lore.json", {
        "_meta": {"total_entries": 0, "with_description": 0}, "all_entries": []})
    _wj(processed / "cg_gallery.json", {
        "_meta": {"total_cg": 0, "story_chapters": 0}, "chapters": []})
    _wj(processed / "item_stories.json", {
        "_meta": {"total_with_story": 0, "category_counts": {}}, "by_category": {}})
    _wj(processed / "summon.json", {
        "_meta": {"total_banners": 0}, "banners": []})
    _wj(processed / "panel_text.json", {
        "_meta": {"total_entries": 0, "total_categories": 0}, "categories": {}})
    _wj(processed / "update_notices.json", {
        "_meta": {"total_entries": 0}, "notices": []})
    _wj(processed / "feature_unlock.json", {
        "_meta": {"total_features": 0}, "features": []})

    # Call each top-level generator like __main__ does (exercises orchestration)
    gwp.generate_voice_lines()
    gwp.generate_collection_hall()
    gwp.generate_cg_gallery()
    gwp.generate_item_stories()
    gwp.generate_portraits_gallery()
    gwp.generate_bunit_gallery()
    gwp.generate_icons_gallery()
    gwp.generate_ui_gallery()
    gwp.generate_characters()
    gwp.generate_story()
    gwp.generate_summon()
    gwp.generate_stages()  # needs stages.json (seeded by _seed_story)
    gwp.generate_audio_index()
    gwp.generate_video_index()
    gwp.generate_panel_text()
    gwp.generate_update_notices()
    gwp.generate_feature_unlock()

    assert (docs / "characters.md").exists()
    assert (docs / "story.md").exists()
