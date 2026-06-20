import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"))

import fetch_skills as fs


# ── strip_wikimarkup ─────────────────────────────────────────────────────────

class TestStripWikimarkup(unittest.TestCase):
    def test_empty_and_none(self):
        self.assertEqual(fs.strip_wikimarkup(""), "")
        self.assertEqual(fs.strip_wikimarkup(None), "")

    def test_piped_link_keeps_display_text(self):
        self.assertEqual(fs.strip_wikimarkup("[[Page|Display]]"), "Display")

    def test_plain_link(self):
        self.assertEqual(fs.strip_wikimarkup("[[Erica]]"), "Erica")

    def test_templates_removed(self):
        self.assertEqual(fs.strip_wikimarkup("a {{tpl|x}} b"), "a  b")

    def test_bold_italic_removed(self):
        self.assertEqual(fs.strip_wikimarkup("'''bold''' and ''it''"), "bold and it")

    def test_ref_and_br_and_html(self):
        out = fs.strip_wikimarkup("text<ref>cite</ref> next<br/>tail<span>x</span>")
        self.assertEqual(out, "text next tailx")


# ── extract_section ──────────────────────────────────────────────────────────

class TestExtractSection(unittest.TestCase):
    def test_extracts_body_until_next_heading(self):
        wt = "== Skills ==\nbody line\n== Other ==\nignored"
        self.assertEqual(fs.extract_section(wt, r"Skills"), "body line")

    def test_no_match_returns_empty(self):
        self.assertEqual(fs.extract_section("nothing here", r"Skills"), "")

    def test_runs_to_end_when_no_following_heading(self):
        wt = "== Skills ==\nlast body"
        self.assertEqual(fs.extract_section(wt, r"Skills"), "last body")

    def test_stops_only_at_equal_or_higher_level(self):
        # A deeper (level 3) heading should NOT terminate a level-2 section
        wt = "== Skills ==\nintro\n=== Sub ===\nmore\n== Next ==\nx"
        body = fs.extract_section(wt, r"Skills")
        self.assertIn("intro", body)
        self.assertIn("Sub", body)
        self.assertNotIn("Next", body)


# ── extract_infobox_field ────────────────────────────────────────────────────

class TestExtractInfoboxField(unittest.TestCase):
    def test_extracts_value(self):
        wt = "{{Infobox\n| name = Erica\n| realm = Aequor\n}}"
        self.assertEqual(fs.extract_infobox_field(wt, "name"), "Erica")

    def test_missing_field(self):
        self.assertEqual(fs.extract_infobox_field("{{Infobox}}", "name"), "")


# ── find_section ─────────────────────────────────────────────────────────────

class TestFindSection(unittest.TestCase):
    def test_first_matching_pattern_wins(self):
        wt = "== 技能 ==\ncontent here\n== End =="
        body = fs.find_section(wt, fs.SECTION_PATTERNS["command_cards"])
        self.assertEqual(body, "content here")

    def test_none_match(self):
        self.assertEqual(fs.find_section("plain", ["NoSuchHeading"]), "")


# ── parse_card_items ─────────────────────────────────────────────────────────

class TestParseCardItems(unittest.TestCase):
    def test_list_items_with_cost(self):
        text = "* '''Strike''' (Cost: 2) - Deal damage\n* '''Guard''' - Block"
        cards = fs.parse_card_items(text)
        self.assertEqual(cards[0], {"name": "Strike", "effect": "Deal damage", "cost": 2})
        self.assertEqual(cards[1], {"name": "Guard", "effect": "Block"})

    def test_long_name_skipped(self):
        text = "* " + "x" * 70 + " - effect"
        self.assertEqual(fs.parse_card_items(text), [])

    def test_table_double_pipe_rows(self):
        text = "| Strike || 2 || Deal damage"
        cards = fs.parse_card_items(text)
        self.assertEqual(cards, [{"name": "Strike", "effect": "Deal damage", "cost": 2}])

    def test_table_header_row_skipped(self):
        text = "| Name || || effect\n| Strike || 1 || Hit"
        cards = fs.parse_card_items(text)
        self.assertEqual([c["name"] for c in cards], ["Strike"])

    def test_bold_entries_fallback(self):
        text = "'''Alpha''' - first\n'''Beta''' - second"
        cards = fs.parse_card_items(text)
        self.assertEqual([c["name"] for c in cards], ["Alpha", "Beta"])

    def test_empty(self):
        self.assertEqual(fs.parse_card_items(""), [])


# ── parse_single_skill ───────────────────────────────────────────────────────

