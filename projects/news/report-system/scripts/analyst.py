#!/usr/bin/env python3
"""
忘却前夜 Morimens - 私人 Claude 分析师
带长期记忆的智能分析模块。每次运行时：
  1. 读取用户偏好
  2. 读取历史记忆
  3. 结合当日采集数据，生成深度分析
  4. 将新洞察写回记忆，供下次使用

这不是一个无状态的 API 调用，而是一个"越来越懂你"的私人分析师。
"""

import json
import os
import re
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

import yaml
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("analyst")

BASE_DIR = Path(__file__).resolve().parent.parent
MEMORY_PATH = BASE_DIR / "data" / "memory.json"
PREFS_PATH = BASE_DIR / "data" / "user_preferences.yaml"
ANALYSIS_PATH = BASE_DIR / "data" / "analysis.json"


# ─── 记忆系统 ─────────────────────────────────────────────

class Memory:
    """私人 Claude 的长期记忆。"""

    def __init__(self):
        self.data = self._load()

    def _load(self):
        if MEMORY_PATH.exists():
            try:
                with open(MEMORY_PATH, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Memory file corrupted, resetting: {e}")
                return self._default()
        return self._default()

    def _default(self):
        return {
            "version": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "total_reports": 0,
            "user_profile": {},
            "trend_history": [],
            "insight_archive": [],
            "anomalies": [],
            "topic_tracker": {},
            "sentiment_tracker": {},
        }

    def save(self):
        self.data["last_updated"] = datetime.now(timezone.utc).isoformat()
        MEMORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        # 写入临时文件后重命名，避免写入中断导致数据损坏
        tmp_path = MEMORY_PATH.with_suffix(".tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)
        tmp_path.replace(MEMORY_PATH)
        logger.info(f"Memory saved → {MEMORY_PATH}")

    def get_recent_trends(self, days=7):
        """获取最近 N 天的趋势记录。"""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        return [t for t in self.data.get("trend_history", []) if t.get("date", "") >= cutoff]

    def get_recent_insights(self, count=10):
        """获取最近的洞察。"""
        return self.data.get("insight_archive", [])[-count:]

    def get_topic_history(self):
        """获取话题追踪数据。"""
        return self.data.get("topic_tracker", {})

    def record_trend(self, trend_entry):
        """记录今日趋势。"""
        self.data.setdefault("trend_history", []).append(trend_entry)
        # 保留最近 90 天
        cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        self.data["trend_history"] = [
            t for t in self.data["trend_history"] if t.get("date", "") >= cutoff
        ]

    def record_insights(self, insights):
        """记录分析洞察。"""
        self.data.setdefault("insight_archive", []).extend(insights)
        # 保留最近 200 条
        self.data["insight_archive"] = self.data["insight_archive"][-200:]

    def record_anomaly(self, anomaly):
        """记录异常事件。"""
        self.data.setdefault("anomalies", []).append(anomaly)
        self.data["anomalies"] = self.data["anomalies"][-50:]

    def update_topic_tracker(self, topics_today):
        """更新话题连续出现天数，并清理超过30天未出现的话题。"""
        tracker = self.data.setdefault("topic_tracker", {})
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        for topic in topics_today:
            if topic in tracker:
                t = tracker[topic]
                last = t.get("last_seen", "")
                yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
                if last == yesterday or last == today:
                    t["consecutive_days"] = t.get("consecutive_days", 1) + (0 if last == today else 1)
                else:
                    t["consecutive_days"] = 1
                t["last_seen"] = today
                t["total_appearances"] = t.get("total_appearances", 0) + 1
            else:
                tracker[topic] = {
                    "first_seen": today,
                    "last_seen": today,
                    "consecutive_days": 1,
                    "total_appearances": 1,
                }

        # 清理超过30天未出现的话题，防止无限增长
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        stale = [t for t, info in tracker.items() if info.get("last_seen", "") < cutoff]
        for t in stale:
            del tracker[t]

    def increment_report_count(self):
        self.data["total_reports"] = self.data.get("total_reports", 0) + 1


# ─── 用户偏好 ─────────────────────────────────────────────

def load_preferences():
    """加载用户偏好配置。"""
    if not PREFS_PATH.exists():
        logger.warning(f"Preferences not found: {PREFS_PATH}")
        return {}
    with open(PREFS_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


# ─── 本地预分析 (不依赖 API) ──────────────────────────────

def pre_analyze(items, memory):
    """在调用 API 前做本地预处理分析，提取结构化信号。"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    topic_tracker = memory.get_topic_history()

    # 提取今日关键词
    all_text = " ".join(it["title"] + " " + it.get("summary", "") for it in items).lower()

    # 检测持续热议话题
    continuing_topics = []
    for topic, info in topic_tracker.items():
        if info.get("consecutive_days", 0) >= 3:
            continuing_topics.append({
                "topic": topic,
                "days": info["consecutive_days"],
            })

    # 互动量异常检测 (与最近趋势对比)
    recent_trends = memory.get_recent_trends(days=7)
    avg_engagement = 0
    if recent_trends:
        avg_engagement = sum(t.get("total_engagement", 0) for t in recent_trends) / len(recent_trends)

    today_engagement = sum(it.get("engagement", 0) for it in items)
    engagement_anomaly = None
    if avg_engagement > 0:
        ratio = today_engagement / avg_engagement
        if ratio > 1.5:
            engagement_anomaly = {"type": "spike", "ratio": round(ratio, 2), "today": today_engagement, "avg": round(avg_engagement)}
        elif ratio < 0.5:
            engagement_anomaly = {"type": "drop", "ratio": round(ratio, 2), "today": today_engagement, "avg": round(avg_engagement)}

    # 平台分布
    platform_counts = {}
    for it in items:
        s = it["source"]
        platform_counts[s] = platform_counts.get(s, 0) + 1

    # 语言分布
    lang_counts = {}
    for it in items:
        l = it.get("lang", "unknown")
        lang_counts[l] = lang_counts.get(l, 0) + 1

    return {
        "date": today,
        "total_items": len(items),
        "total_engagement": today_engagement,
        "platforms": platform_counts,
        "languages": lang_counts,
        "continuing_topics": continuing_topics,
        "engagement_anomaly": engagement_anomaly,
        "avg_engagement_7d": round(avg_engagement),
    }


# ─── Claude API 深度分析 ──────────────────────────────────

def call_claude(items, pre_analysis, memory, prefs):
    """调用 Claude API，带完整上下文的深度分析。"""
    api_key = os.environ.get("LLM_API_KEY")
    api_url = os.environ.get("LLM_API_URL", "https://api.anthropic.com/v1/messages")

    if not api_key:
        logger.info("LLM_API_KEY not set, using local analysis only")
        return _local_analysis(items, pre_analysis, memory, prefs)

    # 构建上下文
    system_prompt = _build_system_prompt(prefs, memory)
    user_prompt = _build_user_prompt(items, pre_analysis, memory)

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
                "max_tokens": 2000,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            },
            timeout=60,
        )
        resp.raise_for_status()
        raw_text = resp.json()["content"][0]["text"]

        logger.info("Claude API analysis completed")
        return _parse_claude_response(raw_text, pre_analysis)

    except Exception as e:
        logger.warning(f"Claude API failed: {e}, falling back to local analysis")
        return _local_analysis(items, pre_analysis, memory, prefs)


def _build_system_prompt(prefs, memory):
    """构建 system prompt — 这就是私人 Claude 的'人格'。"""
    report_count = memory.data.get("total_reports", 0)

    identity = prefs.get("identity", "一名忘却前夜玩家")
    style = prefs.get("report_style", "简洁专业")
    focus = prefs.get("focus_topics", [])
    ignore = prefs.get("ignore_keywords", [])
    custom = prefs.get("custom_instructions", "")

    return f"""你是一位忘却前夜(Morimens)的私人情报分析师。你为用户提供专属的每日社区情报分析。

## 关于你的用户
{identity}

## 用户关注重点 (按优先级)
{chr(10).join(f'{i+1}. {t}' for i, t in enumerate(focus)) if focus else '未指定，请全面分析。'}

## 报告风格要求
{style}

## 忽略的内容
{', '.join(ignore) if ignore else '无'}

## 你的工作记录
这是你生成的第 {report_count + 1} 份报告。你已经为这位用户服务了 {report_count} 次。
随着时间推移，你应该越来越了解社区的节奏和用户的关注点。

## 额外指令
{custom}

## 输出格式
请严格按以下 JSON 格式输出，不要输出其他内容：
{{
  "briefing": "一段简洁的晨间简报文字 (200-400字)",
  "key_events": ["事件1", "事件2", "事件3"],
  "risk_alerts": ["异常/风险提醒 (如有)"],
  "trend_notes": ["趋势观察 (与历史对比)"],
  "insights": ["深度洞察/判断"],
  "sentiment": "positive/neutral/negative/mixed",
  "focus_rating": 8,
  "tomorrow_watch": ["明天值得关注的事"]
}}

focus_rating: 1-10 分，表示今天的信息对用户关注点的相关程度。"""


def _build_user_prompt(items, pre_analysis, memory):
    """构建 user prompt — 包含当日数据和历史上下文。"""
    # 当日数据
    items_text = "\n".join(
        f"- [{it['source']}][{it.get('lang', '?')}] {it['title']} "
        f"(engagement: {it.get('engagement', 0)}, hot: {it.get('is_hot', False)})"
        for it in items[:30]
    )

    # 历史上下文
    recent_insights = memory.get_recent_insights(5)
    insights_text = ""
    if recent_insights:
        insights_text = "\n## 你之前的分析洞察 (最近5条)\n" + "\n".join(
            f"- [{ins.get('date', '?')}] {ins.get('text', '')}" for ins in recent_insights
        )

    recent_trends = memory.get_recent_trends(7)
    trend_text = ""
    if recent_trends:
        trend_text = "\n## 最近7天数据趋势\n" + "\n".join(
            f"- {t.get('date', '?')}: {t.get('total_items', 0)} items, "
            f"engagement: {t.get('total_engagement', 0)}, "
            f"platforms: {t.get('platforms', {})}"
            for t in recent_trends[-7:]
        )

    # 持续热议
    continuing = pre_analysis.get("continuing_topics", [])
    continuing_text = ""
    if continuing:
        continuing_text = "\n## 持续热议话题\n" + "\n".join(
            f"- 「{c['topic']}」已连续 {c['days']} 天出现" for c in continuing
        )

    # 异常
    anomaly_text = ""
    anomaly = pre_analysis.get("engagement_anomaly")
    if anomaly:
        if anomaly["type"] == "spike":
            anomaly_text = f"\n## ⚠ 互动量异常\n今日互动量 {anomaly['today']} 是近7天均值 {anomaly['avg']} 的 {anomaly['ratio']}x，出现明显飙升。"
        else:
            anomaly_text = f"\n## ⚠ 互动量异常\n今日互动量 {anomaly['today']} 仅为近7天均值 {anomaly['avg']} 的 {anomaly['ratio']}x，出现明显下降。"

    _utc8 = timezone(timedelta(hours=8))
    today = datetime.now(_utc8).strftime("%Y-%m-%d")
    weekday = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][datetime.now(_utc8).weekday()]

    return f"""# 今日社区情报 ({today} {weekday})

## 今日采集数据 ({pre_analysis['total_items']} items)
{items_text}

## 今日统计
- 总互动量: {pre_analysis['total_engagement']}
- 平台分布: {pre_analysis['platforms']}
- 语言分布: {pre_analysis['languages']}
{trend_text}
{insights_text}
{continuing_text}
{anomaly_text}

请根据以上信息，生成今日的专属情报分析报告。"""


def _parse_claude_response(raw_text, pre_analysis):
    """解析 Claude 返回的 JSON。"""

    # 尝试提取 JSON
    json_match = re.search(r'\{[\s\S]*\}', raw_text)
    if json_match:
        try:
            result = json.loads(json_match.group())
            result["source"] = "claude_api"
            result["pre_analysis"] = pre_analysis
            return result
        except json.JSONDecodeError:
            pass

    # 解析失败，把原文当 briefing
    return {
        "briefing": raw_text,
        "key_events": [],
        "risk_alerts": [],
        "trend_notes": [],
        "insights": [],
        "sentiment": "unknown",
        "focus_rating": 5,
        "tomorrow_watch": [],
        "source": "claude_api_raw",
        "pre_analysis": pre_analysis,
    }


# ─── 本地分析 (无 API 降级方案) ──────────────────────────

def _local_analysis(items, pre_analysis, memory, prefs):
    """无 API 时的纯本地分析。"""
    priority_kw = [kw.lower() for kw in prefs.get("priority_keywords", [])]
    focus_topics = prefs.get("focus_topics", [])

    # 按优先关键词标记
    priority_items = []
    for it in items:
        text = (it["title"] + " " + it.get("summary", "")).lower()
        for kw in priority_kw:
            if kw in text:
                priority_items.append(it["title"])
                break

    # 构建简报
    hot = [it for it in items if it.get("is_hot")][:5] or items[:5]
    lines = []
    lines.append(f"今日共收集 {len(items)} 条信息，总互动量 {pre_analysis['total_engagement']}。")
    lines.append("")

    if priority_items:
        lines.append(f"命中优先关键词的内容 ({len(priority_items)} 条):")
        for t in priority_items[:5]:
            lines.append(f"  - {t}")
        lines.append("")

    lines.append("热门内容:")
    for it in hot:
        lines.append(f"  - [{it['source']}] {it['title']}")

    # 持续热议
    continuing = pre_analysis.get("continuing_topics", [])
    if continuing:
        lines.append("")
        lines.append("持续热议:")
        for c in continuing:
            lines.append(f"  - 「{c['topic']}」连续 {c['days']} 天")

    # 异常
    anomaly = pre_analysis.get("engagement_anomaly")
    if anomaly:
        lines.append("")
        if anomaly["type"] == "spike":
            lines.append(f"⚠ 互动量飙升: 今日 {anomaly['today']} 是近7天均值 {anomaly['avg']} 的 {anomaly['ratio']}x")
        else:
            lines.append(f"⚠ 互动量下降: 今日 {anomaly['today']} 仅为近7天均值 {anomaly['avg']} 的 {anomaly['ratio']}x")

    return {
        "briefing": "\n".join(lines),
        "key_events": [it["title"] for it in hot[:3]],
        "risk_alerts": [f"互动量异常: {anomaly['type']}" for anomaly in [pre_analysis.get("engagement_anomaly")] if anomaly],
        "trend_notes": [f"持续热议: {c['topic']} ({c['days']}天)" for c in continuing],
        "insights": priority_items[:3],
        "sentiment": "neutral",
        "focus_rating": 5,
        "tomorrow_watch": [],
        "source": "local",
        "pre_analysis": pre_analysis,
    }


# ─── 主流程 ──────────────────────────────────────────────

def analyze(items):
    """
    主分析入口。
    输入: 采集到的 items 列表
    输出: 分析结果 dict，同时更新记忆
    """
    logger.info("=== 私人 Claude 分析师启动 ===")

    memory = Memory()
    prefs = load_preferences()

    # 预分析
    pre = pre_analyze(items, memory)
    logger.info(f"Pre-analysis: {pre['total_items']} items, engagement={pre['total_engagement']}")

    # 调用 Claude (或本地降级)
    result = call_claude(items, pre, memory, prefs)

    # ─── 写回记忆 ───
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # 1. 记录趋势
    memory.record_trend({
        "date": today,
        "total_items": pre["total_items"],
        "total_engagement": pre["total_engagement"],
        "platforms": pre["platforms"],
        "languages": pre["languages"],
        "sentiment": result.get("sentiment", "unknown"),
        "focus_rating": result.get("focus_rating", 5),
    })

    # 2. 记录洞察
    for insight in result.get("insights", []):
        memory.record_insights([{"date": today, "text": insight}])

    # 3. 记录异常
    if pre.get("engagement_anomaly"):
        memory.record_anomaly({
            "date": today,
            "type": pre["engagement_anomaly"]["type"],
            "detail": pre["engagement_anomaly"],
        })

    # 4. 更新话题追踪
    today_topics = []
    for it in items:
        if it.get("is_hot"):
            # 提取标题前几个字作为话题标识
            title = it["title"].strip()
            for kw in prefs.get("priority_keywords", []):
                if kw.lower() in title.lower():
                    today_topics.append(kw)
            # 也追踪 tag
            today_topics.extend(it.get("tags", []))
    memory.update_topic_tracker(list(set(today_topics)))

    # 5. 递增报告计数
    memory.increment_report_count()

    # 保存记忆
    memory.save()

    # 输出分析结果
    result["report_number"] = memory.data["total_reports"]
    result["date"] = today

    with open(ANALYSIS_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    logger.info(f"Analysis output → {ANALYSIS_PATH}")

    logger.info(f"=== 分析完成 (第 {result['report_number']} 份报告) ===")
    return result


if __name__ == "__main__":
    # 独立运行: 读取已有的 collected_raw.json
    raw_path = BASE_DIR / "data" / "collected_raw.json"
    if raw_path.exists():
        with open(raw_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        analyze(data.get("items", []))
    else:
        logger.error("No collected data found. Run collector.py first.")
