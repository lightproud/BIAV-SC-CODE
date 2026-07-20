#!/usr/bin/env python3
"""Shared base for the news aggregator: HTTP/logging setup, config
constants, sanitisation, validation and summary helpers.

Extracted from aggregator.py; the per-platform collectors and the run()
orchestrator import from here.
"""

import os
import sys
import time
import logging
import requests
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import news_common  # 采集层共享 HTML-strip 单一真源（ARCH-02）

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# Playwright fallback collectors (imported lazily to avoid startup cost)
_playwright_collectors = None
_playwright_import_attempted = False
_playwright_runtime_available = None  # None=unknown, True/False=cached probe result

def _get_playwright_collectors():
    """Lazy import of playwright collectors to avoid startup cost.

    Also probes whether the actual `playwright` runtime package is installed —
    if not, returns None so callers skip the fallback quietly instead of
    spamming warnings on every source.
    """
    global _playwright_collectors, _playwright_import_attempted, _playwright_runtime_available
    if _playwright_import_attempted:
        return _playwright_collectors
    _playwright_import_attempted = True

    # Probe playwright runtime first — collectors module still imports even
    # without it, but every call would then fail with the same ImportError.
    try:
        import importlib
        importlib.import_module('playwright.sync_api')
        _playwright_runtime_available = True
    except ImportError:
        _playwright_runtime_available = False
        logger.info('playwright runtime not installed, Playwright fallbacks disabled (set up playwright to enable NGA/Weibo/TapTap fallback)')
        _playwright_collectors = None
        return None

    try:
        from scripts import playwright_collectors as pc
        _playwright_collectors = pc
    except ImportError:
        try:
            import playwright_collectors as pc
            _playwright_collectors = pc
        except ImportError:
            logger.warning('playwright_collectors module not found, Playwright fallback disabled')
            _playwright_collectors = None
    return _playwright_collectors

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
OUTPUT_PATH = REPO_ROOT / 'projects' / 'news' / 'output' / 'news.json'
COLLAB_KEYWORDS = os.environ.get('COLLAB_KEYWORDS', '').split(',') if os.environ.get('COLLAB_KEYWORDS') else [
    '沙耶之歌', '沙耶の唄', 'Saya no Uta', 'saya no uta',
]
# Adaptive lookback: expands automatically if CI was down
try:
    from collection_state import get_lookback_hours
    HOURS_LOOKBACK = int(os.environ.get('HOURS_LOOKBACK', 0)) or get_lookback_hours()
except ImportError:
    HOURS_LOOKBACK = int(os.environ.get('HOURS_LOOKBACK', 24))
# 分页采集的安全上限（单个 fetcher 最多拿多少条），防止窗口边界模糊或 API 返回错乱
# 时采到无穷多。默认 500 够 24h 窗口用；环境变量 MAX_ITEMS_PER_FETCHER 可覆盖。
MAX_ITEMS_PER_FETCHER = int(os.environ.get('MAX_ITEMS_PER_FETCHER', 500))

# Bilibili creator MIDs known to produce Morimens content
# Format: mid (int) -> display name (str). Add more as confirmed.
BILIBILI_MORIMENS_CREATORS = {
    545164270: '金发女人丨型',
    3546572535448498: '萨摩_不耶',
    478711700: '莱星Ligh',
    1321878039: '9_9墨玖',
    32726726: 'God7777',
}

# Valid source identifiers — 从 sources.py 单一真相源派生（含 SOURCE_ALIASES 的
# 归一化前原始名，如 steam_review）。此前为私有硬编码白名单，2026-06-21 采集规范
# 新增 taptap_review 分桶后未同步，导致采集到的评论在校验层被整批丢弃
# （2026-07-02 修复：CI 实测单轮 108 条被 "unknown source" 拦截）。
from sources import KNOWN_SOURCES as _KNOWN_SOURCES, SOURCE_ALIASES as _SOURCE_ALIASES
VALID_SOURCES = set(_KNOWN_SOURCES) | set(_SOURCE_ALIASES)

# Required fields for each news item
REQUIRED_FIELDS = {'title', 'source', 'time', 'engagement'}


