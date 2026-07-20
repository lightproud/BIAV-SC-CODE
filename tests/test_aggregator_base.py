import sys
import unittest
from pathlib import Path
from unittest import mock

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import aggregator_base


class TestStripHtmlTags(unittest.TestCase):
    def test_removes_tags(self):
        self.assertEqual(aggregator_base.strip_html_tags("<b>hi</b> <i>x</i>"), "hi x")

    def test_empty_and_none_safe(self):
        self.assertEqual(aggregator_base.strip_html_tags(""), "")
        self.assertEqual(aggregator_base.strip_html_tags(None), "")

    def test_script_payload_stripped(self):
        self.assertEqual(
            aggregator_base.strip_html_tags('<script>alert(1)</script>ok'),
            "alert(1)ok",
        )


class TestSanitizeUrl(unittest.TestCase):
    def test_empty_returns_empty(self):
        self.assertEqual(aggregator_base.sanitize_url(""), "")
        self.assertEqual(aggregator_base.sanitize_url(None), "")

    def test_whitespace_stripped(self):
        self.assertEqual(aggregator_base.sanitize_url("  https://x.com/a  "), "https://x.com/a")

    def test_bilibili_http_upgraded_to_https(self):
        self.assertEqual(
            aggregator_base.sanitize_url("http://www.bilibili.com/video/BV1"),
            "https://www.bilibili.com/video/BV1",
        )
        self.assertEqual(
            aggregator_base.sanitize_url("http://bilibili.com/video/BV1"),
            "https://bilibili.com/video/BV1",
        )

    def test_other_http_not_upgraded(self):
        self.assertEqual(aggregator_base.sanitize_url("http://example.com/a"), "http://example.com/a")

    def test_bad_scheme_rejected(self):
        self.assertEqual(aggregator_base.sanitize_url("javascript:alert(1)"), "")
        self.assertEqual(aggregator_base.sanitize_url("ftp://example.com/f"), "")

    def test_schemeless_url_passes(self):
        # urlparse scheme '' is explicitly allowed by sanitize_url
        self.assertEqual(aggregator_base.sanitize_url("/relative/path"), "/relative/path")


class TestSanitizeSummary(unittest.TestCase):
    def test_empty_returns_empty(self):
        self.assertEqual(aggregator_base.sanitize_summary(""), "")
        self.assertEqual(aggregator_base.sanitize_summary(None), "")

    def test_placeholders_filtered(self):
        for placeholder in ("-", "--", "无", "N/A", "null", "none", "暂无"):
            self.assertEqual(aggregator_base.sanitize_summary(placeholder), "")

    def test_html_stripped_and_trimmed(self):
        self.assertEqual(aggregator_base.sanitize_summary("  <p>hello</p>  "), "hello")


def _valid_item(**overrides):
    item = {
        "title": "Morimens news",
        "source": "reddit",
        "time": "2026-06-09T12:00:00+00:00",
        "engagement": 10,
    }
    item.update(overrides)
    return item


