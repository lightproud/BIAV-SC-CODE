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

import ipaddress
import re
import socket
import time
from urllib.parse import urlparse

import requests
from urllib3.util import connection as _urllib3_connection

# Redirect 跳数上限：safe_get 每跳重校验 is_safe_url，get_with_retry 防御纵深用同一上限。
MAX_REDIRECTS = 5


def _resolve_safe_ip(host):
    """解析 host（IPv4+IPv6，经 socket.getaddrinfo），返回首个公网可达 IP 字符串；
    任一解析地址落私有/环回/链路本地/保留/多播/未指定段则视为不安全，返回 None。

    与旧实现（download_media 的 socket.gethostbyname）不同：getaddrinfo 同时覆盖 v4/v6，
    且对所有解析结果逐一校验——任一不安全即拒，杜绝 AAAA 内网混入。
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError, OSError):
        return None
    safe_ip = None
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return None
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            return None
        if safe_ip is None:
            safe_ip = addr
    return safe_ip


def is_safe_url(url: str) -> bool:
    """SSRF 守卫：仅放行 http/https 且解析后全部落公网 IP（v4/v6 均覆盖）。

    拒绝：非 http(s) scheme、无 host、解析失败、任一解析地址落
    私有/环回/链路本地/保留/多播/未指定段。SEC-02 守卫从 download_media 提至此共享层。
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    host = parsed.hostname
    if not host:
        return False
    return _resolve_safe_ip(host) is not None


class _PinnedIPAdapter(requests.adapters.HTTPAdapter):
    """把连接目标 IP pin 到「校验时已确认安全」的那个 IP，消除 resolve-then-fetch
    的 TOCTOU / DNS 重绑定窗口（R2-M1）：守卫解析一次得公网 IP，连接复用同一 IP，
    不给 requests 二次解析的机会。Host 头与 TLS SNI 仍用原域名（保证 vhost / 证书校验）。
    """

    def __init__(self, pinned_ip, *args, **kwargs):
        self._pinned_ip = pinned_ip
        super().__init__(*args, **kwargs)

    def send(self, request, **kwargs):
        orig_create_connection = _urllib3_connection.create_connection
        pinned_ip = self._pinned_ip

        def patched_create_connection(address, *a, **kw):
            return orig_create_connection((pinned_ip, address[1]), *a, **kw)

        _urllib3_connection.create_connection = patched_create_connection
        try:
            return super().send(request, **kwargs)
        finally:
            _urllib3_connection.create_connection = orig_create_connection


def safe_get(url, *, headers=None, timeout=30, stream=False,
             max_redirects=MAX_REDIRECTS):
    """SSRF-safe GET：禁用自动重定向，手动逐跳重校验 is_safe_url，并把每跳连接
    pin 到校验通过的 IP（消除 TOCTOU/DNS 重绑定，R2-M1）。

    返回最终非 3xx 响应（requests.Response，stream 时 body 未消费）。
    任一跳 URL 不安全、3xx 缺/坏 Location、或超过 max_redirects → 抛 ValueError。
    传输层错误照常抛 requests.RequestException，由调用方处理。
    """
    current = url
    for _ in range(max_redirects + 1):
        parsed = urlparse(current)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ValueError(f"unsafe url scheme/host: {current[:80]}")
        pinned_ip = _resolve_safe_ip(parsed.hostname)
        if pinned_ip is None:
            raise ValueError(f"unsafe url (non-public host): {current[:80]}")

        session = requests.Session()
        session.mount("http://", _PinnedIPAdapter(pinned_ip))
        session.mount("https://", _PinnedIPAdapter(pinned_ip))
        resp = session.get(current, headers=headers, timeout=timeout,
                           stream=stream, allow_redirects=False)

        if resp.status_code in (301, 302, 303, 307, 308):
            location = resp.headers.get("Location")
            resp.close()
            if not location:
                raise ValueError(f"redirect without Location: {current[:80]}")
            current = requests.compat.urljoin(current, location)
            continue
        return resp
    raise ValueError(f"too many redirects (>{max_redirects}): {url[:80]}")


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
            # R2-L2 防御纵深：限制重定向跳数（默认 requests 上限 30 → 收紧到
            # MAX_REDIRECTS），避免被外部端点经长重定向链拖向意外 sink。
            session = requests.Session()
            session.max_redirects = MAX_REDIRECTS
            resp = session.get(url, params=params, headers=h, timeout=timeout)
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
