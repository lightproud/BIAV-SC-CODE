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
import sys
from urllib.parse import quote
from datetime import datetime, timedelta, timezone, UTC
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import news_common  # 时间归一单一真源（H4）

# 微博 Playwright 路径的关键词与滚动深度。关键词与 global_collectors.KEYWORDS['zh']
# 保持一致（简繁两个）——原实现只硬编码了简体那一个。滚动 6 轮：移动版每屏约 10 条，
# 够把单关键词一轮的可见面从「首屏 20 条硬截」提到百条量级。
WEIBO_KEYWORDS = ('忘却前夜', '忘卻前夜')
WEIBO_MAX_SCROLLS = 6

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

try:
    from collection_state import get_lookback_hours
    HOURS_LOOKBACK = get_lookback_hours()
except ImportError:
    HOURS_LOOKBACK = 24
TIMEOUT_MS = 30000


def _parse_relative_time(text: str) -> tuple[str, bool]:
    """Parse relative/absolute time strings into ISO datetime.

    委托 news_common.parse_relative_time（H4 收敛后的单一真源）。
    Returns (iso_string, is_approximate).
    """
    return news_common.parse_relative_time(text)


# ── 纯解析函数（从各 fetch_* 抽出，对 DOM 元素接口做映射，便于单测） ──────────
# 这些函数只依赖被传入对象的 query_selector / inner_text / get_attribute 接口，
# 不触碰网络或浏览器，保持原 fetch_* 内联逻辑的行为不变。

def _parse_weibo_article(article) -> dict:
    """从一个 Weibo article 元素解析出 item dict；不合格返回 None。"""
    text_el = article.query_selector('.weibo-text, .content, p')
    if not text_el:
        return None
    text = text_el.inner_text().strip()
    if len(text) < 10:
        return None

    time_el = article.query_selector('time, [class*="time"], [class*="date"]')
    time_text = ''
    if time_el:
        time_text = time_el.get_attribute('datetime') or time_el.inner_text().strip()
    parsed_time, time_approx = _parse_relative_time(time_text)

    link_el = article.query_selector('a[href*="status"]')
    href = ''
    if link_el:
        href = link_el.get_attribute('href') or ''
        if href and not href.startswith('http'):
            href = f'https://m.weibo.cn{href}'

    # author / engagement 原为硬编码 ''/0——归档里 weibo 全部条目作者空、互动量 0
    # 就是这么来的（也因此这个源在社区报告里排不了序）。移动版 article 内有昵称与
    # 转发/评论/点赞三个计数，能取就取，取不到再回落原默认值。
    author = ''
    author_el = article.query_selector('.m-text-cut, [class*="name"], header a')
    if author_el:
        author = (author_el.inner_text() or '').strip()[:40]

    engagement = 0
    try:
        foot = article.query_selector('footer, [class*="toolbar"], [class*="card-act"]')
        if foot:
            nums = re.findall(r'\d[\d.]*\s*万?', foot.inner_text() or '')
            for n in nums:
                n = n.strip()
                engagement += int(float(n[:-1]) * 10000) if n.endswith('万') else int(float(n))
    except (ValueError, AttributeError):
        engagement = 0

    item = {
        'title': text[:80],
        'summary': text[:500],
        'source': 'weibo',
        'time': parsed_time,
        'url': href,
        'engagement': engagement,
        'is_hot': engagement > 500,
        'author': author,
        'tags': ['weibo'],
    }
    if time_approx:
        item['time_is_approximate'] = True
    return item


def _parse_taptap_card(card) -> dict:
    """从一个 TapTap card 元素解析出 item dict；无有效 /app/ 链接返回 None。"""
    title_el = card.query_selector('.app-name, .title, h3')
    title = title_el.inner_text().strip() if title_el else ''

    link_el = card.query_selector('a[href*="/app/"]')
    href = link_el.get_attribute('href') if link_el else ''

    if href and '/app/' in href:
        if not href.startswith('http'):
            href = f'https://www.taptap.cn{href}'
        return {
            'title': f'[TapTap] {title or "忘却前夜"}',
            'summary': '',
            'source': 'taptap',
            'time': datetime.now(UTC).isoformat(),
            'time_is_approximate': True,
            'url': href,
            'engagement': 0,
            'is_hot': False,
            'author': '',
            'tags': ['taptap'],
        }
    return None


_KST = timezone(timedelta(hours=9))


