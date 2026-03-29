#!/usr/bin/env python3
"""
忘却前夜 Morimens - 社区热点聚合器
从各社区平台抓取24小时内的热门话题并生成 data/news.json

数据源:
  - Reddit (r/Morimens)
  - Twitter/X (@MorimensGlobal, 相关hashtag)
  - Bilibili (忘却前夜相关)
  - TapTap (忘却前夜社区)
  - NGA (忘却前夜版块)
  - Discord (官方服务器摘要)
  - YouTube (官方频道及热门视频)

使用方式:
  1. 安装依赖: pip install -r requirements.txt
  2. 配置环境变量 (见 .env.example)
  3. 运行: python scripts/aggregator.py
  4. 输出: data/news.json
"""

import json
import os
import re
import time
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# Data lives in repo root assets/data/ (shared across projects)
_REPO_ROOT = Path(__file__).parent.parent.parent.parent
_DATA_DIR = _REPO_ROOT / 'assets' / 'data'
OUTPUT_PATH = _DATA_DIR / 'news.json'
SEARCH_KEYWORDS = ['忘却前夜', '忘卻前夜', 'Morimens', 'morimens']
HOURS_LOOKBACK = 24

# Valid source identifiers
VALID_SOURCES = {'reddit', 'bilibili', 'twitter', 'taptap', 'nga', 'discord', 'youtube', 'official'}

# Required fields for each news item
REQUIRED_FIELDS = {'title', 'source', 'time', 'engagement'}


# ============================================================
# Data Validation & Sanitization
# ============================================================

def strip_html_tags(text):
    """Remove any HTML tags from text to prevent XSS."""
    if not text:
        return ''
    return re.sub(r'<[^>]+>', '', text)


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
        if field not in item or not item[field]:
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
    # Preserve engagement_detail if present
    if isinstance(item.get('engagement_detail'), dict):
        cleaned['engagement_detail'] = item['engagement_detail']

    # Title must not be empty after sanitization
    if not cleaned['title']:
        return False, None

    return True, cleaned


def validate_all_news(items):
    """Validate and clean a list of news items. Returns list of valid items."""
    valid_items = []
    invalid_count = 0

    for item in items:
        is_valid, cleaned = validate_news_item(item)
        if is_valid:
            valid_items.append(cleaned)
        else:
            invalid_count += 1

    if invalid_count > 0:
        logger.warning(f'Validation: {invalid_count} invalid items filtered out of {len(items)} total')

    logger.info(f'Validation: {len(valid_items)} valid items out of {len(items)} total')
    return valid_items


# Tag keyword mapping: if title/summary contains key, add tag
TAG_KEYWORDS = {
    '攻略': ['攻略', '教程', '指南', 'guide', 'tutorial'],
    '配队': ['配队', '阵容', '队伍', 'team comp'],
    '深渊': ['深渊', 'abyss'],
    '融灾': ['融灾'],
    '相位': ['相位', 'phase'],
    '抽卡': ['抽卡', '十连', 'gacha', 'pull', 'banner', 'wish'],
    '新角色': ['新角色', 'new character', 'leak', '泄露', '爆料'],
    '剧情': ['剧情', '主线', 'story', 'lore', '故事'],
    '联动': ['联动', 'collab', 'collaboration', 'crossover'],
    '活动': ['活动', 'event', '福利', '奖励'],
    '版本更新': ['版本', '更新', 'update', 'patch'],
    '同人': ['同人', '二创', 'fanart', 'cosplay', 'fan art'],
    '数据挖掘': ['datamin', '挖掘', 'leak'],
    'PVP': ['pvp', '竞技', 'arena'],
    'OST': ['ost', '音乐', 'soundtrack', 'music', 'bgm'],
    '评测': ['评测', '测评', 'review', '节奏榜', 'tier list'],
    '直播': ['直播', 'stream', 'live'],
    '赛事': ['赛事', '比赛', '杯', 'tournament'],
}


def auto_tag(item):
    """Enrich item tags based on title/summary keyword matching."""
    existing = set(t.lower() for t in item.get('tags', []))
    text = (item.get('title', '') + ' ' + item.get('summary', '')).lower()
    new_tags = list(item.get('tags', []))

    for tag, keywords in TAG_KEYWORDS.items():
        if tag.lower() in existing:
            continue
        for kw in keywords:
            if kw.lower() in text:
                new_tags.append(tag)
                break

    # Limit to 5 tags
    item['tags'] = new_tags[:5]
    return item


def normalize_title(title):
    """Normalize a title for deduplication comparison."""
    t = title.lower().strip()
    # Remove common brackets and their contents like【】[]「」
    t = re.sub(r'[【\[「（(][^】\]」）)]*[】\]」）)]', '', t)
    # Remove punctuation and whitespace
    t = re.sub(r'[\s\-_·:：|｜,.，。!！?？…]+', '', t)
    return t


def title_similarity(a, b):
    """Simple character-level similarity ratio between two strings."""
    if not a or not b:
        return 0.0
    # Use length of common characters / max length
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if len(longer) == 0:
        return 1.0
    # Count common characters (order-independent, bag-of-chars)
    from collections import Counter
    ca, cb = Counter(shorter), Counter(longer)
    common = sum((ca & cb).values())
    return common / len(longer)


def deduplicate_news(items, similarity_threshold=0.75):
    """Deduplicate news items using normalized title similarity.
    When duplicates are found, keep the one with higher engagement."""
    unique = []
    norm_titles = []

    for item in items:
        norm = normalize_title(item['title'])
        is_dup = False
        for i, existing_norm in enumerate(norm_titles):
            # Exact normalized match or high similarity
            if norm == existing_norm or (len(norm) > 5 and title_similarity(norm, existing_norm) > similarity_threshold):
                # Keep higher engagement version
                if item.get('engagement', 0) > unique[i].get('engagement', 0):
                    unique[i] = item
                    norm_titles[i] = norm
                is_dup = True
                break
        if not is_dup:
            unique.append(item)
            norm_titles.append(norm)

    logger.info(f'Deduplication: {len(unique)} unique items from {len(items)} total')
    return unique


# ============================================================
# HTTP Helpers
# ============================================================

def request_with_retry(method, url, max_retries=3, backoff_base=2, **kwargs):
    """Make an HTTP request with exponential backoff retry on transient failures."""
    import requests

    kwargs.setdefault('timeout', 15)
    last_exc = None

    for attempt in range(max_retries + 1):
        try:
            resp = requests.request(method, url, **kwargs)
            resp.raise_for_status()
            return resp
        except requests.exceptions.ConnectionError as e:
            last_exc = e
            logger.warning(f'Connection error (attempt {attempt + 1}/{max_retries + 1}): {e}')
        except requests.exceptions.Timeout as e:
            last_exc = e
            logger.warning(f'Timeout (attempt {attempt + 1}/{max_retries + 1}): {e}')
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response is not None else 0
            if status in (429, 500, 502, 503, 504):
                last_exc = e
                logger.warning(f'HTTP {status} (attempt {attempt + 1}/{max_retries + 1}): {e}')
            else:
                raise
        except requests.exceptions.RequestException:
            raise

        if attempt < max_retries:
            wait = backoff_base ** attempt
            logger.info(f'Retrying in {wait}s...')
            time.sleep(wait)

    raise last_exc


# ============================================================
# Source Fetchers - each returns a list of news item dicts
# ============================================================

