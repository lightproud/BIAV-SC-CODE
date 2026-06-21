"""test_decisions_consistency.py —— 决策档案一致性硬不变量（CI 门禁）

把 scripts/check_decisions_consistency.py 的 5 条不变量挂进既有 pytest 管线，
PR 触碰 decisions*.md / CLAUDE.md 时由 test.yml 自动 gate。详见该脚本头注。
"""

import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import check_decisions_consistency as cdc  # noqa: E402


def test_decisions_consistency_all_pass():
    errors = cdc.check()
    assert errors == [], "决策档案一致性校验失败：\n" + "\n".join(errors)
