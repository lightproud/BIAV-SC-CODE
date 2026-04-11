#!/usr/bin/env python3
"""
test_rsshub.py — 探测一个 RSSHub 实例能跑通多少我们实际要用的路由

用途：
  换部署实例后，立刻知道哪些路由活、哪些挂，每条挂的原因是什么。
  部署完 Fly.io/Railway/VPS 后第一件事就是跑这个脚本。

用法：
  python projects/news/scripts/test_rsshub.py                     # 测默认 URL（env: RSSHUB_URL）
  python projects/news/scripts/test_rsshub.py https://biav-rsshub.fly.dev
  python projects/news/scripts/test_rsshub.py http://localhost:1200
"""

import json
import sys
import time
from urllib.parse import quote

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. pip install requests")
    sys.exit(1)

# 与 report-system/scripts/collector.py 中 RSSHUB_ROUTES 保持同步
# (route, source_name, needs_cookie)
ROUTES = [
    ("/weibo/keyword/忘却前夜", "weibo", True),
    ("/weibo/keyword/Morimens", "weibo", True),
    ("/zhihu/search/忘却前夜", "zhihu", True),
    ("/xiaohongshu/keyword/忘却前夜", "xiaohongshu", True),
    ("/douyin/keyword/忘却前夜", "douyin", False),  # needs puppeteer, no cookie
    ("/bilibili/search/忘却前夜", "bilibili", False),
    ("/tieba/forum/忘却前夜", "tieba", False),
    ("/nga/search/忘却前夜", "nga", False),
    ("/lofter/tag/忘却前夜", "lofter", False),
    ("/pixiv/search/忘却前夜", "pixiv", True),
    ("/pixiv/search/モリメンス", "pixiv", True),
    ("/5ch/search/忘却前夜", "fivech", False),
    ("/dcinside/board/morimens", "dcinside", False),
    ("/tiktok/keyword/Morimens", "tiktok", False),
    ("/reddit/search/Morimens", "reddit", False),
    ("/telegram/channel/Morimens", "telegram", False),
]


def probe_route(base_url: str, route: str, timeout: int = 30) -> dict:
    """Probe a single route and return status dict."""
    # Build URL with encoded path
    parts = route.split("/")
    encoded = "/".join(quote(p, safe="") for p in parts)
    url = f"{base_url}{encoded}?format=json&limit=5"
    t0 = time.time()
    try:
        resp = requests.get(url, timeout=timeout, headers={"Accept": "application/json"})
        elapsed = time.time() - t0
    except requests.exceptions.Timeout:
        return {"status": "TIMEOUT", "code": 0, "items": 0, "elapsed": timeout, "detail": "request timed out"}
    except requests.exceptions.RequestException as e:
        return {"status": "ERROR", "code": 0, "items": 0, "elapsed": time.time() - t0, "detail": str(e)[:120]}

    if resp.status_code != 200:
        snippet = resp.text[:100].replace("\n", " ")
        return {
            "status": "HTTP_ERR",
            "code": resp.status_code,
            "items": 0,
            "elapsed": elapsed,
            "detail": snippet,
        }

    try:
        data = resp.json()
    except json.JSONDecodeError:
        return {
            "status": "BAD_JSON",
            "code": 200,
            "items": 0,
            "elapsed": elapsed,
            "detail": resp.text[:100].replace("\n", " "),
        }

    items = data.get("items", []) or []
    if not items:
        # RSSHub returns 200 with empty feed if scraping succeeded but no content
        return {
            "status": "EMPTY",
            "code": 200,
            "items": 0,
            "elapsed": elapsed,
            "detail": "ran clean, no items (may be missing cookies or genuinely empty)",
        }

    return {
        "status": "OK",
        "code": 200,
        "items": len(items),
        "elapsed": elapsed,
        "detail": items[0].get("title", "")[:60],
    }


def main():
    base_url = sys.argv[1] if len(sys.argv) > 1 else None
    if not base_url:
        import os
        base_url = os.environ.get("RSSHUB_URL", "https://biav-rsshub.vercel.app")
    base_url = base_url.rstrip("/")

    print(f"=== Probing RSSHub instance: {base_url} ===\n")

    results = []
    for route, source, needs_cookie in ROUTES:
        cookie_mark = "🔑" if needs_cookie else "  "
        print(f"  {cookie_mark} {route:<50} ... ", end="", flush=True)
        r = probe_route(base_url, route)
        r["route"] = route
        r["source"] = source
        r["needs_cookie"] = needs_cookie
        results.append(r)
        print(f"{r['status']:<8} [{r['code']}] {r['items']} items  ({r['elapsed']:.1f}s)")
        if r["status"] not in ("OK", "EMPTY"):
            print(f"        → {r['detail'][:100]}")
        time.sleep(0.5)

    # Summary
    print("\n" + "=" * 70)
    ok = [r for r in results if r["status"] == "OK"]
    empty = [r for r in results if r["status"] == "EMPTY"]
    bad = [r for r in results if r["status"] not in ("OK", "EMPTY")]

    print(f"✓ OK:    {len(ok)}/{len(results)}  ({sum(r['items'] for r in ok)} items total)")
    print(f"· EMPTY: {len(empty)}/{len(results)}")
    print(f"✗ FAIL:  {len(bad)}/{len(results)}")
    print()

    if bad:
        print("Failed routes:")
        for r in bad:
            print(f"  {r['route']}: {r['status']} [{r['code']}] {r['detail'][:80]}")
        print()

    # Cookie recommendation
    empty_with_cookie = [r for r in empty if r["needs_cookie"]]
    if empty_with_cookie:
        print("Routes returning empty that NEED cookies (set them in deploy env):")
        seen = set()
        for r in empty_with_cookie:
            if r["source"] not in seen:
                seen.add(r["source"])
                cookie_var = {
                    "weibo": "WEIBO_COOKIE",
                    "zhihu": "ZHIHU_COOKIES",
                    "xiaohongshu": "XIAOHONGSHU_COOKIE",
                    "pixiv": "PIXIV_REFRESHTOKEN",
                }.get(r["source"], f"{r['source'].upper()}_COOKIE")
                print(f"  - {r['source']}: set {cookie_var}")
        print()

    # Exit code: 0 if at least half the routes work, 1 otherwise
    sys.exit(0 if len(ok) >= len(results) // 2 else 1)


if __name__ == "__main__":
    main()