class TestParseSingleSkill(unittest.TestCase):
    def test_empty_returns_none(self):
        self.assertIsNone(fs.parse_single_skill("   "))

    def test_bold_name_then_effect(self):
        out = fs.parse_single_skill("'''Awaken''' - become strong")
        self.assertEqual(out, {"name": "Awaken", "effect": "become strong"})

    def test_first_line_name_rest_effect(self):
        out = fs.parse_single_skill("Rouse Name\nThe effect text spans here")
        self.assertEqual(out["name"], "Rouse Name")
        self.assertEqual(out["effect"], "The effect text spans here")

    def test_long_first_line_becomes_effect_only(self):
        long_line = "y" * 70
        out = fs.parse_single_skill(long_line)
        self.assertNotIn("name", out)
        self.assertEqual(out["effect"], long_line)


# ── parse_enlighten_items ────────────────────────────────────────────────────

class TestParseEnlightenItems(unittest.TestCase):
    def test_level_pattern(self):
        text = "Level 1 - Spark - small boost\nLevel 2 - Flame - big boost"
        items = fs.parse_enlighten_items(text)
        self.assertEqual(items[0]["level"], 1)
        self.assertEqual(items[0]["name"], "Spark")
        self.assertEqual(items[1]["level"], 2)

    def test_numbered_list_fallback(self):
        text = "# First - does a thing\n# Second - does another"
        items = fs.parse_enlighten_items(text)
        self.assertEqual(items[0]["level"], 1)
        self.assertEqual(items[1]["level"], 2)

    def test_card_items_fallback_sequential_levels(self):
        text = "* '''Alpha''' - one\n* '''Beta''' - two"
        items = fs.parse_enlighten_items(text)
        self.assertEqual([i["level"] for i in items], [1, 2])
        self.assertEqual(items[0]["name"], "Alpha")

    def test_empty(self):
        self.assertEqual(fs.parse_enlighten_items(""), [])


# ── extract_from_templates ───────────────────────────────────────────────────

class TestExtractFromTemplates(unittest.TestCase):
    def test_skill_template_with_all_fields(self):
        wt = "{{Skill|name=Strike|en=Strike EN|cost=3|effect=Deal damage}}"
        skills = fs.extract_from_templates(wt)
        card = skills["command_cards"][0]
        self.assertEqual(card["name"], "Strike")
        self.assertEqual(card["name_en"], "Strike EN")
        self.assertEqual(card["cost"], 3)
        self.assertEqual(card["effect"], "Deal damage")

    def test_invalid_cost_ignored(self):
        wt = "{{Skill|name=Strike|cost=abc|effect=hit}}"
        card = fs.extract_from_templates(wt)["command_cards"][0]
        self.assertNotIn("cost", card)

    def test_rouse_template(self):
        wt = "{{Rouse|name=Awaken|effect=power up}}"
        skills = fs.extract_from_templates(wt)
        self.assertEqual(skills["rouse"], {"name": "Awaken", "effect": "power up"})

    def test_no_templates(self):
        self.assertEqual(fs.extract_from_templates("plain text"), {})


# ── extract_from_tabber ──────────────────────────────────────────────────────

class TestExtractFromTabber(unittest.TestCase):
    def test_no_tabber(self):
        self.assertEqual(fs.extract_from_tabber("nothing"), {})

    def test_tabber_command_cards(self):
        wt = "<tabber>Command Cards=* '''Strike''' - hit|-|Rouse='''Awaken''' - up</tabber>"
        skills = fs.extract_from_tabber(wt)
        self.assertIn("command_cards", skills)
        self.assertEqual(skills["rouse"]["name"], "Awaken")

    def test_tabber_malformed_tab_skipped(self):
        wt = "<tabber>no equals sign here</tabber>"
        self.assertEqual(fs.extract_from_tabber(wt), {})


# ── extract_skills_from_wikitext (pipeline) ─────────────────────────────────

class TestExtractSkillsFromWikitext(unittest.TestCase):
    def test_template_path(self):
        wt = "{{Skill|name=Strike|cost=2|effect=hit}}"
        skills = fs.extract_skills_from_wikitext(wt)
        self.assertEqual(skills["command_cards"][0]["name"], "Strike")

    def test_section_path(self):
        wt = "== Command Cards ==\n* '''Strike''' (2) - hit\n* '''Guard''' - block"
        skills = fs.extract_skills_from_wikitext(wt)
        self.assertIn("command_cards", skills)

    def test_tabber_fallback_when_nothing_else(self):
        wt = "<tabber>Rouse='''Awaken''' - up</tabber>"
        skills = fs.extract_skills_from_wikitext(wt)
        self.assertEqual(skills["rouse"]["name"], "Awaken")

    def test_infobox_last_resort(self):
        wt = "{{Infobox\n| skill1 = some rouse effect\n}}"
        skills = fs.extract_skills_from_wikitext(wt)
        self.assertEqual(skills["rouse"], {"effect": "some rouse effect"})

    def test_empty_wikitext(self):
        self.assertEqual(fs.extract_skills_from_wikitext(""), {})


