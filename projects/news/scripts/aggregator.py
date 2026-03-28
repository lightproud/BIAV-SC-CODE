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
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

OUTPUT_PATH = Path(__file__).parent.parent.parent.parent / 'assets' / 'data' / 'news.json'
SEARCH_KEYWORDS = ['忘却前夜', '忘卻前夜', 'Morimens', 'morimens']
HOURS_LOOKBACK = 24


# ============================================================
# Source Fetchers - each returns a list of news item dicts
# ============================================================

def fetch_reddit(subreddits=None):
    """Fetch hot posts from Reddit using the public JSON API (no auth needed)."""

    subreddits = subreddits or ['Morimens', 'MorimensGame']
    items = []

    for sub in subreddits:
        url = f'https://www.reddit.com/r/{sub}/hot.json?limit=25'
        headers = {'User-Agent': 'MorimensAggregator/1.0'}
        try:
            resp = requests.get(url, headers=headers, timeout=15)
            resp.raise_for_status()
            posts = resp.json().get('data', {}).get('children', [])
            for post in posts:
                d = post['data']
                created = datetime.fromtimestamp(d['created_utc'], tz=timezone.utc)
                if datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK):
                    continue
                items.append({
                    'title': d['title'],
                    'summary': (d.get('selftext', '') or '')[:200],
                    'source': 'reddit',
                    'time': created.isoformat(),
                    'url': f"https://reddit.com{d['permalink']}",
                    'engagement': d.get('score', 0) + d.get('num_comments', 0),
                    'is_hot': d.get('score', 0) > 100,
                    'author': f"u/{d.get('author', 'unknown')}",
                    'tags': list({f.get('text', '') for f in d.get('link_flair_richtext', []) if f.get('text')}),
                })
            logger.info(f'Reddit r/{sub}: fetched {len(items)} posts')
        except Exception as e:
            logger.warning(f'Reddit r/{sub} failed: {e}')

    return items


def fetch_bilibili():
    """Fetch Bilibili search results for Morimens keywords."""

    items = []
    for keyword in ['忘却前夜', '忘卻前夜']:
        url = 'https://api.bilibili.com/x/web-interface/search/type'
        params = {
            'search_type': 'video',
            'keyword': keyword,
            'order': 'pubdate',
            'duration': 0,
            'page': 1,
        }
        headers = {
            'User-Agent': 'Mozilla/5.0',
            'Referer': 'https://www.bilibili.com',
        }
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=15)
            resp.raise_for_status()
            results = resp.json().get('data', {}).get('result', []) or []
            for v in results[:20]:
                pubdate = v.get('pubdate', 0)
                created = datetime.fromtimestamp(pubdate, tz=timezone.utc) if pubdate else None
                if created and datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK):
                    continue
                # Strip HTML tags from title
                title = v.get('title', '').replace('<em class="keyword">', '').replace('</em>', '')
                items.append({
                    'title': title,
                    'summary': v.get('description', '')[:200],
                    'source': 'bilibili',
                    'time': created.isoformat() if created else datetime.now(timezone.utc).isoformat(),
                    'url': v.get('arcurl', ''),
                    'engagement': v.get('play', 0) + v.get('danmaku', 0),
                    'is_hot': v.get('play', 0) > 10000,
                    'author': v.get('author', ''),
                    'tags': [v.get('typename', '')] if v.get('typename') else [],
                })
            logger.info(f'Bilibili "{keyword}": fetched {len(results)} videos')
        except Exception as e:
            logger.warning(f'Bilibili "{keyword}" failed: {e}')

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
        'tweet.fields': 'created_at,public_metrics,author_id',
        'expansions': 'author_id',
        'user.fields': 'username',
    }
    headers = {'Authorization': f'Bearer {bearer}'}

    try:
        resp = requests.get(url, params=params, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        users = {u['id']: u['username'] for u in data.get('includes', {}).get('users', [])}
        for tweet in data.get('data', []):
            metrics = tweet.get('public_metrics', {})
            engagement = metrics.get('like_count', 0) + metrics.get('reply_count', 0) + metrics.get('retweet_count', 0)
            items.append({
                'title': tweet['text'][:100],
                'summary': tweet['text'][:200],
                'source': 'twitter',
                'time': tweet['created_at'],
                'url': f"https://twitter.com/i/status/{tweet['id']}",
                'engagement': engagement,
                'is_hot': engagement > 500,
                'author': f"@{users.get(tweet['author_id'], 'unknown')}",
                'tags': [],
            })
        logger.info(f'Twitter: fetched {len(items)} tweets')
    except Exception as e:
        logger.warning(f'Twitter failed: {e}')

    return items


def fetch_nga():
    """
    Fetch NGA forum posts for Morimens.
    NGA has rate limiting - be respectful.
    """

    items = []
    # NGA forum ID for 忘却前夜 - update this with the actual forum ID
    nga_fid = os.environ.get('NGA_FORUM_ID', '')
    if not nga_fid:
        logger.info('NGA: NGA_FORUM_ID not set, skipping')
        return []

    url = f'https://bbs.nga.cn/thread.php?fid={nga_fid}&ajax=1'
    headers = {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
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
                'is_hot': replies > 50,
                'author': thread.get('author', ''),
                'tags': [],
            })
        logger.info(f'NGA: fetched {len(items)} threads')
    except Exception as e:
        logger.warning(f'NGA failed: {e}')

    return items


