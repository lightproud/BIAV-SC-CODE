"""Mutation-testing harness for news_common (see setup.cfg [mutmut]).

news_common 是采集层共享工具单一真源（ARCH-01/02）：SSRF 守卫、日志脱敏、
多语言时间归一、item 构造、原子写盘——两套采集栈全部委托至此。守卫条件被翻转
= SSRF 放行内网；时间归一被扰动 = 全平台条目时序错乱。逻辑密集；唯一大常量表
_WBI_MIXIN_KEY_ENC_TAB 以「黄金值一击全钉」处理（任一表项变动即改变 mixin key，
无需逐项断言），不构成数据噪声（守密人 2026-07-11 裁定扩员）。

Hermetic：socket / requests / time.sleep 全部打桩，零网络。
Imports via PACKAGE path so mutmut's trampoline keys match.
"""
import hashlib
import json
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import projects.news.scripts.news_common as nc  # noqa: E402


# ── strip_html / redact_secrets ─────────────────────────────────────────────

def test_strip_html():
    assert nc.strip_html('<b>hi</b> <a href="x">there</a>') == 'hi there'
    assert nc.strip_html('') == ''
    assert nc.strip_html(None) == ''
    assert nc.strip_html('plain') == 'plain'


@pytest.mark.parametrize('raw,masked', [
    ('https://x/api?key=SECRET&q=1', 'https://x/api?key=***&q=1'),
    ('https://x?api_key=abc', 'https://x?api_key=***'),
    ('https://x?access_token=t.t-t', 'https://x?access_token=***'),
    ('Cookie=sess123 done', 'Cookie=*** done'),
    ('PASSWORD=hunter2&next=1', 'PASSWORD=***&next=1'),   # 大小写不敏感
    ('https://x?query=morimens', 'https://x?query=morimens'),  # 非敏感参数不动
])
def test_redact_secrets(raw, masked):
    assert nc.redact_secrets(raw) == masked


def test_redact_secrets_coerces_non_str():
    assert nc.redact_secrets(Exception('url?token=abc')) == 'url?token=***'


# ── parse_relative_time：多语言时间归一 ─────────────────────────────────────

def _close(iso, expected_dt, tol=8):
    got = datetime.fromisoformat(iso)
    return abs((got - expected_dt).total_seconds()) <= tol


def _now():
    return datetime.now(timezone.utc)


def test_prt_empty_is_approximate():
    iso, approx = nc.parse_relative_time('')
    assert approx is True and _close(iso, _now())
    iso2, approx2 = nc.parse_relative_time(None)
    assert approx2 is True


def test_prt_epoch_seconds_and_millis():
    iso, approx = nc.parse_relative_time(1752200000)
    assert (iso, approx) == ('2025-07-11T02:13:20+00:00', False)
    # >1e11 视为毫秒：同一时刻的毫秒形态须归一到同一 ISO
    iso_ms, _ = nc.parse_relative_time(1752200000000)
    assert iso_ms == iso
    iso_str, _ = nc.parse_relative_time('1752200000')
    assert iso_str == iso


def test_prt_iso_passthrough_with_z():
    iso, approx = nc.parse_relative_time('2026-07-11T15:00:00Z')
    assert (iso, approx) == ('2026-07-11T15:00:00+00:00', False)


@pytest.mark.parametrize('text,delta', [
    ('刚刚', timedelta()),
    ('5分钟前', timedelta(minutes=5)),
    ('3小时前', timedelta(hours=3)),
    ('2天前', timedelta(days=2)),
    ('7분 전', timedelta(minutes=7)),
    ('2시간 전', timedelta(hours=2)),
    ('4일 전', timedelta(days=4)),
    ('9分前', timedelta(minutes=9)),
    ('6時間前', timedelta(hours=6)),
    ('3日前', timedelta(days=3)),
    ('45 minutes ago', timedelta(minutes=45)),
    ('2 hours ago', timedelta(hours=2)),
    ('Streamed 3 days ago', timedelta(days=3)),
    ('1 week ago', timedelta(weeks=1)),
    ('2 months ago', timedelta(days=60)),
    ('1 year ago', timedelta(days=365)),
    ('昨天 12:00', timedelta(days=1)),
    ('前天', timedelta(days=2)),
])
def test_prt_relative_forms(text, delta):
    iso, approx = nc.parse_relative_time(text)
    assert approx is False
    assert _close(iso, _now() - delta), f'{text}: {iso}'


