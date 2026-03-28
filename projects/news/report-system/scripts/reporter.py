#!/usr/bin/env python3
"""
忘却前夜 Morimens - 报告生成器
读取 collected_raw.json，生成结构化报告 (JSON + HTML + RSS)。

使用: python scripts/reporter.py
输入: data/collected_raw.json
输出: data/report.json, data/report.html, data/feed.xml
"""

import html as _html
import json
import os
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("reporter")

BASE_DIR = Path(__file__).resolve().parent.parent
RAW_PATH = BASE_DIR / "data" / "collected_raw.json"
REPORT_JSON_PATH = BASE_DIR / "data" / "report.json"
REPORT_HTML_PATH = BASE_DIR / "data" / "report.html"
FEED_PATH = BASE_DIR / "data" / "feed.xml"


# ─── AI 摘要生成 ──────────────────────────────────────────

def generate_ai_summary(items, lang="zh"):
    """使用 Claude API 生成报告摘要。"""
    api_key = os.environ.get("LLM_API_KEY")
    api_url = os.environ.get("LLM_API_URL", "https://api.anthropic.com/v1/messages")

    if not api_key:
        return _fallback_summary(items)

    titles_text = "\n".join(
        f"- [{it['source']}][{it.get('lang', '?')}] {it['title']} (engagement: {it['engagement']})"
        for it in items[:30]
    )

    lang_instruction = {
        "zh": "请用中文撰写",
        "en": "Please write in English",
        "ja": "日本語で書いてください",
    }.get(lang, "请用中文撰写")

    prompt = f"""你是忘却前夜(Morimens)游戏社区分析师。以下是过去24小时全球社区收集到的热点信息。
{lang_instruction}一份简要的每日社区情报报告，包含:

1. **总览** (2-3句话概述今日社区整体动态)
2. **热门话题 TOP 5** (每条1-2句话说明)
3. **各区域动态** (中文社区 / 英文社区 / 其他)
4. **舆情风向** (整体正面/中性/负面，关注点)

信息列表:
{titles_text}

注意：输出纯文本，不要使用 Markdown 格式。每个段落之间空一行。"""

    try:
        resp = requests.post(
            api_url,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 1000,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["content"][0]["text"]
    except Exception as e:
        logger.warning(f"AI summary failed: {e}")
        return _fallback_summary(items)


def _fallback_summary(items):
    """无 AI 时的兜底摘要。"""
    hot = [it for it in items if it.get("is_hot")][:5] or items[:5]
    lines = []
    lines.append("=== 今日社区热点 ===\n")
    for i, it in enumerate(hot, 1):
        lines.append(f"{i}. [{it['source']}] {it['title']}")
    return "\n".join(lines)


# ─── 分析函数 ─────────────────────────────────────────────

def analyze_sentiment_distribution(items):
    """简单的内容分类分析（基于关键词）。"""
    categories = {
        "version_update": {"keywords": ["版本", "更新", "update", "patch", "维护", "前瞻"], "count": 0, "items": []},
        "character": {"keywords": ["角色", "character", "立绘", "技能", "skill", "banner"], "count": 0, "items": []},
        "strategy": {"keywords": ["攻略", "配队", "guide", "team", "build", "打法", "深渊"], "count": 0, "items": []},
        "fan_creation": {"keywords": ["同人", "创作", "fanart", "cosplay", "二创"], "count": 0, "items": []},
        "discussion": {"keywords": ["讨论", "吐槽", "建议", "opinion", "review"], "count": 0, "items": []},
        "news": {"keywords": ["公告", "官方", "official", "announcement", "联动", "collab"], "count": 0, "items": []},
    }

    for item in items:
        text = (item["title"] + " " + item.get("summary", "")).lower()
        matched = False
        for cat_key, cat in categories.items():
            if any(kw in text for kw in cat["keywords"]):
                cat["count"] += 1
                cat["items"].append(item["title"][:50])
                matched = True
                break
        if not matched:
            categories.setdefault("other", {"keywords": [], "count": 0, "items": []})
            categories["other"]["count"] += 1

    return {k: {"count": v["count"], "sample_titles": v["items"][:3]} for k, v in categories.items() if v["count"] > 0}


def compute_platform_activity(items):
    """计算各平台活跃度指标。"""
    platforms = {}
    for item in items:
        src = item["source"]
        if src not in platforms:
            platforms[src] = {"count": 0, "total_engagement": 0, "top_item": None}

        platforms[src]["count"] += 1
        platforms[src]["total_engagement"] += item.get("engagement", 0)

        if platforms[src]["top_item"] is None or item.get("engagement", 0) > platforms[src]["top_item"].get("engagement", 0):
            platforms[src]["top_item"] = {
                "title": item["title"][:80],
                "engagement": item.get("engagement", 0),
                "url": item.get("url", ""),
            }

    return platforms


def compute_region_breakdown(items):
    """按地区汇总。"""
    regions = {}
    for item in items:
        r = item.get("platform_region", "unknown")
        if r not in regions:
            regions[r] = {"count": 0, "total_engagement": 0, "sources": set()}
        regions[r]["count"] += 1
        regions[r]["total_engagement"] += item.get("engagement", 0)
        regions[r]["sources"].add(item["source"])

    return {k: {"count": v["count"], "total_engagement": v["total_engagement"], "sources": sorted(v["sources"])} for k, v in regions.items()}


# ─── 报告生成 ─────────────────────────────────────────────

ANALYSIS_PATH = BASE_DIR / "data" / "analysis.json"


def generate_report(analysis=None):
    """主报告生成流程。可接收 analyst 的分析结果。"""
    logger.info("=== 开始生成报告 ===")

    # 如果没有传入 analysis，尝试从文件读取
    if analysis is None and ANALYSIS_PATH.exists():
        with open(ANALYSIS_PATH, "r", encoding="utf-8") as f:
            analysis = json.load(f)
        logger.info("Loaded analyst output from analysis.json")

    if not RAW_PATH.exists():
        logger.error(f"Raw data not found: {RAW_PATH}")
        logger.info("请先运行 collector.py 收集数据")
        return None

    with open(RAW_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)

    items = raw.get("items", [])
    if not items:
        logger.warning("No items found in collected data")
        return None

    logger.info(f"Processing {len(items)} items...")

    # 分析
    topic_analysis = analyze_sentiment_distribution(items)
    platform_activity = compute_platform_activity(items)
    region_breakdown = compute_region_breakdown(items)

    # 摘要: 优先使用私人分析师的输出
    if analysis and analysis.get("briefing"):
        summary_zh = analysis["briefing"]
    else:
        summary_zh = generate_ai_summary(items, lang="zh")

    # 构建报告
    now = datetime.now(timezone.utc)
    report = {
        "report_id": now.strftime("RPT-%Y%m%d-%H%M"),
        "generated_at": now.isoformat(),
        "period": {
            "hours": raw.get("hours_lookback", 24),
            "from": (now - timedelta(hours=raw.get("hours_lookback", 24))).isoformat(),
            "to": now.isoformat(),
        },
        "overview": {
            "total_items": len(items),
            "total_engagement": sum(it.get("engagement", 0) for it in items),
            "active_sources": len(set(it["source"] for it in items)),
            "hot_items_count": sum(1 for it in items if it.get("is_hot")),
        },
        "summary": summary_zh,
        "analyst": {
            "key_events": analysis.get("key_events", []) if analysis else [],
            "risk_alerts": analysis.get("risk_alerts", []) if analysis else [],
            "trend_notes": analysis.get("trend_notes", []) if analysis else [],
            "insights": analysis.get("insights", []) if analysis else [],
            "sentiment": analysis.get("sentiment", "unknown") if analysis else "unknown",
            "focus_rating": analysis.get("focus_rating", 0) if analysis else 0,
            "tomorrow_watch": analysis.get("tomorrow_watch", []) if analysis else [],
            "report_number": analysis.get("report_number", 0) if analysis else 0,
        },
        "top_items": [
            {
                "rank": i + 1,
                "title": it["title"],
                "source": it["source"],
                "engagement": it["engagement"],
                "url": it.get("url", ""),
                "time": it.get("time", ""),
                "lang": it.get("lang", ""),
            }
            for i, it in enumerate(items[:10])
        ],
        "analysis": {
            "topics": topic_analysis,
            "platforms": platform_activity,
            "regions": region_breakdown,
        },
        "all_items": items,
    }

    # 输出 JSON
    with open(REPORT_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    logger.info(f"Report JSON → {REPORT_JSON_PATH}")

    # 输出 HTML
    generate_html_report(report)
    logger.info(f"Report HTML → {REPORT_HTML_PATH}")

    # 输出 RSS
    generate_rss_feed(report)
    logger.info(f"RSS Feed → {FEED_PATH}")

    logger.info("=== 报告生成完成 ===")
    return report


# ─── HTML 报告 ────────────────────────────────────────────

def generate_html_report(report):
    """生成独立 HTML 报告页面。"""
    e = _html.escape  # shorthand

    top_items_html = ""
    for it in report["top_items"]:
        hot_badge = '<span class="badge hot">HOT</span>' if it["rank"] <= 5 else ""
        top_items_html += f"""
        <tr>
            <td class="rank">#{it['rank']}</td>
            <td><a href="{e(it['url'])}" target="_blank">{e(it['title'][:80])}</a> {hot_badge}</td>
            <td><span class="badge source-{e(it['source'])}">{e(it['source'])}</span></td>
            <td class="num">{_format_number(it['engagement'])}</td>
        </tr>"""

    platform_html = ""
    for name, data in report["analysis"]["platforms"].items():
        top = data.get("top_item", {})
        platform_html += f"""
        <div class="platform-card">
            <div class="platform-name">
                <span class="badge source-{e(name)}">{e(name)}</span>
                <span class="platform-count">{data['count']} items</span>
            </div>
            <div class="platform-engagement">Total engagement: {_format_number(data['total_engagement'])}</div>
            <div class="platform-top">Top: {e(top.get('title', 'N/A')[:60])}</div>
        </div>"""

    topic_html = ""
    for cat, data in report["analysis"]["topics"].items():
        topic_html += f"""
        <div class="topic-item">
            <span class="topic-label">{e(cat)}</span>
            <span class="topic-count">{data['count']}</span>
        </div>"""

    # 私人分析师板块
    analyst_data = report.get("analyst", {})
    analyst_html = ""
    if analyst_data and any(analyst_data.get(k) for k in ("key_events", "risk_alerts", "trend_notes", "insights", "tomorrow_watch")):
        sections = []

        if analyst_data.get("risk_alerts"):
            alerts = "".join(f"<li style='color:#ef4444'>{e(a)}</li>" for a in analyst_data["risk_alerts"])
            sections.append(f"<div style='margin-bottom:1rem'><strong style='color:#ef4444'>Risk Alerts</strong><ul style='margin:0.3rem 0 0 1.2rem'>{alerts}</ul></div>")

        if analyst_data.get("key_events"):
            events = "".join(f"<li>{e(ev)}</li>" for ev in analyst_data["key_events"])
            sections.append(f"<div style='margin-bottom:1rem'><strong>Key Events</strong><ul style='margin:0.3rem 0 0 1.2rem'>{events}</ul></div>")

        if analyst_data.get("trend_notes"):
            trends = "".join(f"<li>{e(t)}</li>" for t in analyst_data["trend_notes"])
            sections.append(f"<div style='margin-bottom:1rem'><strong>Trend Notes</strong><ul style='margin:0.3rem 0 0 1.2rem'>{trends}</ul></div>")

        if analyst_data.get("insights"):
            ins = "".join(f"<li>{e(i)}</li>" for i in analyst_data["insights"])
            sections.append(f"<div style='margin-bottom:1rem'><strong>Insights</strong><ul style='margin:0.3rem 0 0 1.2rem'>{ins}</ul></div>")

        if analyst_data.get("tomorrow_watch"):
            watch = "".join(f"<li>{e(w)}</li>" for w in analyst_data["tomorrow_watch"])
            sections.append(f"<div style='margin-bottom:1rem'><strong>Tomorrow Watch</strong><ul style='margin:0.3rem 0 0 1.2rem'>{watch}</ul></div>")

        sentiment = analyst_data.get("sentiment", "unknown")
        focus = analyst_data.get("focus_rating", 0)
        report_num = analyst_data.get("report_number", 0)
        meta_line = f"<div style='font-size:0.8rem;color:#6565a0;margin-top:0.5rem'>Sentiment: {sentiment} | Focus Rating: {focus}/10 | Report #{report_num}</div>"

        analyst_html = f"""
    <div class="section" style="border-color:rgba(139,92,246,0.4);background:linear-gradient(135deg,rgba(139,92,246,0.05),rgba(59,130,246,0.05))">
        <h2>🤖 Private Analyst</h2>
        {"".join(sections)}
        {meta_line}
    </div>"""

    overview = report["overview"]
    summary_escaped = _html.escape(report["summary"]).replace("\n", "<br>")

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>忘却前夜 全球情报日报 - {report['report_id']}</title>
<style>
:root {{
    --bg: #0b0b1e;
    --bg2: #111133;
    --bg3: #1a1a44;
    --text: #e0e0f0;
    --text2: #9999bb;
    --purple: #8b5cf6;
    --blue: #3b82f6;
    --pink: #ec4899;
    --amber: #f59e0b;
    --green: #10b981;
    --red: #ef4444;
    --border: #2a2a55;
}}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }}

