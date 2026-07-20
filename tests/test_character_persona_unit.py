"""Unit tests for scripts/character_persona.py.

Exercises persona loading, system-prompt building, greeting generation and the
CLI entrypoint with synthetic personas and the real (read-only) erica card.
"""

import json
import random
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import character_persona  # noqa: E402


# ------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------

def _full_persona():
    return {
        "id": "tester",
        "name": "测试者",
        "name_en": "Tester",
        "full_designation": "测试者·全称",
        "summon_slogan": "口号在此。",
        "affiliation": "测试阵营",
        "realm": "测试域",
        "version": "9.9.9",
        "identity": {
            "nature": "纯逻辑构造",
            "consciousness_layers": ["表层", "深层"],
            "core_conflict": "存在与虚无",
        },
        "personality": {
            "speech_patterns": ["平铺直叙", "术语化"],
            "emotional_range": {"平静": "默认", "警觉": "异常时"},
        },
        "knowledge_boundaries": {
            "knows": ["仓库结构", "测试约定"],
            "does_not_know": ["未来", "黑池内部"],
        },
        "relationships": {"守密人": "上级", "艾瑞卡": "同僚"},
        "voice_lines": {
            "greeting": ["你好，调查员。", "系统已就绪。"],
            "combat": ["开始战斗。", "目标锁定。", "第三句", "第四句"],
            "empty": [],
        },
        "prompt_guidelines": {
            "always": ["保持角色"],
            "occasionally": ["偶尔幽默"],
            "rarely": ["极少自嘲"],
            "never": ["绝不出戏"],
        },
        "system_persona_mapping": {
            "role_in_silver_core": "银芯助手",
            "role_in_black_pool": "黑池接口",
            "action_mappings": {"read": "读取档案", "write": "写入档案"},
        },
    }


def _write_persona(directory, persona):
    fp = directory / f"{persona['id']}.json"
    fp.write_text(json.dumps(persona, ensure_ascii=False), encoding="utf-8")
    return fp


@pytest.fixture
def patched_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(character_persona, "PERSONAS_DIR", tmp_path)
    return tmp_path


# ------------------------------------------------------------
# load_persona / list_personas
# ------------------------------------------------------------

def test_load_persona_missing_returns_none(patched_dir):
    assert character_persona.load_persona("nope") is None


def test_load_persona_ok(patched_dir):
    _write_persona(patched_dir, _full_persona())
    p = character_persona.load_persona("tester")
    assert p is not None
    assert p["name"] == "测试者"


def test_load_persona_bad_json_returns_none(patched_dir):
    (patched_dir / "broken.json").write_text("{not valid", encoding="utf-8")
    assert character_persona.load_persona("broken") is None


def test_list_personas_empty(patched_dir):
    assert character_persona.list_personas() == []


def test_list_personas_collects_and_sorts(patched_dir):
    a = _full_persona()
    a["id"] = "aaa"
    b = _full_persona()
    b["id"] = "bbb"
    _write_persona(patched_dir, b)
    _write_persona(patched_dir, a)
    out = character_persona.list_personas()
    ids = [p["id"] for p in out]
    assert ids == ["aaa", "bbb"]
    assert out[0]["version"] == "9.9.9"
    assert out[0]["affiliation"] == "测试阵营"


def test_list_personas_skips_bad(patched_dir):
    _write_persona(patched_dir, _full_persona())
    (patched_dir / "junk.json").write_text("nope", encoding="utf-8")
    # Missing required key "id"
    (patched_dir / "nokey.json").write_text(json.dumps({"name": "x"}), encoding="utf-8")
    out = character_persona.list_personas()
    assert [p["id"] for p in out] == ["tester"]


def test_list_personas_defaults_for_missing_optional(patched_dir):
    minimal = {"id": "m", "name": "极简"}
    _write_persona(patched_dir, minimal)
    out = character_persona.list_personas()
    assert out[0]["name_en"] == ""
    assert out[0]["version"] == "1.0.0"


# ------------------------------------------------------------
# build_system_prompt
# ------------------------------------------------------------

