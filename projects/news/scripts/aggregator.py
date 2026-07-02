#!/usr/bin/env python3
"""
忘却前夜 Morimens - 社区热点聚合器
从各社区平台抓取24小时内的热门话题并生成 projects/news/output/news.json

数据源:
  - Reddit (r/Morimens)
  - Twitter/X (@MorimensGlobal, 相关hashtag)
  - Bilibili (忘却前夜相关)
  - TapTap (忘却前夜社区)
  - Discord (官方服务器摘要)
  - YouTube (官方频道及热门视频)

使用方式:
  1. 安装依赖: pip install -r requirements.txt
  2. 配置环境变量 (见 .env.example)
  3. 运行: python scripts/aggregator.py
  4. 输出: projects/news/output/news.json
"""

import sys
from datetime import datetime, timezone

from aggregator_base import (
    OUTPUT_PATH, _get_playwright_collectors,
    _get_quality_tracker, generate_summary, logger, validate_all_news,
)
from aggregator_collectors import (
    fetch_bilibili, fetch_discord_local, fetch_reddit,
    fetch_steam_discussions, fetch_steam_news, fetch_steam_reviews,
    fetch_taptap,
)
# NOTE: ARCH-01 收敛（decisions.md 2026-06-20）：youtube 唯一权威实现归 GC 栈
# （collect_global 的官方 googleapis API）。原 AC fetch_youtube 抓取实现已随
# 死代码清理移除（守密人 2026-07-02 裁定，覆盖原「保留休眠」决定）。
import news_common  # 哨兵文件摘要脱敏（H3）
from sources import R1_HARD_FAIL_SOURCES  # §4.2 R1 硬失败源（单一真相源，sources.py）

# H9: 失败哨兵文件。aggregator 直接 SystemExit(1) 会让 update-news.yml 跳过后续
# collect_global/split/archive/commit 步骤，成功源数据随 runner 销毁丢失。改为：
# 失败时写哨兵 + 以 0 退出，workflow 末尾独立步骤检测哨兵再标红（失败仍在 CI 可见）。
# 路径在 output/ 之外，避免被 `git add projects/news/output/` 提交进仓库。
FAILURE_FLAG = OUTPUT_PATH.parent.parent / 'aggregator-failure.flag'


def _flag_failure(summary: str):
    """记录失败摘要到哨兵文件（脱敏后写入），由 CI 末尾步骤检测并标红。"""
    redacted = news_common.redact_secrets(summary)
    FAILURE_FLAG.write_text(redacted + '\n', encoding='utf-8')
    logger.error(f'Failure recorded to {FAILURE_FLAG.name}: {redacted}')


