"""Breadth coverage for scripts/generate_wiki_pages.py.

Strategy: every generate_* function reads JSON from module global PROCESSED_DIR
and writes markdown into DOCS_DIR. We point both at tmp_path, seed synthetic
minimal inputs, run the generator, and assert on key substrings of the written
page. Pure helpers are exercised directly. No network, no real wiki tree.
"""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import generate_wiki_pages as gwp


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def wiki_tmp(tmp_path, monkeypatch):
    """Redirect PROCESSED_DIR + DOCS_DIR into tmp_path and create the dirs."""
    processed = tmp_path / "processed"
    docs = tmp_path / "docs"
    processed.mkdir()
    docs.mkdir()
    (docs / "public").mkdir()
    monkeypatch.setattr(gwp, "PROCESSED_DIR", str(processed))
    monkeypatch.setattr(gwp, "DOCS_DIR", str(docs))
    return {"processed": processed, "docs": docs, "root": tmp_path}


def _wj(path: Path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def _read(docs: Path, name: str) -> str:
    return (docs / name).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# pure helpers
# ---------------------------------------------------------------------------
def test_slug_returns_str_id():
    assert gwp._slug({"id": 42}) == "42"
    assert gwp._slug({"id": "x7"}) == "x7"


def test_realm_badge_known_and_unknown():
    assert "realm-chaos" in gwp._realm_badge("chaos")
    assert "混沌" in gwp._realm_badge("chaos")
    assert "界域待考" in gwp._realm_badge(None)
    assert "opacity" in gwp._realm_badge("")


def test_awakener_card_with_playstyle():
    ch = {"id": 5, "name": "艾瑞卡", "title": "数据库终端"}
    p = {"realm": "chaos", "role": "过牌"}
    out = gwp._awakener_card(ch, p)
    assert "realm-accent-chaos" in out
    assert "艾瑞卡" in out
    assert "过牌" in out
    assert "数据库终端" in out  # title differs from name -> shown
    assert f"{gwp.SITE_BASE}zh/awakeners/5.html" in out


def test_awakener_card_no_playstyle_and_title_equals_name():
    ch = {"id": 7, "name": "同名", "title": "同名"}
    out = gwp._awakener_card(ch, None)
    assert "玩法待补" in out
    assert "realm-accent" not in out
    assert "ac-title" not in out  # title == name suppressed


def test_awakener_card_playstyle_no_role():
    ch = {"id": 9, "name": "无定位", "title": ""}
    out = gwp._awakener_card(ch, {"realm": "caro", "role": ""})
    assert "—" in out  # empty role with non-None p -> em dash


def test_clean_lore_markup_unknown_tag_keeps_content():
    assert gwp._clean_lore_markup("<Weird:留下内容>") == "留下内容"


def test_clean_lore_markup_red_and_white():
    assert "#ec7063" in gwp._clean_lore_markup("<RedQuality:红>")
    assert gwp._clean_lore_markup("<WhiteQuality:白>") == "白"


def test_clean_title_strip_span_and_bold():
    assert gwp._clean_title("<Title:标题>") == "标题"


def test_clean_lore_markup_orange_quality():
    assert 'rarity-ssr' in gwp._clean_lore_markup("<OrangeQuality:橙>")


# ---------------------------------------------------------------------------
# load_playstyle
# ---------------------------------------------------------------------------
def test_load_playstyle_missing_file(wiki_tmp):
    assert gwp.load_playstyle() == {}


def test_load_playstyle_parses_realm_and_role(wiki_tmp):
    md = (
        "# 玩法图鉴\n"
        "## 混沌界域\n"
        "**艾瑞卡 / Erica**（注释） — 过牌型。正文描述在此。\n"
        "## 深海界域\n"
        "**深海者**（备注） - 触腕。深渊号令体系。\n"
        "无效行不带星号\n"
    )
    (wiki_tmp["processed"] / "character_skills.md").write_text(md, encoding="utf-8")
    out = gwp.load_playstyle()
    assert out["艾瑞卡"]["realm"] == "chaos"
    assert out["艾瑞卡"]["role"] == "过牌型"
    assert out["深海者"]["realm"] == "aequor"
    assert out["深海者"]["role"] == "触腕"
    # card preserves full line
    assert "正文描述" in out["艾瑞卡"]["card"]


def test_load_playstyle_bold_before_realm_ignored(wiki_tmp):
    md = "**孤儿**（无界域） — 没人要。\n## 混沌界域\n**有家**（x） — 收编。\n"
    (wiki_tmp["processed"] / "character_skills.md").write_text(md, encoding="utf-8")
    out = gwp.load_playstyle()
    assert "孤儿" not in out
    assert "有家" in out


# ---------------------------------------------------------------------------
# voice lines (mapped + legacy)
# ---------------------------------------------------------------------------
def test_generate_voice_lines_full(wiki_tmp):
    data = {
        "_meta": {
            "total_voice_entries": 3,
            "big_group_clusters": 1,
            "about_relation_count": 1,
        },
        "character_voices": {
            "艾瑞卡": {
                "character_ids": [1, 2],
                "voice_line_count": 1,
                "voice_lines": [
                    {
                        "title": "闲话·一",
                        "content": "你好",
                        "relation": "about",
                        "unlock_desc": "获得后解锁",
                    }
                ],
            },
            "空角色": {"character_ids": [3], "voice_line_count": 0, "voice_lines": []},
        },
        "voice_groups": [
            {
                "group_id": 0,
                "id_range": "4908-4920",
                "line_count": 2,
                "voice_lines": [
                    {
                        "title": "闲话·二",
                        "content": "天气",
                        "about_character": "深海者",
                        "unlock_desc": "",
                    },
                    {"title": "技能·一", "content": "出招", "about_character": ""},
                ],
            }
        ],
        "small_voice_groups": [
            {
                "id_range": "7000-7005",
                "line_count": 1,
                "referenced_characters": ["A"],
                "voice_lines": [
                    {"title": "唤醒", "content": "苏醒", "about_character": "B", "unlock_desc": "x"}
                ],
            }
        ],
        "unmapped_voices": [
            {"title": "未知", "content": "嗯", "unlock_desc": "解锁"}
        ],
    }
    _wj(wiki_tmp["processed"] / "voice_character_map.json", data)
    gwp.generate_voice_lines()
    out = _read(wiki_tmp["docs"], "voice-lines.md")
    assert "# 角色语音台词" in out
    assert "艾瑞卡（ID: 1, 2," in out
    assert "谈及" in out
    assert "角色语音组" in out
    assert "谈及：深海者" in out
    assert "追加语音组" in out
    assert "关联角色：A" in out
    assert "未映射语音" in out


def test_generate_voice_lines_fallback_to_legacy(wiki_tmp):
    # No voice_character_map.json -> legacy path reads voice_lines.json
    legacy = {
        "_meta": {"total_lines": 2, "character_groups": 1},
        "characters": [
            {
                "id_range": "1-9",
                "line_count": 2,
                "categories": {
                    "闲话": [
                        {"title": "闲话·甲", "content": "嗨", "unlock_desc": "u"},
                        {"title": "闲话·乙", "content": "哟", "unlock_desc": ""},
                    ]
                },
            }
        ],
    }
    _wj(wiki_tmp["processed"] / "voice_lines.json", legacy)
    gwp.generate_voice_lines()
    out = _read(wiki_tmp["docs"], "voice-lines.md")
    assert "角色组 1" in out
    assert "闲话·甲" in out


# ---------------------------------------------------------------------------
# collection hall
# ---------------------------------------------------------------------------
def test_generate_collection_hall(wiki_tmp):
    data = {
        "_meta": {"total_entries": 2, "with_description": 1},
        "all_entries": [
            {"title": "<Title:词条一>", "desc": "<Bold:正文>", "lock_tip": "通关解锁"},
            {"title": "仅标题", "desc": "", "lock_tip": ""},
            {"title": "标题带锁", "desc": "", "lock_tip": "条件"},
        ],
    }
    _wj(wiki_tmp["processed"] / "world_lore.json", data)
    gwp.generate_collection_hall()
    out = _read(wiki_tmp["docs"], "collection-hall.md")
    assert "收藏馆百科" in out
    assert "词条一" in out
    assert "解锁条件：通关解锁" in out
    assert "仅标题词条" in out
    assert "- **标题带锁** — *条件*" in out


# ---------------------------------------------------------------------------
# item stories
# ---------------------------------------------------------------------------
def test_generate_item_stories(wiki_tmp):
    data = {
        "_meta": {"total_with_story": 2, "category_counts": {}},
        "by_category": {
            "weapons": [
                {"name": "<Title:剑>", "desc": "锋利", "story": "传说故事"}
            ],
            "materials": [],
            "other": [{"name": "石头", "desc": "", "story": "普通"}],
        },
    }
    _wj(wiki_tmp["processed"] / "item_stories.json", data)
    gwp.generate_item_stories()
    out = _read(wiki_tmp["docs"], "item-stories.md")
    assert "道具背景故事" in out
    assert "命轮（1 条）" in out
    assert "传说故事" in out
    assert "其他道具（1 条）" in out


# ---------------------------------------------------------------------------
# CG gallery (release pointer + with assets)
# ---------------------------------------------------------------------------
def test_generate_cg_gallery_release_pointer(wiki_tmp):
    _wj(wiki_tmp["processed"] / "cg_gallery.json",
        {"_meta": {"total_cg": 0, "story_chapters": 0}, "chapters": []})
    gwp.generate_cg_gallery()
    out = _read(wiki_tmp["docs"], "cg-gallery.md")
    assert "媒体未内嵌" in out
    assert "CG 画廊" in out


def test_generate_cg_gallery_with_assets(wiki_tmp):
    docs = wiki_tmp["docs"]
    cg_dir = docs / "public" / "cg" / "c1"
    cg_dir.mkdir(parents=True)
    (cg_dir / "img1.png").write_bytes(b"x")
    scenebg = docs / "public" / "scenebg"
    scenebg.mkdir(parents=True)
    (scenebg / "bg1.png").write_bytes(b"x")
    data = {
        "_meta": {"total_cg": 2, "story_chapters": 1},
        "chapters": [
            {
                "chapter_name": "第一章",
                "image_count": 2,
                "images": [
                    {"path": "cg/c1/img1.png", "name": "img1"},
                    {"path": "cg/c1/missing.png", "name": "missing"},
                ],
            }
        ],
        "special": [
            {
                "group_name": "特殊组",
                "image_count": 1,
                "images": [{"path": "cg/c1/img1.png", "name": "img1"}],
            }
        ],
    }
    _wj(wiki_tmp["processed"] / "cg_gallery.json", data)
    gwp.generate_cg_gallery()
    out = _read(docs, "cg-gallery.md")
    assert "cg-grid" in out
    assert "img1" in out
    assert "未包含图片文件" in out  # missing.png path
    assert "特殊 CG" in out
    assert "场景背景" in out
    assert "bg1" in out


# ---------------------------------------------------------------------------
# generic gallery helpers / portraits / bunit / icons / ui
# ---------------------------------------------------------------------------
def test_generate_portraits_release_pointer(wiki_tmp):
    gwp.generate_portraits_gallery()
    out = _read(wiki_tmp["docs"], "portraits.md")
    assert "媒体未内嵌" in out


def test_generate_portraits_with_assets(wiki_tmp):
    p = wiki_tmp["docs"] / "public" / "portraits" / "full"
    p.mkdir(parents=True)
    (p / "a.png").write_bytes(b"x")
    gwp.generate_portraits_gallery()
    out = _read(wiki_tmp["docs"], "portraits.md")
    assert "全身立绘（1 张）" in out
    assert "a" in out


def test_gallery_from_dir_nested_subdirs(wiki_tmp):
    # section dir has no direct png but a sub2 dir with pngs
    base = wiki_tmp["docs"] / "public" / "bunit" / "awaker" / "sub"
    base.mkdir(parents=True)
    (base / "x.png").write_bytes(b"x")
    lines, total = gwp._gallery_from_dir(
        "bunit", "T", "D", [("awaker", "唤醒体"), ("missingsec", "无")]
    )
    assert total == 1
    joined = "\n".join(lines)
    assert "sub/x.png" in joined


def test_gallery_from_dir_flat(wiki_tmp):
    base = wiki_tmp["docs"] / "public" / "flatg"
    base.mkdir(parents=True)
    (base / "z.png").write_bytes(b"x")
    lines, total = gwp._gallery_from_dir("flatg", "T", "D", None)
    assert total == 1
    assert "共 1 张" in "\n".join(lines)


def test_generate_bunit_with_assets(wiki_tmp):
    p = wiki_tmp["docs"] / "public" / "bunit" / "monster"
    p.mkdir(parents=True)
    (p / "m.png").write_bytes(b"x")
    gwp.generate_bunit_gallery()
    out = _read(wiki_tmp["docs"], "battle-units.md")
    assert "怪物（1 张）" in out


def test_generate_icons_release_pointer(wiki_tmp):
    gwp.generate_icons_gallery()
    out = _read(wiki_tmp["docs"], "icons.md")
    assert "媒体未内嵌" in out


def test_generate_icons_with_assets(wiki_tmp):
    p = wiki_tmp["docs"] / "public" / "icon" / "career"
    p.mkdir(parents=True)
    (p / "i.png").write_bytes(b"x")
    # unknown subdir uses its own name as label
    p2 = wiki_tmp["docs"] / "public" / "icon" / "weirdcat"
    p2.mkdir(parents=True)
    (p2 / "j.png").write_bytes(b"x")
    gwp.generate_icons_gallery()
    out = _read(wiki_tmp["docs"], "icons.md")
    assert "职业图标（1 张）" in out
    assert "weirdcat（1 张）" in out


def test_generate_ui_release_pointer(wiki_tmp):
    gwp.generate_ui_gallery()
    out = _read(wiki_tmp["docs"], "ui-resources.md")
    assert "媒体未内嵌" in out


def test_generate_ui_with_assets(wiki_tmp):
    docs = wiki_tmp["docs"]
    card = docs / "public" / "portrait-card" / "card"
    card.mkdir(parents=True)
    (card / "c.png").write_bytes(b"x")
    ui = docs / "public" / "uiresources" / "uibigimages" / "ui_battle"
    ui.mkdir(parents=True)
    (ui / "b.png").write_bytes(b"x")
    # a category dir that is actually empty -> skipped
    (docs / "public" / "uiresources" / "uibigimages" / "ui_empty").mkdir()
    gwp.generate_ui_gallery()
    out = _read(docs, "ui-resources.md")
    assert "卡面立绘（1 张）" in out
    assert "战斗（1 张）" in out


# ---------------------------------------------------------------------------
# summon
# ---------------------------------------------------------------------------
def test_generate_summon(wiki_tmp):
    data = {
        "_meta": {"total_banners": 4},
        "banners": [
            {
                "title": "限定卡池",
                "name": "卡池A",
                "desc": "描述A",
                "short_desc": "短A",
                "rate_up": "角色甲",
                "rate_ssr": "5%",
                "rate_sr": "15%",
                "rate_r": "80%",
            },
            {
                "title": "限定卡池",
                "name": "卡池A2",
                "desc": "",
                "short_desc": "短B",
                "rate_up": "角色乙",
                "rate_ssr": "SSR物品基础出率：3.03%",
                "rate_sr": "",
                "rate_r": "",
            },
            {
                "title": "",
                "name": "无名池",
                "desc": "一段很长的说明" * 20,
                "short_desc": "",
                "rate_up": "",
                "rate_ssr": "",
                "rate_sr": "",
                "rate_r": "",
            },
        ],
    }
    _wj(wiki_tmp["processed"] / "summon.json", data)
    gwp.generate_summon()
    out = _read(wiki_tmp["docs"], "summon.md")
    assert "唤醒系统" in out
    assert "限定卡池" in out
    assert "UP 角色/命轮（2 期）" in out
    assert "界域变体" in out
    assert "共 2 期" in out
    assert "其他卡池" in out
    assert "标准概率表" in out


def test_generate_summon_single_rateup_standard_rate(wiki_tmp):
    data = {
        "_meta": {"total_banners": 1},
        "banners": [
            {
                "title": "标准池",
                "name": "n",
                "desc": "d",
                "short_desc": "s",
                "rate_up": "甲",
                "rate_ssr": "SSR物品基础出率：3.03%",
                "rate_sr": "",
                "rate_r": "",
            }
        ],
    }
    _wj(wiki_tmp["processed"] / "summon.json", data)
    gwp.generate_summon()
    out = _read(wiki_tmp["docs"], "summon.md")
    assert "UP: 甲" in out
    # standard rate -> no per-banner rate table header before appendix
    assert out.count("| 稀有度 | 概率 |") == 1


# ---------------------------------------------------------------------------
# stages
# ---------------------------------------------------------------------------
def test_generate_stages(wiki_tmp):
    data = {
        "_meta": {"total_groups": 3, "total_stages": 9},
        "groups": [
            {"name": "主线1", "type": "主线", "desc": "剧情描述", "reward_desc": "金币"},
            {"name": "主线1", "type": "主线", "desc": "重复", "reward_desc": ""},
            {"name": "活动1", "type": "", "desc": "活动描述", "reward_desc": "材料"},
        ],
    }
    _wj(wiki_tmp["processed"] / "stages.json", data)
    gwp.generate_stages()
    out = _read(wiki_tmp["docs"], "stages.md")
    assert "关卡导航" in out
    assert "主线（2 组）" in out
    assert "其他（1 组）" in out  # type empty -> 其他
    # dedup by name within type
    assert out.count("| 主线1 |") == 1


# ---------------------------------------------------------------------------
# audio + video
# ---------------------------------------------------------------------------
def test_generate_audio_links_only(wiki_tmp):
    gwp.generate_audio_index()
    out = _read(wiki_tmp["docs"], "audio.md")
    assert "音频资产" in out
    assert "morimens-audio-ogg-part1" in out


def test_generate_audio_inline(wiki_tmp):
    ad = wiki_tmp["docs"] / "public" / "audio" / "bgm"
    ad.mkdir(parents=True)
    (ad / "track.ogg").write_bytes(b"x")
    gwp.generate_audio_index()
    out = _read(wiki_tmp["docs"], "audio.md")
    assert "在线播放" in out
    assert "<audio controls" in out
    assert "track" in out


def test_generate_video_links_only(wiki_tmp):
    gwp.generate_video_index()
    out = _read(wiki_tmp["docs"], "video.md")
    assert "视频资产" in out
    assert "975 MB" in out


def test_generate_video_inline_categories(wiki_tmp):
    vd = wiki_tmp["docs"] / "public" / "video"
    vd.mkdir(parents=True)
    for fn in ["C00_intro.mp4", "CG_SD_x.mp4", "RD_scene.mp4",
               "Vx_demo.mp4", "Logo_a.mp4", "Login_PV.mp4",
               "AVG_t.mp4", "GN_Switch_a.mp4", "misc.mp4"]:
        (vd / fn).write_bytes(b"x")
    gwp.generate_video_index()
    out = _read(wiki_tmp["docs"], "video.md")
    assert "<video controls" in out
    assert "章节过场" in out
    assert "CG SD 动画" in out
    assert "RD 场景" in out
    assert "超维视频" in out
    assert "Logo" in out
    assert "登录 PV" in out
    assert "AVG 过渡" in out
    assert "场景过渡" in out
    assert "其他" in out


# ---------------------------------------------------------------------------
# panel text
# ---------------------------------------------------------------------------
def test_generate_panel_text(wiki_tmp):
    data = {
        "_meta": {"total_entries": 3, "total_categories": 2},
        "categories": {
            "Battle": [
                {"key": "PanelText_UI_Battle_Start", "value": "开始战斗"},
                {"key": "PanelText_Battle_End", "value": "x" * 130},
            ],
            "battle": [  # forces anchor dedup branch (.lower collision)
                {"key": "Other_Key", "value": "含|竖线\n含换行"},
            ],
        },
    }
    _wj(wiki_tmp["processed"] / "panel_text.json", data)
    gwp.generate_panel_text()
    out = _read(wiki_tmp["docs"], "panel-text.md")
    assert "UI 面板文本" in out
    assert "Battle_Start" in out  # prefix stripped
    assert "..." in out  # truncated long value
    assert "{#battle-1}" in out  # anchor collision suffix
    assert "/" in out  # pipe replaced


# ---------------------------------------------------------------------------
# update notices
# ---------------------------------------------------------------------------
def test_generate_update_notices_classification(wiki_tmp):
    long_full = "标题行\n" + ("详情段落。" * 100)
    data = {
        "_meta": {"total_entries": 8},
        "notices": [
            {"id": 1, "text": long_full},  # full note (newline + >400)
            {"id": 2, "text": "设施维护预计于今晚进行" + "x" * 5},  # maintenance
            {"id": 3, "text": "● 修复了一个崩溃问题"},  # bug fix
            {"id": 4, "text": "补偿物资已发放"},  # compensation (<200)
            {"id": 5, "text": "校猫 Light 的设计师手记内容"},  # feature note
            {"id": 6, "text": "活动规则说明，守密人可参与，" + "y" * 90},  # activity
            {"id": 7, "text": "短的零散公告"},  # other
            {"id": 8, "text": "{json should be filtered}"},  # filtered (starts {)
        ],
    }
    _wj(wiki_tmp["processed"] / "update_notices.json", data)
    gwp.generate_update_notices()
    out = _read(wiki_tmp["docs"], "update-notices.md")
    assert "更新公告" in out
    assert "完整版更新公告" in out
    assert "制作人与设计师手记" in out
    assert "维护通知" in out
    assert "问题修复记录" in out
    assert "补偿通知" in out
    assert "活动规则说明" in out
    assert "其他公告内容" in out
    assert "json should be filtered" not in out  # filtered out


def test_generate_update_notices_long_feature_note(wiki_tmp):
    data = {
        "_meta": {"total_entries": 1},
        "notices": [
            {"id": 10, "text": "设计师手记\n" + ("超长内容。" * 80)},
        ],
    }
    # newline + len>400 -> full_notes path, not feature. Use a non-newline long
    data["notices"] = [{"id": 10, "text": "设计师" + "内容内容" * 90}]
    _wj(wiki_tmp["processed"] / "update_notices.json", data)
    gwp.generate_update_notices()
    out = _read(wiki_tmp["docs"], "update-notices.md")
    assert "制作人与设计师手记" in out
    assert "<details>" in out  # long feature note collapses


# ---------------------------------------------------------------------------
# feature unlock
# ---------------------------------------------------------------------------
def test_generate_feature_unlock_missing(wiki_tmp, capsys):
    gwp.generate_feature_unlock()
    assert not (wiki_tmp["docs"] / "feature-unlock.md").exists()


def test_generate_feature_unlock(wiki_tmp):
    data = {
        "_meta": {"total_features": 3},
        "features": [
            {"feature_name": "唤\xa0醒", "lock_tip": "等级|5", "unlock_desc": "可召唤"},
            {"feature_name": "唤\xa0醒", "lock_tip": "等级|5", "unlock_desc": "可召唤"},  # dup
            {"feature_name": "无锁", "lock_tip": "", "unlock_desc": "x"},  # skipped
            {"feature_name": "有锁无后", "lock_tip": "条件", "unlock_desc": ""},
        ],
    }
    _wj(wiki_tmp["processed"] / "feature_unlock.json", data)
    gwp.generate_feature_unlock()
    out = _read(wiki_tmp["docs"], "feature-unlock.md")
    assert "功能解锁条件" in out
    assert "唤 醒" in out  # nbsp normalized
    assert "等级/5" in out  # pipe replaced
    assert "有锁无后" in out
    assert "| 有锁无后 | 条件 | — |" in out
    # dedup -> only one 唤 醒 row
    assert out.count("| 唤 醒 |") == 1


# ---------------------------------------------------------------------------
# potency
# ---------------------------------------------------------------------------
def test_generate_potency_missing(wiki_tmp):
    gwp.generate_potency()
    assert not (wiki_tmp["docs"] / "potency.md").exists()


def test_generate_potency(wiki_tmp):
    data = {
        "_meta": {"total_potencies": 4},
        "potencies": [
            {"id": 1, "name": "反击之刃", "desc": "「施与受」造成 <Key:反击> 伤害"},
            {"id": 2, "name": "反击之刃", "desc": "「施与受」造成 <Key:反击> 伤害"},  # dup
            {"id": 3, "name": "人格深化", "desc": ""},  # no desc -> skipped
            {"id": 4, "name": "甜蜜陷阱", "desc": "造成 [Arg1]% 反击\xa0伤害"},
        ],
    }
    _wj(wiki_tmp["processed"] / "potency.json", data)
    gwp.generate_potency()
    out = _read(wiki_tmp["docs"], "potency.md")
    assert "启灵效果词条" in out
    assert "造成 反击 伤害" in out  # <Key:反击> markup stripped to inner text
    assert "[Arg1]%" in out  # arg placeholder preserved
    assert "反击\xa0伤害" not in out  # nbsp normalized
    # empty-desc node skipped, dups collapsed -> one 反击之刃 row
    assert out.count("| 反击之刃 |") == 1
    assert "人格深化" not in out


# ---------------------------------------------------------------------------
# generate_runtime_data — W2 数据桥产物（2026-07-02 接回）
# ---------------------------------------------------------------------------
def test_generate_runtime_data_emits_bridge_json(wiki_tmp):
    docs = wiki_tmp["docs"]
    (docs / ".vitepress" / "theme" / "data").mkdir(parents=True)
    chars = [
        {"id": 15560, "name": "潘狄娅", "title": "潘狄娅", "category": "playable",
         "gender": "女", "voice_actor": "cv", "painter": "p",
         "introduction": "intro", "summon_slogan": "slogan"},
        {"id": 99999, "name": "某未上线", "title": "某称号", "category": "unreleased"},
    ]
    play = {"潘狄娅": {"realm": "chaos", "role": "攻击", "card": "x"}}
    gwp.generate_runtime_data(chars, play)
    out = json.loads((docs / ".vitepress" / "theme" / "data" /
                      "characters.runtime.json").read_text(encoding="utf-8"))
    assert len(out) == 2
    a, b = out
    # id/slug 为字符串（characters.ts 接口约定），playable 有详情页
    assert a["id"] == "15560" and a["slug"] == "15560"
    assert a["realm"] == "chaos" and a["role"] == "攻击"
    assert a["status"] == "playable" and a["has_page"] is True
    # 无玩法卡的未上线角色：realm/role 为 None、无详情页
    assert b["realm"] is None and b["role"] is None
    assert b["status"] == "unreleased" and b["has_page"] is False
    # 立绘位当前恒空（SLIM 部署无立绘资产），组件按 null 渲染占位符
    assert a["portraits"] == {"default": None, "awaker": None, "skins": []}


def test_generate_characters_page_mounts_grid(wiki_tmp):
    """图鉴页须挂载 <CharacterGrid />（组件层入口，W2 接回的用户可见面）。"""
    processed, docs = wiki_tmp["processed"], wiki_tmp["docs"]
    (docs / ".vitepress" / "theme" / "data").mkdir(parents=True)
    (docs / "zh").mkdir()
    _wj(processed / "characters.json", {
        "_meta": {"total_characters": 1, "source": "s", "generated": "g"},
        "characters": [{"id": 1, "name": "n", "title": "t", "category": "playable"}],
    })
    gwp.generate_characters()
    page = _read(docs, "characters.md")
    assert "<CharacterGrid />" in page
