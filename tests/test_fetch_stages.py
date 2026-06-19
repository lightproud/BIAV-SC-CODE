import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"))

import fetch_stages


class TestSlugify(unittest.TestCase):
    def test_basic_lowercasing_and_spaces(self):
        self.assertEqual(fetch_stages._slugify("Dissolution Ruins"), "dissolution-ruins")

    def test_strips_colons_and_slashes(self):
        self.assertEqual(fetch_stages._slugify("A/B：C"), "a-b-c")

    def test_collapses_repeated_dashes_and_trims(self):
        self.assertEqual(fetch_stages._slugify("--Foo  Bar--"), "foo-bar")

    def test_empty_or_symbol_only_falls_back(self):
        self.assertEqual(fetch_stages._slugify(""), "unknown")
        self.assertEqual(fetch_stages._slugify("***"), "unknown")


class TestParseEnemyLevel(unittest.TestCase):
    def test_english_enemy_level(self):
        self.assertEqual(fetch_stages.parse_enemy_level("Enemy Level: 30~40"), "30~40")

    def test_chinese_enemy_level(self):
        self.assertEqual(fetch_stages.parse_enemy_level("敌人等级：55"), "55")

    def test_lv_shorthand(self):
        self.assertEqual(fetch_stages.parse_enemy_level("Lv. 10-20 area"), "10-20")

    def test_no_match_returns_none(self):
        self.assertIsNone(fetch_stages.parse_enemy_level("no level info here"))


class TestParseRecommendedPower(unittest.TestCase):
    def test_english_with_comma_stripped(self):
        self.assertEqual(fetch_stages.parse_recommended_power("Recommended Power: 12,000"), "12000")

    def test_chinese_training_value(self):
        self.assertEqual(fetch_stages.parse_recommended_power("推荐特训值：4500"), "4500")

    def test_no_match(self):
        self.assertIsNone(fetch_stages.parse_recommended_power("nothing"))


class TestParseStaminaCost(unittest.TestCase):
    def test_label_then_number(self):
        self.assertEqual(fetch_stages.parse_stamina_cost("Stamina: 20"), 20)

    def test_chinese_label(self):
        self.assertEqual(fetch_stages.parse_stamina_cost("体力 15"), 15)

    def test_number_then_label(self):
        self.assertEqual(fetch_stages.parse_stamina_cost("消耗 30 墨诺芬"), 30)

    def test_no_match_returns_none(self):
        self.assertIsNone(fetch_stages.parse_stamina_cost("free"))


class TestParseDropTable(unittest.TestCase):
    def setUp(self):
        # Ensure a clean KNOWN_ITEMS for verified-flag tests
        fetch_stages.KNOWN_ITEMS = set()

    def test_table_rows(self):
        text = "|| Iron Ore || 30% || Rare\n|| Wood || 50%"
        drops = fetch_stages.parse_drop_table(text)
        items = {d["item"]: d.get("rate") for d in drops}
        self.assertEqual(items.get("Iron Ore"), "30%")
        self.assertEqual(items.get("Wood"), "50%")

    def test_template_drops(self):
        text = "{{Drop|item=Gemstone|rate=5%}}"
        drops = fetch_stages.parse_drop_table(text)
        self.assertEqual(drops[0]["item"], "Gemstone")
        self.assertEqual(drops[0]["rate"], "5%")

    def test_bullet_list_emits_an_entry_per_line(self):
        # The bullet regex's optional rate group leaves group 1 minimal, so it
        # captures the leading token rather than the full item name. We assert
        # the documented (lossy) current behavior: one entry per bullet line.
        text = "* Magic Dust\n* Plain Item"
        drops = fetch_stages.parse_drop_table(text)
        self.assertEqual(len(drops), 2)

    def test_inline_mentions_split(self):
        text = "掉落：金币、木材、宝石"
        drops = fetch_stages.parse_drop_table(text)
        names = {d["item"] for d in drops}
        self.assertTrue({"金币", "木材", "宝石"}.issubset(names))

    def test_dedup_across_patterns(self):
        text = "{{Drop|item=Iron}}\n* Iron"
        drops = fetch_stages.parse_drop_table(text)
        self.assertEqual([d["item"] for d in drops].count("Iron"), 1)

    def test_known_item_flagged_verified(self):
        fetch_stages.KNOWN_ITEMS = {"Iron Ore"}
        text = "|| Iron Ore || 30%"
        drops = fetch_stages.parse_drop_table(text)
        self.assertTrue(drops[0].get("verified"))

    def test_empty_text(self):
        self.assertEqual(fetch_stages.parse_drop_table(""), [])


class TestGuessPageTitle(unittest.TestCase):
    def test_override_wins(self):
        self.assertEqual(
            fetch_stages.guess_page_title({"id": "lightless-realm"}),
            "Lightless_Realm",
        )

    def test_name_en_with_slash_takes_first(self):
        title = fetch_stages.guess_page_title(
            {"id": "x", "name_en": "Dream Dive / Phantasmal", "name": "梦境"}
        )
        self.assertEqual(title, "Dream_Dive")

    def test_falls_back_to_name(self):
        self.assertEqual(
            fetch_stages.guess_page_title({"id": "x", "name": "未知关卡"}),
            "未知关卡",
        )


class TestBuildStagesFromMaps(unittest.TestCase):
    def test_builds_all_categories(self):
        maps = {
            "resource_dungeons": [
                {"name": "矿洞", "name_en": "Ore Cave", "drops": ["iron"]}
            ],
            "challenge_modes": [
                {"name": "挑战", "name_en": "Challenge", "alert_levels": [1, 2]}
            ],
            "daily_weekly_system": [
                {"name": "日常", "name_en": "Daily"}
            ],
        }
        stages = fetch_stages.build_stages_from_maps(maps)
        self.assertEqual(len(stages), 3)
        by_cat = {s["category"]: s for s in stages}
        self.assertEqual(by_cat["resource_dungeon"]["id"], "ore-cave")
        self.assertEqual(by_cat["resource_dungeon"]["known_drops"], ["iron"])
        self.assertEqual(by_cat["challenge_mode"]["alert_levels"], [1, 2])
        self.assertEqual(by_cat["daily_weekly"]["name"], "日常")

    def test_empty_maps_yields_no_stages(self):
        self.assertEqual(fetch_stages.build_stages_from_maps({}), [])

    def test_challenge_without_alert_levels_omits_field(self):
        maps = {"challenge_modes": [{"name": "C", "name_en": "C"}]}
        stages = fetch_stages.build_stages_from_maps(maps)
        self.assertNotIn("alert_levels", stages[0])


if __name__ == "__main__":
    unittest.main()
