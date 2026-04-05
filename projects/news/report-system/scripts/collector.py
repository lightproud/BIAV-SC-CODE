#!/usr/bin/env python3
"""
忘却前夜 Morimens - 全球信息收集器
从全球多个社区平台收集忘却前夜相关信息，输出结构化 JSON 数据。

支持平台 (29个):
  中文: Bilibili, NGA, TapTap, Weibo, Xiaohongshu, Douyin, Tieba, QQ频道, Zhihu, Bahamut(巴哈姆特)
  同人: Pixiv, Lofter
  周边: 闲鱼, 淘宝
  全球: Reddit, Twitter/X, YouTube, Discord, Facebook, TikTok, Telegram, Twitch, Instagram
  韩国: Naver Cafe, DCInside, Arca.live
  日本: 5ch
  商店: App Store, Google Play

使用: python scripts/collector.py
输出: data/collected_raw.json
"""

import asyncio
import json
import os
import re
import logging
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("collector")

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_PATH = BASE_DIR / "data" / "collected_raw.json"

HOURS_LOOKBACK = int(os.environ.get("HOURS_LOOKBACK", "24"))
CUTOFF = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)


def _refresh_cutoff():
    """Refresh the global CUTOFF so long-running processes (scheduler) use current time."""
    global CUTOFF
    CUTOFF = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)

# 多语言搜索关键词
KEYWORDS = {
    "zh": ["忘却前夜", "忘卻前夜"],
    "en": ["Morimens", "morimens"],
    "ja": ["忘却前夜", "モリメンス"],
    "ko": ["망각전야", "모리멘스", "Morimens"],
    "vi": ["Morimens"],
    "th": ["Morimens"],
    "es": ["Morimens"],
    "pt": ["Morimens"],
    "ru": ["Morimens"],
    "de": ["Morimens"],
    "fr": ["Morimens"],
}
ALL_KEYWORDS = [kw for group in KEYWORDS.values() for kw in group]

# 通用请求 headers
DEFAULT_HEADERS = {"User-Agent": "MorimensReportBot/2.0"}


# ─── 工具函数 ───────────────────────────────────────────────

def _get(url, params=None, headers=None, timeout=15):
    """带重试的 GET 请求 (间隔 1s/2s)。"""
    h = {**DEFAULT_HEADERS, **(headers or {})}
    for attempt in range(3):
        try:
            resp = requests.get(url, params=params, headers=h, timeout=timeout)
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            if attempt == 2:
                raise
            logger.debug(f"Retry {attempt + 1} for {url}: {e}")
            time.sleep(attempt + 1)


def _get_cf(url, params=None, headers=None, timeout=15):
    """GET request using cloudscraper for Cloudflare-protected sites."""
    try:
        import cloudscraper
        scraper = cloudscraper.create_scraper(browser={'browser': 'chrome', 'platform': 'linux'})
        h = {**DEFAULT_HEADERS, **(headers or {})}
        resp = scraper.get(url, params=params, headers=h, timeout=timeout)
        resp.raise_for_status()
        return resp
    except ImportError:
        logger.warning("cloudscraper not installed, falling back to requests")
        return _get(url, params=params, headers=headers, timeout=timeout)


def _post(url, json_data=None, headers=None, timeout=30):
    """带重试的 POST 请求 (间隔 1s/2s)。"""
    h = {**DEFAULT_HEADERS, **(headers or {})}
    for attempt in range(3):
        try:
            resp = requests.post(url, json=json_data, headers=h, timeout=timeout)
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            if attempt == 2:
                raise
            logger.debug(f"Retry {attempt + 1} for {url}: {e}")
            time.sleep(attempt + 1)


def _strip_html(text):
    """移除 HTML 标签。"""
    return re.sub(r"<[^>]+>", "", text) if text else ""


def _make_item(
    title, summary, source, platform_region, time_str, url,
    engagement=0, is_hot=False, author="", tags=None, lang="",
    content_type="text", media_url="",
):
    """创建标准化的信息条目。"""
    return {
        "title": _strip_html(title or "").strip(),
        "summary": _strip_html(summary or "").strip()[:300],
        "source": source,
        "platform_region": platform_region,
        "lang": lang,
        "time": time_str,
        "url": url or "",
        "engagement": engagement,
        "is_hot": is_hot,
        "author": str(author or ""),
        "tags": tags or [],
        "content_type": content_type,
        "media_url": media_url,
    }


# ─── 数据源采集器 ──────────────────────────────────────────

def fetch_reddit(subreddits=None):
    """从 Reddit 获取热门帖子（公开 JSON API，无需认证）。"""
    subreddits = subreddits or ["Morimens", "MorimensGame", "gachagaming"]
    items = []

    for sub in subreddits:
        try:
            url = f"https://www.reddit.com/r/{sub}/hot.json?limit=30"
            data = _get(url).json()
            posts = data.get("data", {}).get("children", [])

            for post in posts:
                d = post["data"]
                created = datetime.fromtimestamp(d["created_utc"], tz=timezone.utc)
                if created < CUTOFF:
                    continue

                # 对 gachagaming 等综合版块，只取相关帖子
                if sub.lower() not in ("morimens", "morimensgame"):
                    title_lower = d["title"].lower()
                    if not any(kw.lower() in title_lower for kw in ALL_KEYWORDS):
                        continue

                score = d.get("score", 0)
                comments = d.get("num_comments", 0)
                items.append(_make_item(
                    title=d["title"],
                    summary=(d.get("selftext") or "")[:300],
                    source="reddit",
                    platform_region="global",
                    time_str=created.isoformat(),
                    url=f"https://reddit.com{d['permalink']}",
                    engagement=score + comments,
                    is_hot=score > 100,
                    author=f"u/{d.get('author', '')}",
                    tags=[f.get("text", "") for f in d.get("link_flair_richtext", []) if f.get("text")],
                    lang="en",
                ))

            logger.info(f"Reddit r/{sub}: {len(items)} items collected")
        except Exception as e:
            logger.warning(f"Reddit r/{sub} failed: {e}")

    return items


def fetch_bilibili():
    """从 Bilibili 搜索忘却前夜相关视频。"""
    items = []
    headers = {"Referer": "https://www.bilibili.com"}

    for keyword in KEYWORDS["zh"]:
        try:
            data = _get(
                "https://api.bilibili.com/x/web-interface/search/type",
                params={"search_type": "video", "keyword": keyword, "order": "pubdate", "page": 1},
                headers=headers,
            ).json()

            for v in (data.get("data", {}).get("result") or [])[:25]:
                pubdate = v.get("pubdate", 0)
                if not pubdate:
                    continue
                created = datetime.fromtimestamp(pubdate, tz=timezone.utc)
                if created < CUTOFF:
                    continue

                play = v.get("play", 0)
                items.append(_make_item(
                    title=v.get("title", ""),
                    summary=v.get("description", ""),
                    source="bilibili",
                    platform_region="cn",
                    time_str=created.isoformat(),
                    url=v.get("arcurl", ""),
                    engagement=play + v.get("danmaku", 0),
                    is_hot=play > 10000,
                    author=v.get("author", ""),
                    tags=[v.get("typename", "")] if v.get("typename") else [],
                    lang="zh",
                    content_type="video",
                    media_url=v.get("pic", ""),
                ))

            logger.info(f'Bilibili "{keyword}": {len(items)} items')
        except Exception as e:
            logger.warning(f'Bilibili "{keyword}" failed: {e}')

    return items


def fetch_twitter():
    """从 Twitter/X API v2 搜索相关推文。"""
    bearer = os.environ.get("TWITTER_BEARER_TOKEN")
    if not bearer:
        logger.info("Twitter: TWITTER_BEARER_TOKEN not set, skipping")
        return []

    items = []
    query = "(忘却前夜 OR 忘卻前夜 OR Morimens) -is:retweet"

    try:
        data = _get(
            "https://api.twitter.com/2/tweets/search/recent",
            params={
                "query": query,
                "max_results": 50,
                "tweet.fields": "created_at,public_metrics,author_id,lang",
                "expansions": "author_id,attachments.media_keys",
                "user.fields": "username",
                "media.fields": "url,preview_image_url",
            },
            headers={"Authorization": f"Bearer {bearer}"},
        ).json()

        users = {u["id"]: u["username"] for u in data.get("includes", {}).get("users", [])}

        for tweet in data.get("data", []):
            m = tweet.get("public_metrics", {})
            engagement = m.get("like_count", 0) + m.get("reply_count", 0) + m.get("retweet_count", 0)
            items.append(_make_item(
                title=tweet["text"][:120],
                summary=tweet["text"][:300],
                source="twitter",
                platform_region="global",
                time_str=tweet["created_at"],
                url=f"https://twitter.com/i/status/{tweet['id']}",
                engagement=engagement,
                is_hot=engagement > 500,
                author=f"@{users.get(tweet.get('author_id', ''), 'unknown')}",
                lang=tweet.get("lang", ""),
            ))

        logger.info(f"Twitter: {len(items)} tweets collected")
    except Exception as e:
        logger.warning(f"Twitter failed: {e}")

    return items


def fetch_youtube():
    """从 YouTube Data API v3 搜索相关视频。"""
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        logger.info("YouTube: YOUTUBE_API_KEY not set, skipping")
        return []

    items = []
    published_after = CUTOFF.strftime("%Y-%m-%dT%H:%M:%SZ")

    for keyword in ["Morimens", "忘却前夜"]:
        try:
            data = _get(
                "https://www.googleapis.com/youtube/v3/search",
                params={
                    "part": "snippet",
                    "q": keyword,
                    "type": "video",
                    "order": "date",
                    "publishedAfter": published_after,
                    "maxResults": 15,
                    "key": api_key,
                },
            ).json()

            video_ids = [item["id"]["videoId"] for item in data.get("items", []) if item.get("id", {}).get("videoId")]

            # 获取视频统计数据
            stats = {}
            if video_ids:
                stats_data = _get(
                    "https://www.googleapis.com/youtube/v3/videos",
                    params={
                        "part": "statistics",
                        "id": ",".join(video_ids),
                        "key": api_key,
                    },
                ).json()
                for v in stats_data.get("items", []):
                    s = v.get("statistics", {})
                    stats[v["id"]] = int(s.get("viewCount", 0)) + int(s.get("likeCount", 0))

            for item in data.get("items", []):
                vid = item.get("id", {}).get("videoId")
                if not vid:
                    continue
                snippet = item.get("snippet", {})
                engagement = stats.get(vid, 0)
                items.append(_make_item(
                    title=snippet.get("title", ""),
                    summary=snippet.get("description", ""),
                    source="youtube",
                    platform_region="global",
                    time_str=snippet.get("publishedAt", ""),
                    url=f"https://www.youtube.com/watch?v={vid}",
                    engagement=engagement,
                    is_hot=engagement > 5000,
                    author=snippet.get("channelTitle", ""),
                    lang="",
                    content_type="video",
                    media_url=snippet.get("thumbnails", {}).get("high", {}).get("url", ""),
                ))

            logger.info(f'YouTube "{keyword}": {len(items)} videos')
        except Exception as e:
            logger.warning(f'YouTube "{keyword}" failed: {e}')

    return items


