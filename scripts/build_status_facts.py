#!/usr/bin/env python3
"""状态档机器生成事实块 —— 「会变的数字不许手抄」。

2026-07-26 审视会话实测：`memory/project-status.md` 自称「状态唯一权威」，SDK 行却写着
v0.63.1 而实际已是 0.76.0——滞后 13 个次版本、9 天；同日回填的一处变异地板数字在写下时
就已过期。两处同因：**会变的事实被手抄进档案**（抗漂移提案 §1 第一因）。

本脚本把这类事实改为**从权威源生成**（提案 §2 招一）：版本取 `package.json`、
规模取磁盘实况、台账条数取 `todo.md`。人只写判断，不写数字。

纪律：块内**不含时间戳**——它是仓库当前状态的纯函数，故守卫测试可以重算逐字比对；
掺入 `generated_at` 会让块每次重算都变，反而没法比。「这份状态多旧」由 git 记录回答。

用法：
    python3 scripts/build_status_facts.py            # 就地更新块
    python3 scripts/build_status_facts.py --check    # 只比对，不写（CI / 测试用）
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
STATUS_DOC = REPO / "memory" / "project-status.md"
BEGIN = "<!-- STATUS-FACTS:BEGIN 机器生成，勿手改；重算 `python3 scripts/build_status_facts.py` -->"
END = "<!-- STATUS-FACTS:END -->"

PACKAGES = {
    "silver-core-agent-sdk": REPO / "projects" / "silver-core-sdk",
    "silver-core-maestro-sdk": REPO / "projects" / "silver-core-maestro-sdk",
    "silver-core-testbed": REPO / "projects" / "silver-core-testbed",
}


def _pkg(path: Path) -> dict:
    return json.loads((path / "package.json").read_text(encoding="utf-8"))


def _count(pattern: str, root: Path) -> int:
    return sum(1 for _ in root.glob(pattern))


def _ledger_counts() -> tuple[int, int]:
    text = (REPO / "memory" / "todo.md").read_text(encoding="utf-8")
    body = text.split("## 开账", 1)[1]
    open_part, closed_part = body.split("## 已清", 1)
    row = re.compile(r"^\|\s*[TC]\d+\s*\|", re.M)
    return len(row.findall(open_part)), len(row.findall(closed_part))


def render() -> str:
    versions = {name: _pkg(path)["version"] for name, path in PACKAGES.items()}
    agent, maestro, testbed = (PACKAGES[k] for k in PACKAGES)
    workflows = sorted((REPO / ".github" / "workflows").glob("*.yml"))
    scheduled = [p for p in workflows if re.search(r"^\s*-\s*cron:", p.read_text(encoding="utf-8"), re.M)]
    open_rows, closed_rows = _ledger_counts()

    lines = [
        BEGIN,
        "",
        "### 机器生成事实（版本 / 规模 / 台账）",
        "",
        "> 本块由 `scripts/build_status_facts.py` 从权威源生成，`tests/test_status_facts.py` 守同步。",
        "> **勿手抄这些数字到别处**——要引用就指这里（2026-07-26 抗漂移裁定，提案招一）。",
        "> 测试**通过数**不在此列：那要真跑才知道，属实测记录、随文注明日期，不是静态事实。",
        "",
        "| 事实 | 值 | 权威源 |",
        "|------|----|--------|",
        f"| Silver Core Agent SDK 版本 | `{versions['silver-core-agent-sdk']}` | `projects/silver-core-sdk/package.json` |",
        f"| Silver Core Maestro SDK 版本 | `{versions['silver-core-maestro-sdk']}` | `projects/silver-core-maestro-sdk/package.json`（与 agent 锁步同号）|",
        f"| testbed 试金石 | `{versions['silver-core-testbed']}`（private，永不发布）| `projects/silver-core-testbed/package.json` |",
        f"| agent SDK 源文件 / 测试档 | {_count('src/**/*.ts', agent)} / {_count('tests/**/*.test.ts', agent)} | 磁盘实况 |",
        f"| maestro SDK 源文件 / 测试档 | {_count('src/**/*.ts', maestro)} / {_count('tests/**/*.test.ts', maestro)} | 磁盘实况 |",
        f"| testbed 源文件 / 测试档 | {_count('src/*.mjs', testbed)} / {_count('tests/*.test.mjs', testbed)} | 磁盘实况 |",
        f"| Python 测试档 | {_count('tests/test_*.py', REPO)} | 磁盘实况 |",
        f"| CI 工作流 / 其中定时 | {len(workflows)} / {len(scheduled)} | `.github/workflows/` |",
        f"| 挂账台账 开 / 已清 | {open_rows} / {closed_rows} | `memory/todo.md` |",
        "",
        END,
    ]
    return "\n".join(lines)


def apply(check_only: bool = False) -> int:
    doc = STATUS_DOC.read_text(encoding="utf-8")
    block = render()
    if BEGIN in doc and END in doc:
        start, tail = doc.split(BEGIN, 1)
        _, rest = tail.split(END, 1)
        updated = start + block + rest
    else:
        # 首次落块：插在「## 子项目状态」之前——读者看表之前先看到硬数字
        anchor = "## 子项目状态"
        if anchor not in doc:
            print("未找到锚点「## 子项目状态」，无法插入", file=sys.stderr)
            return 2
        updated = doc.replace(anchor, block + "\n\n" + anchor, 1)

    if updated == doc:
        print("状态事实块已是最新")
        return 0
    if check_only:
        print("状态事实块与权威源不同步：跑 `python3 scripts/build_status_facts.py` 重算", file=sys.stderr)
        return 1
    STATUS_DOC.write_text(updated, encoding="utf-8")
    print(f"已更新 {STATUS_DOC.relative_to(REPO)} 的机器生成事实块")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成 project-status.md 的机器事实块")
    parser.add_argument("--check", action="store_true", help="只比对不写，不同步则非零退出")
    args = parser.parse_args(argv)
    return apply(check_only=args.check)


if __name__ == "__main__":
    sys.exit(main())
