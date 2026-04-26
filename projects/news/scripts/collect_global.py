#!/usr/bin/env python3
"""
collect_global.py — 全球社区采集桥接脚本

调用 global_collectors.py 的 21 个采集器，
合并 aggregator.py 的输出，生成统一的 news.json。

运行方式:
  python projects/news/scripts/collect_global.py

工作流程:
  1. 运行零成本采集器（不需要 API Key 的那些）
  2. 读取 aggregator.py 已有的 news.json（如果存在）
  3. 合并、去重、排序
  4. 写回 news.json
"""

import json
import os
import sys
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
OUTPUT_PATH = _REPO_ROOT / 'projects' / 'news' / 'output' / 'news.json'

# Ensure sibling scripts dir is importable (works both as script and module)
sys.path.insert(0, str(Path(__file__).resolve().parent))


# ── Source mapping: collector source names → aggregator source names ──
SOURCE_MAP = {
    'bilibili': 'bilibili',
    'reddit': 'reddit',
    'youtube': 'youtube',
    'nga': 'nga',
    'taptap': 'taptap',
    'steam': 'steam_review',
    'weibo': 'weibo',
    'zhihu': 'zhihu',
    'naver_cafe': 'naver_cafe',
    'bahamut': 'bahamut',
    'dcinside': 'dcinside',
    'arca_live': 'arca_live',
    'fivech': 'fivech',
    'appstore': 'appstore',
    'google_play': 'google_play',
    'pixiv': 'pixiv',
    'note_com': 'note_com',
    'ruliweb': 'ruliweb',
    'stopgame': 'stopgame',
    'weixin': 'weixin',
    'discord': 'discord',
    'telegram': 'telegram',
}


def convert_item(item: dict) -> dict:
    """Convert a report-system item to aggregator format."""
    source = SOURCE_MAP.get(item.get('source', ''), item.get('source', 'unknown'))
    converted = {
        'title': item.get('title', ''),
        'summary': item.get('summary', ''),
        'source': source,
        'time': item.get('time', ''),
        'url': item.get('url', ''),
        'engagement': item.get('engagement', 0),
        'is_hot': item.get('is_hot', False),
        'author': item.get('author', ''),
        'tags': item.get('tags', []),
        'lang': item.get('lang', ''),
        'platform_region': item.get('platform_region', ''),
    }
    # Preserve media fields for image archival
    if item.get('media_url'):
        converted['media_url'] = item['media_url']
        converted['content_type'] = item.get('content_type', 'image')
    # Preserve metadata (comments, play counts, reactions, etc.)
    if item.get('metadata') and isinstance(item['metadata'], dict):
        converted['metadata'] = item['metadata']
    return converted


def dedup_key(item: dict) -> str:
    """Generate dedup key for an item. URL-first, title fallback — aligned with aggregator."""
    url = (item.get('url', '') or '').replace('http://', 'https://').rstrip('/').strip()
    if url:
        return url
    return f"{item.get('title', '')[:60]}|{item.get('source', '')}|{item.get('author', '')}"


