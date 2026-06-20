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
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
OUTPUT_PATH = _REPO_ROOT / 'projects' / 'news' / 'output' / 'news.json'
RAW_OUTPUT_PATH = _REPO_ROOT / 'projects' / 'news' / 'output' / 'news-raw.json'

# Ensure sibling scripts dir is importable (works both as script and module)
sys.path.insert(0, str(Path(__file__).resolve().parent))


# 核心源 + 需 secret 的源元数据统一取自 sources.py（单一真相源，杜绝硬编码漂移）。
# 核心源失败（含静默吐 0）须以非零退出暴露（§4.2 R1：任一核心源失败即整次失败）。
from sources import CORE_SOURCES, AUTH_GATED
import news_common  # 原子写单一真源（dump_json_atomic）


# ── Source mapping: collector source names → aggregator source names ──
SOURCE_MAP = {
    'bilibili': 'bilibili',
    'reddit': 'reddit',
    'youtube': 'youtube',
    'taptap': 'taptap',
    'steam': 'steam_review',
    'weibo': 'weibo',
    'bahamut': 'bahamut',
    'arca_live': 'arca_live',
    'appstore': 'appstore',
    'google_play': 'google_play',
    'pixiv': 'pixiv',
    'note_com': 'note_com',
    'ruliweb': 'ruliweb',
    'stopgame': 'stopgame',
    'weixin': 'weixin',
    'discord': 'discord',
    'twitter': 'twitter',
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
    url = (item.get('url', '') or '').replace('http://', 'https://').strip().rstrip('/')
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
        return items, []

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
        'Ruliweb':     'fetch_ruliweb_playwright',
        'Bahamut':     'fetch_bahamut_playwright',
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
        ('TapTap', c.fetch_taptap),
        ('Weibo', c.fetch_weibo),
        ('App Store', c.fetch_appstore_reviews),
        ('Pixiv', c.fetch_pixiv),
        ('Note.com', c.fetch_note_com),
        ('Ruliweb', c.fetch_ruliweb),
        ('StopGame', c.fetch_stopgame),
        ('搜狗微信', c.fetch_weixin),
        ('Twitter', c.fetch_twitter),
    ]

    # Collectors that may use API keys when available, fall back to public endpoints otherwise
    api_fetchers = [
        ('YouTube', c.fetch_youtube),
        ('Discord API', c.fetch_discord),
        ('Bahamut', c.fetch_bahamut),
        ('Arca.live', c.fetch_arca_live),
        ('Google Play', c.fetch_google_play),
    ]

    all_fetchers = zero_cost_fetchers + api_fetchers

    # 显示名 → source_id（与 archive/split 对齐）
    NAME_TO_SOURCE_ID = {
        'Bilibili': 'bilibili', 'Reddit': 'reddit', 'TapTap': 'taptap',
        'Weibo': 'weibo', 'App Store': 'appstore',
        'Pixiv': 'pixiv', 'Note.com': 'note_com', 'Ruliweb': 'ruliweb',
        'StopGame': 'stopgame', '搜狗微信': 'weixin', 'Twitter': 'twitter',
        'YouTube': 'youtube', 'Discord API': 'discord',
        'Bahamut': 'bahamut',
        'Arca.live': 'arca_live', 'Google Play': 'google_play',
    }

    # 各采集器互相独立、采集前无共享状态 → 用线程并行（阻塞 requests 用线程即可）。
    # 每个 worker 只返回自身结果，不触碰共享 items；合并在主线程按 all_fetchers 顺序进行，
    # 保证去重/排序结果与串行一致（PERF-02）。
    def _collect_one(name, fn):
        """Run one collector (with Playwright fallback). Returns (name, source_id, result, error)."""
        source_id = NAME_TO_SOURCE_ID.get(name, name.lower())
        try:
            result = fn()
            # Playwright fallback: if HTTP returned 0/empty and we have a PW fallback
            if not result and name in PW_FALLBACK and PW_FALLBACK[name] and pw_mod:
                pw_fn = getattr(pw_mod, PW_FALLBACK[name], None)
                if pw_fn:
                    logger.info(f"  ↻ {name}: HTTP empty, trying Playwright fallback...")
                    result = pw_fn()
            return name, source_id, (result or []), None
        except Exception as e:
            # Playwright fallback on exception too
            if name in PW_FALLBACK and PW_FALLBACK[name] and pw_mod:
                pw_fn = getattr(pw_mod, PW_FALLBACK[name], None)
                if pw_fn:
                    logger.info(f"  ↻ {name}: HTTP crashed, trying Playwright fallback...")
                    try:
                        result = pw_fn()
                        if result:
                            logger.info(f"  {name} (PW): recovered via Playwright")
                            return name, source_id, result, None
                    except Exception as pw_e:
                        logger.warning(f"  {name} Playwright also failed: {pw_e}")
            return name, source_id, [], str(e)

    # 提交所有非 dormant 采集器到线程池
    pending = []
    for name, fn in all_fetchers:
        source_id = NAME_TO_SOURCE_ID.get(name, name.lower())
        if tracker and tracker.should_skip_platform(source_id):
            logger.info(f"   {name}: dormant, skipping")
            continue
        pending.append((name, fn))

    results_by_name = {}
    with ThreadPoolExecutor(max_workers=min(8, len(pending) or 1)) as ex:
        future_to_name = {ex.submit(_collect_one, name, fn): name for name, fn in pending}
        for fut in future_to_name:
            name, source_id, result, error = fut.result()
            results_by_name[name] = (source_id, result, error)

    # 按 all_fetchers 稳定顺序合并，保持结果确定性
    succeeded = []
    failed = []
    empty = []
    core_failures = []
    for name, _ in all_fetchers:
        if name not in results_by_name:
            continue
        source_id, result, error = results_by_name[name]
        if error is not None:
            failed.append((name, error[:120]))
            logger.warning(f"  {name} FAILED: {error}")
            if tracker:
                tracker.update_platform_status(source_id, 0, error=error)
            # §4.2 R1: 核心源失败即整次失败
            if source_id in CORE_SOURCES:
                core_failures.append((source_id, error))
            continue
        if result:
            items.extend(result)
            succeeded.append((name, len(result)))
            logger.info(f"  {name}: +{len(result)} items")
            if tracker:
                tracker.update_platform_status(source_id, len(result))
        else:
            empty.append(name)
            gate_env = AUTH_GATED.get(source_id)
            if gate_env and not os.environ.get(gate_env):
                # 优雅降级：需 cookie/key 的源未配置 secret → 预期 0 产出，标注待配，不计采集故障
                logger.info(f"  · {name}: 0 items (待配 {gate_env}，已降级)")
                if tracker:
                    tracker.update_platform_status(source_id, 0, note=f"待配 {gate_env}")
            else:
                # 核心源静默吐 0：从 INFO 提升为 WARNING，不再悄悄溜过（§4.2 R1 告警）。
                # 不做硬失败：部分核心源（如 taptap）本就低频，0 产出不应阻断管线；
                # 持久信号交由健康层按 consecutive_silent_days 自动 degraded/dormant。
                # 硬失败（非零退出）仍只保留给抛异常的核心源（见 core_failures 主路径）。
                if source_id in CORE_SOURCES:
                    logger.warning(f"  {name}: CORE source 0 items — 已告警，健康层据连续沉默天数降级 (§4.2 R1)")
                else:
                    logger.info(f"  · {name}: 0 items")
                if tracker:
                    tracker.update_platform_status(source_id, 0)

    # Diagnostic summary
    logger.info("=== 采集诊断 ===")
    logger.info(f"成功 ({len(succeeded)}): {', '.join(f'{n}({c})' for n, c in succeeded)}")
    if empty:
        logger.info(f"空结果 ({len(empty)}): {', '.join(empty)}")
    if failed:
        logger.warning(f"失败 ({len(failed)}):")
        for name, err in failed:
            logger.warning(f"  {name}: {err}")

    return items, core_failures


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

