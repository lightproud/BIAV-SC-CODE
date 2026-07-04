"""KB 使用遥测测试（评判体系 #2）。

验证：log_call 写 JSONL、summarize 正确汇总（调用分布/触达/零命中/死概念）、
best-effort（坏路径不抛）、MCP 工具接了埋点。
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import kb_telemetry as tel  # noqa: E402


def test_log_call_writes_jsonl(tmp_path):
    log = tmp_path / "usage.jsonl"
    tel.log_call("kb_search", "沙耶", ["/characters/130226.md"], log_path=log)
    tel.log_call("kb_activate", "discord", ["/community/community-discord.md"], log_path=log)
    lines = log.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    rec = json.loads(lines[0])
    assert rec["tool"] == "kb_search" and rec["query"] == "沙耶"
    assert rec["n"] == 1 and rec["top"] == "/characters/130226.md"
    assert "ts" in rec


def test_log_call_best_effort_never_raises():
    # 不可写路径也不得抛出（埋点绝不拖垮工具）
    bad = Path("/proc/nonexistent-dir-xyz/usage.jsonl")
    tel.log_call("kb_search", "x", ["a"], log_path=bad)  # 不抛即通过


def test_summarize_aggregates(tmp_path):
    log = tmp_path / "usage.jsonl"
    tel.log_call("kb_search", "沙耶", ["/characters/130226.md"], log_path=log)
    tel.log_call("kb_search", "徐", ["/characters/125346.md", "/characters/130226.md"], log_path=log)
    tel.log_call("kb_search", "不存在xyz", [], log_path=log)  # 零命中
    tel.log_call("kb_activate", "discord", ["/community/community-discord.md"], log_path=log)

    rep = tel.summarize(log_path=log)
    assert rep["total_calls"] == 4
    assert rep["by_tool"]["kb_search"] == 3
    assert rep["by_tool"]["kb_activate"] == 1
    # 130226 触达 2 次
    reached = dict(rep["top_reached"])
    assert reached["/characters/130226.md"] == 2
    # 零命中查询被抓
    zero = dict(rep["zero_hit_queries"])
    assert "不存在xyz" in zero


def test_summarize_empty_log_graceful(tmp_path):
    rep = tel.summarize(log_path=tmp_path / "nope.jsonl")
    assert rep["total_calls"] == 0
    assert rep["by_tool"] == {}


def test_mcp_tools_wired_to_telemetry(tmp_path, monkeypatch):
    """MCP kb_* 工具真的接了埋点：调一次 kb_search，日志应落一条。"""
    # 重定向遥测日志到 tmp
    monkeypatch.setattr(tel, "KB_USAGE_LOG", tmp_path / "usage.jsonl")

    # 装 mcp stub 使 mcp_server 可导入
    if "mcp.server.fastmcp" not in sys.modules:
        class _FastMCP:
            def __init__(self, *_a, **_k): pass
            def tool(self, *_a, **_k):
                def _d(fn): return fn
                return _d
            def run(self, *_a, **_k): pass
        m = types.ModuleType("mcp"); s = types.ModuleType("mcp.server")
        f = types.ModuleType("mcp.server.fastmcp"); f.FastMCP = _FastMCP
        s.fastmcp = f; m.server = s
        sys.modules["mcp"] = m; sys.modules["mcp.server"] = s; sys.modules["mcp.server.fastmcp"] = f
    import mcp_server

    out = json.loads(mcp_server.kb_search("沙耶", limit=3))
    assert out.get("results")  # 检索本身正常
    log = tmp_path / "usage.jsonl"
    assert log.exists(), "MCP kb_search 未触发埋点"
    rec = json.loads(log.read_text(encoding="utf-8").strip().splitlines()[-1])
    assert rec["tool"] == "kb_search"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
