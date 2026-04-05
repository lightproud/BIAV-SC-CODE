#!/usr/bin/env python3
"""
backfill_platforms.py — 多平台历史数据回溯采集

类似 Discord 归档器的双轨制：
  Track 1: 增量采集（由 collect_global.py 处理，每 6 小时）
  Track 2: 历史回溯（本脚本，每小时一次，每平台独立 agent，30 分钟限时）

状态文件: projects/news/data/backfill/state.json
  {
    "bilibili": {"page": 5, "done": false, "total": 230},
    "appstore": {"page": 3, "done": true, "total": 89},
    ...
  }

存储: 回溯数据直接写入 data/platforms/{source}/backfill-{batch}.json
      然后合并到对应日期文件

运行方式:
  python backfill_platforms.py                    # 所有平台各翻几页
  python backfill_platforms.py --platform bilibili  # 仅指定平台
  python backfill_platforms.py --pages 10           # 每平台翻10页（默认5）
  python backfill_platforms.py --status             # 显示回溯进度
"""

import json
import sys
import os
import time
import logging
import argparse
from datetime import datetime, timezone, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
STATE_PATH = _REPO_ROOT / 'projects' / 'news' / 'data' / 'backfill' / 'state.json'
ARCHIVE_DIR = _REPO_ROOT / 'projects' / 'news' / 'data' / 'platforms'
REPORT_SCRIPTS = _REPO_ROOT / 'projects' / 'news' / 'report-system' / 'scripts'

sys.path.insert(0, str(REPORT_SCRIPTS))

# Max runtime per invocation (30 minutes, leaves buffer for workflow)
MAX_RUNTIME_SECONDS = 1800
_start_time = time.time()

REQUEST_DELAY = 1.5  # seconds between requests to avoid rate limits


def _is_time_up() -> bool:
    return (time.time() - _start_time) > MAX_RUNTIME_SECONDS


def _load_state() -> dict:
    if STATE_PATH.exists():
        with open(STATE_PATH, encoding='utf-8') as f:
            return json.load(f)
    return {}


def _save_state(state: dict):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _platform_state(state: dict, name: str) -> dict:
    if name not in state:
        state[name] = {"page": 1, "done": False, "total": 0}
    return state[name]


def _archive_items(source: str, items: list[dict]):
    """Archive items into per-date files under data/platforms/{source}/."""
    if not items:
        return

    # Group items by date
    by_date: dict[str, list] = {}
    for item in items:
        t = item.get('time', '')
        try:
            dt = datetime.fromisoformat(t)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            date_str = (dt + timedelta(hours=8)).strftime('%Y-%m-%d')
        except (ValueError, TypeError):
            date_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        by_date.setdefault(date_str, []).append(item)

    for date_str, date_items in by_date.items():
        platform_dir = ARCHIVE_DIR / source
        platform_dir.mkdir(parents=True, exist_ok=True)
        path = platform_dir / f'{date_str}.json'

        # Merge with existing
        existing_items = []
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding='utf-8'))
                existing_items = data.get('items', [])
            except Exception:
                pass

        # Dedup by URL or title
        seen = set()
        merged = []
        for item in existing_items + date_items:
            key = item.get('url', '').strip() or f"{item.get('title', '')[:60]}|{item.get('source', '')}"
            if key not in seen:
                seen.add(key)
                merged.append(item)

        merged.sort(key=lambda x: x.get('engagement', 0), reverse=True)

        archive_data = {
            'date': date_str,
            'archived_at': datetime.now(timezone.utc).isoformat(),
            'source': source,
            'item_count': len(merged),
            'items': merged,
        }
        path.write_text(json.dumps(archive_data, ensure_ascii=False, indent=2), encoding='utf-8')


# ── Platform-specific backfill functions ──────────────────────────────────