def test_prt_absolute_dates():
    assert nc.parse_relative_time('2026.7.9') == ('2026-07-09T00:00:00+00:00', False)
    # 'YYYY-MM-DD' 先被 ISO 分支吃掉 → naive（与 UTC 正则分支行为不同，钉住现状）
    assert nc.parse_relative_time('2026-07-09') == ('2026-07-09T00:00:00', False)
    assert nc.parse_relative_time('2026/7/9') == ('2026-07-09T00:00:00+00:00', False)


def test_prt_month_day_rolls_back_when_future():
    now = _now()
    future = now + timedelta(days=40)
    iso, approx = nc.parse_relative_time(f'{future.month}.{future.day}')
    assert approx is False
    got = datetime.fromisoformat(iso)
    assert got.year == now.year - 1 and got <= now  # 未来日期回退一年


def test_prt_hhmm_today_or_yesterday():
    now = _now()
    past = now - timedelta(minutes=30)
    iso, approx = nc.parse_relative_time(f'{past.hour:02d}:{past.minute:02d}')
    assert approx is False
    assert _close(iso, past.replace(second=0, microsecond=0), tol=61)
    fut = now + timedelta(minutes=90)
    iso2, _ = nc.parse_relative_time(f'{fut.hour:02d}:{fut.minute:02d}')
    got2 = datetime.fromisoformat(iso2)
    assert got2 <= now  # 未来时刻回退到昨天


def test_prt_garbage_is_approximate():
    iso, approx = nc.parse_relative_time('not a time at all')
    assert approx is True and _close(iso, _now())


# ── make_item：标准条目构造 ─────────────────────────────────────────────────

def test_make_item_full_mapping():
    item = nc.make_item('<b>T</b>', ' <i>S</i> ', 'steam', 'Global', 't0', 'u',
                        engagement=7, is_hot=True, author=123, tags=['a'],
                        lang='en', content_type='video', media_url='m',
                        time_is_approximate=True, region='jp', archive_subtype='review')
    assert item == {
        'title': 'T', 'summary': 'S', 'source': 'steam', 'platform_region': 'Global',
        'lang': 'en', 'time': 't0', 'url': 'u', 'engagement': 7, 'is_hot': True,
        'author': '123', 'tags': ['a'], 'content_type': 'video', 'media_url': 'm',
        'time_is_approximate': True, 'region': 'jp', 'archive_subtype': 'review',
    }


def test_make_item_optional_fields_absent_by_default():
    item = nc.make_item(None, None, 's', 'r', 't', None)
    assert item['title'] == '' and item['summary'] == '' and item['url'] == ''
    assert item['tags'] == [] and item['author'] == ''
    for k in ('time_is_approximate', 'region', 'archive_subtype'):
        assert k not in item  # 缺省不落字段 → 归档回落旧扁平布局的契约


# ── SSRF 守卫：_resolve_safe_ip / is_safe_url ───────────────────────────────

def _fake_gai(*addrs, fail=False):
    def gai(host, port):
        if fail:
            raise nc.socket.gaierror('nx')
        return [(2, 1, 6, '', (a, 0)) for a in addrs]
    return gai


@pytest.mark.parametrize('addrs,ok', [
    (('93.184.216.34',), True),
    (('10.0.0.5',), False),                      # 私网
    (('127.0.0.1',), False),                     # 环回
    (('169.254.1.1',), False),                   # 链路本地
    (('224.0.0.1',), False),                     # 多播
    (('0.0.0.0',), False),                       # 未指定
    (('93.184.216.34', '10.0.0.5'), False),      # 任一不安全即拒（AAAA 混入）
    (('2606:2800:220:1::1',), True),             # 公网 v6
    (('fe80::1',), False),                       # v6 链路本地
    (('::1',), False),                           # v6 环回
])
def test_resolve_safe_ip_matrix(monkeypatch, addrs, ok):
    monkeypatch.setattr(nc.socket, 'getaddrinfo', _fake_gai(*addrs))
    got = nc._resolve_safe_ip('h')
    assert (got == addrs[0]) if ok else (got is None)


def test_resolve_safe_ip_failures(monkeypatch):
    monkeypatch.setattr(nc.socket, 'getaddrinfo', _fake_gai(fail=True))
    assert nc._resolve_safe_ip('nx.example') is None
    monkeypatch.setattr(nc.socket, 'getaddrinfo', _fake_gai('not-an-ip'))
    assert nc._resolve_safe_ip('h') is None


