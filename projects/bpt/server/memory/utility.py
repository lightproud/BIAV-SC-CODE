"""
File utility ranking with EMA (Exponential Moving Average).

Computes a composite utility score for each file in DATA_ROOT using
four weighted signals: engagement, insight citations, recency, and momentum.
"""

import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .. import config


# -- Signal weights -----------------------------------------------------------

WEIGHT_ENGAGEMENT = 0.30
WEIGHT_CITATIONS = 0.25
WEIGHT_RECENCY = 0.25
WEIGHT_MOMENTUM = 0.20

# Recency decay constant (half-life ~14 days)
RECENCY_DECAY = 0.05

# Momentum reference: 7 days in seconds
MOMENTUM_WINDOW_SECS = 7 * 24 * 3600


# -- File scanning ------------------------------------------------------------


def _scan_files() -> List[Dict[str, Any]]:
    """
    Scan DATA_ROOT for indexable files, returning file info dicts.

    Respects INDEXABLE_EXTENSIONS, SKIP_DIRS, and MAX_FILE_SIZE from config.
    """
    files: List[Dict[str, Any]] = []
    root = Path(config.DATA_ROOT)

    if not root.exists():
        return files

    for dirpath, dirnames, filenames in os.walk(root):
        # Skip excluded directories (in-place modification)
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
            files.append({
                "path": rel_path,
                "abs_path": str(fpath),
                "size": stat.st_size,
                "mtime": stat.st_mtime,
            })

    return files


def _count_citations(files: List[Dict[str, Any]]) -> Dict[str, int]:
    """
    Count how many times each file's relative path appears in other files.

    This is a simple cross-reference count used as an 'insight citation' signal.
    Only scans text-based files (not office formats) for performance.
    """
    text_extensions = {".md", ".txt", ".py", ".js", ".ts", ".cs", ".lua", ".json", ".csv"}
    citations: Dict[str, int] = {f["path"]: 0 for f in files}
    path_set = set(citations.keys())

    for finfo in files:
        ext = Path(finfo["path"]).suffix.lower()
        if ext not in text_extensions:
            continue

        try:
            with open(finfo["abs_path"], "r", encoding="utf-8", errors="ignore") as fh:
                content = fh.read()
        except OSError:
            continue

        for target_path in path_set:
            if target_path == finfo["path"]:
                continue
            # Check for path references (both forward-slash and basename matches)
            basename = Path(target_path).name
            if target_path in content or basename in content:
                citations[target_path] = citations.get(target_path, 0) + 1

    return citations


# -- Utility computation -----------------------------------------------------


def compute_utility() -> Dict[str, Any]:
    """
    Compute utility rankings for all files in DATA_ROOT.

    Four signals (weighted):
      - engagement (0.30): file size normalized (larger = more content)
      - insight_citations (0.25): cross-reference count, normalized
      - recency (0.25): exp(-0.05 * days_since_modified)
      - momentum (0.20): current recency vs estimated 7-day-old recency

    Saves results to INDEX_DIR/memory-utility.json.

    Returns:
        Dict with 'rankings' (sorted list) and 'total_files' count.
    """
    files = _scan_files()

    if not files:
        result: Dict[str, Any] = {"rankings": [], "total_files": 0}
        _save_utility(result)
        return result

    now = time.time()

    # -- Raw signal computation --

    sizes = [f["size"] for f in files]
    max_size = max(sizes) if sizes else 1
    # Avoid division by zero
    if max_size == 0:
        max_size = 1

    citations = _count_citations(files)
    max_citations = max(citations.values()) if citations.values() else 1
    if max_citations == 0:
        max_citations = 1

    rankings: List[Dict[str, Any]] = []

    for finfo in files:
        rel_path = finfo["path"]

        # Signal 1: Engagement (file size as proxy, normalized 0-1)
        engagement = finfo["size"] / max_size

        # Signal 2: Insight citations (normalized 0-1)
        cite_count = citations.get(rel_path, 0)
        insight = cite_count / max_citations

        # Signal 3: Recency -- exponential decay
        days_since_modified = (now - finfo["mtime"]) / 86400.0
        recency = math.exp(-RECENCY_DECAY * days_since_modified)

        # Signal 4: Momentum -- compare current recency vs hypothetical
        # 7-day-old mtime recency
        days_plus_7 = days_since_modified + 7.0
        recency_old = math.exp(-RECENCY_DECAY * days_plus_7)
        momentum = recency - recency_old  # positive = trending up

        # Normalize momentum to 0-1 range (momentum is always in [0, ~0.3])
        # Clamp and scale
        momentum_normalized = max(0.0, min(1.0, momentum / 0.3))

        # EMA combine
        utility = (
            WEIGHT_ENGAGEMENT * engagement
            + WEIGHT_CITATIONS * insight
            + WEIGHT_RECENCY * recency
            + WEIGHT_MOMENTUM * momentum_normalized
        )

        # Determine trend label
        if momentum > 0.1:
            trend = "rising"
        elif momentum > 0.01:
            trend = "stable"
        else:
            trend = "declining"

        rankings.append({
            "file": rel_path,
            "utility": round(utility, 4),
            "trend": trend,
            "access_count": cite_count,
        })

    # Sort descending by utility
    rankings.sort(key=lambda r: r["utility"], reverse=True)

    result = {
        "rankings": rankings,
        "total_files": len(rankings),
    }

    _save_utility(result)
    return result


# -- Persistence -------------------------------------------------------------


def _save_utility(data: Dict[str, Any]) -> None:
    """Save utility data to INDEX_DIR/memory-utility.json."""
    config.ensure_index_dir()
    path = config.index_path("memory-utility.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def load_utility() -> Optional[Dict[str, Any]]:
    """
    Load utility rankings from memory-utility.json.

    Returns None if the file does not exist or is invalid.
    """
    path = Path(config.index_path("memory-utility.json"))
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
