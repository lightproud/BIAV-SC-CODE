#!/usr/bin/env python3
"""Per-platform news collectors (Reddit, Bilibili, NGA, TapTap, Steam,
YouTube, Discord). Extracted from aggregator.py; shared helpers/config come
from aggregator_base.
"""

import hashlib
import json
import os
import re
import time
import requests
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from aggregator_base import (
    BILIBILI_MORIMENS_CREATORS, COLLAB_KEYWORDS, HOURS_LOOKBACK,
    MAX_ITEMS_PER_FETCHER, REPO_ROOT, logger, strip_html_tags,
)
import news_common  # 脱敏 + 时间归一单一真源（H3/H4；aggregator_base 已设 sys.path）
from news_common import bilibili_spi_cookies, get_wbi_mixin_key, sign_wbi_params
from sources import REGION_APPS  # 区服 app 标识单一真相源（2026-06-21 采集源命名规范）


def _fetch_reddit_comments(permalink: str, headers: dict, max_comments: int = 10) -> list[dict]:
    """Fetch top comments for a Reddit post. Returns list of {author, text, score}."""
    comments_url = f'https://www.reddit.com{permalink}.json?limit={max_comments}&sort=top'
    try:
        resp = requests.get(comments_url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if len(data) < 2:
            return []
        comment_listing = data[1].get('data', {}).get('children', [])
        results = []
        for c in comment_listing:
            if c.get('kind') != 't1':
                continue
            cd = c['data']
            body = cd.get('body', '')
            if not body or body == '[deleted]' or body == '[removed]':
                continue
            results.append({
                'author': f"u/{cd.get('author', '?')}",
                'text': body,
                'score': cd.get('score', 0),
            })
        return results[:max_comments]
    except Exception:
        return []


def _extract_reddit_media(post_data: dict) -> str:
    """Extract the best image URL from a Reddit post."""
    # Direct image link
    url = post_data.get('url', '')
    if url and any(url.lower().endswith(ext) for ext in ('.jpg', '.jpeg', '.png', '.gif', '.webp')):
        return url
    # Reddit preview images
    preview = post_data.get('preview', {})
    images = preview.get('images', [])
    if images:
        source = images[0].get('source', {})
        if source.get('url'):
            return source['url'].replace('&amp;', '&')
    # Reddit-hosted image
    if post_data.get('post_hint') == 'image' and url:
        return url
    # Thumbnail as last resort (skip default thumbnails)
    thumb = post_data.get('thumbnail', '')
    if thumb and thumb.startswith('http') and thumb not in ('self', 'default', 'nsfw', 'spoiler'):
        return thumb
    return ''


def _fetch_reddit_rss(sub, headers, cutoff):
    """Fetch posts from Reddit RSS feed (more reliable than JSON API)."""
    import xml.etree.ElementTree as ET
    items = []
    # old.reddit.com RSS 比 www.reddit.com 更稳定
    url = f'https://old.reddit.com/r/{sub}/.rss'
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        ns = {'atom': 'http://www.w3.org/2005/Atom'}
        for entry in root.findall('atom:entry', ns):
            title = entry.findtext('atom:title', '', ns).strip()
            link_el = entry.find('atom:link', ns)
            link = link_el.get('href', '') if link_el is not None else ''
            updated = entry.findtext('atom:updated', '', ns)
            author_el = entry.find('atom:author', ns)
            author = author_el.findtext('atom:name', '', ns) if author_el is not None else ''
            content_html = entry.findtext('atom:content', '', ns)

            # Parse time
            try:
                post_time = datetime.fromisoformat(updated.replace('Z', '+00:00'))
            except (ValueError, TypeError):
                continue
            if post_time < cutoff:
                continue

            # Extract text from HTML content
            summary = strip_html_tags(content_html).strip()[:2000] if content_html else ''

            # Extract image from content HTML
            media_url = ''
            import re
            img_match = re.search(r'<img[^>]+src="([^"]+)"', content_html or '')
            if img_match:
                media_url = img_match.group(1)

            item = {
                'title': title,
                'summary': summary,
                'source': 'reddit',
                'time': post_time.isoformat(),
                'url': link,
                'engagement': 0,
                'is_hot': False,
                'author': author,
                'tags': [],
                'metadata': {'via': 'rss'},
            }
            if media_url:
                item['media_url'] = media_url
                item['content_type'] = 'image'
            items.append(item)
        logger.info(f'Reddit r/{sub} (RSS): fetched {len(items)} posts')
    except Exception as e:
        logger.warning(f'Reddit r/{sub} RSS failed: {e}')
    return items


def _fetch_reddit_search(sub, headers, cutoff):
    """Last-resort fallback: use Reddit search to find posts about the subreddit topic."""
    items = []
    try:
        url = f'https://www.reddit.com/search.json'
        params = {
            'q': f'subreddit:{sub} OR {sub}',
            'sort': 'new',
            'limit': 50,
            't': 'week',
        }
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        resp.raise_for_status()
        posts = resp.json().get('data', {}).get('children', []) or []
        for post in posts:
            d = post.get('data', {})
            created = datetime.fromtimestamp(d.get('created_utc', 0), tz=timezone.utc)
            if created < cutoff:
                continue
            permalink = d.get('permalink', '')
            items.append({
                'title': d.get('title', ''),
                'summary': (d.get('selftext', '') or '')[:2000],
                'source': 'reddit',
                'time': created.isoformat(),
                'url': f"https://reddit.com{permalink}",
                'engagement': d.get('score', 0) + d.get('num_comments', 0),
                'is_hot': d.get('score', 0) > 100,
                'author': f"u/{d.get('author', 'unknown')}",
                'tags': [],
                'metadata': {'via': 'search'},
            })
        if items:
            logger.info(f'Reddit search fallback for r/{sub}: {len(items)} posts')
    except Exception as e:
        logger.warning(f'Reddit search fallback for r/{sub} failed: {e}')
    return items


def fetch_reddit(subreddits=None):
    """Fetch hot posts from Reddit with full text, comments, and images.
    Tries JSON API first, falls back to RSS feed if blocked (403)."""
    subreddits = subreddits or ['Morimens', 'MorimensGame']
    items = []
    # Reddit 已屏蔽通用 bot User-Agent，必须使用浏览器 UA。
    # 可通过环境变量 REDDIT_USER_AGENT 覆盖（建议填写「platform:app:version (by /u/username)」格式）。
    default_ua = (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/131.0.0.0 Safari/537.36'
    )
    headers = {
        'User-Agent': os.environ.get('REDDIT_USER_AGENT', default_ua),
        'Accept': 'application/json, text/html;q=0.9, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    cutoff = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)

    for sub in subreddits:
        # old.reddit.com 对非登录流量的封禁比 www 更宽松
        # 分页策略：?limit=100&after=X 一页一页翻，直到看到比 cutoff 更早的帖子就停。
        sub_before_count = len(items)
        after: str | None = None
        page_num = 0
        fatal_error: Exception | None = None
        stopped_by_cutoff = False

        while len(items) - sub_before_count < MAX_ITEMS_PER_FETCHER:
            page_num += 1
            url = f'https://old.reddit.com/r/{sub}/new.json?limit=100'
            if after:
                url += f'&after={after}'
            try:
                resp = requests.get(url, headers=headers, timeout=15)
                resp.raise_for_status()
            except Exception as e:
                fatal_error = e
                break

            data = resp.json().get('data', {})
            posts = data.get('children', []) or []
            if not posts:
                break

            for post in posts:
                d = post['data']
                created = datetime.fromtimestamp(d['created_utc'], tz=timezone.utc)
                if created < cutoff:
                    stopped_by_cutoff = True
                    break

                permalink = d.get('permalink', '')
                # Fetch comments for posts with discussion
                comments = []
                num_comments = d.get('num_comments', 0)
                if num_comments > 0 and permalink:
                    comments = _fetch_reddit_comments(permalink, headers)
                    time.sleep(0.5)  # Rate limit

                # Extract media URL
                media_url = _extract_reddit_media(d)

                # Build comment text for summary
                comment_text = ''
                if comments:
                    lines = [f'  └ {c["author"]} ({c["score"]}pt): {c["text"]}' for c in comments]
                    comment_text = '\n' + '\n'.join(lines)

                item = {
                    'title': d['title'],
                    'summary': (d.get('selftext', '') or '') + comment_text,
                    'source': 'reddit',
                    'time': created.isoformat(),
                    'url': f"https://reddit.com{permalink}",
                    'engagement': d.get('score', 0) + num_comments,
                    'is_hot': d.get('score', 0) > 100,
                    'author': f"u/{d.get('author', 'unknown')}",
                    'tags': list({f.get('text', '') for f in d.get('link_flair_richtext', []) if f.get('text')}),
                    'metadata': {
                        'score': d.get('score', 0),
                        'num_comments': num_comments,
                        'comment_count_fetched': len(comments),
                    },
                }
                if media_url:
                    item['media_url'] = media_url
                    item['content_type'] = 'image'
                items.append(item)

            if stopped_by_cutoff:
                break
            after = data.get('after')
            if not after:
                break
            time.sleep(0.5)  # Rate limit between pages

        sub_added = len(items) - sub_before_count
        if fatal_error is not None and sub_added == 0:
            logger.warning(f'Reddit r/{sub} JSON API failed: {fatal_error}, trying RSS fallback')
            rss_items = _fetch_reddit_rss(sub, headers, cutoff)
            items.extend(rss_items)
            if not rss_items:
                # Last resort: Reddit search endpoint (doesn't require subreddit access)
                logger.warning(f'Reddit r/{sub} RSS also failed, trying search API')
                search_items = _fetch_reddit_search(sub, headers, cutoff)
                items.extend(search_items)
        else:
            media_count = sum(1 for i in items[sub_before_count:] if i.get('media_url'))
            logger.info(
                f'Reddit r/{sub}: fetched {sub_added} posts across {page_num} page(s) '
                f'({media_count} with media)'
            )

    return items


def _fetch_bilibili_comments(aid: int, headers: dict, max_comments: int = 10) -> list[dict]:
    """Fetch top comments for a Bilibili video. Returns list of {author, text, likes}."""
    url = 'https://api.bilibili.com/x/v2/reply'
    params = {'type': 1, 'oid': aid, 'sort': 2, 'ps': max_comments}  # sort=2: by likes
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        resp.raise_for_status()
        replies = resp.json().get('data', {}).get('replies', []) or []
        results = []
        for r in replies[:max_comments]:
            member = r.get('member', {})
            content = r.get('content', {})
            text = content.get('message', '')
            if not text:
                continue
            results.append({
                'author': member.get('uname', '?'),
                'text': text,
                'likes': r.get('like', 0),
            })
        return results
    except Exception:
        return []


def _bilibili_item(v: dict, created: datetime, author: str, headers: dict, source_tag: str = '') -> dict:
    """Build a Bilibili news item with full text, comments, and cover image."""
    bvid = v.get('bvid', '')
    aid = v.get('aid', 0) or v.get('id', 0)
    description = v.get('description', '') or v.get('desc', '') or ''

    # Fetch comments
    comments = []
    comment_count = v.get('comment', 0) or v.get('review', 0) or 0
    if aid and comment_count > 0:
        comments = _fetch_bilibili_comments(aid, headers)
        time.sleep(0.3)

    comment_text = ''
    if comments:
        lines = [f'  └ {c["author"]} ({c["likes"]}赞): {c["text"]}' for c in comments]
        comment_text = '\n' + '\n'.join(lines)

    # Cover image
    pic = v.get('pic', '')
    if pic and not pic.startswith('http'):
        pic = f'https:{pic}'

    play = v.get('play', 0) or v.get('view', 0) or 0
    item = {
        'title': strip_html_tags(v.get('title', '')),
        'summary': description + comment_text,
        'source': 'bilibili',
        'time': created.isoformat(),
        'url': f'https://www.bilibili.com/video/{bvid}' if bvid else v.get('arcurl', ''),
        'engagement': play + comment_count,
        'is_hot': play > 10000,
        'author': author,
        'tags': [v.get('typename', '') or str(v.get('typeid', ''))] if v.get('typename') or v.get('typeid') else [],
        'metadata': {
            'play': play,
            'comment_count': comment_count,
            'comments_fetched': len(comments),
            'danmaku': v.get('danmaku', 0) or v.get('video_review', 0) or 0,
        },
    }
    if pic:
        item['media_url'] = pic
        item['content_type'] = 'image'
    return item


# ── Bilibili wbi 签名 + spi cookie ────────────────────────────────────────────
# B 站 space / 搜索 API 要求 wbi 签名（否则 412），且 2026-06 起对伪造 buvid
# 返回风控 HTML。签名与 spi cookie 实现收敛在 news_common（ARCH-02）。


def _bilibili_headers() -> dict:
    """构造带服务端签发 buvid 的请求头；spi 失败时回退伪造 buvid3（仅尽力而为）。"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com',
    }
    cookies = bilibili_spi_cookies(headers)
    if cookies:
        headers['Cookie'] = '; '.join(f'{k}={v}' for k, v in cookies.items())
    else:
        headers['Cookie'] = f'buvid3={uuid4()}infoc'
    return headers


def _fetch_bilibili_space():
    """Fetch videos from known Morimens creators via space API (primary path)."""
    items = []
    headers = _bilibili_headers()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)
    mixin_key = get_wbi_mixin_key(headers)
    if not mixin_key:
        logger.warning('Bilibili wbi key fetch failed (no cache)')

    for idx, (mid, creator_name) in enumerate(BILIBILI_MORIMENS_CREATORS.items()):
        if idx > 0:
            time.sleep(0.6)
        # 分页抓取：ps=50 一页，按 pubdate 倒序，遇到早于 cutoff 或空页即停
        creator_before_count = len(items)
        page = 0
        stopped_by_cutoff = False
        fatal_error = None

        while len(items) - creator_before_count < MAX_ITEMS_PER_FETCHER:
            page += 1
            url = 'https://api.bilibili.com/x/space/wbi/arc/search'
            params = {
                'mid': mid,
                'pn': page,
                'ps': 50,
                'order': 'pubdate',
            }
            if mixin_key:
                params = sign_wbi_params(params, mixin_key)
            try:
                resp = requests.get(url, params=params, headers=headers, timeout=15)
                if resp.status_code == 412:
                    logger.warning(f'Bilibili space {creator_name}({mid}): 412 even with wbi sign, falling back to search')
                    fatal_error = 'wbi-412'
                    break
                resp.raise_for_status()
            except Exception as e:
                fatal_error = e
                logger.debug(f'Bilibili space {creator_name}({mid}) page {page} failed: {e}')
                break

            try:
                vlist = resp.json().get('data', {}).get('list', {}).get('vlist', []) or []
            except ValueError:
                logger.warning(f'Bilibili space {creator_name}({mid}): non-JSON response (risk control?)')
                fatal_error = 'non-json'
                break
            if not vlist:
                break

            for v in vlist:
                pubdate = v.get('created', 0)
                created = datetime.fromtimestamp(pubdate, tz=timezone.utc) if pubdate else None
                if not created:
                    continue
                if created < cutoff:
                    stopped_by_cutoff = True
                    break
                items.append(_bilibili_item(v, created, v.get('author', creator_name), headers))

            if stopped_by_cutoff or len(vlist) < 50:
                break
            time.sleep(0.6)

        added = len(items) - creator_before_count
        if fatal_error is None or added > 0:
            logger.info(
                f'Bilibili space {creator_name}({mid}): {added} videos in {HOURS_LOOKBACK}h '
                f'across {page} page(s)'
            )

    return items


def _fetch_bilibili_search():
    """Fetch Bilibili search results for Morimens keywords (fallback path).

    搜索接口需 wbi 签名 + 服务端签发 buvid，否则返回风控 HTML（曾导致
    `Expecting value` 崩溃并拖死整条管线）。非 JSON 响应按失败处理，不再抛出。
    """
    items = []
    headers = _bilibili_headers()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)
    mixin_key = get_wbi_mixin_key(headers)

    search_keywords = ['忘却前夜', '忘卻前夜'] + [k for k in COLLAB_KEYWORDS if k.strip()]
    for idx, keyword in enumerate(search_keywords):
        if idx > 0:
            time.sleep(0.6)
        # 分页抓取：按 pubdate 排序，翻到越过 cutoff 或空页为止
        kw_before_count = len(items)
        page = 0
        pages_fetched = 0
        stopped_by_cutoff = False

        while len(items) - kw_before_count < MAX_ITEMS_PER_FETCHER:
            page += 1
            url = 'https://api.bilibili.com/x/web-interface/wbi/search/type'
            params = {
                'search_type': 'video',
                'keyword': keyword,
                'order': 'pubdate',
                'duration': 0,
                'page': page,
            }
            if mixin_key:
                params = sign_wbi_params(params, mixin_key)
            try:
                resp = requests.get(url, params=params, headers=headers, timeout=15)
                if resp.status_code == 412:
                    logger.debug(f'Bilibili search "{keyword}" page {page}: 412, retrying after 2s')
                    time.sleep(2)
                    resp = requests.get(url, params=params, headers=headers, timeout=15)
                resp.raise_for_status()
            except Exception as e:
                logger.warning(f'Bilibili search "{keyword}" page {page} failed: {e}')
                break

            try:
                results = resp.json().get('data', {}).get('result', []) or []
            except ValueError:
                logger.warning(
                    f'Bilibili search "{keyword}" page {page}: non-JSON response '
                    f'(risk control?), treating as empty'
                )
                break
            if not results:
                break
            pages_fetched += 1

            for v in results:
                pubdate = v.get('pubdate', 0)
                created = datetime.fromtimestamp(pubdate, tz=timezone.utc) if pubdate else None
                if not created:
                    continue
                if created < cutoff:
                    stopped_by_cutoff = True
                    break
                items.append(_bilibili_item(v, created, v.get('author', ''), headers))

            if stopped_by_cutoff:
                break
            time.sleep(0.6)

        added = len(items) - kw_before_count
        logger.info(f'Bilibili search "{keyword}": fetched {added} videos across {pages_fetched} page(s)')

    return items


def fetch_bilibili():
    """Fetch Bilibili videos: space API (primary) with search API as fallback."""
    items = _fetch_bilibili_space()
    if not items:
        logger.info('Bilibili: space API returned 0 items, falling back to search API')
        items = _fetch_bilibili_search()
    return items


# 网页端同源 API 需携带 X-UA query 标识客户端；值取自 www.taptap.cn 网页端请求。
_TAPTAP_XUA = ('V=1&PN=WebApp&LANG=zh_CN&VN_CODE=102&VN=0.1.0&LOC=CN'
               '&PLT=PC&DS=Android&UID=x&OS=Windows&OSV=10&DT=PC')


def fetch_taptap():
    """Fetch TapTap reviews for Morimens (app 364992 @ www.taptap.cn).

    旧 api.taptap.cn / api.taptap.io 域名已下线（DNS 不再解析），改走网页端
    同源接口 www.taptap.cn/webapiv2。注意 sort=new 排序非严格时间序（编辑过的
    旧评价会插队），因此固定扫描数页后按 cutoff 过滤，而不是遇旧即停。
    """
    app_id = os.environ.get('TAPTAP_APP_ID') or '364992'
    cutoff = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)
    items = []
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': 'https://www.taptap.cn/',
    }

    offset = 0
    for _ in range(3):  # 3 页 x 10 条，覆盖 24h 窗口绰绰有余
        try:
            resp = requests.get(
                'https://www.taptap.cn/webapiv2/review/v2/list-by-app',
                params={'app_id': app_id, 'from': offset, 'limit': 10,
                        'sort': 'new', 'X-UA': _TAPTAP_XUA},
                headers=headers, timeout=15,
            )
            resp.raise_for_status()
            entries = resp.json().get('data', {}).get('list', []) or []
        except Exception as e:
            logger.warning(f'TapTap webapiv2 failed: {e}')
            break
        if not entries:
            break

        for entry in entries:
            moment = entry.get('moment', {}) or {}
            review = moment.get('review', {}) or {}
            ts = moment.get('publish_time') or moment.get('created_time')
            if not ts:
                continue
            created = datetime.fromtimestamp(ts, tz=timezone.utc)
            if created < cutoff:
                continue
            text = strip_html_tags((review.get('contents', {}) or {}).get('text', '') or '')
            if not text:
                continue
            score = review.get('score', 0) or 0
            sentiment = '好评' if score >= 4 else '差评' if score <= 2 else '中评'
            moment_id = moment.get('id_str', '')
            items.append({
                'title': f'[TapTap {sentiment}] {text[:60]}',
                'summary': text,
                'source': 'taptap',
                'time': created.isoformat(),
                'url': (f'https://www.taptap.cn/moment/{moment_id}' if moment_id
                        else f'https://www.taptap.cn/app/{app_id}/review'),
                'engagement': (moment.get('stat') or {}).get('ups', 0) or 0,
                'author': ((moment.get('author') or {}).get('user') or {}).get('name', ''),
                'tags': [sentiment],
            })

        offset += 10
        time.sleep(0.5)

    review_count = len(items)

    # ARCH-01 收敛（decisions.md 2026-06-20，守密人「GC 功能合并到 AC」）：吸收 GC 栈
    # 独有的 topic 帖子能力（AC 原本仅评价）。topic 经 taptap_collector（Playwright）抓取；
    # 评价优先用上面 webapiv2 富字段版，仅当 webapiv2 空时回退取 collector 的评价。
    # Playwright 不可用（如纯 CI/测试环境）时静默跳过 topic，不影响 webapiv2 评价。
    try:
        import asyncio
        import taptap_collector as _tc
        topic_items, pw_reviews = asyncio.run(_tc.collect(cutoff=cutoff))
        items.extend(topic_items)
        if review_count == 0:
            items.extend(pw_reviews)
        logger.info(
            f'TapTap: + {len(topic_items)} topic posts'
            + ('' if review_count else f' + {len(pw_reviews)} fallback reviews')
            + ' (taptap_collector)'
        )
    except ImportError:
        logger.info('TapTap: taptap_collector/playwright unavailable, topic posts skipped')
    except Exception as e:
        logger.warning(f'TapTap topic collect failed: {e}')

    logger.info(f'TapTap: fetched {len(items)} items ({review_count} webapiv2 reviews)')
    return items


def fetch_steam_reviews():
    """Fetch Steam reviews across all configured regions（甲方案：双 appid global/jp，归档子类 review）。"""
    items = []
    for region, app_id in REGION_APPS.get('steam', {'global': '3052450'}).items():
        items.extend(_fetch_steam_reviews_one(str(app_id), region))
    return items


def _fetch_steam_reviews_one(app_id, region):
    """Fetch recent Steam reviews for one (app_id, region).

    使用 cursor=* 分页一直翻到时间窗口外为止。Steam 按 recent 排序，
    一旦看到早于 cutoff 的 review 就可以停。
    """
    import subprocess as _sp
    from urllib.parse import quote
    cutoff = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)
    items = []
    cursor = '*'
    page = 0
    stopped_by_cutoff = False

    try:
        while len(items) < MAX_ITEMS_PER_FETCHER:
            page += 1
            url = (
                f'https://store.steampowered.com/appreviews/{app_id}'
                f'?json=1&filter=recent&num_per_page=100&language=all&purchase_type=all'
                f'&cursor={quote(cursor, safe="")}'
            )
            result = _sp.run(
                ['curl', '-s', '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)', url],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode != 0:
                logger.warning(f'Steam curl failed on page {page}: {result.stderr[:200]}')
                break
            if not result.stdout.strip():
                logger.warning(f'Steam curl empty body on page {page}')
                break
            data = json.loads(result.stdout)
            reviews = data.get('reviews', []) or []
            if not reviews:
                break

            for review in reviews:
                ts = review.get('timestamp_created', 0)
                created = datetime.fromtimestamp(ts, tz=timezone.utc)
                if created < cutoff:
                    stopped_by_cutoff = True
                    break

                language = review.get('language', 'unknown')
                voted_up = review.get('voted_up', False)
                sentiment = '正面' if voted_up else '负面'
                review_text = review.get('review', '')
                summary_text = review_text[:50].strip()
                title = f'[{sentiment}] {summary_text}...' if len(review_text) > 50 else f'[{sentiment}] {summary_text}'

                author_info = review.get('author', {})
                steamid = author_info.get('steamid', '')
                review_url = f'https://steamcommunity.com/profiles/{steamid}/recommended/{app_id}'
                votes_up = review.get('votes_up', 0)

                items.append({
                    'title': title,
                    'summary': review_text,
                    'source': 'steam_review',
                    'region': region,             # 甲方案：global/jp 区服
                    'archive_subtype': 'review',  # 归档 steam/<区服>/review
                    'time': created.isoformat(),
                    'url': review_url,
                    'engagement': votes_up,
                    'is_hot': votes_up > 10,
                    'author': steamid,
                    'tags': [language],
                    'language': language,
                    'metadata': {
                        'voted_up': voted_up,
                        'playtime_forever': author_info.get('playtime_forever', 0),
                        'votes_up': votes_up,
                        'timestamp_created': ts,
                    },
                })

            if stopped_by_cutoff:
                break
            next_cursor = data.get('cursor')
            # cursor 不变或缺失 → 已到末尾
            if not next_cursor or next_cursor == cursor:
                break
            cursor = next_cursor
            time.sleep(0.5)

        if len(items) == 0:
            logger.warning(f'Steam Reviews: 0 reviews found in last {HOURS_LOOKBACK}h (data source not blocked)')
        else:
            logger.info(f'Steam Reviews: fetched {len(items)} reviews in last {HOURS_LOOKBACK}h across {page} page(s)')
    except Exception as e:
        logger.warning(f'Steam Reviews failed: {e}')

    return items


def fetch_steam_news():
    """Fetch Steam official news across all configured regions（甲方案：双 appid，归档子类 news）。"""
    items = []
    for region, app_id in REGION_APPS.get('steam', {'global': '3052450'}).items():
        items.extend(_fetch_steam_news_one(str(app_id), region))
    return items


def _fetch_steam_news_one(app_id, region):
    """Fetch official Steam news/announcements for one (app_id, region).

    官方公告本身频率较低，通用 HOURS_LOOKBACK（24h）会经常过滤掉全部内容。
    使用更宽的 OFFICIAL_HOURS_LOOKBACK（默认 30 天）以保证日报至少能看到近期官方动态。
    """
    # Steam News 单次 API 调用即可拿足 30 天窗口；count=100 保证不截断。
    url = f'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid={app_id}&count=100&maxlength=500'
    official_hours = int(os.environ.get('OFFICIAL_HOURS_LOOKBACK', max(HOURS_LOOKBACK, 30 * 24)))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=official_hours)
    items = []

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        news_items = resp.json().get('appnews', {}).get('newsitems', [])

        for n in news_items:
            ts = n.get('date', 0)
            created = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else None
            if not created or created < cutoff:
                continue

            feed_type = n.get('feed_type', 0)
            feed_label = {0: '公告', 1: '新闻'}.get(feed_type, '资讯')

            items.append({
                'title': f'[Steam{feed_label}] {strip_html_tags(n.get("title", ""))}',
                'summary': strip_html_tags(n.get('contents', '')),
                'source': 'official',
                'region': region,            # 甲方案：global/jp 区服
                'archive_subtype': 'news',   # 归档 steam/<区服>/news（official 折叠到 steam）
                'time': created.isoformat(),
                'url': n.get('url', ''),
                'engagement': 0,
                'is_hot': True,  # Official announcements are always marked hot
                'author': n.get('author', 'Steam'),
                'tags': [n.get('feedlabel', '')],
            })

        logger.info(f'Steam News: fetched {len(items)} announcements')
    except Exception as e:
        logger.warning(f'Steam News failed: {e}')

    return items


def fetch_steam_discussions(max_pages: int = 3):
    """Fetch Steam discussions across all configured regions（甲方案：双 appid，归档子类 discussion）。"""
    items = []
    for region, app_id in REGION_APPS.get('steam', {'global': '3052450'}).items():
        items.extend(_fetch_steam_discussions_one(str(app_id), region, max_pages=max_pages))
    return items


def _fetch_steam_discussions_one(app_id, region, max_pages: int = 3):
    """Fetch recent Steam Community discussions for one (app_id, region).

    Steam has no public API for discussions, so we scrape the HTML listing page
    (默认按最后回复时间倒序，15 帖/页，?fp=N 翻页)。2026-06 实测 DOM：
    每帖为 <div class="forum_topic ..."> 块，内含 forum_topic_overlay 链接、
    forum_topic_name 标题、forum_topic_op 楼主、forum_topic_lastpost 的
    data-timestamp 真实时间戳，以及 data-tooltip-forum 里的正文预览。
    """
    import html as _html
    import re as _re

    base_url = f'https://steamcommunity.com/app/{app_id}/discussions/0/'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,ko;q=0.7,ja;q=0.6',
    }
    cutoff = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)
    items = []
    stopped_by_cutoff = False

    try:
        for page in range(1, max_pages + 1):
            url = base_url if page == 1 else f'{base_url}?fp={page}'
            resp = requests.get(url, headers=headers, timeout=30)
            resp.raise_for_status()
            html = resp.text

            # 按 forum_topic 块切分（每块以下一个块或容器结束为界）
            blocks = _re.split(r'<div[^>]+class="forum_topic\s', html)[1:]
            page_added = 0
            for block in blocks:
                m_url = _re.search(
                    r'class="forum_topic_overlay"\s+href="(https://steamcommunity\.com/app/\d+/discussions/[^"]+)"',
                    block)
                m_title = _re.search(r'class="forum_topic_name\s*"[^>]*>\s*(.*?)\s*</div>', block, _re.DOTALL)
                if not m_url or not m_title:
                    continue
                title = strip_html_tags(m_title.group(1)).strip()
                if not title:
                    continue

                m_replies = _re.search(r'class="forum_topic_reply_count">.*?>\s*([\d,]+)\s*</div>', block, _re.DOTALL)
                replies = int(m_replies.group(1).replace(',', '')) if m_replies else 0

                m_ts = _re.search(r'class="forum_topic_lastpost"[^>]*data-timestamp="(\d+)"', block)
                if m_ts:
                    lastpost = datetime.fromtimestamp(int(m_ts.group(1)), tz=timezone.utc)
                    if lastpost < cutoff:
                        stopped_by_cutoff = True
                        break
                    time_str, approx = lastpost.isoformat(), False
                else:
                    time_str, approx = datetime.now(timezone.utc).isoformat(), True

                m_author = _re.search(r'class="forum_topic_op"[^>]*>\s*([^<]+?)\s*</div>', block)
                author = m_author.group(1).strip() if m_author else ''

                # 正文预览藏在 data-tooltip-forum 的转义 HTML 里
                summary = ''
                m_hover = _re.search(r'data-tooltip-forum="(.*?)">', block, _re.DOTALL)
                if m_hover:
                    hover = _html.unescape(m_hover.group(1))
                    m_text = _re.search(r'class="topic_hover_text"\s*>\s*(.*?)\s*</div>', hover, _re.DOTALL)
                    if m_text:
                        summary = _html.unescape(strip_html_tags(m_text.group(1))).strip()[:500]

                item = {
                    'title': f'[Steam论坛] {title}',
                    'summary': summary,
                    'source': 'steam_discussion',
                    'region': region,                # 甲方案：global/jp 区服
                    'archive_subtype': 'discussion', # 归档 steam/<区服>/discussion
                    'time': time_str,
                    'url': m_url.group(1),
                    'engagement': replies,
                    'is_hot': replies >= 10,
                    'author': author,
                    'tags': ['steam_forum'],
                }
                if approx:
                    item['time_is_approximate'] = True
                items.append(item)
                page_added += 1

            if stopped_by_cutoff or page_added == 0:
                break
            time.sleep(0.5)

        logger.info(f'Steam Discussions: fetched {len(items)} threads')
    except Exception as e:
        logger.warning(f'Steam Discussions failed: {e}')

    return items


def _parse_yt_relative_time(text):
    """Parse YouTube relative time strings like '2 days ago' into ISO datetime.

    Returns (iso_string, is_approximate) tuple. 解析委托
    news_common.parse_relative_time（H4 收敛）；YouTube 网页相对时间精度有限，
    一律标记 is_approximate=True（保持原行为）。
    """
    return news_common.parse_relative_time(text)[0], True


def _fetch_youtube_web_search():
    """Scrape YouTube search results page when no API key is available.

    Fetches the YouTube search page for Morimens-related keywords, extracts
    the embedded ytInitialData JSON, and parses video results from it.
    Returns a list of item dicts compatible with the aggregator format.
    """
    items = []
    seen_ids = set()
    yt_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    }

    for keyword in ['Morimens', '忘却前夜']:
        search_url = f'https://www.youtube.com/results?search_query={requests.utils.quote(keyword)}'
        try:
            resp = requests.get(search_url, timeout=20, headers=yt_headers)
            resp.raise_for_status()
            html = resp.text

            # Extract ytInitialData JSON blob from the page
            yt_data_match = re.search(
                r'var\s+ytInitialData\s*=\s*(\{.*?\});\s*</script>', html, re.DOTALL)
            if not yt_data_match:
                # Alternative pattern: some pages use a different assignment
                yt_data_match = re.search(
                    r'window\["ytInitialData"\]\s*=\s*(\{.*?\});\s*', html, re.DOTALL)
            if not yt_data_match:
                logger.warning(f'YouTube scrape "{keyword}": could not find ytInitialData')
                continue

            try:
                yt_data = json.loads(yt_data_match.group(1))
            except (json.JSONDecodeError, ValueError):
                logger.warning(f'YouTube scrape "{keyword}": failed to parse ytInitialData JSON')
                continue

            # Navigate the nested structure to find video renderers
            # Path: contents.twoColumnSearchResultsRenderer.primaryContents
            #        .sectionListRenderer.contents[].itemSectionRenderer
            #        .contents[].videoRenderer
            video_renderers = []
            try:
                sections = (yt_data.get('contents', {})
                            .get('twoColumnSearchResultsRenderer', {})
                            .get('primaryContents', {})
                            .get('sectionListRenderer', {})
                            .get('contents', []))
                for section in sections:
                    section_contents = (section.get('itemSectionRenderer', {})
                                        .get('contents', []))
                    for item in section_contents:
                        if 'videoRenderer' in item:
                            video_renderers.append(item['videoRenderer'])
            except (AttributeError, TypeError, KeyError):
                pass

            # Fallback: extract via regex if structured navigation fails
            if not video_renderers:
                video_ids_raw = re.findall(r'"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"', html)
                titles_raw = re.findall(
                    r'"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"]*)"',
                    html,
                )
                for i, vid in enumerate(video_ids_raw):
                    if vid in seen_ids:
                        continue
                    seen_ids.add(vid)
                    title = titles_raw[i] if i < len(titles_raw) else ''
                    if not title:
                        continue
                    yt_item = {
                        'title': title,
                        'summary': '',
                        'source': 'youtube',
                        'time': datetime.now(timezone.utc).isoformat(),
                        'time_is_approximate': True,
                        'url': f'https://www.youtube.com/watch?v={vid}',
                        'engagement': 0,
                        'author': '',
                        'tags': ['youtube', 'scrape'],
                    }
                    yt_item['media_url'] = f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg'
                    yt_item['content_type'] = 'image'
                    items.append(yt_item)
                logger.info(f'YouTube scrape "{keyword}" (regex fallback): {len(items)} videos')
                continue

            # Process structured video renderers
            for vr in video_renderers:
                try:
                    vid = vr.get('videoId', '')
                    if not vid or vid in seen_ids:
                        continue
                    seen_ids.add(vid)

                    # Title
                    title = ''
                    title_runs = vr.get('title', {}).get('runs', [])
                    if title_runs:
                        title = title_runs[0].get('text', '')
                    if not title:
                        title = vr.get('title', {}).get('simpleText', '')
                    if not title:
                        continue

                    # Channel name
                    author = ''
                    try:
                        channel_runs = vr.get('ownerText', {}).get('runs', [])
                        if channel_runs:
                            author = channel_runs[0].get('text', '')
                    except (AttributeError, TypeError, IndexError):
                        pass

                    # View count for rough engagement
                    engagement = 0
                    try:
                        view_text = vr.get('viewCountText', {}).get('simpleText', '')
                        view_match = re.search(r'([\d,]+)', view_text.replace(',', ''))
                        if view_match:
                            engagement = int(view_match.group(1))
                    except (ValueError, AttributeError, TypeError):
                        pass

                    # Published time text (relative, e.g. "2 days ago")
                    published_text = ''
                    try:
                        published_text = vr.get('publishedTimeText', {}).get('simpleText', '')
                    except (AttributeError, TypeError):
                        pass

                    # Description snippet
                    desc = ''
                    try:
                        desc_snippets = vr.get('detailedMetadataSnippets', [])
                        if desc_snippets:
                            snippet_runs = desc_snippets[0].get('snippetText', {}).get('runs', [])
                            desc = ''.join(r.get('text', '') for r in snippet_runs)
                    except (AttributeError, TypeError, IndexError, KeyError):
                        pass

                    # Thumbnail
                    thumb = ''
                    try:
                        thumbs = vr.get('thumbnail', {}).get('thumbnails', [])
                        thumb = thumbs[-1].get('url', '') if thumbs else ''
                    except (AttributeError, TypeError, IndexError):
                        pass
                    if not thumb:
                        thumb = f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg'

                    summary = desc
                    if published_text:
                        summary = f'[{published_text}] {desc}' if desc else published_text

                    parsed_time, time_approx = _parse_yt_relative_time(published_text)
                    yt_item = {
                        'title': title,
                        'summary': summary,
                        'source': 'youtube',
                        'time': parsed_time,
                        'time_is_approximate': time_approx,
                        'url': f'https://www.youtube.com/watch?v={vid}',
                        'engagement': engagement,
                        'is_hot': engagement > 5000,
                        'author': author,
                        'tags': ['youtube', 'scrape'],
                    }
                    if thumb:
                        yt_item['media_url'] = thumb
                        yt_item['content_type'] = 'image'
                    items.append(yt_item)
                except Exception:
                    # Skip individual video renderers that fail to parse
                    continue

            logger.info(
                f'YouTube scrape "{keyword}" (structured): '
                f'{len(video_renderers)} renderers, {len(items)} total videos')
        except Exception as e:
            logger.warning(f'YouTube scrape "{keyword}" failed: {e}')

    return items


def fetch_youtube():
    """Fetch Morimens-related YouTube videos.

    Uses YouTube Data API v3 if YOUTUBE_API_KEY is set.
    Falls back to free RSS feeds for known channels (no API key needed),
    then to web search scraping as a last resort.
    """
    api_key = os.environ.get('YOUTUBE_API_KEY')
    items = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)

    # Known Morimens-related YouTube channels (add more as discovered)
    MORIMENS_CHANNELS = {
        # Channel ID → display name
        # Official channel (if exists) and known content creators
    }
    channel_id = os.environ.get('YOUTUBE_CHANNEL_ID', '')
    if channel_id:
        MORIMENS_CHANNELS[channel_id] = 'Official'

    if api_key:
        # Full API path: search + statistics
        for keyword in ['Morimens', '忘却前夜']:
            try:
                published_after = cutoff.strftime('%Y-%m-%dT%H:%M:%SZ')
                resp = requests.get(
                    'https://www.googleapis.com/youtube/v3/search',
                    params={
                        'part': 'snippet', 'q': keyword, 'type': 'video',
                        'order': 'date', 'publishedAfter': published_after,
                        'maxResults': 15, 'key': api_key,
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()
                video_ids = [i['id']['videoId'] for i in data.get('items', []) if i.get('id', {}).get('videoId')]

                # Fetch stats in batch
                stats = {}
                if video_ids:
                    stats_resp = requests.get(
                        'https://www.googleapis.com/youtube/v3/videos',
                        params={'part': 'statistics', 'id': ','.join(video_ids), 'key': api_key},
                        timeout=15,
                    )
                    if stats_resp.ok:
                        for v in stats_resp.json().get('items', []):
                            s = v.get('statistics', {})
                            stats[v['id']] = int(s.get('viewCount', 0)) + int(s.get('likeCount', 0))

                for item in data.get('items', []):
                    vid = item.get('id', {}).get('videoId')
                    if not vid:
                        continue
                    snippet = item.get('snippet', {})
                    engagement = stats.get(vid, 0)
                    thumb = snippet.get('thumbnails', {}).get('high', {}).get('url', '')
                    yt_item = {
                        'title': snippet.get('title', ''),
                        'summary': snippet.get('description', ''),
                        'source': 'youtube',
                        'time': snippet.get('publishedAt', ''),
                        'url': f'https://www.youtube.com/watch?v={vid}',
                        'engagement': engagement,
                        'is_hot': engagement > 5000,
                        'author': snippet.get('channelTitle', ''),
                        'tags': [],
                    }
                    if thumb:
                        yt_item['media_url'] = thumb
                        yt_item['content_type'] = 'image'
                    items.append(yt_item)
                logger.info(f'YouTube API "{keyword}": {len(items)} videos')
            except Exception as e:
                # H3: 异常文本含完整请求 URL（key=<API key>），脱敏后再进公开日志
                logger.warning(f'YouTube API "{keyword}" failed: {news_common.redact_secrets(e)}')
    else:
        logger.info('YouTube: no API key, trying RSS fallback for known channels')

        # RSS fallback: free, no API key, works for specific channels
        # YouTube RSS format: https://www.youtube.com/feeds/videos.xml?channel_id=...
        if MORIMENS_CHANNELS:
            import xml.etree.ElementTree as ET
            for ch_id, ch_name in MORIMENS_CHANNELS.items():
                rss_url = f'https://www.youtube.com/feeds/videos.xml?channel_id={ch_id}'
                try:
                    resp = requests.get(rss_url, timeout=15, headers={'User-Agent': 'MorimensAggregator/1.0'})
                    resp.raise_for_status()
                    root = ET.fromstring(resp.text)
                    ns = {'atom': 'http://www.w3.org/2005/Atom', 'media': 'http://search.yahoo.com/mrss/'}
                    for entry in root.findall('atom:entry', ns):
                        published = entry.findtext('atom:published', '', ns)
                        try:
                            pub_dt = datetime.fromisoformat(published.replace('Z', '+00:00'))
                        except (ValueError, TypeError):
                            continue
                        if pub_dt < cutoff:
                            continue
                        title = entry.findtext('atom:title', '', ns)
                        link_el = entry.find('atom:link', ns)
                        link = link_el.get('href', '') if link_el is not None else ''
                        author = entry.findtext('atom:author/atom:name', ch_name, ns)
                        media_group = entry.find('media:group', ns)
                        thumb = ''
                        desc = ''
                        if media_group is not None:
                            thumb_el = media_group.find('media:thumbnail', ns)
                            if thumb_el is not None:
                                thumb = thumb_el.get('url', '')
                            desc = media_group.findtext('media:description', '', ns)
                        yt_item = {
                            'title': title,
                            'summary': desc,
                            'source': 'youtube',
                            'time': pub_dt.isoformat(),
                            'url': link,
                            'engagement': 0,
                            'author': author,
                            'tags': ['youtube', 'rss'],
                        }
                        if thumb:
                            yt_item['media_url'] = thumb
                            yt_item['content_type'] = 'image'
                        items.append(yt_item)
                    logger.info(f'YouTube RSS {ch_name}({ch_id}): {len(items)} videos')
                except Exception as e:
                    logger.warning(f'YouTube RSS {ch_name}({ch_id}) failed: {e}')

    # Web scraping fallback: search YouTube directly when no API key and
    # RSS returned nothing (empty MORIMENS_CHANNELS or no recent videos).
    if not items and not api_key:
        logger.info('YouTube: trying web scraping fallback via search page')
        items = _fetch_youtube_web_search()

    if not items:
        logger.info('YouTube: 0 items (no API key, no known channels, scraping returned nothing)')
    return items


def _load_discord_channel_index():
    """Load channel_index.json and build channel_id→name + dir→channel_id maps."""
    index_path = REPO_ROOT / 'projects' / 'news' / 'data' / 'discord' / 'channel_index.json'
    ch_names: dict[str, str] = {}   # channel_id → channel_name
    dir_to_id: dict[str, str] = {}  # dir_suffix → channel_id
    if index_path.exists():
        try:
            with open(index_path, 'r', encoding='utf-8') as f:
                index = json.load(f)
            for cid, info in index.items():
                ch_names[cid] = info.get('name', cid)
                dir_to_id[info.get('dir', '')] = cid
        except Exception:
            pass
    return ch_names, dir_to_id


def _read_discord_jsonl(date_str: str):
    """Read all JSONL archives for a given date across all channels.
    Returns list of message dicts with channel_name annotated."""
    channels_dir = REPO_ROOT / 'projects' / 'news' / 'data' / 'discord' / 'channels'
    ch_names, dir_to_id = _load_discord_channel_index()
    messages = []
    if not channels_dir.exists():
        return messages
    for ch_dir in channels_dir.iterdir():
        if not ch_dir.is_dir():
            continue
        jsonl_path = ch_dir / f'{date_str}.jsonl'
        if not jsonl_path.exists():
            continue
        dir_suffix = ch_dir.name
        channel_id = dir_to_id.get(dir_suffix, '')
        channel_name = ch_names.get(channel_id, dir_suffix)
        try:
            with open(jsonl_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    msg = json.loads(line)
                    msg['_channel_name'] = channel_name
                    messages.append(msg)
        except Exception as e:
            logger.warning(f'Discord JSONL read error {jsonl_path}: {e}')
    return messages


def _build_reply_chains(messages: list[dict], target_ids: set[str], max_depth: int = 5):
    """Build reply chains for target messages. Returns {msg_id: [reply_msgs]}."""
    by_id = {m['id']: m for m in messages}
    # Find direct replies to target messages
    replies_to: dict[str, list[dict]] = {}
    for msg in messages:
        parent_id = msg.get('reply_to')
        if parent_id and parent_id in target_ids:
            replies_to.setdefault(parent_id, []).append(msg)
    # Sort each chain by timestamp and limit
    for mid in replies_to:
        replies_to[mid] = sorted(
            replies_to[mid], key=lambda m: m.get('timestamp', '')
        )[:max_depth]
    return replies_to


def fetch_discord_local():
    """
    Read today's Discord JSONL archives for full-text community intelligence.
    Produces: 1 summary item + top-engagement messages with full content,
    reply chains (up to 5 replies), and attachment info.
    No API calls — purely local file reads from the archiver's output.
    """
    discord_dir = REPO_ROOT / 'projects' / 'news' / 'data' / 'discord'
    today_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    yesterday_str = (datetime.now(timezone.utc) - timedelta(days=1)).strftime('%Y-%m-%d')
    items = []
    guild_id = os.environ.get('DISCORD_GUILD_ID', '1131791637933199470')

    # ── 1. Daily stats summary (unchanged) ───────────────────────────────────
    stats_path = discord_dir / 'activity_daily' / f'{today_str}.json'
    data_date = today_str
    if not stats_path.exists():
        stats_path = discord_dir / 'activity_daily' / f'{yesterday_str}.json'
        data_date = yesterday_str
    if stats_path.exists():
        try:
            with open(stats_path, 'r', encoding='utf-8') as f:
                stats = json.load(f)
            msg_count = stats.get('messages', 0)
            authors = stats.get('unique_authors', 0)
            reactions = stats.get('reactions_total', 0)
            ch_activity = stats.get('channel_activity', {})
            top_channels = sorted(ch_activity.items(), key=lambda x: x[1], reverse=True)[:5]
            ch_summary = '、'.join(f'{ch}({cnt})' for ch, cnt in top_channels)
            items.append({
                'title': f'Discord 社区日报 ({data_date})',
                'summary': f'今日 {msg_count:,} 条消息，{authors} 位活跃用户，{reactions:,} 次反应。热门频道：{ch_summary}',
                'source': 'discord',
                'time': f'{data_date}T00:00:00+00:00',
                'url': f'https://discord.com/channels/{guild_id}',
                'engagement': msg_count,
                'author': 'Discord Archiver',
                'tags': ['discord', 'daily-summary'],
            })
        except Exception as e:
            logger.warning(f'Discord local: failed to read stats: {e}')

    # ── 2. Full-text extraction from JSONL archives ──────────────────────────
    all_msgs = _read_discord_jsonl(data_date)
    if not all_msgs:
        logger.info(f'Discord local: no JSONL data for {data_date}')
        return items

    # Skip bot messages for ranking
    human_msgs = [m for m in all_msgs if not m.get('author_bot', False)]

    # Score each message: reactions + reply_count (as proxy for engagement)
    reply_counts: dict[str, int] = {}
    for m in human_msgs:
        parent = m.get('reply_to')
        if parent:
            reply_counts[parent] = reply_counts.get(parent, 0) + 1

    scored: list[tuple[int, dict]] = []
    for m in human_msgs:
        react_total = sum(r.get('count', 0) for r in m.get('reactions', []))
        replies = reply_counts.get(m['id'], 0)
        score = react_total * 3 + replies * 2 + len(m.get('attachments', []))
        if score >= 3 or react_total >= 2:
            scored.append((score, m))

    scored.sort(key=lambda x: x[0], reverse=True)
    top_msgs = scored[:15]  # Top 15 messages by engagement

    if not top_msgs:
        logger.info(f'Discord local: {len(items)} items (no high-engagement messages)')
        return items

    # Build reply chains for top messages
    target_ids = {m['id'] for _, m in top_msgs}
    reply_chains = _build_reply_chains(all_msgs, target_ids)

    for score, msg in top_msgs:
        content = msg.get('content', '')
        author = msg.get('author_name', '?')
        channel = msg.get('_channel_name', '')
        channel_id = msg.get('channel_id', '')
        msg_id = msg.get('id', '')
        msg_time = msg.get('timestamp', datetime.now(timezone.utc).isoformat())
        react_total = sum(r.get('count', 0) for r in msg.get('reactions', []))

        # Format attachment info
        attachments = msg.get('attachments', [])
        attach_info = ''
        if attachments:
            attach_names = [a.get('filename', '?') for a in attachments]
            attach_info = f'\n[附件: {", ".join(attach_names)}]'

        # Format reply chain
        replies = reply_chains.get(msg_id, [])
        reply_text = ''
        if replies:
            reply_lines = []
            for r in replies:
                r_author = r.get('author_name', '?')
                r_content = r.get('content', '')
                r_attachments = r.get('attachments', [])
                line = f'  └ {r_author}: {r_content}'
                if r_attachments:
                    line += f' [附件: {", ".join(a.get("filename", "?") for a in r_attachments)}]'
                reply_lines.append(line)
            reply_text = '\n' + '\n'.join(reply_lines)

        # Build full summary with context
        full_summary = content + attach_info + reply_text

        # Reaction breakdown
        reaction_tags = [f'{r["emoji"]}×{r["count"]}' for r in msg.get('reactions', []) if r.get('count', 0) > 0]
        react_str = ' '.join(reaction_tags)

        msg_url = f'https://discord.com/channels/{guild_id}/{channel_id}/{msg_id}' if channel_id and msg_id else ''
        title_preview = content[:80].replace('\n', ' ') if content else '(附件/嵌入)'
        item = {
            'title': f'[DC] {author}@{channel}: {title_preview}',
            'summary': full_summary,
            'source': 'discord',
            'time': msg_time,
            'url': msg_url,
            'engagement': score,
            'author': author,
            'tags': ['discord', 'full-text'],
            'lang': '',
            'metadata': {
                'reactions': react_str,
                'reply_count': len(replies),
                'attachment_count': len(attachments),
                'attachment_urls': [a.get('url', '') for a in attachments if a.get('url')],
                'channel': channel,
            },
        }
        # First image attachment as media_url for download_media.py
        for a in attachments:
            ct = a.get('content_type', '')
            aurl = a.get('url', '')
            if aurl and (ct.startswith('image/') or any(aurl.lower().endswith(e) for e in ('.png', '.jpg', '.jpeg', '.gif', '.webp'))):
                item['media_url'] = aurl
                item['content_type'] = 'image'
                break
        items.append(item)

    logger.info(f'Discord local: {len(items)} items ({len(top_msgs)} full-text) from {data_date} JSONL ({len(all_msgs)} total messages)')
    return items


# ============================================================
# Data Quality Integration
# ============================================================
