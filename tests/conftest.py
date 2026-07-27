"""全局测试夹具。

遥测隔离（autouse）：借阅记录落点自 2026-07-11 方案甲起为 git-tracked
`Public-Info-Pool/Record/kb-usage/`（跨会话累计）。测试会大量调 MCP `kb_*`
工具与 `log_call`，若不改道会把测试跑动写进 git 数据——违背遥测「只记真实
消费、不记测试/CLI 跑动」的设计取舍。故所有测试默认把 `KB_USAGE_DIR` 指向
tmp；个别测试再自行 monkeypatch 时照常覆盖本夹具。

路径兜底（结构审视 P1，2026-07-27）：本仓 Python 侧不是包（无 pyproject、无
`__init__.py`），模块以裸 basename 互相 import，所以每个测试档都自报 sys.path。
2026-07-27 的 P3 迁档暴露了这套做法的隐患——8 个档的注入指着旧目录，全量跑却
照绿，因为 pytest 单进程共享 sys.path，先被收集的档已经替它们铺好了路；换个
收集顺序就会集体炸。这里把三个源目录一次性备齐，让**全量跑不再取决于收集顺序**。

这不是让各档的注入变成冗余：`python tests/test_x.py` 直跑不经过 conftest（70 个
档有 `__main__` 入口，抽检 8/8 可直跑），那条路仍靠各档自报。两者分管两个场景，
`tests/test_test_isolation.py` 守的正是「档内注入自身够不够」——它刻意不认
conftest 的兜底，否则守卫会被兜底喂成永远绿。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
for _src in ("scripts", "projects/news/scripts", "projects/wiki/scripts"):
    _p = str(REPO / _src)
    if _p not in sys.path:
        sys.path.insert(0, _p)


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
