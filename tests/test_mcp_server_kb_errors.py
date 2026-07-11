"""mcp_server kb_* 工具错误分支单测——「停电应急灯」契约。

MCP 是艾瑞卡的唯一动态平面（CLAUDE.md §1.4 第 5 条）。本档钉住的契约：
索引缺失（KBIndexMissing）时导航五件返回结构化 error JSON 而非抛异常；
向量/合流腿任意异常时降级（degraded=true + fallback 指引）而非崩工具面；
遥测 _log 自身炸掉绝不拖垮工具主路径。

复用 test_mcp_server_unit 的 mcp 桩策略（CI 不装 mcp 包）。
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

import kb_navigator  # noqa: E402
import kb_anchor as kb_anchor_mod  # noqa: E402
import kb_telemetry  # noqa: E402
import kb_vector  # noqa: E402
import mcp_server  # noqa: E402


def _raise_missing(*_a, **_k):
    raise kb_navigator.KBIndexMissing("kb_index.json 缺失——先跑 build_kb_index.py")


# ── 导航五件：索引缺失 → 结构化 error JSON，绝不抛异常 ──────────────────

NAV_TOOLS = [
    ("kb_search", "search", lambda: mcp_server.kb_search("沙耶")),
    ("kb_get", "get", lambda: mcp_server.kb_get("125346")),
    ("kb_neighbors", "neighbors", lambda: mcp_server.kb_neighbors("125346")),
    ("kb_activate", "activate", lambda: mcp_server.kb_activate("沙耶")),
    ("kb_overview", "overview", lambda: mcp_server.kb_overview()),
]


@pytest.mark.parametrize("tool_name,backend_fn,call", NAV_TOOLS,
                         ids=[t[0] for t in NAV_TOOLS])
def test_nav_tool_returns_error_json_when_index_missing(monkeypatch, tool_name, backend_fn, call):
    monkeypatch.setattr(kb_navigator, backend_fn, _raise_missing)
    out = call()  # 不得抛异常
    payload = json.loads(out)
    assert "error" in payload
    assert "kb_index" in payload["error"]


# ── 向量腿：任意异常 → 降级结构（degraded + fallback），绝不崩 ──────────

def test_kb_vector_search_degrades_on_backend_exception(monkeypatch):
    def _boom(*_a, **_k):
        raise RuntimeError("voyage connection refused")

    monkeypatch.setattr(kb_vector, "search", _boom)
    payload = json.loads(mcp_server.kb_vector_search("冰系奶妈被削"))
    assert payload["degraded"] is True
    assert "RuntimeError" in payload["reason"]
    assert "kb_search" in payload["fallback"]  # 降级必须给白盒回退指引
    assert payload["results"] == []


# ── 合流腿：单腿异常 → 降级结构，绝不崩工具面 ───────────────────────────

def test_kb_anchor_degrades_on_backend_exception(monkeypatch):
    def _boom(*_a, **_k):
        raise ValueError("aliases side-table corrupt")

    monkeypatch.setattr(kb_anchor_mod, "anchor_expand", _boom)
    payload = json.loads(mcp_server.kb_anchor("融朵怎么打"))
    assert payload["degraded"] is True
    assert "ValueError" in payload["reason"]
    assert payload["anchors"] == []


# ── 遥测 best-effort：_log 自身炸掉不拖垮工具 ───────────────────────────

def test_telemetry_failure_never_breaks_tool(monkeypatch):
    def _log_boom(*_a, **_k):
        raise OSError("disk full")

    monkeypatch.setattr(kb_telemetry, "log_call", _log_boom)
    monkeypatch.setattr(kb_navigator, "search",
                        lambda *a, **k: {"query": "q", "results": [{"id": "x"}]})
    payload = json.loads(mcp_server.kb_search("q"))
    assert payload["results"] == [{"id": "x"}]  # 主路径完好


def test_telemetry_failure_never_breaks_overview(monkeypatch):
    monkeypatch.setattr(kb_telemetry, "log_call",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("disk full")))
    monkeypatch.setattr(kb_navigator, "overview", lambda: {"stats": {"concepts": 1}})
    payload = json.loads(mcp_server.kb_overview())
    assert payload["stats"]["concepts"] == 1
