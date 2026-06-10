import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