class TestValidateNewsItem(unittest.TestCase):
    def test_valid_minimal_item(self):
        ok, cleaned = aggregator_base.validate_news_item(_valid_item())
        self.assertTrue(ok)
        self.assertEqual(cleaned["title"], "Morimens news")
        self.assertEqual(cleaned["engagement"], 10)
        self.assertEqual(cleaned["summary"], "")
        self.assertEqual(cleaned["tags"], [])
        self.assertFalse(cleaned["is_hot"])

    def test_non_dict_rejected(self):
        self.assertEqual(aggregator_base.validate_news_item("nope"), (False, None))

    def test_missing_required_field_rejected(self):
        item = _valid_item()
        del item["time"]
        self.assertEqual(aggregator_base.validate_news_item(item), (False, None))

    def test_empty_string_field_rejected(self):
        ok, _ = aggregator_base.validate_news_item(_valid_item(title=""))
        self.assertFalse(ok)

    def test_unknown_source_rejected(self):
        ok, _ = aggregator_base.validate_news_item(_valid_item(source="myspace"))
        self.assertFalse(ok)

    def test_bad_time_rejected(self):
        ok, _ = aggregator_base.validate_news_item(_valid_item(time="yesterday"))
        self.assertFalse(ok)

    def test_zulu_time_accepted(self):
        ok, _ = aggregator_base.validate_news_item(_valid_item(time="2026-06-09T12:00:00Z"))
        self.assertTrue(ok)

    def test_negative_engagement_clamped_to_zero(self):
        ok, cleaned = aggregator_base.validate_news_item(_valid_item(engagement=-5))
        self.assertTrue(ok)
        self.assertEqual(cleaned["engagement"], 0)

    def test_non_numeric_engagement_defaults_to_zero(self):
        # Item stays valid; bad engagement is coerced, not rejected.
        ok, cleaned = aggregator_base.validate_news_item(_valid_item(engagement="lots"))
        self.assertTrue(ok)
        self.assertEqual(cleaned["engagement"], 0)

    def test_title_only_html_rejected(self):
        ok, _ = aggregator_base.validate_news_item(_valid_item(title="<b></b>"))
        self.assertFalse(ok)

    def test_tags_sanitized_and_empties_dropped(self):
        ok, cleaned = aggregator_base.validate_news_item(
            _valid_item(tags=["<i>art</i>", "", "  ", "news"])
        )
        self.assertTrue(ok)
        self.assertEqual(cleaned["tags"], ["art", "news"])

    def test_media_url_preserved_with_default_content_type(self):
        ok, cleaned = aggregator_base.validate_news_item(
            _valid_item(media_url="https://img.example.com/a.png")
        )
        self.assertTrue(ok)
        self.assertEqual(cleaned["media_url"], "https://img.example.com/a.png")
        self.assertEqual(cleaned["content_type"], "image")

    def test_metadata_and_language_preserved(self):
        ok, cleaned = aggregator_base.validate_news_item(
            _valid_item(language="zh", metadata={"play": 100})
        )
        self.assertTrue(ok)
        self.assertEqual(cleaned["language"], "zh")
        self.assertEqual(cleaned["metadata"], {"play": 100})

    def test_lang_field_preserved(self):
        ok, cleaned = aggregator_base.validate_news_item(_valid_item(lang="ja"))
        self.assertTrue(ok)
        self.assertEqual(cleaned["lang"], "ja")

    def test_region_and_subtype_preserved(self):
        # 甲方案：AC 栈 item 的 region/archive_subtype 须过白名单存活，供 archive 分桶
        ok, cleaned = aggregator_base.validate_news_item(
            _valid_item(region="jp", archive_subtype="review")
        )
        self.assertTrue(ok)
        self.assertEqual(cleaned["region"], "jp")
        self.assertEqual(cleaned["archive_subtype"], "review")

    def test_region_subtype_absent_not_added(self):
        # 缺省不落字段 → archive_platforms 回落扁平，不带字段的源零破坏
        ok, cleaned = aggregator_base.validate_news_item(_valid_item())
        self.assertTrue(ok)
        self.assertNotIn("region", cleaned)
        self.assertNotIn("archive_subtype", cleaned)


class TestValidateAllNews(unittest.TestCase):
    def test_filters_invalid_keeps_valid(self):
        items = [_valid_item(), {"title": "no other fields"}, "garbage"]
        valid = aggregator_base.validate_all_news(items)
        self.assertEqual(len(valid), 1)
        self.assertEqual(valid[0]["title"], "Morimens news")

    def test_empty_input(self):
        self.assertEqual(aggregator_base.validate_all_news([]), [])


