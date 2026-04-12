"""
session_briefing.py — Smart Session Briefing Generator

Part of the Memory Flywheel (P2). Generates a dynamic briefing for new
sessions by combining data from all 9 memory modules:

- Session continuity chain (what happened last time)
- Git log (changes since last session)
- Dream findings (overnight insights)
- MemRL utility (file importance trends)
- Facts store (new facts)
- Sentinel alerts (anomalies)
- Context recommendations (momentum-based)

Replaces passive boot-snapshot reading with an active,
context-aware session initialization.

Usage:
  python scripts/session_briefing.py                # Full briefing
  python scripts/session_briefing.py --role Code-wiki  # Role-specific
  python scripts/session_briefing.py --json          # Machine-readable
"""

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

CONTINUITY_FILE = REPO / "memory" / "session-continuity.json"
UTILITY_FILE = REPO / "assets" / "data" / "memory-utility.json"
FACTS_FILE = REPO / "memory" / "facts.json"
DREAMS_DIR = REPO / "memory" / "dreams"
DIGESTS_DIR = REPO / "memory" / "session-digests"
ALERTS_FILE = REPO / "projects" / "news" / "output" / "alerts.json"


def _load_json(path: Path) -> dict | list | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _git_log_since(timestamp: str, max_entries: int = 20) -> list[str]:
    """Get git log entries since a timestamp."""
    try:
        result = subprocess.run(
            ["git", "log", f"--since={timestamp}", "--oneline", f"-{max_entries}"],
            capture_output=True, text=True, timeout=10, cwd=str(REPO),
        )
        if result.returncode == 0:
            return [l.strip() for l in result.stdout.strip().split('\n') if l.strip()]
    except Exception:
        pass
    return []


def _latest_dream() -> dict | None:
    """Find the most recent dream journal."""
    journals = sorted(DREAMS_DIR.glob("20*.json"), reverse=True)
    if not journals:
        return None
    return _load_json(journals[0])


def _latest_weekly() -> dict | None:
    """Find the most recent weekly REM report."""
    weeklies = sorted(DREAMS_DIR.glob("*-weekly.json"), reverse=True)
    if not weeklies:
        return None
    return _load_json(weeklies[0])


def _recent_facts(since: str, max_items: int = 5) -> list[dict]:
    """Get facts created since a given date."""
    facts = _load_json(FACTS_FILE)
    if not facts or not isinstance(facts, list):
        return []
    recent = [f for f in facts if f.get("created", "") >= since and not f.get("obsolete")]
    return recent[-max_items:]


def _utility_highlights(top_n: int = 5) -> dict:
    """Get utility highlights: rising, declining, and top files."""
    utility = _load_json(UTILITY_FILE)
    if not utility:
        return {"rising": [], "declining": [], "top": []}

    items = list(utility.items())
    rising = [(fp, d) for fp, d in items if d.get("trend") == "rising"]
    declining = [(fp, d) for fp, d in items if d.get("trend") == "declining"]
    top = sorted(items, key=lambda x: x[1].get("utility", 0), reverse=True)

    return {
        "rising": [{"file": fp, "utility": d["utility"]} for fp, d in rising[:top_n]],
        "declining": [{"file": fp, "utility": d["utility"]} for fp, d in declining[:top_n]],
        "top": [{"file": fp, "utility": d["utility"]} for fp, d in top[:top_n]],
    }


def _sentinel_alerts() -> list[dict]:
    """Get recent sentinel alerts."""
    alerts = _load_json(ALERTS_FILE)
    if not alerts or not isinstance(alerts, list):
        return []
    # Return alerts from last 48 hours
    cutoff = datetime.now(timezone.utc).isoformat()[:10]
    return [a for a in alerts if a.get("date", "") >= cutoff][:5]


def generate_briefing(role: str = "") -> dict:
    """Generate a complete session briefing.

    Returns structured data that can be rendered as markdown or JSON.
    """
    continuity = _load_json(CONTINUITY_FILE) or {}
    last_session = continuity.get("last_session")
    momentum = continuity.get("momentum", {})

    # Determine time reference for "since last session"
    since_ts = None
    if last_session and last_session.get("timestamp"):
        since_ts = last_session["timestamp"]
    since_date = since_ts[:10] if since_ts else datetime.now(timezone.utc).isoformat()[:10]

    sections = {}

    # --- Section 1: Last session recap ---
    if last_session:
        sections["last_session"] = {
            "id": last_session.get("id", "?"),
            "timestamp": last_session.get("timestamp", ""),
            "duration_minutes": last_session.get("duration_minutes"),
            "topics": last_session.get("topics", []),
            "decisions": last_session.get("decisions", []),
            "open_items": last_session.get("open_items", []),
            "files_changed": last_session.get("files_changed", [])[:10],
        }
    else:
        sections["last_session"] = None

    # --- Section 2: Changes since last session ---
    commits = _git_log_since(since_ts or "24 hours ago") if since_ts else []
    sections["changes_since"] = {
        "commits": commits,
        "commit_count": len(commits),
    }

    # --- Section 3: Dream findings ---
    dream = _latest_dream()
    weekly = _latest_weekly()
    dream_summary = {}
    if dream:
        phase1 = dream.get("phase1", {})
        dream_summary["date"] = dream.get("date", "")
        dream_summary["issues"] = phase1.get("issues", 0)
        # Extract sentinel info
        sentinel = phase1.get("sentinel", {})
        dream_summary["alerts"] = sentinel.get("alert_count", 0)
    if weekly:
        dream_summary["weekly"] = {
            "week": weekly.get("week", ""),
            "sessions_analyzed": weekly.get("sessions_analyzed", 0),
            "hot_topics": dict(list(weekly.get("hot_topics", {}).items())[:5]),
            "has_ai_reflection": bool(weekly.get("ai_reflection")),
        }
    sections["dream_findings"] = dream_summary

    # --- Section 4: New facts ---
    new_facts = _recent_facts(since_date)
    sections["new_facts"] = [
        {"content": f["content"][:100], "category": f.get("category", "?")}
        for f in new_facts
    ]

    # --- Section 5: Alerts ---
    sections["sentinel_alerts"] = _sentinel_alerts()

    # --- Section 6: Momentum & recommendations ---
    topic_weights = momentum.get("topic_weights", {})
    hot_files = momentum.get("hot_files", [])
    total_sessions = momentum.get("total_sessions", 0)

    sections["momentum"] = {
        "top_topics": dict(list(topic_weights.items())[:5]),
        "hot_files": hot_files[:5],
        "total_sessions": total_sessions,
    }

    # --- Section 7: Utility highlights ---
    sections["utility"] = _utility_highlights()

    # --- Section 8: Context recommendations ---
    try:
        from context_manager import recommend_context
        # Use momentum topics as query if no role specified
        query_topics = list(topic_weights.keys())[:3]
        query = " ".join(query_topics) if query_topics else "project status"
        reco = recommend_context(query, role=role, max_files=5)
        sections["recommended_context"] = reco.get("recommended_files", [])
    except Exception:
        sections["recommended_context"] = []

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "role": role,
        "sections": sections,
    }


