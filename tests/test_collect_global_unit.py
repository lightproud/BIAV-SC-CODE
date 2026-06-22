"""collect_global coverage for the branches the existing failure-aggregation
test leaves: convert_item media/metadata, _is_recent, build_summary,
load_existing_news, the Playwright fallback + dormant-skip + auth-gated 0-item
paths inside run_zero_cost_collectors, and main()'s success / empty-run exits.

Hermetic: every collector mocked, all output writes stubbed, no network.
"""

import sys
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import collect_global as cg
import global_collectors
import news_common


# ── convert_item ─────────────────────────────────────────────────────────────

class TestConvertItem(unittest.TestCase):
    def test_source_mapped(self):
        out = cg.convert_item({"source": "steam", "title": "t"})
        self.assertEqual(out["source"], "steam_review")

    def test_unknown_source_passthrough(self):
        out = cg.convert_item({"source": "myst", "title": "t"})
        self.assertEqual(out["source"], "myst")

    def test_media_fields_preserved(self):
        out = cg.convert_item({"source": "pixiv", "media_url": "https://x.jpg"})
        self.assertEqual(out["media_url"], "https://x.jpg")
        self.assertEqual(out["content_type"], "image")

    def test_metadata_preserved(self):
        out = cg.convert_item({"source": "x", "metadata": {"plays": 5}})
        self.assertEqual(out["metadata"], {"plays": 5})

    def test_bad_metadata_ignored(self):
        out = cg.convert_item({"source": "x", "metadata": "notadict"})
        self.assertNotIn("metadata", out)

    def test_region_subtype_passthrough(self):
        # 甲方案：采集器标的 region/archive_subtype 必须透传给 archive 端分桶
        out = cg.convert_item({"source": "steam", "region": "jp", "archive_subtype": "review"})
        self.assertEqual(out["region"], "jp")
        self.assertEqual(out["archive_subtype"], "review")

    def test_region_subtype_absent_not_added(self):
        # 缺省不落字段 → archive_platforms 回落扁平，不带字段的源零破坏
        out = cg.convert_item({"source": "steam"})
        self.assertNotIn("region", out)
        self.assertNotIn("archive_subtype", out)


# ── _is_recent / build_summary / load_existing_news ──────────────────────────

class TestRecency(unittest.TestCase):
    def test_empty_time_false(self):
        self.assertFalse(cg._is_recent(""))

    def test_recent_true(self):
        now = datetime.now(timezone.utc).isoformat()
        self.assertTrue(cg._is_recent(now))

    def test_old_false(self):
        old = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
        self.assertFalse(cg._is_recent(old))

    def test_naive_datetime_assumed_utc(self):
        now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        self.assertTrue(cg._is_recent(now))

    def test_bad_time_false(self):
        self.assertFalse(cg._is_recent("not-a-date"))

    def test_sparse_source_wider_window(self):
        # 20 days old: too old for default 24h, but within sparse 30d
        mid = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
        sparse = next(iter(cg.SPARSE_SOURCES)) if cg.SPARSE_SOURCES else None
        if sparse:
            self.assertTrue(cg._is_recent(mid, sparse))


