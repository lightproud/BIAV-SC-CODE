"""
dream.py — 4-Phase AutoDream Memory Consolidation System

Inspired by Claude AutoDream + Mem0 + Voyager skill accumulation.
4 phases: Orient → Gather → Consolidate → Index

Phase 1 (Orient + Gather): Pure Python, zero API cost — structural checks
Phase 2 (Consolidate): AI-powered semantic analysis — requires ANTHROPIC_API_KEY
Phase 3 (Index): Auto-update BIAV-SC.md knowledge table + generate semantic index

Usage:
  python scripts/dream.py                  # Phase 1 only (structural)
  python scripts/dream.py --deep           # Phase 1 + 2 (with AI)
  python scripts/dream.py --full           # Phase 1 + 2 + 3 (full AutoDream)
  python scripts/dream.py --report         # Output JSON report for automation
"""

import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from hashlib import md5
from pathlib import Path

from dream_config import (
    ACCESS_LOG_DIR, ACCESS_LOG_LEGACY, ALERTS_FILE, ARCHIVE_INTEGRITY_FILE,
    CACHE_FILE, DREAMS_DIR, INSIGHTS_FILE, NEGATIVE_KEYWORDS, NEWS_OUTPUT,
    REPO, SEMANTIC_INDEX, SENTINEL_BASELINE, SENTINEL_THRESHOLDS, TODAY,
    _get_branch,
)
from dream_archive import archive_integrity_scan
from dream_sentinel import compute_deviation, sentinel_scan
from dream_health import (
    check_decisions, check_lessons, check_memory_size, check_references,
    check_staleness, find_near_duplicates, parse_timestamp,
)
from dream_rem import run_rem


# ============================================================
# Phase 1: Orient + Gather (structural, zero API cost)
# ============================================================


def extract_keywords(text: str) -> Counter:
    """Extract keyword frequencies from text for semantic indexing."""
    # Chinese + English word extraction
    words = re.findall(r"[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}", text.lower())
    stop_words = {
        "the", "and", "for", "that", "this", "with", "from", "are", "was", "been",
        "have", "has", "not", "but", "can", "all", "will", "would", "could",
        "should", "may", "also", "more", "其他", "可以", "需要", "使用", "目前",
        "已经", "以及", "进行", "通过", "是否", "如果", "但是", "或者", "因为",
        "所以", "关于", "对于", "以下", "文件", "内容", "状态", "说明",
    }
    filtered = [w for w in words if w not in stop_words and len(w) > 1]
    return Counter(filtered)


def build_keyword_index() -> dict:
    """Build a keyword-to-file mapping for semantic search (no API needed)."""
    index = defaultdict(list)
    file_summaries = {}

    knowledge_files = (
        list(REPO.glob("memory/*.md"))
        + list(REPO.glob("assets/data/*.json"))
        + list(REPO.glob("assets/data/*.md"))
        + list(REPO.glob("projects/*/CONTEXT.md"))
        + [REPO / "BIAV-SC.md"]
    )

    for fp in knowledge_files:
        if not fp.exists():
            continue
        try:
            text = fp.read_text(encoding="utf-8")[:5000]  # First 5K chars
        except (OSError, UnicodeDecodeError):
            continue

        rel = str(fp.relative_to(REPO))
        keywords = extract_keywords(text)
        top_keywords = [kw for kw, _ in keywords.most_common(15)]
        file_summaries[rel] = {
            "keywords": top_keywords,
            "lines": len(text.splitlines()),
            "last_modified": fp.stat().st_mtime,
            "content_hash": md5(text.encode()).hexdigest()[:12],
        }
        for kw in top_keywords:
            index[kw].append(rel)

    return {"files": file_summaries, "keyword_index": dict(index)}


# ============================================================
# Phase 2: Consolidate (AI-powered semantic analysis)
# ============================================================


def get_anthropic_client():
    """Get Anthropic client, return None if not available."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        import anthropic
        return anthropic.Anthropic(api_key=api_key)
    except ImportError:
        return None


def ai_consolidate(client) -> dict:
    """Use Claude to do semantic memory consolidation."""
    # Gather all memory content
    memory_contents = {}
    for fp in sorted(REPO.glob("memory/*.md")):
        try:
            text = fp.read_text(encoding="utf-8")
            memory_contents[str(fp.relative_to(REPO))] = text[:3000]
        except (OSError, UnicodeDecodeError):
            continue

    prompt = f"""你是银芯（BIAV-SC）的做梦 Agent。现在是深睡阶段，你需要整理记忆。

