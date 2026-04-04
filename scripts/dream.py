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
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from hashlib import md5
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TODAY = date.today()
STALE_DAYS = 14
DREAMS_DIR = REPO / "memory" / "dreams"
INSIGHTS_FILE = DREAMS_DIR / "insights.json"
ACCESS_LOG = DREAMS_DIR / "access-log.json"
SEMANTIC_INDEX = REPO / "assets" / "data" / "semantic-index.json"
SENTINEL_BASELINE = REPO / "assets" / "data" / "sentinel-baseline.json"
ALERTS_FILE = REPO / "projects" / "news" / "output" / "alerts.json"
NEWS_OUTPUT = REPO / "projects" / "news" / "output"

# ============================================================
# Sentinel Layer — proactive anomaly detection (zero API cost)
# ============================================================

# Thresholds for alert levels
SENTINEL_THRESHOLDS = {
    "red": 3.0,     # 3x deviation from baseline → red alert
    "orange": 2.0,  # 2x deviation → orange alert
    "yellow": 1.5,  # 1.5x deviation → yellow alert
}

# Negative keywords to track (Chinese + English)
NEGATIVE_KEYWORDS = [
    "退款", "bug", "闪退", "崩溃", "卡死", "差评", "垃圾", "骗钱",
    "refund", "crash", "broken", "scam", "unplayable", "worst",
]


def load_sentinel_baseline() -> dict:
    """Load the sliding 7-day baseline."""
    if SENTINEL_BASELINE.exists():
        try:
            return json.loads(SENTINEL_BASELINE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"history": [], "baseline": {}}


def save_sentinel_baseline(data: dict):
    """Save sentinel baseline to disk."""
    SENTINEL_BASELINE.parent.mkdir(parents=True, exist_ok=True)
    SENTINEL_BASELINE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def extract_source_metrics(source: str, items: list) -> dict:
    """Extract key metrics from a data source's items."""
    metrics = {
        "item_count": len(items),
        "total_engagement": sum(it.get("engagement", 0) for it in items),
    }

    if source == "steam":
        voted_up = sum(1 for it in items if it.get("voted_up", True))
        voted_down = len(items) - voted_up
        metrics["positive_count"] = voted_up
        metrics["negative_count"] = voted_down
        metrics["negative_rate"] = voted_down / max(len(items), 1)

    if source == "discord":
        # Extract message count from summary (first item is daily summary)
        for it in items:
            title = it.get("title", "")
            if "日报" in title or "Daily" in title:
                eng = it.get("engagement", 0)
                if eng > 0:
                    metrics["daily_messages"] = eng
                break

    # Negative keyword scan across all items
    neg_hits = 0
    neg_keywords_found = []
    for it in items:
        text = " ".join([
            it.get("title", ""), it.get("summary", ""),
            it.get("review", ""),
        ]).lower()
        for kw in NEGATIVE_KEYWORDS:
            if kw in text:
                neg_hits += 1
                if kw not in neg_keywords_found:
                    neg_keywords_found.append(kw)
    metrics["negative_keyword_hits"] = neg_hits
    metrics["negative_keywords"] = neg_keywords_found

    return metrics


def compute_deviation(current: float, baseline: float) -> float:
    """Compute how many times current deviates from baseline (ratio)."""
    if baseline <= 0:
        return 0.0
    return current / baseline


