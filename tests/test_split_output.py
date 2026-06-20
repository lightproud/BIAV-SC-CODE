import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import split_output


def _iso_hours_ago(hours, tz=timezone.utc):
    return (datetime.now(tz) - timedelta(hours=hours)).isoformat()


class TestIsRecent(unittest.TestCase):
    # max_hours is passed explicitly so the wall clock only ever moves
    # timestamps further into the past (never flips the expected result).

    def test_fresh_timestamp_is_recent(self):
        self.assertTrue(split_output._is_recent(_iso_hours_ago(1), max_hours=24))

    def test_stale_timestamp_not_recent(self):
        self.assertFalse(split_output._is_recent(_iso_hours_ago(25), max_hours=24))

    def test_boundary_is_strict(self):
        # Comparison is strict (<), and elapsed time only grows after the
        # timestamp is built, so exactly max_hours old must be excluded.
        self.assertFalse(split_output._is_recent(_iso_hours_ago(24), max_hours=24))

    def test_naive_timestamp_assumed_utc(self):
        naive = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(tzinfo=None)
        self.assertTrue(split_output._is_recent(naive.isoformat(), max_hours=24))

    def test_empty_string_not_recent(self):
        self.assertFalse(split_output._is_recent("", max_hours=24))

    def test_none_not_recent(self):
        self.assertFalse(split_output._is_recent(None, max_hours=24))

    def test_garbage_not_recent(self):
        self.assertFalse(split_output._is_recent("not-a-date", max_hours=24))

    def test_future_timestamp_is_recent(self):
        # Actual behavior: a future timestamp gives a negative delta < max_hours.
        self.assertTrue(split_output._is_recent(_iso_hours_ago(-2), max_hours=24))


class TestExtractItem(unittest.TestCase):
    def test_field_extraction(self):
        raw = {
            "source": "reddit", "time": "2026-06-09T00:00:00+00:00", "lang": "en",
            "title": "T", "summary": "S", "url": "https://r/1", "author": "a",
            "engagement": 7,
        }
        item = split_output.extract_item(raw)
        self.assertEqual(item, raw)

    def test_missing_fields_use_defaults(self):
        item = split_output.extract_item({})
        self.assertEqual(item["source"], "unknown")
        self.assertEqual(item["title"], "")
        self.assertEqual(item["engagement"], 0)
        self.assertNotIn("media_url", item)
        self.assertNotIn("metadata", item)

    def test_source_alias_normalized(self):
        self.assertEqual(
            split_output.extract_item({"source": "bilibili_articles"})["source"],
            "bilibili",
        )
        self.assertEqual(
            split_output.extract_item({"source": "bilibili_dynamic"})["source"],
            "bilibili",
        )

    def test_media_url_preserved_with_default_content_type(self):
        item = split_output.extract_item({"media_url": "https://img/1.png"})
        self.assertEqual(item["media_url"], "https://img/1.png")
        self.assertEqual(item["content_type"], "image")

    def test_metadata_preserved_only_if_dict(self):
        with_dict = split_output.extract_item({"metadata": {"reply_to": "x"}})
        self.assertEqual(with_dict["metadata"], {"reply_to": "x"})
        with_list = split_output.extract_item({"metadata": ["not", "a", "dict"]})
        self.assertNotIn("metadata", with_list)


class TestExtractSteamItem(unittest.TestCase):
    def test_source_forced_to_steam_and_meta_fields_kept(self):
        raw = {
            "source": "steam_review", "time": "2026-06-09T00:00:00+00:00",
            "title": "Review", "summary": "great game", "url": "u", "author": "a",
            "engagement": 3, "language": "schinese",
            "metadata": {"timestamp_created": 123456,
                         "voted_up": True, "playtime_forever": 99},
        }
        item = split_output.extract_steam_item(raw)
        self.assertEqual(item["source"], "steam")
        self.assertEqual(item["lang"], "schinese")
        self.assertEqual(item["language"], "schinese")
        self.assertTrue(item["voted_up"])
        self.assertEqual(item["timestamp_created"], 123456)
        self.assertEqual(item["playtime_forever"], 99)
        # review duplicates the (untruncated) summary text
        self.assertEqual(item["review"], "great game")
        self.assertEqual(item["summary"], "great game")

    def test_timestamp_derived_from_time_when_meta_missing(self):
        raw = {"time": "2026-06-09T00:00:00Z", "summary": "s"}
        item = split_output.extract_steam_item(raw)
        expected = int(datetime(2026, 6, 9, tzinfo=timezone.utc).timestamp())
        self.assertEqual(item["timestamp_created"], expected)

    def test_bad_time_leaves_timestamp_zero(self):
        item = split_output.extract_steam_item({"time": "not-a-date"})
        self.assertEqual(item["timestamp_created"], 0)

    def test_defaults_for_missing_fields(self):
        item = split_output.extract_steam_item({})
        self.assertEqual(item["source"], "steam")
        self.assertFalse(item["voted_up"])
        self.assertEqual(item["engagement"], 0)
        self.assertEqual(item["playtime_forever"], 0)
        self.assertEqual(item["timestamp_created"], 0)


