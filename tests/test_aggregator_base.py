import sys
import unittest
from pathlib import Path
from unittest import mock

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


if __name__ == "__main__":
    unittest.main()
