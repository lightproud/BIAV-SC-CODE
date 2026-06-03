import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import collect_global
import global_collectors


class TestDedupKey(unittest.TestCase):
    def test_url_first(self):
        self.assertEqual(collect_global.dedup_key({"url": "https://x.com/a"}), "https://x.com/a")

    def test_url_normalized(self):
        # http->https, trailing slash and whitespace stripped, so the same
        # article from two collectors collapses to one dedup key.
        a = collect_global.dedup_key({"url": " http://x.com/a/ "})
        b = collect_global.dedup_key({"url": "https://x.com/a"})
        self.assertEqual(a, b)

    def test_title_source_author_fallback(self):
        key = collect_global.dedup_key({"title": "T", "source": "S", "author": "A"})
        self.assertEqual(key, "T|S|A")

    def test_empty_url_falls_back(self):
        # blank url must not collapse unrelated items onto the same key
        k1 = collect_global.dedup_key({"url": "", "title": "One", "source": "S"})
        k2 = collect_global.dedup_key({"url": "", "title": "Two", "source": "S"})
        self.assertNotEqual(k1, k2)


def _item(title, url):
    """Minimal report-system item recognized by run_zero_cost_collectors."""
    return {"title": title, "url": url, "engagement": 1}


class TestFailureAggregation(unittest.TestCase):
    """RISK-01 regression net: the ThreadPoolExecutor failure-aggregation path.

    Hermetic — every collector is a mock, no network/playwright/tracker state.
    """

    def setUp(self):
        # Neutralize side-effecting helpers so the run is fully in-memory.
        # _refresh_cutoff just resets module time state; make it a no-op.
        self._patches = [
            mock.patch.object(global_collectors, "_refresh_cutoff", lambda: None),
            # No tracker → no dormant skipping, no state-file writes.
            mock.patch.dict(sys.modules, {"data_quality": mock.MagicMock(
                SilentPlatformTracker=mock.MagicMock(side_effect=Exception("disabled")))}),
            # No playwright module → no fallback ever fires.
            mock.patch.dict(sys.modules, {"playwright_collectors": None}),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in reversed(self._patches):
            p.stop()

    def _patch_fetchers(self, overrides):
        """Patch every global collector to return []; apply overrides on top.

        overrides: name(str) → callable. Names match collect_global display
        names mapped through NAME_TO_SOURCE_ID.
        """
        # Map display name → global_collectors attribute used by the fetcher list.
        attr_by_name = {
            "Bilibili": "fetch_bilibili", "Reddit": "fetch_reddit", "NGA": "fetch_nga",
            "TapTap": "fetch_taptap", "Weibo": "fetch_weibo", "Zhihu": "fetch_zhihu",
            "Naver Cafe": "fetch_naver_cafe", "5ch": "fetch_fivech",
            "App Store": "fetch_appstore_reviews", "Pixiv": "fetch_pixiv",
            "Note.com": "fetch_note_com", "Ruliweb": "fetch_ruliweb",
            "StopGame": "fetch_stopgame", "搜狗微信": "fetch_weixin",
            "YouTube": "fetch_youtube", "Discord API": "fetch_discord",
            "Telegram": "fetch_telegram", "Bahamut": "fetch_bahamut",
            "Arca.live": "fetch_arca_live", "Google Play": "fetch_google_play",
        }
        patches = []
        for name, attr in attr_by_name.items():
            fn = overrides.get(name, lambda: [])
            patches.append(mock.patch.object(global_collectors, attr, fn))
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])

    def test_core_failure_recorded(self):
        # A core source (bilibili) raising must land in core_failures.
        def boom():
            raise RuntimeError("bilibili down")

        self._patch_fetchers({
            "Bilibili": boom,
            "Reddit": lambda: [_item("r", "https://r/1")],
        })
        items, core_failures = collect_global.run_zero_cost_collectors()
        sources = {s for s, _ in core_failures}
        self.assertIn("bilibili", sources)
        self.assertTrue(any("bilibili down" in err for _, err in core_failures))

    def test_core_failure_propagates_nonzero_exit(self):
        # main() must exit non-zero when a core source fails (§4.2 R1),
        # even though good items were collected and written.
        def boom():
            raise RuntimeError("nga down")

        self._patch_fetchers({
            "NGA": boom,
            "Reddit": lambda: [_item("r", "https://r/1")],
        })
        with mock.patch.object(collect_global, "load_existing_news", return_value=[]), \
                mock.patch("builtins.open", mock.mock_open()), \
                mock.patch.object(collect_global.Path, "mkdir", lambda *a, **k: None):
            with self.assertRaises(SystemExit) as cm:
                collect_global.main()
        self.assertEqual(cm.exception.code, 1)

    def test_non_core_failure_tolerated(self):
        # A non-core source (zhihu) failing must NOT be recorded as a core
        # failure; the run still yields the good items.
        def boom():
            raise RuntimeError("zhihu down")

        self._patch_fetchers({
            "Zhihu": boom,
            "Reddit": lambda: [_item("r", "https://r/1")],
        })
        items, core_failures = collect_global.run_zero_cost_collectors()
        self.assertEqual(core_failures, [])
        self.assertEqual(len(items), 1)

    def test_merge_order_deterministic(self):
        # Concurrent collection must merge in a stable, engagement-sorted order
        # regardless of which thread finishes first.
        def reddit():
            return [{"title": "low", "url": "https://x/low", "engagement": 5}]

        def nga():
            return [{"title": "high", "url": "https://x/high", "engagement": 50}]

        self._patch_fetchers({"Reddit": reddit, "NGA": nga})
        items, core_failures = collect_global.run_zero_cost_collectors()
        self.assertEqual(core_failures, [])
        merged = collect_global.merge_and_dedup([], items, apply_recency_filter=False)
        titles = [m["title"] for m in merged]
        self.assertEqual(titles, ["high", "low"])

    def test_import_failure_returns_two_tuple(self):
        # R2-L5: ImportError early-return must still be a 2-tuple so main()
        # can unpack (items, core_failures) without ValueError.
        with mock.patch.dict(sys.modules, {"global_collectors": None}):
            result = collect_global.run_zero_cost_collectors()
        self.assertEqual(result, ([], []))


if __name__ == "__main__":
    unittest.main()
