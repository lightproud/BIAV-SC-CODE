#!/usr/bin/env python3
"""
忘却前夜 Morimens - 全球信息收集器
从全球多个社区平台收集忘却前夜相关信息，输出结构化 JSON 数据。

支持平台 (29个):
  中文: Bilibili, NGA, TapTap, Weibo, Xiaohongshu, Douyin, Tieba, QQ频道, Zhihu, Bahamut(巴哈姆特)
  同人: Pixiv, Lofter
  周边: 闲鱼, 淘宝
  全球: Reddit, Twitter/X, YouTube, Discord, Facebook, TikTok, Telegram, Twitch, Instagram
  韩国: Naver Cafe, Arca.live
  日本: 5ch
  商店: App Store, Google Play

使用: python scripts/collector.py
输出: data/collected_raw.json
"""

import asyncio
import json
import os
import re
import sys
import logging
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import xml.etree.ElementTree as ET

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import news_common  # 采集层共享工具（HTTP/HTML-strip/item 单一真源，ARCH-01/02）

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("collector")

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_PATH = BASE_DIR / "data" / "collected_raw.json"

# Adaptive lookback: expands automatically if CI was down
try:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from collection_state import get_lookback_hours
    HOURS_LOOKBACK = int(os.environ.get("HOURS_LOOKBACK", "0")) or get_lookback_hours()
except ImportError:
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
    """带重试的 GET 请求 (间隔 1s/2s)。委托 news_common.get_with_retry（单一真源）。"""
    return news_common.get_with_retry(
        url, params=params, headers=headers, timeout=timeout,
        default_headers=DEFAULT_HEADERS,
    )


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
    """移除 HTML 标签。委托 news_common.strip_html（单一真源）。"""
    return news_common.strip_html(text)


# 创建标准化信息条目：直接复用 news_common.make_item（单一真源，签名等价）。
_make_item = news_common.make_item


# ─── 数据源采集器 ──────────────────────────────────────────

def _strip_html_tags(html: str) -> str:
    """Remove HTML tags and return plain text. 委托 news_common.strip_html。"""
    return news_common.strip_html(html).strip()


def _parse_reddit_rss(xml_text: str, sub: str) -> list:
    """Parse Reddit Atom RSS feed and return list of items."""
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    root = ET.fromstring(xml_text)
    items = []

    for entry in root.findall("atom:entry", ns):
        title_el = entry.find("atom:title", ns)
        link_el = entry.find("atom:link", ns)
        updated_el = entry.find("atom:updated", ns)
        author_el = entry.find("atom:author/atom:name", ns)
        content_el = entry.find("atom:content", ns)

        title = title_el.text if title_el is not None else ""
        link = link_el.get("href", "") if link_el is not None else ""
        updated_str = updated_el.text if updated_el is not None else ""
        author = author_el.text if author_el is not None else ""
        content_html = content_el.text if content_el is not None else ""

        # Parse ISO timestamp
        if not updated_str:
            continue
        try:
            created = datetime.fromisoformat(updated_str.replace("Z", "+00:00"))
        except ValueError:
            continue
        if created < CUTOFF:
            continue

        # Filter non-dedicated subreddits by keyword
        if sub.lower() not in ("morimens", "morimensgame"):
            title_lower = (title or "").lower()
            if not any(kw.lower() in title_lower for kw in ALL_KEYWORDS):
                continue

        summary = _strip_html_tags(content_html) if content_html else ""

        items.append(_make_item(
            title=title,
            summary=summary,
            source="reddit",
            platform_region="global",
            time_str=created.isoformat(),
            url=link,
            engagement=0,
            is_hot=False,
            author=f"u/{author}" if author else "",
            tags=[],
            lang="en",
        ))

    return items


# NOTE: divergent from aggregator_collectors.fetch_reddit — see audit ARCH-01.
# 该栈是「广覆盖」实现（RSS 优先、无评论抓取）；aggregator 栈是「富数据」实现
# （JSON 分页 + 评论 + 媒体 + search 回退，117 行 vs 54 行）。行为不同，不强行合并。
def fetch_reddit(subreddits=None):
    """从 Reddit 获取热门帖子（公开 JSON API，无需认证；失败时回退到 RSS）。"""
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
                    summary=(d.get("selftext") or ""),
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

            logger.info(f"Reddit r/{sub}: {len(items)} items collected (JSON)")
        except Exception as e:
            logger.warning(f"Reddit r/{sub} JSON API failed: {e}, trying RSS fallback")
            try:
                rss_url = f"https://www.reddit.com/r/{sub}/.rss"
                rss_resp = _get(rss_url)
                rss_items = _parse_reddit_rss(rss_resp.text, sub)
                items.extend(rss_items)
                logger.info(f"Reddit r/{sub}: {len(rss_items)} items collected (RSS fallback)")
            except Exception as rss_e:
                logger.warning(f"Reddit r/{sub} RSS fallback also failed: {rss_e}")

    return items


