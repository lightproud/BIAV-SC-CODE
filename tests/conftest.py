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
    import kb_telemetry

    monkeypatch.setattr(kb_telemetry, "KB_USAGE_DIR", tmp_path / "kb-usage-isolated")
