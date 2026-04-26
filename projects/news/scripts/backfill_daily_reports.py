#!/usr/bin/env python3
"""
backfill_daily_reports.py — Generate daily reports for dates missing from archive.

Reads per-platform archive files in data/platforms/{source}/{date}.json
and produces daily-report-{date}.md for each gap date.

Usage:
  python backfill_daily_reports.py                     # fill all gaps
  python backfill_daily_reports.py --start 2026-04-13 --end 2026-04-25
"""

import json
import argparse
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
from collections import defaultdict

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PLATFORMS_DIR = REPO_ROOT / 'projects' / 'news' / 'data' / 'platforms'
ARCHIVE_DIR = REPO_ROOT / 'projects' / 'news' / 'data' / 'archive' / 'daily-reports'

PLATFORM_NAMES = {
    'steam': 'Steam', 'steam_review': 'Steam', 'bilibili': 'Bilibili',
    'twitter': 'Twitter/X', 'discord': 'Discord', 'nga': 'NGA',
    'taptap': 'TapTap', 'youtube': 'YouTube', 'reddit': 'Reddit',
    'official': 'Official', 'weibo': '微博', 'xiaohongshu': '小红书',
    'douyin': '抖音', 'tieba': '百度贴吧',
    'zhihu': '知乎', 'bahamut': '巴哈姆特',
    'naver_cafe': 'Naver Cafe', 'arca_live': 'Arca.live',
    'fivech': '5ch', 'appstore': 'App Store', 'google_play': 'Google Play',
    'tiktok': 'TikTok', 'facebook': 'Facebook', 'telegram': 'Telegram',
    'twitch': 'Twitch', 'instagram': 'Instagram', 'pixiv': 'Pixiv',
    'lofter': 'Lofter', 'xianyu': '闲鱼', 'taobao': '淘宝',
    'qq': 'QQ频道', 'qooapp': 'QooApp', 'epic': 'Epic Games Store',
    'note_com': 'Note.com', 'ruliweb': 'Ruliweb', 'vkplay': 'VK Play',
    'stopgame': 'StopGame.ru', 'gacharevenue': 'GACHAREVENUE',
    'weixin': '微信公众号',
}


def load_date_data(target_date: date) -> dict[str, list[dict]]:
    date_str = target_date.isoformat()
    result = {}
    if not PLATFORMS_DIR.exists():
        return result
    for platform_dir in sorted(PLATFORMS_DIR.iterdir()):
        if not platform_dir.is_dir():
            continue
        date_file = platform_dir / f'{date_str}.json'
        if not date_file.exists():
            continue
        try:
            data = json.loads(date_file.read_text(encoding='utf-8'))
            items = data if isinstance(data, list) else data.get('items', [data] if isinstance(data, dict) and 'title' in data else [])
            if items:
                result[platform_dir.name] = items
        except Exception:
            continue
    return result


def top_engagement(items, n=5):
    return sorted(items, key=lambda x: x.get('engagement', 0), reverse=True)[:n]


def generate_report_for_date(target_date: date) -> str:
    date_str = target_date.isoformat()
    data = load_date_data(target_date)

    lines = [
        f'# 忘却前夜 社区日报 {date_str}',
        '',
        f'> 回补生成 | 原始数据来自平台归档',
        '',
    ]

    lines.append('## 总览')
    lines.append('')
    lines.append('| 平台 | 数据条数 |')
    lines.append('|------|----------|')

    active = {}
    silent = []

    for source, items in sorted(data.items(), key=lambda x: PLATFORM_NAMES.get(x[0], x[0])):
        display = PLATFORM_NAMES.get(source, source)
        active[source] = (display, items)
        lines.append(f'| {display} | {len(items)} |')

    total_items = sum(len(v[1]) for v in active.values())

    if not active:
        lines.append(f'| (无数据) | 0 |')

    lines.append('')

    for source, (display, items) in active.items():
        if source in ('steam', 'steam_review'):
            positive = sum(1 for i in items if '正面' in i.get('title', ''))
            negative = sum(1 for i in items if '负面' in i.get('title', ''))
            total = len(items)
            rate = f'{positive / total * 100:.0f}%' if total > 0 else 'N/A'
            lines.append(f'## {display} 评论')
            lines.append('')
            lines.append(f'- 好评 {positive} / 差评 {negative} / 好评率 {rate}')
            lines.append('')
            top = top_engagement([i for i in items if '正面' in i.get('title', '')])
            if top:
                lines.append('### 热门好评')
                lines.append('')
                for idx, item in enumerate(top, 1):
                    title = item.get('title', '')[:60]
                    eng = item.get('engagement', 0)
                    lines.append(f'{idx}. {title} -- engagement: {eng}')
                lines.append('')
            continue

        lines.append(f'## {display}')
        lines.append('')
        top = top_engagement(items)
        for idx, item in enumerate(top, 1):
            title = item.get('title', '(无标题)')[:60]
            eng = item.get('engagement', 0)
            lines.append(f'{idx}. {title} -- engagement: {eng}')
        lines.append('')

    return '\n'.join(lines), total_items


def find_gap_dates() -> list[date]:
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    existing = set()
    for f in ARCHIVE_DIR.glob('daily-report-*.md'):
        try:
            d = date.fromisoformat(f.stem.replace('daily-report-', ''))
            existing.add(d)
        except ValueError:
            continue

    all_dates_with_data = set()
    if PLATFORMS_DIR.exists():
        for platform_dir in PLATFORMS_DIR.iterdir():
            if not platform_dir.is_dir():
                continue
            for f in platform_dir.glob('*.json'):
                try:
                    d = date.fromisoformat(f.stem)
                    all_dates_with_data.add(d)
                except ValueError:
                    continue

    return sorted(all_dates_with_data - existing)


def main():
    parser = argparse.ArgumentParser(description='回补缺失日期的日报')
    parser.add_argument('--start', type=str, default=None)
    parser.add_argument('--end', type=str, default=None)
    args = parser.parse_args()

    if args.start and args.end:
        start = date.fromisoformat(args.start)
        end = date.fromisoformat(args.end)
        gap_dates = []
        d = start
        while d <= end:
            gap_dates.append(d)
            d += timedelta(days=1)
    else:
        gap_dates = find_gap_dates()

    if not gap_dates:
        print('无缺失日期需要回补')
        return

    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    total_reports = 0

    for d in gap_dates:
        report, item_count = generate_report_for_date(d)
        if item_count == 0:
            print(f'  {d}: 无数据，跳过')
            continue
        out_path = ARCHIVE_DIR / f'daily-report-{d.isoformat()}.md'
        out_path.write_text(report, encoding='utf-8')
        total_reports += 1
        print(f'  {d}: {item_count} 条 -> {out_path.name}')

    print(f'\n回补完成: {total_reports} 份日报')


if __name__ == '__main__':
    main()