def fetch_nga():
    """从 NGA 论坛获取忘却前夜版块帖子。"""
    # NGA forum ID for 忘却前夜 — can be overridden via env var
    # Search NGA for the correct FID if this one doesn't work
    nga_fid = os.environ.get("NGA_FORUM_ID", "")

    items = []

    # If no fixed FID, try NGA search instead
    if not nga_fid:
        import re as _re
        for keyword in KEYWORDS["zh"][:2]:
            try:
                resp = _get(
                    "https://bbs.nga.cn/thread.php",
                    params={"key": keyword, "fid": 0, "ajax": 1},
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Cookie": "nga_read_toma=1",
                        "Accept": "application/json",
                    },
                )
                try:
                    data = resp.json()
                except ValueError:
                    # NGA sometimes returns JSONP, try to extract JSON
                    text = resp.text.strip()
                    json_match = _re.search(r'\{.*\}', text, _re.DOTALL)
                    if json_match:
                        data = json.loads(json_match.group())
                    else:
                        continue

                threads = data.get("data", {}).get("__T", {})
                if isinstance(threads, dict):
                    for tid, thread in threads.items():
                        postdate = thread.get("postdate", 0)
                        if not isinstance(postdate, (int, float)):
                            continue
                        created = datetime.fromtimestamp(postdate, tz=timezone.utc)
                        replies = thread.get("replies", 0)
                        items.append(_make_item(
                            title=thread.get("subject", ""),
                            summary="",
                            source="nga",
                            platform_region="cn",
                            time_str=created.isoformat(),
                            url=f"https://bbs.nga.cn/read.php?tid={tid}",
                            engagement=replies,
                            is_hot=replies > 50,
                            author=thread.get("author", ""),
                            lang="zh",
                        ))
                logger.info(f'NGA search "{keyword}": {len(items)} threads')
            except Exception as e:
                logger.warning(f'NGA search "{keyword}" failed: {e}')
        return items

    try:
        data = _get(
            f"https://bbs.nga.cn/thread.php?fid={nga_fid}&ajax=1",
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Cookie": "nga_read_toma=1",
                "Accept": "application/json",
            },
        ).json()

        threads = data.get("data", {}).get("__T", {})
        for tid, thread in threads.items():
            postdate = thread.get("postdate", 0)
            if not isinstance(postdate, (int, float)):
                continue
            created = datetime.fromtimestamp(postdate, tz=timezone.utc)
            if created < CUTOFF:
                continue

            replies = thread.get("replies", 0)
            items.append(_make_item(
                title=thread.get("subject", ""),
                summary="",
                source="nga",
                platform_region="cn",
                time_str=created.isoformat(),
                url=f"https://bbs.nga.cn/read.php?tid={tid}",
                engagement=replies,
                is_hot=replies > 50,
                author=thread.get("author", ""),
                lang="zh",
            ))

        logger.info(f"NGA: {len(items)} threads collected")
    except Exception as e:
        logger.warning(f"NGA failed: {e}")

    return items


def fetch_taptap():
    """从 TapTap 获取忘却前夜社区帖子和评价（Playwright 无头浏览器方案）。

    TapTap 已废弃 webapiv2 端点，改用 taptap_collector 模块通过 headless Chromium
    渲染页面后拦截 API 响应或提取 DOM 来获取数据。
    source 字段：帖子为 "taptap_post"，评价为 "taptap_review"。
    """
    try:
        import taptap_collector as _tc
    except ImportError:
        try:
            import sys
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            import taptap_collector as _tc
        except ImportError:
            logger.warning("TapTap: taptap_collector not available (playwright not installed?), skipping")
            return []

    try:
        topic_items, review_items = asyncio.run(_tc.collect(cutoff=CUTOFF))
        items = topic_items + review_items
        logger.info(f"TapTap: {len(topic_items)} posts + {len(review_items)} reviews")
        return items
    except Exception as e:
        logger.warning(f"TapTap failed: {e}")
        return []


# ─── 新增数据源 ──────────────────────────────────────────

def fetch_weibo():
    """从微博搜索忘却前夜相关热帖。"""
    items = []
    for keyword in KEYWORDS["zh"]:
        try:
            data = _get(
                "https://m.weibo.cn/api/container/getIndex",
                params={"containerid": f"100103type=1&q={keyword}", "page_type": "searchall"},
                headers={"Referer": "https://m.weibo.cn"},
            ).json()

            for card in data.get("data", {}).get("cards", []):
                if card.get("card_type") != 9:
                    continue
                mblog = card.get("mblog", {})
                created_str = mblog.get("created_at", "")
                # 微博时间格式复杂，简化处理
                text = mblog.get("text", "")
                text_clean = re.sub(r"<[^>]+>", "", text)

                items.append(_make_item(
                    title=text_clean[:100],
                    summary=text_clean[:300],
                    source="weibo",
                    platform_region="cn",
                    time_str=datetime.now(timezone.utc).isoformat(),
                    url=f"https://m.weibo.cn/detail/{mblog.get('id', '')}",
                    engagement=mblog.get("reposts_count", 0) + mblog.get("comments_count", 0) + mblog.get("attitudes_count", 0),
                    is_hot=mblog.get("attitudes_count", 0) > 500,
                    author=mblog.get("user", {}).get("screen_name", ""),
                    lang="zh",
                ))

            logger.info(f'Weibo "{keyword}": {len(items)} posts')
        except Exception as e:
            logger.warning(f'Weibo "{keyword}" failed: {e}')

    return items


def fetch_xiaohongshu():
    """从小红书搜索忘却前夜内容。"""
    items = []
    for keyword in KEYWORDS["zh"]:
        try:
            data = _get(
                "https://edith.xiaohongshu.com/api/sns/web/v1/search/notes",
                params={"keyword": keyword, "page": 1, "page_size": 20, "sort": "time_descending"},
                headers={"Referer": "https://www.xiaohongshu.com"},
            ).json()

            for note in data.get("data", {}).get("items", []) or []:
                note_item = note.get("note_card", {})
                items.append(_make_item(
                    title=note_item.get("display_title", ""),
                    summary="",
                    source="xiaohongshu",
                    platform_region="cn",
                    time_str=datetime.now(timezone.utc).isoformat(),
                    url=f"https://www.xiaohongshu.com/explore/{note.get('id', '')}",
                    engagement=note_item.get("liked_count", 0),
                    is_hot=note_item.get("liked_count", 0) > 200,
                    author=note_item.get("user", {}).get("nickname", ""),
                    lang="zh",
                    content_type=note_item.get("type", "text"),
                ))

            logger.info(f'Xiaohongshu "{keyword}": {len(items)} notes')
        except Exception as e:
            logger.warning(f'Xiaohongshu "{keyword}" failed: {e}')

    return items


def fetch_douyin():
    """从抖音搜索忘却前夜相关视频。"""
    items = []
    for keyword in KEYWORDS["zh"]:
        try:
            data = _get(
                "https://www.douyin.com/aweme/v1/web/search/item/",
                params={"keyword": keyword, "count": 20, "sort_type": 0},
                headers={"Referer": "https://www.douyin.com"},
            ).json()

            for aweme in data.get("data", []) or []:
                desc = aweme.get("aweme_info", {}).get("desc", "")
                stats = aweme.get("aweme_info", {}).get("statistics", {})
                items.append(_make_item(
                    title=desc[:100],
                    summary=desc[:300],
                    source="douyin",
                    platform_region="cn",
                    time_str=datetime.now(timezone.utc).isoformat(),
                    url=f"https://www.douyin.com/video/{aweme.get('aweme_info', {}).get('aweme_id', '')}",
                    engagement=stats.get("digg_count", 0) + stats.get("comment_count", 0),
                    is_hot=stats.get("digg_count", 0) > 5000,
                    author=aweme.get("aweme_info", {}).get("author", {}).get("nickname", ""),
                    lang="zh",
                    content_type="video",
                ))

            logger.info(f'Douyin "{keyword}": {len(items)} videos')
        except Exception as e:
            logger.warning(f'Douyin "{keyword}" failed: {e}')

    return items


def fetch_tieba():
    """从百度贴吧获取忘却前夜吧帖子（客户端 API，无需登录）。"""
    items = []
    try:
        data = _get(
            "https://tieba.baidu.com/c/f/frs/page",
            params={"kw": "忘却前夜", "pn": 0, "rn": 30},
            headers={"User-Agent": "bdtb for Android 12.57.1.2"},
        ).json()

        for thread in data.get("thread_list", []) or []:
            tid = thread.get("tid", "") or thread.get("id", "")
            reply_num = int(thread.get("reply_num", 0))
            last_time = thread.get("last_time_int", 0)
            time_str = (datetime.fromtimestamp(int(last_time), tz=timezone.utc).isoformat()
                        if last_time else datetime.now(timezone.utc).isoformat())
            items.append(_make_item(
                title=thread.get("title", ""),
                summary=thread.get("abstract", [""])[0] if isinstance(thread.get("abstract"), list) else thread.get("abstract", ""),
                source="tieba",
                platform_region="cn",
                time_str=time_str,
                url=f"https://tieba.baidu.com/p/{tid}",
                engagement=reply_num,
                is_hot=reply_num > 50,
                author=thread.get("author", {}).get("name_show", "") if isinstance(thread.get("author"), dict) else "",
                lang="zh",
            ))

        logger.info(f"Tieba: {len(items)} threads")
    except Exception as e:
        logger.warning(f"Tieba failed: {e}")

    return items


def fetch_naver_cafe():
    """从 Naver Cafe 搜索韩国忘却前夜社区。"""
    items = []
    for keyword in KEYWORDS["ko"]:
        try:
            data = _get(
                "https://apis.naver.com/cafe-web/cafe2/ArticleSearchListV2.json",
                params={"query": keyword, "page": 1, "sortBy": "date"},
                headers={"Referer": "https://cafe.naver.com"},
            ).json()

            for article in data.get("message", {}).get("result", {}).get("articleList", []) or []:
                items.append(_make_item(
                    title=article.get("subject", ""),
                    summary=article.get("summary", ""),
                    source="naver_cafe",
                    platform_region="kr",
                    time_str=article.get("writeDateTimestamp", datetime.now(timezone.utc).isoformat()),
                    url=article.get("articleUrl", ""),
                    engagement=article.get("readCount", 0) + article.get("commentCount", 0),
                    is_hot=article.get("readCount", 0) > 500,
                    author=article.get("writerNickName", ""),
                    lang="ko",
                ))

            logger.info(f'Naver Cafe "{keyword}": {len(items)} articles')
        except Exception as e:
            logger.warning(f'Naver Cafe "{keyword}" failed: {e}')

    return items