def sentinel_scan() -> list[dict]:
    """
    Scan all data sources against sliding baselines.
    Returns list of alerts (may be empty if everything is normal).
    """
    baseline_data = load_sentinel_baseline()
    history = baseline_data.get("history", [])
    alerts = []

    # Collect today's metrics from each source
    today_metrics = {}
    sources = ["steam", "bilibili", "discord"]
    for src in sources:
        src_file = NEWS_OUTPUT / f"{src}-latest.json"
        if not src_file.exists():
            continue
        try:
            data = json.loads(src_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        items = data.get("items", [])
        if not items:
            continue
        today_metrics[src] = extract_source_metrics(src, items)

    if not today_metrics:
        return alerts

    # Compute baselines from history (last 7 entries)
    recent = history[-7:] if len(history) >= 2 else []
    baselines = {}
    if recent:
        for src in sources:
            src_history = [h.get(src, {}) for h in recent if src in h]
            if not src_history:
                continue
            baselines[src] = {}
            for key in ["item_count", "total_engagement", "negative_keyword_hits"]:
                vals = [h.get(key, 0) for h in src_history]
                baselines[src][key] = sum(vals) / max(len(vals), 1)
            if src == "steam":
                vals = [h.get("negative_rate", 0) for h in src_history]
                baselines[src]["negative_rate"] = sum(vals) / max(len(vals), 1)
            if src == "discord":
                vals = [h.get("daily_messages", 0) for h in src_history if h.get("daily_messages")]
                baselines[src]["daily_messages"] = sum(vals) / max(len(vals), 1) if vals else 0

    # Generate alerts by comparing today vs baseline
    for src, metrics in today_metrics.items():
        src_baseline = baselines.get(src, {})

        # Steam negative rate spike
        if src == "steam" and "negative_rate" in src_baseline:
            bl = src_baseline["negative_rate"]
            cur = metrics.get("negative_rate", 0)
            if bl > 0 and cur > bl:
                ratio = cur / bl
                if ratio >= SENTINEL_THRESHOLDS["red"]:
                    alerts.append({
                        "level": "red",
                        "source": src,
                        "metric": "negative_rate",
                        "message": f"Steam 差评率飙升：{cur:.0%}（基线 {bl:.0%}，{ratio:.1f}x）",
                        "current": cur,
                        "baseline": bl,
                    })
                elif ratio >= SENTINEL_THRESHOLDS["orange"]:
                    alerts.append({
                        "level": "orange",
                        "source": src,
                        "metric": "negative_rate",
                        "message": f"Steam 差评率上升：{cur:.0%}（基线 {bl:.0%}，{ratio:.1f}x）",
                        "current": cur,
                        "baseline": bl,
                    })

        # Discord message volume spike
        if src == "discord":
            bl = src_baseline.get("daily_messages", 0)
            cur = metrics.get("daily_messages", 0)
            if bl > 0 and cur > 0:
                ratio = cur / bl
                if ratio >= SENTINEL_THRESHOLDS["red"]:
                    alerts.append({
                        "level": "yellow",
                        "source": src,
                        "metric": "daily_messages",
                        "message": f"Discord 消息量暴涨：{cur:,}（基线 {bl:,.0f}，{ratio:.1f}x）",
                        "current": cur,
                        "baseline": bl,
                    })

        # Engagement spike (any source)
        bl_eng = src_baseline.get("total_engagement", 0)
        cur_eng = metrics.get("total_engagement", 0)
        if bl_eng > 0 and cur_eng > bl_eng:
            ratio = cur_eng / bl_eng
            if ratio >= SENTINEL_THRESHOLDS["red"]:
                alerts.append({
                    "level": "yellow",
                    "source": src,
                    "metric": "total_engagement",
                    "message": f"{src} 互动量异常：{cur_eng:,}（基线 {bl_eng:,.0f}，{ratio:.1f}x）",
                    "current": cur_eng,
                    "baseline": bl_eng,
                })

        # Negative keyword spike
        bl_neg = src_baseline.get("negative_keyword_hits", 0)
        cur_neg = metrics.get("negative_keyword_hits", 0)
        if cur_neg > 0 and (bl_neg == 0 or cur_neg / max(bl_neg, 1) >= SENTINEL_THRESHOLDS["orange"]):
            kws = metrics.get("negative_keywords", [])
            if bl_neg == 0 and cur_neg >= 3:
                alerts.append({
                    "level": "orange",
                    "source": src,
                    "metric": "negative_keywords",
                    "message": f"{src} 负面关键词突增：{cur_neg} 次（{', '.join(kws[:5])}）",
                    "current": cur_neg,
                    "baseline": bl_neg,
                })
            elif bl_neg > 0:
                ratio = cur_neg / bl_neg
                if ratio >= SENTINEL_THRESHOLDS["orange"]:
                    alerts.append({
                        "level": "orange",
                        "source": src,
                        "metric": "negative_keywords",
                        "message": f"{src} 负面关键词上升：{cur_neg} 次（基线 {bl_neg:.0f}，{', '.join(kws[:5])}）",
                        "current": cur_neg,
                        "baseline": bl_neg,
                    })

    # Update history (append today, keep last 14 entries)
    history.append(today_metrics)
    history = history[-14:]
    baseline_data["history"] = history
    baseline_data["last_scan"] = datetime.now().isoformat()
    baseline_data["baseline"] = baselines
    save_sentinel_baseline(baseline_data)

    # Write alerts.json
    if alerts:
        alert_record = {
            "date": TODAY.isoformat(),
            "timestamp": datetime.now().isoformat(),
            "alerts": alerts,
        }
        # Load existing alerts, append, keep last 30 days
        existing_alerts = []
        if ALERTS_FILE.exists():
            try:
                existing_alerts = json.loads(ALERTS_FILE.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        existing_alerts.append(alert_record)
        existing_alerts = existing_alerts[-30:]
        ALERTS_FILE.write_text(
            json.dumps(existing_alerts, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    return alerts


# ============================================================
# Phase 1: Orient + Gather (structural, zero API cost)
# ============================================================


def parse_timestamp(fp: Path) -> date | None:
    """Extract date from timestamp lines in first 10 lines of a file."""
    try:
        lines = fp.read_text(encoding="utf-8").splitlines()[:10]
    except (OSError, UnicodeDecodeError):
        return None
    for line in lines:
        m = re.match(r">\s*(?:最后更新：|Last updated:\s*)(\d{4}-\d{2}-\d{2})", line)
        if m:
            try:
                return date.fromisoformat(m.group(1))
            except ValueError:
                pass
        m = re.match(r">\s*v[\d.]+\s*[—–-]\s*(\d{4})\.(\d{2})\.(\d{2})", line)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                pass
    return None


def days_ago(d: date) -> str:
    n = (TODAY - d).days
    return "today" if n == 0 else f"{n} day{'s' if n != 1 else ''} ago"


def extract_file_refs(text: str) -> list[str]:
    """Find file path references in markdown text."""
    refs = set()
    top_dirs = {"memory", "assets", "projects"}
    skip_markers = {"待生成", "待创建", "TODO", "todo", "planned"}
    for m in re.finditer(r"(?:memory/[\w./-]+|assets/[\w./-]+|projects/[\w./-]+)", text):
        ref = m.group(0).rstrip(".,;:!?)")
        if "xxx" in ref or "你的" in ref or "YYYY" in ref:
            continue
        parts = Path(ref).parts
        if len(parts) >= 2 and parts[0] in top_dirs and parts[1] in top_dirs:
            continue
        ctx_start = max(0, m.start() - 20)
        ctx_end = min(len(text), m.end() + 20)
        context = text[ctx_start:ctx_end]
        if any(marker in context for marker in skip_markers):
            continue
        refs.add(ref)
    return sorted(refs)


def check_staleness():
    """Check all memory and context files for timestamp freshness."""
    lines, issues = [], 0
    targets = sorted(REPO.glob("memory/*.md")) + sorted(REPO.glob("projects/*/CONTEXT.md"))
    for fp in targets:
        rel = fp.relative_to(REPO)
        ts = parse_timestamp(fp)
        if ts is None:
            lines.append(f"  - ? {rel} -- no timestamp found")
            issues += 1
        elif (TODAY - ts).days > STALE_DAYS:
            lines.append(f"  - ⚠ {rel} -- last updated {ts} ({days_ago(ts)}) STALE")
            issues += 1
        else:
            lines.append(f"  - ok {rel} -- last updated {ts} ({days_ago(ts)})")
    return lines, issues


def check_references():
    """Check all cross-file references for broken links."""
    lines, issues, seen = [], 0, set()
    targets = sorted(REPO.glob("memory/*.md")) + [REPO / "CLAUDE.md", REPO / "BIAV-SC.md"]
    targets += sorted(REPO.glob("projects/*/CONTEXT.md"))
    for fp in targets:
        if not fp.exists():
            continue
        try:
            text = fp.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        src = fp.relative_to(REPO)
        for ref in extract_file_refs(text):
            if (str(src), ref) in seen:
                continue
            seen.add((str(src), ref))
            target = REPO / ref
            if not target.exists() and not any(REPO.glob(ref)):
                lines.append(f"  - x {src} references '{ref}' -- NOT FOUND")
                issues += 1
    return lines, issues


def check_decisions():
    """Analyze decision health: obsolete ratio, duplicates, contradictions."""
    fp = REPO / "memory" / "decisions.md"
    if not fp.exists():
        return ["  - ? memory/decisions.md not found"], 0
    text = fp.read_text(encoding="utf-8")
    total, dead = 0, 0
    decision_texts = []
    for line in text.splitlines():
        if line.startswith("|") and "2026-" in line and "日期" not in line:
            total += 1
            decision_texts.append(line)
            if "已废除" in line or "已废弃" in line or "~~" in line:
                dead += 1
    if total == 0:
        return ["  - No decision entries found"], 0

    # Check for near-duplicate decisions (same keywords)
    dupes = find_near_duplicates(decision_texts)
    lines = []
    pct = round(dead / total * 100)
    lines.append(f"  - {dead}/{total} decisions marked as obsolete ({pct}%)")
    if dupes:
        lines.append(f"  - ⚠ {len(dupes)} potential duplicate decision pairs found")
        for a, b in dupes[:3]:
            lines.append(f"    - similar: '{a[:50]}' ↔ '{b[:50]}'")
    return lines, 1 if pct > 20 else 0


def find_near_duplicates(texts: list[str], threshold: float = 0.6) -> list[tuple[str, str]]:
    """Find near-duplicate text pairs using word overlap (Jaccard similarity)."""
    dupes = []
    word_sets = []
    for t in texts:
        words = set(re.findall(r"[\w\u4e00-\u9fff]+", t.lower()))
        words -= {"2026", "全局", "wiki", "site", "news", "game", "code"}  # stop words
        word_sets.append(words)
    for i in range(len(word_sets)):
        for j in range(i + 1, len(word_sets)):
            if not word_sets[i] or not word_sets[j]:
                continue
            jaccard = len(word_sets[i] & word_sets[j]) / len(word_sets[i] | word_sets[j])
            if jaccard > threshold:
                dupes.append((texts[i].strip(), texts[j].strip()))
    return dupes


def check_lessons():
    """Check lessons-learned for graduated entries and potentially resolved ones."""
    fp = REPO / "memory" / "lessons-learned.md"
    if not fp.exists():
        return ["  - ? memory/lessons-learned.md not found"], 0
    text = fp.read_text(encoding="utf-8")
    total = len(re.findall(r"^## \d+\.", text, re.MULTILINE))
    graduated = 0
    resolved_hints = set()
    for block in re.split(r"^## \d+\.", text, flags=re.MULTILINE)[1:]:
        title = block.strip().splitlines()[0].strip()[:60] if block.strip() else ""
        if "已毕业" in title or "graduated" in title.lower():
            graduated += 1
            continue
        for cfg in re.findall(r"`(\w+:\s*\w+)`", block):
            key = cfg.split(":")[0].strip()
            if key and len(key) > 3 and not list(REPO.rglob(f"*{key}*")):
                resolved_hints.add(title)
    lines = [f"  - {total} lessons total, {graduated} graduated, {len(resolved_hints)} may be resolved"]
    for hint in sorted(resolved_hints)[:5]:
        lines.append(f"    - possibly resolved: {hint}")
    return lines, 0


def check_memory_size():
    """Check memory files for bloat — files over 500 lines need consolidation."""
    lines, issues = [], 0
    for fp in sorted(REPO.glob("memory/*.md")):
        try:
            line_count = len(fp.read_text(encoding="utf-8").splitlines())
        except (OSError, UnicodeDecodeError):
            continue
        rel = fp.relative_to(REPO)
        if line_count > 500:
            lines.append(f"  - ⚠ {rel} -- {line_count} lines (needs consolidation)")
            issues += 1
        elif line_count > 300:
            lines.append(f"  - ~ {rel} -- {line_count} lines (approaching limit)")
    return lines, issues


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
    """Analyze recent daily reports for trends."""
    reports_dir = REPO / "projects" / "news" / "output"
    daily_file = reports_dir / "daily-latest.md"
    if not daily_file.exists():
        return {}

    try:
        daily_content = daily_file.read_text(encoding="utf-8")[:3000]
    except (OSError, UnicodeDecodeError):
        return {}

    prompt = f"""你是银芯（BIAV-SC）的做梦 Agent。分析以下最新日报，提取趋势信号。

{daily_content}

输出 JSON 格式：

{{
  "sentiment": "positive|neutral|negative",
  "hot_topics": ["话题1", "话题2"],
  "anomalies": ["异常信号"],
  "community_health": {{
    "steam_trend": "up|stable|down",
    "discord_trend": "up|stable|down",
    "bilibili_trend": "up|stable|down"
  }},
  "action_items": ["建议制作人关注的事项"]
}}

只输出 JSON。"""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text
        json_match = re.search(r"\{[\s\S]+\}", text)
        if json_match:
            return json.loads(json_match.group())
    except Exception as e:
        print(f"  - AI trend analysis error: {e}")
    return {}


# ============================================================
# Sleep-Time Compute (precomputed cache)
# ============================================================

CACHE_FILE = REPO / "assets" / "data" / "precomputed-cache.json"


def identify_hot_topics() -> list[str]:
    """Identify hot topics from access logs, insights, and recent files.

    Returns a list of topic strings for cache precomputation.
    """
    topics = []

    # From access-log: most frequently scanned files → their topics
    if ACCESS_LOG.exists():
        try:
            logs = json.loads(ACCESS_LOG.read_text(encoding="utf-8"))
            file_counts = Counter()
            for entry in logs[-7:]:  # Last 7 entries
                for fp in entry.get("files_scanned", []):
                    file_counts[fp] += 1
            # Top 5 files → extract topic from filename
            for fp, _ in file_counts.most_common(5):
                name = Path(fp).stem.replace("-", " ").replace("_", " ")
                topics.append(name)
        except (json.JSONDecodeError, OSError):
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


def log_access(files_accessed: list[str]):
    """Log which files were accessed during this dream run (feedback loop)."""
    DREAMS_DIR.mkdir(parents=True, exist_ok=True)

    log = []
    if ACCESS_LOG.exists():
        try:
            log = json.loads(ACCESS_LOG.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    log.append({
        "date": TODAY.isoformat(),
        "timestamp": datetime.now().isoformat(),
        "files_scanned": files_accessed,
        "count": len(files_accessed),
    })

    # Keep last 30 days
    log = log[-30:]

    ACCESS_LOG.write_text(
        json.dumps(log, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


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
            print(f"    ⚡ {c.get('description', '')[:80]}")
        for g in consolidation.get("knowledge_gaps", [])[:3]:
            print(f"    🕳 {g.get('topic', '')}: {g.get('evidence', '')[:60]}")
    else:
        print("  - No results (AI analysis unavailable or failed)")

    # Trend analysis
    print("\n## Trend Analysis")
    trends = ai_trend_analysis(client)
    if trends:
        sentiment = trends.get("sentiment", "unknown")
        print(f"  - Community sentiment: {sentiment}")
        for topic in trends.get("hot_topics", [])[:3]:
            print(f"    🔥 {topic}")
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
    """Rebuild knowledge graph via knowledge_graph module."""
    try:
        from knowledge_graph import build_graph
        graph = build_graph()
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

    # Rebuild vector index (TF-IDF)
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


def main():
    args = sys.argv[1:]
    deep = "--deep" in args or "--full" in args
    full = "--full" in args
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
        print("  - ✅ All data sources within normal range")
    else:
        for alert in sentinel.get("alerts", []):
            level = alert["level"]
            icon = {"red": "🔴", "orange": "🟠", "yellow": "🟡"}.get(level, "⚪")
            print(f"  - {icon} [{level.upper()}] {alert['message']}")

    print(f"\n## Phase 1 Summary")
    print(f"  - {phase1['issues']} structural issues found")
    if alert_count > 0:
        print(f"  - ⚠ {alert_count} sentinel alerts generated → projects/news/output/alerts.json")

    # Phase 2: Consolidate (AI-powered)
    phase2 = {}
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

    # Save journal
    journal_path = save_dream_journal(
        {k: v for k, v in phase1.items() if k != "keyword_index"},
        phase2 if phase2 else None,
    )
    print(f"\n📓 Dream journal saved: {journal_path}")

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