# NOTE: divergent from aggregator_collectors.fetch_bilibili — see audit ARCH-01 (behavior differs, not merged).
def fetch_bilibili():
    """从 Bilibili 搜索忘却前夜相关视频。

    搜索接口需 wbi 签名 + 服务端签发 buvid（spi），否则返回风控 HTML。
    签名实现共享自 news_common（与 aggregator 栈同源）。
    """
    items = []
    headers = {
        "Referer": "https://www.bilibili.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }
    spi = news_common.bilibili_spi_cookies(headers)
    if spi:
        headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in spi.items())
    mixin_key = news_common.get_wbi_mixin_key(headers)

    for keyword in KEYWORDS["zh"]:
        try:
            params = {"search_type": "video", "keyword": keyword, "order": "pubdate", "page": 1}
            if mixin_key:
                params = news_common.sign_wbi_params(params, mixin_key)
            data = _get(
                "https://api.bilibili.com/x/web-interface/wbi/search/type",
                params=params,
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
# NOTE: divergent from aggregator_collectors.fetch_youtube — see audit ARCH-01 (behavior differs, not merged).
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


# NOTE: divergent from aggregator_collectors.fetch_nga — see audit ARCH-01 (behavior differs, not merged).
def fetch_nga():
    """从 NGA 论坛获取忘却前夜版块帖子。支持 NGA_COOKIE 环境变量。"""
    # NGA forum ID for 忘却前夜 — can be overridden via env var
    # Search NGA for the correct FID if this one doesn't work
    nga_fid = os.environ.get("NGA_FORUM_ID", "")
    nga_cookie = os.environ.get("NGA_COOKIE", "nga_read_toma=1")

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
                        "Cookie": nga_cookie,
                        "Accept": "application/json",
                    },
                )
                try:
                    data = resp.json()
                except ValueError:
                    # NGA sometimes returns JSONP / JS object literal (单引号 key)
                    text = resp.text.strip()
                    json_match = _re.search(r'\{.*\}', text, _re.DOTALL)
                    if not json_match:
                        continue
                    raw = json_match.group()
                    try:
                        data = json.loads(raw)
                    except ValueError:
                        # JS 对象字面量：尝试单引号→双引号宽松解析，失败则跳过
                        try:
                            data = json.loads(raw.replace("\\'", "\x00").replace("'", '"').replace("\x00", "'"))
                        except ValueError:
                            logger.warning(f'NGA search "{keyword}": unparseable JS response, skipping')
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
        import re as _re
        resp = _get(
            f"https://bbs.nga.cn/thread.php?fid={nga_fid}&ajax=1",
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Cookie": "nga_read_toma=1",
                "Accept": "application/json",
            },
        )
        try:
            data = resp.json()
        except (ValueError, json.JSONDecodeError):
            # NGA sometimes returns HTML or JSONP instead of JSON
            text = resp.text.strip()
            json_match = _re.search(r'\{.*\}', text, _re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
            else:
                logger.warning(f"NGA fid={nga_fid}: received non-JSON response")
                return items

        threads = data.get("data", {}).get("__T", {})
        if not isinstance(threads, dict):
            threads = {}
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


# NOTE: divergent from aggregator_collectors.fetch_taptap — see audit ARCH-01 (behavior differs, not merged).
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

def _parse_weibo_time(created_str):
    """Parse Weibo's created_at field into ISO datetime string.

    Weibo mobile API returns times in various formats:
    - "刚刚" (just now)
    - "x分钟前" (x minutes ago)
    - "x小时前" (x hours ago)
    - "昨天 HH:MM" (yesterday HH:MM)
    - "MM-DD" (month-day, current year)
    - "Wed Jan 01 00:00:00 +0800 2025" (full date, rare)
    - "yyyy-MM-DD" (standard date)

    Returns (iso_string, is_approximate) tuple.
    """
    now = datetime.now(timezone.utc)
    if not created_str or not created_str.strip():
        return now.isoformat(), True

    s = created_str.strip()

    # "刚刚" = just now
    if s == "刚刚":
        return now.isoformat(), False

    # "x分钟前" = x minutes ago
    m = re.match(r"(\d+)\s*分钟前", s)
    if m:
        return (now - timedelta(minutes=int(m.group(1)))).isoformat(), False

    # "x小时前" = x hours ago
    m = re.match(r"(\d+)\s*小时前", s)
    if m:
        return (now - timedelta(hours=int(m.group(1)))).isoformat(), False

    # "昨天 HH:MM" = yesterday HH:MM
    m = re.match(r"昨天\s*(\d{1,2}):(\d{2})", s)
    if m:
        yesterday = now - timedelta(days=1)
        dt = yesterday.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0, microsecond=0)
        return dt.isoformat(), False

    # "MM-DD" = month-day, assume current year
    m = re.match(r"(\d{1,2})-(\d{1,2})$", s)
    if m:
        month, day = int(m.group(1)), int(m.group(2))
        try:
            dt = now.replace(month=month, day=day, hour=0, minute=0, second=0, microsecond=0)
            if dt > now:
                dt = dt.replace(year=dt.year - 1)
            return dt.isoformat(), False
        except ValueError:
            pass

    # Full date format: "Wed Jan 01 00:00:00 +0800 2025"
    try:
        dt = datetime.strptime(s, "%a %b %d %H:%M:%S %z %Y")
        return dt.isoformat(), False
    except ValueError:
        pass

    # "yyyy-MM-DD" standard date
    m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        try:
            dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
            return dt.isoformat(), False
        except ValueError:
            pass

    return now.isoformat(), True