def backfill_bilibili(state: dict, max_pages: int) -> int:
    """Backfill Bilibili search results page by page."""
    from collector import _get, _make_item, KEYWORDS
    ps = _platform_state(state, 'bilibili')
    if ps['done']:
        return 0

    total = 0
    start_page = ps['page']

    for keyword in KEYWORDS['zh']:
        for page in range(start_page, start_page + max_pages):
            if _is_time_up():
                break
            try:
                data = _get(
                    "https://api.bilibili.com/x/web-interface/search/type",
                    params={"keyword": keyword, "search_type": "video", "page": page, "pagesize": 50,
                            "order": "pubdate"},
                ).json()

                results = data.get("data", {}).get("result", [])
                if not results:
                    ps['done'] = True
                    break

                items = []
                for v in results:
                    items.append(_make_item(
                        title=v.get("title", "").replace('<em class="keyword">', '').replace('</em>', ''),
                        summary=v.get("description", "")[:300],
                        source="bilibili",
                        platform_region="cn",
                        time_str=datetime.fromtimestamp(v.get("pubdate", 0), tz=timezone.utc).isoformat()
                            if v.get("pubdate") else "",
                        url=v.get("arcurl", ""),
                        engagement=v.get("play", 0) + v.get("favorites", 0),
                        is_hot=v.get("play", 0) > 10000,
                        author=v.get("author", ""),
                        lang="zh",
                    ))

                _archive_items('bilibili', items)
                total += len(items)
                ps['page'] = page + 1
                ps['total'] += len(items)
                _save_state(state)

                logger.info(f'Bilibili backfill p{page} "{keyword}": +{len(items)}')
                time.sleep(REQUEST_DELAY)

            except Exception as e:
                logger.warning(f'Bilibili backfill p{page} "{keyword}" failed: {e}')
                break

    return total


def backfill_appstore(state: dict, max_pages: int) -> int:
    """Backfill App Store reviews across all regions and pages."""
    from collector import _get, _make_item
    ps = _platform_state(state, 'appstore')
    if ps['done']:
        return 0

    app_id = "6447354150"
    regions = ["cn", "us", "jp", "kr", "hk", "tw", "sg", "gb", "de", "fr", "ru", "th", "vn"]
    total = 0
    start_page = ps['page']

    for country in regions:
        for page in range(start_page, start_page + max_pages):
            if _is_time_up():
                break
            try:
                data = _get(
                    f"https://itunes.apple.com/{country}/rss/customerreviews/page={page}/id={app_id}/sortBy=mostRecent/json",
                ).json()

                entries = data.get("feed", {}).get("entry", [])
                if not entries:
                    break

                items = []
                for entry in entries:
                    if isinstance(entry.get("im:rating"), dict):
                        rating = int(entry["im:rating"].get("label", "0"))
                    else:
                        continue
                    title = entry.get("title", {}).get("label", "") if isinstance(entry.get("title"), dict) else ""
                    content = entry.get("content", {}).get("label", "") if isinstance(entry.get("content"), dict) else ""
                    author_name = ""
                    if isinstance(entry.get("author"), dict):
                        author_name = entry["author"].get("name", {}).get("label", "")

                    sentiment = '好评' if rating >= 4 else ('中评' if rating == 3 else '差评')
                    items.append(_make_item(
                        title=title or f"[{sentiment}] ★{rating}",
                        summary=content[:300],
                        source="appstore",
                        platform_region=country,
                        time_str=entry.get("updated", {}).get("label", "")
                            if isinstance(entry.get("updated"), dict) else "",
                        url="",
                        engagement=rating,
                        is_hot=False,
                        author=author_name,
                        lang="",
                    ))

                _archive_items('appstore', items)
                total += len(items)
                ps['total'] += len(items)
                logger.info(f'App Store backfill {country} p{page}: +{len(items)}')
                time.sleep(REQUEST_DELAY)

            except Exception as e:
                logger.warning(f'App Store backfill {country} p{page} failed: {e}')
                break

    ps['page'] = start_page + max_pages
    if start_page + max_pages > 10:  # App Store max ~10 pages per region
        ps['done'] = True
    _save_state(state)
    return total


def backfill_arca_live(state: dict, max_pages: int) -> int:
    """Backfill Arca.live forgettingeve channel page by page."""
    from collector import _get, _make_item
    import re as _re
    ps = _platform_state(state, 'arca_live')
    if ps['done']:
        return 0

    channel = "forgettingeve"
    total = 0
    start_page = ps['page']

    for page in range(start_page, start_page + max_pages):
        if _is_time_up():
            break
        try:
            resp = _get(
                f"https://arca.live/b/{channel}",
                params={"p": page},
                headers={"User-Agent": "Mozilla/5.0"},
            )
            html = resp.text

            items = []
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
                    is_hot=False,
                    author="",
                    lang="ko",
                ))

            if not items:
                ps['done'] = True
                break

            _archive_items('arca_live', items)
            total += len(items)
            ps['page'] = page + 1
            ps['total'] += len(items)
            _save_state(state)

            logger.info(f'Arca.live backfill p{page}: +{len(items)}')
            time.sleep(REQUEST_DELAY)

        except Exception as e:
            logger.warning(f'Arca.live backfill p{page} failed: {e}')
            break

    return total


