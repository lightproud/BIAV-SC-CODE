"""
handoff.py — Session Handoff Generator

Generates memory/handoff.md at session end, summarizing what was done
and what the next session should know. Read automatically by SessionStart hook.

Usage:
  python scripts/handoff.py              # Generate handoff.md
  python scripts/handoff.py --verbose    # With debug output
"""

import json
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HANDOFF_FILE = REPO / "memory" / "handoff.md"
FACTS_FILE = REPO / "memory" / "facts.json"
DIGESTS_DIR = REPO / "memory" / "session-digests"

TODAY = date.today()
NOW = datetime.now()
VERBOSE = "--verbose" in sys.argv


def log(msg: str):
    if VERBOSE:
        print(msg)


def get_recent_commits(n: int = 10) -> list[str]:
    try:
        r = subprocess.run(
            ["git", "log", "--oneline", f"-{n}"],
            capture_output=True, text=True, cwd=str(REPO), timeout=10,
        )
        return [l.strip() for l in r.stdout.strip().splitlines() if l.strip()]
    except Exception:
        return []


def get_today_commits() -> list[str]:
    try:
        r = subprocess.run(
            ["git", "log", "--oneline", "--since=midnight"],
            capture_output=True, text=True, cwd=str(REPO), timeout=10,
        )
        return [l.strip() for l in r.stdout.strip().splitlines() if l.strip()]
    except Exception:
        return []


def get_changed_files() -> list[str]:
    try:
        r = subprocess.run(
            ["git", "diff", "--name-only", "HEAD~5", "HEAD"],
            capture_output=True, text=True, cwd=str(REPO), timeout=10,
        )
        return [l.strip() for l in r.stdout.strip().splitlines() if l.strip()][:20]
    except Exception:
        return []


def get_uncommitted() -> list[str]:
    try:
        r = subprocess.run(
            ["git", "status", "--short"],
            capture_output=True, text=True, cwd=str(REPO), timeout=10,
        )
        return [l.strip() for l in r.stdout.strip().splitlines() if l.strip()][:10]
    except Exception:
        return []


def get_current_branch() -> str:
    try:
        r = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True, text=True, cwd=str(REPO), timeout=10,
        )
        return r.stdout.strip()
    except Exception:
        return "unknown"


def get_recent_facts(n: int = 10) -> list[dict]:
    if not FACTS_FILE.exists():
        return []
    try:
        facts = json.loads(FACTS_FILE.read_text(encoding="utf-8"))
        active = [f for f in facts if not f.get("obsolete")]
        return active[-n:]
    except Exception:
        return []


def get_latest_digest() -> dict | None:
    if not DIGESTS_DIR.exists():
        return None
    digests = sorted(DIGESTS_DIR.glob("*.json"), reverse=True)
    if not digests:
        return None
    try:
        return json.loads(digests[0].read_text(encoding="utf-8"))
    except Exception:
        return None


def generate():
    log("📝 Generating handoff.md...")

    branch = get_current_branch()
    today_commits = get_today_commits()
    recent_commits = get_recent_commits(5)
    changed_files = get_changed_files()
    uncommitted = get_uncommitted()
    facts = get_recent_facts(10)
    digest = get_latest_digest()

    lines = []
    lines.append(f"# 会话交接 — {NOW.strftime('%Y-%m-%d %H:%M')}")
    lines.append("")
    lines.append("> 由上一个会话的 Stop hook 自动生成。帮助你快速了解上次做了什么。")
    lines.append("")

    # Branch
    lines.append(f"## 当前分支")
    lines.append(f"`{branch}`")
    lines.append("")

    # What was done
    lines.append("## 上次做了什么")
    if today_commits:
        for c in today_commits:
            lines.append(f"- {c}")
    elif recent_commits:
        lines.append("（今天无新提交，显示最近提交）")
        for c in recent_commits:
            lines.append(f"- {c}")
    else:
        lines.append("- 无提交记录")
    lines.append("")

    # Changed files
    if changed_files:
        lines.append("## 涉及文件")
        for f in changed_files[:15]:
            lines.append(f"- `{f}`")
        lines.append("")

    # Uncommitted
    if uncommitted:
        lines.append("## ⚠ 未提交的变更")
        for u in uncommitted:
            lines.append(f"- {u}")
        lines.append("")

    # Session digest summary
    if digest:
        k = digest.get("knowledge", {})
        lines.append("## 会话摘要")
        lines.append(f"- 文件变更：{digest['changes'].get('files_modified', 0)} 修改 / {digest['changes'].get('files_added', 0)} 新增")
        lines.append(f"- 提取事实：{k.get('facts_extracted', 0)} 条")
        lines.append(f"- 图谱更新：{k.get('graph_nodes_added', 0)} 节点")
        lines.append("")

    # Recent facts
    if facts:
        lines.append("## 近期知识事实")
        for f in facts:
            cat = f.get("category", "?")
            lines.append(f"- **[{cat}]** {f['content']}")
        lines.append("")

    # Footer
    lines.append("---")
    lines.append(f"> 生成时间：{NOW.isoformat()}")

    content = "\n".join(lines) + "\n"

    HANDOFF_FILE.write_text(content, encoding="utf-8")
    log(f"✅ Written to {HANDOFF_FILE}")


if __name__ == "__main__":
    generate()