def fetch_reddit(subreddits=None):
    """Fetch posts from Reddit: hot/new/rising per subreddit + cross-subreddit keyword search."""

    subreddits = subreddits or ['Morimens', 'MorimensGame']
    items = []
    seen_ids = set()
    headers = {'User-Agent': 'MorimensAggregator/1.0'}

    def _parse_post(d):
        post_id = d.get('id', '')
        if post_id in seen_ids:
            return None
        seen_ids.add(post_id)
        created = datetime.fromtimestamp(d['created_utc'], tz=timezone.utc)
        if datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK):
            return None
        score = d.get('score', 0)
        comments = d.get('num_comments', 0)
        return {
            'title': d['title'],
            'summary': (d.get('selftext', '') or '')[:200],
            'source': 'reddit',
            'time': created.isoformat(),
            'url': f"https://reddit.com{d['permalink']}",
            'engagement': score + comments,
            'engagement_detail': {'score': score, 'comments': comments},
            'is_hot': score > 100,
            'author': f"u/{d.get('author', 'unknown')}",
            'tags': list({f.get('text', '') for f in d.get('link_flair_richtext', []) if f.get('text')}),
        }

    # Fetch hot, new, rising for each subreddit
    for sub in subreddits:
        for feed in ['hot', 'new', 'rising']:
            url = f'https://www.reddit.com/r/{sub}/{feed}.json?limit=25'
            try:
                resp = request_with_retry('GET', url, headers=headers)
                posts = resp.json().get('data', {}).get('children', [])
                for post in posts:
                    item = _parse_post(post['data'])
                    if item:
                        items.append(item)
            except Exception as e:
                logger.warning(f'Reddit r/{sub}/{feed} failed: {e}')
            time.sleep(0.3)  # Rate limiting

    # Cross-subreddit keyword search
    for keyword in ['Morimens', '忘却前夜']:
        url = 'https://www.reddit.com/search.json'
        params = {'q': keyword, 'sort': 'new', 'limit': 25, 't': 'day'}
        try:
            resp = request_with_retry('GET', url, headers=headers, params=params)
            posts = resp.json().get('data', {}).get('children', [])
            for post in posts:
                item = _parse_post(post['data'])
                if item:
                    items.append(item)
        except Exception as e:
            logger.warning(f'Reddit search "{keyword}" failed: {e}')
        time.sleep(0.3)

    logger.info(f'Reddit: fetched {len(items)} posts total')
    return items


def fetch_bilibili(max_pages=3):
    """Fetch Bilibili search results for Morimens keywords (multi-page)."""

    items = []
    seen_bvids = set()

    for keyword in ['忘却前夜', '忘卻前夜']:
        for page in range(1, max_pages + 1):
            url = 'https://api.bilibili.com/x/web-interface/search/type'
            params = {
                'search_type': 'video',
                'keyword': keyword,
                'order': 'pubdate',
                'duration': 0,
                'page': page,
            }
            headers = {
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://www.bilibili.com',
            }
            try:
                resp = request_with_retry('GET', url, params=params, headers=headers)
                results = resp.json().get('data', {}).get('result', []) or []
                if not results:
                    break

                found_old = False
                for v in results[:20]:
                    pubdate = v.get('pubdate', 0)
                    created = datetime.fromtimestamp(pubdate, tz=timezone.utc) if pubdate else None
                    if created and datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK):
                        found_old = True
                        continue

                    # Deduplicate across keywords by bvid
                    bvid = v.get('bvid', '')
                    if bvid and bvid in seen_bvids:
                        continue
                    if bvid:
                        seen_bvids.add(bvid)

                    title = strip_html_tags(v.get('title', ''))
                    # Weighted engagement: play + danmaku*2 + favorites*3 + review*2
                    play = v.get('play', 0) if isinstance(v.get('play'), int) else 0
                    danmaku = v.get('danmaku', 0) if isinstance(v.get('danmaku'), int) else 0
                    favorites = v.get('favorites', 0) if isinstance(v.get('favorites'), int) else 0
                    review = v.get('review', 0) if isinstance(v.get('review'), int) else 0
                    engagement = play + danmaku * 2 + favorites * 3 + review * 2

                    items.append({
                        'title': title,
                        'summary': v.get('description', '')[:200],
                        'source': 'bilibili',
                        'time': created.isoformat() if created else datetime.now(timezone.utc).isoformat(),
                        'url': v.get('arcurl', ''),
                        'engagement': engagement,
                        'engagement_detail': {'play': play, 'danmaku': danmaku, 'favorites': favorites, 'review': review},
                        'is_hot': play > 10000,
                        'author': v.get('author', ''),
                        'tags': [v.get('typename', '')] if v.get('typename') else [],
                    })

                logger.info(f'Bilibili "{keyword}" page {page}: fetched {len(results)} videos')

                # Stop paging if we hit old content
                if found_old:
                    break

                # Rate limiting between pages
                if page < max_pages:
                    time.sleep(0.5)

            except Exception as e:
                logger.warning(f'Bilibili "{keyword}" page {page} failed: {e}')
                break

    return items


def fetch_bilibili_articles(max_pages=2):
    """Fetch Bilibili article (专栏) search results for Morimens keywords."""

    items = []
    seen_ids = set()

    for keyword in ['忘却前夜', '忘卻前夜']:
        for page in range(1, max_pages + 1):
            url = 'https://api.bilibili.com/x/web-interface/search/type'
            params = {
                'search_type': 'article',
                'keyword': keyword,
                'order': 'pubdate',
                'page': page,
            }
            headers = {
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://www.bilibili.com',
            }
            try:
                resp = request_with_retry('GET', url, params=params, headers=headers)
                results = resp.json().get('data', {}).get('result', []) or []
                if not results:
                    break

                found_old = False
                for a in results[:20]:
                    pub_time = a.get('pub_time', '')
                    try:
                        created = datetime.fromisoformat(pub_time.replace('Z', '+00:00')) if pub_time else None
                    except (ValueError, TypeError):
                        created = None
                    if created and datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK):
                        found_old = True
                        continue

                    article_id = a.get('id', '')
                    if article_id in seen_ids:
                        continue
                    seen_ids.add(article_id)

                    title = strip_html_tags(a.get('title', ''))
                    view = a.get('view', 0) if isinstance(a.get('view'), int) else 0
                    like = a.get('like', 0) if isinstance(a.get('like'), int) else 0
                    reply = a.get('reply', 0) if isinstance(a.get('reply'), int) else 0
                    engagement = view + like * 3 + reply * 2

                    items.append({
                        'title': title,
                        'summary': strip_html_tags(a.get('desc', ''))[:200],
                        'source': 'bilibili',
                        'time': created.isoformat() if created else datetime.now(timezone.utc).isoformat(),
                        'url': f"https://www.bilibili.com/read/cv{article_id}" if article_id else '',
                        'engagement': engagement,
                        'engagement_detail': {'view': view, 'like': like, 'reply': reply},
                        'is_hot': view > 10000,
                        'author': a.get('author', {}).get('name', '') if isinstance(a.get('author'), dict) else str(a.get('author', '')),
                        'tags': [c.get('name', '') for c in a.get('categories', []) if c.get('name')] if isinstance(a.get('categories'), list) else ['专栏'],
                    })

                logger.info(f'Bilibili articles "{keyword}" page {page}: {len(results)} articles')
                if found_old:
                    break
                if page < max_pages:
                    time.sleep(0.5)

            except Exception as e:
                logger.warning(f'Bilibili articles "{keyword}" page {page} failed: {e}')
                break

    logger.info(f'Bilibili articles: {len(items)} total')
    return items