def backfill_dcinside(state: dict, max_pages: int) -> int:
    """Backfill DCInside morimens gallery page by page."""
    from collector import _get, _make_item
    import re as _re
    ps = _platform_state(state, 'dcinside')
    if ps['done']:
        return 0

    gallery_id = "morimens"
    total = 0
    start_page = ps['page']

    for page in range(start_page, start_page + max_pages):
        if _is_time_up():
            break
        try:
            resp = _get(
                f"https://gall.dcinside.com/mgallery/board/lists/",
                params={"id": gallery_id, "page": page},
                headers={"Referer": "https://gall.dcinside.com", "User-Agent": "Mozilla/5.0"},
            )
            html = resp.text

            items = []
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
                    url=f"https://gall.dcinside.com/mgallery/board/view/?id={gallery_id}&no={article_no}",
                    engagement=0,
                    is_hot=False,
                    author="",
                    lang="ko",
                ))

            if not items:
                ps['done'] = True
                break

            _archive_items('dcinside', items)
            total += len(items)
            ps['page'] = page + 1
            ps['total'] += len(items)
            _save_state(state)

            logger.info(f'DCInside backfill p{page}: +{len(items)}')
            time.sleep(REQUEST_DELAY)

        except Exception as e:
            logger.warning(f'DCInside backfill p{page} failed: {e}')
            break

    return total


def backfill_steam_reviews(state: dict, max_pages: int) -> int:
    """Backfill all Steam reviews using cursor pagination."""
    import subprocess as _sp
    from collector import _make_item
    ps = _platform_state(state, 'steam_review')
    if ps['done']:
        return 0

    app_id = 3052450
    cursor = ps.get('cursor', '*')
    total = 0

    for _ in range(max_pages):
        if _is_time_up():
            break
        try:
            import urllib.parse
            encoded_cursor = urllib.parse.quote(cursor, safe='')
            url = (f'https://store.steampowered.com/appreviews/{app_id}?json=1'
                   f'&filter=recent&num_per_page=100&language=all&purchase_type=all'
                   f'&cursor={encoded_cursor}')

            result = _sp.run(
                ['curl', '-s', '-H', 'User-Agent: Mozilla/5.0', url],
                capture_output=True, text=True, timeout=30,
            )
            data = json.loads(result.stdout)

            reviews = data.get('reviews', [])
            if not reviews:
                ps['done'] = True
                break

            new_cursor = data.get('cursor', '')
            if not new_cursor or new_cursor == cursor:
                ps['done'] = True
                break

            items = []
            for review in reviews:
                ts = review.get('timestamp_created', 0)
                created = datetime.fromtimestamp(ts, tz=timezone.utc)
                voted_up = review.get('voted_up', False)
                sentiment = '正面' if voted_up else '负面'
                review_text = review.get('review', '')
                language = review.get('language', 'unknown')
                author_info = review.get('author', {})
                steamid = author_info.get('steamid', '')
                votes_up = review.get('votes_up', 0)

                items.append(_make_item(
                    title=f'[{sentiment}] {review_text[:50]}...' if len(review_text) > 50
                          else f'[{sentiment}] {review_text}',
                    summary=review_text[:300],
                    source="steam_review",
                    platform_region="global",
                    time_str=created.isoformat(),
                    url=f'https://steamcommunity.com/profiles/{steamid}/recommended/{app_id}',
                    engagement=votes_up,
                    is_hot=votes_up > 10,
                    author=steamid,
                    lang=language,
                ))

            _archive_items('steam_review', items)
            total += len(items)
            cursor = new_cursor
            ps['cursor'] = cursor
            ps['page'] += 1
            ps['total'] += len(items)
            _save_state(state)

            logger.info(f'Steam reviews backfill batch {ps["page"]}: +{len(items)}')
            time.sleep(REQUEST_DELAY)

        except Exception as e:
            logger.warning(f'Steam reviews backfill failed: {e}')
            break

    return total


