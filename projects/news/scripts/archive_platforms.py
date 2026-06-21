#!/usr/bin/env python3
"""
多平台按日归档脚本 — 将 news.json（merged 全量层）按每条目真实日期存入 data/platforms/

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
  ├── youtube/
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
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import ARCHIVE_PLATFORMS, normalize_source

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
OUTPUT_DIR = _REPO_ROOT / 'projects' / 'news' / 'output'
# 平台摊平到 BPT 4R Record/Community 下，与 discord 同级（2026-06-21 迁移）
ARCHIVE_DIR = _REPO_ROOT / 'Public-Info-Pool' / 'Record' / 'Community'

# 全量层数据源：优先读 news-raw.json（collect_global 写的未过滤合并集），
# 回退 news.json。两者都绕开 split 的展示层时窗过滤；raw 进一步绕开 collect_global
# 的滚动窗口过滤，让被时窗砍掉的新鲜条目也能落档（真·全量层）。
RAW_NEWS = OUTPUT_DIR / 'news-raw.json'
INPUT_NEWS = OUTPUT_DIR / 'news.json'

# Discord 有独立归档器（discord_archiver.py），此处跳过
PLATFORMS = ARCHIVE_PLATFORMS


def item_key(item: dict) -> str:
    """Generate a dedup key for an item."""
    url = item.get('url', '').strip()
    if url:
        return url
    return f"{item.get('title', '')}|{item.get('time', '')}|{item.get('author', '')}"


def load_news() -> list[dict]:
    """Load the full-layer archive source: news-raw.json if present, else news.json."""
    path = RAW_NEWS if RAW_NEWS.exists() else INPUT_NEWS
    if not path.exists():
        return []
    with open(path, encoding='utf-8') as f:
        return json.load(f).get('news', [])


def item_date_utc8(item: dict, fallback: str) -> str:
    """Return the item's own date (UTC+8). Falls back when timestamp absent."""
    t = item.get('time', '')
    if not t:
        return fallback
    try:
        dt = datetime.fromisoformat(t)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (dt + timedelta(hours=8)).strftime('%Y-%m-%d')
    except (ValueError, TypeError):
        return fallback


def archive_path(platform: str, region: str | None, subtype: str | None, date_str: str) -> Path:
    """归档落点：``<平台>[/<区服>][/<类型>]/YYYY-MM-DD.json``。

    甲方案（2026-06-21 命名规范）：item 带 ``region`` / ``archive_subtype`` 字段才分层，
    缺省则省略该层、回落旧扁平 ``<平台>/YYYY-MM-DD.json``——现有不带字段的源零破坏。
    """
    parts = [platform]
    if region:
        parts.append(region)
    if subtype:
        parts.append(subtype)
    return ARCHIVE_DIR.joinpath(*parts) / f'{date_str}.json'


def load_existing_archive(platform: str, region: str | None, subtype: str | None, date_str: str) -> dict:
    """Load existing archive file if it exists."""
    path = archive_path(platform, region, subtype, date_str)
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


def write_archive(platform: str, region: str | None, subtype: str | None,
                  date_str: str, new_items: list[dict]) -> int:
    """Merge new_items into the (platform, region, subtype, date) archive. Returns final count."""
    existing = load_existing_archive(platform, region, subtype, date_str)
    merged = merge_items(existing.get('items', []), new_items)
    if not merged:
        return 0

    path = archive_path(platform, region, subtype, date_str)
    path.parent.mkdir(parents=True, exist_ok=True)

    archive_data = {
        'date': date_str,
        'archived_at': datetime.now(timezone.utc).isoformat(),
        'source': platform,
        'item_count': len(merged),
        'items': merged,
    }
    if region:
        archive_data['region'] = region
    if subtype:
        archive_data['content_subtype'] = subtype
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(archive_data, f, ensure_ascii=False, indent=2)
    return len(merged)


def archive_all(target_date: str | None, fallback_date: str) -> dict[str, int]:
    """Archive every item in news.json under (normalized source, its own UTC+8 date).

    Reading the merged news.json (not the time-window-filtered *-latest.json) keeps
    the archive a true full layer, and per-item date bucketing removes the midnight
    boundary loss + mislabeled-date fallback of the old single-date logic.

    target_date 非空时只归档该日；为空时归档 news.json 内出现的全部日期。
    """
    groups: dict[tuple[str, str | None, str | None, str], list[dict]] = defaultdict(list)
    for raw in load_news():
        src = normalize_source(raw.get('source', 'unknown'))
        if src == 'discord':  # 独立归档器处理
            continue
        region = raw.get('region') or None             # 甲方案：区服字段（global/jp…）
        subtype = raw.get('archive_subtype') or None   # 甲方案：内容类型字段（review/news…）
        d = item_date_utc8(raw, fallback_date)
        if target_date and d != target_date:
            continue
        groups[(src, region, subtype, d)].append(raw)

    totals: dict[str, int] = defaultdict(int)
    for (src, region, subtype, d), items in groups.items():
        write_archive(src, region, subtype, d, items)
        totals[src] += len(items)
    return totals


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

        files = sorted(platform_dir.rglob('*.json'))  # rglob 兼容甲方案分层(区服/类型子目录)
        if not files:
            print(f'  {platform:12s}  (无归档)')
            continue

        file_count = len(files)
        item_count = 0
        dates = sorted(f.stem for f in files)
        first_date = dates[0]
        last_date = dates[-1]

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

    today = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime('%Y-%m-%d')

    if args.date:
        print(f'归档日期（限定）：{args.date}')
    else:
        print('归档日期：news.json 内全部日期（全量分桶）')
    print(f'归档目录：{ARCHIVE_DIR}/\n')

    totals = archive_all(target_date=args.date, fallback_date=today)
    if not totals:
        print('  (news.json 无可归档数据)')
    for platform in sorted(totals):
        print(f'  {platform:12s}  {totals[platform]} 条')

    print(f'\n完成，共归档 {sum(totals.values())} 条，覆盖 {len(totals)} 个源。')


if __name__ == '__main__':
    main()