def fetch_weibo():
    """从微博搜索忘却前夜相关热帖。支持 WEIBO_COOKIE 环境变量提升成功率。"""
    cookie = os.environ.get("WEIBO_COOKIE", "")
    items = []
    for keyword in KEYWORDS["zh"]:
        try:
            headers = {"Referer": "https://m.weibo.cn"}
            if cookie:
                headers["Cookie"] = cookie
            data = _get(
                "https://m.weibo.cn/api/container/getIndex",
                params={"containerid": f"100103type=1&q={keyword}", "page_type": "searchall"},
                headers=headers,
            ).json()

            for card in data.get("data", {}).get("cards", []):
                if card.get("card_type") != 9:
                    continue
                mblog = card.get("mblog", {})
                created_str = mblog.get("created_at", "")
                parsed_time, time_approx = _parse_weibo_time(created_str)
                text = mblog.get("text", "")
                text_clean = re.sub(r"<[^>]+>", "", text)

                item = _make_item(
                    title=text_clean[:100],
                    summary=text_clean,
                    source="weibo",
                    platform_region="cn",
                    time_str=parsed_time,
                    url=f"https://m.weibo.cn/detail/{mblog.get('id', '')}",
                    engagement=mblog.get("reposts_count", 0) + mblog.get("comments_count", 0) + mblog.get("attitudes_count", 0),
                    is_hot=mblog.get("attitudes_count", 0) > 500,
                    author=mblog.get("user", {}).get("screen_name", ""),
                    lang="zh",
                )
                if time_approx:
                    item["time_is_approximate"] = True
                items.append(item)

            logger.info(f'Weibo "{keyword}": {len(items)} posts')
        except Exception as e:
            logger.warning(f'Weibo "{keyword}" failed: {e}')

    return items
def fetch_naver_cafe():
    """从 Naver Cafe 搜索韩国忘却前夜社区。支持 NAVER_COOKIE 环境变量。"""
    naver_cookie = os.environ.get("NAVER_COOKIE", "")
    items = []
    for keyword in KEYWORDS["ko"]:
        try:
            headers = {"Referer": "https://cafe.naver.com"}
            if naver_cookie:
                headers["Cookie"] = naver_cookie
            data = _get(
                "https://apis.naver.com/cafe-web/cafe2/ArticleSearchListV2.json",
                params={"query": keyword, "page": 1, "sortBy": "date"},
                headers=headers,
            ).json()

            message = data.get("message", {})
            if not isinstance(message, dict):
                message = {}
            result = message.get("result", {})
            if not isinstance(result, dict):
                result = {}
            article_list = result.get("articleList", [])
            if not isinstance(article_list, list):
                article_list = []
            for article in article_list:
                if not isinstance(article, dict):
                    continue
                items.append(_make_item(
                    title=article.get("subject", ""),
                    summary=article.get("summary", ""),
                    source="naver_cafe",
                    platform_region="kr",
                    time_str=article.get("writeDateTimestamp") or datetime.now(timezone.utc).isoformat(),
                    url=article.get("articleUrl", ""),
                    engagement=article.get("readCount", 0) + article.get("commentCount", 0),
                    is_hot=article.get("readCount", 0) > 500,
                    author=article.get("writerNickName", ""),
                    lang="ko",
                    time_is_approximate=not article.get("writeDateTimestamp"),
                ))

            logger.info(f'Naver Cafe "{keyword}": {len(items)} articles')
        except Exception as e:
            logger.warning(f'Naver Cafe "{keyword}" failed: {e}')

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