def _parse_arca_time(text: str) -> tuple[str, bool]:
    """解析 arca.live 列表 `.col-time` 文本，返回 (ISO, is_approximate)。

    arca.live 是韩国站点，当日帖只显示**韩国墙钟** "HH:MM"（KST=UTC+9）。共享的
    parse_relative_time 把裸 "HH:MM" 按 UTC 解读：韩国傍晚 20:00 的帖被记成 20:00 UTC,
    而彼时 UTC 才 11:00 —— 判定为「未来」再回退一整天，时间戳直接偏早约 32 小时。
    后果是该帖被 24h 时窗过滤掉、或落进前一天的归档桶（归档按北京日分桶）。
    故 "HH:MM" 按 KST 构造；其余格式（"MM.DD" 日期级 / 相对时间 / ISO）仍走共享真源。
    """
    s = (text or '').strip()
    m = re.match(r'^(\d{1,2}):(\d{2})$', s)
    if m:
        now_kst = datetime.now(_KST)
        try:
            dt = now_kst.replace(hour=int(m.group(1)), minute=int(m.group(2)),
                                 second=0, microsecond=0)
        except ValueError:
            return _parse_relative_time(s)
        if dt > now_kst:  # 显示时刻晚于当前韩国时间 = 昨天的帖
            dt -= timedelta(days=1)
        return dt.isoformat(), False
    return _parse_relative_time(s)


def _parse_arca_row(row, mode: str) -> dict:
    """从一个 Arca.live .vrow 元素解析出 item dict；无标题返回 None。"""
    title_el = row.query_selector('.title')
    time_el = row.query_selector('.col-time')
    link_el = row.query_selector('a.vrow-top')
    if not title_el:
        return None

    title = title_el.inner_text().strip()
    href = link_el.get_attribute('href') if link_el else ''
    time_text = time_el.inner_text().strip() if time_el else ''

    if not title:
        return None
    if href and not href.startswith('http'):
        href = f'https://arca.live{href}'

    parsed_time, time_approx = _parse_arca_time(time_text)
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
    return item


def _parse_ruliweb_link(link) -> dict:
    """从一个 Ruliweb a.subject_link 元素解析出 item dict；无标题返回 None。"""
    title = link.inner_text().strip()
    href = link.get_attribute('href') or ''
    if not title:
        return None
    if not href.startswith('http'):
        href = f'https://bbs.ruliweb.com{href}'
    return {
        'title': title[:100],
        'summary': '',
        'source': 'ruliweb',
        'time': datetime.now(UTC).isoformat(),
        'time_is_approximate': True,
        'url': href,
        'engagement': 0,
        'is_hot': False,
        'author': '',
        'tags': ['ruliweb'],
        'lang': 'ko',
        'platform_region': 'kr',
    }


def _parse_bahamut_row(row) -> dict:
    """从一个 Bahamut 搜索结果行元素解析出 item dict；无标题返回 None。"""
    title_el = row.query_selector('.b-list__main__title, a[href*="C.php"]')
    if not title_el:
        return None
    title = title_el.inner_text().strip()
    href = title_el.get_attribute('href') or ''
    if not title:
        return None
    if href and not href.startswith('http'):
        href = f'https://forum.gamer.com.tw/{href}'
    return {
        'title': title[:100],
        'summary': '',
        'source': 'bahamut',
        'time': datetime.now(UTC).isoformat(),
        'time_is_approximate': True,
        'url': href,
        'engagement': 0,
        'is_hot': False,
        'author': '',
        'tags': ['bahamut'],
        'lang': 'zh',
        'platform_region': 'tw',
    }


