#!/usr/bin/env python3
"""
统一采集入口 — Unified Collection Entry Point

整合两套采集系统：
1. aggregator.py — 生产管线（11源，GitHub Actions 自动运行）
2. report-system/collector.py — 扩展采集（29源，按需运行）

使用方式：
    # 运行生产管线（快速，推荐日常使用）
    python scripts/collect.py --production

    # 运行扩展采集（完整，推荐周报/月报）
    python scripts/collect.py --extended

    # 运行全部
    python scripts/collect.py --all

    # 指定数据源
    python scripts/collect.py --sources bilibili,reddit,weibo
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
OUTPUT_DIR = REPO_ROOT / 'projects' / 'news' / 'output'

# 生产管线数据源（aggregator.py）
PRODUCTION_SOURCES = {
    'reddit', 'bilibili', 'twitter', 'taptap', 'nga',
    'steam_review', 'steam_news', 'steam_discussion',
    'youtube', 'fandom_wiki', 'discord',
    'xiaohongshu', 'weibo',  # Playwright
}

# 扩展采集数据源（report-system/collector.py）
EXTENDED_SOURCES = {
    'douyin', 'tieba', 'zhihu', 'bahamut',
    'pixiv', 'lofter', 'xianyu', 'taobao',
    'facebook', 'tiktok', 'telegram', 'twitch', 'instagram',
    'naver_cafe', 'dcinside', 'arca_live', '5ch',
    'app_store', 'google_play', 'qooapp', 'epic',
}


def run_production():
    """运行生产管线（aggregator.py）。"""
    logger.info("运行生产管线...")
    sys.path.insert(0, str(REPO_ROOT / 'projects' / 'news' / 'scripts'))

    from aggregator import run as run_aggregator
    run_aggregator()

    logger.info("生产管线完成")


def run_extended():
    """运行扩展采集（report-system/collector.py）。"""
    logger.info("运行扩展采集...")
    collector_path = REPO_ROOT / 'projects' / 'news' / 'report-system' / 'scripts'

    if not collector_path.exists():
        logger.warning("report-system 目录不存在，跳过扩展采集")
        return

    sys.path.insert(0, str(collector_path))

    try:
        from collector import collect_all
        result = collect_all()

        # 合并到主输出
        output_path = OUTPUT_DIR / 'extended-latest.json'
        output = {
            'collected_at': datetime.now(timezone.utc).isoformat(),
            'source': 'extended',
            'item_count': len(result),
            'items': result,
        }
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        logger.info(f"扩展采集完成: {len(result)} items -> {output_path}")

    except ImportError as e:
        logger.warning(f"无法导入 collector: {e}")
    except Exception as e:
        logger.error(f"扩展采集失败: {e}")


def run_all():
    """运行全部采集。"""
    run_production()
    run_extended()


def run_sources(sources: list):
    """运行指定数据源。"""
    production = []
    extended = []

    for s in sources:
        if s in PRODUCTION_SOURCES:
            production.append(s)
        elif s in EXTENDED_SOURCES:
            extended.append(s)
        else:
            logger.warning(f"未知数据源: {s}")

    if production:
        logger.info(f"运行生产数据源: {production}")
        # TODO: 实现选择性运行
        run_production()

    if extended:
        logger.info(f"运行扩展数据源: {extended}")
        # TODO: 实现选择性运行
        run_extended()


def main():
    parser = argparse.ArgumentParser(description='统一采集入口')
    parser.add_argument('--production', action='store_true',
                        help='运行生产管线（快速）')
    parser.add_argument('--extended', action='store_true',
                        help='运行扩展采集（完整）')
    parser.add_argument('--all', action='store_true',
                        help='运行全部')
    parser.add_argument('--sources', type=str,
                        help='指定数据源，逗号分隔')
    parser.add_argument('--list', action='store_true',
                        help='列出所有可用数据源')

    args = parser.parse_args()

    if args.list:
        print("生产数据源:")
        for s in sorted(PRODUCTION_SOURCES):
            print(f"  - {s}")
        print("\n扩展数据源:")
        for s in sorted(EXTENDED_SOURCES):
            print(f"  - {s}")
        return

    if args.sources:
        sources = [s.strip() for s in args.sources.split(',')]
        run_sources(sources)
    elif args.all:
        run_all()
    elif args.extended:
        run_extended()
    else:
        # 默认运行生产管线
        run_production()


if __name__ == '__main__':
    main()