# NOTE: divergent from aggregator_collectors.fetch_discord_local — see audit ARCH-01:
# this is a live-API fetch; the aggregator stack reads a local Discord archive instead. Not merged.
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
                    summary=msg.get("content", ""),
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
def fetch_appstore_reviews():
    """从 App Store 获取近期评论趋势——覆盖 Morimens 主要发行地区。"""
    items = []
    appstore_id = os.environ.get("APPSTORE_APP_ID", "6447354150")
    if not appstore_id:
        return items

    # 主要中文圈 + 英语圈 + 日韩 + 东南亚 + 欧洲 + 拉美 + 大洋洲（共 24 区）
    COUNTRIES = [
        # 中文圈
        "cn", "tw", "hk",
        # 英语圈
        "us", "gb", "ca", "au", "nz", "ie", "sg",
        # 日韩
        "jp", "kr",
        # 东南亚
        "my", "ph", "th", "id", "vn",
        # 欧洲（非英）
        "de", "fr", "es", "it", "ru",
        # 拉美
        "br", "mx",
    ]
    LANG_MAP = {
        "cn": "zh", "tw": "zh", "hk": "zh",
        "us": "en", "gb": "en", "ca": "en", "au": "en", "nz": "en", "ie": "en", "sg": "en",
        "jp": "ja", "kr": "ko",
        "my": "ms", "ph": "en", "th": "th", "id": "id", "vn": "vi",
        "de": "de", "fr": "fr", "es": "es", "it": "it", "ru": "ru",
        "br": "pt", "mx": "es",
    }

    for country in COUNTRIES:
        try:
            data = _get(
                f"https://itunes.apple.com/{country}/rss/customerreviews/id={appstore_id}/sortBy=mostRecent/json",
            ).json()
            entries = data.get("feed", {}).get("entry", [])
            review_url = f"https://apps.apple.com/{country}/app/id{appstore_id}?see-all=reviews"
            for entry in entries:
                rating = int(entry.get("im:rating", {}).get("label", "0"))
                items.append(_make_item(
                    title=entry.get("title", {}).get("label", ""),
                    summary=entry.get("content", {}).get("label", ""),
                    source="appstore",
                    platform_region=country,
                    time_str=entry.get("updated", {}).get("label", ""),
                    url=review_url,
                    engagement=rating,
                    is_hot=False,
                    author=entry.get("author", {}).get("name", {}).get("label", ""),
                    lang=LANG_MAP.get(country, ""),
                ))
            logger.info(f"App Store ({country}): {len(entries)} reviews")
        except Exception as e:
            logger.debug(f"App Store ({country}) failed: {e}")

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

            body = data.get("body", {})
            if not isinstance(body, dict):
                body = {}
            illust_manga = body.get("illustManga", {})
            if not isinstance(illust_manga, dict):
                illust_manga = {}
            illust_data = illust_manga.get("data", [])
            if not isinstance(illust_data, list):
                illust_data = []
            for illust in illust_data[:20]:
                if not isinstance(illust, dict):
                    continue
                illust_id = illust.get("id", "")
                bookmark = illust.get("bookmarkCount", 0)
                like = illust.get("likeCount", 0)
                # search_artworks 返回 tags 为 ["tag1", "tag2"]（字符串列表），
                # 而单个 illust ajax 返回 tags 为 [{"tag": "..."}, ...]，两者都要兼容。
                raw_tags = illust.get("tags", []) or []
                if isinstance(raw_tags, list):
                    tag_list = []
                    for t in raw_tags[:5]:
                        if isinstance(t, dict):
                            tag_list.append(t.get("tag", ""))
                        elif isinstance(t, str):
                            tag_list.append(t)
                else:
                    tag_list = []
                items.append(_make_item(
                    title=illust.get("title", ""),
                    summary=illust.get("description", "") if illust.get("description") else "",
                    source="pixiv",
                    platform_region="global",
                    time_str=illust.get("createDate") or datetime.now(timezone.utc).isoformat(),
                    url=f"https://www.pixiv.net/artworks/{illust_id}",
                    engagement=bookmark + like,
                    is_hot=bookmark > 500,
                    author=illust.get("userName", ""),
                    tags=tag_list,
                    lang="",
                    content_type="image",
                    media_url=illust.get("url", ""),
                    time_is_approximate=not illust.get("createDate"),
                ))

            logger.info(f'Pixiv "{keyword}": {len(items)} artworks')
        except Exception as e:
            logger.warning(f'Pixiv "{keyword}" failed: {e}')

    return items
