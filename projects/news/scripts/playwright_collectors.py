#!/usr/bin/env python3
"""
Playwright-based collectors for Morimens community news.
Fallback collectors when API methods fail.

Usage:
    python scripts/playwright_collectors.py

Each function returns a list of news items in the same format as aggregator.py:
    {
        "title": str,
        "summary": str,
        "source": str,
        "time": str (ISO 8601),
        "url": str,
        "engagement": int,
        "is_hot": bool,
        "author": str,
        "tags": list[str]
    }
"""

import json
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# Constants
HOURS_LOOKBACK = 48
TIMEOUT_MS = 30000  # 30 seconds


def _wait_for_cloudflare_challenge(page, max_wait_ms: int = 15000) -> bool:
    """Wait for Cloudflare challenge to complete."""
    try:
        # Check for Cloudflare challenge elements
        for _ in range(max_wait_ms // 500):
            if page.locator('#challenge-running, .cf-turnstile, #cf-wrapper').count() == 0:
                return True
            page.wait_for_timeout(500)
        return False
    except Exception:
        return True


def fetch_taptap_playwright() -> list[dict]:
    """
    Fetch TapTap community posts for Morimens using Playwright.
    URL: https://www.taptap.cn/app/239446 or search 忘却前夜

    Returns:
        List of news items with title, summary, engagement, author, time, url.
    """
    items = []
    app_id = '239446'

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                locale='zh-CN',
            )
            page = context.new_page()
            page.set_default_timeout(TIMEOUT_MS)

            # Try app page first, then search
            urls_to_try = [
                f'https://www.taptap.cn/app/{app_id}',
                'https://www.taptap.cn/search?keyword=%E5%BF%98%E5%8D%B4%E5%89%8D%E5%A4%9C',
            ]

            for url in urls_to_try:
                try:
                    page.goto(url, wait_until='networkidle')
                    page.wait_for_timeout(2000)

                    # Look for topic/post elements
                    # TapTap uses various selectors depending on page type
                    post_selectors = [
                        '.topic-item', '.post-item', '.moment-item',
                        '[class*="TopicItem"]', '[class*="PostItem"]',
                        '.review-item', '.app-topic-item',
                    ]

                    posts = []
                    for selector in post_selectors:
                        try:
                            found = page.locator(selector).all()
                            if found:
                                posts = found
                                break
                        except Exception:
                            continue

                    for post in posts[:20]:
                        try:
                            # Title
                            title_el = post.locator('.title, .topic-title, [class*="title"], h3, h4').first
                            title = title_el.text_content(strip=True) if title_el else ''

                            # Summary/content
                            summary_el = post.locator('.summary, .content, .text, [class*="content"], p').first
                            summary = summary_el.text_content(strip=True) if summary_el else ''

                            # Author
                            author_el = post.locator('.author, .user-name, [class*="author"], [class*="userName"]').first
                            author = author_el.text_content(strip=True) if author_el else ''

                            # Engagement (likes/comments)
                            engagement = 0
                            like_el = post.locator('.like-count, [class*="like"], .count').first
                            if like_el:
                                like_text = like_el.text_content(strip=True)
                                like_match = re.search(r'(\d+)', like_text)
                                if like_match:
                                    engagement = int(like_match.group(1))

                            # URL
                            link_el = post.locator('a').first
                            post_url = link_el.get_attribute('href') if link_el else ''
                            if post_url and not post_url.startswith('http'):
                                post_url = f'https://www.taptap.cn{post_url}'

                            # Time
                            time_el = post.locator('time, .time, [class*="time"]').first
                            time_str = time_el.get_attribute('datetime') if time_el else ''
                            if not time_str:
                                time_text = time_el.text_content(strip=True) if time_el else ''
                                # Parse relative time like "2小时前"
                                time_str = _parse_relative_time(time_text)

                            if title:
                                items.append({
                                    'title': title[:200],
                                    'summary': summary[:500],
                                    'source': 'taptap',
                                    'time': time_str or datetime.now(timezone.utc).isoformat(),
                                    'url': post_url or url,
                                    'engagement': engagement,
                                    'is_hot': engagement > 100,
                                    'author': author,
                                    'tags': [],
                                })
                        except Exception as e:
                            logger.debug(f'TapTap post parse error: {e}')
                            continue

                    if items:
                        break

                except Exception as e:
                    logger.warning(f'TapTap Playwright page {url} error: {e}')
                    continue

            browser.close()

        logger.info(f'TapTap Playwright: fetched {len(items)} items')

    except ImportError:
        logger.warning('Playwright not installed. Run: pip install playwright && playwright install chromium')
    except Exception as e:
        logger.warning(f'TapTap Playwright failed: {e}')

    return items


