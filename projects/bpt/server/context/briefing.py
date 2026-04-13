"""
Session briefing generator using mtime scanning (no git dependency).

Produces a structured briefing with recent changes, utility trends,
and recommended context for a new session.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .. import config


# -- Session continuity -------------------------------------------------------

_CONTINUITY_FILE = "session-continuity.json"


def _load_continuity() -> Dict[str, Any]:
    """Load session continuity state from INDEX_DIR."""
    path = Path(config.index_path(_CONTINUITY_FILE))
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
        return {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save_continuity(data: Dict[str, Any]) -> None:
    """Save session continuity state to INDEX_DIR."""
    config.ensure_index_dir()
    path = config.index_path(_CONTINUITY_FILE)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# -- File scanning for recent changes ----------------------------------------


def _find_recently_modified(since_timestamp: float, max_files: int = 20) -> List[Dict[str, Any]]:
    """
    Scan DATA_ROOT for files modified after the given timestamp.

    Returns a list of file info dicts sorted by mtime descending.
    """
    root = Path(config.DATA_ROOT)
    if not root.exists():
        return []

    recent: List[Dict[str, Any]] = []

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in config.SKIP_DIRS]

        for fname in filenames:
            fpath = Path(dirpath) / fname
            ext = fpath.suffix.lower()

            if ext not in config.INDEXABLE_EXTENSIONS:
                continue

            try:
                stat = fpath.stat()
            except OSError:
                continue

            if stat.st_size > config.MAX_FILE_SIZE:
                continue

            if stat.st_mtime > since_timestamp:
                rel_path = str(fpath.relative_to(root))
                recent.append({
                    "file": rel_path,
                    "mtime": stat.st_mtime,
                    "mtime_iso": datetime.fromtimestamp(
                        stat.st_mtime, tz=timezone.utc
                    ).isoformat(),
                    "size": stat.st_size,
                })

    # Sort by mtime descending (most recent first)
    recent.sort(key=lambda x: x["mtime"], reverse=True)
    return recent[:max_files]


# -- Briefing generation ------------------------------------------------------


def generate_briefing(role: str = "") -> Dict[str, Any]:
    """
    Generate a session briefing with recent changes and recommendations.

    Sections:
      1. Last session summary (from continuity file)
      2. Files changed since last session
      3. Top utility files
      4. Recommended context (via recommender if available)

    Args:
        role: Optional role identifier for role-specific recommendations.

    Returns:
        Dict with briefing_markdown, sections list, and generated_at timestamp.
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    now_ts = now.timestamp()

    continuity = _load_continuity()
    last_session_ts = continuity.get("last_session_timestamp", 0)
    last_summary = continuity.get("last_session_summary", "")

    sections: List[Dict[str, Any]] = []
    md_parts: List[str] = ["# Session Briefing", ""]

    # -- Section 1: Last session summary --
    if last_summary:
        md_parts.append("## Last Session")
        md_parts.append("")
        md_parts.append(last_summary)
        md_parts.append("")
        sections.append({"title": "Last Session", "content": last_summary})
    else:
        md_parts.append("## Last Session")
        md_parts.append("")
        md_parts.append("No previous session recorded.")
        md_parts.append("")
        sections.append({"title": "Last Session", "content": "No previous session recorded."})

    # -- Section 2: Files changed since last session --
    if last_session_ts > 0:
        recent_files = _find_recently_modified(last_session_ts)
    else:
        # First session: show files modified in the last 24 hours
        recent_files = _find_recently_modified(now_ts - 86400)

    md_parts.append("## Recent Changes")
    md_parts.append("")
    if recent_files:
        for finfo in recent_files:
            md_parts.append(f"- `{finfo['file']}` (modified: {finfo['mtime_iso']})")
        md_parts.append("")
        sections.append({
            "title": "Recent Changes",
            "content": f"{len(recent_files)} file(s) changed",
            "files": [f["file"] for f in recent_files],
        })
    else:
        md_parts.append("No files changed since last session.")
        md_parts.append("")
        sections.append({
            "title": "Recent Changes",
            "content": "No changes detected",
            "files": [],
        })

    # -- Section 3: Top utility files --
    md_parts.append("## Top Utility Files")
    md_parts.append("")
    try:
        from ..memory.utility import load_utility
        utility_data = load_utility()
        if utility_data and "rankings" in utility_data:
            top_5 = utility_data["rankings"][:5]
            for entry in top_5:
                md_parts.append(
                    f"- `{entry['file']}` (utility: {entry['utility']}, trend: {entry['trend']})"
                )
            md_parts.append("")
            sections.append({
                "title": "Top Utility Files",
                "content": f"{len(top_5)} top files",
                "files": [e["file"] for e in top_5],
            })
        else:
            md_parts.append("No utility data available. Run utility computation first.")
            md_parts.append("")
            sections.append({
                "title": "Top Utility Files",
                "content": "No data available",
            })
    except (ImportError, AttributeError):
        md_parts.append("Utility module not available.")
        md_parts.append("")
        sections.append({
            "title": "Top Utility Files",
            "content": "Module not available",
        })

    # -- Section 4: Recommended context --
    md_parts.append("## Recommended Context")
    md_parts.append("")
    try:
        from .recommender import recommend
        query_hint = role if role else "general project overview"
        rec = recommend(query=query_hint, role=role, max_files=5)
        if rec.get("recommended_files"):
            for rf in rec["recommended_files"]:
                md_parts.append(
                    f"- `{rf['file']}` (score: {rf['score']}, reason: {rf['reason']})"
                )
            md_parts.append("")
            sections.append({
                "title": "Recommended Context",
                "content": rec.get("context_summary", ""),
                "files": [rf["file"] for rf in rec["recommended_files"]],
            })
        else:
            md_parts.append("No specific recommendations.")
            md_parts.append("")
            sections.append({
                "title": "Recommended Context",
                "content": "No recommendations",
            })
    except (ImportError, AttributeError):
        md_parts.append("Recommender module not available.")
        md_parts.append("")
        sections.append({
            "title": "Recommended Context",
            "content": "Module not available",
        })

    # -- Update session continuity --
    continuity["last_session_timestamp"] = now_ts
    continuity["last_session_iso"] = now_iso
    continuity["last_role"] = role
    # Keep previous summary; it will be updated by session-end hooks
    _save_continuity(continuity)

    briefing_md = "\n".join(md_parts)

    return {
        "briefing_markdown": briefing_md,
        "sections": sections,
        "generated_at": now_iso,
    }