def fetch_dcinside():
    """从 DCInside 搜索韩国忘却前夜 Gallery + 搜索。"""
    dc_gallery_id = os.environ.get("DC_GALLERY_ID", "morimens")
    items = []

    try:
        resp = _get_cf(
            f"https://gall.dcinside.com/mgallery/board/lists/",
            params={"id": dc_gallery_id, "page": 1},
            headers={
                "Referer": "https://gall.dcinside.com",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
        )
        html = resp.text

        # Parse article list from HTML
        import re as _re
        for match in _re.finditer(
            r'data-no="(\d+)".*?'
            r'class="gall_tit[^"]*"[^>]*>.*?<a[^>]*>([^<]+)</a>.*?'
            r'class="gall_date"[^>]*title="([^"]*)"',
            html, _re.DOTALL
        ):
            article_no, title, date_str = match.groups()
            title = title.strip()
            if not title or title in ('공지', '설문'):
                continue
            items.append(_make_item(
                title=title,
                summary="",
                source="dcinside",
                platform_region="kr",
                time_str=date_str.strip(),
                url=f"https://gall.dcinside.com/mgallery/board/view/?id={dc_gallery_id}&no={article_no}",
                engagement=0,
                is_hot=False,
                author="",
                lang="ko",
            ))

        logger.info(f'DCInside "{dc_gallery_id}": {len(items)} articles')
    except Exception as e:
        logger.warning(f'DCInside "{dc_gallery_id}" failed: {e}')

    return items


def fetch_arca_live():
    """从 Arca.live 抓取韩国忘却前夜频道 (forgettingeve)。"""
    arca_channel = os.environ.get("ARCA_CHANNEL", "forgettingeve")
    items = []

    for mode in ("best", ""):  # best=인기, ""=최신
        try:
            params = {"p": 1}
            if mode:
                params["mode"] = mode
            resp = _get_cf(
                f"https://arca.live/b/{arca_channel}",
                params=params,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            html = resp.text

            # Parse article list from HTML using regex (avoids BeautifulSoup dependency)
            import re as _re
            # Match article rows: data-url="/b/forgettingeve/12345"
            for match in _re.finditer(
                r'data-url="(/b/[^"]+/(\d+))"[^>]*>.*?'
                r'class="title"[^>]*>([^<]+)</a>.*?'
                r'class="col-time"[^>]*>([^<]+)',
                html, _re.DOTALL
            ):
                path, article_id, title, time_text = match.groups()
                title = title.strip()
                if not title:
                    continue
                items.append(_make_item(
                    title=title,
                    summary="",
                    source="arca_live",
                    platform_region="kr",
                    time_str=time_text.strip(),
                    url=f"https://arca.live{path}",
                    engagement=0,
                    is_hot=(mode == "best"),
                    author="",
                    lang="ko",
                ))

            logger.info(f'Arca.live "{arca_channel}" mode={mode or "latest"}: {len(items)} items')
        except Exception as e:
            logger.warning(f'Arca.live "{arca_channel}" mode={mode or "latest"} failed: {e}')

    return items


def fetch_discord():
    """从 Discord Webhook / Bot 获取官方服务器讨论摘要。"""
    discord_token = os.environ.get("DISCORD_BOT_TOKEN", "")
    discord_channels = os.environ.get("DISCORD_CHANNEL_IDS", "").split(",")
    if not discord_token or not discord_channels[0]:
        logger.info("Discord: DISCORD_BOT_TOKEN or DISCORD_CHANNEL_IDS not set, skipping")
        return []

    items = []
    for channel_id in discord_channels:
        channel_id = channel_id.strip()
        if not channel_id:
            continue
        try:
            data = _get(
                f"https://discord.com/api/v10/channels/{channel_id}/messages",
                params={"limit": 50},
                headers={"Authorization": f"Bot {discord_token}"},
            ).json()

            for msg in data if isinstance(data, list) else []:
                # 只取有一定反应数的消息
                reactions = sum(r.get("count", 0) for r in msg.get("reactions", []))
                if reactions < 3:
                    continue
                created = msg.get("timestamp", "")
                items.append(_make_item(
                    title=msg.get("content", "")[:100],
                    summary=msg.get("content", "")[:300],
                    source="discord",
                    platform_region="global",
                    time_str=created,
                    url=f"https://discord.com/channels/{msg.get('guild_id', '')}/{channel_id}/{msg.get('id', '')}",
                    engagement=reactions,
                    is_hot=reactions > 10,
                    author=msg.get("author", {}).get("username", ""),
                    lang="en",
                ))

            logger.info(f"Discord channel {channel_id}: {len(items)} messages")
        except Exception as e:
            logger.warning(f"Discord channel {channel_id} failed: {e}")

    return items


def fetch_facebook():
    """从 Facebook Graph API 搜索相关群组/页面帖子。"""
    fb_token = os.environ.get("FACEBOOK_ACCESS_TOKEN", "")
    fb_pages = os.environ.get("FACEBOOK_PAGE_IDS", "").split(",")
    if not fb_token or not fb_pages[0]:
        logger.info("Facebook: FACEBOOK_ACCESS_TOKEN or FACEBOOK_PAGE_IDS not set, skipping")
        return []

    items = []
    for page_id in fb_pages:
        page_id = page_id.strip()
        if not page_id:
            continue
        try:
            data = _get(
                f"https://graph.facebook.com/v18.0/{page_id}/feed",
                params={"access_token": fb_token, "limit": 20, "fields": "message,created_time,shares,reactions.summary(true),comments.summary(true)"},
            ).json()

            for post in data.get("data", []):
                msg = post.get("message", "")
                if not any(kw.lower() in msg.lower() for kw in ALL_KEYWORDS):
                    continue
                reactions = post.get("reactions", {}).get("summary", {}).get("total_count", 0)
                comments = post.get("comments", {}).get("summary", {}).get("total_count", 0)
                shares = post.get("shares", {}).get("count", 0)
                items.append(_make_item(
                    title=msg[:100],
                    summary=msg[:300],
                    source="facebook",
                    platform_region="sea",
                    time_str=post.get("created_time", ""),
                    url=f"https://facebook.com/{post.get('id', '')}",
                    engagement=reactions + comments + shares,
                    is_hot=reactions > 100,
                    author="",
                    lang="",
                ))

            logger.info(f"Facebook page {page_id}: {len(items)} posts")
        except Exception as e:
            logger.warning(f"Facebook page {page_id} failed: {e}")

    return items


def fetch_appstore_reviews():
    """从 App Store / Google Play 获取近期评论趋势。"""
    items = []
    # Apple App Store RSS
    appstore_id = os.environ.get("APPSTORE_APP_ID", "6447354150")
    if appstore_id:
        for country in ["cn", "us", "jp", "kr"]:
            try:
                data = _get(
                    f"https://itunes.apple.com/{country}/rss/customerreviews/id={appstore_id}/sortBy=mostRecent/json",
                ).json()
                entries = data.get("feed", {}).get("entry", [])
                for entry in entries[:10]:
                    rating = int(entry.get("im:rating", {}).get("label", "0"))
                    items.append(_make_item(
                        title=entry.get("title", {}).get("label", ""),
                        summary=entry.get("content", {}).get("label", ""),
                        source="appstore",
                        platform_region=country,
                        time_str=entry.get("updated", {}).get("label", ""),
                        url="",
                        engagement=rating,
                        is_hot=False,
                        author=entry.get("author", {}).get("name", {}).get("label", ""),
                        lang={"cn": "zh", "us": "en", "jp": "ja", "kr": "ko"}.get(country, ""),
                    ))
                logger.info(f"App Store ({country}): {len(entries)} reviews")
            except Exception as e:
                logger.warning(f"App Store ({country}) failed: {e}")

    return items


def fetch_qq():
    """从 QQ 频道/群组获取忘却前夜相关讨论。"""
    qq_guild_id = os.environ.get("QQ_GUILD_ID", "Morimens0617")
    qq_bot_token = os.environ.get("QQ_CHANNEL", "") or os.environ.get("QQ_BOT_TOKEN", "")
    if not qq_bot_token:
        logger.info("QQ: QQ_BOT_TOKEN not set, skipping")
        return []

    items = []
    try:
        # QQ 开放平台 Bot API - 获取频道消息
        channels_data = _get(
            f"https://api.sgroup.qq.com/guilds/{qq_guild_id}/channels",
            headers={"Authorization": f"Bot {qq_bot_token}"},
        ).json()

        for channel in channels_data if isinstance(channels_data, list) else []:
            channel_id = channel.get("id", "")
            channel_name = channel.get("name", "")
            # 只关注文字频道 (type=0)
            if channel.get("type") != 0:
                continue
            try:
                msgs = _get(
                    f"https://api.sgroup.qq.com/channels/{channel_id}/messages",
                    params={"limit": 30},
                    headers={"Authorization": f"Bot {qq_bot_token}"},
                ).json()

                for msg in msgs if isinstance(msgs, list) else []:
                    content = msg.get("content", "")
                    if not content:
                        continue
                    # 检查是否相关
                    if not any(kw in content for kw in ALL_KEYWORDS):
                        continue
                    reactions = sum(r.get("count", 0) for r in msg.get("reactions", []))
                    items.append(_make_item(
                        title=content[:100],
                        summary=content[:300],
                        source="qq",
                        platform_region="cn",
                        time_str=msg.get("timestamp", datetime.now(timezone.utc).isoformat()),
                        url="",
                        engagement=reactions,
                        is_hot=reactions > 10,
                        author=msg.get("author", {}).get("username", ""),
                        lang="zh",
                    ))
            except Exception as e:
                logger.debug(f"QQ channel {channel_name} failed: {e}")

        logger.info(f"QQ Guild: {len(items)} messages collected")
    except Exception as e:
        logger.warning(f"QQ Guild failed: {e}")

    return items


def fetch_pixiv():
    """从 Pixiv 搜索忘却前夜同人创作。"""
    items = []
    for keyword in ["忘却前夜", "Morimens", "モリメンス"]:
        try:
            data = _get(
                "https://www.pixiv.net/ajax/search/artworks/" + keyword,
                params={"order": "date_d", "mode": "all", "p": 1, "s_mode": "s_tag"},
                headers={"Referer": "https://www.pixiv.net"},
            ).json()

            for illust in (data.get("body", {}).get("illustManga", {}).get("data", []) or [])[:20]:
                illust_id = illust.get("id", "")
                bookmark = illust.get("bookmarkCount", 0)
                like = illust.get("likeCount", 0)
                items.append(_make_item(
                    title=illust.get("title", ""),
                    summary=illust.get("description", "")[:300] if illust.get("description") else "",
                    source="pixiv",
                    platform_region="global",
                    time_str=illust.get("createDate", datetime.now(timezone.utc).isoformat()),
                    url=f"https://www.pixiv.net/artworks/{illust_id}",
                    engagement=bookmark + like,
                    is_hot=bookmark > 500,
                    author=illust.get("userName", ""),
                    tags=[t.get("tag", "") for t in illust.get("tags", [])[:5]] if isinstance(illust.get("tags"), list) else [],
                    lang="",
                    content_type="image",
                    media_url=illust.get("url", ""),
                ))

            logger.info(f'Pixiv "{keyword}": {len(items)} artworks')
        except Exception as e:
            logger.warning(f'Pixiv "{keyword}" failed: {e}')

    return items


def fetch_lofter():
    """从 Lofter 标签页抓取忘却前夜同人创作（HTML 解析，无需登录）。"""
    import re as _re
    items = []
    for keyword in KEYWORDS["zh"]:
        try:
            resp = _get(
                f"https://www.lofter.com/tag/{keyword}",
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://www.lofter.com",
                },
            )
            html = resp.text

            # Lofter tag page embeds post data in HTML
            for match in _re.finditer(
                r'class="txtcnt"[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)</a>',
                html, _re.DOTALL
            ):
                url, title = match.groups()
                title = title.strip()
                if not title:
                    continue
                items.append(_make_item(
                    title=title,
                    summary="",
                    source="lofter",
                    platform_region="cn",
                    time_str=datetime.now(timezone.utc).isoformat(),
                    url=url if url.startswith("http") else f"https://www.lofter.com{url}",
                    engagement=0,
                    is_hot=False,
                    author="",
                    lang="zh",
                    content_type="image",
                ))

            # Fallback: try to find post items via data-id pattern
            if not items:
                for match in _re.finditer(
                    r'data-id="(\d+)".*?<a[^>]*href="([^"]*)"[^>]*title="([^"]*)"',
                    html, _re.DOTALL
                ):
                    post_id, url, title = match.groups()
                    title = title.strip()
                    if not title:
                        continue
                    items.append(_make_item(
                        title=title,
                        summary="",
                        source="lofter",
                        platform_region="cn",
                        time_str=datetime.now(timezone.utc).isoformat(),
                        url=url if url.startswith("http") else f"https://www.lofter.com{url}",
                        engagement=0,
                        is_hot=False,
                        author="",
                        lang="zh",
                    ))

            logger.info(f'Lofter "{keyword}": {len(items)} posts')
        except Exception as e:
            logger.warning(f'Lofter "{keyword}" failed: {e}')

    return items


def fetch_xianyu():
    """从闲鱼搜索忘却前夜二手/周边交易。"""
    items = []
    for keyword in ["忘却前夜", "忘却前夜 周边", "忘却前夜 账号"]:
        try:
            # 闲鱼 H5 搜索 API
            data = _get(
                "https://h5api.m.goofish.com/h5/mtop.taobao.idle.pc.search/1.0/",
                params={"keyword": keyword, "pageSize": 20, "pageNumber": 1},
                headers={"Referer": "https://www.goofish.com"},
            )
            if data and data.status_code == 200:
                try:
                    result = data.json()
                    for item_data in result.get("data", {}).get("resultList", []) or []:
                        item_info = item_data.get("data", {})
                        price = item_info.get("price", "0")
                        want_count = int(item_info.get("wantCount", 0))
                        items.append(_make_item(
                            title=item_info.get("title", ""),
                            summary=f"¥{price} | {want_count}人想要",
                            source="xianyu",
                            platform_region="cn",
                            time_str=datetime.now(timezone.utc).isoformat(),
                            url=f"https://www.goofish.com/item?id={item_info.get('id', '')}",
                            engagement=want_count,
                            is_hot=want_count > 30,
                            author=item_info.get("sellerNick", ""),
                            tags=["二手交易", f"¥{price}"],
                            lang="zh",
                            content_type="marketplace",
                            media_url=item_info.get("picUrl", ""),
                        ))
                except ValueError:
                    pass

            logger.info(f'Xianyu "{keyword}": {len(items)} listings')
        except Exception as e:
            logger.warning(f'Xianyu "{keyword}" failed: {e}')

    return items


def fetch_taobao_merch():
    """从淘宝搜索忘却前夜官方/同人周边商品。"""
    items = []
    for keyword in ["忘却前夜 周边", "忘却前夜 手办", "忘却前夜 谷子"]:
        try:
            # 淘宝 H5 搜索 API
            data = _get(
                "https://h5api.m.taobao.com/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/",
                params={"q": keyword, "page": 1},
                headers={"Referer": "https://www.taobao.com"},
            )
            if data and data.status_code == 200:
                try:
                    result = data.json()
                    for item_data in result.get("data", {}).get("itemsArray", []) or []:
                        price = item_data.get("reservePrice", "0")
                        sold = int(item_data.get("totalSoldQuantity", 0) or item_data.get("sold", 0) or 0)
                        items.append(_make_item(
                            title=item_data.get("title", ""),
                            summary=f"¥{price} | 月销{sold}",
                            source="taobao",
                            platform_region="cn",
                            time_str=datetime.now(timezone.utc).isoformat(),
                            url=f"https://item.taobao.com/item.htm?id={item_data.get('itemId', '')}",
                            engagement=sold,
                            is_hot=sold > 100,
                            author=item_data.get("shopName", item_data.get("nick", "")),
                            tags=["周边商品", f"¥{price}"],
                            lang="zh",
                            content_type="marketplace",
                            media_url=item_data.get("pic", ""),
                        ))
                except ValueError:
                    pass

            logger.info(f'Taobao "{keyword}": {len(items)} products')
        except Exception as e:
            logger.warning(f'Taobao "{keyword}" failed: {e}')

    return items


def fetch_fivech():
    """从 5ch (日本) 搜索忘却前夜相关帖子（subject.txt + 搜索）。"""
    items = []
    import re as _re

    # Method 1: scan applism (手游板) subject.txt for matching threads
    boards = [
        ("pug", "applism"),     # アプリ/ソシャゲ
        ("krsw", "gamesm"),     # スマホゲーム
    ]
    for server, board in boards:
        try:
            resp = _get(
                f"https://{server}.5ch.net/{board}/subject.txt",
                headers={"User-Agent": "Monazilla/1.00"},
            )
            text = resp.text
            for line in text.split("\n"):
                # Format: 1234567890.dat<>Title (reply_count)
                if not line.strip():
                    continue
                # Check if thread title matches any keyword
                matched = any(kw in line for kw in KEYWORDS["ja"])
                if not matched:
                    continue
                match = _re.match(r'(\d+)\.dat<>(.+)\((\d+)\)', line)
                if match:
                    tid, title, replies = match.groups()
                    items.append(_make_item(
                        title=title.strip(),
                        summary="",
                        source="fivech",
                        platform_region="jp",
                        time_str=datetime.now(timezone.utc).isoformat(),
                        url=f"https://{server}.5ch.net/test/read.cgi/{board}/{tid}/",
                        engagement=int(replies),
                        is_hot=int(replies) > 100,
                        author="",
                        lang="ja",
                    ))
        except Exception as e:
            logger.warning(f"5ch {server}/{board} failed: {e}")

    # Method 2: find.5ch.net search with HTML parsing
    for keyword in KEYWORDS["ja"]:
        try:
            resp = _get(
                "https://find.5ch.net/search",
                params={"q": keyword, "sort": "created"},
                headers={"User-Agent": "Mozilla/5.0"},
            )
            html = resp.text
            for match in _re.finditer(
                r'<a[^>]*href="(https?://[^"]*5ch\.net/test/read\.cgi/[^"]+)"[^>]*>([^<]+)</a>',
                html
            ):
                url, title = match.groups()
                title = title.strip()
                if not title or len(title) < 3:
                    continue
                # Avoid duplicates from subject.txt
                if any(i.get("url") == url for i in items):
                    continue
                items.append(_make_item(
                    title=title,
                    summary="",
                    source="fivech",
                    platform_region="jp",
                    time_str=datetime.now(timezone.utc).isoformat(),
                    url=url,
                    engagement=0,
                    is_hot=False,
                    author="",
                    lang="ja",
                ))
        except Exception as e:
            logger.warning(f'5ch search "{keyword}" failed: {e}')

    logger.info(f"5ch: {len(items)} threads")
    return items


# ─── 第三波新增数据源 ─────────────────────────────────────


def fetch_google_play():
    """从 Google Play Store 获取忘却前夜评论（使用 google-play-scraper 库）。"""
    gp_package = os.environ.get("GOOGLE_PLAY_PACKAGE", "com.qookkagames.z1.gp.hk")
    items = []

    try:
        from google_play_scraper import reviews as gp_reviews, Sort as GPSort
    except ImportError:
        logger.warning("Google Play: google-play-scraper not installed, skipping")
        return items

    for lang_code, region in [("zh_CN", "cn"), ("en", "global"), ("ja", "jp"), ("ko", "kr")]:
        try:
            result, _ = gp_reviews(
                gp_package,
                lang=lang_code,
                count=20,
                sort=GPSort.NEWEST,
            )
            for review in result:
                rating = review.get("score", 0)
                text = review.get("content", "")
                sentiment = '好评' if rating >= 4 else ('中评' if rating == 3 else '差评')
                items.append(_make_item(
                    title=f"[Google Play {sentiment}] ★{rating} {text[:40]}",
                    summary=text[:300],
                    source="google_play",
                    platform_region=region,
                    time_str=review["at"].isoformat() if review.get("at") else datetime.now(timezone.utc).isoformat(),
                    url=f"https://play.google.com/store/apps/details?id={gp_package}",
                    engagement=review.get("thumbsUpCount", 0),
                    is_hot=False,
                    author=review.get("userName", ""),
                    lang=lang_code[:2],
                ))

            logger.info(f"Google Play ({lang_code}): {len(result)} reviews")
        except Exception as e:
            logger.warning(f"Google Play ({lang_code}) failed: {e}")

    return items


def fetch_qooapp():
    """从 QooApp 获取忘却前夜评论和评分。"""
    # QooApp App IDs: 23472 (HK/MO/SG/MY), 23471 (Taiwan), 138538 (Global)
    qooapp_ids = [
        ("23472", "hk", "zh"),
        ("23471", "tw", "zh"),
        ("138538", "global", "en"),
    ]
    items = []

    for app_id, region, lang in qooapp_ids:
        try:
            resp = _get(
                f"https://m-apps.qoo-app.com/en-US/app/{app_id}",
                headers={"User-Agent": "Mozilla/5.0"},
            )
            html = resp.text

            import re as _re

            # Extract review entries from QooApp HTML
            for match in _re.finditer(
                r'class="comment-content"[^>]*>.*?'
                r'class="[^"]*star[^"]*"[^>]*data-score="(\d)".*?'
                r'class="comment-text"[^>]*>([^<]+)</.*?'
                r'class="comment-date"[^>]*>([^<]+)',
                html, _re.DOTALL
            ):
                score, text, date_str = match.groups()
                rating = int(score)
                text = text.strip()
                if not text:
                    continue

                sentiment = '好评' if rating >= 4 else ('中评' if rating == 3 else '差评')
                items.append(_make_item(
                    title=f"[QooApp {sentiment}] {text[:40]}",
                    summary=text[:300],
                    source="qooapp",
                    platform_region=region,
                    time_str=date_str.strip(),
                    url=f"https://m-apps.qoo-app.com/en-US/app/{app_id}",
                    engagement=rating,
                    is_hot=False,
                    author="",
                    lang=lang,
                ))

            # Also try the review API endpoint
            try:
                review_resp = _get(
                    f"https://m-apps.qoo-app.com/en/app-review-detail/{app_id}",
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                review_html = review_resp.text
                for match in _re.finditer(
                    r'class="review-item"[^>]*>.*?'
                    r'class="[^"]*score[^"]*"[^>]*>(\d).*?'
                    r'class="[^"]*review-text[^"]*"[^>]*>([^<]+).*?'
                    r'class="[^"]*time[^"]*"[^>]*>([^<]+)',
                    review_html, _re.DOTALL
                ):
                    score, text, date_str = match.groups()
                    rating = int(score)
                    text = text.strip()
                    if not text:
                        continue
                    sentiment = '好评' if rating >= 4 else ('中评' if rating == 3 else '差评')
                    items.append(_make_item(
                        title=f"[QooApp {sentiment}] {text[:40]}",
                        summary=text[:300],
                        source="qooapp",
                        platform_region=region,
                        time_str=date_str.strip(),
                        url=f"https://m-apps.qoo-app.com/en/app-review-detail/{app_id}",
                        engagement=rating,
                        is_hot=False,
                        author="",
                        lang=lang,
                    ))
            except Exception:
                pass

            logger.info(f'QooApp ({region}): {len(items)} reviews')
        except Exception as e:
            logger.warning(f'QooApp ({region}) failed: {e}')

    return items


def fetch_epic_store():
    """从 Epic Games Store 获取忘却前夜页面评分和评论。"""
    slug = "morimens-61a2b4"
    items = []

    try:
        # Epic GraphQL API for product info
        resp = _get(
            "https://store.epicgames.com/graphql",
            params={
                "operationName": "getCatalogOffer",
                "variables": json.dumps({"locale": "en-US", "slug": slug}),
                "extensions": json.dumps({"persistedQuery": {"version": 1}}),
            },
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": f"https://store.epicgames.com/en-US/p/{slug}",
            },
        )
        if resp.status_code == 200:
            try:
                data = resp.json()
                product = data.get("data", {}).get("Catalog", {}).get("catalogOffer", {})
                if product:
                    title = product.get("title", "Morimens")
                    desc = product.get("description", "")
                    items.append(_make_item(
                        title=f"[Epic Store] {title}",
                        summary=desc[:300],
                        source="epic",
                        platform_region="global",
                        time_str=product.get("effectiveDate", datetime.now(timezone.utc).isoformat()),
                        url=f"https://store.epicgames.com/en-US/p/{slug}",
                        engagement=0,
                        is_hot=False,
                        author="Epic Games Store",
                        lang="en",
                    ))
            except (ValueError, KeyError):
                pass
    except Exception as e:
        logger.warning(f"Epic GraphQL failed: {e}")

    # Fallback: scrape the store page HTML for reviews/ratings
    try:
        resp = _get(
            f"https://store.epicgames.com/en-US/p/{slug}",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        html = resp.text
        import re as _re

        # Look for user ratings/reviews in the page
        rating_match = _re.search(r'"averageRating"\s*:\s*([\d.]+)', html)
        count_match = _re.search(r'"ratingCount"\s*:\s*(\d+)', html)

        if rating_match:
            avg_rating = float(rating_match.group(1))
            rating_count = int(count_match.group(1)) if count_match else 0
            items.append(_make_item(
                title=f"[Epic评分] Morimens ★{avg_rating:.1f} ({rating_count}条评价)",
                summary=f"Epic Games Store 平均评分 {avg_rating:.1f}/5，共 {rating_count} 条评价",
                source="epic",
                platform_region="global",
                time_str=datetime.now(timezone.utc).isoformat(),
                url=f"https://store.epicgames.com/en-US/p/{slug}",
                engagement=rating_count,
                is_hot=rating_count > 100,
                author="Epic Games Store",
                lang="en",
            ))

        # Extract individual review snippets if visible
        for match in _re.finditer(
            r'"reviewText"\s*:\s*"([^"]{10,300})".*?"rating"\s*:\s*(\d)',
            html, _re.DOTALL
        ):
            text, score = match.groups()
            rating = int(score)
            sentiment = '好评' if rating >= 4 else '差评'
            items.append(_make_item(
                title=f"[Epic {sentiment}] {text[:40]}",
                summary=text[:300],
                source="epic",
                platform_region="global",
                time_str=datetime.now(timezone.utc).isoformat(),
                url=f"https://store.epicgames.com/en-US/p/{slug}",
                engagement=rating,
                is_hot=False,
                author="",
                lang="en",
            ))

        logger.info(f"Epic Store: {len(items)} items")
    except Exception as e:
        logger.warning(f"Epic Store scrape failed: {e}")

    return items


def fetch_tiktok():
    """从 TikTok (国际版) 搜索忘却前夜相关视频。"""
    items = []
    for keyword in ["Morimens", "忘却前夜", "망각전야"]:
        try:
            data = _get(
                "https://www.tiktok.com/api/search/general/full/",
                params={"keyword": keyword, "offset": 0, "count": 20},
                headers={"Referer": "https://www.tiktok.com"},
            )
            if data and data.status_code == 200:
                try:
                    result = data.json()
                    for item_data in result.get("data", []) or []:
                        if item_data.get("type") != 1:  # type 1 = video
                            continue
                        video = item_data.get("item", {})
                        stats = video.get("stats", {})
                        play_count = stats.get("playCount", 0)
                        digg_count = stats.get("diggCount", 0)
                        items.append(_make_item(
                            title=video.get("desc", "")[:100],
                            summary=video.get("desc", "")[:300],
                            source="tiktok",
                            platform_region="global",
                            time_str=datetime.fromtimestamp(
                                video.get("createTime", 0), tz=timezone.utc
                            ).isoformat() if video.get("createTime") else datetime.now(timezone.utc).isoformat(),
                            url=f"https://www.tiktok.com/@{video.get('author', {}).get('uniqueId', '')}/video/{video.get('id', '')}",
                            engagement=digg_count + stats.get("commentCount", 0),
                            is_hot=play_count > 50000,
                            author=f"@{video.get('author', {}).get('uniqueId', '')}",
                            lang="",
                            content_type="video",
                            media_url=video.get("video", {}).get("cover", ""),
                        ))
                except (ValueError, KeyError):
                    pass

            logger.info(f'TikTok "{keyword}": {len(items)} videos')
        except Exception as e:
            logger.warning(f'TikTok "{keyword}" failed: {e}')

    return items


def fetch_zhihu():
    """从知乎搜索忘却前夜相关问答/文章。"""
    items = []
    for keyword in KEYWORDS["zh"]:
        try:
            data = _get(
                "https://www.zhihu.com/api/v4/search_v3",
                params={"q": keyword, "t": "general", "offset": 0, "limit": 20},
                headers={"Referer": "https://www.zhihu.com"},
            )
            if data and data.status_code == 200:
                try:
                    result = data.json()
                    for obj in result.get("data", []) or []:
                        obj_type = obj.get("type", "")
                        target = obj.get("object", {}) or obj.get("highlight", {})

                        if obj_type == "search_result":
                            target = obj.get("object", {})

                        title = target.get("title", target.get("question", {}).get("title", ""))
                        excerpt = target.get("excerpt", target.get("content", ""))[:300]
                        voteup = target.get("voteup_count", 0) or 0
                        comment = target.get("comment_count", 0) or 0

                        # 判断内容类型
                        content_url = target.get("url", "")
                        if "question" in content_url:
                            url = f"https://www.zhihu.com/question/{target.get('question', {}).get('id', '')}/answer/{target.get('id', '')}"
                        elif "zhuanlan" in content_url or target.get("type") == "article":
                            url = f"https://zhuanlan.zhihu.com/p/{target.get('id', '')}"
                        else:
                            url = content_url

                        items.append(_make_item(
                            title=_strip_html(title),
                            summary=_strip_html(excerpt),
                            source="zhihu",
                            platform_region="cn",
                            time_str=target.get("created_time",
                                target.get("updated_time", datetime.now(timezone.utc).isoformat())),
                            url=url,
                            engagement=voteup + comment,
                            is_hot=voteup > 100,
                            author=target.get("author", {}).get("name", ""),
                            lang="zh",
                        ))
                except (ValueError, KeyError):
                    pass

            logger.info(f'Zhihu "{keyword}": {len(items)} results')
        except Exception as e:
            logger.warning(f'Zhihu "{keyword}" failed: {e}')

    return items


def fetch_bahamut():
    """从巴哈姆特 (gamer.com.tw) 搜索忘却前夜讨论。台湾最大游戏社区。"""
    baha_bsn = os.environ.get("BAHAMUT_BSN", "")  # 版块编号
    items = []

    # 方式1: 如果有版块号，直接抓版块
    if baha_bsn:
        try:
            data = _get(
                f"https://forum.gamer.com.tw/B.php?bsn={baha_bsn}&ajax=1",
                headers={"Referer": "https://forum.gamer.com.tw"},
            )
            if data and data.status_code == 200:
                try:
                    result = data.json()
                    for thread in result.get("data", {}).get("list", []) or []:
                        gp = int(thread.get("gp", 0))
                        reply = int(thread.get("reply", 0))
                        items.append(_make_item(
                            title=thread.get("title", ""),
                            summary="",
                            source="bahamut",
                            platform_region="cn",
                            time_str=thread.get("ctime", datetime.now(timezone.utc).isoformat()),
                            url=f"https://forum.gamer.com.tw/C.php?bsn={baha_bsn}&snA={thread.get('snA', '')}",
                            engagement=gp + reply,
                            is_hot=gp > 50,
                            author=thread.get("nick", ""),
                            lang="zh",
                        ))
                except (ValueError, KeyError):
                    pass
            logger.info(f"Bahamut bsn={baha_bsn}: {len(items)} threads")
        except Exception as e:
            logger.warning(f"Bahamut bsn={baha_bsn} failed: {e}")

    # 方式2: 关键词搜索
    for keyword in KEYWORDS["zh"]:
        try:
            data = _get(
                "https://forum.gamer.com.tw/search.php",
                params={"q": keyword, "bsn": "0", "ajax": "1"},
                headers={"Referer": "https://forum.gamer.com.tw"},
            )
            if data and data.status_code == 200:
                try:
                    result = data.json()
                    for thread in result.get("data", {}).get("list", []) or []:
                        gp = int(thread.get("gp", 0))
                        reply = int(thread.get("reply", 0))
                        items.append(_make_item(
                            title=thread.get("title", ""),
                            summary="",
                            source="bahamut",
                            platform_region="cn",
                            time_str=thread.get("ctime", datetime.now(timezone.utc).isoformat()),
                            url=thread.get("url", ""),
                            engagement=gp + reply,
                            is_hot=gp > 50,
                            author=thread.get("nick", ""),
                            lang="zh",
                        ))
                except (ValueError, KeyError):
                    pass
            logger.info(f'Bahamut search "{keyword}": {len(items)} results')
        except Exception as e:
            logger.warning(f'Bahamut search "{keyword}" failed: {e}')

    return items


def fetch_telegram():
    """从 Telegram 公开群组/频道获取忘却前夜讨论。"""
    tg_channels = os.environ.get("TELEGRAM_CHANNELS", "").split(",")
    if not tg_channels[0]:
        logger.info("Telegram: TELEGRAM_CHANNELS not set, skipping")
        return []

    items = []
    for channel in tg_channels:
        channel = channel.strip()
        if not channel:
            continue
        try:
            # 使用 Telegram 公开频道的 JSON 导出 (t.me/s/ 格式)
            data = _get(
                f"https://t.me/s/{channel}",
                headers={"Accept": "text/html"},
            )
            if data and data.status_code == 200:
                # 简单解析 HTML 中的消息
                # 实际部署建议用 Telegram Bot API 或 Telethon
                html = data.text
                # 提取消息块 (tgme_widget_message)
                messages = re.findall(
                    r'class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>',
                    html, re.DOTALL
                )
                msg_dates = re.findall(
                    r'<time[^>]*datetime="([^"]+)"',
                    html
                )
                msg_views = re.findall(
                    r'class="tgme_widget_message_views"[^>]*>([^<]+)',
                    html
                )

                for i, msg_html in enumerate(messages[-20:]):  # 最近20条
                    text = _strip_html(msg_html).strip()
                    if not text:
                        continue
                    # 检查相关性
                    if not any(kw.lower() in text.lower() for kw in ALL_KEYWORDS):
                        continue

                    views_str = msg_views[i] if i < len(msg_views) else "0"
                    views = 0
                    try:
                        views_str = views_str.strip().replace("K", "000").replace("M", "000000").replace(".", "")
                        views = int(views_str)
                    except ValueError:
                        pass

                    items.append(_make_item(
                        title=text[:100],
                        summary=text[:300],
                        source="telegram",
                        platform_region="global",
                        time_str=msg_dates[i] if i < len(msg_dates) else datetime.now(timezone.utc).isoformat(),
                        url=f"https://t.me/{channel}",
                        engagement=views,
                        is_hot=views > 1000,
                        author=f"@{channel}",
                        lang="",
                    ))

            logger.info(f"Telegram @{channel}: {len(items)} messages")
        except Exception as e:
            logger.warning(f"Telegram @{channel} failed: {e}")

    return items


def fetch_twitch():
    """从 Twitch 搜索忘却前夜相关直播和视频。"""
    twitch_client_id = os.environ.get("TWITCH_CLIENT_ID", "")
    twitch_token = os.environ.get("TWITCH_ACCESS_TOKEN", "")
    if not twitch_client_id or not twitch_token:
        logger.info("Twitch: TWITCH_CLIENT_ID or TWITCH_ACCESS_TOKEN not set, skipping")
        return []

    items = []
    headers = {
        "Client-ID": twitch_client_id,
        "Authorization": f"Bearer {twitch_token}",
    }

    # 搜索直播中的频道
    for keyword in ["Morimens", "忘却前夜"]:
        try:
            data = _get(
                "https://api.twitch.tv/helix/search/channels",
                params={"query": keyword, "first": 20, "live_only": "true"},
                headers=headers,
            ).json()

            for ch in data.get("data", []):
                items.append(_make_item(
                    title=f"[LIVE] {ch.get('title', '')}",
                    summary=f"Playing: {ch.get('game_name', '')} | {ch.get('display_name', '')}",
                    source="twitch",
                    platform_region="global",
                    time_str=ch.get("started_at", datetime.now(timezone.utc).isoformat()),
                    url=f"https://www.twitch.tv/{ch.get('broadcaster_login', '')}",
                    engagement=0,
                    is_hot=ch.get("is_live", False),
                    author=ch.get("display_name", ""),
                    lang=ch.get("broadcaster_language", ""),
                    content_type="stream",
                ))

            logger.info(f'Twitch "{keyword}": {len(items)} live channels')
        except Exception as e:
            logger.warning(f'Twitch "{keyword}" failed: {e}')

    # 搜索视频/VOD
    for keyword in ["Morimens", "忘却前夜"]:
        try:
            data = _get(
                "https://api.twitch.tv/helix/search/channels",
                params={"query": keyword, "first": 20},
                headers=headers,
            ).json()

            # 对每个频道获取最新视频
            for ch in (data.get("data", []) or [])[:5]:
                user_id = ch.get("id", "")
                if not user_id:
                    continue
                vods = _get(
                    "https://api.twitch.tv/helix/videos",
                    params={"user_id": user_id, "first": 5, "type": "archive"},
                    headers=headers,
                ).json()

                for vod in vods.get("data", []) or []:
                    views = vod.get("view_count", 0)
                    items.append(_make_item(
                        title=vod.get("title", ""),
                        summary=vod.get("description", "")[:300],
                        source="twitch",
                        platform_region="global",
                        time_str=vod.get("created_at", ""),
                        url=vod.get("url", ""),
                        engagement=views,
                        is_hot=views > 1000,
                        author=vod.get("user_name", ""),
                        lang=vod.get("language", ""),
                        content_type="video",
                        media_url=vod.get("thumbnail_url", ""),
                    ))

            logger.info(f'Twitch VODs "{keyword}": {len(items)} total items')
        except Exception as e:
            logger.warning(f'Twitch VODs "{keyword}" failed: {e}')

    return items


def fetch_instagram():
    """从 Instagram 搜索忘却前夜相关帖子 (hashtag)。"""
    ig_token = os.environ.get("INSTAGRAM_ACCESS_TOKEN", "")
    ig_user_id = os.environ.get("INSTAGRAM_USER_ID", "")
    if not ig_token:
        logger.info("Instagram: INSTAGRAM_ACCESS_TOKEN not set, skipping")
        return []

    items = []
    for hashtag in ["morimens", "忘却前夜", "망각전야"]:
        try:
            # Step 1: 获取 hashtag ID
            tag_data = _get(
                "https://graph.facebook.com/v18.0/ig_hashtag_search",
                params={"q": hashtag, "user_id": ig_user_id, "access_token": ig_token},
            ).json()
            tag_id = tag_data.get("data", [{}])[0].get("id", "")
            if not tag_id:
                continue

            # Step 2: 获取最近帖子
            posts = _get(
                f"https://graph.facebook.com/v18.0/{tag_id}/recent_media",
                params={
                    "user_id": ig_user_id,
                    "fields": "caption,like_count,comments_count,timestamp,permalink,media_url,username",
                    "access_token": ig_token,
                    "limit": 20,
                },
            ).json()

            for post in posts.get("data", []):
                caption = post.get("caption", "")
                likes = post.get("like_count", 0)
                comments = post.get("comments_count", 0)
                items.append(_make_item(
                    title=caption[:100] if caption else f"#{hashtag}",
                    summary=caption[:300] if caption else "",
                    source="instagram",
                    platform_region="global",
                    time_str=post.get("timestamp", ""),
                    url=post.get("permalink", ""),
                    engagement=likes + comments,
                    is_hot=likes > 500,
                    author=f"@{post.get('username', '')}",
                    lang="",
                    content_type="image",
                    media_url=post.get("media_url", ""),
                ))

            logger.info(f'Instagram #{hashtag}: {len(items)} posts')
        except Exception as e:
            logger.warning(f'Instagram #{hashtag} failed: {e}')

    return items


# ─── 微信公众号 (via 搜狗) ─────────────────────────────────

def fetch_weixin():
    """通过搜狗微信搜索抓取忘却前夜相关公众号文章。

    搜狗是唯一公开索引微信公众号文章的搜索引擎。
    """
    items = []
    for keyword in KEYWORDS["zh"]:
        try:
            resp = _get(
                "https://weixin.sogou.com/weixin",
                params={"type": 2, "query": keyword, "ie": "utf8", "s_from": "input", "page": 1},
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    "Referer": "https://weixin.sogou.com/",
                },
            )
            html = resp.text
            import re as _re

            # Parse search results
            for match in _re.finditer(
                r'<h3>.*?<a[^>]*href="([^"]+)"[^>]*>(.+?)</a>.*?'
                r'class="s-p"[^>]*>([^<]*)',
                html, _re.DOTALL
            ):
                url, title_html, meta = match.groups()
                # Clean HTML tags from title
                title = _re.sub(r'<[^>]+>', '', title_html).strip()
                if not title:
                    continue

                # Extract author from meta
                author_match = _re.search(r'微信公众号\s*[:：]\s*([^\s<]+)', meta)
                author = author_match.group(1) if author_match else ""

                items.append(_make_item(
                    title=f"[微信] {title}",
                    summary="",
                    source="weixin",
                    platform_region="cn",
                    time_str=datetime.now(timezone.utc).isoformat(),
                    url=url,
                    engagement=0,
                    is_hot=False,
                    author=author,
                    lang="zh",
                ))

            logger.info(f'搜狗微信 "{keyword}": {len(items)} articles')
        except Exception as e:
            logger.warning(f'搜狗微信 "{keyword}" failed: {e}')

    return items


# ─── 日本語プラットフォーム ────────────────────────────────

def fetch_gamerch():
    """从 Gamerch Wiki 获取忘却前夜攻略更新。"""
    items = []
    try:
        resp = _get(
            "https://gamerch.com/morimens/",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        html = resp.text
        import re as _re

        # Extract recent updates / article links from the wiki
        for match in _re.finditer(
            r'<a[^>]*href="(https://gamerch\.com/morimens/\d+)"[^>]*>\s*([^<]+?)\s*</a>',
            html
        ):
            url, title = match.groups()
            title = title.strip()
            if not title or len(title) < 5:
                continue
            items.append(_make_item(
                title=f"[Gamerch] {title}",
                summary="",
                source="gamerch",
                platform_region="jp",
                time_str=datetime.now(timezone.utc).isoformat(),
                url=url,
                engagement=0,
                is_hot=False,
                author="Gamerch Wiki",
                lang="ja",
            ))

        logger.info(f"Gamerch Wiki: {len(items)} articles")
    except Exception as e:
        logger.warning(f"Gamerch Wiki failed: {e}")

    return items


def fetch_note_com():
    """从 Note.com 搜索忘却前夜/モリメンス 攻略文章（API v3）。"""
    items = []
    for keyword in KEYWORDS["ja"]:
        try:
            resp = _get(
                "https://note.com/api/v3/searches",
                params={"q": keyword, "size": 20, "sort": "new", "context": "note"},
                headers={"User-Agent": "Mozilla/5.0"},
            )
            if resp.status_code == 200:
                data = resp.json()
                # v3 response: data.notes.contents or data.sections[0].contents
                notes_data = data.get("data", {})
                contents = (notes_data.get("notes", {}).get("contents", [])
                           or notes_data.get("sections", [{}])[0].get("contents", [])
                           if notes_data.get("sections") else [])
                for note in contents or []:
                    items.append(_make_item(
                        title=note.get("name", ""),
                        summary=note.get("body", "")[:300],
                        source="note_com",
                        platform_region="jp",
                        time_str=note.get("publishAt", datetime.now(timezone.utc).isoformat()),
                        url=note.get("noteUrl", ""),
                        engagement=note.get("likeCount", 0) + note.get("commentCount", 0),
                        is_hot=note.get("likeCount", 0) > 50,
                        author=note.get("user", {}).get("nickname", ""),
                        lang="ja",
                    ))

            logger.info(f'Note.com "{keyword}": {len(items)} notes')
        except Exception as e:
            logger.warning(f'Note.com "{keyword}" failed: {e}')

    return items


# ─── 韓国追加プラットフォーム ──────────────────────────────

def fetch_ruliweb():
    """从 Ruliweb 搜索韩国忘却前夜讨论。"""
    items = []
    for keyword in KEYWORDS["ko"]:
        try:
            resp = _get_cf(
                "https://bbs.ruliweb.com/search",
                params={"q": keyword, "page": 1},
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            )
            html = resp.text
            import re as _re

            for match in _re.finditer(
                r'class="subject_link"[^>]*href="([^"]+)"[^>]*>\s*([^<]+?)\s*</a>.*?'
                r'class="recomd"[^>]*>(\d+)?',
                html, _re.DOTALL
            ):
                url, title, likes = match.groups()
                title = title.strip()
                if not title:
                    continue
                likes_count = int(likes) if likes else 0

                if not url.startswith("http"):
                    url = f"https://bbs.ruliweb.com{url}"

                items.append(_make_item(
                    title=title,
                    summary="",
                    source="ruliweb",
                    platform_region="kr",
                    time_str=datetime.now(timezone.utc).isoformat(),
                    url=url,
                    engagement=likes_count,
                    is_hot=likes_count > 10,
                    author="",
                    lang="ko",
                ))

            logger.info(f'Ruliweb "{keyword}": {len(items)} posts')
        except Exception as e:
            logger.warning(f'Ruliweb "{keyword}" failed: {e}')

    return items


# ─── Русские платформы ─────────────────────────────────────

def fetch_vkplay():
    """从 VK Play API 获取忘却前夜页面和评论。"""
    items = []
    game_slug = "morimens"
    try:
        # Try VK Play API for game info
        resp = _get(
            f"https://api.vkplay.ru/play/games/{game_slug}/",
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://vkplay.ru/",
                "Accept": "application/json",
            },
        )
        if resp.status_code == 200:
            data = resp.json()
            rating = data.get("rating", 0)
            title_name = data.get("title", "Morimens")
            if rating:
                items.append(_make_item(
                    title=f"[VK Play] {title_name} — рейтинг {rating}",
                    summary=data.get("description", "")[:300],
                    source="vkplay",
                    platform_region="ru",
                    time_str=datetime.now(timezone.utc).isoformat(),
                    url=f"https://vkplay.ru/play/game/{game_slug}/",
                    engagement=int(float(str(rating)) * 10) if rating else 0,
                    is_hot=False,
                    author="VK Play",
                    lang="ru",
                ))
    except Exception as e:
        logger.warning(f"VK Play game info failed: {e}")

    # Try reviews API
    try:
        resp = _get(
            f"https://api.vkplay.ru/play/games/{game_slug}/reviews/",
            params={"limit": 20, "offset": 0},
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://vkplay.ru/",
                "Accept": "application/json",
            },
        )
        if resp.status_code == 200:
            data = resp.json()
            reviews = data.get("results", []) or data if isinstance(data, list) else []
            for review in (reviews if isinstance(reviews, list) else []):
                text = review.get("text", "") or review.get("body", "")
                if not text:
                    continue
                items.append(_make_item(
                    title=f"[VK Play] {text[:60]}",
                    summary=text[:300],
                    source="vkplay",
                    platform_region="ru",
                    time_str=review.get("created_at", datetime.now(timezone.utc).isoformat()),
                    url=f"https://vkplay.ru/play/game/{game_slug}/",
                    engagement=review.get("likes", 0),
                    is_hot=False,
                    author=review.get("user", {}).get("name", "") if isinstance(review.get("user"), dict) else "",
                    lang="ru",
                ))
    except Exception as e:
        logger.warning(f"VK Play reviews failed: {e}")

    logger.info(f"VK Play: {len(items)} items")
    return items