.header {{
    background: linear-gradient(135deg, #4a00e0, #8e2de2, #00d2ff);
    padding: 2.5rem 2rem;
    text-align: center;
}}
.header h1 {{ font-size: 1.8rem; font-weight: 700; }}
.header .subtitle {{ opacity: 0.9; font-size: 0.95rem; margin-top: 0.3rem; }}
.header .report-meta {{ margin-top: 1rem; font-size: 0.85rem; opacity: 0.8; display: flex; justify-content: center; gap: 2rem; flex-wrap: wrap; }}

.container {{ max-width: 1000px; margin: 0 auto; padding: 1.5rem; }}

.stats-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
}}
.stat-card {{
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.2rem;
    text-align: center;
}}
.stat-card .value {{ font-size: 2rem; font-weight: 700; color: var(--purple); }}
.stat-card .label {{ font-size: 0.8rem; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.3rem; }}

.section {{
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
}}
.section h2 {{
    font-size: 1.2rem;
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 0.5rem;
}}

.summary-text {{ color: var(--text2); font-size: 0.95rem; line-height: 1.8; white-space: pre-line; }}

table {{ width: 100%; border-collapse: collapse; }}
th, td {{ text-align: left; padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--border); font-size: 0.9rem; }}
th {{ color: var(--text2); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }}
td a {{ color: var(--text); text-decoration: none; }}
td a:hover {{ color: var(--purple); }}
.rank {{ color: var(--amber); font-weight: 700; width: 3rem; }}
.num {{ text-align: right; color: var(--purple); font-weight: 600; }}