def fetch_taptap():
    """Fetch TapTap community posts for Morimens."""

    app_id = os.environ.get('TAPTAP_APP_ID', '')
    if not app_id:
        logger.info('TapTap: TAPTAP_APP_ID not set, skipping')
        return []

    items = []
    url = f'https://api.taptap.cn/app/v2/app/{app_id}/topic/list'
    params = {'type': 'hot', 'limit': 20}
    headers = {'User-Agent': 'Mozilla/5.0'}

    try:
        resp = requests.get(url, params=params, headers=headers, timeout=15)
        resp.raise_for_status()
        topics = resp.json().get('data', {}).get('list', [])
        for topic in topics:
            created = datetime.fromtimestamp(topic.get('created_time', 0), tz=timezone.utc)
            if datetime.now(timezone.utc) - created > timedelta(hours=HOURS_LOOKBACK):
                continue
            items.append({
                'title': topic.get('title', ''),
                'summary': topic.get('summary', '')[:200],
                'source': 'taptap',
                'time': created.isoformat(),
                'url': topic.get('share_url', ''),
                'engagement': topic.get('comment_count', 0) + topic.get('like_count', 0),
                'is_hot': topic.get('like_count', 0) > 100,
                'author': topic.get('user', {}).get('name', ''),
                'tags': [],
            })
        logger.info(f'TapTap: fetched {len(items)} topics')
    except Exception as e:
        logger.warning(f'TapTap failed: {e}')

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


def run():
    """Main aggregation pipeline."""
    logger.info('Starting Morimens community news aggregation...')

    all_news = []

    # Fetch from all sources
    fetchers = [
        ('Reddit', fetch_reddit),
        ('Bilibili', fetch_bilibili),
        ('Twitter', fetch_twitter),
        ('NGA', fetch_nga),
        ('TapTap', fetch_taptap),
    ]

    for name, fetcher in fetchers:
        try:
            items = fetcher()
            all_news.extend(items)
            logger.info(f'{name}: {len(items)} items')
        except Exception as e:
            logger.error(f'{name} fetcher crashed: {e}')

    # Deduplicate by title similarity (simple approach)
    seen_titles = set()
    unique_news = []
    for item in all_news:
        title_key = item['title'].lower().strip()[:50]
        if title_key not in seen_titles:
            seen_titles.add(title_key)
            unique_news.append(item)

    # Sort by engagement
    unique_news.sort(key=lambda x: x.get('engagement', 0), reverse=True)

    # Mark top items as hot
    for item in unique_news[:5]:
        item['is_hot'] = True

    # Generate summary
    summary = generate_summary(unique_news)

    # Write output
    output = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'summary': summary,
        'news': unique_news,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    logger.info(f'Done! {len(unique_news)} items written to {OUTPUT_PATH}')


if __name__ == '__main__':
    run()
