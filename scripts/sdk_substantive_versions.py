#!/usr/bin/env python3
"""哪些版本对**你这个包的消费方**有实质变更（T70，守密人 2026-07-26 裁定）。

两包锁步同版（守密人 2026-07-18），代价实测：锁步纪元里 agent **4/18 = 22%**、
maestro **6/16 = 38%** 的版本是「本包零改动，只是家族对端发版了」。消费方按 `npm pack`
tarball 版本 pin（BPT 即如此），于是每个空转版本都是一次**无内容的重新 pin 判断**。

**锁步裁定本身不动**——同一份数据反证了需求档 §2「代理慢、编排快」的独立时钟原理由
（实测 18 vs 16，编排并不比代理快），故锁步是划算的。本脚本只做那条低成本改进：
把空转条目的措辞**固定成机器可识别的一句**，据此自动产出「对你有实质变更的版本」清单。

用法：

    python3 scripts/sdk_substantive_versions.py agent          # 人读清单
    python3 scripts/sdk_substantive_versions.py maestro --json # 机器读
    python3 scripts/sdk_substantive_versions.py --check        # 格式守卫（CI / pytest）

格式约定（唯一一条）：**空转条目的正文首行必须以 `Lockstep alignment only` 开头。**
其余条目一律视作实质变更。这条约定的守卫在 `tests/test_sdk_changelog_lockstep.py`——
它挡的不是「写得不好看」，是**用新措辞写空转条目**：那样脚本认不出来，清单会把一个
什么都没变的版本报成实质变更，消费方白 pin 一次，而清单看起来完全正常。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

CHANGELOGS = {
    "agent": REPO / "projects" / "silver-core-sdk" / "CHANGELOG.md",
    "maestro": REPO / "projects" / "silver-core-maestro-sdk" / "CHANGELOG.md",
}

#: 空转条目的规范开头。改这个常量 = 改约定，两处 CHANGELOG 与守卫须同步。
LOCKSTEP_PREFIX = "Lockstep alignment only"

#: 「这条其实是空转」的其他说法——用来抓「换个措辞写空转」的漂移。
#: 命中其一但**不以规范开头起头**的条目 = 格式违规。
_NOOP_HINTS = (
    re.compile(r"no changes to this package", re.I),
    # "No agent-side changes." / "no maestro-side change" —— 首次跑守卫即抓到 0.72.0
    # 用的正是这个说法（内容确是空转，措辞却非规范开头，自动清单把它误报成实质变更）。
    re.compile(r"\bno\s+\w+[- ]side\s+changes?\b", re.I),
    re.compile(r"\bno\s+\w+([- ]SDK)?\s+code\s+changes?\b", re.I),
    re.compile(r"本包\*{0,2}零代码改动"),
    re.compile(r"本包无改动"),
)

_HEADING = re.compile(r"^## (\d+\.\d+\.\d+)(?:\s+[—-]\s+(\S+))?\s*$", re.M)


@dataclass(frozen=True)
class Entry:
    version: str
    date: str | None
    lockstep_only: bool
    summary: str


def parse(path: Path) -> list[Entry]:
    text = path.read_text(encoding="utf-8")
    marks = list(_HEADING.finditer(text))
    out: list[Entry] = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        body = text[m.end():end].strip()
        first = next((ln.strip() for ln in body.splitlines() if ln.strip()), "")
        out.append(Entry(
            version=m.group(1),
            date=m.group(2),
            lockstep_only=first.startswith(LOCKSTEP_PREFIX),
            summary=first[:160],
        ))
    return out


def format_violations() -> list[str]:
    """措辞漂移：正文说了「本包没改」，却没用规范开头起头。"""
    bad: list[str] = []
    for key, path in CHANGELOGS.items():
        text = path.read_text(encoding="utf-8")
        marks = list(_HEADING.finditer(text))
        for i, m in enumerate(marks):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
            body = text[m.end():end]
            head = body[:400]
            first = next((ln.strip() for ln in body.splitlines() if ln.strip()), "")
            if first.startswith(LOCKSTEP_PREFIX):
                continue
            if any(rx.search(head) for rx in _NOOP_HINTS):
                bad.append(
                    f"{key} {m.group(1)}: 正文声称本包无改动，但首行未以 "
                    f"'{LOCKSTEP_PREFIX}' 起头，自动清单会把它误报成实质变更 —— 首行为 {first[:80]!r}"
                )
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("package", nargs="?", choices=sorted(CHANGELOGS), help="哪个包的消费方视角")
    ap.add_argument("--json", action="store_true", help="机器可读输出")
    ap.add_argument("--check", action="store_true", help="只做格式守卫，不出清单")
    ap.add_argument("--limit", type=int, default=20, help="人读清单最多列几条（默认 20）")
    args = ap.parse_args()

    if args.check:
        bad = format_violations()
        for line in bad:
            print(f"  ! {line}", file=sys.stderr)
        print(f"lockstep 措辞守卫：{'FAIL' if bad else 'OK'}（{len(bad)} 处违规）",
              file=sys.stderr if bad else sys.stdout)
        return 1 if bad else 0

    if args.package is None:
        ap.error("需要指定 package（或用 --check）")
    entries = parse(CHANGELOGS[args.package])
    substantive = [e for e in entries if not e.lockstep_only]
    if args.json:
        print(json.dumps({
            "package": args.package,
            "total": len(entries),
            "substantive": len(substantive),
            "lockstep_only": len(entries) - len(substantive),
            "versions": [
                {"version": e.version, "date": e.date, "summary": e.summary}
                for e in substantive[:args.limit]
            ],
        }, ensure_ascii=False, indent=2))
        return 0
    noop = len(entries) - len(substantive)
    print(f"{args.package}：{len(entries)} 个版本条目，其中 {noop} 个为锁步空转"
          f"（本包零改动，pin 了也没区别）。")
    print(f"对 {args.package} 消费方有实质变更的最近 {min(args.limit, len(substantive))} 个版本：\n")
    for e in substantive[:args.limit]:
        print(f"  {e.version:<10} {e.date or '':<12} {e.summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