def fetch_bilibili_dynamic():
    """Fetch Bilibili dynamic (动态) posts via search for Morimens keywords."""

    items = []
    headers = {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.bilibili.com',
    }

    for keyword in ['忘却前夜', '忘卻前夜']:
        url = 'https://api.bilibili.com/x/web-interface/search/type'
        params = {
            'search_type': 'bili_user',  # Search users who post about it
            'keyword': keyword,
            'page': 1,
        }
        # Bilibili dynamic search via topic API
        dynamic_url = 'https://api.bilibili.com/topic_svr/v1/topic_svr/topic_history'
        dynamic_params = {'topic_name': keyword}
        try:
            resp = request_with_retry('GET', dynamic_url, params=dynamic_params, headers=headers)
            data = resp.json()
            cards = data.get('data', {}).get('cards', []) or []
            for card in cards[:15]:
                desc = card.get('desc', {})
                card_ts = desc.get('timestamp', 0)
                if not card_ts:
                    continue
                created = datetime.fromtimestamp(card_ts, tz=timezone.utc)
                if datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK):
                    continue

                # Parse card content
                try:
                    card_content = json.loads(card.get('card', '{}'))
                except (json.JSONDecodeError, TypeError):
                    continue

                # Dynamic text posts
                title = card_content.get('item', {}).get('content', '')[:100] or card_content.get('item', {}).get('description', '')[:100]
                if not title:
                    title = card_content.get('title', '')[:100] or card_content.get('dynamic', '')[:100]
                if not title:
                    continue

                dynamic_id = desc.get('dynamic_id_str', str(desc.get('dynamic_id', '')))
                user_info = desc.get('user_profile', {}).get('info', {})
                likes = desc.get('like', 0)
                repost = desc.get('repost', 0)

                items.append({
                    'title': strip_html_tags(title),
                    'summary': '',
                    'source': 'bilibili',
                    'time': created.isoformat(),
                    'url': f'https://t.bilibili.com/{dynamic_id}' if dynamic_id else '',
                    'engagement': likes + repost * 2,
                    'engagement_detail': {'likes': likes, 'repost': repost},
                    'is_hot': likes > 100,
                    'author': user_info.get('uname', ''),
                    'tags': ['动态'],
                })
            logger.info(f'Bilibili dynamic "{keyword}": {len(cards)} cards')
        except Exception as e:
            logger.warning(f'Bilibili dynamic "{keyword}" failed: {e}')
        time.sleep(0.5)

    logger.info(f'Bilibili dynamic: {len(items)} total')
    return items


def fetch_twitter():
    """
    Fetch tweets using Twitter/X API v2.
    Requires TWITTER_BEARER_TOKEN environment variable.
    """

    bearer = os.environ.get('TWITTER_BEARER_TOKEN')
    if not bearer:
        logger.warning('Twitter: TWITTER_BEARER_TOKEN not set, skipping')
        return []

    items = []
    query = '(忘却前夜 OR 忘卻前夜 OR Morimens) -is:retweet'
    url = 'https://api.twitter.com/2/tweets/search/recent'
    params = {
        'query': query,
        'max_results': 50,
        'tweet.fields': 'created_at,public_metrics,author_id,entities',
        'expansions': 'author_id',
        'user.fields': 'username',
    }
    headers = {'Authorization': f'Bearer {bearer}'}

    try:
        resp = request_with_retry('GET', url, params=params, headers=headers)
        data = resp.json()
        users = {u['id']: u['username'] for u in data.get('includes', {}).get('users', [])}
        for tweet in data.get('data', []):
            metrics = tweet.get('public_metrics', {})
            engagement = metrics.get('like_count', 0) + metrics.get('reply_count', 0) + metrics.get('retweet_count', 0)

            # Extract hashtags from entities
            entities = tweet.get('entities', {})
            hashtags = [f"#{h['tag']}" for h in entities.get('hashtags', [])] if entities.get('hashtags') else []

            # Detect media type for tags
            if entities.get('urls'):
                for u in entities['urls']:
                    if 'pic.twitter.com' in u.get('expanded_url', '') or 'pbs.twimg.com' in u.get('expanded_url', ''):
                        if '图片' not in hashtags:
                            hashtags.append('图片')
                        break

            likes = metrics.get('like_count', 0)
            replies = metrics.get('reply_count', 0)
            retweets = metrics.get('retweet_count', 0)
            items.append({
                'title': tweet['text'][:100],
                'summary': tweet['text'][:200],
                'source': 'twitter',
                'time': tweet['created_at'],
                'url': f"https://twitter.com/i/status/{tweet['id']}",
                'engagement': engagement,
                'engagement_detail': {'likes': likes, 'replies': replies, 'retweets': retweets},
                'is_hot': engagement > 500,
                'author': f"@{users.get(tweet['author_id'], 'unknown')}",
                'tags': hashtags[:5],
            })
        logger.info(f'Twitter: fetched {len(items)} tweets')
    except Exception as e:
        logger.warning(f'Twitter failed: {e}')

    return items


def fetch_nga():
    """
    Fetch NGA forum posts for Morimens.
    Uses forum ID if set, otherwise falls back to keyword search.
    NGA has rate limiting - be respectful.
    """

    items = []
    headers = {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
    }

    nga_fid = os.environ.get('NGA_FORUM_ID', '')

    if nga_fid:
        # Forum-based listing
        url = f'https://bbs.nga.cn/thread.php?fid={nga_fid}&ajax=1'
        try:
            resp = request_with_retry('GET', url, headers=headers)
            data = resp.json()
            threads = data.get('data', {}).get('__T', {})
            for tid, thread in threads.items():
                postdate = thread.get('postdate', 0)
                if isinstance(postdate, str):
                    continue
                created = datetime.fromtimestamp(postdate, tz=timezone.utc)
                if datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK):
                    continue
                replies = thread.get('replies', 0)
                items.append({
                    'title': thread.get('subject', ''),
                    'summary': '',
                    'source': 'nga',
                    'time': created.isoformat(),
                    'url': f"https://bbs.nga.cn/read.php?tid={tid}",
                    'engagement': replies,
                    'engagement_detail': {'replies': replies},
                    'is_hot': replies > 50,
                    'author': thread.get('author', ''),
                    'tags': [],
                })
            logger.info(f'NGA forum: fetched {len(items)} threads')
        except Exception as e:
            logger.warning(f'NGA forum failed: {e}')

    # Keyword search (always try, supplements forum listing)
    for keyword in ['忘却前夜', '忘卻前夜']:
        search_url = f'https://bbs.nga.cn/thread.php?key={keyword}&ajax=1'
        try:
            resp = request_with_retry('GET', search_url, headers=headers)
            data = resp.json()
            threads = data.get('data', {}).get('__T', {})
            seen_tids = {i.get('url', '').split('tid=')[-1] for i in items}
            for tid, thread in threads.items():
                if str(tid) in seen_tids:
                    continue
                postdate = thread.get('postdate', 0)
                if isinstance(postdate, str):
                    continue
                created = datetime.fromtimestamp(postdate, tz=timezone.utc)
                if datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK):
                    continue
                replies = thread.get('replies', 0)
                items.append({
                    'title': thread.get('subject', ''),
                    'summary': '',
                    'source': 'nga',
                    'time': created.isoformat(),
                    'url': f"https://bbs.nga.cn/read.php?tid={tid}",
                    'engagement': replies,
                    'engagement_detail': {'replies': replies},
                    'is_hot': replies > 50,
                    'author': thread.get('author', ''),
                    'tags': [],
                })
            logger.info(f'NGA search "{keyword}": fetched results')
        except Exception as e:
            logger.warning(f'NGA search "{keyword}" failed: {e}')
        time.sleep(0.5)

    logger.info(f'NGA: {len(items)} threads total')
    return items