# ============================================================
# HTTP retry helper
# ============================================================

def _get_with_retry(url, retries=2, backoff=1.0, **kwargs):
    """GET with simple retry on transient failures (5xx, timeout, connection error).

    # NOTE: divergent from global_collectors._get / news_common.get_with_retry — see
    # audit ARCH-01: this returns the response on 4xx (caller inspects status_code),
    # whereas global's _get raise_for_status() on any non-2xx. Semantics differ → not merged.
    """
    kwargs.setdefault('timeout', 15)
    last_exc = None
    for attempt in range(retries + 1):
        try:
            resp = requests.get(url, **kwargs)
            if resp.status_code < 500 or attempt == retries:
                return resp
            last_exc = Exception(f'HTTP {resp.status_code}')
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_exc = e
            if attempt == retries:
                raise
        time.sleep(backoff * (attempt + 1))
    raise last_exc  # unreachable but satisfies type checker

# ============================================================
# Data Validation & Sanitization
# ============================================================

def strip_html_tags(text):
    """Remove any HTML tags from text to prevent XSS. 委托 news_common.strip_html（单一真源）。"""
    return news_common.strip_html(text)


def sanitize_url(url):
    """Validate and normalize URL scheme."""
    if not url:
        return ''
    url = url.strip()
    # Normalize http to https for known platforms
    if url.startswith('http://www.bilibili.com') or url.startswith('http://bilibili.com'):
        url = url.replace('http://', 'https://', 1)
    # Basic URL validation
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https', ''):
        return ''
    return url


def sanitize_summary(summary):
    """Clean up summary text, removing placeholder values."""
    if not summary:
        return ''
    summary = summary.strip()
    # Filter out placeholder/empty summaries
    if summary in ('-', '--', '无', 'N/A', 'null', 'none', '暂无'):
        return ''
    return strip_html_tags(summary)


def validate_news_item(item):
    """
    Validate a single news item. Returns (is_valid, cleaned_item).
    Checks required fields, sanitizes text, normalizes URLs.
    """
    if not isinstance(item, dict):
        return False, None

    # Check required fields
    for field in REQUIRED_FIELDS:
        if field not in item or item[field] is None or (isinstance(item[field], str) and not item[field]):
            logger.warning(f'Validation: missing required field "{field}" in item: {item.get("title", "unknown")[:50]}')
            return False, None

    # Validate source
    if item['source'] not in VALID_SOURCES:
        logger.warning(f'Validation: unknown source "{item["source"]}" for: {item["title"][:50]}')
        return False, None

    # Validate engagement is a non-negative number
    try:
        engagement = int(item['engagement'])
        if engagement < 0:
            engagement = 0
    except (ValueError, TypeError):
        engagement = 0

    # Validate time format (ISO 8601)
    try:
        if isinstance(item['time'], str):
            datetime.fromisoformat(item['time'].replace('Z', '+00:00'))
    except (ValueError, TypeError):
        logger.warning(f'Validation: invalid time format for: {item["title"][:50]}')
        return False, None

    # Build cleaned item
    cleaned = {
        'title': strip_html_tags(str(item['title']).strip()),
        'summary': sanitize_summary(item.get('summary', '')),
        'source': item['source'],
        'time': item['time'],
        'url': sanitize_url(item.get('url', '')),
        'engagement': engagement,
        'is_hot': bool(item.get('is_hot', False)),
        'author': strip_html_tags(str(item.get('author', '')).strip()),
        'tags': [strip_html_tags(str(t).strip()) for t in item.get('tags', []) if t and str(t).strip()],
    }

    # Preserve source-specific extra fields
    if 'language' in item:
        cleaned['language'] = str(item['language'])
    if 'metadata' in item and isinstance(item['metadata'], dict):
        cleaned['metadata'] = item['metadata']
    # Preserve media fields for image archival
    if item.get('media_url'):
        cleaned['media_url'] = sanitize_url(item['media_url'])
        cleaned['content_type'] = item.get('content_type', 'image')
    if item.get('lang'):
        cleaned['lang'] = str(item['lang'])
    # 甲方案归档分层字段（2026-06-21 采集源命名规范）：AC 栈 item 经此白名单重建，
    # 须显式放行 region/archive_subtype，否则 archive_platforms 分桶失据（缺省不落，回落扁平）。
    if item.get('region'):
        cleaned['region'] = str(item['region'])
    if item.get('archive_subtype'):
        cleaned['archive_subtype'] = str(item['archive_subtype'])

    # Title must not be empty after sanitization
    if not cleaned['title']:
        return False, None

    return True, cleaned