def run_zero_cost_collectors() -> list[dict]:
    """Run all collectors that don't require API keys."""
    items = []

    try:
        import global_collectors as c
        c._refresh_cutoff()
    except ImportError as e:
        logger.error(f"Cannot import global_collectors module: {e}")
        return items

    # 数据质量追踪器：更新各源状态，长期沉默的源自动 dormant 跳过
    tracker = None
    try:
        sys.path.insert(0, str(_REPO_ROOT / 'projects' / 'news' / 'scripts'))
        from data_quality import SilentPlatformTracker
        tracker = SilentPlatformTracker()
    except Exception as e:
        logger.debug(f'SilentPlatformTracker not available: {e}')

    # Playwright fallback: platforms where HTTP fails but browser works
    PW_FALLBACK: dict[str, str] = {
        # name → playwright_collectors function name
        'Arca.live':   'fetch_arca_live_playwright',
        '5ch':         'fetch_fivech_playwright',
        'Ruliweb':     'fetch_ruliweb_playwright',
        'Bahamut':     'fetch_bahamut_playwright',
        'Naver Cafe':  None,  # no PW yet, but unsuspended to try HTTP first
        'TapTap':      'fetch_taptap_playwright',
        'Weibo':       'fetch_weibo_playwright',
    }

    # Load playwright_collectors module once
    pw_mod = None
    try:
        import playwright_collectors as pw_mod
    except ImportError:
        logger.debug('playwright_collectors not available')

    # Zero-cost collectors (no API key / no cookie required)
    zero_cost_fetchers = [
        ('Bilibili', c.fetch_bilibili),
        ('Reddit', c.fetch_reddit),
        ('NGA', c.fetch_nga),
        ('TapTap', c.fetch_taptap),
        ('Weibo', c.fetch_weibo),
        ('Zhihu', c.fetch_zhihu),
        ('Naver Cafe', c.fetch_naver_cafe),
        ('5ch', c.fetch_fivech),
        ('App Store', c.fetch_appstore_reviews),
        ('Pixiv', c.fetch_pixiv),
        ('Note.com', c.fetch_note_com),
        ('Ruliweb', c.fetch_ruliweb),
        ('StopGame', c.fetch_stopgame),
        ('搜狗微信', c.fetch_weixin),
    ]

    # Collectors that may use API keys when available, fall back to public endpoints otherwise
    api_fetchers = [
        ('YouTube', c.fetch_youtube),
        ('Discord API', c.fetch_discord),
        ('Telegram', c.fetch_telegram),
        ('Bahamut', c.fetch_bahamut),
        ('DCInside', c.fetch_dcinside),
        ('Arca.live', c.fetch_arca_live),
        ('Google Play', c.fetch_google_play),
    ]

    all_fetchers = zero_cost_fetchers + api_fetchers

    # 显示名 → source_id（与 archive/split 对齐）
    NAME_TO_SOURCE_ID = {
        'Bilibili': 'bilibili', 'Reddit': 'reddit', 'NGA': 'nga', 'TapTap': 'taptap',
        'Weibo': 'weibo', 'Zhihu': 'zhihu', 'Naver Cafe': 'naver_cafe',
        '5ch': 'fivech', 'App Store': 'appstore',
        'Pixiv': 'pixiv', 'Note.com': 'note_com', 'Ruliweb': 'ruliweb',
        'StopGame': 'stopgame', '搜狗微信': 'weixin',
        'YouTube': 'youtube', 'Discord API': 'discord',
        'Telegram': 'telegram', 'Bahamut': 'bahamut',
        'DCInside': 'dcinside', 'Arca.live': 'arca_live', 'Google Play': 'google_play',
    }

    succeeded = []
    failed = []
    empty = []

    for name, fn in all_fetchers:
        source_id = NAME_TO_SOURCE_ID.get(name, name.lower())

        # dormant 源直接跳过，节约 CI 时间
        if tracker and tracker.should_skip_platform(source_id):
            logger.info(f"  ⏭  {name}: dormant, skipping")
            continue

        try:
            result = fn()
            # Playwright fallback: if HTTP returned 0/empty and we have a PW fallback
            if not result and name in PW_FALLBACK and PW_FALLBACK[name] and pw_mod:
                pw_fn_name = PW_FALLBACK[name]
                pw_fn = getattr(pw_mod, pw_fn_name, None)
                if pw_fn:
                    logger.info(f"  ↻ {name}: HTTP empty, trying Playwright fallback...")
                    result = pw_fn()
            if result:
                items.extend(result)
                succeeded.append((name, len(result)))
                logger.info(f"  ✓ {name}: +{len(result)} items")
            else:
                empty.append(name)
                logger.info(f"  · {name}: 0 items")
            if tracker:
                tracker.update_platform_status(source_id, len(result) if result else 0)
        except Exception as e:
            # Playwright fallback on exception too
            if name in PW_FALLBACK and PW_FALLBACK[name] and pw_mod:
                pw_fn_name = PW_FALLBACK[name]
                pw_fn = getattr(pw_mod, pw_fn_name, None)
                if pw_fn:
                    logger.info(f"  ↻ {name}: HTTP crashed, trying Playwright fallback...")
                    try:
                        result = pw_fn()
                        if result:
                            items.extend(result)
                            succeeded.append((name, len(result)))
                            logger.info(f"  ✓ {name} (PW): +{len(result)} items")
                            if tracker:
                                tracker.update_platform_status(source_id, len(result))
                            continue
                    except Exception as pw_e:
                        logger.warning(f"  ✗ {name} Playwright also failed: {pw_e}")
            failed.append((name, str(e)[:120]))
            logger.warning(f"  ✗ {name} FAILED: {e}")
            if tracker:
                tracker.update_platform_status(source_id, 0, error=str(e))

    # Diagnostic summary
    logger.info("=== 采集诊断 ===")
    logger.info(f"成功 ({len(succeeded)}): {', '.join(f'{n}({c})' for n, c in succeeded)}")
    if empty:
        logger.info(f"空结果 ({len(empty)}): {', '.join(empty)}")
    if failed:
        logger.warning(f"失败 ({len(failed)}):")
        for name, err in failed:
            logger.warning(f"  {name}: {err}")

    return items


