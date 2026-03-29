#!/usr/bin/env python3
"""
Discord 频道发现脚本
拉取忘却前夜全球服 (Guild ID: 1131791637933199470) 完整频道列表，
按 category 分组整理后写入 projects/news/output/discord-channels.json。

使用: python scripts/discord_discovery.py
需要: 环境变量 DISCORD_BOT_TOKEN（Bot 须有 VIEW_CHANNEL 权限）
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("discord_discovery")

GUILD_ID = "1131791637933199470"
GUILD_NAME = "忘却前夜 Morimens（全球频道）"

# 输出到 projects/news/output/
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "output" / "discord-channels.json"

# 频道类型参考
CHANNEL_TYPES = {
    0: "text",
    2: "voice",
    4: "category",
    5: "announcement",
    10: "announcement_thread",
    11: "public_thread",
    12: "private_thread",
    13: "stage",
    15: "forum",
}

STALE_DAYS = 7


def is_stale(path: Path) -> bool:
    """检查文件是否不存在或超过 STALE_DAYS 天未更新。"""
    if not path.exists():
        return True
    age_seconds = (datetime.now(timezone.utc).timestamp() - path.stat().st_mtime)
    return age_seconds > STALE_DAYS * 86400


def fetch_guild_channels(token: str) -> list[dict]:
    """调用 Discord API 获取 guild 所有频道。"""
    url = f"https://discord.com/api/v10/guilds/{GUILD_ID}/channels"
    headers = {
        "Authorization": f"Bot {token}",
        "User-Agent": "MorimensDiscoveryBot/1.0",
    }
    resp = requests.get(url, headers=headers, timeout=15)

    if resp.status_code == 403:
        logger.error(
            "API 返回 403 Forbidden：Bot 缺少 VIEW_CHANNEL 权限，"
            "请到 Discord Developer Portal 确认 Bot 已被授予该权限并重新邀请。"
        )
        sys.exit(2)

    resp.raise_for_status()
    return resp.json()


def build_structure(channels: list[dict]) -> dict:
    """将频道列表按 category 分组整理。"""
    # 分离分类和普通频道
    categories: dict[str, dict] = {}
    no_category_channels: list[dict] = []

    for ch in channels:
        if ch.get("type") == 4:  # category
            categories[ch["id"]] = {
                "id": ch["id"],
                "name": ch.get("name", ""),
                "position": ch.get("position", 0),
                "channels": [],
            }

    for ch in channels:
        if ch.get("type") == 4:
            continue
        entry = {
            "id": ch["id"],
            "name": ch.get("name", ""),
            "type": ch.get("type", 0),
            "position": ch.get("position", 0),
        }
        parent_id = ch.get("parent_id")
        if parent_id and parent_id in categories:
            categories[parent_id]["channels"].append(entry)
        else:
            no_category_channels.append(entry)

    # 按 position 排序分类及分类内频道
    sorted_categories = sorted(categories.values(), key=lambda c: c["position"])
    for cat in sorted_categories:
        cat["channels"].sort(key=lambda c: c["position"])

    # 没有分类的频道放到末尾的虚拟分类
    result_categories = sorted_categories
    if no_category_channels:
        no_category_channels.sort(key=lambda c: c["position"])
        result_categories.append({
            "id": None,
            "name": "(无分类)",
            "channels": no_category_channels,
        })

    return {
        "guild_id": GUILD_ID,
        "guild_name": GUILD_NAME,
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_channels": len(channels),
        "categories": result_categories,
    }


def discover(force: bool = False) -> dict | None:
    """
    主入口：若文件不存在或已过期则重新拉取。
    force=True 强制刷新。
    返回结构化数据，失败返回 None。
    """
    if not force and not is_stale(OUTPUT_PATH):
        logger.info(f"频道列表仍在有效期内，跳过拉取：{OUTPUT_PATH}")
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            return json.load(f)

    token = os.environ.get("DISCORD_BOT_TOKEN", "")
    if not token:
        logger.warning("DISCORD_BOT_TOKEN 未设置，跳过频道发现")
        return None

    logger.info(f"正在拉取 Discord Guild {GUILD_ID} 的频道列表…")
    try:
        raw_channels = fetch_guild_channels(token)
    except requests.HTTPError as e:
        logger.error(f"Discord API 请求失败: {e}")
        return None
    except Exception as e:
        logger.error(f"频道发现异常: {e}")
        return None

    data = build_structure(raw_channels)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    logger.info(
        f"频道列表已写入 {OUTPUT_PATH}，"
        f"共 {data['total_channels']} 个频道，{len(data['categories'])} 个分类"
    )

    # 打印摘要
    for cat in data["categories"]:
        logger.info(f"  [{cat['name']}] {len(cat['channels'])} 个频道")
        for ch in cat["channels"]:
            type_name = CHANNEL_TYPES.get(ch["type"], str(ch["type"]))
            logger.info(f"    #{ch['name']} (id={ch['id']}, type={type_name})")

    return data


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Discord 频道发现工具")
    parser.add_argument("--force", action="store_true", help="强制刷新，忽略缓存")
    args = parser.parse_args()

    result = discover(force=args.force)
    if result is None:
        sys.exit(1)
