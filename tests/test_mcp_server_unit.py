"""Additional unit tests for mcp_server.py — write tools + persona branches.

We stub the `mcp` package (same approach as the existing smoke test) and stub
the underlying silver_memory_tools / character_persona helpers so no curated
archive is mutated.
"""

import json
import sys
import types
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"
sys.path.insert(0, str(SCRIPTS))


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


_install_mcp_stub()

import mcp_server  # noqa: E402
import silver_memory_tools  # noqa: E402


class TestRecordDecision:
    def test_returns_json_from_helper(self, monkeypatch):
        monkeypatch.setattr(silver_memory_tools, "record_decision",
                            lambda *a, **k: {"status": "ok", "line_added": "x"})
        out = json.loads(mcp_server.record_decision("s", "全局", "r"))
        assert out["status"] == "ok"
        assert out["line_added"] == "x"


class TestRecordLesson:
    def test_returns_json_from_helper(self, monkeypatch):
        monkeypatch.setattr(silver_memory_tools, "record_lesson",
                            lambda *a, **k: {"status": "ok", "lesson_id": "L99"})
        out = json.loads(mcp_server.record_lesson("summary", "ctx"))
        assert out["lesson_id"] == "L99"


class TestCharacterPersona:
    def test_greeting_branch(self):
        out = json.loads(mcp_server.character_persona(character="erica", action="greeting"))
        assert "greeting" in out
        assert out["character"] == "erica"

    def test_default_prompt_branch(self):
        out = json.loads(mcp_server.character_persona(character="erica"))
        assert "system_prompt" in out

    def test_unknown_character_returns_error(self):
        out = json.loads(mcp_server.character_persona(character="does-not-exist"))
        assert "error" in out
        assert "available" in out


class TestCurrentContinuity:
    def test_returns_json(self, monkeypatch):
        import character_persona  # noqa: F401
        monkeypatch.setattr(silver_memory_tools, "current_continuity",
                            lambda: {"topics_hint": []})
        out = json.loads(mcp_server.current_continuity())
        assert isinstance(out, dict)