def fetch_fivech():
    """从 5ch (日本) 搜索忘却前夜相关帖子（subject.txt + 搜索）。"""
    items = []
    import re as _re

    # Method 1: scan applism (手游板) subject.txt for matching threads
    # 2026-06 起 5ch 服务器域名整体从 5ch.net 迁移至 5ch.io（旧域 404）
    boards = [
        ("pug", "applism"),     # アプリ/ソシャゲ
        ("krsw", "gamesm"),     # スマホゲーム
    ]
    for server, board in boards:
        try:
            resp = _get(
                f"https://{server}.5ch.io/{board}/subject.txt",
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
                    # tid is a Unix timestamp (thread creation time)
                    try:
                        thread_time = datetime.fromtimestamp(int(tid), tz=timezone.utc).isoformat()
                        thread_approx = False
                    except (ValueError, OSError):
                        thread_time = datetime.now(timezone.utc).isoformat()
                        thread_approx = True
                    items.append(_make_item(
                        title=title.strip(),
                        summary="",
                        source="fivech",
                        platform_region="jp",
                        time_str=thread_time,
                        url=f"https://{server}.5ch.io/test/read.cgi/{board}/{tid}/",
                        engagement=int(replies),
                        is_hot=int(replies) > 100,
                        author="",
                        lang="ja",
                        time_is_approximate=thread_approx,
                    ))
        except Exception as e:
            logger.warning(f"5ch {server}/{board} failed: {e}")

    # Method 2: ff5ch.syoboi.jp 全板搜索兜底（板地址迁移 / subject.txt 失效时仍可发现线程）
    # 结果行形如 <a class="thread" href="https://xxx.5ch.io/test/read.cgi/board/TID/">标题 </a><span>(回复数)</span>
    if not items:
        for keyword in KEYWORDS["ja"]:
            try:
                resp = _get(
                    "https://ff5ch.syoboi.jp/",
                    params={"q": keyword},
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                )
                for m in _re.finditer(
                    r'class="thread"\s+href="(https?://[^"]+/test/read\.cgi/[^/"]+/(\d+)/?)"[^>]*>([^<]+)</a>'
                    r'\s*<span[^>]*>\s*\((\d+)\)',
                    resp.text,
                ):
                    url, tid, title, replies = m.group(1), m.group(2), m.group(3).strip(), int(m.group(4))
                    try:
                        thread_time = datetime.fromtimestamp(int(tid), tz=timezone.utc)
                        if thread_time < CUTOFF and replies < 100:
                            # 旧线程且不活跃 → 跳过；活跃大线程保留（5ch 线程长期滚动）
                            continue
                        time_str, approx = thread_time.isoformat(), False
                    except (ValueError, OSError):
                        time_str, approx = datetime.now(timezone.utc).isoformat(), True
                    items.append(_make_item(
                        title=title,
                        summary="",
                        source="fivech",
                        platform_region="jp",
                        time_str=time_str,
                        url=url,
                        engagement=replies,
                        is_hot=replies > 100,
                        author="",
                        lang="ja",
                        time_is_approximate=approx,
                    ))
                logger.info(f'5ch ff5ch "{keyword}": {len(items)} threads')
            except Exception as e:
                logger.warning(f'5ch ff5ch "{keyword}" failed: {e}')

    logger.info(f"5ch: {len(items)} threads")
    return items


# ─── 第三波新增数据源 ─────────────────────────────────────


def fetch_google_play():
    """从 Google Play Store 获取忘却前夜评论——覆盖主要发行地区（使用 google-play-scraper 库）。"""
    gp_package = os.environ.get("GOOGLE_PLAY_PACKAGE", "com.qookkagames.z1.gp.hk")
    items = []

    try:
        from google_play_scraper import reviews as gp_reviews, Sort as GPSort
    except ImportError:
        logger.warning("Google Play: google-play-scraper not installed, skipping")
        return items

    # (lang_code, country_code, region_label) — Google Play 同时按 lang+country 隔离评论
    LOCALES = [
        # 中文圈
        ("zh_CN", "cn", "cn"), ("zh_TW", "tw", "tw"), ("zh_HK", "hk", "hk"),
        # 英语圈
        ("en", "us", "us"), ("en", "gb", "gb"), ("en", "ca", "ca"),
        ("en", "au", "au"), ("en", "sg", "sg"), ("en", "ph", "ph"),
        # 日韩
        ("ja", "jp", "jp"), ("ko", "kr", "kr"),
        # 东南亚
        ("th", "th", "th"), ("id", "id", "id"), ("vi", "vn", "vn"),
        ("ms", "my", "my"),
        # 欧洲（非英）
        ("de", "de", "de"), ("fr", "fr", "fr"), ("es", "es", "es"),
        ("it", "it", "it"), ("ru", "ru", "ru"),
        # 拉美
        ("pt", "br", "br"), ("es", "mx", "mx"),
    ]

    for lang_code, country, region in LOCALES:
        try:
            result, _ = gp_reviews(
                gp_package,
                lang=lang_code,
                country=country,
                count=50,
                sort=GPSort.NEWEST,
            )
            for review in result:
                rating = review.get("score", 0)
                text = review.get("content", "")
                sentiment = '好评' if rating >= 4 else ('中评' if rating == 3 else '差评')
                items.append(_make_item(
                    title=f"[Google Play {sentiment}] ★{rating} {text[:40]}",
                    summary=text,
                    source="google_play",
                    platform_region=region,
                    time_str=review["at"].isoformat() if review.get("at") else datetime.now(timezone.utc).isoformat(),
                    url=f"https://play.google.com/store/apps/details?id={gp_package}&hl={lang_code}",
                    engagement=review.get("thumbsUpCount", 0),
                    is_hot=False,
                    author=review.get("userName", ""),
                    lang=lang_code.split("_")[0],
                    time_is_approximate=not review.get("at"),
                ))

            logger.info(f"Google Play ({lang_code}/{country}): {len(result)} reviews")
        except Exception as e:
            logger.debug(f"Google Play ({lang_code}/{country}) failed: {e}")

    return items
def fetch_zhihu():
    """从知乎搜索忘却前夜相关问答/文章。需要 ZHIHU_COOKIE (z_c0) 环境变量。"""
    cookie = os.environ.get("ZHIHU_COOKIE", "")
    items = []
    for keyword in KEYWORDS["zh"]:
        try:
            headers = {"Referer": "https://www.zhihu.com"}
            if cookie:
                headers["Cookie"] = f"z_c0={cookie}" if not cookie.startswith("z_c0=") else cookie
            data = _get(
                "https://www.zhihu.com/api/v4/search_v3",
                params={"q": keyword, "t": "general", "offset": 0, "limit": 20},
                headers=headers,
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
                        excerpt = target.get("excerpt", target.get("content", ""))
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

                        zhihu_time = target.get("created_time") or target.get("updated_time")
                        items.append(_make_item(
                            title=_strip_html(title),
                            summary=_strip_html(excerpt),
                            source="zhihu",
                            platform_region="cn",
                            time_str=zhihu_time or datetime.now(timezone.utc).isoformat(),
                            url=url,
                            engagement=voteup + comment,
                            is_hot=voteup > 100,
                            author=target.get("author", {}).get("name", ""),
                            lang="zh",
                            time_is_approximate=not zhihu_time,
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
                            platform_region="tw",
                            time_str=thread.get("ctime") or datetime.now(timezone.utc).isoformat(),
                            url=f"https://forum.gamer.com.tw/C.php?bsn={baha_bsn}&snA={thread.get('snA', '')}",
                            engagement=gp + reply,
                            is_hot=gp > 50,
                            author=thread.get("nick", ""),
                            lang="zh",
                            time_is_approximate=not thread.get("ctime"),
                        ))
                except (ValueError, KeyError):
                    pass
            logger.info(f"Bahamut bsn={baha_bsn}: {len(items)} threads")
        except Exception as e:
            logger.warning(f"Bahamut bsn={baha_bsn} failed: {e}")

    # 方式2: 关键词搜索 (HTML scraping — 巴哈搜索不返回可靠的 JSON)
    import re as _re
    for keyword in KEYWORDS["zh"]:
        try:
            resp = _get(
                "https://forum.gamer.com.tw/search.php",
                params={"q": keyword, "bsn": "0"},
                headers={
                    "Referer": "https://forum.gamer.com.tw",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
            )
            if resp and resp.status_code == 200:
                html = resp.text
                # Try JSON first (in case ajax works)
                try:
                    result = resp.json()
                    for thread in result.get("data", {}).get("list", []) or []:
                        gp = int(thread.get("gp", 0))
                        reply = int(thread.get("reply", 0))
                        items.append(_make_item(
                            title=thread.get("title", ""),
                            summary="",
                            source="bahamut",
                            platform_region="tw",
                            time_str=thread.get("ctime") or datetime.now(timezone.utc).isoformat(),
                            url=thread.get("url", ""),
                            engagement=gp + reply,
                            is_hot=gp > 50,
                            author=thread.get("nick", ""),
                            lang="zh",
                            time_is_approximate=not thread.get("ctime"),
                        ))
                except (ValueError, KeyError):
                    # HTML fallback: parse search result page
                    # Bahamut search results have: <p class="b-list__main__title">
                    #   <a href="C.php?bsn=...&snA=...">TITLE</a>
                    for match in _re.finditer(
                        r'<a[^>]*href="((?:C|Co)\.php\?bsn=\d+[^"]*)"[^>]*>\s*'
                        r'(.+?)\s*</a>',
                        html, _re.DOTALL,
                    ):
                        url_path, title_html = match.groups()
                        title = _re.sub(r'<[^>]+>', '', title_html).strip()
                        if not title:
                            continue
                        full_url = f"https://forum.gamer.com.tw/{url_path}"
                        # Try to extract GP and reply count nearby
                        items.append(_make_item(
                            title=title,
                            summary="",
                            source="bahamut",
                            platform_region="tw",
                            time_str=datetime.now(timezone.utc).isoformat(),
                            url=full_url,
                            engagement=0,
                            is_hot=False,
                            author="",
                            lang="zh",
                            time_is_approximate=True,
                        ))
            count = len(items)
            logger.info(f'Bahamut search "{keyword}": {count} results')
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

                    has_date = i < len(msg_dates)
                    items.append(_make_item(
                        title=text[:100],
                        summary=text,
                        source="telegram",
                        platform_region="global",
                        time_str=msg_dates[i] if has_date else datetime.now(timezone.utc).isoformat(),
                        url=f"https://t.me/{channel}",
                        engagement=views,
                        is_hot=views > 1000,
                        author=f"@{channel}",
                        lang="",
                        time_is_approximate=not has_date,
                    ))

            logger.info(f"Telegram @{channel}: {len(items)} messages")
        except Exception as e:
            logger.warning(f"Telegram @{channel} failed: {e}")

    return items
def fetch_weixin():
    """通过搜狗微信搜索抓取忘却前夜相关公众号文章。

    搜狗是唯一公开索引微信公众号文章的搜索引擎。

    已知限制（技术原因，非 bug）：
    - engagement 始终为 0：搜狗搜索结果不包含阅读量/点赞等互动指标，
      微信官方 API 需要企业号 + 腾讯审批，暂不可行。
    - summary 为空：搜狗结果页仅提供标题和链接，不含正文摘要。
    - 文章 URL 为搜狗中转链接，非微信直链。
    """
    items = []
    for keyword in KEYWORDS["zh"]:
        try:
            resp = _get_cf(
                "https://weixin.sogou.com/weixin",
                params={"type": 2, "query": keyword, "ie": "utf8", "s_from": "input", "page": 1},
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    "Referer": "https://weixin.sogou.com/",
                },
            )
            html = resp.text
            import re as _re

            # Sogou WeChat embeds Unix timestamps via timeConvert('EPOCH')
            # or data-t="EPOCH" attributes near each result. Collect them
            # so we can correlate with result order.
            sogou_timestamps = _re.findall(
                r"(?:timeConvert\(['\"](\d{10})['\"]|data-t=['\"](\d{10})['\"]"
                r"|lastModified['\"]?\s*[:=]\s*['\"]?(\d{10}))",
                html,
            )
            ts_list = [int(t1 or t2 or t3) for t1, t2, t3 in sogou_timestamps]

            # Parse search results — capture snippet text between <p> after title
            result_idx = 0
            for match in _re.finditer(
                r'<h3>.*?<a[^>]*href="([^"]+)"[^>]*>(.+?)</a>.*?'
                r'(?:class="txt-info"[^>]*>(.+?)</p>)?.*?'
                r'class="s-p"[^>]*>([^<]*)',
                html, _re.DOTALL
            ):
                url, title_html, snippet_html, meta = match.groups()
                # Clean HTML tags from title
                title = _re.sub(r'<[^>]+>', '', title_html).strip()
                if not title:
                    continue

                # Extract summary from snippet
                summary = ""
                if snippet_html:
                    summary = _re.sub(r'<[^>]+>', '', snippet_html).strip()[:300]

                # Extract author from meta
                author_match = _re.search(r'微信公众号\s*[:：]\s*([^\s<]+)', meta)
                author = author_match.group(1) if author_match else ""

                # Extract publish time from Sogou timestamps or meta text
                time_str = ""
                time_approx = True
                if result_idx < len(ts_list):
                    try:
                        dt = datetime.fromtimestamp(ts_list[result_idx], tz=timezone.utc)
                        time_str = dt.isoformat()
                        time_approx = False
                    except (ValueError, OSError):
                        pass

                # Fallback: look for date patterns in meta text (e.g. "2025-03-15", "2025年3月15日")
                if not time_str and meta:
                    date_m = _re.search(r'(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})', meta)
                    if date_m:
                        try:
                            dt = datetime(int(date_m.group(1)), int(date_m.group(2)), int(date_m.group(3)), tzinfo=timezone.utc)
                            time_str = dt.isoformat()
                            time_approx = False
                        except ValueError:
                            pass

                if not time_str:
                    time_str = datetime.now(timezone.utc).isoformat()
                    time_approx = True

                item = _make_item(
                    title=f"[微信] {title}",
                    summary=summary,
                    source="weixin",
                    platform_region="cn",
                    time_str=time_str,
                    url=url,
                    engagement=0,
                    is_hot=False,
                    author=author,
                    lang="zh",
                )
                if time_approx:
                    item["time_is_approximate"] = True
                items.append(item)
                result_idx += 1

            logger.info(f'搜狗微信 "{keyword}": {len(items)} articles')
        except Exception as e:
            logger.warning(f'搜狗微信 "{keyword}" failed: {e}')

    return items


# ─── 日本語プラットフォーム ────────────────────────────────

def fetch_note_com():
    """从 Note.com 搜索忘却前夜/モリメンス 攻略文章（API v3）。"""
    items = []
    for keyword in KEYWORDS["ja"]:
        try:
            # note.com 对数据中心 IP 返回 403，cloudscraper（浏览器指纹）通过率更高；
            # _get 对 4xx raise，故直接用 _get_cf 单路径。
            resp = _get_cf(
                "https://note.com/api/v3/searches",
                params={"q": keyword, "size": 20, "sort": "new", "context": "note"},
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                    "Referer": "https://note.com/",
                    "Accept": "application/json",
                },
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
                        summary=note.get("body", ""),
                        source="note_com",
                        platform_region="jp",
                        time_str=note.get("publishAt") or datetime.now(timezone.utc).isoformat(),
                        url=note.get("noteUrl", ""),
                        engagement=note.get("likeCount", 0) + note.get("commentCount", 0),
                        is_hot=note.get("likeCount", 0) > 50,
                        author=note.get("user", {}).get("nickname", ""),
                        lang="ja",
                        time_is_approximate=not note.get("publishAt"),
                    ))

            logger.info(f'Note.com "{keyword}": {len(items)} notes')
        except Exception as e:
            logger.warning(f'Note.com "{keyword}" failed: {e}')

    return items


