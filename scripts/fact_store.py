"""
fact_store.py — AI-driven Fact Storage with Semantic Deduplication

Stores knowledge facts written by AI during conversations.
Uses TF-IDF cosine similarity for deduplication — if a new fact
is >0.8 similar to an existing one, it merges instead of duplicating.

This is the "write" half of the memory read-write loop.
The "read" half is memory_search.py.

Usage:
  python scripts/fact_store.py --add "事实内容" --category decision
  python scripts/fact_store.py --list
  python scripts/fact_store.py --stats
"""

import json
import math
import sys
from collections import Counter
from datetime import date
from pathlib import Path

from text_utils import tokenize as tokenize_text

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
from io_utils import write_text_atomic
FACTS_FILE = REPO / "memory" / "facts.json"
TODAY = date.today()

# Similarity threshold for dedup (0.65 accounts for Chinese bigram variation)
DEDUP_THRESHOLD = 0.65

# Valid categories
CATEGORIES = {
    "decision",     # 架构/技术决策
    "discovery",    # 发现的事实（bug原因、行为特征）
    "preference",   # 用户偏好
    "convention",   # 项目惯例
    "context",      # 背景知识（为什么这样做）
    "lesson",       # 经验教训
}


# ============================================================
# Tokenizer (shared logic with memory_search.py)
# ============================================================

STOP_WORDS = {"the", "and", "for", "that", "this", "with", "from", "are", "was",
              "will", "but", "not", "have", "has", "had", "been", "can", "its",
              "which", "each", "other", "into", "only", "also", "than", "then",
              "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都",
              "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你",
              "会", "着", "没有", "看", "好", "自己", "这"}


def tokenize(text: str) -> list[str]:
    """Tokenize text into Chinese bigrams + English words (fact-store stop words)."""
    return tokenize_text(text, STOP_WORDS)


def cosine_similarity(tokens_a: list[str], tokens_b: list[str]) -> float:
    """Cosine similarity between two token lists."""
    if not tokens_a or not tokens_b:
        return 0.0

    counter_a = Counter(tokens_a)
    counter_b = Counter(tokens_b)
    all_tokens = set(counter_a.keys()) | set(counter_b.keys())

    dot = sum(counter_a.get(t, 0) * counter_b.get(t, 0) for t in all_tokens)
    norm_a = math.sqrt(sum(v * v for v in counter_a.values()))
    norm_b = math.sqrt(sum(v * v for v in counter_b.values()))

    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


# ============================================================
# Fact storage
# ============================================================


