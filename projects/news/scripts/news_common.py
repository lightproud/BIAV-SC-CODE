#!/usr/bin/env python3
"""
news_common.py — 采集层共享工具（ARCH-01/02 收敛单一归属）

两套采集栈（aggregator_collectors / global_collectors）历史上各自实现了 HTTP 重试、
HTML 去标签、item 构造等同名工具。本模块抽出其中**行为等价**的部分作为单一真源，
两栈委托至此，去除重复实现（审计 ARCH-02）。

收敛纪律（§6.1/§6.3）：仅收敛真正等价的 helper。HTTP 包装与 item 构造在两栈间
语义不同（global `_get` 对 4xx `raise_for_status`、aggregator `_get_with_retry`
对 4xx 返回响应；两栈 item 字段集不同），故**不强行合并**——保留各自实现并以
`# NOTE: divergent` 标注，见 global_collectors / aggregator_base。
"""

import re
import time

import requests


def strip_html(text: str) -> str:
    """移除 HTML 标签，返回纯文本。空值安全。

    两栈先前各有 `_strip_html`(global) / `strip_html_tags`(aggregator_base)，
    实现等价（`re.sub(r'<[^>]+>', '', text)` + 空值守卫），此处统一。
    """
    return re.sub(r"<[^>]+>", "", text) if text else ""


def get_with_retry(url, params=None, headers=None, timeout=15, retries=3,
                   default_headers=None):
    """带重试的 GET（间隔 1s/2s）；对任意非 2xx `raise_for_status`。

    对应 global_collectors._get 的语义（4xx/5xx 均抛错重试），供需要该语义的采集器复用。
    aggregator_base._get_with_retry 故意采用不同语义（4xx 直接返回响应），不在此收敛。
    """
    h = {**(default_headers or {}), **(headers or {})}
    last_exc = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, headers=h, timeout=timeout)
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            last_exc = e
            if attempt == retries - 1:
                raise
            time.sleep(attempt + 1)
    raise last_exc  # unreachable, satisfies type checker


def make_item(title, summary, source, platform_region, time_str, url,
              engagement=0, is_hot=False, author="", tags=None, lang="",
              content_type="text", media_url="", time_is_approximate=False):
    """创建标准化信息条目（与 global_collectors._make_item 等价的单一真源）。

    aggregator 栈通过 aggregator_base.validate_news_item 走另一套 item 形状与校验路径，
    字段集不同，故不在此收敛。
    """
    item = {
        "title": strip_html(title or "").strip(),
        "summary": strip_html(summary or "").strip(),
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
    if time_is_approximate:
        item["time_is_approximate"] = True
    return item
