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


def test_summarize_aggregates_across_dated_files(tmp_path):
    """目录落点：跨多个按日 JSONL 聚合（方案甲跨会话累计的读取面）。"""
    d = tmp_path / "kb-usage"
    tel.log_call("kb_search", "沙耶", ["/characters/130226.md"], log_path=d / "2026-07-10.jsonl")
    tel.log_call("kb_activate", "discord", ["/community/community-discord.md"],
                 log_path=d / "2026-07-11.jsonl")
    rep = tel.summarize(log_path=d)
    assert rep["total_calls"] == 2
    assert rep["by_tool"] == {"kb_search": 1, "kb_activate": 1}


def test_default_log_path_is_git_tracked_dated_file():
    """方案甲纪律锁：默认落点在 git 内 Record/kb-usage/，不再是 gitignored Rough/。"""
    assert tel.KB_USAGE_DIR_DEFAULT == tel.REPO / "Public-Info-Pool" / "Record" / "kb-usage"
    assert "Rough" not in str(tel.KB_USAGE_DIR_DEFAULT)


def test_harvest_gaps_turns_zero_hits_into_held_out_candidates(tmp_path):
    """零命中查询回流成 held-out 难题候选（评判 #1↔#2 闭环）。"""
    log = tmp_path / "usage.jsonl"
    tel.log_call("kb_search", "命中的", ["/characters/130226.md"], log_path=log)
    tel.log_call("kb_search", "缸中之脑的哲学隐喻", [], log_path=log)     # 零命中·真难题
    tel.log_call("kb_activate", "某未覆盖概念xyz", [], log_path=log)       # 零命中
    tel.log_call("kb_search", "缸中之脑的哲学隐喻", [], log_path=log)     # 重复零命中（去重）

    h = tel.harvest_gaps(log_path=log)
    qs = {c["q"] for c in h["candidates"]}
    assert "缸中之脑的哲学隐喻" in qs and "某未覆盖概念xyz" in qs
    assert "命中的" not in qs                       # 命中的不回流
    assert h["count"] == 2                           # 去重后 2 条
    for c in h["candidates"]:
        assert c["capability"] == "held_out" and c["distinctive"] is True
        assert c["expect"] == [] and c["needs_triage"] is True
        assert c["source"] == "telemetry_zero_hit"


def test_harvest_gaps_empty_log_graceful(tmp_path):
    h = tel.harvest_gaps(log_path=tmp_path / "none.jsonl")
    assert h["count"] == 0 and h["candidates"] == []


def test_mcp_tools_wired_to_telemetry(tmp_path, monkeypatch):
    """MCP kb_* 工具真的接了埋点：调一次 kb_search，日志应落一条。"""
    # 重定向遥测落点目录到 tmp
    monkeypatch.setattr(tel, "KB_USAGE_DIR", tmp_path / "kb-usage")

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
    logs = list((tmp_path / "kb-usage").glob("*.jsonl"))
    assert logs, "MCP kb_search 未触发埋点"
    rec = json.loads(logs[0].read_text(encoding="utf-8").strip().splitlines()[-1])
    assert rec["tool"] == "kb_search"


# ---------- CLI 入口 / 报告渲染冒烟（main + --harvest 回流路径） ----------

def _seed_log(tmp_path):
    """造一份含命中 + 零命中的使用日志目录，供 main() 冒烟（返回目录=方案甲落点形态）。"""
    log = tmp_path / "kb-usage" / "2026-07-11.jsonl"
    tel.log_call("kb_search", "沙耶", ["/characters/130226.md"], log_path=log)
    tel.log_call("kb_search", "沙耶", ["/characters/130226.md"], log_path=log)
    tel.log_call("kb_search", "找不到的散句甲", [], log_path=log)
    tel.log_call("kb_activate", "找不到的散句乙", [], log_path=log)
    tel.log_call("kb_search", "找不到的散句甲", [], log_path=log)  # 重复零命中
    return log.parent


def test_main_report_prints_scorecard(tmp_path, monkeypatch, capsys):
    """main() 默认路径：打印人读报告（总调用 / 按工具 / 零命中 / 日志路径）。"""
    monkeypatch.setattr(tel, "KB_USAGE_DIR", _seed_log(tmp_path))
    monkeypatch.setattr(sys, "argv", ["kb_telemetry.py"])
    tel.main()
    out = capsys.readouterr().out
    assert "KB 使用遥测报告" in out
    assert "总调用 = 5" in out
    assert "kb_search" in out
    assert "最常触达" in out and "/characters/130226.md" in out
    assert "零命中查询" in out and "找不到的散句甲" in out
    assert "死概念" in out


def test_main_report_json(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(tel, "KB_USAGE_DIR", _seed_log(tmp_path))
    monkeypatch.setattr(sys, "argv", ["kb_telemetry.py", "--json"])
    tel.main()
    rep = json.loads(capsys.readouterr().out)
    assert rep["total_calls"] == 5
    assert rep["by_tool"]["kb_search"] == 4


def test_main_harvest_prints_candidates(tmp_path, monkeypatch, capsys):
    """--harvest 人读路径：零命中查询回流成 held-out 难题候选并打印。"""
    monkeypatch.setattr(tel, "KB_USAGE_DIR", _seed_log(tmp_path))
    monkeypatch.setattr(sys, "argv", ["kb_telemetry.py", "--harvest"])
    tel.main()
    out = capsys.readouterr().out
    assert "零命中回流：2 条" in out
    assert "找不到的散句甲" in out and "找不到的散句乙" in out
    assert "遥测管够难够真" in out  # note 尾注


def test_main_harvest_json_candidates_well_formed(tmp_path, monkeypatch, capsys):
    """--harvest --json 机读路径：候选字段齐、去重、expect 待分诊。"""
    monkeypatch.setattr(tel, "KB_USAGE_DIR", _seed_log(tmp_path))
    monkeypatch.setattr(sys, "argv", ["kb_telemetry.py", "--harvest", "--json"])
    tel.main()
    h = json.loads(capsys.readouterr().out)
    assert h["count"] == 2 and len(h["candidates"]) == 2
    qs = {c["q"]: c for c in h["candidates"]}
    assert set(qs) == {"找不到的散句甲", "找不到的散句乙"}
    assert qs["找不到的散句甲"]["seen"] == 2  # 重复零命中计数
    for c in h["candidates"]:
        assert c["expect"] == [] and c["needs_triage"] is True
        assert c["source"] == "telemetry_zero_hit" and c["mode"] == "search"


def test_main_harvest_empty_log(tmp_path, monkeypatch, capsys):
    """--harvest 空日志：0 候选、不炸。"""
    monkeypatch.setattr(tel, "KB_USAGE_DIR", tmp_path / "none-dir")
    monkeypatch.setattr(sys, "argv", ["kb_telemetry.py", "--harvest"])
    tel.main()
    assert "零命中回流：0 条" in capsys.readouterr().out


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