# ── needs_skill_update ───────────────────────────────────────────────────────

class TestNeedsSkillUpdate(unittest.TestCase):
    def test_no_skills(self):
        self.assertTrue(fs.needs_skill_update({}))
        self.assertTrue(fs.needs_skill_update({"skills": None}))

    def test_skills_not_a_dict(self):
        self.assertTrue(fs.needs_skill_update({"skills": []}))

    def test_only_placeholder_keys(self):
        self.assertTrue(fs.needs_skill_update({"skills": {"role_in_team": "dps"}}))

    def test_has_command_cards_complete(self):
        char = {"skills": {"command_cards": [{"name": "x"}]}}
        self.assertFalse(fs.needs_skill_update(char))

    def test_rouse_and_exalt_effects_complete(self):
        char = {"skills": {"rouse": {"effect": "r"}, "exalt": {"effect": "e"}}}
        self.assertFalse(fs.needs_skill_update(char))

    def test_rouse_without_exalt_needs_update(self):
        char = {"skills": {"rouse": {"effect": "r"}}}
        self.assertTrue(fs.needs_skill_update(char))


# ── api_get / fetch_wikitext (mocked I/O) ───────────────────────────────────

class TestApiGet(unittest.TestCase):
    def test_returns_json(self):
        fake = mock.MagicMock()
        fake.read.return_value = b'{"ok": 1}'
        cm = mock.MagicMock()
        cm.__enter__.return_value = fake
        with mock.patch.object(fs.urllib.request, "urlopen", return_value=cm):
            self.assertEqual(fs.api_get("http://x"), {"ok": 1})

    def test_retries_then_raises(self):
        with mock.patch.object(fs.urllib.request, "urlopen", side_effect=OSError("boom")), \
             mock.patch.object(fs.time, "sleep"):
            with self.assertRaises(OSError):
                fs.api_get("http://x", retries=1)


class TestFetchWikitext(unittest.TestCase):
    def test_primary_base_returns_text(self):
        payload = {"parse": {"wikitext": {"*": "WIKI"}}}
        with mock.patch.object(fs, "api_get", return_value=payload):
            self.assertEqual(fs.fetch_wikitext("Erica"), "WIKI")

    def test_all_bases_empty_returns_none(self):
        with mock.patch.object(fs, "api_get", return_value={"parse": {}}):
            self.assertIsNone(fs.fetch_wikitext("Erica"))

    def test_exception_handled_returns_none(self):
        with mock.patch.object(fs, "api_get", side_effect=RuntimeError("net")):
            self.assertIsNone(fs.fetch_wikitext("Erica"))


class TestFetchBiligameWikitext(unittest.TestCase):
    def test_returns_text(self):
        payload = {"parse": {"wikitext": {"*": "BILI"}}}
        with mock.patch.object(fs, "api_get", return_value=payload):
            self.assertEqual(fs.fetch_biligame_wikitext("艾瑞卡"), "BILI")

    def test_exception_returns_none(self):
        with mock.patch.object(fs, "api_get", side_effect=RuntimeError("x")):
            self.assertIsNone(fs.fetch_biligame_wikitext("艾瑞卡"))


# ── main (mocked end to end, tempfile output) ───────────────────────────────

class TestMain(unittest.TestCase):
    def _run_main(self, characters, argv, wikitext="{{Skill|name=Strike|cost=2|effect=hit}}"):
        with tempfile.TemporaryDirectory() as d:
            cj = Path(d) / "characters.json"
            cj.write_text(json.dumps({"characters": characters}), encoding="utf-8")
            with mock.patch.object(fs, "CHARACTERS_JSON", cj), \
                 mock.patch.object(fs, "fetch_wikitext", return_value=wikitext), \
                 mock.patch.object(fs, "fetch_biligame_wikitext", return_value=None), \
                 mock.patch.object(fs.time, "sleep"), \
                 mock.patch.object(sys, "argv", ["fetch_skills.py"] + argv):
                fs.main()
            return json.loads(cj.read_text(encoding="utf-8"))

    def test_dry_run_does_not_write(self):
        chars = [{"id": "erica", "name": "Erica"}]
        result = self._run_main(chars, ["--dry-run"])
        # dry-run leaves the file content unchanged (no skills injected)
        self.assertNotIn("skills", result["characters"][0])

    def test_writes_skills_when_not_dry_run(self):
        chars = [{"id": "erica", "name": "Erica"}]
        result = self._run_main(chars, [])
        self.assertIn("command_cards", result["characters"][0]["skills"])

    def test_skip_when_no_page_mapping(self):
        chars = [{"id": "nonexistent_char_zzz", "name": "Ghost"}]
        result = self._run_main(chars, [])
        # No mapping -> never touched
        self.assertNotIn("skills", result["characters"][0])


if __name__ == "__main__":
    unittest.main()
