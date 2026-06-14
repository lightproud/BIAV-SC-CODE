"""
split_output.py — 按数据源分割 projects/news/output/news.json
将合并的聚合结果拆分为各数据源独立的 JSON 文件，统一存放在 projects/news/output/

输出文件：
  projects/news/output/bilibili-latest.json
  projects/news/output/steam-latest.json
  projects/news/output/taptap-latest.json
  projects/news/output/discord-latest.json
  projects/news/output/twitter-latest.json
  projects/news/output/youtube-latest.json
  projects/news/output/reddit-latest.json
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
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ── 路径 ──────────────────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).parent.parent.parent.parent  # brain-in-a-vat/
INPUT_PATH = _REPO_ROOT / 'projects' / 'news' / 'output' / 'news.json'
OUTPUT_DIR = _REPO_ROOT / 'projects' / 'news' / 'output'

# ── 数据源规范化 ──────────────────────────────────────────────────────────────
# bilibili_articles / bilibili_dynamic 都归入 bilibili
from sources import KNOWN_SOURCES, SOURCE_ALIASES, SPARSE_SOURCES, normalize_source


# Adaptive: match the lookback window used by collectors
try:
    from collection_state import get_lookback_hours
    _default_hours = get_lookback_hours()
except ImportError:
    _default_hours = 24
MAX_AGE_HOURS = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else _default_hours

# 稀疏源使用更宽时间窗口（SPARSE_SOURCES 来自 sources.py 单一真相源）
OFFICIAL_MAX_AGE_HOURS = int(os.environ.get('OFFICIAL_MAX_AGE_HOURS', 30 * 24))
# 旧名保留向后兼容
OFFICIAL_SOURCES = SPARSE_SOURCES


def _is_recent(time_str: str, max_hours: int = MAX_AGE_HOURS) -> bool:
    """Check if a timestamp is within max_hours of now."""
    if not time_str:
        return False
    try:
        dt = datetime.fromisoformat(time_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt) < timedelta(hours=max_hours)
    except (ValueError, TypeError):
        return False


def extract_item(raw: dict) -> dict:
    """从原始 news item 提取 Chat 会话关心的字段。"""
    item = {
        'source': normalize_source(raw.get('source', 'unknown')),
        'time': raw.get('time', ''),
        'lang': raw.get('lang', ''),
        'title': raw.get('title', ''),
        'summary': raw.get('summary', ''),
        'url': raw.get('url', ''),
        'author': raw.get('author', ''),
        'engagement': raw.get('engagement', 0),
    }
    # Preserve media fields when present
    if raw.get('media_url'):
        item['media_url'] = raw['media_url']
        item['content_type'] = raw.get('content_type', 'image')
    # Preserve metadata (Discord reply chains, reactions, etc.)
    if raw.get('metadata') and isinstance(raw['metadata'], dict):
        item['metadata'] = raw['metadata']
    return item


def extract_steam_item(raw: dict) -> dict:
    """从 steam_review 原始 item 提取字段。

    保留标准字段（time, title, source, engagement 等）供下游消费者使用，
    同时附带 Steam 特有字段（language, voted_up, playtime_forever）。

    好评差评均保留全文，不截断。
    """
    meta = raw.get('metadata', {})
    timestamp_created = meta.get('timestamp_created', 0)
    if not timestamp_created and raw.get('time'):
        try:
            dt = datetime.fromisoformat(raw['time'].replace('Z', '+00:00'))
            timestamp_created = int(dt.timestamp())
        except (ValueError, TypeError):
            pass
    voted_up = meta.get('voted_up', False)
    summary_text = raw.get('summary', '')
    return {
        # 标准字段（与 extract_item 一致）
        'source': 'steam',
        'time': raw.get('time', ''),
        'lang': raw.get('language', ''),
        'title': raw.get('title', ''),
        'summary': summary_text,
        'url': raw.get('url', ''),
        'author': raw.get('author', ''),
        'engagement': raw.get('engagement', 0),
        # Steam 特有字段
        'language': raw.get('language', ''),
        'voted_up': voted_up,
        'review': summary_text,
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

    # 按规范化后的 source 分组，过滤超时数据
    by_source: dict[str, list[dict]] = {}
    skipped_old = 0
    for raw in raw_items:
        src = normalize_source(raw.get('source', 'unknown'))
        item = extract_steam_item(raw) if src == 'steam' else extract_item(raw)
        # 稀疏源（评论 / 公告 / 同人）使用更宽窗口，高频源沿用 MAX_AGE_HOURS
        max_age = OFFICIAL_MAX_AGE_HOURS if src in SPARSE_SOURCES else MAX_AGE_HOURS
        if not _is_recent(item.get('time', ''), max_age):
            skipped_old += 1
            continue
        by_source.setdefault(src, []).append(item)
    if skipped_old:
        print(f'  Filtered out {skipped_old} items (sparse>{OFFICIAL_MAX_AGE_HOURS}h, others>{MAX_AGE_HOURS}h)')

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
