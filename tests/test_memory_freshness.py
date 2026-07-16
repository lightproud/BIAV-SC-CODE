"""记忆档案不变量门禁（memory_freshness --gate 的 pytest 化身，随 required test 每 PR 把门）。

守护对象（守密人 2026-07-12「长期维护机制」裁定）：
- lessons 指针完整性：「已并入 #X」目标必须在役；「已迁档/已毕业」必须在归档层有全文；
  「案卷 #X」必须真实存在于归档层案卷区。
- 编号对账：维护说明「下一条 = #K」= 最高号 + 1（防 2026-07-12 盘点所修的记账漂移复发）。

保鲜阈值 / 头部日期错位等随时间变红的检查刻意不在此（避免无辜 PR 被「文档老了」挡下），
它们只进 `python3 scripts/memory_freshness.py` 巡检报告，由月检例程消费。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import memory_freshness as mf  # noqa: E402


def test_lessons_pointer_and_numbering_invariants():
    problems = mf.gate_problems()
    assert not problems, "记忆档案不变量破裂：\n" + "\n".join(problems)


def test_entry_parser_sees_all_kinds():
    entries = mf._entries(mf.LESSONS.read_text(encoding="utf-8"))
    kinds = {e["kind"] for e in entries.values()}
    assert {"active", "merged", "archived"} <= kinds, f"解析器未识别全部条目类别：{kinds}"
    assert len(entries) >= 40, f"条目解析数量异常（{len(entries)}），主档结构可能被改坏"


def test_full_report_builds():
    report = mf.build_report()
    assert "门禁级不变量" in report and "超龄档案" in report
