"""
4-layer context recommendation engine.

Merges signals from role defaults, semantic search, graph proximity,
and file utility to recommend the most relevant files for a query.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from .. import config


# -- Role default file lists --------------------------------------------------

# Predefined file lists per role. Paths are relative to DATA_ROOT.
_ROLE_DEFAULTS: Dict[str, List[str]] = {
    "Code-site": [
        "projects/site/CONTEXT.md",
        "memory/style-guide.md",
        "memory/lessons-learned.md",
    ],
    "Code-news": [
        "projects/news/CONTEXT.md",
        "projects/news/output/daily-latest.md",
        "memory/lessons-learned.md",
    ],
    "Code-wiki": [
        "projects/wiki/CONTEXT.md",
        "memory/morimens-context.md",
        "memory/lessons-learned.md",
    ],
    "Code-game": [
        "projects/game/CONTEXT.md",
        "memory/morimens-context.md",
    ],
}

# Default score assigned to role-default files
_ROLE_DEFAULT_SCORE = 0.8


# -- Layer functions ----------------------------------------------------------


def _layer_role_defaults(role: str) -> Dict[str, float]:
    """Layer 1: Role default files with a fixed score of 0.8."""
    if not role or role not in _ROLE_DEFAULTS:
        return {}
    return {f: _ROLE_DEFAULT_SCORE for f in _ROLE_DEFAULTS[role]}


def _layer_semantic_search(query: str, max_results: int = 10) -> Dict[str, float]:
    """
    Layer 2: Semantic search using the search engine if available.

    Falls back to empty results if the search module is not implemented.
    """
    if not query:
        return {}

    try:
        # Try to import the search engine (may not be implemented yet)
        from ..search import search  # type: ignore
        results = search(query, top_k=max_results)
        # Expect results to be a list of dicts with 'file' and 'score'
        if isinstance(results, list):
            return {
                r.get("file", ""): r.get("score", 0.0)
                for r in results
                if r.get("file")
            }
    except (ImportError, AttributeError, TypeError):
        pass

    return {}


def _layer_graph_proximity(query: str) -> Dict[str, float]:
    """
    Layer 3: Graph proximity using knowledge graph if available.

    1-hop neighbors get score 0.7, 2-hop get 0.4.
    Falls back to empty results if the graph module is not implemented.
    """
    if not query:
        return {}

    try:
        from ..graph import query as graph_query  # type: ignore
        result = graph_query(query, depth=2)
        if not isinstance(result, dict):
            return {}

        scores: Dict[str, float] = {}
        neighbors = result.get("neighbors", [])
        for neighbor in neighbors:
            node_file = neighbor.get("file", "")
            depth = neighbor.get("depth", 1)
            if not node_file:
                continue
            # 1-hop = 0.7, 2-hop = 0.4
            score = 0.7 if depth <= 1 else 0.4
            scores[node_file] = max(scores.get(node_file, 0.0), score)

        return scores
    except (ImportError, AttributeError, TypeError):
        pass

    return {}


def _layer_utility_boost() -> Dict[str, float]:
    """
    Layer 4: Utility score adjustment from memory-utility.json.

    Adjusts file scores by +/- 0.2 * (utility - 0.5).
    """
    try:
        from ..memory.utility import load_utility
        data = load_utility()
        if not data or "rankings" not in data:
            return {}

        adjustments: Dict[str, float] = {}
        for entry in data["rankings"]:
            file_path = entry.get("file", "")
            utility = entry.get("utility", 0.5)
            if file_path:
                # Adjustment: +/- 0.2 * (utility - 0.5)
                adjustments[file_path] = 0.2 * (utility - 0.5)
        return adjustments
    except (ImportError, AttributeError, TypeError):
        return {}


# -- Main recommender ---------------------------------------------------------


def recommend(
    query: str,
    role: str = "",
    max_files: int = 5,
) -> Dict[str, Any]:
    """
    Recommend context files for a query using 4-layer fusion.

    Layers:
      1. Role defaults (fixed score 0.8)
      2. Semantic search (scores from search engine)
      3. Graph proximity (1-hop=0.7, 2-hop=0.4)
      4. Utility boost (+/- 0.2 * (utility - 0.5))

    Args:
        query: The search query or topic description.
        role: Optional role identifier for role-specific defaults.
        max_files: Maximum number of files to recommend.

    Returns:
        Dict with query, role, recommended_files list, and context_summary.
    """
    # Collect scores from each layer
    role_scores = _layer_role_defaults(role)
    search_scores = _layer_semantic_search(query)
    graph_scores = _layer_graph_proximity(query)
    utility_adjustments = _layer_utility_boost()

    # Merge all scores -- for layers 1-3, keep max score per file
    merged: Dict[str, float] = {}
    reasons: Dict[str, str] = {}

    for file_path, score in role_scores.items():
        merged[file_path] = max(merged.get(file_path, 0.0), score)
        reasons[file_path] = "role default"

    for file_path, score in search_scores.items():
        if score > merged.get(file_path, 0.0):
            reasons[file_path] = "semantic match"
        merged[file_path] = max(merged.get(file_path, 0.0), score)

    for file_path, score in graph_scores.items():
        if score > merged.get(file_path, 0.0):
            reasons[file_path] = "graph proximity"
        merged[file_path] = max(merged.get(file_path, 0.0), score)

    # Apply utility adjustments (additive, not max)
    for file_path in merged:
        if file_path in utility_adjustments:
            merged[file_path] += utility_adjustments[file_path]

    # Also add files that only appear in utility but not yet in merged
    # (they get a base score of 0.0 + adjustment, which may be negative,
    # so only add if adjustment is positive)
    for file_path, adj in utility_adjustments.items():
        if file_path not in merged and adj > 0:
            merged[file_path] = adj
            reasons[file_path] = "high utility"

    # Sort descending and take top-N
    sorted_files = sorted(merged.items(), key=lambda x: x[1], reverse=True)
    top_files = sorted_files[:max_files]

    recommended: List[Dict[str, Any]] = []
    for file_path, score in top_files:
        recommended.append({
            "file": file_path,
            "score": round(score, 4),
            "reason": reasons.get(file_path, "utility"),
        })

    # Build a brief context summary
    if recommended:
        file_names = [r["file"].split("/")[-1] for r in recommended[:3]]
        summary = f"Top context files: {', '.join(file_names)}"
        if role:
            summary = f"[{role}] {summary}"
    else:
        summary = "No relevant context files found."

    return {
        "query": query,
        "role": role,
        "recommended_files": recommended,
        "context_summary": summary,
    }
