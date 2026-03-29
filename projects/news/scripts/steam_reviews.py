#!/usr/bin/env python3
"""
Steam Reviews 抓取脚本
- 全量模式：拉取所有历史评论，写入 steam-reviews-full.json
- 增量模式：只拉取比已有数据更新的评论，合并后写回，并生成 steam-reviews-daily.json

用法：
  python steam_reviews.py --mode full
  python steam_reviews.py --mode incremental
"""

import argparse
import json
import os
import time
from datetime import datetime, timezone

import requests

APP_ID = 3052450
BASE_URL = f"https://store.steampowered.com/appreviews/{APP_ID}"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output")
FULL_JSON = os.path.join(OUTPUT_DIR, "steam-reviews-full.json")
DAILY_JSON = os.path.join(OUTPUT_DIR, "steam-reviews-daily.json")
SUMMARY_JSON = os.path.join(OUTPUT_DIR, "steam-reviews-summary.json")

PARAMS_BASE = {
    "json": "1",
    "filter": "recent",
    "num_per_page": "100",
    "language": "all",
    "purchase_type": "all",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MorimenWiki/1.0; +https://github.com/lightproud/brain-in-a-vat)"
}


def fetch_page(cursor: str = "*") -> dict:
    params = {**PARAMS_BASE, "cursor": cursor}
    resp = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


def extract_review(raw: dict) -> dict:
    author = raw.get("author", {})
    return {
        "recommendationid": raw.get("recommendationid", ""),
        "language": raw.get("language", ""),
        "review": raw.get("review", ""),
        "voted_up": raw.get("voted_up", False),
        "timestamp_created": raw.get("timestamp_created", 0),
        "playtime_forever": raw.get("playtime_forever", 0),
        "author_steamid": author.get("steamid", ""),
        "author_personaname": raw.get("author_personaname", ""),
        "votes_up": raw.get("votes_up", 0),
        "votes_funny": raw.get("votes_funny", 0),
        "comment_count": raw.get("comment_count", 0),
        "steam_purchase": raw.get("steam_purchase", False),
        "received_for_free": raw.get("received_for_free", False),
        "written_during_early_access": raw.get("written_during_early_access", False),
        "primarily_steam_deck": raw.get("primarily_steam_deck", False),
    }


def fetch_all_reviews(stop_timestamp: int = 0) -> tuple[list[dict], dict]:
    """
    拉取所有评论（全量或增量）。

    stop_timestamp > 0 时，遇到 timestamp_created <= stop_timestamp 的评论就停止翻页。
    返回 (reviews_list, query_summary_dict)
    """
    reviews = []
    cursor = "*"
    query_summary = {}
    page = 0

    while True:
        page += 1
        data = fetch_page(cursor)

        if not query_summary and data.get("query_summary"):
            query_summary = data["query_summary"]

        batch = data.get("reviews", [])
        if not batch:
            print(f"  第 {page} 页：无评论，结束")
            break

        new_cursor = data.get("cursor", "")
        if not new_cursor or new_cursor == cursor:
            print(f"  第 {page} 页：cursor 无变化，结束")
            for r in batch:
                reviews.append(extract_review(r))
            break

        stopped = False
        for r in batch:
            ts = r.get("timestamp_created", 0)
            if stop_timestamp > 0 and ts <= stop_timestamp:
                stopped = True
                break
            reviews.append(extract_review(r))

        print(f"  第 {page} 页：+{len(batch)} 条，累计 {len(reviews)} 条")

        if stopped:
            print(f"  到达 timestamp {stop_timestamp}，停止翻页")
            break

        cursor = new_cursor
        time.sleep(0.5)

    return reviews, query_summary


def build_meta(query_summary: dict) -> dict:
    return {
        "app_id": APP_ID,
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_reviews": query_summary.get("total_reviews", 0),
        "total_positive": query_summary.get("total_positive", 0),
        "total_negative": query_summary.get("total_negative", 0),
        "review_score_desc": query_summary.get("review_score_desc", ""),
    }


