"""REM phase — weekly deep reflection: cross-session pattern analysis,
insight generation and lesson accumulation.

Extracted from dream.py. run_rem(client) is the entry point (used by
dream.main when --rem is passed); the AI client is supplied by the caller.
"""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from dream_config import REPO, TODAY, _get_branch


def run_rem(client=None) -> dict:
    """REM sleep: weekly cross-session reflection and memory consolidation.

    Enhanced with Memory Flywheel (P4): consumes structured .meta.json
    for cross-session pattern discovery and insights generation.

    Steps:
    1. Collect session digests (.md) and structured metadata (.meta.json)
    2. Cross-session pattern discovery (zero-cost, from metadata)
    3. Extract recurring topics and hot files
    4. Detect unresolved items that persist across sessions
    5. Recalibrate MemRL utility scores
    6. AI-powered weekly reflection (if API available)
    7. Populate insights.json with actionable findings
    8. Save structured weekly report
    """
    from datetime import timedelta
    cutoff = (TODAY - timedelta(days=7)).isoformat().replace("-", "")

    # 1. Collect session digests + structured metadata from past week
    digests_dir = REPO / "memory" / "session-digests"
    weekly_digests = []
    weekly_metas = []
    if digests_dir.exists():
        for fp in sorted(digests_dir.glob("*.md")):
            if fp.stem[:8] >= cutoff:
                try:
                    text = fp.read_text(encoding="utf-8")
                    weekly_digests.append({"file": fp.name, "text": text[:3000]})
                except (OSError, UnicodeDecodeError):
                    continue

        # Load companion .meta.json files
        for fp in sorted(digests_dir.glob("*.meta.json")):
            if fp.stem.split('.')[0][:8] >= cutoff:
                try:
                    meta = json.loads(fp.read_text(encoding="utf-8"))
                    weekly_metas.append(meta)
                except (json.JSONDecodeError, OSError):
                    continue

    print(f"  - {len(weekly_digests)} session digests, {len(weekly_metas)} structured metadata")

    # 2. Cross-session pattern discovery from structured metadata
    cross_session = _analyze_cross_session_patterns(weekly_metas)
    print(f"  - Cross-session patterns: {len(cross_session.get('patterns', []))}")

    # 3. Collect search failure patterns
    search_failures = []
    sf_file = REPO / "memory" / "dreams" / "search-failures.json"
    if sf_file.exists():
        try:
            search_failures = json.loads(sf_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    print(f"  - {len(search_failures)} search failure records")

    # 4. Collect dream journal entries from past week
    dream_findings = []
    dreams_dir = REPO / "memory" / "dreams"
    for fp in sorted(dreams_dir.glob("20*.json")):
        if fp.stem >= cutoff[:4] + "-" + cutoff[4:6] + "-" + cutoff[6:8]:
            try:
                data = json.loads(fp.read_text(encoding="utf-8"))
                issues = data.get("phase1", {}).get("issues", 0)
                if issues > 0:
                    dream_findings.append({"date": fp.stem, "issues": issues})
            except (json.JSONDecodeError, OSError):
                continue

    # 5. Extract topic frequency (from metadata first, fallback to text scan)
    topic_counter = defaultdict(int)
    if weekly_metas:
        for meta in weekly_metas:
            for topic in meta.get("topics", []):
                topic_counter[topic] += 1
    else:
        # Fallback to entity scanning on raw text
        all_entities = {}
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from knowledge_graph import _build_entity_dict
            all_entities = _build_entity_dict()
        except (ImportError,):
            pass
        for digest in weekly_digests:
            text = digest["text"]
            for entity_name in all_entities:
                count = text.count(entity_name)
                if count >= 2:
                    topic_counter[entity_name] += count

    hot_topics = sorted(topic_counter.items(), key=lambda x: x[1], reverse=True)[:15]
    print(f"  - Top topics: {', '.join(t[0] for t in hot_topics[:5])}")

    # 6. Recalibrate MemRL utility scores
    try:
        from memrl import compute_utility
        utility = compute_utility()
        print(f"  - MemRL recalibrated: {len(utility)} files")
    except (ImportError, Exception) as e:
        print(f"  - MemRL recalibration skipped: {e}")

    # 7. AI-powered weekly reflection (if API available)
    ai_reflection = {}
    if client and (weekly_digests or weekly_metas):
        # Prefer structured metadata for AI input (more compact + informative)
        meta_summaries = ""
        if weekly_metas:
            meta_lines = []
            for m in weekly_metas[:15]:
                sid = m.get("session_id", "?")[:8]
                topics = ", ".join(m.get("topics", [])[:5])
                decisions = "; ".join(d.get("content", d) if isinstance(d, dict) else d
                                     for d in m.get("decisions", [])[:3])
                opens = "; ".join(m.get("open_items", [])[:3])
                key_files = ", ".join(Path(f).name for f in m.get("key_files", [])[:3])
                meta_lines.append(
                    f"- {sid}: topics=[{topics}] decisions=[{decisions}] "
                    f"open=[{opens}] files=[{key_files}]"
                )
            meta_summaries = "\n".join(meta_lines)
        else:
            meta_summaries = "\n\n".join(
                f"### {d['file']}\n{d['text'][:800]}" for d in weekly_digests[:10]
            )

        cross_session_summary = ""
        if cross_session.get("patterns"):
            cross_session_summary = "\n\n## 跨会话模式（自动发现）\n" + json.dumps(
                cross_session["patterns"], ensure_ascii=False, indent=2
            )

        search_fail_summary = ""
        if search_failures:
            queries = [f.get("query", "") for f in search_failures[-20:]]
            search_fail_summary = f"\n\n## 搜索失败记录\n{', '.join(queries)}"

        prompt = f"""你是银芯做梦 Agent（REM 层）。基于以下本周会话数据，进行深度反思。

## 本周会话结构化摘要
{meta_summaries}
{cross_session_summary}
{search_fail_summary}

## 本周热门话题
{json.dumps(dict(hot_topics), ensure_ascii=False)}

## 分析要求
1. 跨会话重复模式：哪些问题/话题反复出现？
2. 未解决的问题：哪些任务被提及但未完成？
3. 方法论发现：哪些做法有效，哪些无效？
4. 知识缺口：搜索失败揭示了哪些缺失的知识？
5. 改进建议：下周应该优先做什么？

输出 JSON：
{{
  "recurring_patterns": [{{"pattern": "描述", "frequency": N, "sessions": ["会话ID"]}}],
  "unresolved_issues": [{{"issue": "描述", "first_seen": "日期"}}],
  "effective_practices": ["有效做法"],
  "ineffective_practices": ["无效做法"],
  "knowledge_gaps": ["缺失知识点"],
  "new_lessons": [{{"lesson": "经验", "evidence": "来源"}}],
  "next_week_priorities": ["优先事项"],
  "weekly_summary": "一段话总结本周"
}}

只输出 JSON。"""

        try:
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.content[0].text
            json_match = re.search(r"\{[\s\S]+\}", text)
            if json_match:
                ai_reflection = json.loads(json_match.group())
                print(f"  - AI reflection complete")

                # Auto-write new lessons to lessons-learned.md
                new_lessons = ai_reflection.get("new_lessons", [])
                if new_lessons:
                    _append_lessons(new_lessons)
                    print(f"  - {len(new_lessons)} new lessons written to lessons-learned.md")
        except Exception as e:
            print(f"  - AI reflection error: {e}")

    # 8. Populate insights.json with cross-session findings
    new_insights = _generate_insights(cross_session, search_failures, hot_topics)
    if new_insights:
        _save_insights(new_insights)
        print(f"  - {len(new_insights)} new insights written to insights.json")

    # 9. Save weekly report
    report = {
        "week": TODAY.isoformat(),
        "branch": _get_branch(),
        "sessions_analyzed": len(weekly_digests),
        "structured_metas": len(weekly_metas),
        "search_failures": len(search_failures),
        "dream_findings": dream_findings,
        "hot_topics": dict(hot_topics),
        "cross_session_patterns": cross_session,
        "insights_generated": len(new_insights),
        "ai_reflection": ai_reflection,
    }

    report_file = REPO / "memory" / "dreams" / f"{TODAY.isocalendar()[0]}-W{TODAY.isocalendar()[1]:02d}-weekly.json"
    report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  - Weekly report saved: {report_file.relative_to(REPO)}")

    return report


def _analyze_cross_session_patterns(metas: list[dict]) -> dict:
    """Analyze structured session metadata for cross-session patterns.

    Detects:
    - Recurring file edits (same file modified in 3+ sessions)
    - Persistent open items (appear in multiple sessions)
    - Topic evolution (how focus shifted over the week)
    - Decision clusters (related decisions across sessions)
    """
    if not metas:
        return {"patterns": [], "file_heatmap": {}, "open_item_persistence": []}

    patterns = []

    # File edit frequency: which files are repeatedly modified
    file_edit_counter = defaultdict(list)
    for m in metas:
        sid = m.get("session_id", "?")[:8]
        for fp in m.get("key_files", []):
            file_edit_counter[fp].append(sid)

    for fp, sessions in file_edit_counter.items():
        if len(sessions) >= 3:
            patterns.append({
                "type": "recurring_edit",
                "description": f"{Path(fp).name} modified in {len(sessions)} sessions",
                "file": fp,
                "sessions": sessions,
                "severity": "info" if len(sessions) < 5 else "attention",
            })

    # Persistent open items: items that appear across multiple sessions
    open_item_tracker = defaultdict(list)
    for m in metas:
        sid = m.get("session_id", "?")[:8]
        for item in m.get("open_items", []):
            # Normalize: lowercase, strip punctuation
            normalized = item.lower().strip(".,;:!?")
            open_item_tracker[normalized].append(sid)

    persistent_items = []
    for item, sessions in open_item_tracker.items():
        if len(sessions) >= 2:
            persistent_items.append({
                "item": item,
                "sessions": sessions,
                "persistence": len(sessions),
            })
            patterns.append({
                "type": "persistent_open_item",
                "description": f"Unresolved across {len(sessions)} sessions: {item[:80]}",
                "sessions": sessions,
                "severity": "attention",
            })

    # Topic evolution: how topics shift across sessions
    topic_timeline = []
    for m in sorted(metas, key=lambda x: x.get("timestamp_range", [""])[0] or ""):
        sid = m.get("session_id", "?")[:8]
        topics = m.get("topics", [])[:5]
        if topics:
            topic_timeline.append({"session": sid, "topics": topics})

    # Decision clusters
    all_decisions = []
    for m in metas:
        sid = m.get("session_id", "?")[:8]
        for d in m.get("decisions", []):
            content = d.get("content", d) if isinstance(d, dict) else d
            all_decisions.append({"content": content, "session": sid})

    if len(all_decisions) >= 3:
        patterns.append({
            "type": "decision_cluster",
            "description": f"{len(all_decisions)} decisions made across {len(metas)} sessions",
            "decisions": [d["content"][:80] for d in all_decisions[:5]],
            "severity": "info",
        })

    # File heatmap: engagement level per file across sessions
    file_heatmap = {}
    for m in metas:
        for fp, level in m.get("files_engagement", {}).items():
            if fp not in file_heatmap:
                file_heatmap[fp] = {"sessions": 0, "max_level": "read_only"}
            file_heatmap[fp]["sessions"] += 1
            level_rank = {"read_only": 0, "read_and_edited": 1, "read_edit_commit": 2}
            if level_rank.get(level, 0) > level_rank.get(file_heatmap[fp]["max_level"], 0):
                file_heatmap[fp]["max_level"] = level

    return {
        "patterns": patterns,
        "file_heatmap": {k: v for k, v in sorted(
            file_heatmap.items(), key=lambda x: x[1]["sessions"], reverse=True
        )[:20]},
        "open_item_persistence": persistent_items,
        "topic_timeline": topic_timeline,
        "total_decisions": len(all_decisions),
    }


def _generate_insights(cross_session: dict, search_failures: list, hot_topics: list) -> list[dict]:
    """Generate actionable insights from cross-session analysis.

    Populates insights.json with findings from REM analysis.
    """
    insights = []
    today_str = TODAY.isoformat()

    # From cross-session patterns
    for pattern in cross_session.get("patterns", []):
        if pattern.get("severity") == "attention":
            insights.append({
                "id": f"rem-{today_str}-{len(insights)+1:03d}",
                "type": pattern["type"],
                "summary": pattern["description"],
                "evidence": pattern.get("sessions", []),
                "suggested_action": _suggest_action(pattern),
                "auto_actionable": False,
                "confidence": 0.7 + min(len(pattern.get("sessions", [])) * 0.05, 0.25),
                "created": today_str,
            })

    # From persistent open items
    for item in cross_session.get("open_item_persistence", []):
        if item["persistence"] >= 3:
            insights.append({
                "id": f"rem-{today_str}-open-{len(insights)+1:03d}",
                "type": "persistent_open_item",
                "summary": f"Task unresolved across {item['persistence']} sessions: {item['item'][:80]}",
                "evidence": item["sessions"],
                "suggested_action": "Escalate to CONTEXT.md or create GitHub issue",
                "auto_actionable": False,
                "confidence": 0.8,
                "created": today_str,
            })

    # From search failures
    if search_failures:
        from collections import Counter as _Counter
        query_terms = _Counter()
        for f in search_failures:
            for token in f.get("tokens", []):
                if len(token) >= 2:
                    query_terms[token] += 1
        frequent = [(t, c) for t, c in query_terms.most_common(5) if c >= 2]
        if frequent:
            insights.append({
                "id": f"rem-{today_str}-vocab-{len(insights)+1:03d}",
                "type": "knowledge_gap",
                "summary": f"Search vocabulary gaps: {', '.join(t for t, _ in frequent)}",
                "evidence": [f"{t} (failed {c}x)" for t, c in frequent],
                "suggested_action": "Expand knowledge_graph entity dictionary with these terms",
                "auto_actionable": True,
                "confidence": 0.75,
                "created": today_str,
            })

    return insights


def _suggest_action(pattern: dict) -> str:
    """Generate action suggestion for a cross-session pattern."""
    ptype = pattern.get("type", "")
    if ptype == "recurring_edit":
        return f"File {pattern.get('file', '')} is a hotspot. Consider stabilizing its API or documenting its structure."
    if ptype == "persistent_open_item":
        return "Escalate to CONTEXT.md or create a GitHub issue for tracking."
    if ptype == "decision_cluster":
        return "Review decisions for consistency. Consider documenting in decisions.md."
    return "Review and address this pattern."


def _save_insights(new_insights: list[dict]):
    """Append new insights to insights.json. All insights are kept permanently."""
    insights_file = REPO / "memory" / "dreams" / "insights.json"
    existing = []
    if insights_file.exists():
        try:
            data = json.loads(insights_file.read_text(encoding="utf-8"))
            if isinstance(data, list):
                existing = data
            elif isinstance(data, dict):
                existing = data.get("insights", [])
        except (json.JSONDecodeError, OSError):
            pass

    # Dedupe by id: same-day reruns regenerate the same rem-{date}-NNN ids,
    # and _save_insights is append-only, so guard against duplicates here.
    seen = {ins["id"] for ins in existing if "id" in ins}
    for ins in new_insights:
        if ins.get("id") in seen:
            continue
        existing.append(ins)
        if "id" in ins:
            seen.add(ins["id"])

    insights_file.write_text(
        json.dumps(existing, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _append_lessons(new_lessons: list[dict]):
    """Append new lessons from REM reflection to lessons-learned.md."""
    ll_file = REPO / "memory" / "lessons-learned.md"
    if not ll_file.exists():
        return

    text = ll_file.read_text(encoding="utf-8")

    # Find the highest lesson number (headings are "## N. ..." format)
    existing_nums = re.findall(r"^##\s+(\d+)\.", text, re.MULTILINE)
    next_num = max((int(n) for n in existing_nums), default=0) + 1

    # Append new lessons
    additions = []
    for lesson in new_lessons:
        content = lesson.get("lesson", "")
        evidence = lesson.get("evidence", "")
        if content:
            entry = f"\n## {next_num}. **[REM {TODAY}]** {content}"
            if evidence:
                entry += f"\n   - Evidence: {evidence}"
            additions.append(entry)
            next_num += 1

    if additions:
        # Update timestamp
        text = re.sub(
            r"(> 最后更新：)\S+( by )\S+",
            f"\\g<1>{TODAY}\\g<2>dream(rem)",
            text, count=1,
        )
        text += "\n" + "\n".join(additions) + "\n"
        ll_file.write_text(text, encoding="utf-8")
