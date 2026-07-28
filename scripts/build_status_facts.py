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

# 子项目 CONTEXT.md 侧的版本标签块（2026-07-26 守密人「3 推进」裁定：招一射程从状态档
# 延伸到 CONTEXT）。背景：同日的跨档哨兵 tests/test_status_doc_facts.py 曾要求「最新版本号
# 必须出现在 CONTEXT.md 当前状态节」——那本质是要求人手抄一个会变的数字，与本脚本立身之本
# 相抵。改为生成后，该维度的漂移从「会被发现」升级为「不可能」。
# 块内**只放静态标签**（版本 / 发布日 / 锁步对端），规模数字不复制——要引用就指 project-status
# 的 STATUS-FACTS 块，同一事实不开第二张手抄表。
CONTEXT_BEGIN = (
    "<!-- CONTEXT-FACTS:BEGIN 机器生成，勿手改；重算 `python3 scripts/build_status_facts.py` -->"
)
CONTEXT_END = "<!-- CONTEXT-FACTS:END -->"
CONTEXT_ANCHOR = "## 当前状态"

PACKAGES = {
    "silver-core-agent-sdk": REPO / "projects" / "silver-core-sdk",
    "silver-core-maestro-sdk": REPO / "projects" / "silver-core-maestro-sdk",
    "silver-core-testbed": REPO / "projects" / "silver-core-testbed",
}

# 带 CONTEXT 版本块的包（testbed 是 private 消费者、锁步豁免、版本恒 0.0.0，无版本叙事可言，
# 故不发块——发了就是一行永不变化的噪音）。
CONTEXT_PACKAGES = ("silver-core-agent-sdk", "silver-core-maestro-sdk")

# CHANGELOG 发布标题：`## 0.76.0 — 2026-07-22`（破折号为全角 em dash）。日期可缺，缺则标注。
CHANGELOG_HEADING_RE = re.compile(r"^##\s+(\d+\.\d+\.\d+)\s*(?:—|--|-)?\s*(\d{4}-\d{2}-\d{2})?", re.MULTILINE)


def _pkg(path: Path) -> dict:
    return json.loads((path / "package.json").read_text(encoding="utf-8"))


def _latest_release(path: Path) -> tuple[str | None, str | None]:
    """该包 CHANGELOG 顶部第一条发布标题的 (版本, 日期)。散文里的版本提及不是 `## ` 标题，
    故不会被误当成最新发布——与 check-version-bump.mjs 同款判据。"""
    m = CHANGELOG_HEADING_RE.search((path / "CHANGELOG.md").read_text(encoding="utf-8"))
    return (m.group(1), m.group(2)) if m else (None, None)


def _count(pattern: str, root: Path) -> int:
    return sum(1 for _ in root.glob(pattern))


def _ledger_counts() -> tuple[int, int]:
    text = (REPO / "memory" / "todo.md").read_text(encoding="utf-8")
    body = text.split("## 开账", 1)[1]
    open_part, closed_part = body.split("## 已清", 1)
    row = re.compile(r"^\|\s*[TC]\d+\s*\|", re.MULTILINE)
    return len(row.findall(open_part)), len(row.findall(closed_part))


def render() -> str:
    versions = {name: _pkg(path)["version"] for name, path in PACKAGES.items()}
    agent, maestro, testbed = (PACKAGES[k] for k in PACKAGES)
    workflows = sorted((REPO / ".github" / "workflows").glob("*.yml"))
    scheduled = [p for p in workflows if re.search(r"^\s*-\s*cron:", p.read_text(encoding="utf-8"), re.MULTILINE)]
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


