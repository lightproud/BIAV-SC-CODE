#!/usr/bin/env python3
"""
多平台按日归档脚本 — 将 *-latest.json 快照按日期存入 data/platforms/

存储结构:
  projects/news/data/platforms/
  ├── steam/
  │   └── YYYY-MM-DD.json
  ├── bilibili/
  │   └── YYYY-MM-DD.json
  ├── official/
  │   └── YYYY-MM-DD.json
  ├── reddit/
  │   └── YYYY-MM-DD.json
  ├── twitter/
  │   └── YYYY-MM-DD.json
  ├── youtube/
  │   └── YYYY-MM-DD.json
  ├── nga/
  │   └── YYYY-MM-DD.json
  └── taptap/
      └── YYYY-MM-DD.json

Discord 不在此处理（已有 discord_archiver.py 独立归档）。

每日文件格式:
  {
    "date": "YYYY-MM-DD",
    "archived_at": "ISO 8601",
    "source": "steam",
    "item_count": 5,
    "items": [ ... ]
  }

运行方式:
  python projects/news/scripts/archive_platforms.py              # 归档当天
  python projects/news/scripts/archive_platforms.py --date 2026-04-03  # 归档指定日期
  python projects/news/scripts/archive_platforms.py --stats      # 显示归档统计

去重: 同一天重复运行会合并条目（按 url 或 title+time 去重）。
"""

import argparse
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
OUTPUT_DIR = _REPO_ROOT / 'projects' / 'news' / 'output'
ARCHIVE_DIR = _REPO_ROOT / 'projects' / 'news' / 'data' / 'platforms'

# Discord has its own archiver — skip it here
PLATFORMS = [
    'steam', 'steam_discussion', 'bilibili', 'official', 'reddit', 'twitter', 'youtube', 'nga', 'taptap',
    # Phase 1 扩展
    'weibo', 'xiaohongshu', 'douyin', 'tieba', 'zhihu', 'bahamut',
    'naver_cafe', 'dcinside', 'arca_live', 'fivech',
    'appstore', 'google_play', 'tiktok',
    'pixiv', 'lofter', 'xianyu', 'taobao',
    'qq', 'facebook', 'telegram', 'twitch', 'instagram',
    'qooapp', 'epic',
    'gamerch', 'note_com', 'ruliweb',
    'vkplay', 'stopgame',
    'gacharevenue', 'miraheze_wiki',
    'gamekee', 'huiji_wiki', 'weixin',
]


def item_key(item: dict) -> str:
    """Generate a dedup key for an item."""
    url = item.get('url', '').strip()
    if url:
        return url
    return f"{item.get('title', '')}|{item.get('time', '')}|{item.get('author', '')}"


def load_latest(platform: str) -> dict:
    """Load the *-latest.json for a platform."""
    path = OUTPUT_DIR / f'{platform}-latest.json'
    if not path.exists():
        return {}
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def load_existing_archive(platform: str, date_str: str) -> dict:
    """Load existing archive file if it exists."""
    path = ARCHIVE_DIR / platform / f'{date_str}.json'
    if not path.exists():
        return {}
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def merge_items(existing_items: list[dict], new_items: list[dict]) -> list[dict]:
    """Merge new items into existing, deduplicating by key."""
    seen = set()
    merged = []

    for item in existing_items:
        key = item_key(item)
        if key not in seen:
            seen.add(key)
            merged.append(item)

    for item in new_items:
        key = item_key(item)
        if key not in seen:
            seen.add(key)
            merged.append(item)

    # Sort by engagement descending
    merged.sort(key=lambda x: x.get('engagement', 0), reverse=True)
    return merged


def archive_platform(platform: str, date_str: str) -> int:
    """Archive a single platform's data for a given date. Returns item count."""
    latest = load_latest(platform)
    items = latest.get('items', [])

    if not items:
        return 0

    # Filter items matching the target date (by their time field)
    date_items = []
    for item in items:
        t = item.get('time', '')
        if not t:
            continue
        try:
            dt = datetime.fromisoformat(t)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            item_date = (dt + timedelta(hours=8)).strftime('%Y-%m-%d')  # UTC+8
            if item_date == date_str:
                date_items.append(item)
        except (ValueError, TypeError):
            continue

    # If no date-specific items, archive all items under today
    # (some platforms like official don't have precise timestamps)
    if not date_items:
        date_items = items

    # Merge with existing archive
    existing = load_existing_archive(platform, date_str)
    existing_items = existing.get('items', [])
    merged = merge_items(existing_items, date_items)

    if not merged:
        return 0

    # Write archive file
    platform_dir = ARCHIVE_DIR / platform
    platform_dir.mkdir(parents=True, exist_ok=True)

    archive_data = {
        'date': date_str,
        'archived_at': datetime.now(timezone.utc).isoformat(),
        'source': platform,
        'item_count': len(merged),
        'items': merged,
    }

    path = platform_dir / f'{date_str}.json'
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(archive_data, f, ensure_ascii=False, indent=2)

    return len(merged)


def show_stats():
    """Display archive statistics for all platforms."""
    print('=== 平台归档统计 ===\n')
    total_files = 0
    total_items = 0

    for platform in PLATFORMS:
        platform_dir = ARCHIVE_DIR / platform
        if not platform_dir.exists():
            print(f'  {platform:12s}  (无归档)')
            continue

        files = sorted(platform_dir.glob('*.json'))
        if not files:
            print(f'  {platform:12s}  (无归档)')
            continue

        file_count = len(files)
        item_count = 0
        first_date = files[0].stem
        last_date = files[-1].stem

        for f in files:
            try:
                data = json.loads(f.read_text(encoding='utf-8'))
                item_count += data.get('item_count', 0)
            except Exception:
                pass

        print(f'  {platform:12s}  {file_count:3d} 天  {item_count:5d} 条  ({first_date} ~ {last_date})')
        total_files += file_count
        total_items += item_count

    # Discord stats (from its own archive)
    discord_daily = _REPO_ROOT / 'projects' / 'news' / 'data' / 'discord' / 'activity_daily'
    if discord_daily.exists():
        dc_files = sorted(discord_daily.glob('*.json'))
        if dc_files:
            print(f'  {"discord":12s}  {len(dc_files):3d} 天         ({dc_files[0].stem} ~ {dc_files[-1].stem})  [独立归档]')
            total_files += len(dc_files)

    print(f'\n  合计：{total_files} 天 / {total_items} 条目')


def main():
    parser = argparse.ArgumentParser(description='多平台按日归档')
    parser.add_argument('--date', type=str, default=None,
                        help='归档日期 YYYY-MM-DD（默认今天 UTC+8）')
    parser.add_argument('--stats', action='store_true',
                        help='显示归档统计')
    args = parser.parse_args()

    if args.stats:
        show_stats()
        return

    if args.date:
        date_str = args.date
    else:
        now_utc8 = datetime.now(timezone.utc) + timedelta(hours=8)
        date_str = now_utc8.strftime('%Y-%m-%d')

    print(f'归档日期：{date_str}')
    print(f'归档目录：{ARCHIVE_DIR}/\n')

    total = 0
    for platform in PLATFORMS:
        count = archive_platform(platform, date_str)
        if count > 0:
            print(f'  {platform:12s}  {count} 条')
            total += count
        else:
            print(f'  {platform:12s}  (无数据)')

    print(f'\n完成，共归档 {total} 条。')


if __name__ == '__main__':
    main()
