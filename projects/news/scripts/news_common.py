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
import json
import os
import re
import socket
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
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


_SENSITIVE_PARAM_RE = re.compile(
    r"((?:api_?key|key|access_?token|token|cookie|auth|secret|password)=)[^&\s'\"]+",
    re.IGNORECASE,
)


def redact_secrets(text) -> str:
    """日志/落盘脱敏（H3）：掩码 URL 查询参数中的敏感值（key=/token=/cookie= 等）。

    requests 异常文本含完整请求 URL（如 YouTube `key=<API key>`），采集器把异常
    直接写日志（公开 Actions 日志）或 source-health.json（入库），此处统一掩码。
    """
    return _SENSITIVE_PARAM_RE.sub(r"\1***", str(text))


def parse_relative_time(value):
    """把各平台时间字段归一为 ISO 字符串（H4 单一真源）。返回 (iso_string, is_approximate)。

    支持：
    - epoch 秒/毫秒（int/float/纯数字字符串；>1e11 视为毫秒）
    - ISO 字符串（含尾缀 Z）
    - 中文相对："刚刚"、"x分钟前"、"x小时前"、"x天前"、"昨天"、"前天"
    - 韩文相对："x분 전"、"x시간 전"、"x일 전"
    - 日文相对："x分前"、"x時間前"、"x日前"
    - 英文相对："x minutes/hours/days/... ago"、"Streamed x ago"
    - 绝对日期："YYYY-MM-DD"/"YYYY/MM/DD"/"YYYY.MM.DD"、"MM-DD"/"MM/DD"/"MM.DD"、"HH:MM"

    is_approximate=True 仅当输入为空或完全无法解析（回退为当前时间）。
    """
    now = datetime.now(timezone.utc)
    if not value or not str(value).strip():
        return now.isoformat(), True

    # epoch 数字（naver writeDateTimestamp 为毫秒、zhihu created_time 为秒）
    if isinstance(value, (int, float)) or str(value).strip().isdigit():
        try:
            ts = float(value)
            if ts > 1e11:
                ts /= 1000.0
            return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(), False
        except (ValueError, OverflowError, OSError):
            return now.isoformat(), True

    s = str(value).strip()

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

    # Time-only: "HH:MM" (today)
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


# ── Bilibili 风控配套（spi cookie + wbi 签名）────────────────────────────────
# 2026-06 起 B 站搜索接口对伪造 buvid 返回风控 HTML（非 JSON），必须：
# 1) 用 /x/frontend/finger/spi 取服务端签发的 buvid3/buvid4
# 2) 走 /x/web-interface/wbi/search/type 并做 wbi 签名
# 两套采集栈（aggregator / global）共用此实现（ARCH-02 收敛纪律）。

_WBI_MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]
_wbi_cache = {}  # {'mixin_key': str, 'ts': float}


def bilibili_spi_cookies(headers=None, timeout=10):
    """从 /x/frontend/finger/spi 获取服务端签发的 buvid3/buvid4。失败返回 {}。"""
    try:
        resp = requests.get(
            'https://api.bilibili.com/x/frontend/finger/spi',
            headers=headers, timeout=timeout,
        )
        data = resp.json().get('data', {})
        cookies = {}
        if data.get('b_3'):
            cookies['buvid3'] = data['b_3']
        if data.get('b_4'):
            cookies['buvid4'] = data['b_4']
        return cookies
    except Exception:
        return {}


def get_wbi_mixin_key(headers=None, timeout=10):
    """获取并缓存 wbi mixin key（30 分钟刷新）。失败时回退用旧缓存或 None。"""
    now = time.time()
    if _wbi_cache.get('mixin_key') and now - _wbi_cache.get('ts', 0) < 1800:
        return _wbi_cache['mixin_key']
    try:
        resp = requests.get(
            'https://api.bilibili.com/x/web-interface/nav',
            headers=headers, timeout=timeout,
        )
        wbi = resp.json().get('data', {}).get('wbi_img', {})
        img_key = wbi['img_url'].rsplit('/', 1)[1].split('.')[0]
        sub_key = wbi['sub_url'].rsplit('/', 1)[1].split('.')[0]
        raw = img_key + sub_key
        _wbi_cache['mixin_key'] = ''.join(raw[i] for i in _WBI_MIXIN_KEY_ENC_TAB)[:32]
        _wbi_cache['ts'] = now
        return _wbi_cache['mixin_key']
    except Exception:
        return _wbi_cache.get('mixin_key')


def sign_wbi_params(params, mixin_key):
    """为请求参数附加 wts + w_rid wbi 签名。"""
    import hashlib
    from urllib.parse import urlencode
    params = dict(params)
    params['wts'] = int(time.time())
    query = urlencode(sorted(params.items()))
    params['w_rid'] = hashlib.md5((query + mixin_key).encode()).hexdigest()
    return params


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


def dump_json_atomic(path, obj, *, indent=2):
    """原子写 JSON —— 先写同目录临时文件，再 os.replace 落位。

    news.json / news-raw.json 等输出由多个脚本先后写入（aggregator → collect_global），
    直接 open('w')+dump 若在写一半时崩溃/被中断，会留下半截损坏文件，前端读到即白屏。
    同目录临时文件 + os.replace 在同一文件系统上是原子替换：要么旧文件、要么完整新文件，
    永不出现半截态。单一真源，所有 output/data 层 JSON 写入应走此函数。
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=indent)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