def fetch_taptap():
    """Fetch TapTap community posts for Morimens."""

    app_id = os.environ.get('TAPTAP_APP_ID', '')
    if not app_id:
        logger.info('TapTap: TAPTAP_APP_ID not set, skipping')
        return []

    items = []
    headers = {'User-Agent': 'Mozilla/5.0'}

    # Fetch hot topics
    for list_type in ['hot', 'new']:
        url = f'https://api.taptap.cn/app/v2/app/{app_id}/topic/list'
        params = {'type': list_type, 'limit': 20}
        try:
            resp = request_with_retry('GET', url, params=params, headers=headers)
            topics = resp.json().get('data', {}).get('list', [])
            for topic in topics:
                created = datetime.fromtimestamp(topic.get('created_time', 0), tz=timezone.utc)
                if datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK):
                    continue
                t_likes = topic.get('like_count', 0)
                t_comments = topic.get('comment_count', 0)
                items.append({
                    'title': topic.get('title', ''),
                    'summary': topic.get('summary', '')[:200],
                    'source': 'taptap',
                    'time': created.isoformat(),
                    'url': topic.get('share_url', ''),
                    'engagement': t_comments + t_likes,
                    'engagement_detail': {'likes': t_likes, 'comments': t_comments},
                    'is_hot': t_likes > 100,
                    'author': topic.get('user', {}).get('name', ''),
                    'tags': [],
                })
            logger.info(f'TapTap {list_type}: {len(topics)} topics')
        except Exception as e:
            logger.warning(f'TapTap {list_type} failed: {e}')

    # Fetch hot reviews
    review_url = f'https://api.taptap.cn/app/v2/app/{app_id}/review/list'
    params = {'sort': 'hot', 'limit': 10}
    try:
        resp = request_with_retry('GET', review_url, params=params, headers=headers)
        reviews = resp.json().get('data', {}).get('list', [])
        for rev in reviews:
            created = datetime.fromtimestamp(rev.get('created_time', 0), tz=timezone.utc)
            if datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK):
                continue
            score = rev.get('score', 0)
            title = rev.get('contents', {}).get('text', '')[:100] if isinstance(rev.get('contents'), dict) else ''
            if not title:
                title = f"TapTap评价 {'★' * score}"
            r_likes = rev.get('like_count', 0)
            r_comments = rev.get('comment_count', 0)
            items.append({
                'title': title,
                'summary': rev.get('contents', {}).get('text', '')[:200] if isinstance(rev.get('contents'), dict) else '',
                'source': 'taptap',
                'time': created.isoformat(),
                'url': '',
                'engagement': r_likes + r_comments,
                'engagement_detail': {'likes': r_likes, 'comments': r_comments, 'score': score},
                'is_hot': r_likes > 50,
                'author': rev.get('user', {}).get('name', ''),
                'tags': ['评测'],
            })
        logger.info(f'TapTap reviews: {len(reviews)} reviews')
    except Exception as e:
        logger.warning(f'TapTap reviews failed: {e}')

    logger.info(f'TapTap: {len(items)} total')
    return items


def fetch_youtube():
    """
    Fetch YouTube videos about Morimens.
    Uses YouTube Data API v3 if YOUTUBE_API_KEY is set,
    otherwise falls back to RSS feed from channel.
    """
    import xml.etree.ElementTree as ET

    api_key = os.environ.get('YOUTUBE_API_KEY', '')
    channel_id = os.environ.get('YOUTUBE_CHANNEL_ID', '')
    items = []

    if api_key:
        # YouTube Data API v3
        for keyword in ['Morimens', '忘却前夜']:
            url = 'https://www.googleapis.com/youtube/v3/search'
            params = {
                'part': 'snippet',
                'q': keyword,
                'type': 'video',
                'order': 'date',
                'publishedAfter': (datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)).strftime('%Y-%m-%dT%H:%M:%SZ'),
                'maxResults': 20,
                'key': api_key,
            }
            try:
                resp = request_with_retry('GET', url, params=params)
                data = resp.json()
                video_ids = [item['id']['videoId'] for item in data.get('items', []) if item.get('id', {}).get('videoId')]

                # Batch fetch statistics
                if video_ids:
                    stats_url = 'https://www.googleapis.com/youtube/v3/videos'
                    stats_params = {
                        'part': 'statistics',
                        'id': ','.join(video_ids),
                        'key': api_key,
                    }
                    stats_resp = request_with_retry('GET', stats_url, params=stats_params)
                    stats_map = {v['id']: v.get('statistics', {}) for v in stats_resp.json().get('items', [])}
                else:
                    stats_map = {}

                for item in data.get('items', []):
                    snippet = item.get('snippet', {})
                    vid = item.get('id', {}).get('videoId', '')
                    if not vid:
                        continue
                    published = snippet.get('publishedAt', '')
                    stats = stats_map.get(vid, {})
                    views = int(stats.get('viewCount', 0))
                    likes = int(stats.get('likeCount', 0))
                    comments = int(stats.get('commentCount', 0))

                    items.append({
                        'title': snippet.get('title', ''),
                        'summary': snippet.get('description', '')[:200],
                        'source': 'youtube',
                        'time': published,
                        'url': f'https://www.youtube.com/watch?v={vid}',
                        'engagement': views + likes * 5 + comments * 3,
                        'engagement_detail': {'views': views, 'likes': likes, 'comments': comments},
                        'is_hot': views > 50000,
                        'author': snippet.get('channelTitle', ''),
                        'tags': [],
                    })
                logger.info(f'YouTube API "{keyword}": {len(data.get("items", []))} videos')
            except Exception as e:
                logger.warning(f'YouTube API "{keyword}" failed: {e}')
            time.sleep(0.2)

    elif channel_id:
        # RSS fallback - no API key needed, but limited to channel uploads
        rss_url = f'https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}'
        try:
            resp = request_with_retry('GET', rss_url)
            root = ET.fromstring(resp.content)
            ns = {'atom': 'http://www.w3.org/2005/Atom', 'media': 'http://search.yahoo.com/mrss/'}

            for entry in root.findall('atom:entry', ns):
                title = entry.findtext('atom:title', '', ns)
                published = entry.findtext('atom:published', '', ns)
                link = entry.find('atom:link', ns)
                href = link.get('href', '') if link is not None else ''
                author = entry.findtext('atom:author/atom:name', '', ns)

                try:
                    pub_dt = datetime.fromisoformat(published.replace('Z', '+00:00'))
                    if datetime.now(timezone.utc) - pub_dt > timedelta(hours=HOURS_LOOKBACK):
                        continue
                except (ValueError, TypeError):
                    continue

                media_stats = entry.find('media:group/media:community/media:statistics', ns)
                views = int(media_stats.get('views', 0)) if media_stats is not None else 0

                items.append({
                    'title': title,
                    'summary': '',
                    'source': 'youtube',
                    'time': pub_dt.isoformat(),
                    'url': href,
                    'engagement': views,
                    'engagement_detail': {'views': views},
                    'is_hot': views > 50000,
                    'author': author,
                    'tags': [],
                })
            logger.info(f'YouTube RSS: {len(items)} videos from channel feed')
        except Exception as e:
            logger.warning(f'YouTube RSS failed: {e}')

    else:
        logger.info('YouTube: no YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID set, skipping')

    return items


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
    import requests

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


