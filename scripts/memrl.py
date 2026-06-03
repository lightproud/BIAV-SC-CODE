"""
memrl.py — MemRL-lite: Memory Utility Tracking & Adaptive Reranking

Part of BIAV-SC Advanced Memory System (Sprint 3).
Tracks memory file utility via feedback signals, adjusts reranker weights.

Not real RL — uses exponential moving average (EMA) of usage signals.
Data scale too small for actual reinforcement learning.

Usage:
  python scripts/memrl.py --compute           # Compute utility from logs
  python scripts/memrl.py --stats             # Show utility rankings
  python scripts/memrl.py --suggest-archival  # Suggest low-utility files
  python scripts/memrl.py --calibrate         # Auto-adjust reranker weights
"""

import json
import math
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UTILITY_FILE = REPO / "assets" / "data" / "memory-utility.json"
ACCESS_LOG_DIR = REPO / "memory" / "dreams" / "access-log"
ACCESS_LOG_LEGACY = REPO / "memory" / "dreams" / "access-log.json"
INSIGHTS_FILE = REPO / "memory" / "dreams" / "insights.json"
DREAMS_DIR = REPO / "memory" / "dreams"
DIGESTS_DIR = REPO / "memory" / "session-digests"
CONTINUITY_FILE = REPO / "memory" / "session-continuity.json"
TODAY = date.today()

# EMA smoothing factor: 0.3 = responsive to new signals, retains history
ALPHA = 0.3
# Utility threshold for archival suggestion
ARCHIVAL_THRESHOLD = 0.2
# Minimum days before suggesting archival
MIN_DAYS_FOR_ARCHIVAL = 30

# ============================================================
# Signal extraction
# ============================================================