def run():
    """Main aggregation pipeline."""
    logger.info('Starting Morimens community news aggregation...')
    FAILURE_FLAG.unlink(missing_ok=True)  # 清掉上次运行残留的哨兵

    all_news = []
    core_failures = []  # (source_id, error) for core sources that raised

    # Fetch from all sources
    fetchers = [
        ('Reddit', fetch_reddit),
        ('Bilibili', fetch_bilibili),
        ('TapTap', fetch_taptap),
        ('SteamReviews', fetch_steam_reviews),
        ('SteamNews', fetch_steam_news),
        ('SteamDiscussions', fetch_steam_discussions),
        ('DiscordLocal', fetch_discord_local),
    ]  # YouTube 归 GC 栈（ARCH-01 收敛）

    # Initialize quality tracker for platform health monitoring
    quality_tracker = _get_quality_tracker()

    for name, fetcher in fetchers:
        # Map display name to source identifier
        source_id = name.lower().replace('steamreviews', 'steam_review').replace('steamnews', 'steam').replace('steamdiscussions', 'steam_discussion').replace('discordlocal', 'discord')

        # Check if platform is dormant (skip to save resources)
        if quality_tracker and quality_tracker.should_skip_platform(source_id):
            logger.info(f'{name}: skipping dormant platform')
            continue

        try:
            items = fetcher()
            all_news.extend(items)
            logger.info(f'{name}: {len(items)} items')

            # Track platform status
            if quality_tracker:
                quality_tracker.update_platform_status(source_id, len(items))

            # Playwright fallback for specific sources when API returns empty or fails
            if name == 'TapTap' and len(items) == 0:
                pc = _get_playwright_collectors()
                if pc:
                    pw_fetcher = {
                        'TapTap': pc.fetch_taptap_playwright,
                    }.get(name)
                    if pw_fetcher:
                        try:
                            pw_items = pw_fetcher()
                            all_news.extend(pw_items)
                            logger.info(f'{name} Playwright fallback: {len(pw_items)} items')
                        except Exception as e:
                            logger.warning(f'{name} Playwright fallback failed: {e}')

        except Exception as e:
            logger.error(f'{name} fetcher crashed: {e}')

            # Track platform error
            if quality_tracker:
                quality_tracker.update_platform_status(source_id, 0, error=str(e))
            recovered = False
            # Try Playwright fallback for TapTap on crash
            if name == 'TapTap':
                pc = _get_playwright_collectors()
                if pc:
                    pw_fetcher = {
                        'TapTap': pc.fetch_taptap_playwright,
                    }.get(name)
                    if pw_fetcher:
                        try:
                            pw_items = pw_fetcher()
                            all_news.extend(pw_items)
                            logger.info(f'{name} Playwright fallback (after crash): {len(pw_items)} items')
                            # §4.2 R1: 仅当回退实际拿到条目才算救回；返回 0 条不掩盖核心源失败
                            if pw_items:
                                recovered = True
                        except Exception as pw_e:
                            logger.warning(f'{name} Playwright fallback failed: {pw_e}')
            # §4.2 R1: 核心源崩溃且未被 fallback 救回 → 记为整次失败
            if source_id in R1_HARD_FAIL_SOURCES and not recovered:
                core_failures.append((source_id, str(e)))

    # Additional Playwright-only sources (no API equivalent)
    pc = _get_playwright_collectors()
    if pc:
        pw_sources = [
            ('Weibo', pc.fetch_weibo_playwright),
        ]
        for name, pw_fetcher in pw_sources:
            try:
                pw_items = pw_fetcher()
                all_news.extend(pw_items)
                logger.info(f'{name} Playwright: {len(pw_items)} items')
            except Exception as e:
                logger.warning(f'{name} Playwright failed: {e}')

    # Validate and sanitize all items
    all_news = validate_all_news(all_news)

    # ── 补齐 lang / platform_region（aggregator 早期未设这两个字段）──
    _SOURCE_META = {
        'reddit':           ('en', 'global'),
        'bilibili':         ('zh', 'cn'),
        'taptap':           ('zh', 'cn'),
        'steam_review':     ('',   'global'),   # lang from review.language
        'steam':            ('',   'global'),
        'official':         ('en', 'global'),
        'steam_discussion': ('en', 'global'),
        'youtube':          ('',   'global'),
        'discord':          ('',   'global'),
        'weibo':            ('zh', 'cn'),
    }
    for item in all_news:
        src = item.get('source', '')
        default_lang, default_region = _SOURCE_META.get(src, ('', 'global'))
        if not item.get('lang'):
            item['lang'] = default_lang
        if not item.get('platform_region'):
            item['platform_region'] = default_region

    # Deduplicate by URL (normalized) + title similarity
    seen_keys = set()
    unique_news = []
    for item in all_news:
        # Normalize URL for dedup (http→https, trailing slash)
        url = (item.get('url') or '').replace('http://', 'https://').rstrip('/')
        title_key = item['title'].lower().strip()[:50]
        dedup_key = url if url else title_key
        if dedup_key not in seen_keys:
            seen_keys.add(dedup_key)
            # Also add title key to catch same content with different URLs
            seen_keys.add(title_key)
            unique_news.append(item)

    # Sort by engagement
    unique_news.sort(key=lambda x: x.get('engagement', 0), reverse=True)

    # Mark top items as hot (only if engagement meets minimum threshold)
    HOT_MIN_ENGAGEMENT = 50
    for item in unique_news[:5]:
        if item.get('engagement', 0) >= HOT_MIN_ENGAGEMENT:
            item['is_hot'] = True

    # Empty data protection: if no items fetched, preserve existing data
    if not unique_news:
        logger.warning('All sources returned empty results. Preserving existing news.json to avoid blank frontend.')
        if OUTPUT_PATH.exists():
            logger.info(f'Existing news.json kept intact ({OUTPUT_PATH.stat().st_size} bytes).')
        else:
            logger.warning('No existing news.json found and no new data — writing empty placeholder.')
            output = {
                'updated_at': datetime.now(timezone.utc).isoformat(),
                'summary': '暂无最新动态。',
                'news': [],
            }
            news_common.dump_json_atomic(OUTPUT_PATH, output)
        # Signal failure so CI surfaces the empty run (lesson #2). Existing data
        # is preserved above; the sentinel file lets the workflow alert at the
        # end without skipping the remaining collection/archive steps (H9).
        _flag_failure('All sources returned empty results (existing news.json preserved).')
        return False

    # Generate summary
    summary = generate_summary(unique_news)

    # Write output
    output = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'summary': summary,
        'news': unique_news,
    }

    news_common.dump_json_atomic(OUTPUT_PATH, output)

    logger.info(f'Done! {len(unique_news)} items written to {OUTPUT_PATH}')

    # Record successful run for adaptive lookback
    try:
        from collection_state import mark_collection_done
        mark_collection_done(item_count=len(unique_news))
    except ImportError:
        pass

    # §4.2 R1: 输出已落盘保全数据；任一核心源失败写哨兵，由 workflow 末尾标红（H9），
    # 不再非零退出（那会跳过后续 collect_global/split/archive/commit，丢掉成功源数据）。
    if core_failures:
        names = ', '.join(f'{s} ({err})' for s, err in core_failures)
        _flag_failure(f'Core source(s) failed per §4.2 R1: {names}')
        return False

    return True