def load_previous_news():
    """Load the previous news.json for rollback protection."""
    try:
        if OUTPUT_PATH.exists():
            with open(OUTPUT_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return data.get('news', [])
    except Exception as e:
        logger.warning(f'Failed to load previous news.json: {e}')
    return []


# ============================================================
# Iter 2: Historical Data Archival
# ============================================================

ARCHIVE_DIR = _DATA_DIR / 'archive'


def archive_news(output_data):
    """Archive current run output to data/archive/YYYY-MM-DD_HH.json."""
    try:
        ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime('%Y-%m-%d_%H')
        archive_path = ARCHIVE_DIR / f'{ts}.json'
        with open(archive_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)
        logger.info(f'Archived to {archive_path}')
    except Exception as e:
        logger.warning(f'Failed to archive: {e}')


# ============================================================
# Iter 3: Structured Run Log
# ============================================================

RUN_LOG_PATH = _DATA_DIR / 'run_log.json'
MAX_RUN_LOG_ENTRIES = 100


def write_run_log(run_start, source_stats, total_fetched, total_validated, total_deduped):
    """Append a structured run log entry to data/run_log.json."""
    entry = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'duration_ms': int((time.time() - run_start) * 1000),
        'total_fetched': total_fetched,
        'total_validated': total_validated,
        'total_deduped': total_deduped,
        'sources': source_stats,
    }
    try:
        log = []
        if RUN_LOG_PATH.exists():
            with open(RUN_LOG_PATH, 'r', encoding='utf-8') as f:
                log = json.load(f)
        log.append(entry)
        # Keep only recent entries
        if len(log) > MAX_RUN_LOG_ENTRIES:
            log = log[-MAX_RUN_LOG_ENTRIES:]
        RUN_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(RUN_LOG_PATH, 'w', encoding='utf-8') as f:
            json.dump(log, f, ensure_ascii=False, indent=2)
        logger.info(f'Run log updated ({len(log)} entries)')
    except Exception as e:
        logger.warning(f'Failed to write run log: {e}')


# ============================================================
# Iter 4: Discord Fetcher (enhanced: reactions, threads, member activity)
# ============================================================

def _discord_headers():
    bot_token = os.environ.get('DISCORD_BOT_TOKEN', '')
    return {
        'Authorization': f'Bot {bot_token}',
        'Content-Type': 'application/json',
    }


def _discord_cutoff_snowflake():
    cutoff = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)
    return int((cutoff.timestamp() - 1420070400) * 1000) << 22


def _parse_discord_reaction_detail(reactions):
    """Parse reaction list into detail dict: {emoji: count, ...}."""
    detail = {}
    total = 0
    for r in (reactions or []):
        emoji = r.get('emoji', {})
        name = emoji.get('name', '?')
        count = r.get('count', 0)
        detail[name] = count
        total += count
    return total, detail


def _fetch_discord_thread_messages(thread_id, headers):
    """Fetch messages from a thread/forum post."""
    items = []
    url = f'https://discord.com/api/v10/channels/{thread_id}/messages'
    params = {'limit': 100, 'after': str(_discord_cutoff_snowflake())}
    try:
        resp = request_with_retry('GET', url, headers=headers, params=params)
        messages = resp.json()
        if not isinstance(messages, list):
            return items
        for msg in messages:
            content = msg.get('content', '')
            if not content:
                continue
            ts = msg.get('timestamp', '')
            try:
                created = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            except (ValueError, TypeError):
                continue
            reactions_total, reactions_detail = _parse_discord_reaction_detail(msg.get('reactions', []))
            items.append({
                'title': content[:100],
                'summary': content[:200],
                'source': 'discord',
                'time': created.isoformat(),
                'url': f"https://discord.com/channels/{msg.get('guild_id', '')}/{thread_id}/{msg['id']}",
                'engagement': reactions_total,
                'engagement_detail': {'reactions': reactions_total, 'reaction_breakdown': reactions_detail},
                'is_hot': reactions_total > 20,
                'author': msg.get('author', {}).get('username', ''),
                'tags': ['thread'],
            })
    except Exception as e:
        logger.warning(f'Discord thread {thread_id} failed: {e}')
    return items


def _discover_guild_channels(guild_id, headers):
    """Fetch all text/forum channels from a guild that the bot can access."""
    url = f'https://discord.com/api/v10/guilds/{guild_id}/channels'
    try:
        resp = request_with_retry('GET', url, headers=headers)
        channels = resp.json()
        if not isinstance(channels, list):
            return []
        # Type 0 = text, 5 = announcement, 15 = forum
        readable_types = {0, 5, 15}
        result = [(ch['id'], ch.get('type', 0)) for ch in channels if ch.get('type', 0) in readable_types]
        logger.info(f'Discord guild {guild_id}: discovered {len(result)} readable channels')
        return result
    except Exception as e:
        logger.warning(f'Discord guild {guild_id} channel discovery failed: {e}')
        return []


