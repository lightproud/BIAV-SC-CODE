"""Coverage for mcp_server.py's ImportError fallback branch (lines 34-46).

When the `mcp` package is unavailable, the module prints its 4 tool definitions
as JSON to stdout and exits(0). We exercise that by loading the module source
under a throwaway name with a meta-path finder that forces `import
mcp.server.fastmcp` to raise ImportError — without disturbing the already
imported real/stubbed `mcp_server` used by the other tests.
"""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
MCP_SERVER_SRC = SCRIPTS / "mcp_server.py"


class _BlockMCPFinder:
    """Meta-path finder that makes any `mcp`/`mcp.*` import raise ImportError."""

    def find_spec(self, name, path=None, target=None):
        if name == "mcp" or name.startswith("mcp."):
            raise ImportError(f"blocked: {name}")
        return None


def test_import_error_fallback_lists_tools(capsys, monkeypatch):
    # Remove any cached mcp modules and install the blocking finder so the
    # try/except ImportError fallback runs.
    for mod in list(sys.modules):
        if mod == "mcp" or mod.startswith("mcp."):
            monkeypatch.delitem(sys.modules, mod, raising=False)

    finder = _BlockMCPFinder()
    monkeypatch.setattr(sys, "meta_path", [finder] + sys.meta_path)

    spec = importlib.util.spec_from_file_location("mcp_server_fallback_probe",
                                                  str(MCP_SERVER_SRC))
    module = importlib.util.module_from_spec(spec)

    with pytest.raises(SystemExit) as exc:
        spec.loader.exec_module(module)
    assert exc.value.code == 0

    out = capsys.readouterr()
    tools = json.loads(out.out)
    names = {t["name"] for t in tools}
    assert names == {"character_persona", "record_decision",
                     "record_lesson", "current_continuity"}
    # The fallback advisory lines go to stderr.
    assert "mcp package not installed" in out.err
