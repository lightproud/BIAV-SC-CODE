"""
session_reflexion.py — Session-end reflexion hook

Triggered automatically when a Claude Code session ends (Stop hook).
Performs a lightweight reflexion scan and updates lessons-learned.md
if new patterns are found.

Also captures session metadata for long-term tracking.

Usage (automatic via .claude/settings.json Stop hook):
  python scripts/session_reflexion.py

Manual:
  python scripts/session_reflexion.py --verbose
"""

import json
import sys
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DREAMS_DIR = REPO / "memory" / "dreams"
SESSION_LOG = DREAMS_DIR / "session-log.json"

# Import reflexion module
sys.path.insert(0, str(REPO / "scripts"))
from reflexion import (
    collect_dream_failures,
    collect_search_failures,
    collect_workflow_failures,
    analyze_patterns,
    extract_lessons,
    get_next_lesson_number,
    write_lesson_to_file,
    save_failure_insights,
)

TODAY = date.today()
VERBOSE = "--verbose" in sys.argv


def log(msg: str):
    if VERBOSE:
        print(msg)


def log_session():
    """Record session end timestamp for frequency tracking."""
    DREAMS_DIR.mkdir(parents=True, exist_ok=True)

    sessions = []
    if SESSION_LOG.exists():
        try:
            sessions = json.loads(SESSION_LOG.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    sessions.append({
        "date": TODAY.isoformat(),
        "timestamp": datetime.now().isoformat(),
        "type": "session_end",
    })

    # Keep last 200 entries
    sessions = sessions[-200:]

    SESSION_LOG.write_text(
        json.dumps(sessions, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log(f"  Session logged ({len(sessions)} total)")


def run_reflexion():
    """Run lightweight reflexion scan and write new lessons if found."""
    log(f"Session-end Reflexion — {TODAY}")

    # Collect failures
    dream_fails = collect_dream_failures()
    search_fails = collect_search_failures()
    workflow_fails = collect_workflow_failures()
    all_failures = dream_fails + search_fails + workflow_fails

    log(f"  Failures: dream={len(dream_fails)} search={len(search_fails)} workflow={len(workflow_fails)}")

    if not all_failures:
        log("  No failures detected, skipping pattern analysis")
        return 0

    # Analyze patterns
    patterns = analyze_patterns(all_failures)
    log(f"  Patterns found: {len(patterns)}")

    if not patterns:
        log("  No recurring patterns")
        return 0

    # Extract lessons
    lessons = extract_lessons(patterns)
    log(f"  Lessons extracted: {len(lessons)}")

    # Check for duplicates against existing lessons
    from reflexion import LESSONS_FILE
    existing_text = ""
    if LESSONS_FILE.exists():
        existing_text = LESSONS_FILE.read_text(encoding="utf-8")

    new_lessons = 0
    next_num = get_next_lesson_number()

    for lesson in lessons:
        # Skip if the pattern is already recorded
        if lesson["pattern"] in existing_text:
            log(f"  Skipping duplicate: {lesson['pattern']}")
            continue

        if write_lesson_to_file(lesson, next_num):
            log(f"  New lesson #{next_num}: {lesson['summary']}")
            next_num += 1
            new_lessons += 1

    # Save insights
    if patterns:
        save_failure_insights(patterns)
        log(f"  Insights saved")

    if new_lessons > 0:
        log(f"\n  {new_lessons} new lesson(s) written to lessons-learned.md")
    else:
        log(f"\n  No new lessons (all patterns already recorded)")

    return new_lessons


def main():
    try:
        log_session()
        new_lessons = run_reflexion()

        # Only print summary in non-verbose mode if there are new lessons
        if not VERBOSE and new_lessons > 0:
            print(f"[Reflexion] {new_lessons} new lesson(s) extracted")

    except Exception as e:
        # Never fail the hook — just log silently
        if VERBOSE:
            print(f"  Reflexion error: {e}")


if __name__ == "__main__":
    main()