def fetch_discord():
    """Fetch Discord messages, threads/forum posts, and member activity stats.
    Supports DISCORD_GUILD_ID (auto-discover all channels) or DISCORD_CHANNEL_IDS (manual list)."""
    bot_token = os.environ.get('DISCORD_BOT_TOKEN', '')
    guild_id = os.environ.get('DISCORD_GUILD_ID', '')
    channel_ids_env = os.environ.get('DISCORD_CHANNEL_IDS', '')

    if not bot_token:
        logger.info('Discord: DISCORD_BOT_TOKEN not set, skipping')
        return []
    if not guild_id and not channel_ids_env:
        logger.info('Discord: neither DISCORD_GUILD_ID nor DISCORD_CHANNEL_IDS set, skipping')
        return []

    items = []
    member_activity = {}  # username -> {messages: n, reactions_received: n}
    headers = _discord_headers()
    cutoff_snowflake = _discord_cutoff_snowflake()

    # Build channel list: auto-discover from guild or use manual list
    if guild_id:
        channel_list = _discover_guild_channels(guild_id, headers)
    else:
        channel_list = [(ch_id.strip(), None) for ch_id in channel_ids_env.split(',') if ch_id.strip()]

    for ch_id, ch_type_hint in channel_list:
        # Check channel type if not already known
        ch_type = ch_type_hint
        ch_data = {}
        if ch_type is None:
            try:
                ch_resp = request_with_retry('GET', f'https://discord.com/api/v10/channels/{ch_id}', headers=headers)
                ch_data = ch_resp.json()
                ch_type = ch_data.get('type', 0)
            except Exception:
                ch_type = 0

        # Type 15 = Forum channel: fetch active threads instead of messages
        if ch_type == 15:
            try:
                threads_url = f'https://discord.com/api/v10/channels/{ch_id}/threads/archived/public'
                resp = request_with_retry('GET', threads_url, headers=headers, params={'limit': 25})
                threads_data = resp.json()
                for thread in threads_data.get('threads', []):
                    thread_id = thread.get('id', '')
                    thread_name = thread.get('name', '')
                    msg_count = thread.get('message_count', 0)
                    created_ts = thread.get('thread_metadata', {}).get('create_timestamp', '') or thread.get('id', '')

                    # Convert snowflake to timestamp if needed
                    try:
                        created = datetime.fromisoformat(created_ts.replace('Z', '+00:00'))
                    except (ValueError, TypeError):
                        try:
                            snowflake = int(thread_id)
                            ts_ms = (snowflake >> 22) + 1420070400000
                            created = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
                        except (ValueError, TypeError):
                            continue

                    if datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK):
                        continue

                    owner_id = thread.get('owner_id', '')
                    items.append({
                        'title': thread_name[:100] if thread_name else f'Forum post #{thread_id}',
                        'summary': '',
                        'source': 'discord',
                        'time': created.isoformat(),
                        'url': f"https://discord.com/channels/{guild_id or ch_data.get('guild_id', '')}/{thread_id}",
                        'engagement': msg_count,
                        'engagement_detail': {'thread_replies': msg_count},
                        'is_hot': msg_count > 20,
                        'author': owner_id,
                        'tags': ['forum'],
                    })

                    # Also fetch messages inside the thread for reaction data
                    thread_items = _fetch_discord_thread_messages(thread_id, headers)
                    items.extend(thread_items)
                    time.sleep(0.3)

                logger.info(f'Discord forum {ch_id}: {len(threads_data.get("threads", []))} threads')
            except Exception as e:
                logger.warning(f'Discord forum {ch_id} failed: {e}')
            continue

        # Regular text channel: fetch messages
        url = f'https://discord.com/api/v10/channels/{ch_id}/messages'
        params = {'limit': 100, 'after': str(cutoff_snowflake)}
        try:
            resp = request_with_retry('GET', url, headers=headers, params=params)
            messages = resp.json()
            if not isinstance(messages, list):
                logger.warning(f'Discord channel {ch_id}: unexpected response type')
                continue

            for msg in messages:
                content = msg.get('content', '')
                author_name = msg.get('author', {}).get('username', '')

                # Track member activity
                if author_name:
                    if author_name not in member_activity:
                        member_activity[author_name] = {'messages': 0, 'reactions_received': 0}
                    member_activity[author_name]['messages'] += 1

                # Parse reactions with breakdown
                reactions_total, reactions_detail = _parse_discord_reaction_detail(msg.get('reactions', []))

                if author_name and reactions_total > 0:
                    member_activity[author_name]['reactions_received'] += reactions_total

                # Fetch thread replies if message has a thread
                thread_count = 0
                if msg.get('thread'):
                    thread_id = msg['thread'].get('id', '')
                    thread_count = msg['thread'].get('message_count', 0)
                    # Fetch thread messages for more content
                    if thread_id:
                        thread_items = _fetch_discord_thread_messages(thread_id, headers)
                        items.extend(thread_items)
                        time.sleep(0.3)

                # Filter by keywords (skip if no keywords match)
                if not any(kw.lower() in content.lower() for kw in SEARCH_KEYWORDS):
                    # Still count for member activity but don't add as news item
                    continue

                ts = msg.get('timestamp', '')
                try:
                    created = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                except (ValueError, TypeError):
                    continue

                guild_id = msg.get('guild_id', '') or guild_id or ch_data.get('guild_id', '')
                items.append({
                    'title': content[:100],
                    'summary': content[:200],
                    'source': 'discord',
                    'time': created.isoformat(),
                    'url': f"https://discord.com/channels/{guild_id}/{ch_id}/{msg['id']}",
                    'engagement': reactions_total + thread_count,
                    'engagement_detail': {
                        'reactions': reactions_total,
                        'reaction_breakdown': reactions_detail,
                        'thread_replies': thread_count,
                    },
                    'is_hot': reactions_total > 20,
                    'author': author_name,
                    'tags': [],
                })
            logger.info(f'Discord channel {ch_id}: {len(messages)} messages scanned')
        except Exception as e:
            logger.warning(f'Discord channel {ch_id} failed: {e}')
        time.sleep(0.5)

    # Write member activity stats
    if member_activity:
        _write_member_activity(member_activity)

    logger.info(f'Discord: {len(items)} relevant items')
    return items


MEMBER_ACTIVITY_PATH = _DATA_DIR / 'discord_activity.json'


