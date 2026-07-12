#!/usr/bin/env python3
"""memory_freshness.py — 记忆档案保鲜巡检器（确定性零 ML 零常驻）。

守密人 2026-07-12 裁定「长期维护机制三件套」之机械守卫：
  1) 门禁级不变量（--gate，亦由 tests/test_memory_freshness.py 随 required test 每 PR 把门）：
     - lessons 指针完整性：主档「已并入 #X」的 X 必须是主档在役条目；
       「已迁档 / 已毕业」的编号必须在 lessons-archive.md 有全文；
       在役条目引用的「案卷 #X」必须在归档层案卷区真实存在。
     - 编号对账：维护说明「下一条 = #K」必须等于当前最高号 + 1（防头部/尾部记账漂移，
       即 2026-07-12 盘点所修的同款硬伤）。
  2) 报告级保鲜项（默认全报告；随时间变红，刻意不进门禁——避免无辜 PR 被「文档老了」挡下）：
     - 引用路径存在性：在役 lessons 与各 CONTEXT.md 中反引号仓内路径是否存在
       （含 ⚠ / 已删 / 已退役 / 历史 等标注的行跳过，归档层整体豁免——史实记录允许指向已删路径）。
     - 档案 git 龄：按档案类别阈值报「多久没人动了」。
     - 头部日期错位：档案「最后更新：YYYY-MM-DD」与 git 最后提交日差 >3 天即报。

消费方：/sync-memory 巡检手册步骤 A、记忆巡检月检例程、任何会话手动体检。
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LESSONS = REPO / "memory" / "lessons-learned.md"
ARCHIVE = REPO / "memory" / "lessons-archive.md"

ENTRY_RE = re.compile(r"^## (\d+乙?)\. (.+)$", re.M)
MERGED_RE = re.compile(r"已并入\s*#(\d+)")
CASEFILE_REF_RE = re.compile(r"案卷\s*#(\d+乙?)")
NEXT_NUM_RE = re.compile(r"下一条\s*=\s*#(\d+)")
DATE_HEADER_RE = re.compile(r"最后更新[：:]\s*(\d{4}-\d{2}-\d{2})")
BACKTICK_PATH_RE = re.compile(r"`([A-Za-z0-9_./\-]+/[A-Za-z0-9_./\-*]+)`")

# 路径存在性检查跳过标记：行内含任一即视为「历史陈述 / 已知已删」，不报
PATH_SKIP_MARKS = ("⚠", "已删", "已退役", "已冻结", "git 历史", "原 ", "旧", "案卷", "退役")

# 保鲜阈值（天）：报告级，超龄仅提示巡检会话去人工复核，不判错
STALENESS_RULES = [
    ("memory/project-status.md", 30),
    ("memory/todo.md", 45),
    ("memory/lessons-learned.md", 90),
    ("memory/methodology.md", 180),
    ("memory/active/*.md", 90),
    ("projects/*/CONTEXT.md", 120),
]


def _entries(text: str) -> dict[str, dict]:
    """解析 lessons 主档：编号 -> {title, body, kind}。kind ∈ active/merged/archived。"""
    out: dict[str, dict] = {}
    matches = list(ENTRY_RE.finditer(text))
    for i, m in enumerate(matches):
        num, title = m.group(1), m.group(2).strip()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[m.end():body_end]
        if "已并入" in title:
            kind = "merged"
        elif "已迁档" in title or "已毕业" in title:
            kind = "archived"
        else:
            kind = "active"
        out[num] = {"title": title, "body": body, "kind": kind}
    return out


def gate_problems() -> list[str]:
    """门禁级不变量。返回问题清单（空 = 绿）。"""
    problems: list[str] = []
    if not LESSONS.exists() or not ARCHIVE.exists():
        return [f"档案缺失：{LESSONS if not LESSONS.exists() else ARCHIVE}"]
    text = LESSONS.read_text(encoding="utf-8")
    archive = ARCHIVE.read_text(encoding="utf-8")
    entries = _entries(text)

    for num, e in entries.items():
        if e["kind"] == "merged":
            m = MERGED_RE.search(e["title"])
            if not m:
                problems.append(f"#{num} 标「已并入」但未写目标编号")
                continue
            target = m.group(1)
            t = entries.get(target)
            if t is None:
                problems.append(f"#{num} 已并入 #{target}，但主档无 #{target}")
            elif t["kind"] != "active":
                problems.append(f"#{num} 已并入 #{target}，但 #{target} 非在役条目（{t['kind']}）")
        elif e["kind"] == "archived":
            if not re.search(rf"^## {re.escape(num)}\. ", archive, re.M):
                problems.append(f"#{num} 标「已迁档/已毕业」，但 lessons-archive.md 无 ## {num}. 全文")
        else:  # active：案卷引用必须真实存在
            for cf in CASEFILE_REF_RE.findall(e["body"]):
                if f"### 案卷 #{cf}" not in archive:
                    problems.append(f"#{num} 引用「案卷 #{cf}」，但归档层案卷区无该卷")

    # 编号对账：下一条 = 最高号 + 1
    nums = [int(n.rstrip("乙")) for n in entries]
    m = NEXT_NUM_RE.search(text)
    if not m:
        problems.append("维护说明缺「下一条 = #K」记账行")
    elif nums and int(m.group(1)) != max(nums) + 1:
        problems.append(
            f"编号对账漂移：维护说明写「下一条 = #{m.group(1)}」，实际最高号 #{max(nums)}（应为 #{max(nums) + 1}）"
        )
    return problems


def _git_age_days(path: Path) -> int | None:
    try:
        ts = subprocess.run(
            ["git", "log", "-1", "--format=%ct", "--", str(path.relative_to(REPO))],
            capture_output=True, text=True, cwd=REPO, check=True,
        ).stdout.strip()
        if not ts:
            return None
        return (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromtimestamp(int(ts), dt.timezone.utc)).days
    except Exception:
        return None


def _git_last_date(path: Path) -> dt.date | None:
    try:
        ts = subprocess.run(
            ["git", "log", "-1", "--format=%ct", "--", str(path.relative_to(REPO))],
            capture_output=True, text=True, cwd=REPO, check=True,
        ).stdout.strip()
        return dt.datetime.fromtimestamp(int(ts), dt.timezone.utc).date() if ts else None
    except Exception:
        return None


def missing_paths() -> list[str]:
    """报告级：在役 lessons + CONTEXT.md 反引号仓内路径存在性（带跳过标记）。

    路径按三个基底解析，任一命中即视为存在：仓根 / 所在文件目录（CONTEXT 项目内相对路径）/
    社区归档根（news 的 source 标识 = 归档相对路径，2026-06-21 裁定）。
    """
    community = REPO / "Public-Info-Pool" / "Record" / "Community"
    out: list[str] = []
    files = [LESSONS] + sorted(REPO.glob("projects/*/CONTEXT.md"))
    for f in files:
        if not f.exists():
            continue
        for lineno, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if any(mark in line for mark in PATH_SKIP_MARKS):
                continue
            for raw in BACKTICK_PATH_RE.findall(line):
                if "*" in raw or "..." in raw or raw.startswith(("http", "~", "/")):
                    continue
                rel = raw.rstrip("/")
                bases = (REPO, f.parent, community)
                if not any((b / rel).exists() for b in bases):
                    out.append(f"{f.relative_to(REPO)}:{lineno} 引用不存在路径 `{raw}`")
    return out


def staleness() -> list[str]:
    out: list[str] = []
    for pattern, limit in STALENESS_RULES:
        for f in sorted(REPO.glob(pattern)):
            age = _git_age_days(f)
            if age is not None and age > limit:
                out.append(f"{f.relative_to(REPO)} 已 {age} 天未更新（阈值 {limit} 天）——巡检时人工复核其内容是否仍与现实一致")
    return out


def header_date_drift() -> list[str]:
    out: list[str] = []
    for f in sorted(REPO.glob("memory/*.md")) + [REPO / "CLAUDE.md"]:
        if not f.exists():
            continue
        m = DATE_HEADER_RE.search(f.read_text(encoding="utf-8")[:2000])
        if not m:
            continue
        try:
            header = dt.date.fromisoformat(m.group(1))
        except ValueError:
            out.append(f"{f.relative_to(REPO)} 头部日期非法：{m.group(1)}")
            continue
        last = _git_last_date(f)
        if last and abs((last - header).days) > 3:
            out.append(f"{f.relative_to(REPO)} 头部「最后更新 {header}」与 git 最后提交 {last} 相差 >3 天")
    return out


def build_report() -> str:
    lines = ["# 记忆档案保鲜巡检报告", ""]
    gate = gate_problems()
    lines.append(f"## 门禁级不变量（{'红 ' + str(len(gate)) + ' 项' if gate else '绿'}）")
    lines += [f"- [GATE] {p}" for p in gate] or ["- 指针完整性 / 编号对账 全部通过"]
    mp = missing_paths()
    lines += ["", f"## 引用路径存在性（{len(mp)} 项）"] + ([f"- {p}" for p in mp] or ["- 无失效引用"])
    st = staleness()
    lines += ["", f"## 超龄档案（{len(st)} 项，报告级）"] + ([f"- {p}" for p in st] or ["- 全部在保鲜期内"])
    hd = header_date_drift()
    lines += ["", f"## 头部日期错位（{len(hd)} 项，报告级）"] + ([f"- {p}" for p in hd] or ["- 无错位"])
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="记忆档案保鲜巡检器")
    ap.add_argument("--gate", action="store_true", help="只跑门禁级不变量，红则退出码 1")
    args = ap.parse_args()
    if args.gate:
        problems = gate_problems()
        for p in problems:
            print(f"[GATE] {p}")
        print(f"gate: {'RED ' + str(len(problems)) if problems else 'GREEN'}")
        return 1 if problems else 0
    print(build_report())
    return 0


if __name__ == "__main__":
    sys.exit(main())
