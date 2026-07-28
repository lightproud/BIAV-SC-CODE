#!/usr/bin/env python3
"""产出↔消费对账 —— 「没人读的产物，该退役而不是被更好地监控」。

2026-07-26 第一轮审视的结论（守密人裁定「装产出↔消费对账」）：银芯有 20+ 个定时机制
在产数据，却**没有任何东西回答「谁在读」**。代价当天可见——`backfill-media` 停摆 **35 天**
无人察觉：若它的产物真被消费，早该有人喊。

**设计取舍：静态引用图，不做运行时埋点。**
银芯的消费绝大多数是**结构性**的（脚本读某路径 / 工作流喂某脚本 / 档案指某产物），
静态可判、当天出数。运行时埋点要有人记得开、要等数据——`kb_telemetry.py` 已实证该路
会变成空登记本（工具在、`Record/kb-usage/` 零条）。本脚本因此只读仓库文本，零配置、
零常驻、不依赖任何人记得。

**诚实边界（务必随报告一起读）**：静态图看不见
① 守密人本人翻阅报告；② 会话内艾瑞卡按需读档案；③ 黑池侧消费（防火墙外，结构上不可见）。
故输出是**候选清单供人裁**，绝不是自动退役触发器。零消费者 = 「值得问一句还要不要」，
不等于「可以删」。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WORKFLOW_DIR = REPO / ".github" / "workflows"
REPORT_PATH = REPO / "Public-Info-Pool" / "Record" / "heartbeat" / "consumption.json"

# 审计器自身及其产物不算消费者——「生产者自引不算消费」的同一条原则，只是主体换成审计器。
# 2026-07-26 实测踩到：本审计的报告里列着每条产出路径，下一轮 git grep 就把自己的报告
# 当成消费者；更糟的是**本审计的单测**用真实路径当夹具，直接把 verdict 翻成 consumed。
# 一个自己给自己作证的审计，比没有审计更坏。
SELF_PATHS = {
    "Public-Info-Pool/Record/heartbeat/consumption.json",
    "scripts/consumption_audit.py",
    "tests/test_consumption_audit.py",
}

# 产出声明：工作流里 `git add <路径...>` 与 `gh release upload <tag>`。
GIT_ADD_RE = re.compile(r"^\s*git add\s+(.+)$", re.M)
RELEASE_RE = re.compile(r"gh release upload\s+\"?([A-Za-z][\w.-]*)\"?", re.M)
# 消费面：按文件类型分档，判「谁在读」时权重不同（代码 > 工作流 > 档案）。
CONSUMER_GLOBS = {
    "script": ["scripts/**/*.py", "projects/**/scripts/**/*.py", "projects/**/src/**/*.mjs"],
    "workflow": [".github/workflows/*.yml"],
    "test": ["tests/**/*.py"],
    "doc": ["*.md", "memory/**/*.md", "projects/*/CONTEXT.md", ".claude/**/*.md"],
}


def produced_paths() -> dict[str, list[str]]:
    """{产出路径: [声明它的工作流...]}。`git add -A` 无信息量，跳过。"""
    produced: dict[str, list[str]] = {}
    for wf in sorted(WORKFLOW_DIR.glob("*.yml")):
        text = wf.read_text(encoding="utf-8")
        for line in GIT_ADD_RE.findall(text):
            for token in line.split():
                if token.startswith("-"):  # -A / --all 等旗标：范围不明，无从对账
                    continue
                path = token.strip().rstrip("/")
                if not path or path.startswith("$"):
                    continue
                produced.setdefault(path, []).append(wf.name)
    return produced


def produced_releases() -> dict[str, list[str]]:
    """{release tag: [上传它的工作流...]}。"""
    out: dict[str, list[str]] = {}
    for wf in sorted(WORKFLOW_DIR.glob("*.yml")):
        for tag in RELEASE_RE.findall(wf.read_text(encoding="utf-8")):
            if tag and not tag.startswith("$"):
                out.setdefault(tag, []).append(wf.name)
    return out


def _grep(needle: str) -> list[str]:
    """全仓字面量检索，返回 `path:line`。用 git grep：只看被跟踪文件，不扫产物本身。"""
    try:
        res = subprocess.run(
            ["git", "grep", "-n", "-F", needle],
            cwd=REPO, capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [ln for ln in res.stdout.splitlines() if ln.strip()]


def _classify(hit_path: str) -> str:
    if hit_path.startswith(".github/workflows/"):
        return "workflow"
    if hit_path.startswith("tests/"):
        return "test"
    if hit_path.endswith((".py", ".mjs", ".ts")):
        return "script"
    if hit_path.endswith(".md"):
        return "doc"
    return "other"


def audit_one(artifact: str, producers: list[str]) -> dict:
    """一件产出的消费面。生产者自身的引用不算消费——自己写自己不叫有人读。"""
    kinds: dict[str, list[str]] = {}
    for hit in _grep(artifact):
        hit_path = hit.split(":", 1)[0]
        if hit_path in {f".github/workflows/{p}" for p in producers} or hit_path in SELF_PATHS:
            continue
        kinds.setdefault(_classify(hit_path), []).append(hit)
    code_side = sum(len(kinds.get(k, [])) for k in ("script", "workflow", "test"))
    via: str | None = None
    if code_side:
        verdict = "consumed"
    else:
        # 解析器盲区（本审计最重要的一条自我修正）：银芯纪律要求读侧经单一真相源
        # 取路径（`archive_layout.community_root()` 等），于是**越守纪律的路径越不会
        # 以字面量出现**，字面量法会把它们全判成无人读。故沿父路径回溯：父级若有代码
        # 消费，说明该产物经解析器被读到，标 parent-consumed 而非 orphan。
        # **只回溯一级**。首版无限上溯，结果把一切都吸收成 parent-consumed（零消费
        # 7 件 → 0 件）——任何路径的祖先里总有个被代码提到的项目目录，守卫过度宽容
        # 等于没有守卫。一级足以覆盖真实的解析器形态（`.../discord/jp` 经
        # `archive_layout` 拿到的是 `.../discord`），再往上就是猜。
        parent = str(Path(artifact).parent)
        phits = (
            [
                h for h in _grep(parent)
                if _classify(h.split(":", 1)[0]) in ("script", "test")
                and h.split(":", 1)[0] not in SELF_PATHS
            ]
            if parent not in (".", "/", "")
            else []
        )
        if phits:
            verdict, via = "parent-consumed", parent
        else:
            # 构造式路径盲区（第三次校准，2026-07-26）：`MANIFEST = f"{ROOT}/media/x.json"`
            # 这类拼装路径的**全路径字面量从不出现**，父目录同样是拼出来的——前两次修的
            # 是「解析器函数」，这是同一病根的另一张脸。故退一步认**文件名**：basename
            # 在代码里出现即算读到。命中若落在生产者自己的脚本，那就是**自用状态文件**
            # （如断点续跑台账），照实标 basename-consumed 供人一眼判，不诬告成死件。
            base = Path(artifact).name
            bhits = (
                [
                h for h in _grep(base)
                if _classify(h.split(":", 1)[0]) in ("script", "test")
                and h.split(":", 1)[0] not in SELF_PATHS
            ]
                if base != artifact
                else []
            )
            if bhits:
                verdict, via = "basename-consumed", base
            else:
                verdict = "doc-only" if kinds.get("doc") else "orphan"
    entry = {
        "artifact": artifact,
        "producers": sorted(set(producers)),
        "verdict": verdict,
        "consumers": {k: sorted(set(v))[:5] for k, v in sorted(kinds.items())},
        "consumer_counts": {k: len(set(v)) for k, v in sorted(kinds.items())},
    }
    if via:
        entry["consumed_via"] = via
    return entry


def build_report() -> dict:
    entries = [audit_one(p, w) for p, w in sorted(produced_paths().items())]
    entries += [
        {**audit_one(tag, wfs), "kind": "release"}
        for tag, wfs in sorted(produced_releases().items())
    ]
    orphans = [e for e in entries if e["verdict"] == "orphan"]
    doc_only = [e for e in entries if e["verdict"] == "doc-only"]
    via_parent = [e for e in entries if e["verdict"] in ("parent-consumed", "basename-consumed")]
    return {
        "method": "static-reference-graph",
        "blind_spots": [
            "守密人本人翻阅（不可见）",
            "会话内按需读档（不可见）",
            "黑池侧消费（防火墙外，结构上不可见）",
        ],
        "artifacts": len(entries),
        "orphans": len(orphans),
        "doc_only": len(doc_only),
        "parent_consumed": len(via_parent),
        "entries": entries,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="产出↔消费对账：找没人读的产物")
    parser.add_argument("--out", type=Path, default=REPORT_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    report = build_report()
    marks = {"orphan": "ORPHAN  ", "doc-only": "DOC-ONLY"}
    for entry in report["entries"]:
        if entry["verdict"] in ("orphan", "doc-only"):
            print(f"  [{marks[entry['verdict']]}] {entry['artifact']}  ← {', '.join(entry['producers'])}")
    print(
        f"产出↔消费对账：产出 {report['artifacts']} 件 / 零消费 {report['orphans']} 件 / "
        f"仅档案提及 {report['doc_only']} 件 / 经解析器/文件名读 {report['parent_consumed']} 件"
    )
    print("（静态图看不见守密人翻阅、会话内读档、黑池侧消费——候选清单供人裁，不是退役触发器）")

    if not args.dry_run:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"报告已写入 {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