def fetch_stopgame():
    """从 StopGame.ru 获取忘却前夜评测和评分。"""
    items = []
    try:
        resp = _get(
            "https://stopgame.ru/game/morimens",
            headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "ru-RU,ru;q=0.9"},
        )
        html = resp.text
        import re as _re

        # Extract game rating
        rating_match = _re.search(r'class="[^"]*rating[^"]*"[^>]*>(\d+\.?\d*)', html)
        review_count_match = _re.search(r'(\d+)\s*(?:отзыв|оцен)', html)

        if rating_match:
            rating = float(rating_match.group(1))
            count = int(review_count_match.group(1)) if review_count_match else 0
            items.append(_make_item(
                title=f"[StopGame] Morimens — {rating}/10 ({count} оценок)",
                summary="",
                source="stopgame",
                platform_region="ru",
                time_str=datetime.now(timezone.utc).isoformat(),
                url="https://stopgame.ru/game/morimens",
                engagement=count,
                is_hot=count > 50,
                author="StopGame.ru",
                lang="ru",
            ))

        # Extract user reviews
        for match in _re.finditer(
            r'class="[^"]*review-text[^"]*"[^>]*>([^<]{10,300})',
            html, _re.DOTALL
        ):
            text = match.group(1).strip()
            items.append(_make_item(
                title=f"[StopGame] {text[:60]}",
                summary=text[:300],
                source="stopgame",
                platform_region="ru",
                time_str=datetime.now(timezone.utc).isoformat(),
                url="https://stopgame.ru/game/morimens",
                engagement=0,
                is_hot=False,
                author="",
                lang="ru",
            ))

        logger.info(f"StopGame: {len(items)} items")
    except Exception as e:
        logger.warning(f"StopGame failed: {e}")

    return items


