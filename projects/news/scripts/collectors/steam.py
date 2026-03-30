#!/usr/bin/env python3
"""
Steam 评论采集器 — 输出统一 platform-data schema 格式

用法：
  python steam.py                  # 采集最近 24 小时（默认）
  python steam.py --hours 48       # 采集最近 48 小时
  python steam.py --all            # 采集全量评论（首次初始化）

输出：
  assets/data/platforms/steam.json
"""

import argparse
import json
import os
import time
from datetime import datetime, timezone

import requests

# App IDs
APP_ID_GLOBAL = 3052450   # 全球版
APP_ID_JP = 4226130       # 日服

BASE_URL = "https://store.steampowered.com/appreviews/{app_id}"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; MorimenWiki/1.0; "
        "+https://github.com/lightproud/brain-in-a-vat)"
    )
}

PARAMS_BASE = {
    "json": "1",
    "filter": "recent",
    "num_per_page": "100",
    "language": "all",
    "purchase_type": "all",
}

# 仓库根目录（此脚本位于 projects/news/scripts/collectors/）
REPO_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")
)
OUTPUT_PATH = os.path.join(REPO_ROOT, "assets", "data", "platforms", "steam.json")


def fetch_page(app_id: int, cursor: str = "*") -> dict:
    url = BASE_URL.format(app_id=app_id)
    params = {**PARAMS_BASE, "cursor": cursor}
    resp = requests.get(url, params=params, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


def voted_up_to_sentiment(voted_up: bool) -> str:
    return "positive" if voted_up else "negative"


def raw_to_item(raw: dict, app_id: int) -> dict:
    ts_unix = raw.get("timestamp_created", 0)
    ts_iso = datetime.fromtimestamp(ts_unix, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    voted_up = raw.get("voted_up", False)
    rec_id = raw.get("recommendationid", "")
    return {
        "platform": "steam",
        "language": raw.get("language") or None,
        "timestamp": ts_iso,
        "content": raw.get("review", ""),
        "sentiment": voted_up_to_sentiment(voted_up),
        "source_url": (
            f"https://store.steampowered.com/app/{app_id}/#app_reviews_hash"
        ),
        "title": None,
        "author": raw.get("author", {}).get("steamid") or None,
        "engagement": raw.get("votes_up", 0),
        "tags": [],
        "content_type": "review",
        "metadata": {
            "recommendationid": rec_id,
            "voted_up": voted_up,
            "playtime_forever": raw.get("playtime_forever", 0),
            "votes_funny": raw.get("votes_funny", 0),
            "comment_count": raw.get("comment_count", 0),
            "steam_purchase": raw.get("steam_purchase", False),
            "written_during_early_access": raw.get(
                "written_during_early_access", False
            ),
            "app_id": app_id,
        },
    }


def fetch_reviews(app_id: int, cutoff_ts: int) -> tuple[list[dict], dict]:
    """
    拉取 timestamp_created > cutoff_ts 的评论。
    cutoff_ts=0 表示全量拉取。
    返回 (items, query_summary)
    """
    items = []
    cursor = "*"
    query_summary = {}
    page = 0

    while True:
        page += 1
        data = fetch_page(app_id, cursor)

        if not query_summary and data.get("query_summary"):
            query_summary = data["query_summary"]

        batch = data.get("reviews", [])
        if not batch:
            break

        new_cursor = data.get("cursor", "")
        if not new_cursor or new_cursor == cursor:
            for r in batch:
                if r.get("timestamp_created", 0) > cutoff_ts:
                    items.append(raw_to_item(r, app_id))
            break

        stopped = False
        for r in batch:
            ts = r.get("timestamp_created", 0)
            if cutoff_ts > 0 and ts <= cutoff_ts:
                stopped = True
                break
            items.append(raw_to_item(r, app_id))

        print(f"  [app={app_id}] 第 {page} 页：+{len(batch)} 条，累计 {len(items)} 条")

        if stopped:
            break

        cursor = new_cursor
        time.sleep(0.5)

    return items, query_summary


def collect(hours: int = 24, all_reviews: bool = False) -> None:
    now = datetime.now(timezone.utc)
    now_ts = int(now.timestamp())
    cutoff_ts = 0 if all_reviews else now_ts - hours * 3600

    print(
        f"Steam 采集开始 | 模式={'全量' if all_reviews else f'最近 {hours}h'} | "
        f"cutoff={cutoff_ts}"
    )

    all_items: list[dict] = []
    combined_summary: dict = {}

    for app_id in [APP_ID_GLOBAL, APP_ID_JP]:
        print(f"\n--- App {app_id} ---")
        items, summary = fetch_reviews(app_id, cutoff_ts)
        all_items.extend(items)
        if not combined_summary and summary:
            combined_summary = summary
        print(f"  → 本次采集 {len(items)} 条")

    # 按时间降序排列
    all_items.sort(key=lambda x: x["timestamp"], reverse=True)

    # 去重（按 recommendationid）
    seen_ids: set[str] = set()
    deduped: list[dict] = []
    for item in all_items:
        rid = item["metadata"].get("recommendationid", "")
        if rid and rid in seen_ids:
            continue
        if rid:
            seen_ids.add(rid)
        deduped.append(item)

    output = {
        "platform": "steam",
        "updated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "auto",
        "meta": {
            "app_ids": [APP_ID_GLOBAL, APP_ID_JP],
            "collection_mode": "all" if all_reviews else f"last_{hours}h",
            "total_reviews_global": combined_summary.get("total_reviews", 0),
            "total_positive_global": combined_summary.get("total_positive", 0),
            "review_score_desc": combined_summary.get("review_score_desc", ""),
            "item_count": len(deduped),
        },
        "items": deduped,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n完成：共 {len(deduped)} 条，已写入 {OUTPUT_PATH}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Steam 评论采集器（统一 schema 输出）")
    parser.add_argument(
        "--hours",
        type=int,
        default=24,
        help="采集最近 N 小时的评论（默认 24）",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="全量采集所有评论（初始化用）",
    )
    args = parser.parse_args()
    collect(hours=args.hours, all_reviews=args.all)


if __name__ == "__main__":
    main()
