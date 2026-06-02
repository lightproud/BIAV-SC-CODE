import sys
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import split_output as so


class TestIsRecent(unittest.TestCase):
    def test_empty_is_not_recent(self):
        self.assertFalse(so._is_recent(""))

    def test_garbage_is_not_recent(self):
        self.assertFalse(so._is_recent("not a date", max_hours=24))

    def test_within_window(self):
        now = datetime.now(timezone.utc).isoformat()
        self.assertTrue(so._is_recent(now, max_hours=24))

    def test_outside_window(self):
        old = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
        self.assertFalse(so._is_recent(old, max_hours=24))

    def test_naive_timestamp_assumed_utc(self):
        # a tz-naive recent stamp should still count as recent (treated as UTC)
        naive = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        self.assertTrue(so._is_recent(naive, max_hours=24))


class TestExtractItem(unittest.TestCase):
    def test_source_alias_normalised(self):
        item = so.extract_item({"source": "bilibili_articles", "title": "t"})
        self.assertEqual(item["source"], "bilibili")

    def test_defaults_filled(self):
        item = so.extract_item({"source": "reddit"})
        self.assertEqual(item["engagement"], 0)
        self.assertEqual(item["title"], "")
        self.assertNotIn("media_url", item)

    def test_media_fields_preserved_with_default_type(self):
        item = so.extract_item({"source": "reddit", "media_url": "https://x/y.png"})
        self.assertEqual(item["media_url"], "https://x/y.png")
        self.assertEqual(item["content_type"], "image")

    def test_metadata_dict_preserved(self):
        item = so.extract_item({"source": "discord", "metadata": {"reply_count": 3}})
        self.assertEqual(item["metadata"], {"reply_count": 3})

    def test_non_dict_metadata_dropped(self):
        item = so.extract_item({"source": "discord", "metadata": "oops"})
        self.assertNotIn("metadata", item)


class TestExtractSteamItem(unittest.TestCase):
    def test_source_forced_to_steam(self):
        item = so.extract_steam_item({"source": "steam_review", "title": "t"})
        self.assertEqual(item["source"], "steam")

    def test_review_mirrors_summary(self):
        item = so.extract_steam_item({"summary": "great game"})
        self.assertEqual(item["review"], "great game")
        self.assertEqual(item["summary"], "great game")

    def test_voted_up_read_from_metadata(self):
        item = so.extract_steam_item({"metadata": {"voted_up": True}})
        self.assertTrue(item["voted_up"])

    def test_timestamp_derived_from_time_when_missing(self):
        # no metadata.timestamp_created -> derive epoch from ISO time field
        item = so.extract_steam_item({"time": "2026-06-01T00:00:00+00:00"})
        expected = int(datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp())
        self.assertEqual(item["timestamp_created"], expected)


if __name__ == "__main__":
    unittest.main()
