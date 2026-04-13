"""
Change detection via file mtime (no git dependency).

Scans DATA_ROOT, compares file modification times against a stored snapshot,
and extracts facts from changed files using regex patterns.
"""

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List

from .. import config


# -- Snapshot file path -------------------------------------------------------

_SNAPSHOT_FILE = "file-snapshots.json"


# -- Fact extraction patterns -------------------------------------------------

# Regex patterns that indicate extractable knowledge in file content.
_FACT_PATTERNS: List[re.Pattern] = [
    re.compile(r"(?:decided to|decision:\s*)(.+)", re.IGNORECASE),
    re.compile(r"(?:chose\s+.+?\s+over\s+.+?)(.+)", re.IGNORECASE),
    re.compile(r"(?:bug caused by|root cause:\s*)(.+)", re.IGNORECASE),
    re.compile(r"(?:lesson:\s*)(.+)", re.IGNORECASE),
    re.compile(r"(?:note:\s*)(.+)", re.IGNORECASE),
    re.compile(r"(?:important:\s*)(.+)", re.IGNORECASE),
    re.compile(r"(?:convention:\s*)(.+)", re.IGNORECASE),
    re.compile(r"(?:preference:\s*)(.+)", re.IGNORECASE),
    re.compile(r"(?:discovery:\s*)(.+)", re.IGNORECASE),
    re.compile(r"(?:workaround:\s*)(.+)", re.IGNORECASE),
]

# Categories mapped from pattern keywords
_PATTERN_CATEGORIES: Dict[str, str] = {
    "decided": "decision",
    "decision": "decision",
    "chose": "decision",
    "bug": "discovery",
    "root cause": "discovery",
    "lesson": "lesson",
    "note": "context",
    "important": "context",
    "convention": "convention",
    "preference": "preference",
    "discovery": "discovery",
    "workaround": "lesson",
}


# -- Snapshot management ------------------------------------------------------


def _load_snapshot() -> Dict[str, Dict[str, Any]]:
    """Load the previous file mtime snapshot from INDEX_DIR."""
    path = Path(config.index_path(_SNAPSHOT_FILE))
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


def _save_snapshot(snapshot: Dict[str, Dict[str, Any]]) -> None:
    """Save the current file mtime snapshot to INDEX_DIR."""
    config.ensure_index_dir()
    path = config.index_path(_SNAPSHOT_FILE)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)


# -- File scanning ------------------------------------------------------------


def _scan_current_files() -> Dict[str, Dict[str, Any]]:
    """
    Scan DATA_ROOT and collect current mtime + size for each file.

    Returns a dict keyed by relative path.
    """
    current: Dict[str, Dict[str, Any]] = {}
    root = Path(config.DATA_ROOT)

    if not root.exists():
        return current

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

            rel_path = str(fpath.relative_to(root))
            current[rel_path] = {
                "mtime": stat.st_mtime,
                "size": stat.st_size,
            }

    return current


# -- Change detection ---------------------------------------------------------


def detect_changes() -> Dict[str, Any]:
    """
    Detect file changes by comparing current mtime/size against stored snapshot.

    Saves the new snapshot after comparison.

    Returns:
        Dict with 'added', 'modified', 'removed' file lists and 'total_changes'.
    """
    previous = _load_snapshot()
    current = _scan_current_files()

    prev_keys = set(previous.keys())
    curr_keys = set(current.keys())

    added = sorted(curr_keys - prev_keys)
    removed = sorted(prev_keys - curr_keys)

    modified: List[str] = []
    for path in sorted(curr_keys & prev_keys):
        prev_info = previous[path]
        curr_info = current[path]
        if curr_info["mtime"] != prev_info.get("mtime") or \
           curr_info["size"] != prev_info.get("size"):
            modified.append(path)

    # Save new snapshot
    _save_snapshot(current)

    return {
        "added": added,
        "modified": modified,
        "removed": removed,
        "total_changes": len(added) + len(modified) + len(removed),
    }


# -- Fact extraction ----------------------------------------------------------


def _categorize_match(match_text: str) -> str:
    """Determine a fact category from the matched text context."""
    lower = match_text.lower()
    for keyword, category in _PATTERN_CATEGORIES.items():
        if keyword in lower:
            return category
    return "context"


def _extract_facts_from_file(rel_path: str) -> List[Dict[str, str]]:
    """
    Extract facts from a single file using regex patterns.

    Returns a list of dicts with 'content', 'category', and 'source'.
    """
    abs_path = str(Path(config.DATA_ROOT) / rel_path)
    ext = Path(rel_path).suffix.lower()

    # Only extract from text-readable formats
    text_extensions = {".md", ".txt", ".py", ".js", ".ts", ".cs", ".lua"}
    if ext not in text_extensions:
        return []

    try:
        with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except OSError:
        return []

    facts: List[Dict[str, str]] = []
    seen_contents: set = set()

    for pattern in _FACT_PATTERNS:
        for match in pattern.finditer(content):
            extracted = match.group(1).strip()
            # Skip very short or very long matches
            if len(extracted) < 10 or len(extracted) > 500:
                continue
            # Deduplicate within the same file
            if extracted in seen_contents:
                continue
            seen_contents.add(extracted)

            category = _categorize_match(match.group(0))
            facts.append({
                "content": extracted,
                "category": category,
                "source": rel_path,
            })

    return facts


# -- Writeback ----------------------------------------------------------------


def writeback(dry_run: bool = False) -> Dict[str, Any]:
    """
    Detect changes and extract facts from added/modified files.

    Args:
        dry_run: If True, detect changes and extract facts but do not
                 persist them to the fact store.

    Returns:
        Dict with status, change count, and facts extracted count.
    """
    changes = detect_changes()
    changed_files = changes["added"] + changes["modified"]

    all_extracted: List[Dict[str, str]] = []
    for rel_path in changed_files:
        file_facts = _extract_facts_from_file(rel_path)
        all_extracted.extend(file_facts)

    facts_stored = 0
    if not dry_run and all_extracted:
        # Lazy import to avoid circular dependency
        from .facts import store_facts
        import json as _json

        input_str = _json.dumps(all_extracted, ensure_ascii=False)
        result = store_facts(input_str)
        facts_stored = result.get("added", 0) + result.get("merged", 0)

    return {
        "status": "ok",
        "changes": changes["total_changes"],
        "facts_extracted": len(all_extracted) if dry_run else facts_stored,
    }
