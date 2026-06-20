import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"))

import fetch_cards as fc


# ── strip_wikimarkup ─────────────────────────────────────────────────────────

class TestStripWikimarkup(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(fc.strip_wikimarkup(""), "")
        self.assertEqual(fc.strip_wikimarkup(None), "")

    def test_piped_and_plain_links(self):
        self.assertEqual(fc.strip_wikimarkup("[[Page|Disp]]"), "Disp")
        self.assertEqual(fc.strip_wikimarkup("[[Erica]]"), "Erica")

    def test_template_and_markup(self):
        self.assertEqual(fc.strip_wikimarkup("{{t}}'''bold'''<b>x</b>"), "boldx")


# ── parse_infobox_field ──────────────────────────────────────────────────────

class TestParseInfoboxField(unittest.TestCase):
    def test_value(self):
        wt = "{{Infobox\n| skill1_name = Strike\n| skill1_cost = 2\n}}"
        self.assertEqual(fc.parse_infobox_field(wt, "skill1_name"), "Strike")

    def test_missing_returns_none(self):
        self.assertIsNone(fc.parse_infobox_field("{{Infobox}}", "skill1_name"))


# ── parse_cards_from_wikitext ────────────────────────────────────────────────

class TestParseCardsFromWikitext(unittest.TestCase):
    def test_skill_template(self):
        wt = "{{Skill|name=Strike|english=Strike EN|cost=2|effect=Deal damage}}"
        result = fc.parse_cards_from_wikitext(wt)
        card = result["command_cards"][0]
        self.assertEqual(card["name"], "Strike")
        self.assertEqual(card["name_en"], "Strike EN")
        self.assertEqual(card["cost"], 2)
        self.assertEqual(card["effect"], "Deal damage")

    def test_skill_template_non_numeric_cost_kept_as_string(self):
        wt = "{{Skill|name=Strike|cost=X|effect=hit}}"
        card = fc.parse_cards_from_wikitext(wt)["command_cards"][0]
        self.assertEqual(card["cost"], "X")

    def test_table_rows(self):
        wt = "|| Strike || 3 || Deal damage ||"
        result = fc.parse_cards_from_wikitext(wt)
        card = result["command_cards"][0]
        self.assertEqual(card["name"], "Strike")
        self.assertEqual(card["cost"], 3)

    def test_table_header_row_skipped(self):
        wt = "|| Name || 0 || effect ||\n|| Strike || 1 || Hit ||"
        result = fc.parse_cards_from_wikitext(wt)
        names = [c["name"] for c in result["command_cards"]]
        self.assertNotIn("Name", names)
        self.assertIn("Strike", names)

    def test_section_rouse_and_exalt(self):
        wt = (
            "== Rouse ==\nname: Awaken\neffect: power up\n"
            "== Exalt ==\nname: Burst\neffect: explode\n"
        )
        result = fc.parse_cards_from_wikitext(wt)
        self.assertEqual(result["rouse"]["name"], "Awaken")
        self.assertEqual(result["exalt"]["name"], "Burst")

    def test_section_enlighten(self):
        wt = "== Enlighten ==\n1. Spark - small\n2. Flame - big\n"
        result = fc.parse_cards_from_wikitext(wt)
        self.assertEqual(len(result["enlighten"]), 2)
        self.assertEqual(result["enlighten"][0]["level"], 1)

    def test_infobox_fallback_for_cards(self):
        wt = (
            "{{Infobox\n"
            "| skill1_name = Strike\n"
            "| skill1_effect = Deal damage\n"
            "| skill1_cost = 2\n"
            "}}"
        )
        result = fc.parse_cards_from_wikitext(wt)
        card = result["command_cards"][0]
        self.assertEqual(card["name"], "Strike")
        self.assertEqual(card["cost"], 2)

    def test_infobox_fallback_rouse_exalt(self):
        wt = (
            "{{Infobox\n"
            "| rouse_name = Awaken\n"
            "| rouse_effect = power\n"
            "| exalt_name = Burst\n"
            "| exalt_effect = boom\n"
            "}}"
        )
        result = fc.parse_cards_from_wikitext(wt)
        self.assertEqual(result["rouse"]["name"], "Awaken")
        self.assertEqual(result["exalt"]["name"], "Burst")

    def test_empty(self):
        self.assertEqual(fc.parse_cards_from_wikitext(""), {})


# ── _parse_skill_section ─────────────────────────────────────────────────────

class TestParseSkillSection(unittest.TestCase):
    def test_empty(self):
        self.assertIsNone(fc._parse_skill_section(""))

    def test_name_effect_labels(self):
        out = fc._parse_skill_section("name: Awaken\neffect: power up")
        self.assertEqual(out, {"name": "Awaken", "effect": "power up"})

    def test_first_short_line_as_name(self):
        out = fc._parse_skill_section("Awaken\nDoes a powerful thing to enemies")
        self.assertEqual(out["name"], "Awaken")
        self.assertIn("powerful", out["effect"])

    def test_list_markers_stripped(self):
        out = fc._parse_skill_section("* Awaken\n* the effect text goes here longer")
        self.assertIn("Awaken", out.get("name", "") + out.get("effect", ""))


# ── _parse_enlighten_section ─────────────────────────────────────────────────

class TestParseEnlightenSection(unittest.TestCase):
    def test_name_effect_split(self):
        entries = fc._parse_enlighten_section("1. Spark - small boost\n2. Flame - big boost")
        self.assertEqual(entries[0]["level"], 1)
        self.assertEqual(entries[0]["name"], "Spark")
        self.assertEqual(entries[0]["effect"], "small boost")

    def test_effect_only_when_no_split(self):
        entries = fc._parse_enlighten_section("1. just a long effect with no dash separator here")
        self.assertEqual(entries[0]["level"], 1)
        self.assertNotIn("name", entries[0])

    def test_empty(self):
        self.assertEqual(fc._parse_enlighten_section(""), [])


# ── load_existing_cards ──────────────────────────────────────────────────────

class TestLoadExistingCards(unittest.TestCase):
    def test_missing_returns_default(self):
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.object(fc, "CARDS_JSON", Path(d) / "nope.json"):
                out = fc.load_existing_cards()
        self.assertEqual(out["cards"], [])
        self.assertIn("description", out)

    def test_existing_loaded(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "cards.json"
            p.write_text(json.dumps({"cards": [{"x": 1}]}), encoding="utf-8")
            with mock.patch.object(fc, "CARDS_JSON", p):
                out = fc.load_existing_cards()
        self.assertEqual(out["cards"], [{"x": 1}])


# ── extract_cards_from_characters ────────────────────────────────────────────

class TestExtractCardsFromCharacters(unittest.TestCase):
    def test_extracts_skill_keys(self):
        chars = {
            "characters": [
                {"id": "erica", "skills": {
                    "command_cards": [{"name": "Strike"}],
                    "rouse": {"name": "Awaken"},
                    "ignored": "x",
                }},
                {"id": "noskills"},  # skipped
                {"id": "emptyskills", "skills": {}},  # skipped (no entry built)
            ]
        }
        with tempfile.TemporaryDirectory() as d:
            cj = Path(d) / "characters.json"
            cj.write_text(json.dumps(chars), encoding="utf-8")
            with mock.patch.object(fc, "CHARACTERS_JSON", cj):
                out = fc.extract_cards_from_characters()
        self.assertIn("erica", out)
        self.assertNotIn("noskills", out)
        self.assertNotIn("emptyskills", out)
        self.assertIn("command_cards", out["erica"])
        self.assertNotIn("ignored", out["erica"])


# ── build_card_entry ─────────────────────────────────────────────────────────

class TestBuildCardEntry(unittest.TestCase):
    def test_full_entry(self):
        char = {"id": "erica", "name": "艾瑞卡", "name_en": "Erica",
                "rarity": "SSR", "realm": "aequor"}
        skills = {"command_cards": [{"name": "S"}], "rouse": {"name": "R"},
                  "exalt": {}, "overexalt": {}, "enlighten": [], "talent": {}}
        entry = fc.build_card_entry(char, skills)
        self.assertEqual(entry["character_id"], "erica")
        self.assertEqual(entry["character_name_en"], "Erica")
        for k in ("command_cards", "rouse", "exalt", "overexalt", "enlighten", "talent"):
            self.assertIn(k, entry)

    def test_defaults_for_missing_meta(self):
        entry = fc.build_card_entry({"id": "x", "name": "X"}, {})
        self.assertEqual(entry["character_name_en"], "")
        self.assertEqual(entry["rarity"], "")
        self.assertNotIn("command_cards", entry)


# ── is_incomplete ────────────────────────────────────────────────────────────

class TestIsIncomplete(unittest.TestCase):
    def test_empty(self):
        self.assertTrue(fc.is_incomplete({}))

    def test_no_command_cards(self):
        self.assertTrue(fc.is_incomplete({"rouse": {}}))

    def test_too_few_cards(self):
        self.assertTrue(fc.is_incomplete({"command_cards": [{"effect": "e"}]}))

    def test_placeholder_effect(self):
        cards = [{"effect": "标准打击卡"}, {"effect": "real"}]
        self.assertTrue(fc.is_incomplete({"command_cards": cards, "rouse": {}}))

    def test_missing_rouse(self):
        cards = [{"effect": "a"}, {"effect": "b"}]
        self.assertTrue(fc.is_incomplete({"command_cards": cards}))

    def test_complete(self):
        cards = [{"effect": "a"}, {"effect": "b"}]
        self.assertFalse(fc.is_incomplete({"command_cards": cards, "rouse": {"effect": "r"}}))


# ── merge_skills ─────────────────────────────────────────────────────────────

class TestMergeSkills(unittest.TestCase):
    def test_fetched_fills_missing_top_level(self):
        merged = fc.merge_skills({}, {"rouse": {"name": "R"}, "enlighten": [1]})
        self.assertEqual(merged["rouse"], {"name": "R"})
        self.assertEqual(merged["enlighten"], [1])

    def test_existing_subfields_preserved_gaps_filled(self):
        existing = {"rouse": {"name": "Keep"}}
        fetched = {"rouse": {"name": "Override", "effect": "Add"}}
        merged = fc.merge_skills(existing, fetched)
        self.assertEqual(merged["rouse"]["name"], "Keep")
        self.assertEqual(merged["rouse"]["effect"], "Add")

    def test_command_cards_appends_new(self):
        existing = {"command_cards": [{"name": "A"}]}
        fetched = {"command_cards": [{"name": "B", "effect": "e"}]}
        merged = fc.merge_skills(existing, fetched)
        names = [c["name"] for c in merged["command_cards"]]
        self.assertEqual(names, ["A", "B"])

    def test_command_cards_fills_placeholder_effect(self):
        existing = {"command_cards": [{"name": "A", "effect": "标准打击卡"}]}
        fetched = {"command_cards": [{"name": "A", "effect": "real effect"}]}
        merged = fc.merge_skills(existing, fetched)
        self.assertEqual(merged["command_cards"][0]["effect"], "real effect")

    def test_command_cards_only_in_fetched(self):
        merged = fc.merge_skills({}, {"command_cards": [{"name": "A"}]})
        self.assertEqual(merged["command_cards"], [{"name": "A"}])


# ── api_get / fetch_wikitext (mocked I/O) ───────────────────────────────────

class TestApiGet(unittest.TestCase):
    def test_returns_json(self):
        fake = mock.MagicMock()
        fake.read.return_value = b'{"ok": 1}'
        cm = mock.MagicMock()
        cm.__enter__.return_value = fake
        with mock.patch.object(fc.urllib.request, "urlopen", return_value=cm):
            self.assertEqual(fc.api_get("http://x"), {"ok": 1})


class TestFetchWikitext(unittest.TestCase):
    def test_returns_text(self):
        payload = {"parse": {"wikitext": {"*": "WIKI"}}}
        with mock.patch.object(fc, "api_get", return_value=payload):
            self.assertEqual(fc.fetch_wikitext("base", "Erica"), "WIKI")

    def test_exception_returns_none(self):
        with mock.patch.object(fc, "api_get", side_effect=RuntimeError("net")):
            self.assertIsNone(fc.fetch_wikitext("base", "Erica"))


# ── main (mocked end to end, tempfile output) ───────────────────────────────

class TestMain(unittest.TestCase):
    def _setup_and_run(self, argv, fetched_wikitext="{{Skill|name=Strike|cost=2|effect=hit}}"):
        with tempfile.TemporaryDirectory() as d:
            cj = Path(d) / "characters.json"
            cardsj = Path(d) / "cards.json"
            chars = {"characters": [
                {"id": "erica", "name": "Erica", "name_en": "Erica",
                 "rarity": "SSR", "realm": "aequor"},
            ]}
            cj.write_text(json.dumps(chars), encoding="utf-8")
            with mock.patch.object(fc, "CHARACTERS_JSON", cj), \
                 mock.patch.object(fc, "CARDS_JSON", cardsj), \
                 mock.patch.object(fc, "fetch_wikitext", return_value=fetched_wikitext), \
                 mock.patch.object(fc.time, "sleep"), \
                 mock.patch.object(sys, "argv", ["fetch_cards.py"] + argv):
                fc.main()
            wrote = cardsj.exists()
            data = json.loads(cardsj.read_text(encoding="utf-8")) if wrote else None
            return wrote, data

    def test_dry_run_writes_nothing(self):
        wrote, _ = self._setup_and_run(["--dry-run"])
        self.assertFalse(wrote)

    def test_writes_cards_json(self):
        wrote, data = self._setup_and_run([])
        self.assertTrue(wrote)
        self.assertEqual(len(data["cards"]), 1)
        self.assertEqual(data["cards"][0]["character_id"], "erica")
        self.assertIn("command_cards", data["cards"][0])

    def test_no_wikitext_still_writes_existing(self):
        wrote, data = self._setup_and_run([], fetched_wikitext=None)
        # erica has no existing skills and no fetch -> no entries
        self.assertTrue(wrote)
        self.assertEqual(data["cards"], [])


if __name__ == "__main__":
    unittest.main()
