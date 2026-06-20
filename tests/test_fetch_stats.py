import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"))

import fetch_stats


class TestParseNumber(unittest.TestCase):
    def test_plain_integer(self):
        self.assertEqual(fetch_stats.parse_number("1000"), 1000)

    def test_strips_commas_and_spaces(self):
        self.assertEqual(fetch_stats.parse_number(" 12,345 "), 12345)

    def test_first_integer_only(self):
        self.assertEqual(fetch_stats.parse_number("lv 60 -> 5000"), 60)

    def test_no_digits_returns_none(self):
        self.assertIsNone(fetch_stats.parse_number("none"))


class TestExtractStatsFromWikitext(unittest.TestCase):
    def test_infobox_base_pairs(self):
        wt = "|hp = 1000\n|atk = 200\n|def = 50"
        stats = fetch_stats.extract_stats_from_wikitext(wt)
        self.assertEqual(stats["hp"]["base"], 1000)
        self.assertEqual(stats["atk"]["base"], 200)
        self.assertEqual(stats["def"]["base"], 50)
        # max defaults to None when not provided
        self.assertIsNone(stats["hp"]["max"])

    def test_infobox_max_suffix(self):
        wt = "|hp = 1000\n|hp_max = 5000"
        stats = fetch_stats.extract_stats_from_wikitext(wt)
        self.assertEqual(stats["hp"]["base"], 1000)
        self.assertEqual(stats["hp"]["max"], 5000)

    def test_chinese_aliases(self):
        wt = "|生命值 = 1500\n|攻击 = 300"
        stats = fetch_stats.extract_stats_from_wikitext(wt)
        self.assertEqual(stats["hp"]["base"], 1500)
        self.assertEqual(stats["atk"]["base"], 300)

    def test_base_prefix_variant(self):
        wt = "|base_hp = 800"
        stats = fetch_stats.extract_stats_from_wikitext(wt)
        self.assertEqual(stats["hp"]["base"], 800)

    def test_table_range_strategy(self):
        wt = "HP: 1000 / 5000"
        stats = fetch_stats.extract_stats_from_wikitext(wt)
        self.assertEqual(stats["hp"]["base"], 1000)
        self.assertEqual(stats["hp"]["max"], 5000)

    def test_single_value_strategy(self):
        wt = "ATK: 250"
        stats = fetch_stats.extract_stats_from_wikitext(wt)
        self.assertEqual(stats["atk"]["base"], 250)
        self.assertIsNone(stats["atk"]["max"])

    def test_zero_values_rejected(self):
        wt = "|hp = 0"
        self.assertIsNone(fetch_stats.extract_stats_from_wikitext(wt))

    def test_no_stats_returns_none(self):
        self.assertIsNone(fetch_stats.extract_stats_from_wikitext("nothing here"))


class TestStatAliases(unittest.TestCase):
    def test_three_stat_groups_present(self):
        self.assertEqual(set(fetch_stats.STAT_ALIASES), {"hp", "atk", "def"})


if __name__ == "__main__":
    unittest.main()