# ─── Global English wiki/guide platforms ───────────────────

def fetch_gacharevenue():
    """从 GACHAREVENUE 获取忘却前夜收入数据。"""
    items = []
    try:
        resp = _get(
            "https://revenue.ennead.cc/games/morimens",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        html = resp.text
        import re as _re

        # Extract revenue data from the page
        revenue_match = _re.search(r'"revenue"[:\s]*([\d,]+)', html)
        if revenue_match:
            revenue = revenue_match.group(1)
            items.append(_make_item(
                title=f"[GACHAREVENUE] Morimens 收入数据: ${revenue}",
                summary="",
                source="gacharevenue",
                platform_region="global",
                time_str=datetime.now(timezone.utc).isoformat(),
                url="https://revenue.ennead.cc/games/morimens",
                engagement=0,
                is_hot=False,
                author="GACHAREVENUE",
                lang="en",
            ))

        logger.info(f"GACHAREVENUE: {len(items)} items")
    except Exception as e:
        logger.warning(f"GACHAREVENUE failed: {e}")

    return items


def fetch_miraheze_wiki():
    """从 Miraheze Wiki 获取忘却前夜最近更改。"""
    items = []
    try:
        resp = _get(
            "https://morimenseveofoblivion.miraheze.org/w/api.php",
            params={
                "action": "query",
                "list": "recentchanges",
                "rcnamespace": "0",
                "rclimit": "20",
                "rcprop": "title|timestamp|user|comment|sizes",
                "rctype": "edit|new",
                "format": "json",
            },
            headers={"User-Agent": "MorimensNewsBot/1.0"},
        )
        data = resp.json()
        changes = data.get("query", {}).get("recentchanges", [])

        for change in changes:
            title = change.get("title", "")
            user = change.get("user", "")
            comment = change.get("comment", "")
            ts = change.get("timestamp", "")
            diff = abs(change.get("newlen", 0) - change.get("oldlen", 0))

            items.append(_make_item(
                title=f"[Miraheze Wiki] {title}",
                summary=comment[:200] if comment else f"Edited by {user} (+{diff} bytes)",
                source="miraheze_wiki",
                platform_region="global",
                time_str=ts,
                url=f"https://morimenseveofoblivion.miraheze.org/wiki/{title.replace(' ', '_')}",
                engagement=diff,
                is_hot=diff > 500,
                author=user,
                lang="en",
            ))

        logger.info(f"Miraheze Wiki: {len(items)} recent changes")
    except Exception as e:
        logger.warning(f"Miraheze Wiki failed: {e}")

    return items


# ─── 东南亚 & 中文补充 ─────────────────────────────────────

def fetch_gamekee():
    """从 GameKee Wiki 获取忘却前夜论坛和攻略更新。"""
    items = []

    # GameKee 论坛社区 API
    try:
        resp = _get(
            "https://morimens.gamekee.com/v1/content/lists",
            params={"page": 1, "size": 20, "order": "new"},
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.gamekee.com/morimens/"},
        )
        if resp.status_code == 200:
            try:
                data = resp.json()
                for item in data.get("data", {}).get("list", []) or []:
                    items.append(_make_item(
                        title=item.get("title", ""),
                        summary=item.get("summary", "")[:300],
                        source="gamekee",
                        platform_region="cn",
                        time_str=item.get("created_at", datetime.now(timezone.utc).isoformat()),
                        url=f"https://www.gamekee.com/morimens/{item.get('content_id', '')}",
                        engagement=item.get("view_num", 0),
                        is_hot=item.get("view_num", 0) > 1000,
                        author=item.get("user", {}).get("nickname", ""),
                        lang="zh",
                    ))
            except (ValueError, KeyError):
                pass
    except Exception as e:
        logger.warning(f"GameKee API failed: {e}")

    # Fallback: scrape main wiki page for recent articles
    if not items:
        try:
            resp = _get(
                "https://www.gamekee.com/morimens/",
                headers={"User-Agent": "Mozilla/5.0"},
            )
            html = resp.text
            import re as _re
            for match in _re.finditer(
                r'href="(/morimens/(\d+)\.html)"[^>]*>\s*([^<]+?)\s*</a>',
                html
            ):
                path, article_id, title = match.groups()
                title = title.strip()
                if not title or len(title) < 5:
                    continue
                items.append(_make_item(
                    title=f"[GameKee] {title}",
                    summary="",
                    source="gamekee",
                    platform_region="cn",
                    time_str=datetime.now(timezone.utc).isoformat(),
                    url=f"https://www.gamekee.com{path}",
                    engagement=0,
                    is_hot=False,
                    author="GameKee Wiki",
                    lang="zh",
                ))
        except Exception as e:
            logger.warning(f"GameKee scrape failed: {e}")

    logger.info(f"GameKee: {len(items)} items")
    return items


def fetch_huiji_wiki():
    """从灰机 Wiki 获取忘却前夜最近更改。"""
    items = []
    try:
        resp = _get(
            "https://morimens.huijiwiki.com/api.php",
            params={
                "action": "query",
                "list": "recentchanges",
                "rcnamespace": "0",
                "rclimit": "20",
                "rcprop": "title|timestamp|user|comment|sizes",
                "rctype": "edit|new",
                "format": "json",
            },
            headers={"User-Agent": "MorimensNewsBot/1.0"},
        )
        data = resp.json()
        changes = data.get("query", {}).get("recentchanges", [])

        for change in changes:
            title = change.get("title", "")
            user = change.get("user", "")
            comment = change.get("comment", "")
            ts = change.get("timestamp", "")
            diff = abs(change.get("newlen", 0) - change.get("oldlen", 0))

            items.append(_make_item(
                title=f"[灰机Wiki] {title}",
                summary=comment[:200] if comment else f"{user} 编辑 (+{diff} 字节)",
                source="huiji_wiki",
                platform_region="cn",
                time_str=ts,
                url=f"https://morimens.huijiwiki.com/wiki/{title.replace(' ', '_')}",
                engagement=diff,
                is_hot=diff > 500,
                author=user,
                lang="zh",
            ))

        logger.info(f"Huiji Wiki: {len(items)} recent changes")
    except Exception as e:
        logger.warning(f"Huiji Wiki failed: {e}")

    return items


# ─── 去重 & 输出 ──────────────────────────────────────────

def deduplicate(items):
    """基于标题相似度的简单去重。"""
    seen = set()
    unique = []
    for item in items:
        key = item["title"].lower().strip()[:60]
        if key and key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


# ─── RSSHub 通用采集器 ────────────────────────────────────────

# RSSHub routes: (route, source_name, platform_region, lang)
RSSHUB_ROUTES = [
    # ── 中文平台 ──
    ("/weibo/keyword/忘却前夜", "weibo", "cn", "zh"),
    ("/weibo/keyword/Morimens", "weibo", "cn", "zh"),
    ("/zhihu/search/忘却前夜", "zhihu", "cn", "zh"),
    ("/xiaohongshu/keyword/忘却前夜", "xiaohongshu", "cn", "zh"),
    ("/douyin/keyword/忘却前夜", "douyin", "cn", "zh"),
    ("/bilibili/search/忘却前夜", "bilibili", "cn", "zh"),
    ("/tieba/forum/忘却前夜", "tieba", "cn", "zh"),
    ("/nga/search/忘却前夜", "nga", "cn", "zh"),
    ("/lofter/tag/忘却前夜", "lofter", "cn", "zh"),
    # ── 日本平台 ──
    ("/pixiv/search/忘却前夜", "pixiv", "jp", "ja"),
    ("/pixiv/search/モリメンス", "pixiv", "jp", "ja"),
    ("/5ch/search/忘却前夜", "fivech", "jp", "ja"),
    # ── 韩国平台 ──
    ("/dcinside/board/morimens", "dcinside", "kr", "ko"),
    # ── 全球平台 ──
    ("/tiktok/keyword/Morimens", "tiktok", "global", "en"),
    ("/reddit/search/Morimens", "reddit", "global", "en"),
    ("/telegram/channel/Morimens", "telegram", "global", "en"),
]


def fetch_rsshub():
    """通过自部署 RSSHub 实例采集多个平台（微博/知乎/小红书/抖音/Pixiv/TikTok）。

    需要设置环境变量 RSSHUB_URL，指向你的 RSSHub 实例地址。
    例如: RSSHUB_URL=https://rsshub.example.com
    """
    rsshub_url = os.environ.get("RSSHUB_URL", "").rstrip("/")
    if not rsshub_url:
        logger.info("RSSHub: RSSHUB_URL not set, skipping (deploy RSSHub and set this env var)")
        return []

    items = []
    import re as _re

    for route, source, region, lang in RSSHUB_ROUTES:
        try:
            resp = _get(
                f"{rsshub_url}{route}",
                params={"format": "json", "limit": 20},
                headers={"Accept": "application/json"},
                timeout=20,
            )

            data = resp.json()
            feed_items = data.get("items", [])

            for entry in feed_items:
                title = entry.get("title", "")
                if not title:
                    continue
                # Clean HTML from title/content
                title = _re.sub(r'<[^>]+>', '', title).strip()
                content = entry.get("content_text", "") or entry.get("content_html", "")
                content = _re.sub(r'<[^>]+>', '', content).strip()[:300]

                url = entry.get("url", "") or entry.get("id", "")
                time_str = entry.get("date_published", "") or entry.get("date_modified", "")

                # Extract author
                authors = entry.get("authors", [])
                author = authors[0].get("name", "") if authors else ""

                items.append(_make_item(
                    title=title,
                    summary=content,
                    source=source,
                    platform_region=region,
                    time_str=time_str or datetime.now(timezone.utc).isoformat(),
                    url=url,
                    engagement=0,
                    is_hot=False,
                    author=author,
                    lang=lang,
                ))

            if feed_items:
                logger.info(f"RSSHub {route}: +{len(feed_items)} items")
        except Exception as e:
            logger.warning(f"RSSHub {route} failed: {e}")

    logger.info(f"RSSHub total: {len(items)} items from {len(RSSHUB_ROUTES)} routes")
    return items


def collect_all():
    """运行所有采集器，合并、去重、排序后输出。"""
    logger.info("=== 忘却前夜 全球信息收集开始 ===")

    _refresh_cutoff()

    all_items = []
    fetchers = [
        # 中文社区
        ("Bilibili", fetch_bilibili),
        ("NGA", fetch_nga),
        ("TapTap", fetch_taptap),
        ("Weibo", fetch_weibo),
        ("Xiaohongshu", fetch_xiaohongshu),
        ("Douyin", fetch_douyin),
        ("Tieba", fetch_tieba),
        ("QQ", fetch_qq),
        ("Zhihu", fetch_zhihu),
        ("Bahamut", fetch_bahamut),
        # 同人创作
        ("Pixiv", fetch_pixiv),
        ("Lofter", fetch_lofter),
        # 周边/交易
        ("Xianyu", fetch_xianyu),
        ("Taobao Merch", fetch_taobao_merch),
        # 全球社区
        ("Reddit", fetch_reddit),
        ("Twitter/X", fetch_twitter),
        ("YouTube", fetch_youtube),
        ("Discord", fetch_discord),
        ("Facebook", fetch_facebook),
        ("TikTok", fetch_tiktok),
        ("Telegram", fetch_telegram),
        ("Twitch", fetch_twitch),
        ("Instagram", fetch_instagram),
        # 韩国社区
        ("Naver Cafe", fetch_naver_cafe),
        ("DCInside", fetch_dcinside),
        ("Arca.live", fetch_arca_live),
        # 日本社区
        ("5ch", fetch_fivech),
        # 应用商店
        ("App Store", fetch_appstore_reviews),
        ("Google Play", fetch_google_play),
        # 以下平台此前漏注册
        ("QooApp", fetch_qooapp),
        ("Epic Store", fetch_epic_store),
        ("Gamerch Wiki", fetch_gamerch),
        ("Note.com", fetch_note_com),
        ("Ruliweb", fetch_ruliweb),
        ("VK Play", fetch_vkplay),
        ("StopGame", fetch_stopgame),
        ("GACHAREVENUE", fetch_gacharevenue),
        ("Miraheze Wiki", fetch_miraheze_wiki),
        ("GameKee", fetch_gamekee),
        ("Huiji Wiki", fetch_huiji_wiki),
        ("搜狗微信", fetch_weixin),
        # RSSHub 代理采集（微博/知乎/小红书/抖音/Pixiv/TikTok）
        ("RSSHub", fetch_rsshub),
    ]

    for name, fn in fetchers:
        try:
            result = fn()
            all_items.extend(result)
            logger.info(f"  {name}: +{len(result)} items")
        except Exception as e:
            logger.error(f"  {name} crashed: {e}")

    # 去重
    unique = deduplicate(all_items)

    # 按互动量降序
    unique.sort(key=lambda x: x.get("engagement", 0), reverse=True)

    # Top 条目标记热门
    for item in unique[:10]:
        item["is_hot"] = True

    # 统计
    sources = {}
    regions = {}
    langs = {}
    for item in unique:
        sources[item["source"]] = sources.get(item["source"], 0) + 1
        regions[item["platform_region"]] = regions.get(item["platform_region"], 0) + 1
        if item["lang"]:
            langs[item["lang"]] = langs.get(item["lang"], 0) + 1

    output = {
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "hours_lookback": HOURS_LOOKBACK,
        "total_items": len(unique),
        "stats": {
            "by_source": sources,
            "by_region": regions,
            "by_lang": langs,
        },
        "items": unique,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    logger.info(f"=== 收集完成: {len(unique)} items → {OUTPUT_PATH} ===")
    return output


if __name__ == "__main__":
    collect_all()
