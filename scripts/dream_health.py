"""Memory hygiene checks — staleness, broken refs, duplicate decisions, etc.

Extracted from dream.py. The check_* entry points are wired into
dream.run_phase1.
"""

import re
from datetime import date
from pathlib import Path

from dream_config import REPO, TODAY


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


def extract_file_refs(text: str) -> list[str]:
    """Find file path references in markdown text."""
    refs = set()
    top_dirs = {"memory", "assets", "projects"}
    skip_markers = {"待生成", "待创建", "TODO", "todo", "planned",
                     "已废", "已废弃", "不动", "仅作参考", "死于",
                     "运行时生成", "gitignored", "生成 |", "| 生成", "存入"}
    # Pre-compute code block ranges to skip refs inside ```...``` blocks
    code_ranges = []
    for cm in re.finditer(r"```.*?```", text, re.DOTALL):
        code_ranges.append((cm.start(), cm.end()))
    for m in re.finditer(r"(?:memory/[\w./-]+|assets/[\w./-]+|projects/[\w./-]+)", text):
        if any(start <= m.start() < end for start, end in code_ranges):
            continue
        ref = m.group(0).rstrip(".,;:!?)")
        if "xxx" in ref or "你的" in ref or "YYYY" in ref:
            continue
        parts = Path(ref).parts
        if len(parts) >= 2 and parts[0] in top_dirs and parts[1] in top_dirs:
            continue
        # Check the full line + nearest section header above
        line_start = text.rfind("\n", 0, m.start()) + 1
        line_end = text.find("\n", m.end())
        if line_end == -1:
            line_end = len(text)
        current_line = text[line_start:line_end]
        # Find nearest markdown heading (##) above current position
        heading_match = None
        search_pos = line_start
        while search_pos > 0:
            prev_nl = text.rfind("\n", 0, search_pos - 1)
            if prev_nl == -1:
                prev_line = text[:search_pos]
                if prev_line.lstrip().startswith("#"):
                    heading_match = prev_line
                break
            prev_line = text[prev_nl + 1:search_pos - 1]
            if prev_line.lstrip().startswith("#"):
                heading_match = prev_line
                break
            search_pos = prev_nl
        context = current_line + (" " + heading_match if heading_match else "")
        if any(marker in context for marker in skip_markers):
            continue
        refs.add(ref)
    return sorted(refs)


def check_staleness():
    """List all memory and context files with their timestamps (informational only)."""
    lines, issues = [], 0
    targets = sorted(REPO.glob("memory/*.md")) + sorted(REPO.glob("projects/*/CONTEXT.md"))
    for fp in targets:
        rel = fp.relative_to(REPO)
        ts = parse_timestamp(fp)
        if ts is None:
            lines.append(f"  - ? {rel} -- no timestamp found")
        else:
            lines.append(f"  - ok {rel} -- last updated {ts} ({days_ago(ts)})")
    return lines, issues


def check_references():
    """Check all cross-file references for broken links."""
    lines, issues, seen = [], 0, set()
    targets = sorted(REPO.glob("memory/*.md")) + [REPO / "CLAUDE.md", REPO / "BIAV-SC.md"]
    targets += sorted(REPO.glob("projects/*/CONTEXT.md"))
    for fp in targets:
        if not fp.exists():
            continue
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
    """Analyze decision health: obsolete ratio, duplicates, contradictions."""
    fp = REPO / "memory" / "decisions.md"
    if not fp.exists():
        return ["  - ? memory/decisions.md not found"], 0
    text = fp.read_text(encoding="utf-8")
    total, dead = 0, 0
    decision_texts = []
    for line in text.splitlines():
        if line.startswith("|") and "2026-" in line and "日期" not in line:
            total += 1
            decision_texts.append(line)
            if "已废除" in line or "已废弃" in line or "~~" in line:
                dead += 1
    if total == 0:
        return ["  - No decision entries found"], 0

    # Check for near-duplicate decisions (same keywords)
    dupes = find_near_duplicates(decision_texts)
    lines = []
    pct = round(dead / total * 100)
    lines.append(f"  - {dead}/{total} decisions marked as obsolete ({pct}%)")
    if dupes:
        lines.append(f"  - ⚠ {len(dupes)} potential duplicate decision pairs found")
        for a, b in dupes[:3]:
            lines.append(f"    - similar: '{a[:50]}' ↔ '{b[:50]}'")
    return lines, 1 if pct > 20 else 0


def find_near_duplicates(texts: list[str], threshold: float = 0.6) -> list[tuple[str, str]]:
    """Find near-duplicate text pairs using word overlap (Jaccard similarity)."""
    dupes = []
    word_sets = []
    for t in texts:
        words = set(re.findall(r"[\w\u4e00-\u9fff]+", t.lower()))
        words -= {"2026", "全局", "wiki", "site", "news", "game", "code"}  # stop words
        word_sets.append(words)
    for i in range(len(word_sets)):
        for j in range(i + 1, len(word_sets)):
            if not word_sets[i] or not word_sets[j]:
                continue
            jaccard = len(word_sets[i] & word_sets[j]) / len(word_sets[i] | word_sets[j])
            if jaccard > threshold:
                dupes.append((texts[i].strip(), texts[j].strip()))
    return dupes


def check_lessons():
    """Check lessons-learned for graduated entries and potentially resolved ones."""
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


def check_memory_size():
    """Check memory files for bloat — files over 500 lines need consolidation."""
    lines, issues = [], 0
    for fp in sorted(REPO.glob("memory/*.md")):
        try:
            line_count = len(fp.read_text(encoding="utf-8").splitlines())
        except (OSError, UnicodeDecodeError):
            continue
        rel = fp.relative_to(REPO)
        if line_count > 500:
            lines.append(f"  - ⚠ {rel} -- {line_count} lines (needs consolidation)")
            issues += 1
        elif line_count > 300:
            lines.append(f"  - ~ {rel} -- {line_count} lines (approaching limit)")
    return lines, issues
