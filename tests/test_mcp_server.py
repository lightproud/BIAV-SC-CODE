"""Smoke tests for the trimmed BIAV-SC MCP server.

After the 2026-06-20 auto-memory retirement, mcp_server exposes only 4
platform-complementary tools: character_persona, record_decision,
record_lesson, current_continuity. We stub the `mcp` package so the tool
handlers are importable and testable without the real dependency, then
verify the kept tools are present and the read-only ones return well-formed
JSON. The write tools (record_decision/record_lesson) are not exercised here
to avoid mutating the curated archives.
"""

import json
import sys
import types
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _install_mcp_stub():
    """Install a minimal stub for the `mcp` package so mcp_server imports."""
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


class KeptToolsTest(unittest.TestCase):
    def test_exactly_four_kept_tools_present(self):
        for name in ("character_persona", "record_decision",
                     "record_lesson", "current_continuity"):
            self.assertTrue(callable(getattr(mcp_server, name, None)),
                            f"缺少保留工具 {name}")

    def test_retired_tools_absent(self):
        for name in ("memory_search", "graph_query", "memory_writeback",
                     "session_briefing", "recall_session", "session_progress",
                     "check_cache", "store_facts"):
            self.assertFalse(hasattr(mcp_server, name),
                             f"已退役工具 {name} 仍存在")

    def test_character_persona_list_returns_json(self):
        out = json.loads(mcp_server.character_persona(action="list"))
        self.assertIn("available_personas", out)

    def test_current_continuity_returns_json(self):
        out = json.loads(mcp_server.current_continuity())
        self.assertIsInstance(out, dict)


if __name__ == "__main__":
    unittest.main()