def test_build_system_prompt_full():
    out = character_persona.build_system_prompt(_full_persona(), context="检索中")
    assert "# 角色扮演：测试者" in out
    assert "测试者·全称" in out
    assert "口号在此。" in out
    assert "## 身份" in out
    assert "意识结构：" in out
    assert "- 表层" in out
    assert "存在与虚无" in out
    assert "## 说话方式" in out
    assert "- 平铺直叙" in out
    assert "## 情感状态" in out
    assert "**平静**：默认" in out
    assert "## 知识边界" in out
    assert "- 仓库结构" in out
    assert "- 未来" in out
    # silver_core mapping by default
    assert "银芯助手" in out
    assert "黑池接口" not in out
    assert "## 操作用语映射" in out
    assert "read -> 「读取档案」" in out
    assert "## 人际关系" in out
    assert "**守密人**：上级" in out
    assert "## 参考台词" in out
    assert "### greeting" in out
    # combat capped at 3 lines
    assert "> 第三句" in out
    assert "> 第四句" not in out
    # empty voice category skipped
    assert "### empty" not in out
    assert "## 扮演规则" in out
    assert "**始终遵守**：" in out
    assert "**偶尔表现**：" in out
    assert "**极少出现**：" in out
    assert "**绝不做**：" in out
    assert "## 当前上下文" in out
    assert "检索中" in out


def test_build_system_prompt_black_pool_role():
    out = character_persona.build_system_prompt(_full_persona(), platform="black_pool")
    assert "黑池接口" in out
    assert "银芯助手" not in out


def test_build_system_prompt_minimal():
    persona = {"name": "极简"}
    out = character_persona.build_system_prompt(persona)
    assert "# 角色扮演：极简" in out
    # default affiliation
    assert "未知" in out
    # No context section when context empty
    assert "## 当前上下文" not in out
    # No optional sections that depend on data
    assert "## 情感状态" not in out
    assert "## 人际关系" not in out


def test_build_system_prompt_no_context_section_when_blank():
    out = character_persona.build_system_prompt(_full_persona())
    assert "## 当前上下文" not in out


# ------------------------------------------------------------
# build_greeting
# ------------------------------------------------------------

def test_build_greeting_no_lines_default():
    persona = {"name": "无言"}
    assert character_persona.build_greeting(persona) == "无言已启动。"


def test_build_greeting_picks_from_lines(monkeypatch):
    monkeypatch.setattr(random, "choice", lambda seq: seq[0])
    persona = _full_persona()
    out = character_persona.build_greeting(persona)
    assert out == "你好，调查员。"


def test_build_greeting_black_pool_appends_role(monkeypatch):
    monkeypatch.setattr(random, "choice", lambda seq: seq[0])
    persona = _full_persona()
    out = character_persona.build_greeting(persona, platform="black_pool")
    assert "你好，调查员。" in out
    assert "（黑池接口）" in out


def test_build_greeting_black_pool_no_role(monkeypatch):
    monkeypatch.setattr(random, "choice", lambda seq: seq[0])
    persona = _full_persona()
    persona["system_persona_mapping"] = {}
    out = character_persona.build_greeting(persona, platform="black_pool")
    assert out == "你好，调查员。"


# ------------------------------------------------------------
# Real card (read-only)
# ------------------------------------------------------------

def test_real_erica_card_builds_prompt():
    persona = character_persona.load_persona("erica")
    assert persona is not None
    out = character_persona.build_system_prompt(persona)
    assert out.startswith("# 角色扮演：")
    assert "## 扮演规则" in out


# ------------------------------------------------------------
# CLI main()
# ------------------------------------------------------------

def test_main_list(patched_dir, monkeypatch, capsys):
    _write_persona(patched_dir, _full_persona())
    monkeypatch.setattr(sys, "argv", ["prog", "--list"])
    character_persona.main()
    out = capsys.readouterr().out
    assert "可用角色" in out
    assert "tester" in out


def test_main_list_empty(patched_dir, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["prog", "--list"])
    character_persona.main()
    assert "未找到角色人格数据" in capsys.readouterr().out


def test_main_no_args_usage(patched_dir, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["prog"])
    character_persona.main()
    assert "用法" in capsys.readouterr().out


def test_main_character_not_found(patched_dir, monkeypatch, capsys):
    _write_persona(patched_dir, _full_persona())
    monkeypatch.setattr(sys, "argv", ["prog", "--character", "ghost"])
    character_persona.main()
    out = capsys.readouterr().out
    assert "未找到角色：ghost" in out
    assert "可用角色：tester" in out


def test_main_character_not_found_no_available(patched_dir, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["prog", "--character", "ghost"])
    character_persona.main()
    out = capsys.readouterr().out
    assert "未找到角色：ghost" in out


def test_main_character_ok_with_context(patched_dir, monkeypatch, capsys):
    _write_persona(patched_dir, _full_persona())
    monkeypatch.setattr(
        sys, "argv", ["prog", "--character", "tester", "--context", "上下文XYZ"]
    )
    character_persona.main()
    out = capsys.readouterr().out
    assert "# 角色扮演：测试者" in out
    assert "上下文XYZ" in out
