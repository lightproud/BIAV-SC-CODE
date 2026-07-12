"""全局测试夹具。

遥测隔离（autouse）：借阅记录落点自 2026-07-11 方案甲起为 git-tracked
`Public-Info-Pool/Record/kb-usage/`（跨会话累计）。测试会大量调 MCP `kb_*`
工具与 `log_call`，若不改道会把测试跑动写进 git 数据——违背遥测「只记真实
消费、不记测试/CLI 跑动」的设计取舍。故所有测试默认把 `KB_USAGE_DIR` 指向
tmp；个别测试再自行 monkeypatch 时照常覆盖本夹具。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))


@pytest.fixture(autouse=True)
def _isolate_kb_telemetry(tmp_path, monkeypatch):
    # mutmut 的 mutants/ 工作副本只复制被变异源 + tests，kb_telemetry 不在
    # 副本内（kb 工具不在变异区，无遥测可隔离）——导入不到即降级为无操作，
    # 不让隔离夹具反把变异跑批整个卡死。
    try:
        import kb_telemetry
    except ImportError:
        return

    monkeypatch.setattr(kb_telemetry, "KB_USAGE_DIR", tmp_path / "kb-usage-isolated")
