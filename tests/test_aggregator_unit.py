"""aggregator.py 单测：失败哨兵 + run() 编排纯逻辑（dedup / lang 补齐 / 排序 /
hot 标记 / 空数据保护 / R1 核心源失败）。

所有 fetcher / playwright / quality tracker / 原子写盘一律 mock；OUTPUT_PATH 与
FAILURE_FLAG monkeypatch 到 tmp，绝不触网、绝不写真实 output 树。
"""

import sys
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import aggregator  # noqa: E402


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    out = tmp_path / "output" / "news.json"
    flag = tmp_path / "aggregator-failure.flag"
    monkeypatch.setattr(aggregator, "OUTPUT_PATH", out)
    monkeypatch.setattr(aggregator, "FAILURE_FLAG", flag)
    # No playwright, no quality tracker by default
    monkeypatch.setattr(aggregator, "_get_playwright_collectors", lambda: None)
    monkeypatch.setattr(aggregator, "_get_quality_tracker", lambda: None)
    # validate_all_news passthrough (avoid sanitizer side effects)
    monkeypatch.setattr(aggregator, "validate_all_news", lambda items: items)
    monkeypatch.setattr(aggregator, "generate_summary", lambda items: "summary")
    # capture atomic dumps
    dumped = {}

    def fake_dump(path, payload):
        dumped["path"] = path
        dumped["payload"] = payload

    fake_dump_mock = mock.Mock(side_effect=fake_dump)
    monkeypatch.setattr(aggregator.news_common, "dump_json_atomic", fake_dump_mock)
    return tmp_path, flag, dumped


def _stub_fetchers(monkeypatch, items_by_name):
    """Patch every fetcher in aggregator's namespace to return the given lists."""
    defaults = {
        "fetch_reddit": [], "fetch_bilibili": [], "fetch_taptap": [],
        "fetch_steam_reviews": [], "fetch_steam_news": [],
        "fetch_steam_discussions": [], "fetch_discord_local": [],
    }
    defaults.update(items_by_name)
    for fname, ret in defaults.items():
        if isinstance(ret, Exception):
            monkeypatch.setattr(aggregator, fname, mock.Mock(side_effect=ret))
        else:
            monkeypatch.setattr(aggregator, fname, mock.Mock(return_value=ret))


def _item(**kw):
    base = {"title": "T", "url": "", "engagement": 0, "source": "reddit"}
    base.update(kw)
    return base


# ── _flag_failure ───────────────────────────────────────────────────────────

def test_flag_failure_writes_redacted(sandbox, monkeypatch):
    _, flag, _ = sandbox
    monkeypatch.setattr(aggregator.news_common, "redact_secrets",
                        lambda s: "[redacted]")
    aggregator._flag_failure("token=secret leaked")
    assert flag.read_text(encoding="utf-8").strip() == "[redacted]"


# ── run(): empty data protection ────────────────────────────────────────────

def test_run_all_empty_no_existing_writes_placeholder(sandbox, monkeypatch):
    _, flag, dumped = sandbox
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    _stub_fetchers(monkeypatch, {})
    result = aggregator.run()
    assert result is False
    # placeholder written + failure flag set
    assert dumped["payload"]["news"] == []
    assert flag.exists()


def test_run_all_empty_with_existing_preserves(sandbox, monkeypatch):
    tmp_path, flag, dumped = sandbox
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    # create an existing output file -> should be preserved (no dump)
    aggregator.OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    aggregator.OUTPUT_PATH.write_text('{"news": []}', encoding="utf-8")
    _stub_fetchers(monkeypatch, {})
    result = aggregator.run()
    assert result is False
    assert "payload" not in dumped  # existing kept intact
    assert flag.exists()


# ── run(): happy path with dedup / lang fill / sort / hot ────────────────────