if __name__ == '__main__':
    run()
    # ARCH-01 统一入口（goal 2026-06-20「合并所有采集器功能到 AC」）：全球平台采集 +
    # 最终合并 / 全量层（news-raw）亦在本入口完成，collect_global 降为被调库，不再单独
    # 作为 workflow 步骤（否则会与本链路重复采集）。run() 已把 AC 项写入 news.json；
    # collect_global.main() 读其为 existing、并入 GC 平台项、产出最终 news.json + news-raw.json。
    try:
        import collect_global
        collect_global.main()
    except SystemExit as exc:
        # collect_global.main() 在全球采集器全空时 sys.exit(1)（lesson #2 空数据保护）。
        # AC 输出已落盘保全，沿用非阻断语义（workflow continue-on-error + 哨兵兜底）。
        if exc.code:
            logger.warning(
                f'global collectors signaled empty/failure (exit {exc.code}); '
                'AC output preserved, pipeline continues'
            )
    except Exception as exc:
        logger.error(f'global collectors phase failed: {exc}; AC output preserved')
    # P0-3（2026-07-02）：本次运行的校验丢弃计数落盘（零丢弃也写零值文件），
    # 由 silent_sources_audit --write 并入 source-health、--strict 参与告警门控。
    # 放在全链路末尾：AC 与 collect_global 两侧的丢弃都已累计完毕。
    try:
        from aggregator_base import write_validation_drops
        payload = write_validation_drops()
        if payload['total_dropped']:
            logger.warning(f"Validation drops this run: {payload['by_source']}")
    except Exception as exc:
        logger.error(f'failed to write validation-drops.json: {exc}')
    sys.exit(0)
