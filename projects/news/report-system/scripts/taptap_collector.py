#!/usr/bin/env python3
"""
TapTap 社区采集器 - Playwright 无头浏览器方案

TapTap 已废弃 webapiv2 全部端点（均返回404），页面使用 Nuxt 客户端渲染。
本模块通过 headless Chromium 拦截网络响应或提取渲染后 DOM 来获取社区帖子和玩家评价。

目标页面:
  帖子: https://www.taptap.cn/app/233553/topic?type=official
  评价: https://www.taptap.cn/app/233553/review?type=new
"""

import asyncio
import json
import logging
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger("collector.taptap")

APP_ID = "233553"
TOPIC_URL = f"https://www.taptap.cn/app/{APP_ID}/topic?type=official"
REVIEW_URL = f"https://www.taptap.cn/app/{APP_ID}/review?type=new"

BASE_DIR = Path(__file__).resolve().parent.parent
STATE_PATH = BASE_DIR / "data" / "state.json"
DATA_DIR = BASE_DIR / "data"


# ─── 增量状态 ─────────────────────────────────────────────────

def _load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_state(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ─── 数字解析 ─────────────────────────────────────────────────

def _parse_num(s: Any) -> int:
    """从字符串或数字中提取整数（处理 '1.2万' 等格式）。"""
    if isinstance(s, (int, float)):
        return int(s)
    if not s:
        return 0
    text = str(s).replace(",", "")
    # 处理 '万' 单位
    m = re.search(r"([\d.]+)\s*万", text)
    if m:
        return int(float(m.group(1)) * 10000)
    m = re.search(r"[\d]+", text)
    return int(m.group()) if m else 0


# ─── 帖子页 ───────────────────────────────────────────────────

def _parse_topic_api_body(body: dict) -> list[dict]:
    """从各种可能的 API 响应结构中提取帖子数据。"""
    data = body.get("data") or body

    # 尝试常见列表字段
    topic_list = None
    if isinstance(data, list):
        topic_list = data
    elif isinstance(data, dict):
        for key in ("list", "topics", "moments", "items", "records"):
            if isinstance(data.get(key), list):
                topic_list = data[key]
                break
        if not topic_list:
            # 深一层搜索
            for v in data.values():
                if isinstance(v, dict):
                    for key in ("list", "topics", "moments", "items"):
                        if isinstance(v.get(key), list) and v[key]:
                            topic_list = v[key]
                            break
                if topic_list:
                    break

    if not isinstance(topic_list, list) or not topic_list:
        return []

    results = []
    for item in topic_list:
        if not isinstance(item, dict):
            continue

        title = item.get("title") or item.get("summary", "")[:100]
        if not title:
            continue

        # 时间戳（秒级或毫秒级）
        ts = item.get("created_time") or item.get("created_at") or item.get("publish_time") or 0
        if isinstance(ts, str):
            ts = int(ts) if ts.isdigit() else 0
        if ts > 1e12:  # 毫秒转秒
            ts = ts // 1000
        created = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else datetime.now(timezone.utc)

        like_count = _parse_num(item.get("like_count") or item.get("likes") or item.get("vote_count") or 0)
        comment_count = _parse_num(item.get("comment_count") or item.get("comments") or item.get("reply_count") or 0)

        item_id = str(item.get("id") or item.get("moment_id") or item.get("topic_id") or "")
        url = (
            item.get("share_url")
            or item.get("url")
            or (f"https://www.taptap.cn/moment/{item_id}" if item_id else "")
        )

        user = item.get("user") or item.get("author") or {}
        author = user.get("name") or user.get("username") or "" if isinstance(user, dict) else ""

        results.append({
            "title": str(title).strip(),
            "summary": str(item.get("summary") or item.get("intro") or "")[:300].strip(),
            "like_count": like_count,
            "comment_count": comment_count,
            "created": created.isoformat(),
            "url": url,
            "author": str(author),
            "item_id": item_id,
        })

    return results


async def _extract_topics(page) -> list[dict]:
    """访问帖子页，优先拦截网络响应，fallback 到 DOM 提取。"""
    captured: list[tuple[str, dict]] = []

    async def handle_response(response):
        url = response.url
        if response.status != 200:
            return
        ct = response.headers.get("content-type", "")
        if "json" not in ct:
            return
        # 匹配 TapTap 内部 API（topic/moment/feed 等路径）
        if not re.search(r"/(topic|moment|feed|community|post)", url):
            return
        try:
            body = await response.json()
            captured.append((url, body))
        except Exception:
            pass

    page.on("response", handle_response)

    try:
        await page.goto(TOPIC_URL, wait_until="networkidle", timeout=60000)
    except Exception as e:
        logger.warning(f"TapTap topic page load warning: {e}")

    # 额外等待 JS 异步渲染
    await page.wait_for_timeout(3000)

    # 1. 从拦截的 API 响应中提取
    for api_url, body in captured:
        items = _parse_topic_api_body(body)
        if items:
            logger.info(f"TapTap topics: {len(items)} from API {api_url}")
            return items

    # 2. Fallback: DOM 提取
    logger.info("TapTap: API interception yielded no topics, falling back to DOM")
    return await _extract_topics_dom(page)


async def _extract_topics_dom(page) -> list[dict]:
    """从渲染后的 DOM 中提取帖子（保存 HTML 用于调试）。"""
    content = await page.content()
    debug_path = DATA_DIR / "debug_taptap_topic.html"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        debug_path.write_text(content, encoding="utf-8")
        logger.info(f"TapTap: saved topic DOM ({len(content)} chars) to {debug_path}")
    except Exception:
        pass

    result = await page.evaluate("""() => {
        // 常见 TapTap 帖子容器选择器（按优先级排列）
        const candidateSelectors = [
            '[class*="post-item"]',
            '[class*="topic-item"]',
            '[class*="moment-item"]',
            '[class*="community-post"]',
            '[class*="feed-item"]',
            '[class*="list-item"]',
            'article',
        ];

        let postElements = [];
        for (const sel of candidateSelectors) {
            const els = document.querySelectorAll(sel);
            if (els.length >= 3) {  // 至少3条才认为找到了
                postElements = Array.from(els).slice(0, 30);
                break;
            }
        }

        return postElements.map(el => {
            const titleEl = el.querySelector(
                'h1, h2, h3, h4, [class*="title"], [class*="heading"], [class*="name"]'
            );
            const timeEl = el.querySelector('time, [class*="time"], [class*="date"]');
            const likeEl = el.querySelector('[class*="like"], [class*="thumb"], [class*="vote"]');
            const commentEl = el.querySelector('[class*="comment"], [class*="reply"]');
            const linkEl = el.querySelector('a[href*="/moment/"], a[href*="/topic/"], a[href*="/post/"]')
                        || el.querySelector('a[href]');
            const authorEl = el.querySelector(
                '[class*="username"], [class*="user-name"], [class*="author"], [class*="nickname"]'
            );

            return {
                title: titleEl ? titleEl.innerText.trim() : '',
                time_str: timeEl
                    ? (timeEl.getAttribute('datetime') || timeEl.innerText.trim())
                    : '',
                likes: likeEl ? likeEl.innerText.trim() : '0',
                comments: commentEl ? commentEl.innerText.trim() : '0',
                url: linkEl ? linkEl.href : '',
                author: authorEl ? authorEl.innerText.trim() : '',
            };
        });
    }""")

    items = []
    for r in result or []:
        if not r.get("title"):
            continue
        items.append({
            "title": r["title"],
            "summary": "",
            "like_count": _parse_num(r.get("likes")),
            "comment_count": _parse_num(r.get("comments")),
            "created": datetime.now(timezone.utc).isoformat(),
            "url": r.get("url", ""),
            "author": r.get("author", ""),
            "item_id": "",
        })

    if not items:
        logger.warning("TapTap: DOM extraction found no topic elements")
    return items


# ─── 评价页 ───────────────────────────────────────────────────

def _parse_review_api_body(body: dict) -> list[dict]:
    """从 API 响应中提取评价数据。"""
    data = body.get("data") or body

    review_list = None
    if isinstance(data, list):
        review_list = data
    elif isinstance(data, dict):
        for key in ("list", "reviews", "rating_list", "items", "records", "comments"):
            if isinstance(data.get(key), list):
                review_list = data[key]
                break
        if not review_list:
            for v in data.values():
                if isinstance(v, dict):
                    for key in ("list", "reviews", "rating_list"):
                        if isinstance(v.get(key), list) and v[key]:
                            review_list = v[key]
                            break
                if review_list:
                    break

    if not isinstance(review_list, list) or not review_list:
        return []

    results = []
    for item in review_list:
        if not isinstance(item, dict):
            continue

        content = (
            item.get("comment")
            or item.get("content")
            or item.get("text")
            or item.get("body")
            or ""
        )
        if not content:
            continue

        score = item.get("score") or item.get("rating") or item.get("stars") or 0

        ts = item.get("created_time") or item.get("created_at") or 0
        if isinstance(ts, str):
            ts = int(ts) if ts.isdigit() else 0
        if ts > 1e12:
            ts = ts // 1000
        created = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else datetime.now(timezone.utc)

        like_count = _parse_num(item.get("like_count") or item.get("likes") or 0)

        item_id = str(item.get("id") or item.get("review_id") or "")
        url = item.get("share_url") or (
            f"https://www.taptap.cn/review/{item_id}" if item_id else ""
        )

        user = item.get("user") or item.get("author") or {}
        author = user.get("name") or user.get("username") or "" if isinstance(user, dict) else ""

        star_str = f"{'★' * int(score)}{'☆' * max(0, 5 - int(score))} " if score else ""
        title = f"{star_str}{str(content)[:60]}".strip()

        results.append({
            "title": title,
            "summary": str(content)[:300].strip(),
            "like_count": like_count,
            "comment_count": 0,
            "created": created.isoformat(),
            "url": url,
            "author": str(author),
            "item_id": item_id,
        })

    return results


async def _extract_reviews(page) -> list[dict]:
    """访问评价页，优先拦截网络响应，fallback 到 DOM 提取。"""
    captured: list[tuple[str, dict]] = []

    async def handle_response(response):
        url = response.url
        if response.status != 200:
            return
        ct = response.headers.get("content-type", "")
        if "json" not in ct:
            return
        if not re.search(r"/(review|rating|comment|score)", url):
            return
        try:
            body = await response.json()
            captured.append((url, body))
        except Exception:
            pass

    page.on("response", handle_response)

    try:
        await page.goto(REVIEW_URL, wait_until="networkidle", timeout=60000)
    except Exception as e:
        logger.warning(f"TapTap review page load warning: {e}")

    await page.wait_for_timeout(3000)

    for api_url, body in captured:
        items = _parse_review_api_body(body)
        if items:
            logger.info(f"TapTap reviews: {len(items)} from API {api_url}")
            return items

    logger.info("TapTap: API interception yielded no reviews, falling back to DOM")
    return await _extract_reviews_dom(page)


async def _extract_reviews_dom(page) -> list[dict]:
    """从渲染后的 DOM 中提取评价（保存 HTML 用于调试）。"""
    content = await page.content()
    debug_path = DATA_DIR / "debug_taptap_review.html"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        debug_path.write_text(content, encoding="utf-8")
        logger.info(f"TapTap: saved review DOM ({len(content)} chars) to {debug_path}")
    except Exception:
        pass

    result = await page.evaluate("""() => {
        const candidateSelectors = [
            '[class*="review-item"]',
            '[class*="rating-item"]',
            '[class*="comment-item"]',
            '[class*="review-card"]',
            '[class*="comment-card"]',
        ];

        let els = [];
        for (const sel of candidateSelectors) {
            const found = document.querySelectorAll(sel);
            if (found.length >= 3) {
                els = Array.from(found).slice(0, 30);
                break;
            }
        }

        return els.map(el => {
            const contentEl = el.querySelector(
                '[class*="content"], [class*="text"], [class*="body"], p'
            );
            const timeEl = el.querySelector('time, [class*="time"], [class*="date"]');
            const likeEl = el.querySelector('[class*="like"], [class*="thumb"]');
            const authorEl = el.querySelector(
                '[class*="username"], [class*="user-name"], [class*="author"], [class*="nickname"]'
            );
            const starEl = el.querySelector('[class*="star"], [class*="score"], [class*="rating"]');
            const linkEl = el.querySelector('a[href*="/review/"]') || el.querySelector('a[href]');

            return {
                content: contentEl ? contentEl.innerText.trim() : '',
                time_str: timeEl
                    ? (timeEl.getAttribute('datetime') || timeEl.innerText.trim())
                    : '',
                likes: likeEl ? likeEl.innerText.trim() : '0',
                author: authorEl ? authorEl.innerText.trim() : '',
                score: starEl ? starEl.innerText.trim() : '',
                url: linkEl ? linkEl.href : '',
            };
        });
    }""")

    items = []
    for r in result or []:
        content_text = r.get("content", "").strip()
        if not content_text:
            continue
        items.append({
            "title": content_text[:60],
            "summary": content_text[:300],
            "like_count": _parse_num(r.get("likes")),
            "comment_count": 0,
            "created": datetime.now(timezone.utc).isoformat(),
            "url": r.get("url", ""),
            "author": r.get("author", ""),
            "item_id": "",
        })

    if not items:
        logger.warning("TapTap: DOM extraction found no review elements")
    return items


# ─── 主入口 ───────────────────────────────────────────────────

async def collect(cutoff: datetime | None = None) -> tuple[list[dict], list[dict]]:
    """
    启动 headless Chromium，采集帖子和评价。

    返回 (topic_items, review_items)，每条均为 collector._make_item() 兼容的字典。
    """
    from playwright.async_api import async_playwright

    if cutoff is None:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    topic_raw: list[dict] = []
    review_raw: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
            locale="zh-CN",
        )

        try:
            # 帖子页
            page = await context.new_page()
            try:
                topic_raw = await _extract_topics(page)
            except Exception as e:
                logger.warning(f"TapTap topics extraction failed: {e}")
            finally:
                await page.close()

            # 评价页
            page2 = await context.new_page()
            try:
                review_raw = await _extract_reviews(page2)
            except Exception as e:
                logger.warning(f"TapTap reviews extraction failed: {e}")
            finally:
                await page2.close()

        finally:
            await context.close()
            await browser.close()

    # ── 增量过滤 ──────────────────────────────────────────────
    state = _load_state()
    taptap_state = state.get("taptap", {})
    last_post_id = taptap_state.get("last_post_id", "")
    last_review_id = taptap_state.get("last_review_id", "")

    new_last_post_id = last_post_id
    new_last_review_id = last_review_id

    def _to_item(raw: dict, source: str) -> dict | None:
        try:
            created = datetime.fromisoformat(raw["created"])
        except Exception:
            created = datetime.now(timezone.utc)
        if created < cutoff:
            return None

        like_count = raw.get("like_count", 0)
        comment_count = raw.get("comment_count", 0)
        engagement = like_count + comment_count

        return {
            "title": raw.get("title", ""),
            "summary": raw.get("summary", ""),
            "source": source,
            "platform_region": "cn",
            "lang": "zh",
            "time": raw["created"],
            "url": raw.get("url", ""),
            "engagement": engagement,
            "is_hot": like_count > 50,
            "author": raw.get("author", ""),
            "tags": [],
            "content_type": "text",
            "media_url": "",
        }

    topic_items: list[dict] = []
    for raw in topic_raw:
        item_id = raw.get("item_id", "")
        if item_id and item_id == last_post_id:
            break  # 已处理到上次位置
        if item_id and not new_last_post_id:
            new_last_post_id = item_id  # 记录本次最新ID（第一条）
        item = _to_item(raw, "taptap_post")
        if item:
            topic_items.append(item)

    review_items: list[dict] = []
    for raw in review_raw:
        item_id = raw.get("item_id", "")
        if item_id and item_id == last_review_id:
            break
        if item_id and not new_last_review_id:
            new_last_review_id = item_id
        item = _to_item(raw, "taptap_review")
        if item:
            review_items.append(item)

    # ── 持久化状态 ────────────────────────────────────────────
    taptap_state.update({
        "last_post_id": new_last_post_id,
        "last_review_id": new_last_review_id,
        "last_run": datetime.now(timezone.utc).isoformat(),
    })
    state["taptap"] = taptap_state
    _save_state(state)

    logger.info(
        f"TapTap collect done: {len(topic_items)} posts, {len(review_items)} reviews"
    )
    return topic_items, review_items


# ─── 独立运行入口 ─────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )

    async def main():
        topics, reviews = await collect()
        all_items = topics + reviews

        output_path = DATA_DIR / "test_output_taptap.json"
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(all_items, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n✓ {len(topics)} posts + {len(reviews)} reviews → {output_path}")
        if all_items:
            print("\n--- 示例（前3条）---")
            for item in all_items[:3]:
                print(json.dumps(item, ensure_ascii=False, indent=2))
        return all_items

    result = asyncio.run(main())
    sys.exit(0 if result else 1)
