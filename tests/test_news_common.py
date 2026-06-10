import socket
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import news_common


class TestStripHtml(unittest.TestCase):
    def test_removes_tags(self):
        self.assertEqual(news_common.strip_html("<a href='x'>link</a> text"), "link text")

    def test_empty_and_none_safe(self):
        self.assertEqual(news_common.strip_html(""), "")
        self.assertEqual(news_common.strip_html(None), "")

    def test_plain_text_untouched(self):
        self.assertEqual(news_common.strip_html("a < b and c"), "a < b and c")


class TestMakeItem(unittest.TestCase):
    def test_basic_fields_and_defaults(self):
        item = news_common.make_item(
            "Title", "Summary", "reddit", "global", "2026-06-09T00:00:00+00:00",
            "https://r.com/1",
        )
        self.assertEqual(item["title"], "Title")
        self.assertEqual(item["summary"], "Summary")
        self.assertEqual(item["source"], "reddit")
        self.assertEqual(item["engagement"], 0)
        self.assertFalse(item["is_hot"])
        self.assertEqual(item["tags"], [])
        self.assertEqual(item["content_type"], "text")
        self.assertEqual(item["media_url"], "")
        # flag is omitted entirely when not approximate
        self.assertNotIn("time_is_approximate", item)

    def test_html_stripped_and_trimmed(self):
        item = news_common.make_item(
            " <b>T</b> ", "<p>S</p>", "nga", "cn", "2026-06-09T00:00:00+00:00", "u")
        self.assertEqual(item["title"], "T")
        self.assertEqual(item["summary"], "S")

    def test_none_title_and_url_safe(self):
        item = news_common.make_item(None, None, "nga", "cn", "t", None)
        self.assertEqual(item["title"], "")
        self.assertEqual(item["summary"], "")
        self.assertEqual(item["url"], "")

    def test_author_coerced_to_str(self):
        item = news_common.make_item("T", "", "nga", "cn", "t", "u", author=123)
        self.assertEqual(item["author"], "123")

    def test_time_is_approximate_flag_set(self):
        item = news_common.make_item("T", "", "nga", "cn", "t", "u",
                                     time_is_approximate=True)
        self.assertIs(item["time_is_approximate"], True)


def _addrinfo(*ips):
    """Build socket.getaddrinfo-shaped results for the given IP strings."""
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0)) for ip in ips]


class TestIsSafeUrl(unittest.TestCase):
    """SSRF guard — DNS resolution is mocked, no real lookups."""

    def _check(self, url, ips=None, side_effect=None):
        with mock.patch.object(news_common.socket, "getaddrinfo",
                               side_effect=side_effect,
                               return_value=_addrinfo(*(ips or []))) as gai:
            result = news_common.is_safe_url(url)
        return result, gai

    def test_public_ip_accepted(self):
        result, _ = self._check("https://example.com/page", ips=["93.184.216.34"])
        self.assertTrue(result)

    def test_http_scheme_also_allowed(self):
        result, _ = self._check("http://example.com", ips=["93.184.216.34"])
        self.assertTrue(result)

    def test_private_10_rejected(self):
        result, _ = self._check("https://internal.example.com", ips=["10.0.0.5"])
        self.assertFalse(result)

    def test_loopback_127_rejected(self):
        result, _ = self._check("https://localhost", ips=["127.0.0.1"])
        self.assertFalse(result)

    def test_link_local_169_254_rejected(self):
        # AWS metadata endpoint class
        result, _ = self._check("http://metadata.example.com", ips=["169.254.169.254"])
        self.assertFalse(result)

    def test_private_192_168_rejected(self):
        result, _ = self._check("https://router.example.com", ips=["192.168.1.1"])
        self.assertFalse(result)

    def test_any_private_in_mixed_results_rejects_all(self):
        # One safe + one private resolution must reject (DNS rebinding guard).
        result, _ = self._check("https://evil.example.com",
                                ips=["93.184.216.34", "10.0.0.1"])
        self.assertFalse(result)

    def test_ipv6_loopback_rejected(self):
        result, _ = self._check("https://v6.example.com", ips=["::1"])
        self.assertFalse(result)

    def test_non_http_scheme_rejected_without_dns(self):
        result, gai = self._check("ftp://example.com/file")
        self.assertFalse(result)
        gai.assert_not_called()

    def test_file_scheme_rejected(self):
        result, _ = self._check("file:///etc/passwd")
        self.assertFalse(result)

    def test_missing_host_rejected(self):
        result, _ = self._check("http://")
        self.assertFalse(result)

    def test_malformed_url_rejected(self):
        result, _ = self._check("not a url at all")
        self.assertFalse(result)

    def test_dns_failure_rejected(self):
        result, _ = self._check("https://nxdomain.example.com",
                                side_effect=socket.gaierror("NXDOMAIN"))
        self.assertFalse(result)


if __name__ == "__main__":
    unittest.main()
