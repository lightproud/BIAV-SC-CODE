"""
Precomputed cache check.

Matches queries against cached question patterns to return precomputed
answers, respecting TTL for cache entry expiration.

Cache file format (INDEX_DIR/precomputed-cache.json):
{
    "generated": "ISO8601",
    "ttl_days": 30,
    "entries": [
        {
            "question_patterns": ["pattern1", "pattern2", ...],
            "answer": "...",
            "sources": ["file1.md", "file2.md"]
        }
    ]
}
"""

import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

from .. import config


_CACHE_FILE = "precomputed-cache.json"


def _load_cache() -> Optional[Dict[str, Any]]:
    """Load the precomputed cache file from INDEX_DIR."""
    path = Path(config.index_path(_CACHE_FILE))
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
        return None
    except (json.JSONDecodeError, OSError):
        return None


def _keyword_match_score(query: str, patterns: list) -> float:
    """
    Compute a match score between a query and a list of question patterns.

    Returns the fraction of patterns that have at least one keyword match
    with the query. Score is in [0.0, 1.0].
    """
    if not patterns:
        return 0.0

    query_lower = query.lower()
    query_words = set(query_lower.split())

    matched_patterns = 0
    for pattern in patterns:
        if not isinstance(pattern, str):
            continue
        pattern_lower = pattern.lower()
        pattern_words = set(pattern_lower.split())

        # Check if any query word appears in the pattern or vice versa
        if query_words & pattern_words:
            matched_patterns += 1
        elif query_lower in pattern_lower or pattern_lower in query_lower:
            matched_patterns += 1

    return matched_patterns / len(patterns)


def check(query: str) -> Dict[str, Any]:
    """
    Check the precomputed cache for a matching entry.

    Matches query keywords against cached question_patterns.
    Entries with a match score > 0.5 are considered hits.
    Expired entries (past TTL) are skipped.

    Args:
        query: The query string to check against cache.

    Returns:
        Dict with 'hit' (bool), 'entry' (dict or None), and 'message'.
    """
    cache = _load_cache()

    if cache is None:
        return {
            "hit": False,
            "entry": None,
            "message": "No cache file",
        }

    # Check global TTL
    ttl_days = cache.get("ttl_days", 30)
    generated_str = cache.get("generated", "")

    if generated_str:
        try:
            generated_dt = datetime.fromisoformat(generated_str)
            # Ensure timezone-aware comparison
            if generated_dt.tzinfo is None:
                generated_dt = generated_dt.replace(tzinfo=timezone.utc)
            expiry = generated_dt + timedelta(days=ttl_days)
            now = datetime.now(timezone.utc)
            if now > expiry:
                return {
                    "hit": False,
                    "entry": None,
                    "message": f"Cache expired (generated: {generated_str}, TTL: {ttl_days} days)",
                }
        except (ValueError, TypeError):
            # Cannot parse date, proceed anyway
            pass

    entries = cache.get("entries", [])
    if not entries:
        return {
            "hit": False,
            "entry": None,
            "message": "Cache is empty",
        }

    # Find best matching entry
    best_score = 0.0
    best_entry: Optional[Dict[str, Any]] = None

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        patterns = entry.get("question_patterns", [])
        score = _keyword_match_score(query, patterns)
        if score > best_score:
            best_score = score
            best_entry = entry

    if best_score > 0.5 and best_entry is not None:
        return {
            "hit": True,
            "entry": {
                "answer": best_entry.get("answer", ""),
                "sources": best_entry.get("sources", []),
                "match_score": round(best_score, 4),
            },
            "message": f"Cache hit (score: {best_score:.2f})",
        }

    return {
        "hit": False,
        "entry": None,
        "message": f"No matching entry (best score: {best_score:.2f})",
    }