class TestWriteSourceFile(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.out_dir = Path(self._tmp.name)
        p = mock.patch.object(split_output, "OUTPUT_DIR", self.out_dir)
        p.start()
        self.addCleanup(p.stop)

    def test_writes_wrapped_payload(self):
        items = [{"title": "a"}, {"title": "b"}]
        split_output.write_source_file("reddit", items, "2026-06-19T00:00:00+00:00")
        payload = json.loads((self.out_dir / "reddit-latest.json").read_text("utf-8"))
        self.assertEqual(payload["source"], "reddit")
        self.assertEqual(payload["item_count"], 2)
        self.assertEqual(payload["collected_at"], "2026-06-19T00:00:00+00:00")
        self.assertEqual(payload["items"], items)


class TestMain(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.out_dir = self.root / "output"
        self.out_dir.mkdir()
        self.input_path = self.out_dir / "news.json"
        for attr, val in (("OUTPUT_DIR", self.out_dir), ("INPUT_PATH", self.input_path)):
            p = mock.patch.object(split_output, attr, val)
            p.start()
            self.addCleanup(p.stop)

    def _write_input(self, payload):
        self.input_path.write_text(json.dumps(payload), encoding="utf-8")

    def test_missing_input_exits_nonzero(self):
        # INPUT_PATH does not exist → sys.exit(1).
        with mock.patch("builtins.print"):
            with self.assertRaises(SystemExit) as cm:
                split_output.main()
        self.assertEqual(cm.exception.code, 1)

    def test_groups_known_and_unknown_sources_and_writes_all(self):
        self._write_input({
            "updated_at": "2026-06-19T00:00:00+00:00",
            "news": [
                {"source": "reddit", "time": _iso_hours_ago(1), "title": "r"},
                {"source": "bilibili_articles", "time": _iso_hours_ago(2), "title": "b"},
                # unknown source still gets its own file (future-source path)
                {"source": "mystery", "time": _iso_hours_ago(1), "title": "m"},
            ],
        })
        with mock.patch("builtins.print"):
            split_output.main()
        reddit = json.loads((self.out_dir / "reddit-latest.json").read_text("utf-8"))
        self.assertEqual(reddit["item_count"], 1)
        # alias normalized into bilibili file
        bili = json.loads((self.out_dir / "bilibili-latest.json").read_text("utf-8"))
        self.assertEqual(bili["item_count"], 1)
        # unknown source got a dedicated file
        myst = json.loads((self.out_dir / "mystery-latest.json").read_text("utf-8"))
        self.assertEqual(myst["item_count"], 1)
        all_latest = json.loads((self.out_dir / "all-latest.json").read_text("utf-8"))
        self.assertEqual(all_latest["item_count"], 3)
        self.assertEqual(all_latest["source"], "all")

    @mock.patch.object(split_output, "MAX_AGE_HOURS", 24)
    @mock.patch.object(split_output, "OFFICIAL_MAX_AGE_HOURS", 720)
    def test_old_high_freq_item_filtered_but_sparse_kept(self):
        # reddit (high-freq) at 100h is dropped; official (sparse, 30d window) kept.
        self._write_input({
            "updated_at": "2026-06-19T00:00:00+00:00",
            "news": [
                {"source": "reddit", "time": _iso_hours_ago(100), "title": "old"},
                {"source": "official", "time": _iso_hours_ago(100), "title": "ann"},
            ],
        })
        with mock.patch("builtins.print"):
            split_output.main()
        reddit = json.loads((self.out_dir / "reddit-latest.json").read_text("utf-8"))
        self.assertEqual(reddit["item_count"], 0)
        official = json.loads((self.out_dir / "official-latest.json").read_text("utf-8"))
        self.assertEqual(official["item_count"], 1)

    def test_missing_updated_at_defaults_to_now(self):
        self._write_input({"news": []})
        with mock.patch("builtins.print"):
            split_output.main()
        all_latest = json.loads((self.out_dir / "all-latest.json").read_text("utf-8"))
        # collected_at falls back to a current ISO timestamp (parseable).
        datetime.fromisoformat(all_latest["collected_at"])


if __name__ == "__main__":
    unittest.main()