# ─── 韓国追加プラットフォーム ──────────────────────────────

def fetch_ruliweb():
    """从 Ruliweb 搜索韩国忘却前夜讨论。

    搜索结果页结构：`<div id="board_search">` 段下含若干 `<li class="search_result_item">`，
    每条含 `<a class="title text_over">`（标题+链接）、`<span class="time">YYYY.MM.DD</span>`
    （发布日期）、`<span class="desc">`（摘要）、`<a class="name">[板块名]</a>`。
    """
    items = []
    seen_urls: set[str] = set()
    for keyword in KEYWORDS["ko"]:
        try:
            resp = _get_cf(
                "https://bbs.ruliweb.com/search",
                params={"q": keyword, "page": 1},
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            )
            html = resp.text
            import re as _re

            # Limit parsing to the actual post-search section to skip game-category
            # aggregation blocks at the top of the page.
            board_match = _re.search(
                r'<div id="board_search"[^>]*>(.+?)(?=<div id=|</body>|$)',
                html, _re.DOTALL,
            )
            if not board_match:
                logger.info(f'Ruliweb "{keyword}": board_search section missing, skipping')
                continue
            board_html = board_match.group(1)

            count = 0
            for item_match in _re.finditer(
                r'<li class="search_result_item">(.+?)</li>',
                board_html, _re.DOTALL,
            ):
                block = item_match.group(1)

                title_m = _re.search(
                    r'<a class="title[^"]*" href="([^"]+)"[^>]*>([^<]+)</a>',
                    block,
                )
                if not title_m:
                    continue
                url, title = title_m.group(1).strip(), title_m.group(2).strip()
                if not title or url in seen_urls:
                    continue

                time_m = _re.search(
                    r'<span class="time">(\d{4}\.\d{2}\.\d{2}(?:\s+\d{2}:\d{2})?)</span>',
                    block,
                )
                time_str = ""
                time_approx = True
                if time_m:
                    raw = time_m.group(1).strip()
                    # Normalize to ISO 8601 (UTC, since publish times shown are KST date-only —
                    # interpret as KST 00:00 then convert to UTC for consistency).
                    try:
                        if " " in raw:
                            dt = datetime.strptime(raw, "%Y.%m.%d %H:%M")
                        else:
                            dt = datetime.strptime(raw, "%Y.%m.%d")
                        # KST = UTC+9
                        dt = dt.replace(tzinfo=timezone(timedelta(hours=9)))
                        time_str = dt.astimezone(timezone.utc).isoformat()
                        time_approx = False
                    except ValueError:
                        pass

                if not time_str:
                    time_str = datetime.now(timezone.utc).isoformat()
                    time_approx = True

                desc_m = _re.search(r'<span class="desc">\s*(.+?)\s*</span>', block, _re.DOTALL)
                summary = _re.sub(r'\s+', ' ', desc_m.group(1)).strip()[:300] if desc_m else ""

                if not url.startswith("http"):
                    url = f"https://bbs.ruliweb.com{url}"
                seen_urls.add(url)

                items.append(_make_item(
                    title=title,
                    summary=summary,
                    source="ruliweb",
                    platform_region="kr",
                    time_str=time_str,
                    url=url,
                    engagement=0,
                    is_hot=False,
                    author="",
                    lang="ko",
                    time_is_approximate=time_approx,
                ))
                count += 1

            logger.info(f'Ruliweb "{keyword}": {count} posts')
        except Exception as e:
            logger.warning(f'Ruliweb "{keyword}" failed: {e}')

    return items


