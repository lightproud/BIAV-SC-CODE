"""
reflexion.py — Reflexion: Automatic Failure Learning

Detects failures from workflows, dream checks, and search misses,
then extracts lessons and writes them back to memory.

Inspired by Reflexion (Shinn et al. 2023) — self-reflection after failure.

Usage:
  python scripts/reflexion.py --scan           # Scan all failure sources
  python scripts/reflexion.py --report         # JSON report for automation
"""

import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DREAMS_DIR = REPO / "memory" / "dreams"
SEARCH_FAILURES_FILE = DREAMS_DIR / "search-failures.json"
LESSONS_FILE = REPO / "memory" / "lessons-learned.md"
INSIGHTS_FILE = DREAMS_DIR / "insights.json"
TODAY = date.today()

# ============================================================
# Failure signal collection
# ============================================================


def collect_dream_failures() -> list[dict]:
    """Collect structural issues from recent dream journals."""
    failures = []
    for journal_fp in sorted(DREAMS_DIR.glob("20*.json"), reverse=True)[:7]:
        try:
            journal = json.loads(journal_fp.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        phase1 = journal.get("phase1", {})
        issues = phase1.get("issues", 0)
        if issues == 0:
            continue

        checks = phase1.get("checks", {})
        for label, data in checks.items():
            issue_count = data.get("issues", 0)
            if issue_count > 0:
                for line in data.get("lines", []):
                    if "⚠" in line or "NOT FOUND" in line or "x " in line:
                        failures.append({
                            "source": "dream",
                            "type": label,
                            "date": journal.get("date", ""),
                            "detail": line.strip(),
                        })

    return failures


def collect_search_failures() -> list[dict]:
    """Collect search queries that returned no results."""
    if not SEARCH_FAILURES_FILE.exists():
        return []

    try:
        data = json.loads(SEARCH_FAILURES_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []

    failures = []
    for entry in data[-50:]:  # Last 50
        failures.append({
            "source": "search",
            "type": "no_results",
            "date": entry.get("date", ""),
            "detail": f"query='{entry.get('query', '')}' tokens={entry.get('tokens', [])}",
            "query": entry.get("query", ""),
        })

    return failures


def collect_workflow_failures() -> list[dict]:
    """Collect workflow failure indicators from dream shallow-sleep reports.

    Note: Full GitHub API access requires actions context.
    Here we check dream journals for workflow health data.
    """
    failures = []
    for journal_fp in sorted(DREAMS_DIR.glob("20*.json"), reverse=True)[:7]:
        try:
            journal = json.loads(journal_fp.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        # Phase 2 may contain workflow analysis
        phase2 = journal.get("phase2", {})
        for item in phase2.get("stale_content", []):
            failures.append({
                "source": "workflow",
                "type": "stale_content",
                "date": journal.get("date", ""),
                "detail": item.get("description", ""),
            })

    return failures


# ============================================================
# Pattern analysis
# ============================================================


def analyze_patterns(failures: list[dict]) -> list[dict]:
    """Find recurring patterns in failures."""
    patterns = []

    # Group by type
    by_type = defaultdict(list)
    for f in failures:
        by_type[f["type"]].append(f)

    for ftype, items in by_type.items():
        if len(items) >= 2:
            patterns.append({
                "pattern": f"recurring_{ftype}",
                "count": len(items),
                "type": ftype,
                "examples": [i["detail"][:100] for i in items[:3]],
                "suggestion": _suggest_fix(ftype, items),
            })

    # Search failure analysis: common missing terms
    search_fails = [f for f in failures if f["source"] == "search"]
    if search_fails:
        all_queries = [f.get("query", "") for f in search_fails]
        # Find terms that appear in multiple failed queries
        term_counter = Counter()
        for q in all_queries:
            terms = set(re.findall(r"[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}", q.lower()))
            for t in terms:
                term_counter[t] += 1

        frequent_missing = [(t, c) for t, c in term_counter.most_common(5) if c >= 2]
        if frequent_missing:
            patterns.append({
                "pattern": "vocabulary_gap",
                "count": len(frequent_missing),
                "type": "search",
                "examples": [f"{t} (failed {c}x)" for t, c in frequent_missing],
                "suggestion": "扩充 knowledge_graph.py 的概念字典，添加这些高频失败查询词",
            })

    return patterns


def _suggest_fix(ftype: str, items: list) -> str:
    """Generate fix suggestion for a failure pattern."""
    suggestions = {
        "staleness": "检查相关文件是否需要更新时间戳，或内容已过时需要重写",
        "references": "修复断裂的文件引用路径，或删除指向已移除文件的引用",
        "memory_size": "考虑拆分或压缩过大的文件（>400行），提取核心内容",
        "no_results": "检索词汇覆盖不足，考虑扩充关键词字典或添加别名",
        "stale_content": "定期清理过时内容，在 REM 层自动检查",
    }
    return suggestions.get(ftype, f"分析 {ftype} 类型的失败原因，考虑自动化修复")


# ============================================================
# Lesson extraction
# ============================================================


def extract_lessons(patterns: list[dict]) -> list[dict]:
    """Convert failure patterns into structured lessons."""
    lessons = []
    for p in patterns:
        if p["count"] < 2:
            continue

        lesson = {
            "pattern": p["pattern"],
            "summary": f"{p['type']}类问题重复出现{p['count']}次",
            "examples": p["examples"],
            "suggestion": p["suggestion"],
            "auto_fixable": p["type"] in {"staleness", "references"},
            "created": TODAY.isoformat(),
        }
        lessons.append(lesson)

    return lessons


def get_next_lesson_number() -> int:
    """Get the next lesson number from lessons-learned.md."""
    if not LESSONS_FILE.exists():
        return 1
    text = LESSONS_FILE.read_text(encoding="utf-8")
    numbers = re.findall(r"^## (\d+)\.", text, re.MULTILINE)
    if numbers:
        return max(int(n) for n in numbers) + 1
    return 1


def write_lesson_to_file(lesson: dict, number: int) -> bool:
    """Append a lesson to lessons-learned.md."""
    if not LESSONS_FILE.exists():
        return False

    entry = f"""
## {number}. [Reflexion] {lesson['summary']}

- **模式**：{lesson['pattern']}
- **建议**：{lesson['suggestion']}
- **证据**：{'; '.join(lesson['examples'][:2])}
- **可自动修复**：{'是' if lesson['auto_fixable'] else '否'}
- **发现日期**：{lesson['created']}
"""

    text = LESSONS_FILE.read_text(encoding="utf-8")

    # Update timestamp
    text = re.sub(
        r"(> 最后更新：)\S+",
        f"\\g<1>{TODAY.isoformat()}",
        text,
        count=1,
    )

    text += entry

    LESSONS_FILE.write_text(text, encoding="utf-8")
    return True


def save_failure_insights(patterns: list[dict]):
    """Save failure patterns to insights.json."""
    if not patterns:
        return

    existing = []
    if INSIGHTS_FILE.exists():
        try:
            data = json.loads(INSIGHTS_FILE.read_text(encoding="utf-8"))
            existing = data.get("insights", data) if isinstance(data, dict) else data
            if isinstance(existing, dict):
                existing = existing.get("insights", [])
        except (json.JSONDecodeError, OSError):
            pass

    for i, p in enumerate(patterns):
        existing.append({
            "id": f"reflexion-{TODAY.isoformat()}-{i+1:03d}",
            "type": "failure_pattern",
            "summary": f"{p['type']}: {p['suggestion'][:80]}",
            "evidence": p["examples"][:3],
            "suggested_action": p["suggestion"],
            "auto_actionable": p.get("type") in {"staleness", "references"},
            "created": TODAY.isoformat(),
        })

    # Keep last 100
    existing = existing[-100:]

    INSIGHTS_FILE.write_text(
        json.dumps(existing, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ============================================================
# Search failure tracking (called from memory_search.py)
# ============================================================


def log_search_failure(query: str, tokens: list[str]):
    """Log a failed search query for later Reflexion analysis."""
    DREAMS_DIR.mkdir(parents=True, exist_ok=True)

    log = []
    if SEARCH_FAILURES_FILE.exists():
        try:
            log = json.loads(SEARCH_FAILURES_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    log.append({
        "date": TODAY.isoformat(),
        "timestamp": datetime.now().isoformat(),
        "query": query,
        "tokens": tokens[:20],
        "result_count": 0,
    })

    # Keep last 100
    log = log[-100:]

    SEARCH_FAILURES_FILE.write_text(
        json.dumps(log, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ============================================================
# Main scan
# ============================================================


def scan_all() -> dict:
    """Scan all failure sources, analyze patterns, extract lessons."""
    print(f"🔍 Reflexion 扫描 — {TODAY}\n")

    # Collect
    dream_fails = collect_dream_failures()
    search_fails = collect_search_failures()
    workflow_fails = collect_workflow_failures()
    all_failures = dream_fails + search_fails + workflow_fails

    print(f"  失败信号收集：")
    print(f"    Dream 检查：{len(dream_fails)} 个")
    print(f"    搜索失败：{len(search_fails)} 个")
    print(f"    Workflow：{len(workflow_fails)} 个")
    print(f"    总计：{len(all_failures)} 个")

    # Analyze
    patterns = analyze_patterns(all_failures)
    print(f"\n  模式分析：{len(patterns)} 个重复模式")
    for p in patterns:
        print(f"    - {p['pattern']}: {p['count']}次, {p['suggestion'][:60]}")

    # Extract lessons
    lessons = extract_lessons(patterns)
    print(f"\n  可提炼经验：{len(lessons)} 条")

    # Save insights
    if patterns:
        save_failure_insights(patterns)
        print(f"  → 已写入 insights.json")

    report = {
        "date": TODAY.isoformat(),
        "failures": {
            "dream": len(dream_fails),
            "search": len(search_fails),
            "workflow": len(workflow_fails),
            "total": len(all_failures),
        },
        "patterns": len(patterns),
        "lessons_extracted": len(lessons),
        "pattern_details": patterns,
    }

    return report


def main():
    args = sys.argv[1:]
    report_mode = "--report" in args

    report = scan_all()

    if report_mode:
        print(f"\n::reflexion::{json.dumps(report)}")

    print(f"\n  ✅ Reflexion 扫描完成")


if __name__ == "__main__":
    main()
