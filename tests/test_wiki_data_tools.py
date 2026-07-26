import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"))

import validate_data
import check_version
import build_drop_index


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


# RSS 两组测试随 generate_rss.py 于 2026-07-26 一并退役（守密人裁定「停产 RSS，保留版本检测」）：wiki 冻结后 feed 无消费方，产出↔消费对账判其零消费。本档保留的四组（validate / 交叉引用 / check_version / drop_index）与 RSS 无关。

if __name__ == "__main__":
    unittest.main()
