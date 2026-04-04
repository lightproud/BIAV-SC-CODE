"""
dream.py — Layer 1 Memory Consistency Checker (read-only observer)

Scans memory/ and project files for staleness, broken references,
decision health, and lessons status. Never modifies any files.

Usage: python scripts/dream.py
"""

import re
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TODAY = date.today()
STALE_DAYS = 14


def parse_timestamp(fp: Path) -> date | None:
    """Extract date from timestamp lines in first 10 lines of a file."""
    try:
        lines = fp.read_text(encoding="utf-8").splitlines()[:10]
    except (OSError, UnicodeDecodeError):
        return None
    for line in lines:
        m = re.match(r">\s*(?:最后更新：|Last updated:\s*)(\d{4}-\d{2}-\d{2})", line)
        if m:
            try:
                return date.fromisoformat(m.group(1))
            except ValueError:
                pass
        m = re.match(r">\s*v[\d.]+\s*[—–-]\s*(\d{4})\.(\d{2})\.(\d{2})", line)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                pass
    return None


def days_ago(d: date) -> str:
    n = (TODAY - d).days
    return "today" if n == 0 else f"{n} day{'s' if n != 1 else ''} ago"


def check_staleness():
    lines, issues = [], 0
    targets = sorted(REPO.glob("memory/*.md")) + sorted(REPO.glob("projects/*/CONTEXT.md"))
    for fp in targets:
        rel = fp.relative_to(REPO)
        ts = parse_timestamp(fp)
        if ts is None:
            lines.append(f"  - ? {rel} -- no timestamp found")
            issues += 1
        elif (TODAY - ts).days > STALE_DAYS:
            lines.append(f"  - x {rel} -- last updated {ts} ({days_ago(ts)})")
            issues += 1
        else:
            lines.append(f"  - ok {rel} -- last updated {ts} ({days_ago(ts)})")
    return lines, issues


def extract_file_refs(text: str) -> list[str]:
    """Find file path references in markdown text."""
    refs = set()
    top_dirs = {"memory", "assets", "projects"}
    skip_markers = {"待生成", "待创建", "TODO", "todo", "planned"}
    for m in re.finditer(r"(?:memory/[\w./-]+|assets/[\w./-]+|projects/[\w./-]+)", text):
        ref = m.group(0).rstrip(".,;:!?)")
        if "xxx" in ref or "你的" in ref or "YYYY" in ref:
            continue
        parts = Path(ref).parts
        if len(parts) >= 2 and parts[0] in top_dirs and parts[1] in top_dirs:
            continue
        # Skip refs annotated as pending/to-be-created in surrounding context
        ctx_start = max(0, m.start() - 20)
        ctx_end = min(len(text), m.end() + 20)
        context = text[ctx_start:ctx_end]
        if any(marker in context for marker in skip_markers):
            continue
        refs.add(ref)
    return sorted(refs)


def check_references():
    lines, issues, seen = [], 0, set()
    targets = sorted(REPO.glob("memory/*.md")) + [REPO / "CLAUDE.md"]
    targets += sorted(REPO.glob("projects/*/CONTEXT.md"))
    for fp in targets:
        try:
            text = fp.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        src = fp.relative_to(REPO)
        for ref in extract_file_refs(text):
            if (str(src), ref) in seen:
                continue
            seen.add((str(src), ref))
            target = REPO / ref
            if not target.exists() and not any(REPO.glob(ref)):
                lines.append(f"  - x {src} references '{ref}' -- NOT FOUND")
                issues += 1
    return lines, issues


def check_decisions():
    fp = REPO / "memory" / "decisions.md"
    if not fp.exists():
        return ["  - ? memory/decisions.md not found"], 0
    total, dead = 0, 0
    for line in fp.read_text(encoding="utf-8").splitlines():
        if line.startswith("|") and "2026-" in line and "日期" not in line:
            total += 1
            if "已废除" in line or "已废弃" in line or "~~" in line:
                dead += 1
    if total == 0:
        return ["  - No decision entries found"], 0
    pct = round(dead / total * 100)
    return [f"  - {dead}/{total} decisions marked as obsolete ({pct}%)"], 1 if pct > 20 else 0


def check_lessons():
    fp = REPO / "memory" / "lessons-learned.md"
    if not fp.exists():
        return ["  - ? memory/lessons-learned.md not found"], 0
    text = fp.read_text(encoding="utf-8")
    total = len(re.findall(r"^## \d+\.", text, re.MULTILINE))
    graduated = 0
    resolved_hints = set()
    for block in re.split(r"^## \d+\.", text, flags=re.MULTILINE)[1:]:
        title = block.strip().splitlines()[0].strip()[:60] if block.strip() else ""
        if "已毕业" in title or "graduated" in title.lower():
            graduated += 1
            continue
        for cfg in re.findall(r"`(\w+:\s*\w+)`", block):
            key = cfg.split(":")[0].strip()
            if key and len(key) > 3 and not list(REPO.rglob(f"*{key}*")):
                resolved_hints.add(title)
    lines = [f"  - {total} lessons total, {graduated} graduated, {len(resolved_hints)} may be resolved"]
    for hint in sorted(resolved_hints)[:5]:
        lines.append(f"    - possibly resolved: {hint}")
    return lines, 0


def main():
    print(f"\U0001F319 Memory Dream Journal -- {TODAY}\n")
    total_issues, total_warnings = 0, 0

    for label, checker in [
        ("Staleness", check_staleness),
        ("Broken References", check_references),
        ("Decision Health", check_decisions),
        ("Lessons Status", check_lessons),
    ]:
        print(f"## {label}")
        lines, count = checker()
        if not lines and label == "Broken References":
            print("  - All references valid")
        for line in lines:
            print(line)
        if label in ("Staleness", "Broken References"):
            total_issues += count
        else:
            total_warnings += count
        print()

    print("## Summary")
    print(f"  - {total_issues} issues found, {total_warnings} warnings")
    sys.exit(0)


if __name__ == "__main__":
    main()
