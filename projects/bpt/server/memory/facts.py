"""
Fact store with semantic deduplication.

Stores structured facts as JSON with bag-of-words cosine similarity
to detect duplicates and near-duplicates for merging.
"""

import json
import math
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .. import config
from ..search.tokenizer import tokenize


# -- Persistence -------------------------------------------------------------


def load_facts() -> List[Dict[str, Any]]:
    """Load facts from INDEX_DIR/facts.json. Return empty list if not found."""
    path = Path(config.index_path("facts.json"))
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        return []
    except (json.JSONDecodeError, OSError):
        return []


def save_facts(facts: List[Dict[str, Any]]) -> None:
    """Write facts to INDEX_DIR/facts.json with indent=2, ensure_ascii=False."""
    config.ensure_index_dir()
    path = config.index_path("facts.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(facts, f, indent=2, ensure_ascii=False)


# -- Cosine similarity -------------------------------------------------------


def _term_freq_vector(tokens: List[str]) -> Counter:
    """Build a term frequency counter from a token list."""
    return Counter(tokens)


def _cosine_similarity(vec_a: Counter, vec_b: Counter) -> float:
    """
    Compute cosine similarity between two term-frequency vectors.

    Returns 0.0 if either vector is empty.
    """
    if not vec_a or not vec_b:
        return 0.0

    # Intersection of keys
    common_keys = set(vec_a.keys()) & set(vec_b.keys())
    if not common_keys:
        return 0.0

    dot_product = sum(vec_a[k] * vec_b[k] for k in common_keys)
    magnitude_a = math.sqrt(sum(v * v for v in vec_a.values()))
    magnitude_b = math.sqrt(sum(v * v for v in vec_b.values()))

    if magnitude_a == 0.0 or magnitude_b == 0.0:
        return 0.0

    return dot_product / (magnitude_a * magnitude_b)


# -- Main entry point --------------------------------------------------------


def store_facts(input_str: str) -> Dict[str, Any]:
    """
    Store facts with semantic deduplication.

    Args:
        input_str: JSON array string (each item: {content, category?, source?})
                   or plain text (treated as a single fact).

    Returns:
        Summary dict with added/merged/duplicate counts and details.
    """
    # Parse input
    new_items = _parse_input(input_str)
    if not new_items:
        return {"added": 0, "merged": 0, "duplicate": 0, "details": []}

    existing_facts = load_facts()

    # Pre-tokenize existing facts
    existing_vectors: List[Counter] = []
    for fact in existing_facts:
        tokens = tokenize(fact.get("content", ""))
        existing_vectors.append(_term_freq_vector(tokens))

    added = 0
    merged = 0
    duplicate = 0
    details: List[Dict[str, Any]] = []
    now = datetime.now(timezone.utc).isoformat()

    for item in new_items:
        content = item.get("content", "").strip()
        if not content:
            continue

        category = item.get("category", "context")
        source = item.get("source", "")

        new_tokens = tokenize(content)
        new_vec = _term_freq_vector(new_tokens)

        # Find best match among existing facts
        best_sim = 0.0
        best_idx = -1
        for i, ev in enumerate(existing_vectors):
            sim = _cosine_similarity(new_vec, ev)
            if sim > best_sim:
                best_sim = sim
                best_idx = i

        if best_sim >= 0.95:
            # Duplicate -- skip
            duplicate += 1
            details.append({
                "action": "duplicate",
                "content": content,
                "similarity": round(best_sim, 4),
            })

        elif best_sim >= 0.65 and best_idx >= 0:
            # Merge -- update existing fact
            fact = existing_facts[best_idx]
            fact["content"] = content
            fact["confidence"] = min(1.0, fact.get("confidence", 0.5) + 0.05)
            fact["merge_count"] = fact.get("merge_count", 0) + 1
            fact["updated"] = now
            if source and source not in fact.get("sources", []):
                fact.setdefault("sources", []).append(source)
            # Update the vector cache
            existing_vectors[best_idx] = new_vec
            merged += 1
            details.append({
                "action": "merged",
                "content": content,
                "similarity": round(best_sim, 4),
            })

        else:
            # New fact
            new_fact: Dict[str, Any] = {
                "id": str(uuid.uuid4()),
                "content": content,
                "category": category,
                "confidence": 0.5,
                "sources": [source] if source else [],
                "created": now,
                "updated": now,
                "merge_count": 0,
                "obsolete": False,
            }
            existing_facts.append(new_fact)
            existing_vectors.append(new_vec)
            added += 1
            details.append({
                "action": "added",
                "content": content,
                "similarity": round(best_sim, 4),
            })

    # Enforce MAX_FACTS limit -- drop lowest confidence facts
    if len(existing_facts) > config.MAX_FACTS:
        existing_facts.sort(key=lambda f: f.get("confidence", 0), reverse=True)
        existing_facts = existing_facts[: config.MAX_FACTS]

    save_facts(existing_facts)

    return {
        "added": added,
        "merged": merged,
        "duplicate": duplicate,
        "details": details,
    }


# -- Input parsing -----------------------------------------------------------


def _parse_input(input_str: str) -> List[Dict[str, Any]]:
    """
    Parse input as JSON array or plain text.

    Returns a list of dicts, each with at least a 'content' key.
    """
    input_str = input_str.strip()
    if not input_str:
        return []

    # Try JSON array first
    try:
        parsed = json.loads(input_str)
        if isinstance(parsed, list):
            items: List[Dict[str, Any]] = []
            for entry in parsed:
                if isinstance(entry, dict) and "content" in entry:
                    items.append(entry)
                elif isinstance(entry, str):
                    items.append({"content": entry})
            return items
        elif isinstance(parsed, dict) and "content" in parsed:
            return [parsed]
    except (json.JSONDecodeError, TypeError):
        pass

    # Fall back to plain text (single fact)
    return [{"content": input_str}]