def generate_summary(meta: dict, all_reviews: list[dict]) -> dict:
    now_ts = int(datetime.now(timezone.utc).timestamp())
    cutoff_24h = now_ts - 86400

    by_lang: dict[str, dict] = {}
    last_24h_total = 0
    last_24h_positive = 0

    for r in all_reviews:
        lang = r.get("language", "unknown")
        if lang not in by_lang:
            by_lang[lang] = {"total": 0, "positive": 0}
        by_lang[lang]["total"] += 1
        if r.get("voted_up"):
            by_lang[lang]["positive"] += 1

        if r.get("timestamp_created", 0) >= cutoff_24h:
            last_24h_total += 1
            if r.get("voted_up"):
                last_24h_positive += 1

    by_lang_out = {}
    for lang, counts in sorted(by_lang.items(), key=lambda x: -x[1]["total"]):
        total = counts["total"]
        positive = counts["positive"]
        rate = round(positive / total * 100, 1) if total > 0 else 0.0
        by_lang_out[lang] = {"total": total, "positive": positive, "rate": rate}

    total = meta.get("total_reviews", 0) or len(all_reviews)
    total_positive = meta.get("total_positive", 0)
    positive_rate = round(total_positive / total * 100, 1) if total > 0 else 0.0

    last_24h_rate = (
        round(last_24h_positive / last_24h_total * 100, 1)
        if last_24h_total > 0
        else 0.0
    )

    return {
        "updated_at": meta["fetched_at"],
        "total": total,
        "positive_rate": positive_rate,
        "by_language": by_lang_out,
        "last_24h": {
            "total": last_24h_total,
            "positive": last_24h_positive,
            "rate": last_24h_rate,
        },
    }


def save_json(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  已写入 {os.path.relpath(path)}")


def run_full() -> None:
    print("=== 全量模式 ===")
    print("开始拉取所有评论...")
    reviews, query_summary = fetch_all_reviews(stop_timestamp=0)

    seen = set()
    deduped = []
    for r in reviews:
        rid = r["recommendationid"]
        if rid not in seen:
            seen.add(rid)
            deduped.append(r)

    print(f"去重后：{len(deduped)} 条")

    meta = build_meta(query_summary)
    meta["total_reviews"] = len(deduped)

    full_data = {"meta": meta, "reviews": deduped}
    save_json(FULL_JSON, full_data)

    summary = generate_summary(meta, deduped)
    save_json(SUMMARY_JSON, summary)

    print(f"全量完成，共 {len(deduped)} 条评论")


def run_incremental() -> None:
    print("=== 增量模式 ===")
    now_ts = int(datetime.now(timezone.utc).timestamp())
    cutoff_24h = now_ts - 86400

    existing_reviews: list[dict] = []
    existing_meta: dict = {}
    latest_ts = 0

    if os.path.exists(FULL_JSON):
        with open(FULL_JSON, encoding="utf-8") as f:
            existing_data = json.load(f)
        existing_reviews = existing_data.get("reviews", [])
        existing_meta = existing_data.get("meta", {})
        if existing_reviews:
            latest_ts = max(r.get("timestamp_created", 0) for r in existing_reviews)
        print(f"已有 {len(existing_reviews)} 条评论，最新时间戳：{latest_ts}")
    else:
        print("未找到 steam-reviews-full.json，将执行全量拉取")

    print(f"拉取 timestamp > {latest_ts} 的新评论...")
    new_reviews, query_summary = fetch_all_reviews(stop_timestamp=latest_ts)

    existing_ids = {r["recommendationid"] for r in existing_reviews}
    added = [r for r in new_reviews if r["recommendationid"] not in existing_ids]
    print(f"新增 {len(added)} 条")

    all_reviews = added + existing_reviews
    all_reviews.sort(key=lambda r: r.get("timestamp_created", 0), reverse=True)

    meta = build_meta(query_summary)
    meta["total_reviews"] = len(all_reviews)

    full_data = {"meta": meta, "reviews": all_reviews}
    save_json(FULL_JSON, full_data)

    daily_reviews = [
        r for r in all_reviews if r.get("timestamp_created", 0) >= cutoff_24h
    ]
    daily_data = {
        "meta": {**meta, "filter": "last_24h", "count": len(daily_reviews)},
        "reviews": daily_reviews,
    }
    save_json(DAILY_JSON, daily_data)

    summary = generate_summary(meta, all_reviews)
    save_json(SUMMARY_JSON, summary)

    print(f"增量完成：总计 {len(all_reviews)} 条，过去 24h {len(daily_reviews)} 条")


def main() -> None:
    parser = argparse.ArgumentParser(description="Steam Reviews 抓取脚本")
    parser.add_argument(
        "--mode",
        choices=["full", "incremental"],
        required=True,
        help="full=全量首次拉取，incremental=日常增量更新",
    )
    args = parser.parse_args()

    if args.mode == "full":
        run_full()
    else:
        run_incremental()


if __name__ == "__main__":
    main()
