import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"))

import validate_data
import check_version
import build_banner_character_index as bbci
import build_drop_index
import generate_rss


class TestValidateDataLoadJson(unittest.TestCase):
    def test_valid_invalid_and_missing(self):
        with tempfile.TemporaryDirectory() as d:
            good = Path(d) / "good.json"
            good.write_text('{"a": 1}', encoding="utf-8")
            bad = Path(d) / "bad.json"
            bad.write_text('{"a": 1,}', encoding="utf-8")

            data, err = validate_data.load_json(good)
            self.assertEqual(data, {"a": 1})
            self.assertIsNone(err)

            data, err = validate_data.load_json(bad)
            self.assertIsNone(data)
            self.assertIn("JSON syntax error", err)

            data, err = validate_data.load_json(Path(d) / "missing.json")
            self.assertEqual(err, "File not found")


class TestValidateJsonSyntax(unittest.TestCase):
    def test_mixed_dir_reports_only_broken_file(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "good.json").write_text("[]", encoding="utf-8")
            (Path(d) / "bad.json").write_text("{", encoding="utf-8")
            errors, loaded = validate_data.validate_json_syntax(Path(d))
        self.assertEqual(len(errors), 1)
        self.assertIn("bad.json", errors[0])
        self.assertEqual(list(loaded), ["good.json"])

    def test_empty_dir_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            errors, loaded = validate_data.validate_json_syntax(Path(d))
        self.assertEqual(len(errors), 1)
        self.assertIn("No JSON files found", errors[0])
        self.assertEqual(loaded, {})


class TestValidateCrossReferences(unittest.TestCase):
    REALMS = {"realms": [{"id": "aequor", "legacy_id": "ocean"}]}

    def test_valid_realm_passes(self):
        loaded = {
            "realms.json": self.REALMS,
            "characters.json": [{"id": "c1", "realm": "aequor"}],
        }
        self.assertEqual(validate_data.validate_cross_references(loaded), [])

    def test_legacy_realm_id_accepted(self):
        loaded = {
            "realms.json": self.REALMS,
            "characters.json": [{"id": "c1", "realm": "ocean"}],
        }
        self.assertEqual(validate_data.validate_cross_references(loaded), [])

    def test_unknown_realm_fails(self):
        loaded = {
            "realms.json": self.REALMS,
            "characters.json": [{"id": "c1", "realm": "nowhere"}],
        }
        errors = validate_data.validate_cross_references(loaded)
        self.assertEqual(len(errors), 1)
        self.assertIn("unknown realm 'nowhere'", errors[0])

    def test_null_realm_is_skipped(self):
        # Stub characters carry realm=None and must not fail validation
        loaded = {
            "realms.json": self.REALMS,
            "characters.json": [{"id": "c1", "realm": None}],
        }
        self.assertEqual(validate_data.validate_cross_references(loaded), [])

    def test_duplicate_ids_detected_when_realms_absent(self):
        loaded = {
            "characters.json": [{"id": "c1"}, {"id": "c1"}],
        }
        errors = validate_data.validate_cross_references(loaded)
        self.assertEqual(len(errors), 1)
        self.assertIn("duplicate id 'c1'", errors[0])

    def test_legacy_object_shape_normalized(self):
        loaded = {
            "realms.json": self.REALMS,
            "characters.json": {
                "characters": [{"id": "c1", "realm": "aequor"}],
                "sr_characters": [{"id": "c2", "realm": "bad"}],
            },
        }
        errors = validate_data.validate_cross_references(loaded)
        self.assertEqual(len(errors), 1)
        self.assertIn("'c2'", errors[0])

    @unittest.skipIf(validate_data.HAS_JSONSCHEMA, "jsonschema installed")
    def test_validate_schemas_fails_without_jsonschema(self):
        errors = validate_data.validate_schemas({})
        self.assertEqual(len(errors), 1)
        self.assertIn("jsonschema library missing", errors[0])


class TestCheckVersionHelpers(unittest.TestCase):
    def _steam_result(self, *titles):
        return {"recent_news": [{"title": t} for t in titles]}

    def test_detect_version_requires_explicit_marker(self):
        self.assertEqual(
            check_version.detect_version_from_news(self._steam_result("Update v1.2 live")),
            "1.2",
        )
        self.assertEqual(
            check_version.detect_version_from_news(self._steam_result("版本 2.0 上线")),
            "2.0",
        )
        self.assertEqual(
            check_version.detect_version_from_news(self._steam_result("Version 1.2.3 patch")),
            "1.2.3",
        )

    def test_bare_decimal_not_detected(self):
        # SCR-07 regression: bare decimals in titles must not become versions
        self.assertIsNone(
            check_version.detect_version_from_news(self._steam_result("评分 5.5 星 活动"))
        )

    def test_no_news_returns_none(self):
        self.assertIsNone(check_version.detect_version_from_news({}))

    def test_get_known_versions(self):
        data = {"versions": [{"version": "1.0"}, {"version": "1.1"}]}
        self.assertEqual(check_version.get_known_versions(data), {"1.0", "1.1"})

    def test_create_stub_version_fields(self):
        stub = check_version.create_stub_version("9.9", "steam_news")
        self.assertEqual(stub["version"], "9.9")
        self.assertTrue(stub["_auto_detected"])
        self.assertEqual(stub["_source"], "steam_news")
        self.assertEqual(len(stub["highlights"]), 2)