def render_context(pkg_name: str) -> str:
    """某包 CONTEXT.md 的版本标签块。

    刻意只含**标签**、不含叙事：叙事（「0.75.0 做了什么、堵的是什么」）是判断，生成不出来，
    仍由人写在块下方，并由 `tests/test_status_doc_facts.py` 守「叙述不得停在多版之前」。
    两者分工写死在块内提示行里，免得下一个会话把叙述也当成可生成物删掉。
    """
    path = PACKAGES[pkg_name]
    version = _pkg(path)["version"]
    latest, released = _latest_release(path)
    sibling = "silver-core-maestro-sdk" if pkg_name == "silver-core-agent-sdk" else "silver-core-agent-sdk"
    sibling_version = _pkg(PACKAGES[sibling])["version"]

    # CHANGELOG 顶部与 package.json 不符时**照实呈现**，不静默取其一：这正是
    # check-version-bump.mjs 三方对账要红的情形，生成器不该替它遮丑。
    if latest is None:
        release_line = "（`CHANGELOG.md` 无发布标题——异常，查台账）"
    elif latest != version:
        release_line = f"（⚠ `CHANGELOG.md` 顶部为 `{latest}`，与 package.json 不符——跑版本守卫）"
    elif released is None:
        release_line = "（发布日缺失于 CHANGELOG 标题）"
    else:
        release_line = f"发布日 {released}"

    return "\n".join(
        [
            CONTEXT_BEGIN,
            "",
            f"**当前版本 `{version}`** · {release_line} · 家族锁步对端 `{sibling}` = `{sibling_version}`",
            "",
            "> 本行由 `scripts/build_status_facts.py` 从 `package.json` + `CHANGELOG.md` 生成，"
            "**勿手改**；规模数字不在此列，指 `memory/project-status.md` 的 STATUS-FACTS 块。"
            "下方叙述由人写（「这一版做了什么」是判断、生成不出来），其**新鲜度**由"
            "`tests/test_status_doc_facts.py` 守。",
            "",
            CONTEXT_END,
        ]
    )


def _splice(doc: str, block: str, begin: str, end: str, anchor: str, after_anchor: bool) -> str | None:
    """把 block 换进 doc 的既有标记之间；无标记则按 anchor 首次落块。锚点缺失返回 None。"""
    if begin in doc and end in doc:
        head, tail = doc.split(begin, 1)
        _, rest = tail.split(end, 1)
        return head + block + rest
    if anchor not in doc:
        return None
    if after_anchor:
        return doc.replace(anchor, anchor + "\n\n" + block, 1)
    return doc.replace(anchor, block + "\n\n" + anchor, 1)


def _targets() -> list[tuple[Path, str]]:
    """(档案路径, 期望内容) 全清单——状态档 + 各包 CONTEXT。"""
    out: list[tuple[Path, str]] = []
    doc = STATUS_DOC.read_text(encoding="utf-8")
    spliced = _splice(doc, render(), BEGIN, END, "## 子项目状态", after_anchor=False)
    if spliced is None:
        raise SystemExit("未找到锚点「## 子项目状态」，无法插入 STATUS-FACTS 块")
    out.append((STATUS_DOC, spliced))
    for name in CONTEXT_PACKAGES:
        ctx = PACKAGES[name] / "CONTEXT.md"
        text = ctx.read_text(encoding="utf-8")
        spliced = _splice(
            text, render_context(name), CONTEXT_BEGIN, CONTEXT_END, CONTEXT_ANCHOR, after_anchor=True
        )
        if spliced is None:
            raise SystemExit(f"{ctx.relative_to(REPO)} 未找到锚点「{CONTEXT_ANCHOR}」，无法插入")
        out.append((ctx, spliced))
    return out


def apply(check_only: bool = False) -> int:
    stale: list[Path] = []
    for path, expected in _targets():
        if path.read_text(encoding="utf-8") == expected:
            continue
        stale.append(path)
        if not check_only:
            path.write_text(expected, encoding="utf-8")

    if not stale:
        print("状态事实块已是最新（状态档 + 各包 CONTEXT）")
        return 0
    names = " / ".join(str(p.relative_to(REPO)) for p in stale)
    if check_only:
        print(
            f"事实块与权威源不同步（{names}）：跑 `python3 scripts/build_status_facts.py` 重算",
            file=sys.stderr,
        )
        return 1
    print(f"已更新机器生成事实块：{names}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="生成 project-status.md 与各包 CONTEXT.md 的机器事实块"
    )
    parser.add_argument("--check", action="store_true", help="只比对不写，不同步则非零退出")
    args = parser.parse_args(argv)
    return apply(check_only=args.check)


if __name__ == "__main__":
    sys.exit(main())
