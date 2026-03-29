"""
split_output.py — 按数据源分割 assets/data/news.json
将合并的聚合结果拆分为各数据源独立的 JSON 文件，统一存放在 projects/news/output/

输出文件：
  projects/news/output/bilibili-latest.json
  projects/news/output/steam-latest.json
  projects/news/output/taptap-latest.json
  projects/news/output/discord-latest.json
  projects/news/output/twitter-latest.json
  projects/news/output/youtube-latest.json
  projects/news/output/reddit-latest.json
  projects/news/output/nga-latest.json
  projects/news/output/official-latest.json
  projects/news/output/all-latest.json   ← 所有源合并（方便 Chat 会话一次性读取）

格式：
  {
    "collected_at": "ISO 8601 时间戳",
    "source": "bilibili",
    "item_count": 5,
    "items": [
      {
        "source": "bilibili",
        "time": "...",
        "lang": "zh",
        "title": "...",
        "summary": "...",
        "url": "...",
        "author": "...",
        "engagement": 123
      }
    ]
  }

运行方式：
  python projects/news/scripts/split_output.py
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── 路径 ──────────────────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).parent.parent.parent.parent  # brain-in-a-vat/
INPUT_PATH = _REPO_ROOT / 'assets' / 'data' / 'news.json'
OUTPUT_DIR = _REPO_ROOT / 'projects' / 'news' / 'output'

# ── 数据源规范化 ──────────────────────────────────────────────────────────────
# bilibili_articles / bilibili_dynamic 都归入 bilibili
SOURCE_ALIASES: dict[str, str] = {
    'bilibili_articles': 'bilibili',
    'bilibili_dynamic': 'bilibili',
    'steam_review': 'steam',
}

KNOWN_SOURCES = [
    'bilibili',
    'steam',
    'taptap',
    'discord',
    'twitter',
    'youtube',
    'reddit',
    'nga',
    'official',
]


def normalize_source(raw: str) -> str:
    return SOURCE_ALIASES.get(raw, raw)


def extract_item(raw: dict) -> dict:
    """从原始 news item 提取 Chat 会话关心的字段。"""
    return {
        'source': normalize_source(raw.get('source', 'unknown')),
        'time': raw.get('time', ''),
        'lang': raw.get('lang', ''),
        'title': raw.get('title', ''),
        'summary': raw.get('summary', ''),
        'url': raw.get('url', ''),
        'author': raw.get('author', ''),
        'engagement': raw.get('engagement', 0),
    }


def extract_steam_item(raw: dict) -> dict:
    """从 steam_review 原始 item 提取 steam-latest.json 所需字段。"""
    meta = raw.get('metadata', {})
    timestamp_created = meta.get('timestamp_created', 0)
    if not timestamp_created and raw.get('time'):
        try:
            dt = datetime.fromisoformat(raw['time'].replace('Z', '+00:00'))
            timestamp_created = int(dt.timestamp())
        except (ValueError, TypeError):
            pass
    return {
        'language': raw.get('language', ''),
        'voted_up': meta.get('voted_up', False),
        'review': raw.get('summary', '')[:200],
        'timestamp_created': timestamp_created,
        'playtime_forever': meta.get('playtime_forever', 0),
    }


def write_source_file(source: str, items: list[dict], collected_at: str) -> None:
    path = OUTPUT_DIR / f'{source}-latest.json'
    payload = {
        'collected_at': collected_at,
        'source': source,
        'item_count': len(items),
        'items': items,
    }
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f'  {source}-latest.json  ({len(items)} items)')


def main() -> None:
    if not INPUT_PATH.exists():
        print(f'ERROR: {INPUT_PATH} not found', file=sys.stderr)
        sys.exit(1)

    with open(INPUT_PATH, encoding='utf-8') as f:
        data = json.load(f)

    collected_at = data.get('updated_at', datetime.now(timezone.utc).isoformat())
    raw_items: list[dict] = data.get('news', [])

    # 按规范化后的 source 分组
    by_source: dict[str, list[dict]] = {}
    for raw in raw_items:
        src = normalize_source(raw.get('source', 'unknown'))
        item = extract_steam_item(raw) if src == 'steam' else extract_item(raw)
        by_source.setdefault(src, []).append(item)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f'Writing to {OUTPUT_DIR}/')

    # 写各数据源文件
    all_items: list[dict] = []
    for source in KNOWN_SOURCES:
        items = by_source.get(source, [])
        write_source_file(source, items, collected_at)
        all_items.extend(items)

    # 写入未知数据源（容纳未来新源）
    for source, items in by_source.items():
        if source not in KNOWN_SOURCES:
            write_source_file(source, items, collected_at)
            all_items.extend(items)

    # 写合并文件
    all_path = OUTPUT_DIR / 'all-latest.json'
    with open(all_path, 'w', encoding='utf-8') as f:
        json.dump({
            'collected_at': collected_at,
            'source': 'all',
            'item_count': len(all_items),
            'items': all_items,
        }, f, ensure_ascii=False, indent=2)
    print(f'  all-latest.json  ({len(all_items)} items)')
    print(f'Done. collected_at={collected_at}')


if __name__ == '__main__':
    main()