def test_run_dedup_and_lang_fill_and_sort(sandbox, monkeypatch):
    _, _, dumped = sandbox
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    _stub_fetchers(monkeypatch, {
        "fetch_reddit": [
            _item(title="Alpha", url="http://x.com/a", engagement=10, source="reddit"),
            # duplicate URL (http vs https + trailing slash) -> deduped
            _item(title="Alpha copy", url="https://x.com/a/", engagement=5, source="reddit"),
        ],
        "fetch_bilibili": [
            _item(title="Beta", url="http://b.com/b", engagement=200, source="bilibili"),
        ],
    })
    result = aggregator.run()
    assert result is True
    news = dumped["payload"]["news"]
    # only 2 unique items
    assert len(news) == 2
    # sorted by engagement desc -> Beta first
    assert news[0]["title"] == "Beta"
    # bilibili lang/region filled
    assert news[0]["lang"] == "zh"
    assert news[0]["platform_region"] == "cn"
    # reddit defaults
    reddit_item = next(n for n in news if n["source"] == "reddit")
    assert reddit_item["lang"] == "en"
    assert reddit_item["platform_region"] == "global"


def test_run_hot_marking_threshold(sandbox, monkeypatch):
    _, _, dumped = sandbox
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    _stub_fetchers(monkeypatch, {
        "fetch_reddit": [
            _item(title="Hot", url="http://x/1", engagement=100, source="reddit"),
            _item(title="Cold", url="http://x/2", engagement=10, source="reddit"),
        ],
    })
    aggregator.run()
    news = dumped["payload"]["news"]
    hot = next(n for n in news if n["title"] == "Hot")
    cold = next(n for n in news if n["title"] == "Cold")
    assert hot.get("is_hot") is True
    assert "is_hot" not in cold  # below 50 threshold


def test_run_dedup_by_title_when_no_url(sandbox, monkeypatch):
    _, _, dumped = sandbox
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    _stub_fetchers(monkeypatch, {
        "fetch_reddit": [
            _item(title="Same Title", url="", engagement=5, source="reddit"),
            _item(title="Same Title", url="", engagement=3, source="reddit"),
        ],
    })
    aggregator.run()
    news = dumped["payload"]["news"]
    assert len(news) == 1


def test_run_preserves_explicit_lang(sandbox, monkeypatch):
    _, _, dumped = sandbox
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    _stub_fetchers(monkeypatch, {
        "fetch_reddit": [
            _item(title="X", url="http://x/1", engagement=5, source="reddit",
                  lang="fr", platform_region="eu"),
        ],
    })
    aggregator.run()
    news = dumped["payload"]["news"]
    assert news[0]["lang"] == "fr"
    assert news[0]["platform_region"] == "eu"


# ── run(): R1 core source failure ───────────────────────────────────────────

def test_run_core_source_crash_flags_failure(sandbox, monkeypatch):
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    # reddit (a R1 hard-fail source) raises; bilibili succeeds so output is non-empty
    _stub_fetchers(monkeypatch, {
        "fetch_reddit": RuntimeError("reddit down"),
        "fetch_bilibili": [
            _item(title="B", url="http://b/1", engagement=5, source="bilibili"),
        ],
    })
    result = aggregator.run()
    # core source failed per R1 -> returns False and flags
    assert result is False
    assert aggregator.FAILURE_FLAG.exists()


def test_run_noncore_crash_does_not_fail(sandbox, monkeypatch):
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    # steam_news is not a R1 hard-fail source; its crash should not fail the run
    _stub_fetchers(monkeypatch, {
        "fetch_steam_news": RuntimeError("steam news down"),
        "fetch_bilibili": [
            _item(title="B", url="http://b/1", engagement=5, source="bilibili"),
        ],
    })
    result = aggregator.run()
    assert result is True
    assert not aggregator.FAILURE_FLAG.exists()


# ── run(): quality tracker branches ─────────────────────────────────────────

def test_run_quality_tracker_skips_dormant_and_tracks(sandbox, monkeypatch):
    _, _, dumped = sandbox
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)

    tracker = mock.Mock()
    # skip reddit (dormant), allow everything else
    tracker.should_skip_platform.side_effect = lambda sid: sid == "reddit"
    monkeypatch.setattr(aggregator, "_get_quality_tracker", lambda: tracker)
    _stub_fetchers(monkeypatch, {
        "fetch_reddit": [_item(title="should-not-run", url="http://r/1", source="reddit")],
        "fetch_bilibili": [_item(title="B", url="http://b/1", engagement=5, source="bilibili")],
    })
    result = aggregator.run()
    assert result is True
    # reddit fetcher skipped entirely
    aggregator.fetch_reddit.assert_not_called()
    # status updated for at least one non-dormant source
    assert tracker.update_platform_status.called
    titles = {n["title"] for n in dumped["payload"]["news"]}
    assert "should-not-run" not in titles


