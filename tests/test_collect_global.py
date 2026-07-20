import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import collect_global
import global_collectors
import news_common


class TestParseRelativeTime(unittest.TestCase):
    """H4 回归网：各平台时间字段必须归一为 ISO（否则被 _is_recent 静默丢弃）。"""

    def _assert_iso(self, value):
        from datetime import datetime
        iso, approx = news_common.parse_relative_time(value)
        datetime.fromisoformat(iso)  # raises if not ISO
        return iso, approx

    def test_epoch_seconds(self):
        # zhihu created_time 为 epoch 秒
        iso, approx = self._assert_iso(1714003200)
        self.assertTrue(iso.startswith("2024-04-25"))
        self.assertFalse(approx)

    def test_epoch_milliseconds(self):
        # naver writeDateTimestamp 为 epoch 毫秒
        iso, approx = self._assert_iso(1714003200000)
        self.assertTrue(iso.startswith("2024-04-25"))
        self.assertFalse(approx)

    def test_arca_formats(self):
        # arca col-time: "HH:MM" / "MM.DD" 原文
        for raw in ("12:34", "04.25", "2026.04.25"):
            _, approx = self._assert_iso(raw)
            self.assertFalse(approx, raw)

    def test_relative_and_iso(self):
        for raw in ("3小时前", "2 days ago", "2026-04-25T00:00:00+00:00"):
            _, approx = self._assert_iso(raw)
            self.assertFalse(approx, raw)

    def test_empty_falls_back_approximate(self):
        _, approx = self._assert_iso(None)
        self.assertTrue(approx)


class TestRedactSecrets(unittest.TestCase):
    """H3 回归网：异常文本中 URL 查询参数里的密钥必须被掩码。"""

    def test_key_token_cookie_masked(self):
        raw = "403 for url: https://x/api?part=snippet&key=AIzaSECRET&token=tkSECRET&cookie=cSECRET&q=a"
        out = news_common.redact_secrets(raw)
        self.assertNotIn("AIzaSECRET", out)
        self.assertNotIn("tkSECRET", out)
        self.assertNotIn("cSECRET", out)
        self.assertIn("key=***", out)
        self.assertIn("part=snippet", out)  # 非敏感参数保留


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
        # ARCH-01 收敛（decisions.md 2026-06-20）：reddit/bilibili/discord/taptap 已移出 GC
        # 编排（归 AC / archiver），故不在此映射；youtube 为 GC 保留的核心源。
        attr_by_name = {
            "Weibo": "fetch_weibo",
            "App Store": "fetch_appstore_reviews", "Pixiv": "fetch_pixiv",
            "Note.com": "fetch_note_com", "Ruliweb": "fetch_ruliweb",
            "StopGame": "fetch_stopgame", "搜狗微信": "fetch_weixin",
            "YouTube": "fetch_youtube",
            "Bahamut": "fetch_bahamut",
            "Arca.live": "fetch_arca_live", "Google Play": "fetch_google_play",
            "Twitter": "fetch_twitter",
        }
        patches = []
        for name, attr in attr_by_name.items():
            fn = overrides.get(name, lambda: [])
            patches.append(mock.patch.object(global_collectors, attr, fn))
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])

    def test_core_failure_recorded(self):
        # A core source (youtube, GC 保留的核心源) raising must land in core_failures.
        def boom():
            raise RuntimeError("youtube down")

        self._patch_fetchers({
            "YouTube": boom,
            "Twitter": lambda: [_item("t", "https://t/1")],
        })
        items, core_failures = collect_global.run_zero_cost_collectors()
        sources = {s for s, _ in core_failures}
        self.assertIn("youtube", sources)
        self.assertTrue(any("youtube down" in err for _, err in core_failures))

    def test_core_failure_propagates_nonzero_exit(self):
        # main() must exit non-zero when a core source fails (§4.2 R1),
        # even though good items were collected and written.
        def boom():
            raise RuntimeError("youtube down")

        self._patch_fetchers({
            "YouTube": boom,
            "Twitter": lambda: [_item("t", "https://t/1")],
        })
        # Isolate all output writes: main() now persists via news_common.dump_json_atomic
        # (temp file + os.replace), which bypasses builtins.open — so stub it out to a
        # no-op, otherwise the test would clobber the real projects/news/output/*.json.
        with mock.patch.object(collect_global, "load_existing_news", return_value=[]), \
                mock.patch.object(news_common, "dump_json_atomic", lambda *a, **k: None):
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
            "Twitter": lambda: [_item("t", "https://t/1")],
        })
        items, core_failures = collect_global.run_zero_cost_collectors()
        self.assertEqual(core_failures, [])
        self.assertEqual(len(items), 1)

    def test_core_empty_not_hard_failure(self):
        # 设计决策：核心源「静默吐 0」只告警（WARNING）+ 健康层降级，不进 core_failures。
        # 部分核心源（如 taptap）本就低频长期 0，硬失败会让管线永久非零退出。
        # 仅「抛异常」的核心源才进 core_failures（见 test_core_failure_recorded）。
        self._patch_fetchers({
            "Twitter": lambda: [_item("t", "https://t/1")],
            # TapTap / YouTube 等核心源默认返回 []（空）→ 只告警，不入 core_failures
        })
        items, core_failures = collect_global.run_zero_cost_collectors()
        self.assertEqual(core_failures, [])
        self.assertEqual(len(items), 1)

    def test_merge_order_deterministic(self):
        # Concurrent collection must merge in a stable, engagement-sorted order
        # regardless of which thread finishes first.
        def twitter():
            return [{"title": "low", "url": "https://x/low", "engagement": 5}]

        def weibo():
            return [{"title": "high", "url": "https://x/high", "engagement": 50}]

        self._patch_fetchers({"Twitter": twitter, "Weibo": weibo})
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
