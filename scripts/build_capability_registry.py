#!/usr/bin/env python3
"""build_capability_registry.py — 银芯功能目录 + 动态编排可达性分析器

扫描全仓库功能源，产出机器权威的功能目录，并对每个脚本做**静态可达性分析**：
从「活编排入口」（工作流 / MCP 服务端 / slash 命令 / 会话钩子）出发，沿 Python
模块级 import 图做传递闭包，判定每个脚本属于哪个编排平面、是否可达。这样「必要性」
不再靠人工估算（易错），而是每次重生成时由工具算出来。

人工只维护旁挂文件 memory/capability-annotations.json（中文用途补注）。

功能源（七层）：
  1. .github/workflows/*.yml      CI 工作流（编排入口·定时/事件平面）
  2. scripts/*.py                 顶层脚本
  3. projects/news/scripts/*.py   news 采集器脚本
  4. projects/wiki/scripts/*.py   wiki 数据脚本
  5. scripts/mcp_server.py        MCP 工具（编排入口·AI 动态平面）
  6. .claude/commands/*.md        slash 命令（编排入口·人工平面）
  7. .claude/skills/*/SKILL.md    仓内技能
  8. projects/*/                  子项目

编排可达性（每个脚本附 planes + status）：
  - planes: workflow / mcp / command / hook（直接被某入口引用）或 import（仅经 import 间接可达）
  - status: live（可达活件）/ test-only（仅被测试引用）/ orphaned（无任何活入口可达，建议隔离待裁）

输出：
  memory/capability-registry.json  机器权威 JSON（含可达性字段）
  memory/capability-index.md       人类可读 Markdown（含编排与可达性专章）

用法：
  python scripts/build_capability_registry.py            # 重生成
  python scripts/build_capability_registry.py --check    # 校验是否过期（CI 用，非零退出=过期）
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

# 三个被纳入可达性分析的脚本层（运行时均以扁平 basename 互相 import）
SCRIPT_DIRS = ["scripts", "projects/news/scripts", "projects/wiki/scripts"]

_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\U0000FE00-\U0000FE0F\U00002190-\U000021FF\U00002B00-\U00002BFF]+"
)
_PY_REF_RE = re.compile(r"\b([A-Za-z0-9_]+)\.py\b")
_IMPORT_RE = re.compile(r"^[ \t]*(?:from|import)[ \t]+([A-Za-z_][\w]*)", re.MULTILINE)


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


# ---------------------------------------------------------------------------
# 静态可达性分析
# ---------------------------------------------------------------------------

def index_scripts() -> tuple[dict[str, str], dict[str, str]]:
    """返回 (basename -> 相对路径)、(basename -> 源码文本)。"""
    paths: dict[str, str] = {}
    texts: dict[str, str] = {}
    for rel_dir in SCRIPT_DIRS:
        d = ROOT / rel_dir
        if not d.exists():
            continue
        for p in sorted(d.glob("*.py")):
            if p.name == "__init__.py":
                continue
            base = p.stem
            paths[base] = f"{rel_dir}/{p.name}"
            texts[base] = p.read_text(encoding="utf-8", errors="ignore")
    return paths, texts


def py_refs(text: str, known: set[str]) -> set[str]:
    """文本里出现的 `<name>.py` 中属于已知脚本的 basename（工作流/命令用）。"""
    return {m for m in _PY_REF_RE.findall(text) if m in known}


def import_refs(text: str, known: set[str]) -> set[str]:
    """文本里模块级/函数级 import 的首段 token 中属于已知脚本的 basename。"""
    return {m for m in _IMPORT_RE.findall(text) if m in known}


def collect_roots(known: set[str]) -> dict[str, set[str]]:
    """收集被「活编排入口」直接引用的脚本 basename -> 平面集合。"""
    roots: dict[str, set[str]] = {}

    def add(base: str, plane: str) -> None:
        roots.setdefault(base, set()).add(plane)

    # 工作流：run: python X.py
    for p in (ROOT / ".github" / "workflows").glob("*.yml"):
        for b in py_refs(p.read_text(encoding="utf-8", errors="ignore"), known):
            add(b, "workflow")

    # MCP 服务端：.mcp.json 指向 mcp_server.py，mcp_server.py 内 import 的模块
    mcp_cfg = ROOT / ".mcp.json"
    if mcp_cfg.exists():
        for b in py_refs(mcp_cfg.read_text(encoding="utf-8", errors="ignore"), known):
            add(b, "mcp")
    mcp_server = ROOT / "scripts" / "mcp_server.py"
    if mcp_server.exists():
        for b in import_refs(mcp_server.read_text(encoding="utf-8", errors="ignore"), known):
            add(b, "mcp")

    # slash 命令：mention 的 X.py
    for p in (ROOT / ".claude" / "commands").glob("*.md"):
        for b in py_refs(p.read_text(encoding="utf-8", errors="ignore"), known):
            add(b, "command")

    # 会话钩子：settings.json 里引用的脚本（当前为空）
    settings = ROOT / ".claude" / "settings.json"
    if settings.exists():
        for b in py_refs(settings.read_text(encoding="utf-8", errors="ignore"), known):
            add(b, "hook")

    return roots


def build_import_graph(texts: dict[str, str], known: set[str]) -> dict[str, set[str]]:
    """脚本 import 图：basename -> 它 import 的已知脚本 basename 集合。"""
    graph: dict[str, set[str]] = {}
    for base, text in texts.items():
        deps = import_refs(text, known)
        deps.discard(base)
        graph[base] = deps
    return graph


def reachable_from(roots: set[str], graph: dict[str, set[str]]) -> set[str]:
    """从入口集合沿 import 图做传递闭包。"""
    seen: set[str] = set()
    stack = list(roots)
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(graph.get(cur, ()))
    return seen


def test_refs(known: set[str]) -> set[str]:
    """tests/ 目录里被 import 的脚本 basename。"""
    refs: set[str] = set()
    tdir = ROOT / "tests"
    if tdir.exists():
        for p in tdir.rglob("*.py"):
            refs |= import_refs(p.read_text(encoding="utf-8", errors="ignore"), known)
    return refs


def analyze_orchestration() -> tuple[dict[str, dict], dict[str, str]]:
    """返回 (basename -> {planes, status})、(basename -> 相对路径)。"""
    paths, texts = index_scripts()
    known = set(paths)
    roots = collect_roots(known)
    graph = build_import_graph(texts, known)
    reachable = reachable_from(set(roots), graph)
    tests = test_refs(known)

    result: dict[str, dict] = {}
    for base in known:
        if base in roots:
            planes = sorted(roots[base])
            status = "live"
        elif base in reachable:
            planes = ["import"]
            status = "live"
        elif base in tests:
            planes = ["test"]
            status = "test-only"
        else:
            planes = []
            status = "orphaned"
        result[base] = {"planes": planes, "status": status}
    return result, paths


# ---------------------------------------------------------------------------
# 各功能层扫描
# ---------------------------------------------------------------------------

def scan_workflows() -> list[dict]:
    out = []
    for p in sorted((ROOT / ".github" / "workflows").glob("*.yml")):
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


def scan_python_dir(rel_dir: str, orch: dict[str, dict]) -> list[dict]:
    out = []
    d = ROOT / rel_dir
    if not d.exists():
        return out
    for p in sorted(d.glob("*.py")):
        if p.name == "__init__.py":
            continue
        info = orch.get(p.stem, {})
        out.append({
            "id": p.name,
            "path": f"{rel_dir}/{p.name}",
            "summary": first_doc_line(p.read_text(encoding="utf-8", errors="ignore")),
            "planes": info.get("planes", []),
            "status": info.get("status", "orphaned"),
        })
    return out


def scan_mcp_tools() -> list[dict]:
    out = []
    text = (ROOT / "scripts" / "mcp_server.py").read_text(encoding="utf-8", errors="ignore")
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
    for p in sorted((ROOT / ".claude" / "commands").glob("*.md")):
        summary = ""
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                summary = line.rstrip(":")
                break
        out.append({"id": p.stem, "path": f".claude/commands/{p.name}", "summary": summary})
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
    for sp in sorted((ROOT / "projects").iterdir()):
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
        out.append({"id": sp.name, "path": f"projects/{sp.name}/", "summary": summary})
    return out


def merge_annotations(registry: dict, annotations: dict) -> dict:
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
    orch, _ = analyze_orchestration()
    registry = {
        "meta": {
            "generated_at": date.today().isoformat(),
            "generated_by": "scripts/build_capability_registry.py (自动扫描 + 可达性分析)",
            "do_not_hand_edit": "本文件由 CI 自动重生成；人工中文用途请改 memory/capability-annotations.json",
            "scope": "BIAV-SC 银芯受限层全功能盘点 + 动态编排可达性",
            "reachability_method": "从活编排入口（工作流/MCP/命令/钩子）沿 Python 模块级 import 图做传递闭包；status=orphaned 表示无任何活入口可达，建议隔离待裁，非自动删除。",
        },
        "workflows": scan_workflows(),
        "scripts_top": scan_python_dir("scripts", orch),
        "scripts_news": scan_python_dir("projects/news/scripts", orch),
        "scripts_wiki": scan_python_dir("projects/wiki/scripts", orch),
        "mcp_tools": scan_mcp_tools(),
        "commands": scan_commands(),
        "skills": scan_skills(),
        "projects": scan_projects(),
    }
    counts = {k: len(v) for k, v in registry.items() if isinstance(v, list)}
    counts["total"] = sum(counts.values())
    registry["meta"]["counts"] = counts

    # 可达性汇总（仅统计三个脚本层）
    reach = {"live": 0, "test-only": 0, "orphaned": 0}
    for cat in ("scripts_top", "scripts_news", "scripts_wiki"):
        for e in registry[cat]:
            reach[e.get("status", "orphaned")] = reach.get(e.get("status", "orphaned"), 0) + 1
    registry["meta"]["reachability"] = reach

    annotations = {}
    if ANNOTATIONS.exists():
        annotations = json.loads(ANNOTATIONS.read_text(encoding="utf-8"))
    return merge_annotations(registry, annotations)


CATEGORY_TITLES = {
    "workflows": "CI 自动化工作流（编排入口·定时/事件平面）",
    "scripts_top": "顶层脚本（记忆 / 做梦 / 解包 / 运营）",
    "scripts_news": "news 采集器脚本",
    "scripts_wiki": "wiki 数据脚本",
    "mcp_tools": "MCP 知识层工具（编排入口·AI 动态平面）",
    "commands": "Slash 命令（编排入口·人工平面）",
    "skills": "仓内技能",
    "projects": "子项目",
}

STATUS_TAG = {"live": "活", "test-only": "仅测试", "orphaned": "孤儿"}


def render_markdown(registry: dict) -> str:
    meta = registry["meta"]
    counts = meta["counts"]
    reach = meta["reachability"]
    lines = [
        "# 银芯功能目录（capability-index）",
        "",
        "> 本文件由 `scripts/build_capability_registry.py` 自动生成，**请勿手改**。",
        "> 中文用途补注请改 `memory/capability-annotations.json`；机器权威数据见 `memory/capability-registry.json`。",
        "",
        f"- 生成日期：{meta['generated_at']}",
        f"- 功能总数：**{counts['total']}**",
        f"- 脚本可达性：活 {reach['live']} / 仅测试 {reach['test-only']} / 孤儿 {reach['orphaned']}",
        "",
        "## 总览",
        "",
        "| 功能层 | 数量 |",
        "|------|------|",
    ]
    for cat, title in CATEGORY_TITLES.items():
        lines.append(f"| {title} | {counts.get(cat, 0)} |")
    lines.append("")

    # 编排与可达性专章
    lines += [
        "## 动态编排与可达性",
        "",
        "银芯只有四个编排平面，其中只有 MCP 是运行时真动态：",
        "",
        "| 编排平面 | 触发 | 动态 |",
        "|------|------|------|",
        "| 定时/事件（工作流）| cron + push | 否（静态调度）|",
        "| AI 动态（MCP 工具）| 艾瑞卡运行时自选 | 是 |",
        "| 人工（slash 命令 / 技能）| 守密人下达 | 半动态 |",
        "| 会话钩子 | 钩子自动 | 已退役（settings.json 无钩子）|",
        "",
        "可达性 = 从活编排入口沿 Python import 图传递闭包。`孤儿` = 无任何活入口可达，"
        "建议隔离待裁（§3.1 裁撤属守密人决策，工具只检测不删除）。",
        "",
    ]
    orphans = []
    test_only = []
    for cat in ("scripts_top", "scripts_news", "scripts_wiki"):
        for e in registry[cat]:
            if e["status"] == "orphaned":
                orphans.append(e)
            elif e["status"] == "test-only":
                test_only.append(e)
    if orphans:
        lines.append(f"### 孤儿脚本（{len(orphans)}）— 无活编排入口可达，建议隔离待裁")
        lines.append("")
        for e in sorted(orphans, key=lambda x: x["path"]):
            desc = e.get("note_zh") or e.get("summary") or ""
            lines.append(f"- `{e['path']}` — {desc}")
        lines.append("")
    if test_only:
        lines.append(f"### 仅测试可达脚本（{len(test_only)}）")
        lines.append("")
        for e in sorted(test_only, key=lambda x: x["path"]):
            lines.append(f"- `{e['path']}`")
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
            tags = []
            if cat == "workflows" and e.get("triggers"):
                tags.append("/".join(e["triggers"]))
            if e.get("status"):
                planes = "+".join(e.get("planes", [])) or "—"
                tags.append(f"{STATUS_TAG.get(e['status'], e['status'])}:{planes}")
            tag = f" _[{' | '.join(tags)}]_" if tags else ""
            path = e.get("path") or e.get("module") or ""
            if path:
                lines.append(f"- **`{label}`**{tag} — {desc}  \n  `{path}`")
            else:
                lines.append(f"- **`{label}`**{tag} — {desc}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    registry = build()
    new_json = json.dumps(registry, ensure_ascii=False, indent=2) + "\n"
    new_md = render_markdown(registry)

    if "--check" in sys.argv:
        stale = (not REGISTRY.exists() or REGISTRY.read_text(encoding="utf-8") != new_json
                 or not INDEX_MD.exists() or INDEX_MD.read_text(encoding="utf-8") != new_md)
        if stale:
            print("功能目录已过期，请运行 python scripts/build_capability_registry.py")
            return 1
        print("功能目录与代码一致。")
        return 0

    REGISTRY.write_text(new_json, encoding="utf-8")
    INDEX_MD.write_text(new_md, encoding="utf-8")
    counts = registry["meta"]["counts"]
    reach = registry["meta"]["reachability"]
    print(f"功能目录已重生成：共 {counts['total']} 项")
    for cat, title in CATEGORY_TITLES.items():
        print(f"  {title}: {counts.get(cat, 0)}")
    print(f"  脚本可达性: 活 {reach['live']} / 仅测试 {reach['test-only']} / 孤儿 {reach['orphaned']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
