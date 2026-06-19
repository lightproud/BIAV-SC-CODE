import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"))

import fetch_wheels


class TestCleanWikitext(unittest.TestCase):
    def test_strips_html_tags(self):
        self.assertEqual(fetch_wheels.clean_wikitext("<b>bold</b> text"), "bold text")

    def test_converts_piped_link_to_display(self):
        self.assertEqual(fetch_wheels.clean_wikitext("[[Target|Display]]"), "Display")

    def test_converts_plain_link(self):
        self.assertEqual(fetch_wheels.clean_wikitext("[[Erica]]"), "Erica")

    def test_removes_file_links_and_templates(self):
        self.assertEqual(
            fetch_wheels.clean_wikitext("[[File:x.png]]{{Infobox}}keep").strip(),
            "keep",
        )

    def test_strips_bold_italic_and_collapses_whitespace(self):
        self.assertEqual(fetch_wheels.clean_wikitext("'''A'''   B"), "A B")


class TestExtractSection(unittest.TestCase):
    def test_extracts_matching_heading(self):
        wt = "==Effect==\nDeals damage.\n==Stats==\nHP 100"
        self.assertEqual(fetch_wheels.extract_section(wt, ["Effect"]), "Deals damage.")

    def test_case_insensitive(self):
        wt = "==effect==\nbody text"
        self.assertEqual(fetch_wheels.extract_section(wt, ["Effect"]), "body text")

    def test_returns_none_when_absent(self):
        self.assertIsNone(fetch_wheels.extract_section("no headings", ["Effect"]))

    def test_section_runs_to_end_of_text(self):
        wt = "==Effect==\nlast section content"
        self.assertEqual(
            fetch_wheels.extract_section(wt, ["Effect"]), "last section content"
        )


class TestParseWheelData(unittest.TestCase):
    def test_effect_from_section(self):
        wt = "==Effect==\nThis is a long enough effect description here."
        result = fetch_wheels.parse_wheel_data(wt)
        self.assertIn("effect_en", result)
        self.assertIn("long enough effect", result["effect_en"])

    def test_effect_from_template_field(self):
        wt = "{{Infobox\n|effect = A sufficiently long passive effect string\n}}"
        result = fetch_wheels.parse_wheel_data(wt)
        self.assertIn("A sufficiently long passive", result["effect_en"])

    def test_recommended_split_into_names(self):
        wt = "==Recommended Characters==\nErica, Pandya / Lily"
        result = fetch_wheels.parse_wheel_data(wt)
        self.assertEqual(result["recommended_en"], ["Erica", "Pandya", "Lily"])

    def test_base_stats_captured(self):
        wt = "==Base Stats==\nHP 1000 ATK 200 DEF 50"
        result = fetch_wheels.parse_wheel_data(wt)
        self.assertIn("base_stats_en", result)

    def test_empty_wikitext_yields_empty_dict(self):
        self.assertEqual(fetch_wheels.parse_wheel_data(""), {})


class TestNeedsUpdate(unittest.TestCase):
    def test_missing_effect(self):
        self.assertTrue(fetch_wheels.needs_update({}))

    def test_short_effect(self):
        self.assertTrue(fetch_wheels.needs_update({"effect": "short"}))

    def test_long_effect_does_not_need_update(self):
        self.assertFalse(
            fetch_wheels.needs_update({"effect": "x" * (fetch_wheels.MIN_EFFECT_LENGTH + 1)})
        )


class TestCollectWheels(unittest.TestCase):
    def test_collects_only_those_needing_update(self):
        data = {
            "wheels_of_destiny": {
                "ssr_standard": [
                    {"name": "A", "effect": ""},                         # needs
                    {"name": "B", "effect": "x" * 50},                   # complete
                ],
                "sr_wheels": [
                    {"name": "C", "effect": "tiny"},                     # needs
                ],
            }
        }
        result = fetch_wheels.collect_wheels(data)
        cats_idx = [(c, i) for c, i, _ in result]
        self.assertIn(("ssr_standard", 0), cats_idx)
        self.assertIn(("sr_wheels", 0), cats_idx)
        self.assertNotIn(("ssr_standard", 1), cats_idx)

    def test_empty_data(self):
        self.assertEqual(fetch_wheels.collect_wheels({}), [])


class TestFetchWheelInfoNoName(unittest.TestCase):
    def test_returns_empty_without_name_en(self):
        # No network: short-circuits before any HTTP call
        self.assertEqual(fetch_wheels.fetch_wheel_info({}), {})


class TestApplyUpdate(unittest.TestCase):
    def test_applies_effect_and_marks_changed(self):
        wheel = {}
        info = {"effect_en": "new effect", "_wiki_source": "src", "_wiki_page": "pg"}
        self.assertTrue(fetch_wheels.apply_update(wheel, info))
        self.assertEqual(wheel["effect_en"], "new effect")
        self.assertEqual(wheel["_wiki_source"], "src")

    def test_base_stats_skipped_when_main_stat_present(self):
        wheel = {"main_stat": "HP"}
        info = {"base_stats_en": "stuff"}
        self.assertFalse(fetch_wheels.apply_update(wheel, info))
        self.assertNotIn("base_stats_en", wheel)

    def test_recommended_skipped_when_already_present(self):
        wheel = {"recommended": ["x"]}
        info = {"recommended_en": ["y"]}
        self.assertFalse(fetch_wheels.apply_update(wheel, info))

    def test_empty_info_no_change(self):
        wheel = {}
        self.assertFalse(fetch_wheels.apply_update(wheel, {}))


if __name__ == "__main__":
    unittest.main()