def validate_all_news(items):
    """Validate and clean a list of news items. Returns list of valid items.

    被丢弃条目按源计数进 VALIDATION_DROPS（2026-07-02 P0-3「静默丢弃升格为
    一等指标」）：此前丢弃只打 WARNING 进 CI 日志，taptap_review 曾单轮被
    丢 108 条、连续 12 天无人察觉。计数经 write_validation_drops 落盘，由
    silent_sources_audit 并入 source-health 并参与 --strict 告警门控。
    """
    valid_items = []
    invalid_count = 0

    for item in items:
        is_valid, cleaned = validate_news_item(item)
        if is_valid:
            valid_items.append(cleaned)
        else:
            invalid_count += 1
            src = item.get('source', 'unknown') if isinstance(item, dict) else 'malformed'
            VALIDATION_DROPS[src] = VALIDATION_DROPS.get(src, 0) + 1

    if invalid_count > 0:
        logger.warning(f'Validation: {invalid_count} invalid items filtered out of {len(items)} total')

    logger.info(f'Validation: {len(valid_items)} valid items out of {len(items)} total')
    return valid_items


# 本次运行的校验丢弃计数（源 -> 条数）。跨源累计，run 结束由 aggregator 落盘。
VALIDATION_DROPS: dict = {}
VALIDATION_DROPS_PATH = (Path(__file__).resolve().parent.parent / 'output'
                         / 'validation-drops.json')


def write_validation_drops(path=None):
    """把本次运行的校验丢弃计数写盘（无丢弃也写零值文件，供健康侧稳定消费）。"""
    import json as _json
    path = Path(path) if path else VALIDATION_DROPS_PATH
    payload = {
        'generated_at': datetime.now().astimezone().isoformat(),
        'total_dropped': sum(VALIDATION_DROPS.values()),
        'by_source': dict(sorted(VALIDATION_DROPS.items())),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    return payload

def generate_summary(news_items):
    """
    Generate a daily summary. Uses OpenAI-compatible API if available,
    otherwise falls back to a simple extractive summary.
    """
    api_key = os.environ.get('LLM_API_KEY')
    api_url = os.environ.get('LLM_API_URL', 'https://api.anthropic.com/v1/messages')

    if not api_key or not news_items:
        # Fallback: simple extractive summary
        hot = [n for n in news_items if n.get('is_hot')]
        if not hot:
            hot = news_items[:5]
        titles = '；'.join(n['title'][:30] for n in hot[:5])
        return f"今日热门话题：{titles}。"

    # Use LLM for better summary

    titles_text = '\n'.join(f"- [{n['source']}] {n['title']}" for n in news_items[:20])
    prompt = f"""以下是忘却前夜(Morimens)游戏社区24小时内的热点话题列表，请用中文生成一段简洁的今日总结(100-150字)，
突出最重要的2-3个话题，使用<span class='highlight'>标签</span>标记关键词：

{titles_text}"""

    try:
        resp = requests.post(
            api_url,
            headers={
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
            },
            json={
                'model': 'claude-haiku-4-5-20251001',
                'max_tokens': 300,
                'messages': [{'role': 'user', 'content': prompt}],
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()['content'][0]['text']
    except Exception as e:
        logger.warning(f'LLM summary failed: {e}, using fallback')
        hot = [n for n in news_items if n.get('is_hot')][:5]
        titles = '；'.join(n['title'][:30] for n in hot)
        return f"今日热门话题：{titles}。"


def _get_quality_tracker():
    """Lazy import of data quality tracker to avoid startup overhead."""
    try:
        from scripts.data_quality import SilentPlatformTracker
        return SilentPlatformTracker()
    except ImportError:
        return None

