import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import aggregator_base as ab


def _item(**overrides):
    """A minimal item that passes validation; override fields per-test."""
    base = {
        "title": "Hello",
        "source": "reddit",
        "time": "2026-06-01T00:00:00+00:00",
        "engagement": 5,
    }
    base.update(overrides)
    return base


class TestStripHtmlTags(unittest.TestCase):
    def test_empty_and_none(self):
        self.assertEqual(ab.strip_html_tags(""), "")
        self.assertEqual(ab.strip_html_tags(None), "")

    def test_removes_tags_keeps_text(self):
        self.assertEqual(ab.strip_html_tags("<b>hi</b>"), "hi")
        # tags stripped even when nested; inner text survives
        self.assertEqual(ab.strip_html_tags("a<script>x</script>b"), "axb")


class TestSanitizeUrl(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(ab.sanitize_url(""), "")

    def test_strips_whitespace(self):
        self.assertEqual(ab.sanitize_url("  https://x.com/a  "), "https://x.com/a")

    def test_bilibili_http_upgraded_to_https(self):
        self.assertEqual(ab.sanitize_url("http://bilibili.com/x"), "https://bilibili.com/x")
        self.assertEqual(ab.sanitize_url("http://www.bilibili.com/x"), "https://www.bilibili.com/x")

    def test_plain_http_kept(self):
        self.assertEqual(ab.sanitize_url("http://other.com"), "http://other.com")

    def test_dangerous_scheme_rejected(self):
        # javascript:/ftp: schemes must not survive sanitisation (XSS guard)
        self.assertEqual(ab.sanitize_url("javascript:alert(1)"), "")
        self.assertEqual(ab.sanitize_url("ftp://host/file"), "")

    def test_relative_url_allowed(self):
        # empty scheme is permitted (relative links)
        self.assertEqual(ab.sanitize_url("path/to/page"), "path/to/page")


class TestSanitizeSummary(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(ab.sanitize_summary(""), "")

    def test_placeholders_dropped(self):
        for placeholder in ("-", "--", "无", "N/A", "null", "none", "暂无"):
            self.assertEqual(ab.sanitize_summary(f"  {placeholder}  "), "")

    def test_html_stripped(self):
        self.assertEqual(ab.sanitize_summary("<i>real text</i>"), "real text")

    def test_normal_trimmed(self):
        self.assertEqual(ab.sanitize_summary("  hello  "), "hello")


class TestValidateNewsItem(unittest.TestCase):
    def test_non_dict_rejected(self):
        self.assertEqual(ab.validate_news_item("not a dict"), (False, None))

    def test_valid_minimal_item(self):
        ok, cleaned = ab.validate_news_item(_item())
        self.assertTrue(ok)
        self.assertEqual(cleaned["title"], "Hello")
        self.assertEqual(cleaned["source"], "reddit")
        self.assertEqual(cleaned["engagement"], 5)
        self.assertEqual(cleaned["url"], "")
        self.assertFalse(cleaned["is_hot"])

    def test_missing_required_field_rejected(self):
        item = _item()
        del item["engagement"]
        self.assertEqual(ab.validate_news_item(item), (False, None))

    def test_unknown_source_rejected(self):
        self.assertEqual(ab.validate_news_item(_item(source="myspace")), (False, None))

    def test_negative_engagement_clamped(self):
        ok, cleaned = ab.validate_news_item(_item(engagement=-9))
        self.assertTrue(ok)
        self.assertEqual(cleaned["engagement"], 0)

    def test_non_numeric_engagement_becomes_zero(self):
        ok, cleaned = ab.validate_news_item(_item(engagement="lots"))
        self.assertTrue(ok)
        self.assertEqual(cleaned["engagement"], 0)

    def test_invalid_time_rejected(self):
        self.assertEqual(ab.validate_news_item(_item(time="last tuesday")), (False, None))

    def test_z_suffixed_time_accepted(self):
        ok, _ = ab.validate_news_item(_item(time="2026-06-01T00:00:00Z"))
        self.assertTrue(ok)

    def test_title_empty_after_sanitize_rejected(self):
        # a title that is pure markup collapses to "" and must be rejected
        self.assertEqual(ab.validate_news_item(_item(title="<b></b>")), (False, None))

    def test_tags_sanitised_and_filtered(self):
        ok, cleaned = ab.validate_news_item(_item(tags=["<b>a</b>", "", "  ", "b"]))
        self.assertTrue(ok)
        self.assertEqual(cleaned["tags"], ["a", "b"])


class TestValidateAllNews(unittest.TestCase):
    def test_filters_invalid_keeps_valid(self):
        items = [_item(title="good"), {"title": "bad"}, _item(source="myspace")]
        valid = ab.validate_all_news(items)
        self.assertEqual([v["title"] for v in valid], ["good"])


if __name__ == "__main__":
    unittest.main()