def backfill_naver_cafe(state: dict, max_pages: int) -> int:
    """Backfill Naver Cafe search results."""
    from collector import _get, _make_item, KEYWORDS
    ps = _platform_state(state, 'naver_cafe')
    if ps['done']:
        return 0

    total = 0
    start_page = ps['page']

    for keyword in KEYWORDS['ko']:
        for page in range(start_page, start_page + max_pages):
            if _is_time_up():
                break
            try:
                data = _get(
                    "https://apis.naver.com/cafe-web/cafe2/ArticleSearchListV2.json",
                    params={"query": keyword, "page": page, "sortBy": "date"},
                    headers={"Referer": "https://cafe.naver.com"},
                ).json()

                articles = data.get("message", {}).get("result", {}).get("articleList", []) or []
                if not articles:
                    ps['done'] = True
                    break

                items = []
                for article in articles:
                    items.append(_make_item(
                        title=article.get("subject", ""),
                        summary=article.get("summary", ""),
                        source="naver_cafe",
                        platform_region="kr",
                        time_str=article.get("writeDateTimestamp",
                                             datetime.now(timezone.utc).isoformat()),
                        url=article.get("articleUrl", ""),
                        engagement=article.get("readCount", 0) + article.get("commentCount", 0),
                        is_hot=article.get("readCount", 0) > 500,
                        author=article.get("writerNickName", ""),
                        lang="ko",
                    ))

                _archive_items('naver_cafe', items)
                total += len(items)
                ps['page'] = page + 1
                ps['total'] += len(items)
                _save_state(state)

                logger.info(f'Naver Cafe backfill "{keyword}" p{page}: +{len(items)}')
                time.sleep(REQUEST_DELAY)

            except Exception as e:
                logger.warning(f'Naver Cafe backfill "{keyword}" p{page} failed: {e}')
                break

    return total


def backfill_pixiv(state: dict, max_pages: int) -> int:
    """Backfill Pixiv search results page by page."""
    from collector import _get, _make_item, KEYWORDS
    ps = _platform_state(state, 'pixiv')
    if ps['done']:
        return 0

    total = 0
    start_page = ps['page']

    for keyword in KEYWORDS['ja'] + KEYWORDS['zh']:
        for page in range(start_page, start_page + max_pages):
            if _is_time_up():
                break
            try:
                data = _get(
                    "https://www.pixiv.net/ajax/search/artworks/" + keyword,
                    params={"p": page, "order": "date_d", "mode": "all", "s_mode": "s_tag"},
                    headers={"Referer": "https://www.pixiv.net", "User-Agent": "Mozilla/5.0"},
                )
                if data.status_code != 200:
                    break

                result = data.json()
                works = result.get("body", {}).get("illustManga", {}).get("data", []) or []
                if not works:
                    ps['done'] = True
                    break

                items = []
                for work in works:
                    items.append(_make_item(
                        title=work.get("title", ""),
                        summary=work.get("description", "")[:300],
                        source="pixiv",
                        platform_region="jp",
                        time_str=work.get("createDate", ""),
                        url=f"https://www.pixiv.net/artworks/{work.get('id', '')}",
                        engagement=work.get("bookmarkCount", 0),
                        is_hot=work.get("bookmarkCount", 0) > 100,
                        author=work.get("userName", ""),
                        lang="ja",
                    ))

                _archive_items('pixiv', items)
                total += len(items)
                ps['page'] = page + 1
                ps['total'] += len(items)
                _save_state(state)

                logger.info(f'Pixiv backfill "{keyword}" p{page}: +{len(items)}')
                time.sleep(REQUEST_DELAY)

            except Exception as e:
                logger.warning(f'Pixiv backfill "{keyword}" p{page} failed: {e}')
                break

    return total


