#!/usr/bin/env python3
"""
Playwright-based collectors for Morimens community news.
Final fixed version based on actual page structure analysis.

Tested and working:
- NGA: ✅ Using .topicrow selector, TD 1 for title
- Weibo: ✅ Using article selector on mobile version
- Xiaohongshu: ⚠️ Requires login/special handling
- TapTap: ⚠️ App page returns 405, need alternative
"""

import json
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

HOURS_LOOKBACK = 24
TIMEOUT_MS = 30000


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
                    
                    # TD 3: 作者
                    author = ''
                    author_text = tds[3].inner_text()
                    lines = author_text.split('\n')
                    if len(lines) > 1:
                        author = lines[-1].strip()
                    
                    if len(title) < 3:
                        continue
                    
                    items.append({
                        'title': title[:100],
                        'summary': '',
                        'source': 'nga',
                        'time': datetime.now(timezone.utc).isoformat(),
                        'url': href,
                        'engagement': reply_count,
                        'is_hot': reply_count > 50,
                        'author': author,
                        'tags': ['nga'],
                    })
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
                    
                    # 链接
                    link_el = article.query_selector('a[href*="status"]')
                    href = ''
                    if link_el:
                        href = link_el.get_attribute('href') or ''
                        if href and not href.startswith('http'):
                            href = f'https://m.weibo.cn{href}'
                    
                    items.append({
                        'title': text[:80],
                        'summary': text[:500],
                        'source': 'weibo',
                        'time': datetime.now(timezone.utc).isoformat(),
                        'url': href,
                        'engagement': 0,
                        'is_hot': False,
                        'author': '',
                        'tags': ['weibo'],
                    })
                except:
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
                            'url': href,
                            'engagement': 0,
                            'is_hot': False,
                            'author': '',
                            'tags': ['taptap'],
                        })
                except:
                    continue
            
            browser.close()
    except Exception as e:
        logger.warning(f'TapTap Playwright 失败: {e}')
    
    logger.info(f'TapTap Playwright: fetched {len(items)} items')
    return items


def fetch_xiaohongshu_playwright() -> List[Dict]:
    """
    Fetch Xiaohongshu search results.
    Note: Page requires login or has anti-bot measures.
    Returns placeholder for now.
    """
    logger.warning('小红书需要登录或有反爬措施，暂跳过')
    return []


def main():
    """Test all Playwright collectors."""
    print("测试 Playwright 采集器 (修复版)")
    print("=" * 60)
    
    results = {
        'nga': fetch_nga_playwright(),
        'weibo': fetch_weibo_playwright(),
        'taptap': fetch_taptap_playwright(),
        'xiaohongshu': fetch_xiaohongshu_playwright(),
    }
    
    for source, items in results.items():
        status = '✅' if items else '⚠️'
        print(f"\n{status} {source}: {len(items)} items")
        if items:
            print(f"  示例: {items[0]['title'][:50]}...")
    
    total = sum(len(v) for v in results.values())
    print(f"\n总计: {total} items")


if __name__ == '__main__':
    main()
