#!/usr/bin/env python3
"""build_capability_registry.py — 银芯功能目录自动扫描器

扫描全仓库七层功能源，产出机器权威的功能目录（capability registry）。
人工只维护一个旁挂文件 memory/capability-annotations.json（中文用途补注），
本脚本每次重生成时把补注合并回来，绝不覆盖人工注释。

扫描范围：
  1. .github/workflows/*.yml      CI 自动化工作流
  2. scripts/*.py                 顶层脚本
  3. projects/news/scripts/*.py   news 采集器脚本
  4. scripts/mcp_server.py        MCP 知识层工具（@mcp.tool）
  5. .claude/commands/*.md        Slash 命令
  6. .claude/skills/*/SKILL.md    仓内技能
  7. projects/*/                  子项目

输出：
  memory/capability-registry.json  机器权威 JSON（含合并后的人工补注）
  memory/capability-index.md       人类可读 Markdown 总览

用法：
  python scripts/build_capability_registry.py            # 重生成
  python scripts/build_capability_registry.py --check    # 仅校验是否过期（CI 用，非零退出=过期）
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "memory" / "capability-registry.json"
ANNOTATIONS = ROOT / "memory" / "capability-annotations.json"
INDEX_MD = ROOT / "memory" / "capability-index.md"


_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\U0000FE00-\U0000FE0F\U00002190-\U000021FF\U00002B00-\U00002BFF]+"
)


def strip_emoji(s: str) -> str:
    """清除 emoji 与杂项符号（§2.4 交付物禁 emoji）。"""
    return _EMOJI_RE.sub("", s).strip()


def first_doc_line(text: str) -> str:
    """提取模块/函数 docstring 的第一行非空内容。"""
    m = re.search(r'"""(.*?)"""', text, re.DOTALL)
    if not m:
        return ""
    for line in m.group(1).splitlines():
        line = line.strip()
        if line:
            return line
    return ""


def scan_workflows() -> list[dict]:
    out = []
    wf_dir = ROOT / ".github" / "workflows"
    for p in sorted(wf_dir.glob("*.yml")):
        text = p.read_text(encoding="utf-8", errors="ignore")
        name_m = re.search(r"^name:\s*(.+)$", text, re.MULTILINE)
        name = name_m.group(1).strip().strip("\"'") if name_m else p.stem
        name = strip_emoji(name) or p.stem
        triggers = []
        if re.search(r"^\s*schedule:", text, re.MULTILINE) or "cron:" in text:
            triggers.append("schedule")
        if re.search(r"^\s*push:", text, re.MULTILINE):
            triggers.append("push")
        if re.search(r"^\s*pull_request:", text, re.MULTILINE):
            triggers.append("pull_request")
        if re.search(r"^\s*workflow_dispatch:", text, re.MULTILINE):
            triggers.append("manual")
        out.append({
            "id": p.name,
            "name": name,
            "path": f".github/workflows/{p.name}",
            "triggers": triggers,
        })
    return out


def scan_python_dir(rel_dir: str) -> list[dict]:
    out = []
    d = ROOT / rel_dir
    for p in sorted(d.glob("*.py")):
        if p.name == "__init__.py":
            continue
        summary = first_doc_line(p.read_text(encoding="utf-8", errors="ignore"))
        out.append({
            "id": p.name,
            "path": f"{rel_dir}/{p.name}",
            "summary": summary,
        })
    return out


def scan_mcp_tools() -> list[dict]:
    out = []
    p = ROOT / "scripts" / "mcp_server.py"
    text = p.read_text(encoding="utf-8", errors="ignore")
    # 匹配 @mcp.tool() 紧跟的 def name( ... ): """summary
    pattern = re.compile(
        r"@mcp\.tool\(\)\s*\n\s*def\s+(\w+)\s*\([^)]*\)[^:]*:\s*\n\s*\"\"\"(.*?)(?:\n|\"\"\")",
        re.DOTALL,
    )
    for m in pattern.finditer(text):
        out.append({
            "id": m.group(1),
            "module": "scripts/mcp_server.py",
            "summary": m.group(2).strip(),
        })
    return out


def scan_commands() -> list[dict]:
    out = []
    d = ROOT / ".claude" / "commands"
    for p in sorted(d.glob("*.md")):
        summary = ""
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                summary = line.rstrip(":")
                break
        out.append({
            "id": p.stem,
            "path": f".claude/commands/{p.name}",
            "summary": summary,
        })
    return out


def scan_skills() -> list[dict]:
    out = []
    d = ROOT / ".claude" / "skills"
    if not d.exists():
        return out
    for sp in sorted(d.iterdir()):
        skill_md = sp / "SKILL.md"
        if not skill_md.exists():
            continue
        text = skill_md.read_text(encoding="utf-8", errors="ignore")
        name_m = re.search(r"^name:\s*(.+)$", text, re.MULTILINE)
        desc_m = re.search(r"^description:\s*(.+)$", text, re.MULTILINE)
        out.append({
            "id": sp.name,
            "path": f".claude/skills/{sp.name}/SKILL.md",
            "name": name_m.group(1).strip() if name_m else sp.name,
            "summary": desc_m.group(1).strip() if desc_m else "",
        })
    return out