def load_facts() -> list[dict]:
    """Load existing facts from disk."""
    if not FACTS_FILE.exists():
        return []
    try:
        return json.loads(FACTS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def save_facts(facts: list[dict]):
    """Save facts to disk."""
    write_text_atomic(FACTS_FILE, json.dumps(facts, ensure_ascii=False, indent=2))


def find_duplicate(new_fact: str, existing_facts: list[dict]) -> tuple[int, float]:
    """Find the most similar existing fact. Returns (index, similarity)."""
    new_tokens = tokenize(new_fact)
    if not new_tokens:
        return -1, 0.0

    best_idx = -1
    best_sim = 0.0

    for i, fact in enumerate(existing_facts):
        if fact.get("obsolete"):
            continue
        existing_tokens = tokenize(fact["content"])
        sim = cosine_similarity(new_tokens, existing_tokens)
        if sim > best_sim:
            best_sim = sim
            best_idx = i

    return best_idx, best_sim


def _next_fact_id(facts: list[dict]) -> str:
    """Monotonic fact ID: max existing numeric id + 1.

    Survives the 500-cap trim because surviving facts keep their ids,
    so len(facts) can no longer drive collisions.
    """
    max_num = 0
    for f in facts:
        fid = f.get("id", "")
        if fid.startswith("f-"):
            try:
                max_num = max(max_num, int(fid[2:]))
            except ValueError:
                continue
    return f"f-{max_num + 1:04d}"


def store_fact(content: str, category: str = "discovery",
               source: str = "", confidence: float = 0.9) -> dict:
    """Store a new fact with deduplication.

    Returns:
        dict with keys: action ("added"|"merged"|"duplicate"), fact, similarity
    """
    if category not in CATEGORIES:
        category = "discovery"

    facts = load_facts()

    # Dedup check
    dup_idx, similarity = find_duplicate(content, facts)

    if similarity >= 0.95:
        # Near-identical — skip
        return {
            "action": "duplicate",
            "similarity": round(similarity, 3),
            "existing": facts[dup_idx]["content"][:100],
        }

    if similarity >= DEDUP_THRESHOLD:
        # Similar — merge (keep newer content, bump confidence)
        old_fact = facts[dup_idx]
        old_fact["content"] = content  # Update to newer phrasing
        old_fact["updated"] = TODAY.isoformat()
        old_fact["confidence"] = min(1.0, old_fact.get("confidence", 0.8) + 0.05)
        old_fact["merge_count"] = old_fact.get("merge_count", 0) + 1
        if source and source not in old_fact.get("sources", []):
            old_fact.setdefault("sources", []).append(source)

        save_facts(facts)
        return {
            "action": "merged",
            "similarity": round(similarity, 3),
            "fact": old_fact,
        }

    # New fact
    new_fact = {
        "id": _next_fact_id(facts),
        "content": content,
        "category": category,
        "confidence": confidence,
        "sources": [source] if source else [],
        "created": TODAY.isoformat(),
        "updated": TODAY.isoformat(),
        "merge_count": 0,
        "obsolete": False,
    }
    facts.append(new_fact)

    # Keep facts manageable (max 500)
    if len(facts) > 500:
        # Remove lowest confidence obsolete facts first
        facts.sort(key=lambda f: (not f.get("obsolete", False), f.get("confidence", 0)))
        facts = facts[-500:]

    save_facts(facts)
    return {
        "action": "added",
        "fact": new_fact,
    }


def store_multiple_facts(facts_input: list[dict]) -> list[dict]:
    """Store multiple facts at once. Each item: {content, category?, source?}."""
    results = []
    for item in facts_input:
        content = item.get("content", "")
        if not content or len(content) < 5:
            continue
        result = store_fact(
            content=content,
            category=item.get("category", "discovery"),
            source=item.get("source", ""),
            confidence=item.get("confidence", 0.9),
        )
        results.append(result)
    return results


def mark_obsolete(fact_id: str, reason: str = "") -> bool:
    """Mark a fact as obsolete (soft delete)."""
    facts = load_facts()
    for fact in facts:
        if fact["id"] == fact_id:
            fact["obsolete"] = True
            fact["obsolete_reason"] = reason
            fact["updated"] = TODAY.isoformat()
            save_facts(facts)
            return True
    return False


def get_stats() -> dict:
    """Get fact store statistics."""
    facts = load_facts()
    active = [f for f in facts if not f.get("obsolete")]

    by_category = Counter(f["category"] for f in active)

    return {
        "total": len(facts),
        "active": len(active),
        "obsolete": len(facts) - len(active),
        "by_category": dict(by_category),
        "avg_confidence": round(
            sum(f.get("confidence", 0.5) for f in active) / max(len(active), 1), 2
        ),
        "merged_facts": sum(1 for f in active if f.get("merge_count", 0) > 0),
    }


# ============================================================
# CLI
# ============================================================


def main():
    args = sys.argv[1:]

    if "--stats" in args:
        stats = get_stats()
        print(json.dumps(stats, ensure_ascii=False, indent=2))
        return

    if "--list" in args:
        facts = load_facts()
        active = [f for f in facts if not f.get("obsolete")]
        for f in active[-20:]:
            print(f"  [{f['category']}] {f['content'][:80]}")
        print(f"\n  共 {len(active)} 条活跃事实")
        return

    if "--add" in args:
        idx = args.index("--add")
        content = args[idx + 1] if idx + 1 < len(args) else ""
        category = "discovery"
        if "--category" in args:
            cat_idx = args.index("--category")
            category = args[cat_idx + 1] if cat_idx + 1 < len(args) else "discovery"

        result = store_fact(content, category=category)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print("Usage:")
    print("  python scripts/fact_store.py --add '事实' --category decision")
    print("  python scripts/fact_store.py --list")
    print("  python scripts/fact_store.py --stats")


if __name__ == "__main__":
    main()