class TestGenerateSummary(unittest.TestCase):
    def _news(self, n, hot_indices=()):
        return [
            {"title": f"topic {i}", "is_hot": i in hot_indices, "source": "reddit"}
            for i in range(n)
        ]

    def test_no_api_key_uses_hot_items(self):
        with mock.patch.dict(aggregator_base.os.environ, {}, clear=True):
            out = aggregator_base.generate_summary(self._news(6, hot_indices=(2,)))
        self.assertEqual(out, "今日热门话题：topic 2。")

    def test_no_api_key_no_hot_falls_back_to_first_five(self):
        with mock.patch.dict(aggregator_base.os.environ, {}, clear=True):
            out = aggregator_base.generate_summary(self._news(7))
        self.assertEqual(out, "今日热门话题：topic 0；topic 1；topic 2；topic 3；topic 4。")

    def test_empty_items_returns_empty_template(self):
        with mock.patch.dict(aggregator_base.os.environ, {"LLM_API_KEY": "k"}):
            out = aggregator_base.generate_summary([])
        self.assertEqual(out, "今日热门话题：。")

    def test_llm_success_returns_api_text(self):
        resp = mock.MagicMock()
        resp.json.return_value = {"content": [{"text": "LLM 总结"}]}
        with mock.patch.dict(aggregator_base.os.environ, {"LLM_API_KEY": "k"}), \
                mock.patch.object(aggregator_base.requests, "post", return_value=resp) as post:
            out = aggregator_base.generate_summary(self._news(3))
        self.assertEqual(out, "LLM 总结")
        post.assert_called_once()

    def test_llm_failure_falls_back_to_hot_only(self):
        # NOTE: actual behavior — the LLM-failure fallback only uses is_hot items
        # and does NOT fall back to the first 5 when none are hot.
        with mock.patch.dict(aggregator_base.os.environ, {"LLM_API_KEY": "k"}), \
                mock.patch.object(aggregator_base.requests, "post",
                                  side_effect=RuntimeError("api down")):
            out = aggregator_base.generate_summary(self._news(3))
        self.assertEqual(out, "今日热门话题：。")


class TestGetPlaywrightCollectors(unittest.TestCase):
    def setUp(self):
        # Reset the module-level memoization so each test drives a fresh probe.
        self._saved = (
            aggregator_base._playwright_collectors,
            aggregator_base._playwright_import_attempted,
            aggregator_base._playwright_runtime_available,
        )

        def _restore():
            (aggregator_base._playwright_collectors,
             aggregator_base._playwright_import_attempted,
             aggregator_base._playwright_runtime_available) = self._saved
        self.addCleanup(_restore)
        aggregator_base._playwright_collectors = None
        aggregator_base._playwright_import_attempted = False
        aggregator_base._playwright_runtime_available = None

    def test_runtime_missing_returns_none(self):
        # Simulate playwright runtime not installed → quiet None.
        with mock.patch("importlib.import_module", side_effect=ImportError("no pw")):
            self.assertIsNone(aggregator_base._get_playwright_collectors())
        self.assertFalse(aggregator_base._playwright_runtime_available)

    def test_memoized_after_first_attempt(self):
        with mock.patch("importlib.import_module", side_effect=ImportError("no pw")):
            aggregator_base._get_playwright_collectors()
        # Second call returns cached result without re-probing import_module.
        with mock.patch("importlib.import_module",
                        side_effect=AssertionError("should not re-import")):
            self.assertIsNone(aggregator_base._get_playwright_collectors())

    def test_runtime_present_loads_collectors_module(self):
        import types
        fake_pc = types.ModuleType("playwright_collectors")
        with mock.patch("importlib.import_module", return_value=mock.MagicMock()), \
                mock.patch.dict(sys.modules, {"playwright_collectors": fake_pc}):
            out = aggregator_base._get_playwright_collectors()
        self.assertIs(out, fake_pc)


class TestGetWithRetry(unittest.TestCase):
    def _resp(self, status):
        r = mock.MagicMock()
        r.status_code = status
        return r

    def test_success_2xx_returned_immediately(self):
        ok = self._resp(200)
        with mock.patch.object(aggregator_base.requests, "get", return_value=ok) as g, \
                mock.patch.object(aggregator_base.time, "sleep"):
            out = aggregator_base._get_with_retry("https://x.com", retries=2)
        self.assertIs(out, ok)
        g.assert_called_once()

    def test_4xx_returned_without_retry(self):
        # Divergent semantics: 4xx is returned, not retried (caller inspects status).
        notfound = self._resp(404)
        with mock.patch.object(aggregator_base.requests, "get", return_value=notfound) as g, \
                mock.patch.object(aggregator_base.time, "sleep"):
            out = aggregator_base._get_with_retry("https://x.com", retries=2)
        self.assertEqual(out.status_code, 404)
        g.assert_called_once()

    def test_5xx_retried_then_returned_on_last_attempt(self):
        err = self._resp(503)
        with mock.patch.object(aggregator_base.requests, "get", return_value=err) as g, \
                mock.patch.object(aggregator_base.time, "sleep"):
            out = aggregator_base._get_with_retry("https://x.com", retries=2)
        # 503 keeps retrying; on the final attempt the response is returned anyway.
        self.assertEqual(out.status_code, 503)
        self.assertEqual(g.call_count, 3)

    def test_timeout_retried_then_raised(self):
        with mock.patch.object(aggregator_base.requests, "get",
                               side_effect=requests.exceptions.Timeout("slow")), \
                mock.patch.object(aggregator_base.time, "sleep"):
            with self.assertRaises(requests.exceptions.Timeout):
                aggregator_base._get_with_retry("https://x.com", retries=1)

    def test_connection_error_recovers_on_retry(self):
        good = self._resp(200)
        with mock.patch.object(
                aggregator_base.requests, "get",
                side_effect=[requests.exceptions.ConnectionError("x"), good]) as g, \
                mock.patch.object(aggregator_base.time, "sleep"):
            out = aggregator_base._get_with_retry("https://x.com", retries=2)
        self.assertIs(out, good)
        self.assertEqual(g.call_count, 2)