以下是当前所有 memory/ 文件的内容（截取前 3000 字符）：

{json.dumps(memory_contents, ensure_ascii=False, indent=2)}

请分析并输出 JSON 格式的整理报告：

{{
  "contradictions": [
    {{"file_a": "路径", "file_b": "路径", "description": "矛盾描述", "suggestion": "建议"}}
  ],
  "duplicates": [
    {{"files": ["路径1", "路径2"], "description": "重复内容描述", "merge_suggestion": "合并建议"}}
  ],
  "stale_content": [
    {{"file": "路径", "description": "过时内容描述", "suggestion": "更新或删除"}}
  ],
  "knowledge_gaps": [
    {{"topic": "缺失主题", "evidence": "为什么认为缺失", "suggested_file": "建议写入哪个文件"}}
  ],
  "consolidation_actions": [
    {{"action": "merge|delete|update|create", "target": "文件路径", "description": "具体操作"}}
  ],
  "insights": [
    {{"type": "trend|gap|anomaly|pattern", "summary": "描述", "evidence": ["文件路径"], "suggested_action": "建议"}}
  ]
}}

只输出 JSON，不要其他文字。"""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text
        # Extract JSON from response
        json_match = re.search(r"\{[\s\S]+\}", text)
        if json_match:
            return json.loads(json_match.group())
    except Exception as e:
        print(f"  - AI consolidation error: {e}")
    return {}


def ai_trend_analysis(client) -> dict:
    """Trend analysis stub — daily-report based pipeline removed 2026-05-03.

    Future implementation should read data/platforms/{source}/{date}.json
    archive layer directly (full data per source per day, weeks-to-years
    of history) and data/discord/activity_daily/{date}.json, then ask the
    LLM to synthesize trends. Returns empty for now to keep dream.py
    callable without crashing the cron.
    """
    return {}


# ============================================================
# Sleep-Time Compute (precomputed cache)
# ============================================================


def identify_hot_topics() -> list[str]:
    """Identify hot topics from access logs, insights, and recent files.

    Returns a list of topic strings for cache precomputation.
    """
    topics = []

    # From access-log: most frequently scanned files → their topics
    try:
        logs = load_access_log(last_n=7)
        file_counts = Counter()
        for entry in logs:
            for fp in entry.get("files_scanned", []):
                file_counts[fp] += 1
        # Top 5 files → extract topic from filename
        for fp, _ in file_counts.most_common(5):
            name = Path(fp).stem.replace("-", " ").replace("_", " ")
            topics.append(name)
    except Exception:
        pass

    # Fixed high-value topics for this project
    core_topics = [
        "项目当前状态和三条主线进展",
        "技术债和阻塞项",
        "社区数据趋势摘要",
        "最近的重要决策",
        "下一步工作建议",
    ]
    topics.extend(core_topics)

    return list(dict.fromkeys(topics))[:10]  # Deduplicate, max 10


def generate_cache_entries(client, topics: list[str]) -> list[dict]:
    """Use AI to precompute answers for hot topics."""
    # Gather context for the AI
    context_parts = []
    context_files = [
        ("memory/project-status.md", 2000),
        ("memory/decisions.md", 1500),
        ("memory/strategic-assessment.md", 2000),
        ("memory/pending-discussions.md", 1000),
    ]
    for rel, limit in context_files:
        fp = REPO / rel
        if fp.exists():
            try:
                text = fp.read_text(encoding="utf-8")[:limit]
                context_parts.append(f"### {rel}\n{text}")
            except (OSError, UnicodeDecodeError):
                pass

    context = "\n\n".join(context_parts)
    topics_str = "\n".join(f"- {t}" for t in topics)

    prompt = f"""你是银芯（BIAV-SC）的 Sleep-Time Compute 模块。
在深睡时预生成常见问题的结构化回答，供新会话快速引用。

当前知识上下文：

{context}

请为以下高频话题各生成一个简洁回答（3-5句话）：

{topics_str}

输出 JSON 数组格式：
[
  {{
    "question_patterns": ["关键词1", "关键词2"],
    "answer": "简洁回答",
    "sources": ["引用的文件路径"],
    "confidence": 0.0-1.0
  }}
]