def scan_projects() -> list[dict]:
    out = []
    d = ROOT / "projects"
    for sp in sorted(d.iterdir()):
        if not sp.is_dir():
            continue
        ctx = sp / "CONTEXT.md"
        summary = ""
        if ctx.exists():
            for line in ctx.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    summary = line
                    break
        out.append({
            "id": sp.name,
            "path": f"projects/{sp.name}/",
            "summary": summary,
        })
    return out


def merge_annotations(registry: dict, annotations: dict) -> dict:
    """把人工补注 note_zh 合并进每条目（按 category + id）。"""
    for category, entries in registry.items():
        if category == "meta" or not isinstance(entries, list):
            continue
        notes = annotations.get(category, {})
        for entry in entries:
            note = notes.get(entry.get("id"))
            if note:
                entry["note_zh"] = note
    return registry


def build() -> dict:
    registry = {
        "meta": {
            "generated_at": date.today().isoformat(),
            "generated_by": "scripts/build_capability_registry.py (自动扫描)",
            "do_not_hand_edit": "本文件由 CI 自动重生成；人工中文用途请改 memory/capability-annotations.json",
            "scope": "BIAV-SC 银芯受限层全功能盘点（七层）",
        },
        "workflows": scan_workflows(),
        "scripts_top": scan_python_dir("scripts"),
        "scripts_news": scan_python_dir("projects/news/scripts"),
        "mcp_tools": scan_mcp_tools(),
        "commands": scan_commands(),
        "skills": scan_skills(),
        "projects": scan_projects(),
    }
    counts = {k: len(v) for k, v in registry.items() if isinstance(v, list)}
    counts["total"] = sum(counts.values())
    registry["meta"]["counts"] = counts

    annotations = {}
    if ANNOTATIONS.exists():
        annotations = json.loads(ANNOTATIONS.read_text(encoding="utf-8"))
    registry = merge_annotations(registry, annotations)
    return registry


CATEGORY_TITLES = {
    "workflows": "CI 自动化工作流",
    "scripts_top": "顶层脚本（记忆 / 做梦 / 解包 / 运营）",
    "scripts_news": "news 采集器脚本",
    "mcp_tools": "MCP 知识层工具",
    "commands": "Slash 命令",
    "skills": "仓内技能",
    "projects": "子项目",
}


def render_markdown(registry: dict) -> str:
    meta = registry["meta"]
    counts = meta["counts"]
    lines = [
        "# 银芯功能目录（capability-index）",
        "",
        "> 本文件由 `scripts/build_capability_registry.py` 自动生成，**请勿手改**。",
        "> 中文用途补注请改 `memory/capability-annotations.json`；机器权威数据见 `memory/capability-registry.json`。",
        "",
        f"- 生成日期：{meta['generated_at']}",
        f"- 功能总数：**{counts['total']}**",
        "",
        "## 总览",
        "",
        "| 功能层 | 数量 |",
        "|------|------|",
    ]
    for cat, title in CATEGORY_TITLES.items():
        lines.append(f"| {title} | {counts.get(cat, 0)} |")
    lines.append("")

    for cat, title in CATEGORY_TITLES.items():
        entries = registry.get(cat, [])
        if not entries:
            continue
        lines.append(f"## {title}（{len(entries)}）")
        lines.append("")
        for e in entries:
            label = e.get("name") or e.get("id")
            desc = e.get("note_zh") or e.get("summary") or ""
            extra = ""
            if cat == "workflows" and e.get("triggers"):
                extra = f" _[{'/'.join(e['triggers'])}]_"
            path = e.get("path") or e.get("module") or ""
            if path:
                lines.append(f"- **`{label}`**{extra} — {desc}  \n  `{path}`")
            else:
                lines.append(f"- **`{label}`**{extra} — {desc}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    registry = build()
    new_json = json.dumps(registry, ensure_ascii=False, indent=2) + "\n"
    new_md = render_markdown(registry)

    if "--check" in sys.argv:
        stale = False
        if not REGISTRY.exists() or REGISTRY.read_text(encoding="utf-8") != new_json:
            stale = True
        if not INDEX_MD.exists() or INDEX_MD.read_text(encoding="utf-8") != new_md:
            stale = True
        if stale:
            print("功能目录已过期，请运行 python scripts/build_capability_registry.py")
            return 1
        print("功能目录与代码一致。")
        return 0

    REGISTRY.write_text(new_json, encoding="utf-8")
    INDEX_MD.write_text(new_md, encoding="utf-8")
    counts = registry["meta"]["counts"]
    print(f"功能目录已重生成：共 {counts['total']} 项")
    for cat, title in CATEGORY_TITLES.items():
        print(f"  {title}: {counts.get(cat, 0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