def test_run_quality_tracker_records_error_on_crash(sandbox, monkeypatch):
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    tracker = mock.Mock()
    tracker.should_skip_platform.return_value = False
    monkeypatch.setattr(aggregator, "_get_quality_tracker", lambda: tracker)
    _stub_fetchers(monkeypatch, {
        "fetch_reddit": RuntimeError("boom"),
        "fetch_bilibili": [_item(title="B", url="http://b/1", engagement=5, source="bilibili")],
    })
    aggregator.run()
    # error path recorded a status with error= kwarg
    err_calls = [c for c in tracker.update_platform_status.call_args_list
                 if c.kwargs.get("error") or (len(c.args) > 2)]
    assert err_calls


# ── run(): playwright fallback branches ─────────────────────────────────────

def test_run_taptap_empty_triggers_playwright_fallback(sandbox, monkeypatch):
    _, _, dumped = sandbox
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    pc = mock.Mock()
    pc.fetch_taptap_playwright.return_value = [
        _item(title="PW", url="http://tt/1", engagement=5, source="taptap")
    ]
    pc.fetch_weibo_playwright.return_value = []
    monkeypatch.setattr(aggregator, "_get_playwright_collectors", lambda: pc)
    _stub_fetchers(monkeypatch, {
        "fetch_taptap": [],  # empty -> playwright fallback
        "fetch_bilibili": [_item(title="B", url="http://b/1", engagement=9, source="bilibili")],
    })
    aggregator.run()
    pc.fetch_taptap_playwright.assert_called_once()
    titles = {n["title"] for n in dumped["payload"]["news"]}
    assert "PW" in titles


def test_run_taptap_crash_recovered_by_playwright(sandbox, monkeypatch):
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    pc = mock.Mock()
    pc.fetch_taptap_playwright.return_value = [
        _item(title="PWrec", url="http://tt/2", engagement=5, source="taptap")
    ]
    pc.fetch_weibo_playwright.return_value = []
    monkeypatch.setattr(aggregator, "_get_playwright_collectors", lambda: pc)
    _stub_fetchers(monkeypatch, {
        "fetch_taptap": RuntimeError("taptap api down"),
        "fetch_bilibili": [_item(title="B", url="http://b/1", engagement=9, source="bilibili")],
    })
    result = aggregator.run()
    # taptap is a R1 source but recovered by playwright -> not flagged
    assert result is True
    assert not aggregator.FAILURE_FLAG.exists()


def test_run_weibo_playwright_source(sandbox, monkeypatch):
    _, _, dumped = sandbox
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    pc = mock.Mock()
    pc.fetch_weibo_playwright.return_value = [
        _item(title="Weibo", url="http://w/1", engagement=5, source="weibo")
    ]
    monkeypatch.setattr(aggregator, "_get_playwright_collectors", lambda: pc)
    _stub_fetchers(monkeypatch, {
        "fetch_bilibili": [_item(title="B", url="http://b/1", engagement=9, source="bilibili")],
    })
    aggregator.run()
    news = dumped["payload"]["news"]
    weibo = next(n for n in news if n["source"] == "weibo")
    assert weibo["lang"] == "zh"
    assert weibo["platform_region"] == "cn"


# ── run(): mark_collection_done ImportError tolerated ────────────────────────

def test_run_mark_collection_done_importerror_tolerated(sandbox, monkeypatch):
    monkeypatch.setattr(aggregator.news_common, "redact_secrets", lambda s: s)
    _stub_fetchers(monkeypatch, {
        "fetch_bilibili": [
            _item(title="B", url="http://b/1", engagement=5, source="bilibili"),
        ],
    })
    # Force the optional import to fail
    real_import = __builtins__["__import__"] if isinstance(__builtins__, dict) else __builtins__.__import__

    def fake_import(name, *a, **k):
        if name == "collection_state":
            raise ImportError("nope")
        return real_import(name, *a, **k)

    with mock.patch("builtins.__import__", side_effect=fake_import):
        result = aggregator.run()
    assert result is True