def _load_access_log() -> list[dict]:
    """Load access log from per-day files (with legacy single-file fallback)."""
    entries = []
    if ACCESS_LOG_DIR.exists():
        for f in sorted(ACCESS_LOG_DIR.glob("*.json")):
            try:
                entries.append(json.loads(f.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, OSError):
                pass
    if not entries and ACCESS_LOG_LEGACY.exists():
        try:
            entries = json.loads(ACCESS_LOG_LEGACY.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return entries


def get_access_signals() -> dict[str, dict]:
    """Extract access frequency signals from access log.

    Returns {file_path: {count, last_accessed}}
    """
    logs = _load_access_log()
    if not logs:
        return {}

    signals = defaultdict(lambda: {"count": 0, "last_accessed": None})
    total_sessions = len(logs)

    for entry in logs:
        entry_date = entry.get("date", "")
        for fp in entry.get("files_scanned", []):
            signals[fp]["count"] += 1
            if not signals[fp]["last_accessed"] or entry_date > signals[fp]["last_accessed"]:
                signals[fp]["last_accessed"] = entry_date

    # Normalize counts by total sessions
    for fp in signals:
        signals[fp]["frequency"] = signals[fp]["count"] / max(total_sessions, 1)

    return dict(signals)


def get_insight_signals() -> dict[str, dict]:
    """Extract insight citation signals from insights.json.

    Files referenced in insight evidence get a positive signal.
    Returns {file_path: {cited_count, last_cited}}
    """
    signals = defaultdict(lambda: {"cited_count": 0, "last_cited": None})

    # Check insights.json
    if INSIGHTS_FILE.exists():
        try:
            data = json.loads(INSIGHTS_FILE.read_text(encoding="utf-8"))
            insights = data.get("insights", data) if isinstance(data, dict) else data
            if isinstance(insights, list):
                for insight in insights:
                    for fp in insight.get("evidence", []):
                        # Skip non-path strings (e.g. reflexion error messages)
                        if fp.startswith("- ") or " -- " in fp or "NOT FOUND" in fp:
                            continue
                        signals[fp]["cited_count"] += 1
                        created = insight.get("created", "")
                        if created and (not signals[fp]["last_cited"] or created > signals[fp]["last_cited"]):
                            signals[fp]["last_cited"] = created
        except (json.JSONDecodeError, OSError):
            pass

    # Check dream journals for file mentions
    for journal_fp in DREAMS_DIR.glob("20*.json"):
        try:
            journal = json.loads(journal_fp.read_text(encoding="utf-8"))
            # Phase 2 results may reference files
            phase2 = journal.get("phase2", {})
            for key in ["contradictions", "stale_content", "duplicates"]:
                for item in phase2.get(key, []):
                    for field in ["file", "file_a", "file_b"]:
                        if field in item:
                            signals[item[field]]["cited_count"] += 1
                    for fp in item.get("files", []):
                        signals[fp]["cited_count"] += 1
        except (json.JSONDecodeError, OSError):
            pass

    return dict(signals)


def get_staleness_signals() -> dict[str, float]:
    """Check file modification recency.

    Returns {file_path: days_since_modified}
    """
    signals = {}
    for fp in REPO.glob("memory/*.md"):
        rel = str(fp.relative_to(REPO))
        mtime = datetime.fromtimestamp(fp.stat().st_mtime).date()
        signals[rel] = (TODAY - mtime).days
    return signals


def get_engagement_signals() -> dict[str, dict]:
    """Extract session engagement signals from .meta.json files.

    Tracks how files were actually used in sessions (not just scanned):
    - read_only: 0.3 (read but not modified)
    - read_and_edited: 0.7 (read and modified)
    - read_edit_commit: 1.0 (read, modified, and committed)

    Returns {file_path: {engagement_score, session_count, last_session}}
    """
    signals = defaultdict(lambda: {"scores": [], "session_count": 0, "last_session": None})

    engagement_weights = {
        "read_only": 0.3,
        "read_and_edited": 0.7,
        "read_edit_commit": 1.0,
    }

    # Scan .meta.json files from session digests
    for meta_fp in sorted(DIGESTS_DIR.glob("*.meta.json"), reverse=True)[:30]:
        try:
            meta = json.loads(meta_fp.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        session_date = (meta.get("timestamp_range") or [None, None])[0]
        if session_date:
            session_date = session_date[:10]

        files_eng = meta.get("files_engagement", {})
        for fp, level in files_eng.items():
            # Normalize all paths to relative form
            rel_fp = fp
            repo_str = str(REPO)
            if fp.startswith(repo_str):
                rel_fp = fp[len(repo_str):].lstrip("/")
            elif fp.startswith("/"):
                # Absolute path not under repo — use basename as fallback
                rel_fp = fp.rsplit("/", 1)[-1] if "/" in fp else fp

            weight = engagement_weights.get(level, 0.3)
            signals[rel_fp]["scores"].append(weight)
            signals[rel_fp]["session_count"] += 1
            if session_date and (not signals[rel_fp]["last_session"] or session_date > signals[rel_fp]["last_session"]):
                signals[rel_fp]["last_session"] = session_date

    # Compute average engagement per file
    result = {}
    for fp, data in signals.items():
        scores = data["scores"]
        result[fp] = {
            "engagement_score": sum(scores) / len(scores) if scores else 0,
            "session_count": data["session_count"],
            "last_session": data["last_session"],
        }

    return result


def get_momentum_signals() -> dict[str, float]:
    """Extract topic momentum from session continuity chain.

    Files related to high-momentum topics get a boost.
    Returns {file_path: momentum_score [0, 1]}
    """
    if not CONTINUITY_FILE.exists():
        return {}

    try:
        cont = json.loads(CONTINUITY_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}

    hot_files = cont.get("momentum", {}).get("hot_files", [])
    if not hot_files:
        return {}

    # Hot files get decreasing momentum scores based on rank
    signals = {}
    for i, fp in enumerate(hot_files[:10]):
        signals[fp] = max(1.0 - i * 0.1, 0.2)

    return signals


# ============================================================
# Utility computation
# ============================================================


def compute_utility() -> dict:
    """Compute utility scores for all memory files.

    Combines multiple signals into a single EMA utility score:
    - Engagement (how deeply files were used in sessions)
    - Insight citations (did it generate insights)
    - Recency (how recently modified)
    - Momentum (current topic focus from continuity chain)
    """
    access = get_access_signals()
    insights = get_insight_signals()
    staleness = get_staleness_signals()
    engagement = get_engagement_signals()
    momentum = get_momentum_signals()

    # Load existing utility for EMA
    existing = {}
    if UTILITY_FILE.exists():
        try:
            existing = json.loads(UTILITY_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    # All known memory files
    all_files = set()
    all_files.update(access.keys())
    all_files.update(insights.keys())
    all_files.update(staleness.keys())
    all_files.update(engagement.keys())
    # Also include existing tracked files
    all_files.update(existing.keys())

    utility = {}
    for fp in sorted(all_files):
        # Raw signals -> normalized scores [0, 1]

        # Engagement: prefer session engagement data, fall back to access frequency
        eng_data = engagement.get(fp, {})
        eng_score = eng_data.get("engagement_score", 0)
        if eng_score > 0:
            engagement_score = min(eng_score, 1.0)
        else:
            # Fallback to access frequency for files without session metadata
            freq = access.get(fp, {}).get("frequency", 0)
            engagement_score = min(freq * 2, 1.0)

        cited = insights.get(fp, {}).get("cited_count", 0)
        insight_score = min(cited / 3, 1.0)  # 3+ citations -> score=1.0

        days_old = staleness.get(fp, 30)
        recency_score = math.exp(-0.05 * days_old)  # half-life ~14 days

        momentum_score = momentum.get(fp, 0)

        # Combine into raw utility (updated weights with engagement + momentum)
        raw = (0.30 * engagement_score
               + 0.25 * insight_score
               + 0.25 * recency_score
               + 0.20 * momentum_score)

        # Apply EMA with existing utility
        old_utility = existing.get(fp, {}).get("utility", 0.5)
        new_utility = ALPHA * raw + (1 - ALPHA) * old_utility

        # Determine trend
        trend = "stable"
        if new_utility > old_utility + 0.05:
            trend = "rising"
        elif new_utility < old_utility - 0.05:
            trend = "declining"

        utility[fp] = {
            "utility": round(new_utility, 4),
            "raw_signals": {
                "engagement_score": round(engagement_score, 3),
                "insight_score": round(insight_score, 3),
                "recency_score": round(recency_score, 3),
                "momentum_score": round(momentum_score, 3),
            },
            "access_count": access.get(fp, {}).get("count", 0),
            "session_engagement": eng_data.get("session_count", 0),
            "last_accessed": access.get(fp, {}).get("last_accessed"),
            "insight_citations": insights.get(fp, {}).get("cited_count", 0),
            "last_cited": insights.get(fp, {}).get("last_cited"),
            "trend": trend,
            "first_seen": existing.get(fp, {}).get("first_seen", TODAY.isoformat()),
            "computed": TODAY.isoformat(),
        }

    # Save
    UTILITY_FILE.parent.mkdir(parents=True, exist_ok=True)
    UTILITY_FILE.write_text(
        json.dumps(utility, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return utility


def suggest_archival(utility: dict) -> list[dict]:
    """Suggest files with consistently low utility for archival."""
    suggestions = []
    for fp, data in utility.items():
        if data["utility"] < ARCHIVAL_THRESHOLD and data["trend"] != "rising":
            # Check if file has been tracked long enough
            first_seen = data.get("first_seen", data.get("computed", TODAY.isoformat()))
            try:
                first_date = date.fromisoformat(first_seen)
                days_tracked = (TODAY - first_date).days
            except ValueError:
                days_tracked = 0

            if days_tracked >= MIN_DAYS_FOR_ARCHIVAL:
                suggestions.append({
                    "file": fp,
                    "utility": data["utility"],
                    "trend": data["trend"],
                    "reason": f"utility={data['utility']:.3f}, trend={data['trend']}, tracked {days_tracked} days",
                })

    suggestions.sort(key=lambda x: x["utility"])
    return suggestions


def calibrate_reranker_weights(utility: dict) -> dict:
    """Analyze which reranker dimensions best predict utility.

    Returns suggested weight adjustments for memory_search.py reranker.
    Currently uses heuristic analysis; could be upgraded to regression.
    """
    # Correlate raw signals with final utility
    n = len(utility)
    if n < 5:
        return {"status": "insufficient_data", "weights": None}

    # Simple heuristic: which signal has the most variance?
    signals = {"engagement": [], "insight": [], "recency": [], "momentum": []}
    for data in utility.values():
        raw = data.get("raw_signals", {})
        signals["engagement"].append(raw.get("engagement_score", raw.get("access_score", 0)))
        signals["insight"].append(raw.get("insight_score", 0))
        signals["recency"].append(raw.get("recency_score", 0))
        signals["momentum"].append(raw.get("momentum_score", 0))

    def variance(vals):
        if not vals:
            return 0
        mean = sum(vals) / len(vals)
        return sum((v - mean) ** 2 for v in vals) / len(vals)

    variances = {k: variance(v) for k, v in signals.items()}
    total_var = sum(variances.values()) or 1

    # Higher variance signals are more discriminative -> deserve more weight
    suggested = {
        "semantic": 0.40,  # Keep semantic constant
        "recency": round(0.60 * variances.get("recency", 0.1) / total_var, 2),
        # Emit "access" to match the reranker's DEFAULT_WEIGHTS key (memory_search.py)
        "access": round(0.60 * variances.get("engagement", 0.1) / total_var, 2),
        "graph": 0.15,  # Keep graph constant
    }

    # Ensure minimum weights
    for k in suggested:
        suggested[k] = max(suggested[k], 0.05)

    # Normalize non-semantic weights to sum to 0.60
    non_semantic = {k: v for k, v in suggested.items() if k != "semantic"}
    ns_total = sum(non_semantic.values())
    if ns_total > 0:
        for k in non_semantic:
            suggested[k] = round(non_semantic[k] / ns_total * 0.60, 2)
    suggested["semantic"] = 0.40

    return {
        "status": "calibrated",
        "data_points": n,
        "variances": {k: round(v, 4) for k, v in variances.items()},
        "suggested_weights": suggested,
    }


# ============================================================
# CLI
# ============================================================


def print_stats(utility: dict):
    """Print utility rankings."""
    print(f"\n  Memory 效用排名 — {TODAY}")
    print(f"  追踪文件数：{len(utility)}\n")

    items = sorted(utility.items(), key=lambda x: x[1]["utility"], reverse=True)

    # Top files
    print("  高效用文件：")
    for fp, data in items[:8]:
        trend_icon = {"rising": "↑", "declining": "↓", "stable": "→"}.get(data["trend"], "?")
        print(f"    {data['utility']:.3f} {trend_icon} {fp}")
        raw = data.get("raw_signals", {})
        print(f"         eng={raw.get('engagement_score', raw.get('access_score', 0)):.2f} insight={raw.get('insight_score', 0):.2f} recency={raw.get('recency_score', 0):.2f} momentum={raw.get('momentum_score', 0):.2f}")

    # Bottom files
    if len(items) > 8:
        print(f"\n  低效用文件：")
        for fp, data in items[-5:]:
            trend_icon = {"rising": "↑", "declining": "↓", "stable": "→"}.get(data["trend"], "?")
            print(f"    {data['utility']:.3f} {trend_icon} {fp}")

    # Summary stats
    vals = [d["utility"] for d in utility.values()]
    if vals:
        avg = sum(vals) / len(vals)
        print(f"\n  平均效用：{avg:.3f}")
        rising = sum(1 for d in utility.values() if d["trend"] == "rising")
        declining = sum(1 for d in utility.values() if d["trend"] == "declining")
        print(f"  趋势：↑{rising} →{len(utility)-rising-declining} ↓{declining}")


def main():
    args = sys.argv[1:]

    do_compute = "--compute" in args
    do_stats = "--stats" in args
    do_archival = "--suggest-archival" in args
    do_calibrate = "--calibrate" in args

    if do_compute or not any([do_stats, do_archival, do_calibrate]):
        print(f"MemRL-lite 效用计算 — {TODAY}")
        utility = compute_utility()
        print(f"  计算完成，{len(utility)} 个文件")
        print(f"  保存到：{UTILITY_FILE.relative_to(REPO)}")

        if not any([do_stats, do_archival, do_calibrate]):
            do_stats = True
    else:
        if UTILITY_FILE.exists():
            utility = json.loads(UTILITY_FILE.read_text(encoding="utf-8"))
        else:
            print("  ⚠ 效用数据不存在，先运行 --compute")
            return

    if do_stats:
        print_stats(utility)

    if do_archival:
        suggestions = suggest_archival(utility)
        if suggestions:
            print(f"\n  建议归档的文件（utility < {ARCHIVAL_THRESHOLD}）：")
            for s in suggestions:
                print(f"    - {s['file']}: {s['reason']}")
        else:
            print(f"\n  没有需要归档的文件（全部 utility ≥ {ARCHIVAL_THRESHOLD} 或追踪不足 {MIN_DAYS_FOR_ARCHIVAL} 天）")

    if do_calibrate:
        cal = calibrate_reranker_weights(utility)
        print(f"\n  Reranker 权重校准")
        print(f"  状态：{cal['status']}")
        if cal.get("suggested_weights"):
            print(f"  数据点：{cal['data_points']}")
            print(f"  信号方差：{cal['variances']}")
            print(f"  建议权重：{cal['suggested_weights']}")


if __name__ == "__main__":
    main()