.badge {{
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 8px;
    font-size: 0.72rem;
    font-weight: 600;
}}
.badge.hot {{ background: linear-gradient(135deg, var(--red), var(--pink)); color: #fff; }}
.source-reddit {{ background: rgba(255,69,0,0.15); color: #ff6b35; }}
.source-twitter {{ background: rgba(29,155,240,0.15); color: #1d9bf0; }}
.source-bilibili {{ background: rgba(0,174,236,0.15); color: #00aeec; }}
.source-taptap {{ background: rgba(16,185,129,0.15); color: #10b981; }}
.source-nga {{ background: rgba(245,158,11,0.15); color: #f59e0b; }}
.source-youtube {{ background: rgba(255,0,0,0.15); color: #ff4444; }}
.source-discord {{ background: rgba(88,101,242,0.15); color: #5865f2; }}
.source-official {{ background: rgba(139,92,246,0.15); color: #8b5cf6; }}

.platform-card {{
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 0.75rem;
}}
.platform-name {{ display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }}
.platform-count {{ color: var(--text2); font-size: 0.8rem; }}
.platform-engagement {{ font-size: 0.85rem; color: var(--text2); }}
.platform-top {{ font-size: 0.85rem; color: var(--text2); margin-top: 0.3rem; }}

.topics-grid {{ display: flex; flex-wrap: wrap; gap: 0.75rem; }}
.topic-item {{
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.6rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}}
.topic-label {{ color: var(--text2); font-size: 0.85rem; }}
.topic-count {{ background: var(--purple); color: #fff; border-radius: 50%; width: 1.5rem; height: 1.5rem; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; }}

.footer {{
    text-align: center;
    padding: 2rem;
    color: var(--text2);
    font-size: 0.8rem;
    border-top: 1px solid var(--border);
    margin-top: 1rem;
}}

@media (max-width: 640px) {{
    .header h1 {{ font-size: 1.3rem; }}
    .container {{ padding: 1rem; }}
    .stats-grid {{ grid-template-columns: repeat(2, 1fr); }}
}}
</style>
</head>
<body>
<header class="header">
    <h1>忘却前夜 全球社区情报日报</h1>
    <div class="subtitle">Morimens Global Community Intelligence Report</div>
    <div class="report-meta">
        <span>Report ID: {report['report_id']}</span>
        <span>Period: {report['period']['hours']}h</span>
        <span>Generated: {datetime.fromisoformat(report['generated_at']).strftime('%Y-%m-%d %H:%M UTC')}</span>
    </div>
</header>

<div class="container">
    <div class="stats-grid">
        <div class="stat-card">
            <div class="value">{overview['total_items']}</div>
            <div class="label">Total Items</div>
        </div>
        <div class="stat-card">
            <div class="value">{_format_number(overview['total_engagement'])}</div>
            <div class="label">Total Engagement</div>
        </div>
        <div class="stat-card">
            <div class="value">{overview['active_sources']}</div>
            <div class="label">Active Sources</div>
        </div>
        <div class="stat-card">
            <div class="value">{overview['hot_items_count']}</div>
            <div class="label">Hot Items</div>
        </div>
    </div>

    <div class="section">
        <h2>📋 Daily Summary</h2>
        <div class="summary-text">{summary_escaped}</div>
    </div>
    {analyst_html}
    <div class="section">
        <h2>🔥 Top Items</h2>
        <table>
            <thead><tr><th>Rank</th><th>Title</th><th>Source</th><th style="text-align:right">Engagement</th></tr></thead>
            <tbody>{top_items_html}</tbody>
        </table>
    </div>

    <div class="section">
        <h2>📊 Platform Activity</h2>
        {platform_html}
    </div>

    <div class="section">
        <h2>🏷️ Topic Distribution</h2>
        <div class="topics-grid">{topic_html}</div>
    </div>
</div>

<footer class="footer">
    <p>忘却前夜 Morimens - Global Community Intelligence Report System</p>
    <p>Auto-generated · Data sources: Reddit · Twitter/X · Bilibili · TapTap · NGA · YouTube</p>
</footer>
</body>
</html>"""

    with open(REPORT_HTML_PATH, "w", encoding="utf-8") as f:
        f.write(html)


def _format_number(n):
    """格式化数字显示。"""
    if n >= 10000:
        return f"{n / 10000:.1f}w"
    if n >= 1000:
        return f"{n / 1000:.1f}k"
    return str(n)


# ─── RSS Feed ─────────────────────────────────────────────

def generate_rss_feed(report):
    """生成 RSS/Atom feed（纯 XML，无第三方依赖）。"""
    now = datetime.now(timezone.utc)
    entries_xml = ""

    for it in report["top_items"][:20]:
        title = _html.escape(it["title"])
        url = _html.escape(it.get("url", ""))
        desc = f"[{it['source']}] Engagement: {it['engagement']}"
        pub_date = it.get("time", now.isoformat())

        entries_xml += f"""  <entry>
    <title>{title}</title>
    <link href="{url}" rel="alternate"/>
    <id>{url or title}</id>
    <updated>{pub_date}</updated>
    <summary>{desc}</summary>
  </entry>
"""

    feed_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>忘却前夜 Morimens - 全球社区情报</title>
  <link href="https://github.com/lightproud/claude" rel="alternate"/>
  <id>https://github.com/lightproud/claude/report-system</id>
  <updated>{now.isoformat()}</updated>
  <subtitle>忘却前夜(Morimens)全球社区热点信息自动聚合</subtitle>
{entries_xml}</feed>
"""

    with open(FEED_PATH, "w", encoding="utf-8") as f:
        f.write(feed_xml)


# ─── 入口 ─────────────────────────────────────────────────

if __name__ == "__main__":
    generate_report()
