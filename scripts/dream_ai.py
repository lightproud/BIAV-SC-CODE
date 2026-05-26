"""AI-powered consolidation + sleep-time precompute cache.

Extracted from dream.py. Entry points are wired into dream.run_phase2 /
main; check_cache is also imported by mcp_server.
"""

import json
import os
import re
from collections import Counter
from datetime import date
from pathlib import Path

from dream_config import CACHE_FILE, REPO, TODAY
from dream_io import load_access_log


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

    return list(dict.fromkeys(topics))[:10]


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