# ─── Русские платформы ─────────────────────────────────────
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

        # Try to extract a description/summary from the page
        desc_match = _re.search(
            r'class="[^"]*(?:game-?desc|description|about)[^"]*"[^>]*>\s*(?:<[^>]*>)*\s*([^<]{10,500})',
            html, _re.DOTALL | _re.IGNORECASE
        )
        page_summary = desc_match.group(1).strip()[:300] if desc_match else ""
        # Fallback: try meta description
        if not page_summary:
            meta_match = _re.search(r'<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"\']+)', html, _re.IGNORECASE)
            if meta_match:
                page_summary = meta_match.group(1).strip()[:300]

        # Try to extract a page-level date from <time> elements or date patterns
        page_time_str = ""
        page_time_approx = True
        time_tag = _re.search(r'<time[^>]*datetime=["\']([^"\']+)["\']', html)
        if time_tag:
            page_time_str = time_tag.group(1)
            page_time_approx = False
        else:
            # Look for date patterns like "DD.MM.YYYY" (Russian format) or "YYYY-MM-DD"
            date_ru = _re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', html)
            date_iso = _re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})', html)
            if date_ru:
                try:
                    dt = datetime(int(date_ru.group(3)), int(date_ru.group(2)), int(date_ru.group(1)), tzinfo=timezone.utc)
                    page_time_str = dt.isoformat()
                    page_time_approx = False
                except ValueError:
                    pass
            elif date_iso:
                try:
                    dt = datetime(int(date_iso.group(1)), int(date_iso.group(2)), int(date_iso.group(3)), tzinfo=timezone.utc)
                    page_time_str = dt.isoformat()
                    page_time_approx = False
                except ValueError:
                    pass

        if not page_time_str:
            page_time_str = datetime.now(timezone.utc).isoformat()
            page_time_approx = True

        if rating_match:
            rating = float(rating_match.group(1))
            count = int(review_count_match.group(1)) if review_count_match else 0
            item = _make_item(
                title=f"[StopGame] Morimens — {rating}/10 ({count} оценок)",
                summary=page_summary or f"Рейтинг игры Morimens на StopGame: {rating}/10 на основе {count} оценок",
                source="stopgame",
                platform_region="ru",
                time_str=page_time_str,
                url="https://stopgame.ru/game/morimens",
                engagement=count,
                is_hot=count > 50,
                author="StopGame.ru",
                lang="ru",
            )
            if page_time_approx:
                item["time_is_approximate"] = True
            items.append(item)

        # Extract user reviews
        # Collect per-review dates from nearby <time> or date elements
        review_dates = _re.findall(
            r'class="[^"]*review[^"]*"[^>]*>.*?'
            r'(?:<time[^>]*datetime=["\']([^"\']+)["\']|(\d{1,2}\.\d{1,2}\.\d{4}))',
            html, _re.DOTALL
        )

        review_idx = 0
        for match in _re.finditer(
            r'class="[^"]*review-text[^"]*"[^>]*>([^<]{10,300})',
            html, _re.DOTALL
        ):
            text = match.group(1).strip()
            review_time = ""
            review_approx = True
            if review_idx < len(review_dates):
                rd_iso, rd_ru = review_dates[review_idx]
                if rd_iso:
                    review_time = rd_iso
                    review_approx = False
                elif rd_ru:
                    parts = rd_ru.split(".")
                    try:
                        dt = datetime(int(parts[2]), int(parts[1]), int(parts[0]), tzinfo=timezone.utc)
                        review_time = dt.isoformat()
                        review_approx = False
                    except (ValueError, IndexError):
                        pass
            if not review_time:
                review_time = page_time_str
                review_approx = page_time_approx

            item = _make_item(
                title=f"[StopGame] {text[:60]}",
                summary=text,
                source="stopgame",
                platform_region="ru",
                time_str=review_time,
                url="https://stopgame.ru/game/morimens",
                engagement=0,
                is_hot=False,
                author="",
                lang="ru",
            )
            if review_approx:
                item["time_is_approximate"] = True
            items.append(item)
            review_idx += 1

        logger.info(f"StopGame: {len(items)} items")
    except Exception as e:
        logger.warning(f"StopGame failed: {e}")

    return items


# ─── 收入/数据平台 ─────────────────────────────────────────