def _write_member_activity(current_activity):
    """Merge and persist member activity stats."""
    try:
        existing = {}
        if MEMBER_ACTIVITY_PATH.exists():
            with open(MEMBER_ACTIVITY_PATH, 'r', encoding='utf-8') as f:
                existing = json.load(f)

        # Merge: accumulate totals, keep last_seen
        now = datetime.now(timezone.utc).isoformat()
        members = existing.get('members', {})
        for username, stats in current_activity.items():
            if username not in members:
                members[username] = {'total_messages': 0, 'total_reactions_received': 0, 'first_seen': now}
            members[username]['total_messages'] += stats['messages']
            members[username]['total_reactions_received'] += stats['reactions_received']
            members[username]['last_seen'] = now
            members[username]['recent_messages'] = stats['messages']
            members[username]['recent_reactions'] = stats['reactions_received']

        # Sort by total messages for readability
        sorted_members = dict(sorted(members.items(), key=lambda x: x[1]['total_messages'], reverse=True))

        output = {
            'updated_at': now,
            'total_tracked': len(sorted_members),
            'members': sorted_members,
        }

        MEMBER_ACTIVITY_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(MEMBER_ACTIVITY_PATH, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        logger.info(f'Discord member activity: {len(sorted_members)} members tracked')
    except Exception as e:
        logger.warning(f'Failed to write member activity: {e}')


# ============================================================
# Iter 5: Incremental Fetch State
# ============================================================

FETCH_STATE_PATH = _DATA_DIR / 'fetch_state.json'


def load_fetch_state():
    """Load persisted fetch state (last seen IDs/timestamps per source)."""
    try:
        if FETCH_STATE_PATH.exists():
            with open(FETCH_STATE_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        logger.warning(f'Failed to load fetch state: {e}')
    return {}


def save_fetch_state(state):
    """Save fetch state for incremental fetching."""
    try:
        FETCH_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(FETCH_STATE_PATH, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        logger.info('Fetch state saved')
    except Exception as e:
        logger.warning(f'Failed to save fetch state: {e}')


def update_fetch_state(state, source_name, items):
    """Update fetch state with latest item IDs from this run."""
    if not items:
        return
    # Store the latest timestamp for each source
    latest_time = max(
        (item.get('time', '') for item in items),
        default=''
    )
    urls = [item.get('url', '') for item in items[:5] if item.get('url')]
    state[source_name] = {
        'latest_time': latest_time,
        'latest_urls': urls,
        'last_run': datetime.now(timezone.utc).isoformat(),
        'count': len(items),
    }


# ============================================================
# Iter 6: JSONL Data Export
# ============================================================

JSONL_OUTPUT_PATH = _DATA_DIR / 'news.jsonl'


def export_jsonl(news_items):
    """Append new items to data/news.jsonl (one JSON object per line)."""
    fetched_at = datetime.now(timezone.utc).isoformat()
    try:
        JSONL_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        # Load existing URLs to avoid duplicate appends
        existing_urls = set()
        if JSONL_OUTPUT_PATH.exists():
            with open(JSONL_OUTPUT_PATH, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            existing_urls.add(json.loads(line).get('url', ''))
                        except json.JSONDecodeError:
                            pass

        new_count = 0
        with open(JSONL_OUTPUT_PATH, 'a', encoding='utf-8') as f:
            for item in news_items:
                if item.get('url') and item['url'] in existing_urls:
                    continue
                record = dict(item)
                record['fetched_at'] = fetched_at
                f.write(json.dumps(record, ensure_ascii=False) + '\n')
                new_count += 1

        logger.info(f'JSONL: appended {new_count} new items to {JSONL_OUTPUT_PATH}')
    except Exception as e:
        logger.warning(f'Failed to write JSONL: {e}')


# ============================================================
# Iter 7: Enhanced URL-based Deduplication
# ============================================================

def normalize_url(url):
    """Normalize URL for deduplication: strip tracking params and fragments."""
    if not url:
        return ''
    parsed = urlparse(url)
    # Strip common tracking params
    from urllib.parse import parse_qs, urlencode
    params = parse_qs(parsed.query)
    # Remove tracking parameters
    tracking_keys = {'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
                     'utm_term', 'ref', 'spm_id_from', 'vd_source', 'from',
                     'share_source', 'share_medium', 'bbid', 'ts', 'seid'}
    cleaned_params = {k: v for k, v in params.items() if k.lower() not in tracking_keys}
    clean_query = urlencode(cleaned_params, doseq=True)
    return f'{parsed.scheme}://{parsed.netloc}{parsed.path}{"?" + clean_query if clean_query else ""}'


def deduplicate_news_enhanced(items, similarity_threshold=0.75):
    """Enhanced deduplication: title similarity + URL normalization.
    When duplicates are found across sources, merge as cross_posted."""
    unique = []
    norm_titles = []
    norm_urls = {}  # normalized_url -> index in unique

    for item in items:
        norm = normalize_title(item['title'])
        item_url = normalize_url(item.get('url', ''))

        # Check URL-based dedup first
        if item_url and item_url in norm_urls:
            idx = norm_urls[item_url]
            existing = unique[idx]
            # Cross-posting: different source, same content
            if existing['source'] != item['source']:
                if 'cross_posted' not in existing:
                    existing['cross_posted'] = []
                existing['cross_posted'].append({
                    'source': item['source'],
                    'url': item.get('url', ''),
                    'engagement': item.get('engagement', 0),
                })
            # Keep higher engagement version
            if item.get('engagement', 0) > existing.get('engagement', 0):
                cross = existing.get('cross_posted', [])
                unique[idx] = item
                if cross:
                    unique[idx]['cross_posted'] = cross
                norm_titles[idx] = norm
            continue

        # Title similarity dedup
        is_dup = False
        for i, existing_norm in enumerate(norm_titles):
            if norm == existing_norm or (len(norm) > 5 and title_similarity(norm, existing_norm) > similarity_threshold):
                existing = unique[i]
                if existing['source'] != item['source']:
                    if 'cross_posted' not in existing:
                        existing['cross_posted'] = []
                    existing['cross_posted'].append({
                        'source': item['source'],
                        'url': item.get('url', ''),
                        'engagement': item.get('engagement', 0),
                    })
                if item.get('engagement', 0) > existing.get('engagement', 0):
                    cross = existing.get('cross_posted', [])
                    unique[i] = item
                    if cross:
                        unique[i]['cross_posted'] = cross
                    norm_titles[i] = norm
                is_dup = True
                break

        if not is_dup:
            unique.append(item)
            norm_titles.append(norm)
            if item_url:
                norm_urls[item_url] = len(unique) - 1

    logger.info(f'Deduplication: {len(unique)} unique items from {len(items)} total')
    return unique


# ============================================================
# Iter 8: Language Detection
# ============================================================

def detect_language(text):
    """Detect language based on character distribution. No external deps."""
    if not text:
        return 'unknown'
    # Count character types
    cjk = 0
    hiragana_katakana = 0
    latin = 0
    for ch in text:
        cp = ord(ch)
        if 0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF:
            cjk += 1
        elif 0x3040 <= cp <= 0x309F or 0x30A0 <= cp <= 0x30FF:
            hiragana_katakana += 1
        elif 0x0041 <= cp <= 0x007A:
            latin += 1
    total = cjk + hiragana_katakana + latin
    if total == 0:
        return 'unknown'
    if hiragana_katakana / total > 0.1:
        return 'ja'
    if cjk / total > 0.2:
        return 'zh'
    return 'en'


# ============================================================
# Iter 9: Official Announcements Fetcher
# ============================================================

def fetch_official():
    """Fetch official announcements via TapTap developer posts or dedicated RSS."""
    app_id = os.environ.get('TAPTAP_APP_ID', '')
    if not app_id:
        logger.info('Official: TAPTAP_APP_ID not set, skipping official fetch')
        return []

    items = []
    headers = {'User-Agent': 'Mozilla/5.0'}

    # TapTap official developer feed
    url = f'https://api.taptap.cn/app/v2/app/{app_id}/topic/list'
    params = {'type': 'official', 'limit': 20}
    try:
        resp = request_with_retry('GET', url, params=params, headers=headers)
        topics = resp.json().get('data', {}).get('list', [])
        for topic in topics:
            created = datetime.fromtimestamp(topic.get('created_time', 0), tz=timezone.utc)
            if datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK * 3):
                continue  # Wider window for official posts (72h)
            o_likes = topic.get('like_count', 0)
            o_comments = topic.get('comment_count', 0)
            items.append({
                'title': topic.get('title', ''),
                'summary': topic.get('summary', '')[:200],
                'source': 'official',
                'time': created.isoformat(),
                'url': topic.get('share_url', ''),
                'engagement': o_comments + o_likes,
                'engagement_detail': {'likes': o_likes, 'comments': o_comments},
                'is_hot': True,  # Official posts are always highlighted
                'author': '官方',
                'tags': ['官方公告'],
            })
        logger.info(f'Official TapTap: {len(topics)} official posts')
    except Exception as e:
        logger.warning(f'Official TapTap fetch failed: {e}')

    logger.info(f'Official: {len(items)} announcements')
    return items


# ============================================================
# Iter 10: Data Statistics & Trends
# ============================================================

def compute_trends(current_news):
    """Compute trend statistics by comparing with most recent archive."""
    trends = {
        'new_topics': 0,
        'disappeared_topics': 0,
        'rising': [],
        'platform_activity': {},
    }

    # Find most recent archive
    previous_data = None
    if ARCHIVE_DIR.exists():
        archives = sorted(ARCHIVE_DIR.glob('*.json'), reverse=True)
        for archive_path in archives[1:]:  # Skip current (may be same run)
            try:
                with open(archive_path, 'r', encoding='utf-8') as f:
                    previous_data = json.load(f)
                break
            except Exception:
                continue

    if not previous_data or 'news' not in previous_data:
        trends['new_topics'] = len(current_news)
        return trends

    prev_news = previous_data['news']
    prev_urls = {item.get('url', '') for item in prev_news if item.get('url')}
    curr_urls = {item.get('url', '') for item in current_news if item.get('url')}

    trends['new_topics'] = len(curr_urls - prev_urls)
    trends['disappeared_topics'] = len(prev_urls - curr_urls)

    # Find rising items: in both runs but engagement increased significantly
    prev_engagement = {item.get('url', ''): item.get('engagement', 0) for item in prev_news}
    for item in current_news:
        url = item.get('url', '')
        if url in prev_engagement:
            prev_eng = prev_engagement[url]
            curr_eng = item.get('engagement', 0)
            if prev_eng > 0 and curr_eng > prev_eng * 1.5:
                item['trending'] = True
                trends['rising'].append({
                    'title': item['title'][:50],
                    'source': item['source'],
                    'prev_engagement': prev_eng,
                    'curr_engagement': curr_eng,
                    'growth': round((curr_eng - prev_eng) / prev_eng * 100, 1),
                })

    # Platform activity comparison
    prev_platform_counts = {}
    for item in prev_news:
        s = item.get('source', '')
        prev_platform_counts[s] = prev_platform_counts.get(s, 0) + 1
    curr_platform_counts = {}
    for item in current_news:
        s = item.get('source', '')
        curr_platform_counts[s] = curr_platform_counts.get(s, 0) + 1

    all_platforms = set(prev_platform_counts) | set(curr_platform_counts)
    for p in all_platforms:
        prev_c = prev_platform_counts.get(p, 0)
        curr_c = curr_platform_counts.get(p, 0)
        trends['platform_activity'][p] = {
            'previous': prev_c,
            'current': curr_c,
            'change': curr_c - prev_c,
        }

    # Sort rising by growth
    trends['rising'].sort(key=lambda x: x.get('growth', 0), reverse=True)
    trends['rising'] = trends['rising'][:10]

    logger.info(f'Trends: {trends["new_topics"]} new, {trends["disappeared_topics"]} gone, {len(trends["rising"])} rising')
    return trends


def run():
    """Main aggregation pipeline with concurrent fetching, rollback protection,
    archival, run logging, JSONL export, language detection, and trend analysis."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    run_start = time.time()
    logger.info('Starting Morimens community news aggregation...')

    # Load incremental fetch state
    fetch_state = load_fetch_state()

    # All fetchers
    fetchers = [
        ('reddit', fetch_reddit),
        ('bilibili', fetch_bilibili),
        ('bilibili_articles', fetch_bilibili_articles),
        ('bilibili_dynamic', fetch_bilibili_dynamic),
        ('twitter', fetch_twitter),
        ('nga', fetch_nga),
        ('taptap', fetch_taptap),
        ('youtube', fetch_youtube),
        ('discord', fetch_discord),
        ('official', fetch_official),
    ]

    all_news = []
    source_stats = {}

    # Concurrent fetching
    def _run_fetcher(name, fetcher):
        fetch_start = time.time()
        try:
            items = fetcher()
            elapsed = int((time.time() - fetch_start) * 1000)
            return name, items, {
                'status': 'ok' if items else 'empty',
                'count': len(items),
                'time_ms': elapsed,
            }
        except Exception as e:
            elapsed = int((time.time() - fetch_start) * 1000)
            logger.error(f'{name} fetcher crashed: {e}')
            return name, [], {
                'status': 'error',
                'count': 0,
                'time_ms': elapsed,
                'error': str(e)[:100],
            }

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(_run_fetcher, name, fn): name
            for name, fn in fetchers
        }
        for future in as_completed(futures):
            name, items, stats = future.result()
            all_news.extend(items)
            source_stats[name] = stats
            # Update incremental fetch state
            update_fetch_state(fetch_state, name, items)
            logger.info(f'{name}: {stats["count"]} items ({stats["time_ms"]}ms)')

    # Save fetch state for next run
    save_fetch_state(fetch_state)

    # Validate and sanitize all items
    all_news = validate_all_news(all_news)
    total_validated = len(all_news)

    # Auto-tag enrichment
    all_news = [auto_tag(item) for item in all_news]

    # Language detection (Iter 8)
    for item in all_news:
        item['lang'] = detect_language(item.get('title', '') + ' ' + item.get('summary', ''))

    # Enhanced deduplication with URL fingerprinting (Iter 7)
    unique_news = deduplicate_news_enhanced(all_news)

    # Rollback protection
    previous_news = load_previous_news()
    if previous_news and len(unique_news) == 0:
        logger.warning('Rollback: all fetchers returned empty, preserving previous data')
        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        preserved = []
        for item in previous_news:
            try:
                item_time = datetime.fromisoformat(item['time'].replace('Z', '+00:00'))
                if item_time > cutoff:
                    preserved.append(item)
            except (ValueError, KeyError):
                pass
        unique_news = preserved
        logger.info(f'Rollback: preserved {len(preserved)} items from previous run')

    # Sort by engagement
    unique_news.sort(key=lambda x: x.get('engagement', 0), reverse=True)

    # Mark top items as hot
    HOT_MIN_ENGAGEMENT = 50
    for item in unique_news[:5]:
        if item.get('engagement', 0) >= HOT_MIN_ENGAGEMENT:
            item['is_hot'] = True

    # Compute trends (Iter 10)
    trends = compute_trends(unique_news)

    # Generate summary
    summary = generate_summary(unique_news)

    total_fetched = sum(s['count'] for s in source_stats.values())

    # Write output
    output = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'summary': summary,
        'stats': {
            'total_fetched': total_fetched,
            'total_after_validation': total_validated,
            'total_after_dedup': len(unique_news),
            'sources': source_stats,
            'trends': trends,
        },
        'news': unique_news,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # Generate RSS feed
    generate_rss_feed(unique_news)

    # Archive (Iter 2)
    archive_news(output)

    # JSONL export (Iter 6)
    export_jsonl(unique_news)

    # Structured run log (Iter 3)
    write_run_log(run_start, source_stats, total_fetched, total_validated, len(unique_news))

    logger.info(f'Done! {len(unique_news)} items written to {OUTPUT_PATH}')


RSS_OUTPUT_PATH = _DATA_DIR / 'feed.xml'


def generate_rss_feed(news_items):
    """Generate an RSS 2.0 feed from news items."""
    now = datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S +0000')
    rss_items = []
    for item in news_items[:30]:
        pub_date = ''
        try:
            dt = datetime.fromisoformat(item['time'].replace('Z', '+00:00'))
            pub_date = dt.strftime('%a, %d %b %Y %H:%M:%S +0000')
        except (ValueError, KeyError):
            pub_date = now

        title = item.get('title', '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        desc = item.get('summary', '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        link = item.get('url', '').replace('&', '&amp;')
        author = item.get('author', '').replace('&', '&amp;').replace('<', '&lt;')
        source = item.get('source', '')
        tags_xml = ''.join(f'        <category>{t}</category>\n' for t in item.get('tags', []))

        rss_items.append(f"""    <item>
      <title>{title}</title>
      <description>{desc} [{source}]</description>
      <link>{link}</link>
      <author>{author}</author>
      <pubDate>{pub_date}</pubDate>
{tags_xml}    </item>""")

    rss_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>忘却前夜 Morimens - 社区热点聚合</title>
    <description>实时聚合忘却前夜全球社区24小时内的热点话题</description>
    <language>zh-CN</language>
    <lastBuildDate>{now}</lastBuildDate>
{chr(10).join(rss_items)}
  </channel>
</rss>
"""
    try:
        with open(RSS_OUTPUT_PATH, 'w', encoding='utf-8') as f:
            f.write(rss_content)
        logger.info(f'RSS feed written to {RSS_OUTPUT_PATH}')
    except Exception as e:
        logger.warning(f'Failed to write RSS feed: {e}')


if __name__ == '__main__':
    run()