class TestGetQualityTracker(unittest.TestCase):
    def test_returns_none_on_import_error(self):
        # Force the `from scripts.data_quality import ...` to fail.
        with mock.patch.dict(sys.modules, {"scripts.data_quality": None}):
            self.assertIsNone(aggregator_base._get_quality_tracker())

    def test_returns_tracker_when_import_succeeds(self):
        # Inject a fake scripts.data_quality exposing SilentPlatformTracker so the
        # success path (instance construction) is exercised.
        import types
        sentinel = object()
        fake_mod = types.ModuleType("scripts.data_quality")
        fake_mod.SilentPlatformTracker = lambda: sentinel
        fake_pkg = types.ModuleType("scripts")
        fake_pkg.data_quality = fake_mod
        with mock.patch.dict(sys.modules, {"scripts": fake_pkg,
                                           "scripts.data_quality": fake_mod}):
            self.assertIs(aggregator_base._get_quality_tracker(), sentinel)


if __name__ == "__main__":
    unittest.main()


class TestValidSourcesRegistry(unittest.TestCase):
    """VALID_SOURCES 必须从 sources.py 单一真相源派生（2026-07-02 修复：
    私有硬编码白名单漏掉 taptap_review，采到的评论被整批丢弃）。"""

    def test_superset_of_known_sources(self):
        import sources
        self.assertTrue(set(sources.KNOWN_SOURCES) <= aggregator_base.VALID_SOURCES)

    def test_contains_raw_alias_names(self):
        import sources
        self.assertTrue(set(sources.SOURCE_ALIASES) <= aggregator_base.VALID_SOURCES)

    def test_taptap_review_accepted(self):
        ok, _ = aggregator_base.validate_news_item({
            'title': 't', 'source': 'taptap_review',
            'time': '2026-07-02T00:00:00Z', 'engagement': 1, 'url': 'https://x.co'})
        self.assertTrue(ok)


class TestValidationDrops(unittest.TestCase):
    """P0-3 静默丢弃一等指标：丢弃必须被按源计数并可落盘。"""

    def setUp(self):
        aggregator_base.VALIDATION_DROPS.clear()

    def test_dropped_items_counted_by_source(self):
        aggregator_base.validate_all_news([
            {'title': 'a', 'source': 'ghost', 'time': '2026-07-02T00:00:00Z', 'engagement': 1},
            {'title': 'b', 'source': 'ghost', 'time': '2026-07-02T00:00:00Z', 'engagement': 1},
            {'title': 'c', 'source': 'reddit', 'time': '2026-07-02T00:00:00Z', 'engagement': 1},
            'not-a-dict',
        ])
        self.assertEqual(aggregator_base.VALIDATION_DROPS.get('ghost'), 2)
        self.assertEqual(aggregator_base.VALIDATION_DROPS.get('malformed'), 1)
        self.assertNotIn('reddit', aggregator_base.VALIDATION_DROPS)

    def test_write_validation_drops_zero_state(self):
        import tempfile, json as j, os
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'drops.json')
            payload = aggregator_base.write_validation_drops(p)
            self.assertEqual(payload['total_dropped'], 0)
            self.assertEqual(j.load(open(p))['by_source'], {})
