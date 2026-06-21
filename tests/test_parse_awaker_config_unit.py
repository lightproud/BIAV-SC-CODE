"""Additional unit tests for parse_awaker_config.py — high-level parsers + main()."""

import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import parse_awaker_config as pac  # noqa: E402


def _block(entries):
    """Build a Lua indexed-block table that parse_lua_table can read."""
    lines = ["local T = {"]
    for eid, fields in entries.items():
        lines.append(f"    [{eid}] = {{")
        for k, v in fields:
            lines.append(f'        {k} = "{v}",')
        lines.append("    },")
    lines.append("}")
    return "\n".join(lines) + "\n"


@pytest.fixture
def lua_dir(tmp_path, monkeypatch):
    d = tmp_path / "lua_tables"
    d.mkdir()
    out = tmp_path / "processed"
    monkeypatch.setattr(pac, "LUA_DIR", str(d))
    monkeypatch.setattr(pac, "OUT_DIR", str(out))
    return d


def _w(d, name, text):
    (d / name).write_text(text, encoding="utf-8")


class TestParseAwakerConfig:
    def test_builds_character_records(self, lua_dir):
        _w(lua_dir, "AwakerConfig.lua", _block({10: [
            ("Name", "潘狄娅"), ("Title", "标题"), ("Gender", "女"),
            ("Introduction", "first"), ("Introduction", "second"),
            ("AwakerIntroduction", "玩法A"), ("AwakerIntroduction", "玩法B"),
            ("SummonSlogan", "<b>登场</b>"),
        ]}))
        chars = pac.parse_awaker_config()
        assert chars[0]["id"] == 10
        assert chars[0]["name"] == "潘狄娅"
        # Introduction list -> last element
        assert chars[0]["introduction"] == "second"
        # AwakerIntroduction list -> first element
        assert chars[0]["gameplay_intro"] == "玩法A"
        assert chars[0]["summon_slogan"] == "登场"


class TestParseSummon:
    def test_builds_banners(self, lua_dir):
        _w(lua_dir, "Summon.lua", _block({1: [
            ("Name", "卡池"), ("ProbabilityUpDesc", "<color=#fff>玛修</color>"),
        ]}))
        banners = pac.parse_summon()
        assert banners[0]["rate_up"] == "玛修"


class TestParseStages:
    def test_stages_and_groups(self, lua_dir):
        _w(lua_dir, "Stage.lua", _block({5: [("Name", "关卡"), ("Desc", "描述")]}))
        _w(lua_dir, "StageGroup.lua", _block({2: [
            ("Name", "章节"), ("TypeText", "主线"),
            ("StageGroupRewardDescription", "奖励")]}))
        stages, groups = pac.parse_stages()
        assert stages[0]["name"] == "关卡"
        assert groups[0]["type"] == "主线"
        assert groups[0]["reward_desc"] == "奖励"


class TestParsePotency:
    def test_potency_list_desc(self, lua_dir):
        _w(lua_dir, "AwakerPotency.lua", _block({3: [
            ("PotencyName", "潜能"), ("PotencyDesc", "d1"), ("PotencyDesc", "d2")]}))
        pots = pac.parse_potency()
        assert pots[0]["desc"] == "d1"  # list -> first


class TestParseTasks:
    def test_tasks(self, lua_dir):
        _w(lua_dir, "Task.lua", _block({1: [("Name", "任务"), ("Desc", "做事")]}))
        tasks = pac.parse_tasks()
        assert tasks[0]["name"] == "任务"


class TestParseFeatureUnlock:
    def test_features(self, lua_dir):
        _w(lua_dir, "FeatureUnlock.lua", _block({1: [
            ("FeatureName", "功能"), ("LockTip", "锁"), ("UnlockDesc", "解")]}))
        feats = pac.parse_feature_unlock()
        assert feats[0]["feature_name"] == "功能"


class TestParsePanelText:
    def test_categories(self, lua_dir):
        _w(lua_dir, "PanelText.lua",
           'local T = {\n'
           '    ["PanelText_UI_Battle_Hint"] = "战斗提示",\n'
           '    ["PanelText_Shop_Buy"] = "购买",\n'
           '    ["NoPrefix"] = "其他",\n'
           '}\n')
        entries = pac.parse_panel_text()
        cats = {e["key"]: e["category"] for e in entries}
        assert cats["PanelText_UI_Battle_Hint"] == "Battle"
        assert cats["PanelText_Shop_Buy"] == "Shop"
        assert cats["NoPrefix"] == "NoPrefix"


class TestParseLanguageConfig:
    def test_strips_cn_suffix(self, lua_dir):
        _w(lua_dir, "LanguageConfig.lua",
           'local T = {\n'
           '    ["Hello_CN"] = "你好",\n'
           '    ["Plain"] = "普通",\n'
           '}\n')
        entries = pac.parse_language_config()
        m = {e["key"]: e["display_key"] for e in entries}
        assert m["Hello_CN"] == "Hello"
        assert m["Plain"] == "Plain"


class TestParseUpdateNotices:
    def test_indexed(self, lua_dir):
        _w(lua_dir, "UpdateNotices.lua",
           'local T = {\n'
           '    [1] = "公告",\n'
           '}\n')
        entries = pac.parse_update_notices()
        assert entries[0] == {"id": 1, "text": "公告"}


class TestMain:
    def test_main_writes_all_outputs(self, lua_dir, monkeypatch):
        # minimal fixtures for every parser main() touches
        _w(lua_dir, "AwakerConfig.lua", _block({1: [("Name", "A")]}))
        _w(lua_dir, "Summon.lua", _block({1: [("Name", "B")]}))
        _w(lua_dir, "Stage.lua", _block({1: [("Name", "C")]}))
        _w(lua_dir, "StageGroup.lua", _block({1: [("Name", "D")]}))
        _w(lua_dir, "AwakerPotency.lua", _block({1: [("PotencyName", "E")]}))
        _w(lua_dir, "Task.lua", _block({1: [("Name", "F")]}))
        _w(lua_dir, "FeatureUnlock.lua", _block({1: [("FeatureName", "G")]}))
        _w(lua_dir, "PanelText.lua", 'local T = {\n    ["PanelText_X_Y"] = "z",\n}\n')
        _w(lua_dir, "LanguageConfig.lua", 'local T = {\n    ["K_CN"] = "v",\n}\n')
        _w(lua_dir, "UpdateNotices.lua", 'local T = {\n    [1] = "n",\n}\n')

        pac.main()

        out = Path(pac.OUT_DIR)
        for fname in ("characters.json", "summon.json", "stages.json",
                      "potency.json", "tasks.json", "feature_unlock.json",
                      "panel_text.json", "language_config.json", "update_notices.json"):
            assert (out / fname).exists(), fname
        chars = json.loads((out / "characters.json").read_text())
        assert chars["_meta"]["total_characters"] == 1