def fetch_weibo_playwright() -> list[dict]:
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

            # 移动版无需登录。两个关键词都要走：原实现只硬编码了简体「忘却前夜」，
            # 而 HTTP 路径的 KEYWORDS['zh'] 是简繁两个，繁体那半在 Playwright 路径
            # 一直没被采集过。
            seen_urls: set[str] = set()
            for keyword in WEIBO_KEYWORDS:
                q = quote(keyword)
                url = f'https://m.weibo.cn/search?containerid=100103type%3D1%26q%3D{q}'
                logger.info(f'微博: 访问移动版 "{keyword}"')
                try:
                    page.goto(url, wait_until='networkidle')
                except Exception as exc:
                    logger.warning(f'微博 "{keyword}" 打开失败: {type(exc).__name__}: {exc}')
                    continue
                page.wait_for_timeout(3000)

                # 滚动触发懒加载。原实现只取首屏并硬截 articles[:20]，
                # 单轮上限 20 条——2026-08-15~18 每日归档稳定停在 10 条上下，
                # 正是首屏那点量。连续两轮无新增即判到底。
                stale = 0
                for _ in range(WEIBO_MAX_SCROLLS):
                    before = len(page.query_selector_all('article'))
                    try:
                        page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                    except Exception:
                        break
                    page.wait_for_timeout(1500)
                    if len(page.query_selector_all('article')) == before:
                        stale += 1
                        if stale >= 2:
                            break
                    else:
                        stale = 0

                articles = page.query_selector_all('article')
                logger.info(f'微博 "{keyword}": DOM 上找到 {len(articles)} 条')

                kept = 0
                for article in articles:
                    try:
                        item = _parse_weibo_article(article)
                        if item is None:
                            continue
                        # 跨关键词去重：简繁两轮会大量重合。url 为空时回退到正文，
                        # 否则空 url 条目会每轮重复计入（与 taptap 同型的坑）。
                        key = item.get('url') or item.get('summary', '')[:80]
                        if key in seen_urls:
                            continue
                        seen_urls.add(key)
                        items.append(item)
                        kept += 1
                    # 逐条解析是 best-effort（页面结构常变，单条失败不该毁掉整轮），但
                    # 原先的裸 `except Exception: continue` 连解析器**自己写崩**都一起
                    # 吞掉——结构改版导致的全军覆没与「今天就是没几条」长得一模一样。
                    # 照旧不中断，但出声：条数对不上时日志里有据可查。
                    except Exception as exc:
                        logger.debug(f'跳过一条解析失败的article: {type(exc).__name__}: {exc}')
                        continue
                logger.info(f'微博 "{keyword}": 解析出 {kept} 条新条目')

            browser.close()
    except Exception as e:
        logger.warning(f'微博 Playwright 失败: {e}')

    logger.info(f'微博 Playwright: fetched {len(items)} items')
    return items


def fetch_taptap_playwright() -> list[dict]:
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
            logger.info('TapTap: 访问搜索页')
            page.goto(url, wait_until='networkidle')
            page.wait_for_timeout(3000)

            # 尝试获取游戏卡片
            cards = page.query_selector_all('.app-card, .search-item, [class*="app"]')
            logger.info(f'TapTap: 找到 {len(cards)} 个卡片')

            for card in cards[:10]:
                try:
                    item = _parse_taptap_card(card)
                    if item is not None:
                        items.append(item)
                # 逐条解析是 best-effort（页面结构常变，单条失败不该毁掉整轮），但
                # 原先的裸 `except Exception: continue` 连解析器**自己写崩**都一起
                # 吞掉——结构改版导致的全军覆没与「今天就是没几条」长得一模一样。
                # 照旧不中断，但出声：条数对不上时日志里有据可查。
                except Exception as exc:
                    logger.debug(f'跳过一条解析失败的card: {type(exc).__name__}: {exc}')
                    continue

            browser.close()
    except Exception as e:
        logger.warning(f'TapTap Playwright 失败: {e}')

    logger.info(f'TapTap Playwright: fetched {len(items)} items')
    return items


# ── Korean platforms ──────────────────────────────────────────────────────

def fetch_arca_live_playwright() -> list[dict]:
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
                        item = _parse_arca_row(row, mode)
                        if item is not None:
                            items.append(item)
                    logger.info(f'Arca.live PW mode={mode or "latest"}: {len(items)} total')
                except Exception as e:
                    logger.warning(f'Arca.live PW mode={mode or "latest"} failed: {e}')

            browser.close()
    except Exception as e:
        logger.warning(f'Arca.live Playwright failed: {e}')

    logger.info(f'Arca.live Playwright: fetched {len(items)} items')
    return items


def fetch_ruliweb_playwright() -> list[dict]:
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
                        item = _parse_ruliweb_link(link)
                        if item is not None:
                            items.append(item)
                    logger.info(f'Ruliweb PW "{keyword}": {len(items)} total')
                except Exception as e:
                    logger.warning(f'Ruliweb PW "{keyword}" failed: {e}')

            browser.close()
    except Exception as e:
        logger.warning(f'Ruliweb Playwright failed: {e}')

    logger.info(f'Ruliweb Playwright: fetched {len(items)} items')
    return items


# ── Japanese platforms ────────────────────────────────────────────────────

def fetch_bahamut_playwright() -> list[dict]:
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
                        item = _parse_bahamut_row(row)
                        if item is not None:
                            items.append(item)
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
        'weibo': fetch_weibo_playwright(),
        'taptap': fetch_taptap_playwright(),
        'arca_live': fetch_arca_live_playwright(),
        'ruliweb': fetch_ruliweb_playwright(),
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