def backfill_ruliweb(state: dict, max_pages: int) -> int:
    """Backfill Ruliweb search results page by page."""
    from collector import _get, _make_item, KEYWORDS
    import re as _re
    ps = _platform_state(state, 'ruliweb')
    if ps['done']:
        return 0

    total = 0
    start_page = ps['page']

    for keyword in KEYWORDS['ko']:
        for page in range(start_page, start_page + max_pages):
            if _is_time_up():
                break
            try:
                resp = _get(
                    "https://bbs.ruliweb.com/search",
                    params={"q": keyword, "page": page},
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                html = resp.text

                items = []
                for match in _re.finditer(
                    r'class="subject_link"[^>]*href="([^"]+)"[^>]*>\s*([^<]+?)\s*</a>',
                    html
                ):
                    url, title = match.groups()
                    title = title.strip()
                    if not title:
                        continue
                    if not url.startswith("http"):
                        url = f"https://bbs.ruliweb.com{url}"
                    items.append(_make_item(
                        title=title,
                        summary="",
                        source="ruliweb",
                        platform_region="kr",
                        time_str=datetime.now(timezone.utc).isoformat(),
                        url=url,
                        engagement=0,
                        is_hot=False,
                        author="",
                        lang="ko",
                    ))

                if not items:
                    ps['done'] = True
                    break

                _archive_items('ruliweb', items)
                total += len(items)
                ps['page'] = page + 1
                ps['total'] += len(items)
                _save_state(state)

                logger.info(f'Ruliweb backfill "{keyword}" p{page}: +{len(items)}')
                time.sleep(REQUEST_DELAY)

            except Exception as e:
                logger.warning(f'Ruliweb backfill "{keyword}" p{page} failed: {e}')
                break

    return total


def backfill_weixin(state: dict, max_pages: int) -> int:
    """Backfill Sogou WeChat search results page by page."""
    from collector import _get, _make_item, KEYWORDS
    import re as _re
    ps = _platform_state(state, 'weixin')
    if ps['done']:
        return 0

    total = 0
    start_page = ps['page']

    for keyword in KEYWORDS['zh']:
        for page in range(start_page, start_page + max_pages):
            if _is_time_up():
                break
            try:
                resp = _get(
                    "https://weixin.sogou.com/weixin",
                    params={"type": 2, "query": keyword, "ie": "utf8", "page": page},
                    headers={"User-Agent": "Mozilla/5.0", "Referer": "https://weixin.sogou.com/"},
                )
                html = resp.text

                items = []
                for match in _re.finditer(
                    r'<h3>.*?<a[^>]*href="([^"]+)"[^>]*>(.+?)</a>',
                    html, _re.DOTALL
                ):
                    url, title_html = match.groups()
                    title = _re.sub(r'<[^>]+>', '', title_html).strip()
                    if not title:
                        continue
                    items.append(_make_item(
                        title=f"[微信] {title}",
                        summary="",
                        source="weixin",
                        platform_region="cn",
                        time_str=datetime.now(timezone.utc).isoformat(),
                        url=url,
                        engagement=0,
                        is_hot=False,
                        author="",
                        lang="zh",
                    ))

                if not items:
                    ps['done'] = True
                    break

                _archive_items('weixin', items)
                total += len(items)
                ps['page'] = page + 1
                ps['total'] += len(items)
                _save_state(state)

                logger.info(f'WeChat backfill "{keyword}" p{page}: +{len(items)}')
                time.sleep(REQUEST_DELAY)

            except Exception as e:
                logger.warning(f'WeChat backfill "{keyword}" p{page} failed: {e}')
                break

    return total


# ── Registry ──────────────────────────────────────────────────────────────

BACKFILL_REGISTRY = {
    'bilibili': backfill_bilibili,
    'appstore': backfill_appstore,
    'steam_review': backfill_steam_reviews,
    'arca_live': backfill_arca_live,
    'dcinside': backfill_dcinside,
    'naver_cafe': backfill_naver_cafe,
    'pixiv': backfill_pixiv,
    'ruliweb': backfill_ruliweb,
    'weixin': backfill_weixin,
}


def show_status(state: dict):
    """Display backfill progress for all platforms."""
    print('=== 历史回溯进度 ===\n')
    for name, fn in BACKFILL_REGISTRY.items():
        ps = state.get(name, {"page": 1, "done": False, "total": 0})
        status = '✅ 完成' if ps.get('done') else f'📄 第 {ps.get("page", 1)} 页'
        total = ps.get('total', 0)
        print(f'  {name:15s}  {status:12s}  共 {total:5d} 条')
    print()


def main():
    parser = argparse.ArgumentParser(description='多平台历史数据回溯采集')
    parser.add_argument('--platform', type=str, default=None, help='仅回溯指定平台')
    parser.add_argument('--pages', type=int, default=5, help='每平台翻几页（默认5）')
    parser.add_argument('--status', action='store_true', help='显示回溯进度')
    args = parser.parse_args()

    state = _load_state()

    if args.status:
        show_status(state)
        return

    logger.info('=== 历史回溯采集开始 ===')

    if args.platform:
        if args.platform not in BACKFILL_REGISTRY:
            logger.error(f'未知平台: {args.platform}，可选: {", ".join(BACKFILL_REGISTRY.keys())}')
            return
        fn = BACKFILL_REGISTRY[args.platform]
        count = fn(state, args.pages)
        logger.info(f'{args.platform}: +{count} items')
    else:
        total = 0
        for name, fn in BACKFILL_REGISTRY.items():
            if _is_time_up():
                logger.warning(f'运行时间已达上限，剩余平台下次继续')
                break
            ps = _platform_state(state, name)
            if ps.get('done'):
                logger.info(f'{name}: 已完成')
                continue
            count = fn(state, args.pages)
            total += count
            logger.info(f'{name}: +{count} items')

        logger.info(f'=== 历史回溯完成: +{total} items ===')

    show_status(state)


if __name__ == '__main__':
    main()