只输出 JSON 数组。回答要基于上下文中的事实，不要猜测。"""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text
        json_match = re.search(r"\[[\s\S]+\]", text)
        if json_match:
            entries = json.loads(json_match.group())
            # Add metadata
            for i, entry in enumerate(entries):
                entry["id"] = f"cache-{TODAY.isoformat()}-{i+1:03d}"
                entry["hit_count"] = 0
            return entries
    except Exception as e:
        print(f"  - Cache generation error: {e}")
    return []


def update_precomputed_cache(entries: list[dict]):
    """Write precomputed cache to disk."""
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)

    cache = {
        "generated": TODAY.isoformat(),
        "ttl_days": 1,
        "generator": "dream.py sleep-time-compute",
        "entries": entries,
    }

    CACHE_FILE.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return len(entries)


def check_cache(query: str) -> dict | None:
    """Check if a query matches any precomputed cache entry.

    Returns the best matching entry or None.
    """
    if not CACHE_FILE.exists():
        return None

    try:
        cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    # Check TTL
    try:
        gen_date = date.fromisoformat(cache.get("generated", "2000-01-01"))
        ttl = cache.get("ttl_days", 1)
        if (TODAY - gen_date).days > ttl:
            return None
    except ValueError:
        return None

    # Match query against patterns
    query_lower = query.lower()
    best_match = None
    best_score = 0

    for entry in cache.get("entries", []):
        patterns = entry.get("question_patterns", [])
        score = sum(1 for p in patterns if p.lower() in query_lower)
        if score > best_score:
            best_score = score
            best_match = entry

    return best_match if best_score > 0 else None


# ============================================================
# Phase 3: Index (auto-update knowledge index + semantic index)
# ============================================================


def update_semantic_index(keyword_index: dict, ai_insights: dict = None):
    """Write semantic index to JSON for other sessions to query."""
    SEMANTIC_INDEX.parent.mkdir(parents=True, exist_ok=True)

    index_data = {
        "generated": TODAY.isoformat(),
        "generator": "dream.py --full",
        "keyword_index": keyword_index.get("keyword_index", {}),
        "files": keyword_index.get("files", {}),
    }

    if ai_insights:
        index_data["ai_insights"] = ai_insights

    SEMANTIC_INDEX.write_text(
        json.dumps(index_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return str(SEMANTIC_INDEX.relative_to(REPO))


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


# ============================================================
# Main orchestrator
# ============================================================


def run_phase1() -> dict:
    """Phase 1: Orient + Gather — structural checks, zero API cost."""
    results = {"issues": 0, "checks": {}}
    all_files_scanned = []

    for label, checker in [
        ("staleness", check_staleness),
        ("references", check_references),
        ("decisions", check_decisions),
        ("lessons", check_lessons),
        ("memory_size", check_memory_size),
    ]:
        lines, count = checker()
        results["checks"][label] = {"lines": lines, "issues": count}
        results["issues"] += count

    # Build keyword index (always, for semantic search)
    keyword_index = build_keyword_index()
    results["keyword_index"] = keyword_index

    # Sentinel scan — proactive anomaly detection
    sentinel_alerts = sentinel_scan()
    results["sentinel"] = {
        "alerts": sentinel_alerts,
        "alert_count": len(sentinel_alerts),
    }

    # Track scanned files
    for fp in REPO.glob("memory/*.md"):
        all_files_scanned.append(str(fp.relative_to(REPO)))

    log_access(all_files_scanned)

    # Generate boot snapshot
    try:
        from boot_snapshot import generate_snapshot
        snapshot_path = REPO / "memory" / "boot-snapshot.md"
        snapshot_path.write_text(generate_snapshot() + "\n", encoding="utf-8")
        print("  Boot snapshot updated")
    except Exception as e:
        print(f"  Boot snapshot failed: {e}")

    return results


def run_phase2(client) -> dict:
    """Phase 2: Consolidate — AI-powered semantic analysis."""
    print("\n## AI Consolidation (Deep Sleep)")
    consolidation = ai_consolidate(client)
    if consolidation:
        n_contra = len(consolidation.get("contradictions", []))
        n_dupes = len(consolidation.get("duplicates", []))
        n_stale = len(consolidation.get("stale_content", []))
        n_gaps = len(consolidation.get("knowledge_gaps", []))
        n_insights = len(consolidation.get("insights", []))
        print(f"  - {n_contra} contradictions found")
        print(f"  - {n_dupes} duplicate clusters found")
        print(f"  - {n_stale} stale content items")
        print(f"  - {n_gaps} knowledge gaps identified")
        print(f"  - {n_insights} insights generated")

        for c in consolidation.get("contradictions", [])[:3]:
            print(f"    {c.get('description', '')[:80]}")
        for g in consolidation.get("knowledge_gaps", [])[:3]:
            print(f"    {g.get('topic', '')}: {g.get('evidence', '')[:60]}")
    else:
        print("  - No results (AI analysis unavailable or failed)")

    # Trend analysis
    print("\n## Trend Analysis")
    trends = ai_trend_analysis(client)
    if trends:
        sentiment = trends.get("sentiment", "unknown")
        print(f"  - Community sentiment: {sentiment}")
        for topic in trends.get("hot_topics", [])[:3]:
            print(f"    {topic}")
        for anomaly in trends.get("anomalies", [])[:3]:
            print(f"    ⚠ {anomaly}")
        consolidation["trends"] = trends
    else:
        print("  - No daily report available for trend analysis")

    # Sleep-Time Compute: precompute answers for hot topics
    print("\n## Sleep-Time Compute")
    topics = identify_hot_topics()
    print(f"  - {len(topics)} hot topics identified")
    cache_entries = generate_cache_entries(client, topics)
    if cache_entries:
        n = update_precomputed_cache(cache_entries)
        print(f"  - {n} cache entries generated and saved")
        consolidation["cache_entries"] = n
    else:
        print("  - Cache generation skipped (no entries)")

    # MemRL: compute utility scores
    print("\n## MemRL Utility")
    try:
        from memrl import compute_utility
        utility = compute_utility()
        print(f"  - {len(utility)} files scored")
        avg = sum(d["utility"] for d in utility.values()) / max(len(utility), 1)
        print(f"  - Average utility: {avg:.3f}")
    except ImportError:
        print("  - memrl.py not found, skipping")
    except Exception as e:
        print(f"  - MemRL error: {e}")

    return consolidation


def rebuild_vector_index():
    """Rebuild TF-IDF vector index via memory_search module."""
    try:
        from memory_search import build_index
        index = build_index()
        n_chunks = len(index.get("vectors", {}))
        n_vocab = len(index.get("vocabulary", {}))
        print(f"  - Vector index rebuilt: {n_chunks} chunks, {n_vocab} vocabulary")
        return True
    except ImportError:
        print("  - memory_search.py not found, skipping vector index")
        return False
    except Exception as e:
        print(f"  - Vector index build error: {e}")
        return False


def rebuild_knowledge_graph():
    """Update knowledge graph incrementally (or full rebuild if missing)."""
    try:
        from knowledge_graph import incremental_update
        graph = incremental_update(hours_back=24)
        n_nodes = graph["meta"]["node_count"]
        n_edges = graph["meta"]["edge_count"]
        print(f"  - Knowledge graph rebuilt: {n_nodes} nodes, {n_edges} edges")
        return True
    except ImportError:
        print("  - knowledge_graph.py not found, skipping graph")
        return False
    except Exception as e:
        print(f"  - Knowledge graph build error: {e}")
        return False


def run_phase3(keyword_index: dict, ai_results: dict = None):
    """Phase 3: Index — update semantic index, vector index, and dream journal."""
    print("\n## Indexing")
    idx_path = update_semantic_index(keyword_index, ai_results)
    print(f"  - Semantic index updated: {idx_path}")
    print(f"  - {len(keyword_index.get('files', {}))} files indexed")
    print(f"  - {len(keyword_index.get('keyword_index', {}))} unique keywords")

    # Rebuild vector index (TF-IDF) — vectors.json.gz is committed to git
    print("\n## Vector Index")
    rebuild_vector_index()

    # Rebuild knowledge graph
    print("\n## Knowledge Graph")
    rebuild_knowledge_graph()

    # Selective memory: check for archival candidates
    print("\n## Selective Memory")
    selective_memory_check()

    # Reflexion: scan for failure patterns
    print("\n## Reflexion")
    run_reflexion()


def selective_memory_check():
    """Check for files that should be compressed or archived."""
    try:
        from memrl import compute_utility, suggest_archival
        utility = compute_utility()
        archival = suggest_archival(utility)
        if archival:
            print(f"  - {len(archival)} files suggested for archival:")
            for a in archival[:3]:
                print(f"    - {a['file']}: {a['reason']}")
        else:
            print(f"  - No files need archival (all healthy)")

        # Check for bloated files
        bloated = []
        for fp in sorted(REPO.glob("memory/*.md")):
            try:
                lines = len(fp.read_text(encoding="utf-8").splitlines())
            except (OSError, UnicodeDecodeError):
                continue
            rel = str(fp.relative_to(REPO))
            u = utility.get(rel, {}).get("utility", 0.5)
            if lines > 400 and u < 0.6:
                bloated.append({"file": rel, "lines": lines, "utility": u})

        if bloated:
            print(f"  - {len(bloated)} bloated + low-utility files (candidates for compression):")
            for b in bloated:
                print(f"    - {b['file']}: {b['lines']} lines, utility={b['utility']:.3f}")
        else:
            print(f"  - No bloated files need compression")

    except ImportError:
        print("  - memrl.py not available, skipping")
    except Exception as e:
        print(f"  - Selective memory error: {e}")


def run_reflexion():
    """Run Reflexion failure analysis."""
    try:
        from reflexion import scan_all
        report = scan_all()
        n_failures = report.get("failures", {}).get("total", 0)
        n_patterns = report.get("patterns", 0)
        print(f"  - {n_failures} failure signals, {n_patterns} patterns found")
    except ImportError:
        print("  - reflexion.py not available, skipping")
    except Exception as e:
        print(f"  - Reflexion error: {e}")


# ============================================================
# REM: Weekly Deep Reflection
# ============================================================


def main():
    args = sys.argv[1:]
    deep = "--deep" in args or "--full" in args
    full = "--full" in args
    rem = "--rem" in args
    report_mode = "--report" in args

    print(f"\U0001F319 Memory Dream Journal -- {TODAY}")
    if deep:
        print(f"   Mode: {'Full AutoDream' if full else 'Deep Sleep'}")
    print()

    # Phase 1: Orient + Gather
    print("=" * 50)
    print("Phase 1: Orient + Gather (structural)")
    print("=" * 50)
    phase1 = run_phase1()

    for label, data in phase1["checks"].items():
        print(f"\n## {label.replace('_', ' ').title()}")
        lines = data["lines"]
        if not lines and label == "references":
            print("  - All references valid")
        for line in lines:
            print(line)

    # Sentinel results
    sentinel = phase1.get("sentinel", {})
    alert_count = sentinel.get("alert_count", 0)
    print(f"\n## Sentinel (Anomaly Detection)")
    if alert_count == 0:
        print("  - All data sources within normal range")
    else:
        for alert in sentinel.get("alerts", []):
            level = alert["level"]
            print(f"  - [{level.upper()}] {alert['message']}")

    print(f"\n## Phase 1 Summary")
    print(f"  - {phase1['issues']} structural issues found")
    if alert_count > 0:
        print(f"  - ⚠ {alert_count} sentinel alerts generated → projects/news/output/alerts.json")

    # Phase 2: Consolidate (AI-powered)
    phase2 = {}
    client = None
    if deep:
        print(f"\n{'=' * 50}")
        print("Phase 2: Consolidate (AI-powered)")
        print("=" * 50)
        client = get_anthropic_client()
        if client:
            phase2 = run_phase2(client)
        else:
            print("  - ANTHROPIC_API_KEY not set, skipping AI analysis")
            print("  - Set ANTHROPIC_API_KEY environment variable to enable")

    # Phase 3: Index
    if full or deep:
        print(f"\n{'=' * 50}")
        print("Phase 3: Index")
        print("=" * 50)
        run_phase3(phase1.get("keyword_index", {}), phase2)

    # REM: Weekly deep reflection
    if rem:
        print(f"\n{'=' * 50}")
        print("REM: Weekly Reflection")
        print("=" * 50)
        rem_client = client if deep and client else get_anthropic_client()
        run_rem(rem_client)

    # Save journal
    journal_path = save_dream_journal(
        {k: v for k, v in phase1.items() if k != "keyword_index"},
        phase2 if phase2 else None,
    )
    print(f"\nDream journal saved: {journal_path}")

    # JSON report mode for automation
    if report_mode:
        report = {
            "date": TODAY.isoformat(),
            "phase1_issues": phase1["issues"],
            "sentinel_alerts": phase1.get("sentinel", {}).get("alert_count", 0),
            "phase2_available": bool(phase2),
            "files_indexed": len(phase1.get("keyword_index", {}).get("files", {})),
        }
        if phase2:
            report["contradictions"] = len(phase2.get("contradictions", []))
            report["knowledge_gaps"] = len(phase2.get("knowledge_gaps", []))
            report["insights"] = len(phase2.get("insights", []))
        print(f"\n::report::{json.dumps(report)}")

    print(f"\n## Final Summary")
    total = phase1["issues"]
    if phase2:
        total += len(phase2.get("contradictions", []))
    print(f"  - {total} total findings")
    if not deep:
        print(f"  - Run with --deep for AI semantic analysis")
        print(f"  - Run with --full for complete AutoDream cycle")

    sys.exit(0)


if __name__ == "__main__":
    main()
