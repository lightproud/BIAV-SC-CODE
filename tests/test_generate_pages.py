import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"))

import generate_pages


class TestGenerateCharacterPageZh(unittest.TestCase):
    def _parse_frontmatter(self, page: str) -> dict:
        import yaml
        self.assertTrue(page.startswith("---\n"))
        fm = page.split("---\n", 2)[1]
        return yaml.safe_load(fm)

    def test_full_character_zh(self):
        char = {
            "id": "erica",
            "slug": "erica",
            "name_zh": "艾瑞卡",
            "name_en": "Erica",
            "realm": "chaos",
            "role": "support",
        }
        page = generate_pages.generate_character_page(char, "zh")
        fm = self._parse_frontmatter(page)
        self.assertIn("艾瑞卡", fm["title"])
        self.assertIn("混沌属性", fm["description"])
        self.assertIn("辅助", fm["description"])
        self.assertEqual(fm["portrait"], "/portraits/erica.png")
        self.assertIn('<CharacterSheet characterId="erica" />', page)

    def test_stub_character_omits_null_fields(self):
        char = {"id": "stub1", "name_zh": "存根", "realm": None, "role": None}
        page = generate_pages.generate_character_page(char, "zh")
        fm = self._parse_frontmatter(page)
        # No fabricated realm/role text
        self.assertNotIn("属性", fm["description"])
        self.assertTrue(fm["description"].startswith("存根"))

    def test_slug_falls_back_to_id(self):
        char = {"id": "noslug", "name_zh": "无别名"}
        page = generate_pages.generate_character_page(char, "zh")
        fm = self._parse_frontmatter(page)
        self.assertEqual(fm["portrait"], "/portraits/noslug.png")

    def test_unknown_realm_passes_through(self):
        char = {"id": "x", "name_zh": "测试", "realm": "voidrealm"}
        page = generate_pages.generate_character_page(char, "zh")
        fm = self._parse_frontmatter(page)
        self.assertIn("voidrealm属性", fm["description"])


class TestGenerateCharacterPageEn(unittest.TestCase):
    def _fm(self, page):
        import yaml
        return yaml.safe_load(page.split("---\n", 2)[1])

    def test_english_uses_name_en(self):
        char = {
            "id": "erica", "slug": "erica", "name_zh": "艾瑞卡",
            "name_en": "Erica", "realm": "chaos", "role": "attack",
        }
        page = generate_pages.generate_character_page(char, "en")
        fm = self._fm(page)
        self.assertIn("Erica", fm["title"])
        self.assertIn("Full profile of Erica", fm["description"])
        self.assertIn("Chaos", fm["description"])
        self.assertIn("Morimens", fm["description"])

    def test_english_without_name_en_uses_zh(self):
        char = {"id": "x", "name_zh": "本地名"}
        page = generate_pages.generate_character_page(char, "en")
        fm = self._fm(page)
        self.assertIn("本地名", fm["description"])


class TestGenerateCharacterPageJa(unittest.TestCase):
    def test_japanese_suffix_and_realm(self):
        import yaml
        char = {"id": "x", "name_zh": "测试", "realm": "ultra"}
        page = generate_pages.generate_character_page(char, "ja")
        fm = yaml.safe_load(page.split("---\n", 2)[1])
        self.assertIn("Wiki", fm["title"])
        self.assertIn("超次元属性", fm["description"])
        self.assertIn("キャラクター詳細", fm["description"])


class TestUpdateListPage(unittest.TestCase):
    def _run(self, existing_content, dry_run):
        with tempfile.TemporaryDirectory() as d:
            orig = generate_pages.DOCS_DIR
            generate_pages.DOCS_DIR = Path(d)
            try:
                list_path = Path(d) / "zh" / "awakeners" / "list.md"
                list_path.parent.mkdir(parents=True, exist_ok=True)
                list_path.write_text(existing_content, encoding="utf-8")
                result = generate_pages.update_list_page([], "zh", dry_run)
                final = list_path.read_text(encoding="utf-8")
                return result, final
            finally:
                generate_pages.DOCS_DIR = orig

    def test_appends_grid_when_missing(self):
        result, final = self._run("# 列表\n", dry_run=False)
        self.assertIsNotNone(result)
        self.assertIn("<CharacterGrid />", final)

    def test_skips_when_already_present(self):
        result, final = self._run("# 列表\n<CharacterGrid />\n", dry_run=False)
        self.assertIsNone(result)

    def test_dry_run_does_not_write(self):
        result, final = self._run("# 列表\n", dry_run=True)
        self.assertIsNotNone(result)
        self.assertNotIn("<CharacterGrid />", final)

    def test_missing_file_returns_none(self):
        with tempfile.TemporaryDirectory() as d:
            orig = generate_pages.DOCS_DIR
            generate_pages.DOCS_DIR = Path(d)
            try:
                self.assertIsNone(generate_pages.update_list_page([], "zh", False))
            finally:
                generate_pages.DOCS_DIR = orig


class TestLoadCharacters(unittest.TestCase):
    def _load_from(self, json_text):
        import json
        with tempfile.TemporaryDirectory() as d:
            cj = Path(d) / "characters.json"
            cj.write_text(json_text, encoding="utf-8")
            orig = generate_pages.CHARACTERS_JSON
            generate_pages.CHARACTERS_JSON = cj
            try:
                return generate_pages.load_characters()
            finally:
                generate_pages.CHARACTERS_JSON = orig

    def test_top_level_array(self):
        chars = self._load_from('[{"id": "a"}, {"id": "b"}]')
        self.assertEqual([c["id"] for c in chars], ["a", "b"])

    def test_legacy_dict_shape_merges_sr(self):
        chars = self._load_from(
            '{"characters": [{"id": "a"}], "sr_characters": [{"id": "s"}]}'
        )
        self.assertEqual([c["id"] for c in chars], ["a", "s"])


if __name__ == "__main__":
    unittest.main()