def test_is_safe_url_scheme_and_host_gates(monkeypatch):
    monkeypatch.setattr(nc.socket, 'getaddrinfo', _fake_gai('93.184.216.34'))
    assert nc.is_safe_url('https://ok.example/x') is True
    assert nc.is_safe_url('ftp://ok.example/x') is False
    assert nc.is_safe_url('http://') is False
    monkeypatch.setattr(nc.socket, 'getaddrinfo', _fake_gai('10.0.0.5'))
    assert nc.is_safe_url('https://internal.example/') is False


# ── safe_get：逐跳重校验 + 跳数上限 ─────────────────────────────────────────

class _Resp:
    def __init__(self, status, headers=None):
        self.status_code = status
        self.headers = headers or {}
        self.closed = False

    def close(self):
        self.closed = True


class _FakeSession:
    """回放队列式 Session 桩：记录 GET 序列，弹出预设响应。"""
    queue = []
    calls = []

    def __init__(self):
        pass

    def mount(self, *_a, **_k):
        pass

    def get(self, url, **kw):
        _FakeSession.calls.append((url, kw.get('allow_redirects')))
        return _FakeSession.queue.pop(0)


@pytest.fixture()
def fake_session(monkeypatch):
    _FakeSession.queue = []
    _FakeSession.calls = []
    monkeypatch.setattr(nc.requests, 'Session', _FakeSession)
    monkeypatch.setattr(nc, '_resolve_safe_ip',
                        lambda host: None if 'evil' in host else '93.184.216.34')
    return _FakeSession


def test_safe_get_follows_redirect_with_revalidation(fake_session):
    fake_session.queue = [_Resp(302, {'Location': 'https://b.example/next'}), _Resp(200)]
    resp = nc.safe_get('https://a.example/x')
    assert resp.status_code == 200
    assert [u for u, _ in fake_session.calls] == \
        ['https://a.example/x', 'https://b.example/next']
    assert all(ar is False for _, ar in fake_session.calls)  # 自动重定向必须禁用


def test_safe_get_rejects_unsafe_redirect_target(fake_session):
    fake_session.queue = [_Resp(301, {'Location': 'https://evil.example/'})]
    with pytest.raises(ValueError, match='non-public'):
        nc.safe_get('https://a.example/x')


def test_safe_get_redirect_without_location(fake_session):
    fake_session.queue = [_Resp(303, {})]
    with pytest.raises(ValueError, match='Location'):
        nc.safe_get('https://a.example/x')


def test_safe_get_too_many_redirects(fake_session):
    fake_session.queue = [_Resp(307, {'Location': f'https://a.example/{i}'})
                          for i in range(nc.MAX_REDIRECTS + 1)]
    with pytest.raises(ValueError, match='too many redirects'):
        nc.safe_get('https://a.example/0')
    assert len(fake_session.calls) == nc.MAX_REDIRECTS + 1  # 恰好 N+1 跳后放弃


def test_safe_get_rejects_bad_scheme_upfront(fake_session):
    with pytest.raises(ValueError, match='scheme'):
        nc.safe_get('ftp://a.example/x')
    assert fake_session.calls == []


# ── get_with_retry：重试节拍 + header 合并 ──────────────────────────────────

class _RetrySession:
    outcomes = []
    calls = []

    def __init__(self):
        self.max_redirects = None

    def get(self, url, params=None, headers=None, timeout=None):
        _RetrySession.calls.append({'headers': headers, 'max_redirects': self.max_redirects})
        out = _RetrySession.outcomes.pop(0)
        if isinstance(out, Exception):
            raise out
        return out


class _OkResp:
    status_code = 200

    def raise_for_status(self):
        pass


@pytest.fixture()
def retry_env(monkeypatch):
    _RetrySession.outcomes = []
    _RetrySession.calls = []
    sleeps = []
    monkeypatch.setattr(nc.requests, 'Session', _RetrySession)
    monkeypatch.setattr(nc.time, 'sleep', sleeps.append)
    return _RetrySession, sleeps


def test_get_with_retry_success_first_try(retry_env):
    sess, sleeps = retry_env
    ok = _OkResp()
    sess.outcomes = [ok]
    assert nc.get_with_retry('https://x', headers={'A': '2'},
                             default_headers={'A': '1', 'B': '1'}) is ok
    assert sleeps == []
    assert sess.calls[0]['headers'] == {'A': '2', 'B': '1'}   # 显式头覆盖默认头
    assert sess.calls[0]['max_redirects'] == nc.MAX_REDIRECTS


