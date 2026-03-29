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
STATE_PATH = BASE_DIR / "data" / "state.json"

# 忘却前夜B站官方账号UID（通过搜索API发现后hardcode）
# 若设为0则从搜索结果中尝试自动发现
BILIBILI_MORIMENS_UID = 0

HOURS_LOOKBACK = int(os.environ.get("HOURS_LOOKBACK", "24"))
CUTOFF = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)


def _refresh_cutoff():
    """Refresh the global CUTOFF so long-running processes (scheduler) use current time."""
    global CUTOFF
    CUTOFF = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)

# 多语言搜索关键词
KEYWORDS = {
    "zh": ["忘却前夜", "忘卻前夜"],
    "en": ["Morimens"],
    "ja": ["忘却前夜", "モリメンス"],
    "ko": ["망각전야", "모리멘스", "Morimens"],
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


# ─── 增量状态管理 ──────────────────────────────────────────

def _load_state():
    """加载增量状态文件。"""
    if STATE_PATH.exists():
        try:
            with open(STATE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def _save_state(state):
    """保存增量状态文件。"""
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


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
    """从 Bilibili 搜索忘却前夜相关视频、文章，并采集官方账号动态。"""
    state = _load_state()
    bilibili_search_state = state.setdefault("bilibili_search", {"last_timestamp": 0})
    bilibili_dynamic_state = state.setdefault("bilibili_dynamic", {"last_timestamp": 0})

    items = []
    headers = {
        "Referer": "https://www.bilibili.com",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
    }

    last_ts = bilibili_search_state.get("last_timestamp", 0)
    new_last_ts = last_ts
    # 使用已发现的UID或全局常量
    discovered_uid = state.get("bilibili_official_uid", BILIBILI_MORIMENS_UID)

    # ── Part 1: 视频搜索 ────────────────────────────────────
    for keyword in KEYWORDS["zh"]:
        try:
            data = _get(
                "https://api.bilibili.com/x/web-interface/search/type",
                params={"search_type": "video", "keyword": keyword, "order": "pubdate", "page": 1},
                headers=headers,
            ).json()

            video_count = 0
            for v in (data.get("data", {}).get("result") or [])[:25]:
                pubdate = v.get("pubdate", 0)
                if not pubdate or pubdate <= last_ts:
                    continue
                created = datetime.fromtimestamp(pubdate, tz=timezone.utc)
                if created < CUTOFF:
                    continue

                new_last_ts = max(new_last_ts, pubdate)

                # 尝试从高播放量视频的UP主中发现官方账号UID
                if not discovered_uid:
                    mid = v.get("mid")
                    if mid and v.get("play", 0) > 50000:
                        discovered_uid = mid
                        logger.info(f"Bilibili: 自动发现高播放量UP主 UID={mid} ({v.get('author', '')})")

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
                video_count += 1

            logger.info(f'Bilibili视频 "{keyword}": 新增 {video_count} items')
        except Exception as e:
            logger.warning(f'Bilibili视频搜索 "{keyword}" 失败: {e}')

    # ── Part 3: 文章/专栏搜索 ───────────────────────────────
    for keyword in KEYWORDS["zh"]:
        try:
            data = _get(
                "https://api.bilibili.com/x/web-interface/search/type",
                params={"search_type": "article", "keyword": keyword, "order": "pubdate", "page": 1},
                headers=headers,
            ).json()

            article_count = 0
            for a in (data.get("data", {}).get("result") or [])[:25]:
                pub_time = a.get("pub_time", 0)
                if not pub_time or pub_time <= last_ts:
                    continue
                created = datetime.fromtimestamp(pub_time, tz=timezone.utc)
                if created < CUTOFF:
                    continue

                new_last_ts = max(new_last_ts, pub_time)

                view = a.get("view", 0)
                like = a.get("like", 0)
                reply = a.get("reply", 0)
                cv_id = a.get("id", "")
                url = f"https://www.bilibili.com/read/cv{cv_id}" if cv_id else ""
                img_urls = a.get("image_urls", [])

                items.append(_make_item(
                    title=a.get("title", ""),
                    summary=_strip_html(a.get("desc", "")),
                    source="bilibili",
                    platform_region="cn",
                    time_str=created.isoformat(),
                    url=url,
                    engagement=view + like + reply,
                    is_hot=view > 5000,
                    author=a.get("author_name", ""),
                    lang="zh",
                    content_type="article",
                    media_url=img_urls[0] if img_urls else "",
                ))
                article_count += 1

            logger.info(f'Bilibili文章 "{keyword}": 新增 {article_count} items')
        except Exception as e:
            logger.warning(f'Bilibili文章搜索 "{keyword}" 失败: {e}')

    bilibili_search_state["last_timestamp"] = new_last_ts

    # ── Part 2: 官方账号动态采集 ────────────────────────────
    uid = discovered_uid
    if uid:
        try:
            data = _get(
                "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space",
                params={"host_mid": uid},
                headers=headers,
            ).json()

            last_dyn_ts = bilibili_dynamic_state.get("last_timestamp", 0)
            new_dyn_ts = last_dyn_ts
            dyn_count = 0

            for dyn in (data.get("data", {}).get("items") or [])[:30]:
                modules = dyn.get("modules", {})

                mod_author = modules.get("module_author", {})
                pub_ts = mod_author.get("pub_ts", 0)
                if not pub_ts or pub_ts <= last_dyn_ts:
                    continue
                created = datetime.fromtimestamp(pub_ts, tz=timezone.utc)
                if created < CUTOFF:
                    continue

                new_dyn_ts = max(new_dyn_ts, pub_ts)

                # 动态文字
                mod_dynamic = modules.get("module_dynamic", {})
                desc = mod_dynamic.get("desc") or {}
                text = desc.get("text", "") if isinstance(desc, dict) else ""

                # 内容类型
                dyn_type = dyn.get("type", "").upper()
                if "VIDEO" in dyn_type:
                    content_type = "video"
                elif "ARTICLE" in dyn_type or "WORD" in dyn_type:
                    content_type = "article"
                else:
                    content_type = "image"

                # 互动数据
                mod_stat = modules.get("module_stat", {})
                like = mod_stat.get("like", {}).get("count", 0)
                forward = mod_stat.get("forward", {}).get("count", 0)
                comment = mod_stat.get("comment", {}).get("count", 0)

                dyn_id = dyn.get("id_str", "")
                url = f"https://www.bilibili.com/opus/{dyn_id}" if dyn_id else ""

                items.append(_make_item(
                    title=text[:100],
                    summary=text[:300],
                    source="bilibili_dynamic",
                    platform_region="cn",
                    time_str=created.isoformat(),
                    url=url,
                    engagement=like + forward + comment,
                    is_hot=like > 1000,
                    author=mod_author.get("name", ""),
                    lang="zh",
                    content_type=content_type,
                ))
                dyn_count += 1

            bilibili_dynamic_state["last_timestamp"] = new_dyn_ts
            logger.info(f"Bilibili官方动态 UID={uid}: 新增 {dyn_count} items")
        except Exception as e:
            logger.warning(f"Bilibili官方动态采集失败 (UID={uid}): {e}")
    else:
        logger.info("Bilibili官方动态: BILIBILI_MORIMENS_UID未设置，跳过")

    # 缓存自动发现的UID
    if discovered_uid and not state.get("bilibili_official_uid"):
        state["bilibili_official_uid"] = discovered_uid

    _save_state(state)
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
    nga_fid = os.environ.get("NGA_FORUM_ID", "")
    if not nga_fid:
        logger.info("NGA: NGA_FORUM_ID not set, skipping")
        return []

    items = []
    try:
        data = _get(
            f"https://bbs.nga.cn/thread.php?fid={nga_fid}&ajax=1",
            headers={"Accept": "application/json"},
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
    """从 TapTap 获取忘却前夜社区热帖。"""
    app_id = os.environ.get("TAPTAP_APP_ID", "")
    if not app_id:
        logger.info("TapTap: TAPTAP_APP_ID not set, skipping")
        return []

    items = []
    try:
        data = _get(
            f"https://api.taptap.cn/app/v2/app/{app_id}/topic/list",
            params={"type": "hot", "limit": 25},
        ).json()

        for topic in data.get("data", {}).get("list", []):
            created = datetime.fromtimestamp(topic.get("created_time", 0), tz=timezone.utc)
            if created < CUTOFF:
                continue

            engagement = topic.get("comment_count", 0) + topic.get("like_count", 0)
            items.append(_make_item(
                title=topic.get("title", ""),
                summary=topic.get("summary", ""),
                source="taptap",
                platform_region="cn",
                time_str=created.isoformat(),
                url=topic.get("share_url", ""),
                engagement=engagement,
                is_hot=topic.get("like_count", 0) > 100,
                author=topic.get("user", {}).get("name", ""),
                lang="zh",
            ))

        logger.info(f"TapTap: {len(items)} topics collected")
    except Exception as e:
        logger.warning(f"TapTap failed: {e}")

    return items


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
    """从百度贴吧获取忘却前夜吧帖子。"""
    items = []
    try:
        data = _get(
            "https://tieba.baidu.com/mo/q/newmoindex",
            params={"forum_name": "忘却前夜"},
        ).json()

        for thread in data.get("data", {}).get("thread_list", []) or []:
            items.append(_make_item(
                title=thread.get("title", ""),
                summary=thread.get("abstract", ""),
                source="tieba",
                platform_region="cn",
                time_str=datetime.now(timezone.utc).isoformat(),
                url=f"https://tieba.baidu.com/p/{thread.get('tid', '')}",
                engagement=int(thread.get("reply_num", 0)),
                is_hot=int(thread.get("reply_num", 0)) > 50,
                author=thread.get("author", {}).get("name_show", ""),
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
    """从 DCInside 搜索韩国忘却前夜 Gallery。"""
    dc_gallery_id = os.environ.get("DC_GALLERY_ID", "")
    if not dc_gallery_id:
        logger.info("DCInside: DC_GALLERY_ID not set, skipping")
        return []

    items = []
    try:
        data = _get(
            f"https://gall.dcinside.com/board/lists/?id={dc_gallery_id}&page=1",
            headers={"Referer": "https://gall.dcinside.com"},
        )
        # DCInside 返回 HTML，需要简单解析
        # 实际使用时建议用 BeautifulSoup
        logger.info(f"DCInside: attempted gallery {dc_gallery_id}")
    except Exception as e:
        logger.warning(f"DCInside failed: {e}")

    return items


def fetch_arca_live():
    """从 Arca.live 搜索韩国忘却前夜频道。"""
    arca_channel = os.environ.get("ARCA_CHANNEL", "")
    if not arca_channel:
        logger.info("Arca.live: ARCA_CHANNEL not set, skipping")
        return []

    items = []
    try:
        data = _get(
            f"https://arca.live/b/{arca_channel}",
            params={"mode": "best", "p": 1},
        )
        # Arca.live 返回 HTML
        logger.info(f"Arca.live: attempted channel {arca_channel}")
    except Exception as e:
        logger.warning(f"Arca.live failed: {e}")

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
    appstore_id = os.environ.get("APPSTORE_APP_ID", "")
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
    qq_guild_id = os.environ.get("QQ_GUILD_ID", "")
    qq_bot_token = os.environ.get("QQ_BOT_TOKEN", "")
    if not qq_guild_id or not qq_bot_token:
        logger.info("QQ: QQ_GUILD_ID or QQ_BOT_TOKEN not set, skipping")
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
    """从 Lofter 搜索忘却前夜同人创作。"""
    items = []
    for keyword in KEYWORDS["zh"]:
        try:
            data = _get(
                "https://www.lofter.com/dwr/call/plaincall/TagBean.search.dwr",
                params={"t": keyword, "type": "new"},
                headers={"Referer": "https://www.lofter.com"},
            )
            # Lofter 返回的是 DWR 格式或 HTML，实际部署需要解析
            # 使用备用的 tag 搜索页
            data = _get(
                f"https://api.lofter.com/v2.0/search.json",
                params={"keyword": keyword, "type": 0, "offset": 0, "limit": 20},
            )
            if data and data.status_code == 200:
                try:
                    result = data.json()
                    for post in result.get("data", {}).get("posts", []) or []:
                        hot = post.get("hot", 0)
                        items.append(_make_item(
                            title=post.get("title", "") or post.get("digest", "")[:100],
                            summary=post.get("digest", "")[:300],
                            source="lofter",
                            platform_region="cn",
                            time_str=datetime.now(timezone.utc).isoformat(),
                            url=post.get("blogPageUrl", ""),
                            engagement=hot,
                            is_hot=hot > 200,
                            author=post.get("blogInfo", {}).get("blogNickName", ""),
                            lang="zh",
                            content_type="image" if post.get("photoLinks") else "text",
                        ))
                except ValueError:
                    pass

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
    """从 5ch (日本) 搜索忘却前夜相关帖子。"""
    items = []
    for keyword in KEYWORDS["ja"]:
        try:
            # 5ch search API
            data = _get(
                "https://find.5ch.net/search",
                params={"q": keyword, "sort": "date"},
            )
            # 5ch 返回 HTML，实际部署时需要解析
            logger.info(f'5ch "{keyword}": attempted search')
        except Exception as e:
            logger.warning(f'5ch "{keyword}" failed: {e}')

    return items


# ─── 第三波新增数据源 ─────────────────────────────────────


def fetch_google_play():
    """从 Google Play Store 获取忘却前夜评论。"""
    gp_package = os.environ.get("GOOGLE_PLAY_PACKAGE", "")
    if not gp_package:
        logger.info("Google Play: GOOGLE_PLAY_PACKAGE not set, skipping")
        return []

    items = []
    # Google Play 没有官方评论 API，使用第三方数据解析
    for lang_code, region in [("zh_CN", "cn"), ("en_US", "global"), ("ja_JP", "jp"), ("ko_KR", "kr")]:
        try:
            data = _get(
                f"https://store.googleapis.com/store/api/reviews",
                params={"id": gp_package, "hl": lang_code, "num": 15, "sort": 0},
            )
            if data and data.status_code == 200:
                try:
                    result = data.json()
                    for review in result if isinstance(result, list) else result.get("reviews", []) or []:
                        rating = review.get("score", 0)
                        items.append(_make_item(
                            title=review.get("title", f"★{'★' * (rating - 1)}"),
                            summary=review.get("text", "")[:300],
                            source="google_play",
                            platform_region=region,
                            time_str=review.get("date", datetime.now(timezone.utc).isoformat()),
                            url=f"https://play.google.com/store/apps/details?id={gp_package}",
                            engagement=rating,
                            is_hot=False,
                            author=review.get("userName", ""),
                            lang=lang_code[:2],
                        ))
                except (ValueError, KeyError):
                    pass

            logger.info(f"Google Play ({lang_code}): {len(items)} reviews")
        except Exception as e:
            logger.warning(f"Google Play ({lang_code}) failed: {e}")

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
