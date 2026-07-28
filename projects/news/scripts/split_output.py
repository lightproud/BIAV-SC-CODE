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
    "data_layer": "output",
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
from datetime import datetime, timedelta, UTC
from pathlib import Path

# ── 路径 ──────────────────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).parent.parent.parent.parent  # 仓根 BIAV-SC-CODE/
INPUT_PATH = _REPO_ROOT / 'projects' / 'news' / 'output' / 'news.json'
OUTPUT_DIR = _REPO_ROOT / 'projects' / 'news' / 'output'

# 数据层戳记（CLAUDE.md §4 数据纪律）：这些文件是输出/展示层——全量档案层的
# 过滤抽样，绝不可当全量数据用（lesson #30）。此前该身份纯靠约定、产物无机器可读
# 标记；现落标，让消费端能程序化判别，把纪律从「人记」升级为「代码设防」。
DATA_LAYER = 'output'

import news_common  # noqa: E402  容错 env 读取（env_int：空串 env 不得在 import 期打死模块）

# ── 数据源规范化 ──────────────────────────────────────────────────────────────
# bilibili_articles / bilibili_dynamic 都归入 bilibili
from sources import KNOWN_SOURCES, SPARSE_SOURCES, normalize_source


# Adaptive: match the lookback window used by collectors
try:
    from collection_state import get_lookback_hours
    _default_hours = get_lookback_hours()
except ImportError:
    _default_hours = 24
MAX_AGE_HOURS = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else _default_hours

# 稀疏源使用更宽时间窗口（SPARSE_SOURCES 来自 sources.py 单一真相源）
OFFICIAL_MAX_AGE_HOURS = news_common.env_int('OFFICIAL_MAX_AGE_HOURS', 30 * 24)


def _is_recent(time_str: str, max_hours: int = MAX_AGE_HOURS) -> bool:
    """Check if a timestamp is within max_hours of now."""
    if not time_str:
        return False
    try:
        dt = datetime.fromisoformat(time_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return (datetime.now(UTC) - dt) < timedelta(hours=max_hours)
    except (ValueError, TypeError):
        return False


def _timestamp_usable(time_str: str) -> bool:
    """时间戳本身能否解析。与 `_is_recent` 分开问，是因为二者的 False 含义完全不同：
    「太旧」是正常过滤，「解析不出」是上游采集器的字段坏了。"""
    if not time_str:
        return False
    try:
        datetime.fromisoformat(time_str)
    except (ValueError, TypeError):
        return False
    return True


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
            dt = datetime.fromisoformat(raw['time'])
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
        # 输出层契约 v1（schema/output-latest.schema.json，2026-07-02 P2-9）：
        # 本文件是银芯→黑池的正式接口面，改包裹结构须升版本并知会消费方
        'contract_version': 1,
        'collected_at': collected_at,
        'source': source,
        'data_layer': DATA_LAYER,
        'item_count': len(items),
        'items': items,
    }
    # 原子写（news_common.dump_json_atomic 单一真源）：*-latest.json 是黑池 / 前端的
    # 正式接口面，直写 open('w') 若在写一半被中断会留下半截 JSON，消费端读到即崩。
    news_common.dump_json_atomic(path, payload)
    print(f'  {source}-latest.json  ({len(items)} items)')


def main() -> None:
    if not INPUT_PATH.exists():
        print(f'ERROR: {INPUT_PATH} not found', file=sys.stderr)
        sys.exit(1)

    with open(INPUT_PATH, encoding='utf-8') as f:
        data = json.load(f)

    collected_at = data.get('updated_at', datetime.now(UTC).isoformat())
    raw_items: list[dict] = data.get('news', [])

    # 按规范化后的 source 分组，过滤超时数据
    by_source: dict[str, list[dict]] = {}
    skipped_old = 0
    # 时间戳坏掉的条目原先也计进 skipped_old，打成「太旧被过滤」——把一个上游数据缺陷
    # 报成了正常的窗口过滤。这类条目**永远**进不了输出层（不论窗口开多大），
    # 而日志说的是「超出 24h 窗口」，照着这句话调窗口一条也救不回来。分开计数。
    skipped_unparsable: dict[str, int] = {}
    for raw in raw_items:
        src = normalize_source(raw.get('source', 'unknown'))
        item = extract_steam_item(raw) if src == 'steam' else extract_item(raw)
        # 稀疏源（评论 / 公告 / 同人）使用更宽窗口，高频源沿用 MAX_AGE_HOURS
        max_age = OFFICIAL_MAX_AGE_HOURS if src in SPARSE_SOURCES else MAX_AGE_HOURS
        if not _timestamp_usable(item.get('time', '')):
            skipped_unparsable[src] = skipped_unparsable.get(src, 0) + 1
            continue
        if not _is_recent(item.get('time', ''), max_age):
            skipped_old += 1
            continue
        by_source.setdefault(src, []).append(item)
    if skipped_old:
        print(f'  Filtered out {skipped_old} items (sparse>{OFFICIAL_MAX_AGE_HOURS}h, others>{MAX_AGE_HOURS}h)')
    if skipped_unparsable:
        total_bad = sum(skipped_unparsable.values())
        print(f'  WARNING: dropped {total_bad} items with missing/unparsable time '
              f'(NOT an age filter — these can never reach the output layer): '
              f'{dict(sorted(skipped_unparsable.items()))}', file=sys.stderr)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f'Writing to {OUTPUT_DIR}/')

    # 写各数据源文件
    all_items: list[dict] = []
    written: set[str] = set()
    for source in KNOWN_SOURCES:
        items = by_source.get(source, [])
        write_source_file(source, items, collected_at)
        written.add(source)
        all_items.extend(items)

    # 写入未知数据源（容纳未来新源）
    for source, items in by_source.items():
        if source not in KNOWN_SOURCES:
            write_source_file(source, items, collected_at)
            written.add(source)
            all_items.extend(items)

    # 退役源清零：源改名 / 停采后（历史实例 nga、taptap_post）它既不在 KNOWN_SOURCES、
    # 本轮也不出现在 by_source，其 *-latest.json 会永远冻在最后一次有数据的那天，
    # 而下游（okf news-output 指针层 / kb_coverage / 黑池）按 glob 一律当「当前输出层」读，
    # 于是陈旧条目被当成最新热点。KNOWN 源本来每轮都会被重写成空，此处把同一语义补给退役源。
    for stale in sorted(OUTPUT_DIR.glob('*-latest.json')):
        source = stale.name[: -len('-latest.json')]
        if source == 'all' or source in written:
            continue
        write_source_file(source, [], collected_at)

    # 写合并文件（契约字段与 write_source_file 同构，勿漂移）
    all_path = OUTPUT_DIR / 'all-latest.json'
    news_common.dump_json_atomic(all_path, {
        'contract_version': 1,
        'collected_at': collected_at,
        'source': 'all',
        'data_layer': DATA_LAYER,
        'item_count': len(all_items),
        'items': all_items,
    })
    print(f'  all-latest.json  ({len(all_items)} items)')
    print(f'Done. collected_at={collected_at}')


if __name__ == '__main__':
    main()