class TestBuildSummary(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(cg.build_summary([]), "")

    def test_joins_titles(self):
        items = [{"title": "Alpha"}, {"title": "Beta"}]
        out = cg.build_summary(items)
        self.assertIn("Alpha", out)
        self.assertTrue(out.endswith("。"))


class TestLoadExistingNews(unittest.TestCase):
    def test_missing_file(self):
        with mock.patch.object(cg, "OUTPUT_PATH", Path("/nonexistent/news.json")):
            self.assertEqual(cg.load_existing_news(), [])

    def test_reads_news_array(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "news.json"
            p.write_text('{"news": [{"title": "x"}]}')
            with mock.patch.object(cg, "OUTPUT_PATH", p):
                self.assertEqual(cg.load_existing_news(), [{"title": "x"}])

    def test_corrupt_returns_empty(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "news.json"
            p.write_text("{bad")
            with mock.patch.object(cg, "OUTPUT_PATH", p):
                self.assertEqual(cg.load_existing_news(), [])


# ── run_zero_cost_collectors special branches ────────────────────────────────

def _item(title, url):
    return {"title": title, "url": url, "engagement": 1}


class TestRunZeroCostBranches(unittest.TestCase):
    """Drive the dormant-skip, playwright-fallback, and auth-gated 0-item
    paths that the existing test doesn't reach."""

    def _patch_all_empty(self, overrides):
        attr_by_name = {
            "Weibo": "fetch_weibo", "App Store": "fetch_appstore_reviews",
            "Pixiv": "fetch_pixiv", "Note.com": "fetch_note_com",
            "Ruliweb": "fetch_ruliweb", "StopGame": "fetch_stopgame",
            "搜狗微信": "fetch_weixin", "YouTube": "fetch_youtube",
            "Bahamut": "fetch_bahamut", "Arca.live": "fetch_arca_live",
            "Google Play": "fetch_google_play", "Twitter": "fetch_twitter",
        }
        patches = []
        for name, attr in attr_by_name.items():
            fn = overrides.get(name, lambda: [])
            patches.append(mock.patch.object(global_collectors, attr, fn))
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])

    def test_dormant_source_skipped(self):
        # A tracker that marks every platform dormant → all skipped, no items.
        tracker = mock.MagicMock()
        tracker.should_skip_platform.return_value = True
        fake_dq = mock.MagicMock()
        fake_dq.SilentPlatformTracker.return_value = tracker
        with mock.patch.object(global_collectors, "_refresh_cutoff", lambda: None), \
                mock.patch.dict(sys.modules, {"data_quality": fake_dq,
                                              "playwright_collectors": None}):
            self._patch_all_empty({"Twitter": lambda: [_item("t", "https://t/1")]})
            items, core_failures = cg.run_zero_cost_collectors()
        self.assertEqual(items, [])
        self.assertEqual(core_failures, [])

    def test_playwright_fallback_on_empty(self):
        # Arca.live returns [] via HTTP → playwright fallback yields items.
        pw_mod = mock.MagicMock()
        pw_mod.fetch_arca_live_playwright = lambda: [_item("pw", "https://pw/1")]
        with mock.patch.object(global_collectors, "_refresh_cutoff", lambda: None), \
                mock.patch.dict(sys.modules, {"data_quality": mock.MagicMock(
                    SilentPlatformTracker=mock.MagicMock(side_effect=Exception("off"))),
                    "playwright_collectors": pw_mod}):
            self._patch_all_empty({"Arca.live": lambda: []})
            items, _ = cg.run_zero_cost_collectors()
        self.assertTrue(any(i["title"] == "pw" for i in items))

    def test_playwright_fallback_on_exception(self):
        # Weibo raises → playwright fallback recovers.
        pw_mod = mock.MagicMock()
        pw_mod.fetch_weibo_playwright = lambda: [_item("recovered", "https://r/1")]

        def boom():
            raise RuntimeError("http down")

        with mock.patch.object(global_collectors, "_refresh_cutoff", lambda: None), \
                mock.patch.dict(sys.modules, {"data_quality": mock.MagicMock(
                    SilentPlatformTracker=mock.MagicMock(side_effect=Exception("off"))),
                    "playwright_collectors": pw_mod}):
            self._patch_all_empty({"Weibo": boom})
            items, _ = cg.run_zero_cost_collectors()
        self.assertTrue(any(i["title"] == "recovered" for i in items))

    def test_auth_gated_zero_graceful(self):
        # Google Play is auth-gated; with no key env + 0 items → graceful, no fail.
        with mock.patch.object(global_collectors, "_refresh_cutoff", lambda: None), \
                mock.patch.dict(sys.modules, {"data_quality": mock.MagicMock(
                    SilentPlatformTracker=mock.MagicMock(side_effect=Exception("off"))),
                    "playwright_collectors": None}), \
                mock.patch.dict(cg.os.environ, {}, clear=True):
            self._patch_all_empty({"Twitter": lambda: [_item("t", "https://t/1")]})
            items, core_failures = cg.run_zero_cost_collectors()
        self.assertEqual(core_failures, [])
        self.assertEqual(len(items), 1)


# ── main() success + empty exit ──────────────────────────────────────────────

class TestMain(unittest.TestCase):
    def test_empty_run_exits_nonzero(self):
        with mock.patch.object(cg, "run_zero_cost_collectors", return_value=([], [])):
            with self.assertRaises(SystemExit) as cm:
                cg.main()
        self.assertEqual(cm.exception.code, 1)

    def test_success_writes_and_returns(self):
        items = [{"title": "T", "url": "https://x/1", "engagement": 9,
                  "time": datetime.now(timezone.utc).isoformat(), "source": "twitter"}]
        with mock.patch.object(cg, "run_zero_cost_collectors", return_value=(items, [])), \
                mock.patch.object(cg, "load_existing_news", return_value=[]), \
                mock.patch.object(news_common, "dump_json_atomic") as dump:
            cg.main()  # no SystemExit on clean success
        # both news.json and news-raw.json written
        self.assertEqual(dump.call_count, 2)

    def test_core_failure_exits_after_write(self):
        items = [{"title": "T", "url": "https://x/1", "engagement": 9,
                  "time": datetime.now(timezone.utc).isoformat(), "source": "twitter"}]
        with mock.patch.object(cg, "run_zero_cost_collectors",
                               return_value=(items, [("youtube", "down")])), \
                mock.patch.object(cg, "load_existing_news", return_value=[]), \
                mock.patch.object(news_common, "dump_json_atomic", lambda *a, **k: None):
            with self.assertRaises(SystemExit) as cm:
                cg.main()
        self.assertEqual(cm.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