def test_get_with_retry_backoff_then_success(retry_env):
    sess, sleeps = retry_env
    ok = _OkResp()
    sess.outcomes = [nc.requests.RequestException('a'),
                     nc.requests.RequestException('b'), ok]
    assert nc.get_with_retry('https://x') is ok
    assert sleeps == [1, 2]                                    # 间隔 1s/2s


def test_get_with_retry_exhausted_raises_last(retry_env):
    sess, sleeps = retry_env
    sess.outcomes = [nc.requests.RequestException(f'e{i}') for i in range(3)]
    with pytest.raises(nc.requests.RequestException, match='e2'):
        nc.get_with_retry('https://x')
    assert sleeps == [1, 2]                                    # 末次失败不再睡


# ── bilibili wbi：黄金值一击全钉 64 项混淆表 ────────────────────────────────

_IMG = 'abcdef0123456789abcdef0123456789'
_SUB = '9876543210fedcba9876543210fedcba'
_GOLDEN_MIXIN = 'bacc42199749fdc65ef883fd76826307'


class _JsonResp:
    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


def test_wbi_mixin_key_golden(monkeypatch):
    nc._wbi_cache.clear()
    payload = {'data': {'wbi_img': {
        'img_url': f'https://i0.hdslb.com/bfs/wbi/{_IMG}.png',
        'sub_url': f'https://i0.hdslb.com/bfs/wbi/{_SUB}.png'}}}
    monkeypatch.setattr(nc.requests, 'get', lambda *a, **k: _JsonResp(payload))
    assert nc.get_wbi_mixin_key() == _GOLDEN_MIXIN
    assert len(_GOLDEN_MIXIN) == 32


def test_wbi_mixin_key_cache_and_fallback(monkeypatch):
    nc._wbi_cache.clear()
    nc._wbi_cache.update({'mixin_key': 'cached', 'ts': nc.time.time()})
    monkeypatch.setattr(nc.requests, 'get',
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError('no refetch')))
    assert nc.get_wbi_mixin_key() == 'cached'                 # 30 分钟内走缓存
    nc._wbi_cache['ts'] = 0                                    # 过期 + 拉取失败 → 回退旧值
    monkeypatch.setattr(nc.requests, 'get',
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError('down')))
    assert nc.get_wbi_mixin_key() == 'cached'
    nc._wbi_cache.clear()


def test_sign_wbi_params_golden(monkeypatch):
    monkeypatch.setattr(nc.time, 'time', lambda: 1752200000.9)
    signed = nc.sign_wbi_params({'keyword': 'morimens', 'page': 1}, _GOLDEN_MIXIN)
    assert signed['wts'] == 1752200000                         # int 截断
    assert signed['w_rid'] == '504dcad68cdb1eac9a3b476958cad21c'
    assert signed['keyword'] == 'morimens'                     # 原参数保留


def test_spi_cookies(monkeypatch):
    monkeypatch.setattr(nc.requests, 'get',
                        lambda *a, **k: _JsonResp({'data': {'b_3': 'x3', 'b_4': 'x4'}}))
    assert nc.bilibili_spi_cookies() == {'buvid3': 'x3', 'buvid4': 'x4'}
    monkeypatch.setattr(nc.requests, 'get',
                        lambda *a, **k: _JsonResp({'data': {'b_3': 'only3'}}))
    assert nc.bilibili_spi_cookies() == {'buvid3': 'only3'}
    monkeypatch.setattr(nc.requests, 'get',
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError('net')))
    assert nc.bilibili_spi_cookies() == {}


# ── dump_json_atomic：原子写盘 ──────────────────────────────────────────────

def test_dump_json_atomic_writes_and_cleans(tmp_path):
    target = tmp_path / 'deep' / 'out.json'
    nc.dump_json_atomic(target, {'k': '值'})
    assert json.loads(target.read_text(encoding='utf-8')) == {'k': '值'}
    assert list(target.parent.glob('.*.tmp')) == []            # 不留临时文件


def test_dump_json_atomic_failure_preserves_original(tmp_path):
    target = tmp_path / 'out.json'
    nc.dump_json_atomic(target, {'ok': 1})
    with pytest.raises(TypeError):
        nc.dump_json_atomic(target, {'bad': object()})
    assert json.loads(target.read_text(encoding='utf-8')) == {'ok': 1}  # 旧文件完好
    assert list(tmp_path.glob('.*.tmp')) == []                 # 半截临时文件已清