def fetch_nga_playwright() -> list[dict]:
    """
    Fetch NGA forum posts for Morimens using Playwright.
    URL: https://bbs.nga.cn/thread.php?fid=-447601

    NGA has Cloudflare protection. Playwright will wait for the challenge to pass.

    Returns:
        List of news items with title, summary, engagement, author, time, url.
    """
    items = []
    nga_fid = '-447601'
    cutoff = datetime.now(timezone.utc) - timedelta(hours=HOURS_LOOKBACK)

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                locale='zh-CN',
            )
            page = context.new_page()
            page.set_default_timeout(TIMEOUT_MS)

            url = f'https://bbs.nga.cn/thread.php?fid={nga_fid}'

            try:
                page.goto(url, wait_until='domcontentloaded')

                # Wait for Cloudflare challenge
                _wait_for_cloudflare_challenge(page, max_wait_ms=15000)
                page.wait_for_timeout(2000)

                # NGA thread list selectors
                thread_selectors = [
                    '.topicrow', '.topic', 'tr[id^="t_"]',
                    '[class*="topic"]', '.thread-item',
                ]

                threads = []
                for selector in thread_selectors:
                    try:
                        found = page.locator(selector).all()
                        if found:
                            threads = found
                            break
                    except Exception:
                        continue

                for thread in threads[:30]:
                    try:
                        # Title
                        title_el = thread.locator('a[id^="t_tt"], .title, a[href*="read.php"]').first
                        title = title_el.text_content(strip=True) if title_el else ''

                        # URL
                        thread_url = title_el.get_attribute('href') if title_el else ''
                        if thread_url and not thread_url.startswith('http'):
                            thread_url = f'https://bbs.nga.cn/{thread_url}'

                        # Author
                        author_el = thread.locator('.author, [class*="author"], a[href*="nuke.php"]').first
                        author = author_el.text_content(strip=True) if author_el else ''

                        # Reply count (engagement)
                        engagement = 0
                        reply_el = thread.locator('.reply, [class*="reply"], td').last
                        if reply_el:
                            reply_text = reply_el.text_content(strip=True)
                            reply_match = re.search(r'(\d+)', reply_text)
                            if reply_match:
                                engagement = int(reply_match.group(1))

                        # Time (NGA often shows relative time)
                        time_str = ''
                        time_el = thread.locator('time, .time, [class*="time"]').first
                        if time_el:
                            time_text = time_el.text_content(strip=True)
                            time_str = _parse_relative_time(time_text)

                        if title:
                            items.append({
                                'title': title[:200],
                                'summary': '',
                                'source': 'nga',
                                'time': time_str or datetime.now(timezone.utc).isoformat(),
                                'url': thread_url,
                                'engagement': engagement,
                                'is_hot': engagement > 50,
                                'author': author,
                                'tags': [],
                            })
                    except Exception as e:
                        logger.debug(f'NGA thread parse error: {e}')
                        continue

            except Exception as e:
                logger.warning(f'NGA Playwright page error: {e}')

            browser.close()

        logger.info(f'NGA Playwright: fetched {len(items)} items')

    except ImportError:
        logger.warning('Playwright not installed. Run: pip install playwright && playwright install chromium')
    except Exception as e:
        logger.warning(f'NGA Playwright failed: {e}')

    return items


