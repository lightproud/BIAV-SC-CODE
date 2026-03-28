#!/usr/bin/env python3
"""
忘却前夜 Morimens - 通知推送模块
报告生成后，将摘要通过多种渠道推送给用户。

支持渠道:
  - Email (SMTP)
  - Discord Webhook
  - Telegram Bot
  - Bark (iOS 推送)
  - 自定义 Webhook (任意 URL)

设计原则: 无配置的渠道自动跳过，不报错。

使用: python scripts/notifier.py
输入: data/report.json
"""

import json
import os
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone
from pathlib import Path

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("notifier")

BASE_DIR = Path(__file__).resolve().parent.parent
REPORT_JSON_PATH = BASE_DIR / "data" / "report.json"


# ─── 报告摘要提取 ─────────────────────────────────────────

def load_report():
    """加载最新报告。"""
    if not REPORT_JSON_PATH.exists():
        logger.warning("report.json not found, nothing to notify")
        return None
    with open(REPORT_JSON_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def build_summary(report):
    """从 report.json 构建推送用的简短摘要。"""
    overview = report.get("overview", {})
    analyst = report.get("analyst", {})
    summary_text = report.get("summary", "")
    report_id = report.get("report_id", "unknown")
    report_num = analyst.get("report_number", "?")
    sentiment = analyst.get("sentiment", "unknown")

    top_items = report.get("top_items", [])[:5]
    top_list = "\n".join(
        f"  {i+1}. [{it['source']}] {it['title']} ({it['engagement']})"
        for i, it in enumerate(top_items)
    )

    risk_alerts = analyst.get("risk_alerts", [])
    risk_section = ""
    if risk_alerts:
        risk_section = "\n⚠️ 风险提醒:\n" + "\n".join(f"  - {a}" for a in risk_alerts)

    tomorrow = analyst.get("tomorrow_watch", [])
    watch_section = ""
    if tomorrow:
        watch_section = "\n👀 明日关注:\n" + "\n".join(f"  - {t}" for t in tomorrow)

    text = f"""📋 忘却前夜情报 #{report_num} ({report_id})
总量: {overview.get('total_items', 0)} 条 | 互动: {overview.get('total_engagement', 0)} | 情绪: {sentiment}

🔥 热门 Top 5:
{top_list}
{risk_section}
{watch_section}

{summary_text}"""

    return text.strip()


def build_html_summary(report):
    """构建 HTML 格式的推送内容 (用于 Email)。"""
    overview = report.get("overview", {})
    analyst = report.get("analyst", {})
    report_id = report.get("report_id", "unknown")
    report_num = analyst.get("report_number", "?")

    top_items = report.get("top_items", [])[:5]
    top_html = "".join(
        f'<li><strong>[{it["source"]}]</strong> '
        f'<a href="{it.get("url", "#")}">{it["title"]}</a> '
        f'<span style="color:#888">({it["engagement"]})</span></li>'
        for it in top_items
    )

    risk_alerts = analyst.get("risk_alerts", [])
    risk_html = ""
    if risk_alerts:
        risk_items = "".join(f"<li>{a}</li>" for a in risk_alerts)
        risk_html = f'<h3 style="color:#e74c3c">⚠️ 风险提醒</h3><ul>{risk_items}</ul>'

    return f"""<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <h2>📋 忘却前夜情报 #{report_num}</h2>
  <p style="color:#666">{report_id} | {overview.get('total_items',0)} 条 | 互动 {overview.get('total_engagement',0)}</p>
  <h3>🔥 热门 Top 5</h3>
  <ol>{top_html}</ol>
  {risk_html}
  <p style="font-size:12px;color:#aaa">由 Morimens 情报系统自动生成</p>
</div>"""


# ─── 推送渠道 ─────────────────────────────────────────────

def send_email(subject, text_body, html_body):
    """通过 SMTP 发送邮件通知。"""
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    mail_to = os.environ.get("NOTIFY_EMAIL")

    if not all([smtp_host, smtp_user, smtp_pass, mail_to]):
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = mail_to

    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        logger.info("✓ Email sent to %s", mail_to)
        return True
    except Exception as e:
        logger.warning("✗ Email failed: %s", e)
        return False


def send_discord_webhook(text):
    """通过 Discord Webhook 推送。"""
    webhook_url = os.environ.get("NOTIFY_DISCORD_WEBHOOK")
    if not webhook_url:
        return False

    # Discord 限制 2000 字符
    content = text[:1990] if len(text) > 1990 else text

    try:
        resp = requests.post(
            webhook_url,
            json={"content": content},
            timeout=15,
        )
        if resp.status_code in (200, 204):
            logger.info("✓ Discord webhook sent")
            return True
        logger.warning("✗ Discord webhook %d: %s", resp.status_code, resp.text[:200])
        return False
    except Exception as e:
        logger.warning("✗ Discord webhook failed: %s", e)
        return False


def send_telegram(text):
    """通过 Telegram Bot 推送。"""
    bot_token = os.environ.get("NOTIFY_TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("NOTIFY_TELEGRAM_CHAT_ID")
    if not bot_token or not chat_id:
        return False

    # Telegram 限制 4096 字符
    content = text[:4090] if len(text) > 4090 else text

    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": content, "parse_mode": "HTML"},
            timeout=15,
        )
        if resp.ok:
            logger.info("✓ Telegram message sent")
            return True
        logger.warning("✗ Telegram %d: %s", resp.status_code, resp.text[:200])
        return False
    except Exception as e:
        logger.warning("✗ Telegram failed: %s", e)
        return False


def send_bark(text):
    """通过 Bark 推送 (iOS)。"""
    bark_url = os.environ.get("NOTIFY_BARK_URL")
    if not bark_url:
        return False

    # 取第一行作标题，其余作内容
    lines = text.split("\n", 1)
    title = lines[0].strip()
    body = lines[1].strip() if len(lines) > 1 else ""

    try:
        resp = requests.post(
            bark_url,
            json={"title": title, "body": body[:500], "group": "morimens"},
            timeout=15,
        )
        if resp.ok:
            logger.info("✓ Bark push sent")
            return True
        logger.warning("✗ Bark %d: %s", resp.status_code, resp.text[:200])
        return False
    except Exception as e:
        logger.warning("✗ Bark failed: %s", e)
        return False


def send_custom_webhook(text, report):
    """通过自定义 Webhook 推送 JSON 数据。"""
    webhook_url = os.environ.get("NOTIFY_WEBHOOK_URL")
    if not webhook_url:
        return False

    payload = {
        "event": "morimens_report",
        "report_id": report.get("report_id", ""),
        "generated_at": report.get("generated_at", ""),
        "summary": text,
        "overview": report.get("overview", {}),
        "top_items": report.get("top_items", [])[:10],
        "analyst": report.get("analyst", {}),
    }

    try:
        resp = requests.post(
            webhook_url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        if resp.ok:
            logger.info("✓ Custom webhook sent to %s", webhook_url)
            return True
        logger.warning("✗ Custom webhook %d: %s", resp.status_code, resp.text[:200])
        return False
    except Exception as e:
        logger.warning("✗ Custom webhook failed: %s", e)
        return False


# ─── 主入口 ───────────────────────────────────────────────

def notify(report=None):
    """推送报告通知。无配置的渠道自动跳过。"""
    if report is None:
        report = load_report()
    if not report:
        logger.info("No report to notify")
        return {"sent": [], "skipped": [], "failed": []}

    text = build_summary(report)
    html = build_html_summary(report)
    report_num = report.get("analyst", {}).get("report_number", "?")
    subject = f"忘却前夜情报 #{report_num}"

    results = {"sent": [], "skipped": [], "failed": []}

    channels = [
        ("email", lambda: send_email(subject, text, html)),
        ("discord", lambda: send_discord_webhook(text)),
        ("telegram", lambda: send_telegram(text)),
        ("bark", lambda: send_bark(text)),
        ("webhook", lambda: send_custom_webhook(text, report)),
    ]

    for name, sender in channels:
        try:
            result = sender()
            if result is True:
                results["sent"].append(name)
            elif result is False:
                results["skipped"].append(name)
        except Exception as e:
            logger.error("Channel %s error: %s", name, e)
            results["failed"].append(name)

    logger.info(
        "Notify done: sent=%s, skipped=%s, failed=%s",
        results["sent"] or "none",
        results["skipped"] or "none",
        results["failed"] or "none",
    )
    return results


if __name__ == "__main__":
    notify()