class TestBannerCharacterIndex(unittest.TestCase):
    CHARS = [
        {"id": 1, "name_zh": "艾瑞卡", "slug": "erica", "name_en": "Erica Light"},
        {"id": 2, "name_zh": "潘狄娅", "slug": "pandia"},
    ]

    def test_build_name_to_id_adds_normalized_alias(self):
        index = bbci.build_name_to_id(self.CHARS)
        self.assertEqual(index["艾瑞卡"], "1")
        self.assertEqual(index["erica"], "1")
        # Space-stripped normalized form is also registered
        self.assertEqual(index["EricaLight"], "1")

    def test_extract_terms_splits_on_separators(self):
        banner = {"rate_up": "艾瑞卡/潘狄娅、其他"}
        self.assertEqual(bbci.extract_terms(banner), ["艾瑞卡", "潘狄娅", "其他"])

    def test_match_banner_exact_and_substring(self):
        index = bbci.build_name_to_id(self.CHARS)
        banner = {"rate_up": "艾瑞卡 「潘狄娅」登场"}
        matched, unmatched = bbci.match_banner(banner, index)
        self.assertEqual(matched, {"1", "2"})
        self.assertEqual(unmatched, set())

    def test_match_banner_collects_unmatched_terms(self):
        index = bbci.build_name_to_id(self.CHARS)
        banner = {"rate_up": "神秘角色 X"}
        matched, unmatched = bbci.match_banner(banner, index)
        self.assertEqual(matched, set())
        # Single-char terms are dropped from the unmatched report
        self.assertEqual(unmatched, {"神秘角色"})


class TestBuildDropIndex(unittest.TestCase):
    def test_inverts_drops_and_first_clear_rewards(self):
        stages = [
            {"id": 10, "drops": [{"item_id": "iron"}, {"item_id": "wood"}]},
            {"id": 11, "drops": [{"item_id": "iron"}],
             "first_clear_rewards": [{"item_id": "gem"}]},
            {"drops": [{"item_id": "ghost"}]},  # no stage id -> skipped
            {"id": 12, "drops": None},          # null drops tolerated
        ]
        index = build_drop_index.build_index(stages)
        self.assertEqual(index, {
            "gem": [11],
            "iron": [10, 11],
            "wood": [10],
        })

    def test_empty_input(self):
        self.assertEqual(build_drop_index.build_index([]), {})


class TestGenerateRssHelpers(unittest.TestCase):
    def test_parse_fuzzy_date_iso(self):
        dt = generate_rss.parse_fuzzy_date("2026-05-01T12:00:00+00:00")
        self.assertEqual(dt, datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc))

    def test_parse_fuzzy_date_year_fallback(self):
        dt = generate_rss.parse_fuzzy_date("2024年夏")
        self.assertEqual(dt, datetime(2024, 1, 1, tzinfo=timezone.utc))

    def test_format_rfc822_assumes_utc_for_naive(self):
        s = generate_rss.format_rfc822(datetime(2026, 5, 1, 12, 0))
        self.assertEqual(s, "Fri, 01 May 2026 12:00:00 +0000")

    def test_build_version_items_reversed_with_guid(self):
        data = {"versions": [
            {"version": "1.0", "title": "First", "period": "2025",
             "highlights": ["a"]},
            {"version": "2.0", "title": "Second", "period": "2026",
             "highlights": []},
        ]}
        items = generate_rss.build_version_items(data)
        # Newest (last in file) comes first in the feed
        self.assertEqual(items[0]["guid"], "morimens-version-2.0")
        self.assertEqual(items[0]["title"], "[Game] v2.0 - Second")
        self.assertIn("<li>a</li>", items[1]["description"])

    def test_build_wiki_items_guid_uses_short_hash(self):
        entries = [{"hash": "a" * 40, "date": "2026-05-01T00:00:00+00:00",
                    "author": "erica", "subject": "update data"}]
        items = generate_rss.build_wiki_items(entries)
        self.assertEqual(items[0]["guid"], f"morimens-wiki-commit-{'a' * 12}")
        self.assertEqual(items[0]["title"], "[Wiki] update data")
        self.assertIn("erica", items[0]["description"])


if __name__ == "__main__":
    unittest.main()