def fetch_xiaohongshu_playwright() -> list[dict]:
    """
    Fetch Xiaohongshu (Little Red Book) search results using Playwright.
    URL: https://www.xiaohongshu.com/search_result?keyword=忘却前夜

    Note: Xiaohongshu has strong anti-bot measures. May require login for full results.

    Returns:
        List of news items with title, summary, engagement, author, time, url.
    """
    items = []

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                locale='zh-CN',
            )
            page = context.new_page()
            page.set_default_timeout(TIMEOUT_MS)

            url = 'https://www.xiaohongshu.com/search_result?keyword=%E5%BF%98%E5%8D%B4%E5%89%8D%E5%A4%9C'

            try:
                page.goto(url, wait_until='networkidle')
                page.wait_for_timeout(3000)

                # Wait for search results to load
                page.wait_for_selector('.note-item, [class*="NoteItem"], .search-result', timeout=10000)

                # Xiaohongshu note selectors
                note_selectors = [
                    '.note-item', '[class*="NoteItem"]', '.feeds-item',
                    '[class*="search-result"] .item',
                ]

                notes = []
                for selector in note_selectors:
                    try:
                        found = page.locator(selector).all()
                        if found:
                            notes = found
                            break
                    except Exception:
                        continue

                for note in notes[:20]:
                    try:
                        # Title
                        title_el = note.locator('.title, [class*="title"], h3, h4').first
                        title = title_el.text_content(strip=True) if title_el else ''

                        # Summary
                        summary_el = note.locator('.desc, [class*="desc"], .content').first
                        summary = summary_el.text_content(strip=True) if summary_el else ''

                        # Author
                        author_el = note.locator('.author, [class*="author"], .user-name').first
                        author = author_el.text_content(strip=True) if author_el else ''

                        # Engagement (likes)
                        engagement = 0
                        like_el = note.locator('.like, [class*="like"], .count').first
                        if like_el:
                            like_text = like_el.text_content(strip=True)
                            like_match = re.search(r'(\d+)', like_text)
                            if like_match:
                                engagement = int(like_match.group(1))

                        # URL
                        link_el = note.locator('a').first
                        note_url = link_el.get_attribute('href') if link_el else ''
                        if note_url and not note_url.startswith('http'):
                            note_url = f'https://www.xiaohongshu.com{note_url}'

                        if title:
                            items.append({
                                'title': title[:200],
                                'summary': summary[:500],
                                'source': 'xiaohongshu',
                                'time': datetime.now(timezone.utc).isoformat(),
                                'url': note_url or url,
                                'engagement': engagement,
                                'is_hot': engagement > 500,
                                'author': author,
                                'tags': ['xiaohongshu'],
                            })
                    except Exception as e:
                        logger.debug(f'Xiaohongshu note parse error: {e}')
                        continue

            except Exception as e:
                logger.warning(f'Xiaohongshu Playwright page error: {e}')

            browser.close()

        logger.info(f'Xiaohongshu Playwright: fetched {len(items)} items')

    except ImportError:
        logger.warning('Playwright not installed. Run: pip install playwright && playwright install chromium')
    except Exception as e:
        logger.warning(f'Xiaohongshu Playwright failed: {e}')

    return items


