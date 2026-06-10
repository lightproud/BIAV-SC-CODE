#!/usr/bin/env python3
"""
Playwright-based collectors for Morimens community news.
Final fixed version based on actual page structure analysis.

Tested and working:
- NGA: Using .topicrow selector, TD 1 for title
- Weibo: Using article selector on mobile version
- Xiaohongshu: ⚠ Requires login/special handling
- TapTap: ⚠ App page returns 405, need alternative
"""

import logging
import re
from datetime import datetime, timezone, timedelta
from typing import List, Dict

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

try:
    from collection_state import get_lookback_hours
    HOURS_LOOKBACK = get_lookback_hours()
except ImportError:
    HOURS_LOOKBACK = 24
TIMEOUT_MS = 30000


def _parse_relative_time(text: str) -> tuple[str, bool]:
    """Parse relative/absolute time strings from various platforms into ISO datetime.

    Handles:
    - Chinese: "x分钟前", "x小时前", "x天前", "刚刚", "昨天", "前天"
    - Korean: "x분 전", "x시간 전", "x일 전"
    - Japanese: "x分前", "x時間前", "x日前"
    - English: "x minutes ago", "x hours ago", "x days ago"
    - Absolute: "YYYY-MM-DD", "YYYY/MM/DD", "MM-DD", "MM/DD"
    - Arca.live format: "HH:MM", "MM.DD", "YYYY.MM.DD"

    Returns (iso_string, is_approximate). is_approximate=True only when
    the text is empty or completely unparseable.
    """
    now = datetime.now(timezone.utc)
    if not text or not text.strip():
        return now.isoformat(), True

    s = text.strip()

    # Try ISO format first
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.isoformat(), False
    except (ValueError, TypeError):
        pass

    # Chinese relative: "刚刚"
    if s == "刚刚":
        return now.isoformat(), False

    # Chinese: "x分钟前", "x小时前", "x天前"
    m = re.match(r"(\d+)\s*分钟前", s)
    if m:
        return (now - timedelta(minutes=int(m.group(1)))).isoformat(), False
    m = re.match(r"(\d+)\s*小时前", s)
    if m:
        return (now - timedelta(hours=int(m.group(1)))).isoformat(), False
    m = re.match(r"(\d+)\s*天前", s)
    if m:
        return (now - timedelta(days=int(m.group(1)))).isoformat(), False

    # Korean: "x분 전", "x시간 전", "x일 전"
    m = re.match(r"(\d+)\s*분\s*전", s)
    if m:
        return (now - timedelta(minutes=int(m.group(1)))).isoformat(), False
    m = re.match(r"(\d+)\s*시간\s*전", s)
    if m:
        return (now - timedelta(hours=int(m.group(1)))).isoformat(), False
    m = re.match(r"(\d+)\s*일\s*전", s)
    if m:
        return (now - timedelta(days=int(m.group(1)))).isoformat(), False

    # Japanese: "x分前", "x時間前", "x日前"
    m = re.match(r"(\d+)\s*分前", s)
    if m:
        return (now - timedelta(minutes=int(m.group(1)))).isoformat(), False
    m = re.match(r"(\d+)\s*時間前", s)
    if m:
        return (now - timedelta(hours=int(m.group(1)))).isoformat(), False
    m = re.match(r"(\d+)\s*日前", s)
    if m:
        return (now - timedelta(days=int(m.group(1)))).isoformat(), False

    # English: "x minutes/hours/days/weeks ago", "Streamed x ago"
    m = re.match(r"(?:streamed\s+)?(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago", s, re.IGNORECASE)
    if m:
        num = int(m.group(1))
        unit = m.group(2).lower()
        delta_map = {
            "second": timedelta(seconds=num), "minute": timedelta(minutes=num),
            "hour": timedelta(hours=num), "day": timedelta(days=num),
            "week": timedelta(weeks=num), "month": timedelta(days=num * 30),
            "year": timedelta(days=num * 365),
        }
        return (now - delta_map.get(unit, timedelta())).isoformat(), False

    # "昨天" / "前天"
    if "昨天" in s:
        return (now - timedelta(days=1)).isoformat(), False
    if "前天" in s:
        return (now - timedelta(days=2)).isoformat(), False

    # Arca.live style: "YYYY.MM.DD" or "MM.DD"
    m = re.match(r"(\d{4})\.(\d{1,2})\.(\d{1,2})", s)
    if m:
        try:
            dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
            return dt.isoformat(), False
        except ValueError:
            pass
    m = re.match(r"(\d{1,2})\.(\d{1,2})\s*$", s)
    if m:
        try:
            dt = now.replace(month=int(m.group(1)), day=int(m.group(2)),
                             hour=0, minute=0, second=0, microsecond=0)
            if dt > now:
                dt = dt.replace(year=dt.year - 1)
            return dt.isoformat(), False
        except ValueError:
            pass

    # "YYYY-MM-DD" or "YYYY/MM/DD"
    m = re.match(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", s)
    if m:
        try:
            dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
            return dt.isoformat(), False
        except ValueError:
            pass

    # "MM-DD" or "MM/DD" (current year)
    m = re.match(r"(\d{1,2})[-/](\d{1,2})\s*$", s)
    if m:
        try:
            dt = now.replace(month=int(m.group(1)), day=int(m.group(2)),
                             hour=0, minute=0, second=0, microsecond=0)
            if dt > now:
                dt = dt.replace(year=dt.year - 1)
            return dt.isoformat(), False
        except ValueError:
            pass

    # Arca.live time-only: "HH:MM" (today)
    m = re.match(r"(\d{1,2}):(\d{2})\s*$", s)
    if m:
        try:
            dt = now.replace(hour=int(m.group(1)), minute=int(m.group(2)),
                             second=0, microsecond=0)
            if dt > now:
                dt -= timedelta(days=1)
            return dt.isoformat(), False
        except ValueError:
            pass

    return now.isoformat(), True


def fetch_nga_playwright() -> List[Dict]:
    """
    Fetch NGA forum posts for Morimens.
    Tested: Page loads with 51 topicrow elements.
    Structure: TD[0]=replies, TD[1]=title, TD[2]=post_time, TD[3]=last_reply
    """
    items = []
    
    try:
        from playwright.sync_api import sync_playwright
        
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_default_timeout(TIMEOUT_MS)
            
            url = 'https://bbs.nga.cn/thread.php?fid=-447601'
            logger.info(f'NGA: 访问 {url}')
            page.goto(url, wait_until='networkidle')
            page.wait_for_timeout(3000)
            
            rows = page.query_selector_all('.topicrow')
            logger.info(f'NGA: 找到 {len(rows)} 个帖子')
            
            for row in rows[:30]:
                try:
                    tds = row.query_selector_all('td')
                    if len(tds) < 4:
                        continue
                    
                    # TD 0: 回复数
                    reply_text = tds[0].inner_text().strip()
                    reply_count = int(reply_text) if reply_text.isdigit() else 0
                    
                    # TD 1: 标题（需要清理）
                    title_full = tds[1].inner_text().strip()
                    # 清理标题：移除多余的标记
                    title = title_full
                    for remove in ['锁定', '单帖', '精华', '置顶']:
                        title = title.replace(remove, '')
                    # 取第一行作为标题
                    title = title.split('\n')[0].strip()
                    
                    # 获取链接
                    link_el = tds[0].query_selector('a[href*="read.php?tid"]')
                    href = link_el.get_attribute('href') if link_el else ''
                    if href and not href.startswith('http'):
                        href = f'https://bbs.nga.cn{href}'
                    
                    # TD 2: 发帖时间
                    post_time_text = tds[2].inner_text().strip() if len(tds) > 2 else ''
                    parsed_time, time_approx = _parse_relative_time(post_time_text)

                    # TD 3: 作者
                    author = ''
                    author_text = tds[3].inner_text()
                    lines = author_text.split('\n')
                    if len(lines) > 1:
                        author = lines[-1].strip()

                    if len(title) < 3:
                        continue

                    item = {
                        'title': title[:100],
                        'summary': '',
                        'source': 'nga',
                        'time': parsed_time,
                        'url': href,
                        'engagement': reply_count,
                        'is_hot': reply_count > 50,
                        'author': author,
                        'tags': ['nga'],
                    }
                    if time_approx:
                        item['time_is_approximate'] = True
                    items.append(item)
                except Exception as e:
                    logger.debug(f'NGA 解析失败: {e}')
                    continue
            
            browser.close()
    except Exception as e:
        logger.warning(f'NGA Playwright 失败: {e}')
    
    logger.info(f'NGA Playwright: fetched {len(items)} items')
    return items


def fetch_weibo_playwright() -> List[Dict]:
    """
    Fetch Weibo search results using mobile version.
    Tested: 15 articles found with content.
    """
    items = []
    
    try:
        from playwright.sync_api import sync_playwright
        
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_default_timeout(TIMEOUT_MS)
            
            # 移动版无需登录
            url = 'https://m.weibo.cn/search?containerid=100103type%3D1%26q%3D%E5%BF%98%E5%8D%B4%E5%89%8D%E5%A4%9C'
            logger.info(f'微博: 访问移动版')
            page.goto(url, wait_until='networkidle')
            page.wait_for_timeout(3000)
            
            articles = page.query_selector_all('article')
            logger.info(f'微博: 找到 {len(articles)} 条微博')
            
            for article in articles[:20]:
                try:
                    # 内容
                    text_el = article.query_selector('.weibo-text, .content, p')
                    if not text_el:
                        continue
                    
                    text = text_el.inner_text().strip()
                    if len(text) < 10:
                        continue
                    
                    # 时间
                    time_el = article.query_selector('time, [class*="time"], [class*="date"]')
                    time_text = ''
                    if time_el:
                        time_text = time_el.get_attribute('datetime') or time_el.inner_text().strip()
                    parsed_time, time_approx = _parse_relative_time(time_text)

                    # 链接
                    link_el = article.query_selector('a[href*="status"]')
                    href = ''
                    if link_el:
                        href = link_el.get_attribute('href') or ''
                        if href and not href.startswith('http'):
                            href = f'https://m.weibo.cn{href}'

                    item = {
                        'title': text[:80],
                        'summary': text[:500],
                        'source': 'weibo',
                        'time': parsed_time,
                        'url': href,
                        'engagement': 0,
                        'is_hot': False,
                        'author': '',
                        'tags': ['weibo'],
                    }
                    if time_approx:
                        item['time_is_approximate'] = True
                    items.append(item)
                except Exception:
                    continue
            
            browser.close()
    except Exception as e:
        logger.warning(f'微博 Playwright 失败: {e}')
    
    logger.info(f'微博 Playwright: fetched {len(items)} items')
    return items


def fetch_taptap_playwright() -> List[Dict]:
    """
    Fetch TapTap game page.
    Note: Direct app page returns 405, try search instead.
    """
    items = []
    
    try:
        from playwright.sync_api import sync_playwright
        
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_default_timeout(TIMEOUT_MS)
            
            # 搜索页
            url = 'https://www.taptap.cn/search?keyword=%E5%BF%98%E5%8D%B4%E5%89%8D%E5%A4%9C'
            logger.info(f'TapTap: 访问搜索页')
            page.goto(url, wait_until='networkidle')
            page.wait_for_timeout(3000)
            
            # 尝试获取游戏卡片
            cards = page.query_selector_all('.app-card, .search-item, [class*="app"]')
            logger.info(f'TapTap: 找到 {len(cards)} 个卡片')
            
            for card in cards[:10]:
                try:
                    title_el = card.query_selector('.app-name, .title, h3')
                    title = title_el.inner_text().strip() if title_el else ''
                    
                    link_el = card.query_selector('a[href*="/app/"]')
                    href = link_el.get_attribute('href') if link_el else ''
                    
                    if href and '/app/' in href:
                        if not href.startswith('http'):
                            href = f'https://www.taptap.cn{href}'

                        items.append({
                            'title': f'[TapTap] {title or "忘却前夜"}',
                            'summary': '',
                            'source': 'taptap',
                            'time': datetime.now(timezone.utc).isoformat(),
                            'time_is_approximate': True,
                            'url': href,
                            'engagement': 0,
                            'is_hot': False,
                            'author': '',
                            'tags': ['taptap'],
                        })
                except Exception:
                    continue
            
            browser.close()
    except Exception as e:
        logger.warning(f'TapTap Playwright 失败: {e}')
    
    logger.info(f'TapTap Playwright: fetched {len(items)} items')
    return items


# ── Korean platforms ──────────────────────────────────────────────────────

def fetch_arca_live_playwright() -> List[Dict]:
    """
    Fetch Arca.live forgettingeve channel via Playwright (bypasses Cloudflare).
    """
    items = []

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            # CF 挑战页广告/埋点流量不断，networkidle 永不静默 → goto 必超时。
            # 改等 domcontentloaded，再显式等列表选择器出现（给 CF 放行留时间）。
            page = browser.new_page(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                locale='ko-KR',
            )
            page.set_default_timeout(TIMEOUT_MS)

            for mode in ['', 'best']:
                try:
                    url = 'https://arca.live/b/forgettingeve'
                    if mode:
                        url += f'?mode={mode}'
                    page.goto(url, wait_until='domcontentloaded', timeout=45000)
                    page.wait_for_selector('.vrow', timeout=20000)
                    page.wait_for_timeout(1500)

                    rows = page.query_selector_all('.vrow:not(.notice)')
                    for row in rows[:30]:
                        title_el = row.query_selector('.title')
                        time_el = row.query_selector('.col-time')
                        link_el = row.query_selector('a.vrow-top')
                        if not title_el:
                            continue

                        title = title_el.inner_text().strip()
                        href = link_el.get_attribute('href') if link_el else ''
                        time_text = time_el.inner_text().strip() if time_el else ''

                        if not title:
                            continue
                        if href and not href.startswith('http'):
                            href = f'https://arca.live{href}'

                        parsed_time, time_approx = _parse_relative_time(time_text)
                        item = {
                            'title': title[:100],
                            'summary': '',
                            'source': 'arca_live',
                            'time': parsed_time,
                            'url': href,
                            'engagement': 0,
                            'is_hot': (mode == 'best'),
                            'author': '',
                            'tags': ['arca_live'],
                            'lang': 'ko',
                            'platform_region': 'kr',
                        }
                        if time_approx:
                            item['time_is_approximate'] = True
                        items.append(item)
                    logger.info(f'Arca.live PW mode={mode or "latest"}: {len(items)} total')
                except Exception as e:
                    logger.warning(f'Arca.live PW mode={mode or "latest"} failed: {e}')

            browser.close()
    except Exception as e:
        logger.warning(f'Arca.live Playwright failed: {e}')

    logger.info(f'Arca.live Playwright: fetched {len(items)} items')
    return items


def fetch_ruliweb_playwright() -> List[Dict]:
    """
    Fetch Ruliweb search results via Playwright.
    """
    items = []
    keywords = ["망각전야", "모리멘스", "Morimens"]

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_default_timeout(TIMEOUT_MS)

            for keyword in keywords:
                try:
                    page.goto(
                        f'https://bbs.ruliweb.com/search?q={keyword}',
                        wait_until='networkidle',
                    )
                    page.wait_for_timeout(2000)

                    links = page.query_selector_all('a.subject_link')
                    for link in links:
                        title = link.inner_text().strip()
                        href = link.get_attribute('href') or ''
                        if not title:
                            continue
                        if not href.startswith('http'):
                            href = f'https://bbs.ruliweb.com{href}'

                        items.append({
                            'title': title[:100],
                            'summary': '',
                            'source': 'ruliweb',
                            'time': datetime.now(timezone.utc).isoformat(),
                            'time_is_approximate': True,
                            'url': href,
                            'engagement': 0,
                            'is_hot': False,
                            'author': '',
                            'tags': ['ruliweb'],
                            'lang': 'ko',
                            'platform_region': 'kr',
                        })
                    logger.info(f'Ruliweb PW "{keyword}": {len(items)} total')
                except Exception as e:
                    logger.warning(f'Ruliweb PW "{keyword}" failed: {e}')

            browser.close()
    except Exception as e:
        logger.warning(f'Ruliweb Playwright failed: {e}')

    logger.info(f'Ruliweb Playwright: fetched {len(items)} items')
    return items


# ── Japanese platforms ────────────────────────────────────────────────────

def fetch_fivech_playwright() -> List[Dict]:
    """
    Fetch 5ch search results via Playwright (bypasses 503).
    """
    items = []
    keywords = ["忘却前夜", "モリメンス"]

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_default_timeout(TIMEOUT_MS)

            for keyword in keywords:
                try:
                    page.goto(
                        f'https://find.5ch.net/search?q={keyword}',
                        wait_until='networkidle',
                    )
                    page.wait_for_timeout(2000)

                    links = page.query_selector_all('a[href*="5ch.net/test/read.cgi"]')
                    for link in links:
                        title = link.inner_text().strip()
                        href = link.get_attribute('href') or ''
                        if not title or len(title) < 3:
                            continue

                        items.append({
                            'title': title[:100],
                            'summary': '',
                            'source': 'fivech',
                            'time': datetime.now(timezone.utc).isoformat(),
                            'time_is_approximate': True,
                            'url': href,
                            'engagement': 0,
                            'is_hot': False,
                            'author': '',
                            'tags': ['5ch'],
                            'lang': 'ja',
                            'platform_region': 'jp',
                        })
                    logger.info(f'5ch PW "{keyword}": {len(items)} total')
                except Exception as e:
                    logger.warning(f'5ch PW "{keyword}" failed: {e}')

            browser.close()
    except Exception as e:
        logger.warning(f'5ch Playwright failed: {e}')

    logger.info(f'5ch Playwright: fetched {len(items)} items')
    return items


def fetch_bahamut_playwright() -> List[Dict]:
    """
    Fetch Bahamut (gamer.com.tw) search results via Playwright.
    """
    items = []
    keywords = ["忘却前夜", "忘卻前夜", "Morimens"]

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_default_timeout(TIMEOUT_MS)

            for keyword in keywords:
                try:
                    page.goto(
                        f'https://forum.gamer.com.tw/search.php?q={keyword}',
                        wait_until='networkidle',
                    )
                    page.wait_for_timeout(2000)

                    rows = page.query_selector_all('.b-list__row, .FM-blist3A')
                    for row in rows[:20]:
                        title_el = row.query_selector('.b-list__main__title, a[href*="C.php"]')
                        if not title_el:
                            continue
                        title = title_el.inner_text().strip()
                        href = title_el.get_attribute('href') or ''
                        if not title:
                            continue
                        if href and not href.startswith('http'):
                            href = f'https://forum.gamer.com.tw/{href}'

                        items.append({
                            'title': title[:100],
                            'summary': '',
                            'source': 'bahamut',
                            'time': datetime.now(timezone.utc).isoformat(),
                            'time_is_approximate': True,
                            'url': href,
                            'engagement': 0,
                            'is_hot': False,
                            'author': '',
                            'tags': ['bahamut'],
                            'lang': 'zh',
                            'platform_region': 'tw',
                        })
                    logger.info(f'Bahamut PW "{keyword}": {len(items)} total')
                except Exception as e:
                    logger.warning(f'Bahamut PW "{keyword}" failed: {e}')

            browser.close()
    except Exception as e:
        logger.warning(f'Bahamut Playwright failed: {e}')

    logger.info(f'Bahamut Playwright: fetched {len(items)} items')
    return items


def main():
    """Test all Playwright collectors."""
    print("Playwright collectors test")
    print("=" * 60)

    results = {
        'nga': fetch_nga_playwright(),
        'weibo': fetch_weibo_playwright(),
        'taptap': fetch_taptap_playwright(),
        'arca_live': fetch_arca_live_playwright(),
        'ruliweb': fetch_ruliweb_playwright(),
        'fivech': fetch_fivech_playwright(),
        'bahamut': fetch_bahamut_playwright(),
    }

    for source, items in results.items():
        status = 'OK' if items else 'EMPTY'
        print(f"\n[{status}] {source}: {len(items)} items")
        if items:
            print(f"  example: {items[0]['title'][:50]}...")

    total = sum(len(v) for v in results.values())
    print(f"\ntotal: {total} items")


if __name__ == '__main__':
    main()
