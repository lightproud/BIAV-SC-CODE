#!/usr/bin/env python3
"""check_decisions_consistency.py —— 决策档案一致性校验（把「祈祷同步」换成「机器盯同步」）

背景：decisions.md 在 CLAUDE.md §5.3 被定位为「决策溯源权威」，但它是 prompt 级弱约束，
非自动加载。历史上多次出现「决策改了、CLAUDE.md 没跟」「写入工具锚点失效污染表格」等
名实脱节（lesson #29 决策脱节款 / 2026-06-11 定位漂移）。本脚本把若干硬不变量交给 CI 盯，
PR 触碰 decisions*.md / CLAUDE.md 时自动校验，不一致即 fail。

纯 Python 标准库，无第三方依赖。可独立运行（返回退出码），也可被 pytest 导入。

校验项（5 条硬不变量）：
  C1 record_decision 插入锚点存在且唯一（缺失会让写入回退甚至污染后续子表）
  C2 「当前有效决策 / 全局」表是 3 列 schema（与 record_decision 写入列数对齐）
  C3 归档层 decisions-archive.md 存在（拆分后的溯源去处）
  C4 定位一致：CLAUDE.md 声明受限/非公开层，且 decisions.md 当前有效区不再残留「银芯（公开层）」定位
  C5 已删子系统路径（bpt-next / graphify-ext / occ-local）不出现在 decisions.md 当前有效区
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DECISIONS = REPO_ROOT / "memory" / "decisions.md"
ARCHIVE = REPO_ROOT / "memory" / "decisions-archive.md"
CLAUDE_MD = REPO_ROOT / "CLAUDE.md"

ANCHOR = "<!-- DECISIONS-INSERT-ANCHOR -->"
GLOBAL_TABLE_HEADER = "| 决策 | 影响范围 | 覆盖 |"
DELETED_PATHS = ("projects/bpt-next/", "projects/graphify-ext/", "projects/occ-local/")


def _active_section(text: str) -> str:
    """返回 decisions.md「当前有效」区（截到『## 决策历史归档』之前）。"""
    marker = "## 决策历史归档"
    idx = text.find(marker)
    return text if idx == -1 else text[:idx]


def check() -> list[str]:
    """执行全部校验，返回失败信息列表（空 = 全部通过）。"""
    errors: list[str] = []

    if not DECISIONS.exists():
        return [f"C0 决策档案不存在: {DECISIONS}"]
    dtext = DECISIONS.read_text(encoding="utf-8")
    active = _active_section(dtext)

    # C1 锚点存在且唯一
    n = dtext.count(ANCHOR)
    if n != 1:
        errors.append(f"C1 插入锚点 {ANCHOR} 应恰好出现 1 次，实际 {n} 次")

    # C2 全局表 3 列 schema
    if GLOBAL_TABLE_HEADER not in dtext:
        errors.append(f"C2 未找到全局表 3 列表头：{GLOBAL_TABLE_HEADER}（record_decision 写 3 列）")

    # C3 归档层存在
    if not ARCHIVE.exists():
        errors.append(f"C3 归档层不存在: {ARCHIVE}")

    # C4 定位一致
    if CLAUDE_MD.exists():
        ctext = CLAUDE_MD.read_text(encoding="utf-8")
        if "受限" not in ctext or "非公开" not in ctext:
            errors.append("C4 CLAUDE.md 未声明『受限 / 非公开层』定位（2026-06-11 裁定）")
    else:
        errors.append(f"C4 CLAUDE.md 不存在: {CLAUDE_MD}")
    if "银芯（公开层）" in active:
        errors.append("C4 decisions.md 当前有效区仍残留『银芯（公开层）』旧定位，应同步为受限/非公开层")

    # C5 已删子系统路径不在当前有效区
    for p in DELETED_PATHS:
        if p in active:
            errors.append(f"C5 已删子系统路径 `{p}` 出现在 decisions.md 当前有效区（应仅在归档层）")

    return errors


def main() -> int:
    errors = check()
    if errors:
        print("决策档案一致性校验 —— 失败：")
        for e in errors:
            print(f"  ✗ {e}")
        return 1
    print("决策档案一致性校验 —— 全部通过（C1-C5）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