def fetch_weibo_playwright() -> list[dict]:
    """
    Fetch Weibo search results using Playwright.
    URL: https://s.weibo.com/weibo?q=忘却前夜

    Returns:
        List of news items with title, summary, engagement, author, time, url.
    """
    items = []

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                locale='zh-CN',
            )
            page = context.new_page()
            page.set_default_timeout(TIMEOUT_MS)

            url = 'https://s.weibo.com/weibo?q=%E5%BF%98%E5%8D%B4%E5%89%8D%E5%A4%9C'

            try:
                page.goto(url, wait_until='networkidle')
                page.wait_for_timeout(2000)

                # Wait for Weibo results
                page.wait_for_selector('.card-wrap, [class*="card"]', timeout=10000)

                # Weibo post selectors
                post_selectors = [
                    '.card-wrap[action-type="feed_list_item"]',
                    '.card-feed', '[class*="feed-item"]',
                    '.card-wrap',
                ]

                posts = []
                for selector in post_selectors:
                    try:
                        found = page.locator(selector).all()
                        if found:
                            posts = found
                            break
                    except Exception:
                        continue

                for post in posts[:25]:
                    try:
                        # Content/text
                        content_el = post.locator('.txt, [node-type="feed_list_content"]').first
                        content = content_el.text_content(strip=True) if content_el else ''

                        # Title (first 100 chars of content)
                        title = content[:100] if content else ''

                        # Author
                        author_el = post.locator('.name, [class*="name"], a[nick-name]').first
                        author = author_el.text_content(strip=True) if author_el else ''
                        if not author:
                            author = author_el.get_attribute('nick-name') if author_el else ''

                        # Engagement (reposts, comments, likes)
                        engagement = 0
                        action_els = post.locator('.card-act li, [class*="action"]')
                        for action_el in action_els.all():
                            action_text = action_el.text_content(strip=True)
                            action_match = re.search(r'(\d+)', action_text)
                            if action_match:
                                engagement += int(action_match.group(1))

                        # URL
                        link_el = post.locator('a[href*="weibo.com"]').first
                        post_url = link_el.get_attribute('href') if link_el else ''

                        # Time
                        time_str = ''
                        time_el = post.locator('.from, time, [class*="time"]').first
                        if time_el:
                            time_text = time_el.text_content(strip=True)
                            # Weibo shows relative time like "5分钟前"
                            time_str = _parse_relative_time(time_text)

                        if title:
                            items.append({
                                'title': title[:200],
                                'summary': content[:500],
                                'source': 'weibo',
                                'time': time_str or datetime.now(timezone.utc).isoformat(),
                                'url': post_url or url,
                                'engagement': engagement,
                                'is_hot': engagement > 500,
                                'author': author,
                                'tags': ['weibo'],
                            })
                    except Exception as e:
                        logger.debug(f'Weibo post parse error: {e}')
                        continue

            except Exception as e:
                logger.warning(f'Weibo Playwright page error: {e}')

            browser.close()

        logger.info(f'Weibo Playwright: fetched {len(items)} items')

    except ImportError:
        logger.warning('Playwright not installed. Run: pip install playwright && playwright install chromium')
    except Exception as e:
        logger.warning(f'Weibo Playwright failed: {e}')

    return items


def _parse_relative_time(time_text: str) -> Optional[str]:
    """
    Parse relative time text like '2小时前', '5分钟前', '昨天' to ISO 8601.
    Returns None if parsing fails.
    """
    if not time_text:
        return None

    now = datetime.now(timezone.utc)
    time_text = time_text.strip()

    # Minutes ago: "5分钟前"
    min_match = re.search(r'(\d+)\s*分钟', time_text)
    if min_match:
        minutes = int(min_match.group(1))
        result = now - timedelta(minutes=minutes)
        return result.isoformat()

    # Hours ago: "2小时前"
    hour_match = re.search(r'(\d+)\s*小时', time_text)
    if hour_match:
        hours = int(hour_match.group(1))
        result = now - timedelta(hours=hours)
        return result.isoformat()

    # Days ago: "3天前"
    day_match = re.search(r'(\d+)\s*天', time_text)
    if day_match:
        days = int(day_match.group(1))
        result = now - timedelta(days=days)
        return result.isoformat()

    # Yesterday: "昨天"
    if '昨天' in time_text or '昨日' in time_text:
        result = now - timedelta(days=1)
        return result.isoformat()

    # Just now: "刚刚"
    if '刚刚' in time_text or '刚刚' in time_text:
        return now.isoformat()

    return None


def main():
    """Run all collectors and output JSON to stdout."""
    all_items = []

    collectors = [
        ('TapTap', fetch_taptap_playwright),
        ('NGA', fetch_nga_playwright),
        ('Xiaohongshu', fetch_xiaohongshu_playwright),
        ('Weibo', fetch_weibo_playwright),
    ]

    for name, collector in collectors:
        try:
            items = collector()
            all_items.extend(items)
            logger.info(f'{name}: {len(items)} items')
        except Exception as e:
            logger.error(f'{name} collector crashed: {e}')

    output = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'total_items': len(all_items),
        'items': all_items,
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