def render_markdown(briefing: dict) -> str:
    """Render briefing as human-readable markdown."""
    lines = []
    sections = briefing.get("sections", {})
    role = briefing.get("role", "")

    lines.append("# Session Briefing")
    if role:
        lines.append(f"> Role: {role}")
    lines.append("")

    # Last session
    last = sections.get("last_session")
    if last:
        lines.append("## 上次会话回顾")
        lines.append(f"- ID: {last['id']} ({last.get('duration_minutes', '?')} min, {last.get('timestamp', '')[:10]})")
        if last.get("topics"):
            lines.append(f"- 主题: {', '.join(last['topics'][:5])}")
        if last.get("decisions"):
            lines.append("- 决策:")
            for d in last["decisions"][:3]:
                lines.append(f"  - {d}")
        if last.get("open_items"):
            lines.append("- 遗留事项:")
            for item in last["open_items"][:3]:
                lines.append(f"  - {item}")
        lines.append("")
    else:
        lines.append("## 上次会话回顾")
        lines.append("无历史记录（首次会话或连续性链未初始化）")
        lines.append("")

    # Changes since
    changes = sections.get("changes_since", {})
    commits = changes.get("commits", [])
    if commits:
        lines.append(f"## 自上次以来的变化 ({len(commits)} commits)")
        for c in commits[:8]:
            lines.append(f"- {c}")
        if len(commits) > 8:
            lines.append(f"- ...and {len(commits) - 8} more")
        lines.append("")

    # Dream findings
    dream = sections.get("dream_findings", {})
    if dream:
        lines.append("## 做梦系统发现")
        if dream.get("date"):
            lines.append(f"- 最新: {dream['date']}, {dream.get('issues', 0)} issues, {dream.get('alerts', 0)} alerts")
        weekly = dream.get("weekly")
        if weekly:
            lines.append(f"- 周报: {weekly.get('week', '')}, {weekly.get('sessions_analyzed', 0)} sessions analyzed")
            if weekly.get("hot_topics"):
                tops = ", ".join(f"{k}({v})" for k, v in list(weekly["hot_topics"].items())[:3])
                lines.append(f"- 热门主题: {tops}")
        lines.append("")

    # New facts
    new_facts = sections.get("new_facts", [])
    if new_facts:
        lines.append(f"## 新增事实 ({len(new_facts)})")
        for f in new_facts:
            lines.append(f"- [{f['category']}] {f['content']}")
        lines.append("")

    # Alerts
    alerts = sections.get("sentinel_alerts", [])
    if alerts:
        lines.append(f"## 哨兵告警 ({len(alerts)})")
        for a in alerts:
            lines.append(f"- {a.get('level', '?')}: {a.get('message', '')[:80]}")
        lines.append("")

    # Momentum
    momentum = sections.get("momentum", {})
    if momentum.get("top_topics"):
        lines.append("## 话题动量")
        lines.append(f"- 累计 {momentum.get('total_sessions', 0)} 次会话")
        topics_str = ", ".join(f"{k}({v})" for k, v in list(momentum["top_topics"].items())[:5])
        lines.append(f"- 近期焦点: {topics_str}")
        if momentum.get("hot_files"):
            lines.append(f"- 反复修改: {', '.join(Path(f).name for f in momentum['hot_files'][:3])}")
        lines.append("")

    # Utility
    util = sections.get("utility", {})
    rising = util.get("rising", [])
    declining = util.get("declining", [])
    if rising:
        lines.append("## 效用趋势")
        for r in rising[:3]:
            lines.append(f"- [rising] {r['file']} ({r['utility']:.3f})")
        for d in declining[:3]:
            lines.append(f"- [declining] {d['file']} ({d['utility']:.3f})")
        lines.append("")

    # Recommendations
    reco = sections.get("recommended_context", [])
    if reco:
        lines.append("## 推荐上下文")
        for r in reco[:5]:
            lines.append(f"- [{r.get('score', 0):.3f}] {r['file']} ({r.get('reason', '')})")
        lines.append("")

    return "\n".join(lines)


def main():
    args = sys.argv[1:]
    role = ""
    json_mode = "--json" in args

    if "--role" in args:
        idx = args.index("--role")
        if idx + 1 < len(args):
            role = args[idx + 1]

    briefing = generate_briefing(role=role)

    if json_mode:
        print(json.dumps(briefing, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(briefing))


if __name__ == "__main__":
    main()