def load_existing_news() -> list[dict]:
    """Load existing news.json items from aggregator."""
    if not OUTPUT_PATH.exists():
        return []
    try:
        with open(OUTPUT_PATH, encoding='utf-8') as f:
            data = json.load(f)
        return data.get('news', [])
    except Exception:
        return []


# Adaptive: match the lookback window used by collectors
try:
    from collection_state import get_lookback_hours
    MAX_AGE_HOURS = int(os.environ.get('MAX_AGE_HOURS', 0)) or get_lookback_hours()
except ImportError:
    MAX_AGE_HOURS = int(os.environ.get('MAX_AGE_HOURS', 24))


def _is_recent(time_str: str) -> bool:
    """Check if a timestamp is within MAX_AGE_HOURS of now."""
    if not time_str:
        return False
    try:
        dt = datetime.fromisoformat(time_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt) < timedelta(hours=MAX_AGE_HOURS)
    except (ValueError, TypeError):
        return False


def merge_and_dedup(existing: list[dict], new_items: list[dict]) -> list[dict]:
    """Merge and deduplicate items, keeping higher-engagement version.
    Filters out items older than MAX_AGE_HOURS."""
    seen: dict[str, dict] = {}

    # Existing items first (they're already validated)
    for item in existing:
        if not _is_recent(item.get('time', '')):
            continue
        key = dedup_key(item)
        if key not in seen or item.get('engagement', 0) > seen[key].get('engagement', 0):
            seen[key] = item

    # New items (from global collectors)
    for item in new_items:
        converted = convert_item(item)
        if not _is_recent(converted.get('time', '')):
            continue
        key = dedup_key(converted)
        if key not in seen or converted.get('engagement', 0) > seen[key].get('engagement', 0):
            seen[key] = converted

    # Sort by engagement descending
    merged = sorted(seen.values(), key=lambda x: x.get('engagement', 0), reverse=True)
    return merged


def build_summary(items: list[dict]) -> str:
    """Build a summary string from top items."""
    top = items[:5]
    titles = [item.get('title', '')[:30] for item in top if item.get('title')]
    return '；'.join(titles) + '。' if titles else ''


def main():
    logger.info('=== 全球社区采集开始 ===')

    # Step 1: Run global collectors
    global_items = run_zero_cost_collectors()
    logger.info(f'全球采集完成: {len(global_items)} items')

    # Step 2: Load existing aggregator output
    existing = load_existing_news()
    logger.info(f'已有数据: {len(existing)} items')

    # Step 3: Merge and dedup
    merged = merge_and_dedup(existing, global_items)
    logger.info(f'合并去重后: {len(merged)} items')

    # Step 4: Write back
    output = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'summary': build_summary(merged),
        'sources_run': len(global_items),
        'news': merged,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # Stats
    sources = {}
    for item in merged:
        src = item.get('source', 'unknown')
        sources[src] = sources.get(src, 0) + 1

    logger.info('=== 数据源统计 ===')
    for src, count in sorted(sources.items(), key=lambda x: -x[1]):
        logger.info(f'  {src}: {count}')
    logger.info(f'=== 全球采集完成: {len(merged)} items → {OUTPUT_PATH} ===')


if __name__ == '__main__':
    main()
