"""Dream persistence — journal, insights and access-log read/write.

Extracted from dream.py.
"""

import json
from datetime import datetime

from dream_config import (
    ACCESS_LOG_DIR, ACCESS_LOG_LEGACY, DREAMS_DIR, INSIGHTS_FILE, REPO,
    TODAY, _get_branch,
)


def save_dream_journal(phase1_results: dict, phase2_results: dict = None):
    """Save dream journal entry."""
    DREAMS_DIR.mkdir(parents=True, exist_ok=True)

    journal = {
        "date": TODAY.isoformat(),
        "timestamp": datetime.now().isoformat(),
        "branch": _get_branch(),
        "phase1": phase1_results,
    }
    if phase2_results:
        journal["phase2"] = phase2_results

    journal_file = DREAMS_DIR / f"{TODAY.isoformat()}.json"
    journal_file.write_text(
        json.dumps(journal, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Also save/update insights.json
    if phase2_results and "insights" in phase2_results:
        save_insights(phase2_results["insights"])

    return str(journal_file.relative_to(REPO))


def save_insights(new_insights: list):
    """Append new insights to the cumulative insights.json (Voyager-style skill library)."""
    DREAMS_DIR.mkdir(parents=True, exist_ok=True)

    existing = []
    if INSIGHTS_FILE.exists():
        try:
            existing = json.loads(INSIGHTS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    for i, insight in enumerate(new_insights):
        insight["id"] = f"insight-{TODAY.isoformat()}-{i+1:03d}"
        insight["created"] = TODAY.isoformat()
        existing.append(insight)

    # Keep last 100 insights
    existing = existing[-100:]

    INSIGHTS_FILE.write_text(
        json.dumps(existing, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_access_log(last_n: int = 30) -> list[dict]:
    """Load access log entries from per-day files (with legacy fallback).

    Returns a sorted list of entry dicts, newest last.
    """
    entries = []

    # New format: one file per day in access-log/ directory
    if ACCESS_LOG_DIR.exists():
        for f in sorted(ACCESS_LOG_DIR.glob("*.json")):
            try:
                entries.append(json.loads(f.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, OSError):
                pass

    # Legacy fallback: single access-log.json array
    if not entries and ACCESS_LOG_LEGACY.exists():
        try:
            entries = json.loads(ACCESS_LOG_LEGACY.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    entries.sort(key=lambda e: e.get("date", ""))
    return entries[-last_n:]


def log_access(files_accessed: list[str]):
    """Log which files were accessed during this dream run (feedback loop)."""
    ACCESS_LOG_DIR.mkdir(parents=True, exist_ok=True)

    entry = {
        "date": TODAY.isoformat(),
        "timestamp": datetime.now().isoformat(),
        "branch": _get_branch(),
        "files_scanned": files_accessed,
        "count": len(files_accessed),
    }

    entry_file = ACCESS_LOG_DIR / f"{TODAY.isoformat()}.json"
    entry_file.write_text(
        json.dumps(entry, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Cleanup: keep last 30 days of files
    all_files = sorted(ACCESS_LOG_DIR.glob("*.json"))
    for old_file in all_files[:-30]:
        old_file.unlink()