# 稀疏源使用更宽时间窗口（SPARSE_SOURCES 来自 sources.py 单一真相源）
SPARSE_MAX_AGE_HOURS = int(os.environ.get('SPARSE_MAX_AGE_HOURS', 30 * 24))
from sources import SPARSE_SOURCES


def _is_recent(time_str: str, source: str = '') -> bool:
    """Check if a timestamp is within (source-specific) max_hours of now."""
    if not time_str:
        return False
    max_hours = SPARSE_MAX_AGE_HOURS if source in SPARSE_SOURCES else MAX_AGE_HOURS
    try:
        dt = datetime.fromisoformat(time_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt) < timedelta(hours=max_hours)
    except (ValueError, TypeError):
        return False


def merge_and_dedup(existing: list[dict], new_items: list[dict],
                    apply_recency_filter: bool = True) -> list[dict]:
    """Merge and deduplicate items, keeping higher-engagement version.
    Filters out items older than per-source max_age (sparse sources use 30d,
    others 24h). Pass apply_recency_filter=False to keep the full unfiltered
    set (用于 news-raw.json 全量归档源)。"""
    seen: dict[str, dict] = {}

    # Existing items first (they're already validated)
    for item in existing:
        if apply_recency_filter and not _is_recent(item.get('time', ''), item.get('source', '')):
            continue
        key = dedup_key(item)
        if key not in seen or item.get('engagement', 0) > seen[key].get('engagement', 0):
            seen[key] = item

    # New items (from global collectors)
    for item in new_items:
        converted = convert_item(item)
        if apply_recency_filter and not _is_recent(converted.get('time', ''), converted.get('source', '')):
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
    global_items, core_failures = run_zero_cost_collectors()
    logger.info(f'全球采集完成: {len(global_items)} items')

    # Empty-data protection (lesson #2): all collectors empty means a failed run.
    # Never rewrite news.json on a blank run; exit non-zero so the workflow signals failure.
    if not global_items:
        logger.error('全部采集器返回空，疑似全线失败；保留 news.json 原样，非零退出。')
        sys.exit(1)

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

    news_common.dump_json_atomic(OUTPUT_PATH, output)

    # 全量归档源：未经时窗过滤的合并集，供 archive_platforms 落档（真·全量层）。
    # news.json 仍是滚动窗口快照（保持有界），raw 只多保留被时窗砍掉的新鲜条目。
    raw_merged = merge_and_dedup(existing, global_items, apply_recency_filter=False)
    news_common.dump_json_atomic(RAW_OUTPUT_PATH, {
        'updated_at': output['updated_at'],
        'source': 'news-raw',
        'news': raw_merged,
    })
    logger.info(f'全量层写入: {len(raw_merged)} items → {RAW_OUTPUT_PATH.name}')

    # Stats
    sources = {}
    for item in merged:
        src = item.get('source', 'unknown')
        sources[src] = sources.get(src, 0) + 1

    logger.info('=== 数据源统计 ===')
    for src, count in sorted(sources.items(), key=lambda x: -x[1]):
        logger.info(f'  {src}: {count}')
    logger.info(f'=== 全球采集完成: {len(merged)} items → {OUTPUT_PATH} ===')

    # §4.2 R1: 输出已落盘保全数据，但任一核心源失败则以非零退出让 CI 暴露失败
    if core_failures:
        names = ', '.join(f'{s} ({err[:80]})' for s, err in core_failures)
        logger.error(f'Core source(s) failed: {names}. Surfacing non-zero exit per §4.2 R1.')
        sys.exit(1)


if __name__ == '__main__':
    main()
