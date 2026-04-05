#!/usr/bin/env python3
"""
collect_global.py — 全球社区采集桥接脚本

将 report-system/collector.py 的 29 个采集器接入主管线，
合并 aggregator.py 的输出，生成统一的 news.json。

运行方式:
  python projects/news/scripts/collect_global.py

工作流程:
  1. 运行 report-system 的零成本采集器（不需要 API Key 的那些）
  2. 读取 aggregator.py 已有的 news.json（如果存在）
  3. 合并、去重、排序
  4. 写回 news.json
"""

import json
import sys
import os
import logging
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
OUTPUT_PATH = _REPO_ROOT / 'projects' / 'news' / 'output' / 'news.json'

# Add report-system to path so we can import collector
REPORT_SYSTEM_DIR = _REPO_ROOT / 'projects' / 'news' / 'report-system' / 'scripts'
sys.path.insert(0, str(REPORT_SYSTEM_DIR))


# ── Source mapping: collector source names → aggregator source names ──
SOURCE_MAP = {
    'bilibili': 'bilibili',
    'reddit': 'reddit',
    'twitter': 'twitter',
    'youtube': 'youtube',
    'nga': 'nga',
    'taptap': 'taptap',
    'steam': 'steam_review',
    'steam_discussion': 'steam_discussion',
    'weibo': 'weibo',
    'xiaohongshu': 'xiaohongshu',
    'douyin': 'douyin',
    'tieba': 'tieba',
    'zhihu': 'zhihu',
    'bahamut': 'bahamut',
    'naver_cafe': 'naver_cafe',
    'dcinside': 'dcinside',
    'arca_live': 'arca_live',
    'fivech': 'fivech',
    'appstore': 'appstore',
    'google_play': 'google_play',
    'tiktok': 'tiktok',
    'pixiv': 'pixiv',
    'lofter': 'lofter',
    'xianyu': 'xianyu',
    'taobao': 'taobao',
    'qooapp': 'qooapp',
    'epic': 'epic',
    'gamerch': 'gamerch',
    'note_com': 'note_com',
    'ruliweb': 'ruliweb',
    'vkplay': 'vkplay',
    'stopgame': 'stopgame',
    'gacharevenue': 'gacharevenue',
    'miraheze_wiki': 'miraheze_wiki',
    'gamekee': 'gamekee',
    'huiji_wiki': 'huiji_wiki',
    'weixin': 'weixin',
'discord': 'discord',
    'facebook': 'facebook',
    'telegram': 'telegram',
    'twitch': 'twitch',
    'instagram': 'instagram',
    'qq': 'qq',
}


def convert_item(item: dict) -> dict:
    """Convert a report-system item to aggregator format."""
    source = SOURCE_MAP.get(item.get('source', ''), item.get('source', 'unknown'))
    return {
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


def dedup_key(item: dict) -> str:
    """Generate dedup key for an item."""
    url = item.get('url', '').strip()
    if url:
        return url
    return f"{item.get('title', '')[:60]}|{item.get('source', '')}|{item.get('author', '')}"


def run_zero_cost_collectors() -> list[dict]:
    """Run all collectors that don't require API keys."""
    items = []

    try:
        import collector as c
        c._refresh_cutoff()
    except ImportError as e:
        logger.error(f"Cannot import collector module: {e}")
        return items

    # Zero-cost collectors (no API key required)
    zero_cost_fetchers = [
        ('Bilibili', c.fetch_bilibili),
        ('Reddit', c.fetch_reddit),
        ('NGA', c.fetch_nga),
        ('TapTap', c.fetch_taptap),
        ('Weibo', c.fetch_weibo),
        ('Xiaohongshu', c.fetch_xiaohongshu),
        ('Douyin', c.fetch_douyin),
        ('Tieba', c.fetch_tieba),
        ('Zhihu', c.fetch_zhihu),
        ('Naver Cafe', c.fetch_naver_cafe),
        ('5ch', c.fetch_fivech),
        ('App Store', c.fetch_appstore_reviews),
        ('TikTok', c.fetch_tiktok),
        ('Pixiv', c.fetch_pixiv),
        ('Lofter', c.fetch_lofter),
        ('Xianyu', c.fetch_xianyu),
        ('Taobao Merch', c.fetch_taobao_merch),
        ('QooApp', c.fetch_qooapp),
        ('Epic Store', c.fetch_epic_store),
        ('Gamerch Wiki', c.fetch_gamerch),
        ('Note.com', c.fetch_note_com),
        ('Ruliweb', c.fetch_ruliweb),
        ('VK Play', c.fetch_vkplay),
        ('StopGame', c.fetch_stopgame),
        ('GACHAREVENUE', c.fetch_gacharevenue),
        ('Miraheze Wiki', c.fetch_miraheze_wiki),
        ('GameKee', c.fetch_gamekee),
        ('Huiji Wiki', c.fetch_huiji_wiki),
        ('搜狗微信', c.fetch_weixin),
        ('RSSHub', c.fetch_rsshub),
    ]

    # Also run API-key collectors if keys are available
    api_fetchers = [
        ('Twitter/X', c.fetch_twitter),
        ('YouTube', c.fetch_youtube),
        ('Discord API', c.fetch_discord),
        ('Facebook', c.fetch_facebook),
        ('Twitch', c.fetch_twitch),
        ('Instagram', c.fetch_instagram),
        ('QQ', c.fetch_qq),
        ('Telegram', c.fetch_telegram),
        ('Bahamut', c.fetch_bahamut),
        ('DCInside', c.fetch_dcinside),
        ('Arca.live', c.fetch_arca_live),
        ('Google Play', c.fetch_google_play),
    ]

    all_fetchers = zero_cost_fetchers + api_fetchers

    succeeded = []
    failed = []
    empty = []

    for name, fn in all_fetchers:
        try:
            result = fn()
            if result:
                items.extend(result)
                succeeded.append((name, len(result)))
                logger.info(f"  ✓ {name}: +{len(result)} items")
            else:
                empty.append(name)
                logger.info(f"  · {name}: 0 items")
        except Exception as e:
            failed.append((name, str(e)[:120]))
            logger.warning(f"  ✗ {name} FAILED: {e}")

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


def merge_and_dedup(existing: list[dict], new_items: list[dict]) -> list[dict]:
    """Merge and deduplicate items, keeping higher-engagement version."""
    seen: dict[str, dict] = {}

    # Existing items first (they're already validated)
    for item in existing:
        key = dedup_key(item)
        if key not in seen or item.get('engagement', 0) > seen[key].get('engagement', 0):
            seen[key] = item

    # New items (from global collectors)
    for item in new_items:
        converted = convert_item(item)
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
