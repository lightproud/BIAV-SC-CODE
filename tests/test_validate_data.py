import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"))

import validate_data as vd


class TestValidateJsonSyntax(unittest.TestCase):
    def _db(self, files: dict) -> Path:
        d = Path(tempfile.mkdtemp())
        for name, text in files.items():
            (d / name).write_text(text, encoding="utf-8")
        return d

    def test_empty_dir_reports_error(self):
        errors, loaded = vd.validate_json_syntax(Path(tempfile.mkdtemp()))
        self.assertTrue(errors)
        self.assertEqual(loaded, {})

    def test_valid_file_loaded(self):
        db = self._db({"meta.json": '{"version": "1.0"}'})
        errors, loaded = vd.validate_json_syntax(db)
        self.assertEqual(errors, [])
        self.assertEqual(loaded["meta.json"], {"version": "1.0"})

    def test_malformed_json_reported(self):
        db = self._db({"broken.json": "{not valid"})
        errors, loaded = vd.validate_json_syntax(db)
        self.assertTrue(any("JSON syntax error" in e for e in errors))
        self.assertNotIn("broken.json", loaded)


class TestValidateCrossReferences(unittest.TestCase):
    def test_valid_realm_links_pass(self):
        loaded = {
            "realms.json": {"realms": [{"id": "r1"}, {"id": "r2"}]},
            "characters.json": [{"id": "c1", "realm": "r1"}, {"id": "c2", "realm": None}],
        }
        self.assertEqual(vd.validate_cross_references(loaded), [])

    def test_unknown_realm_flagged(self):
        loaded = {
            "realms.json": {"realms": [{"id": "r1"}]},
            "characters.json": [{"id": "c1", "realm": "ghost"}],
        }
        errors = vd.validate_cross_references(loaded)
        self.assertTrue(any("unknown realm" in e for e in errors))

    def test_legacy_id_accepted_as_valid_realm(self):
        loaded = {
            "realms.json": {"realms": [{"id": "r1", "legacy_id": "old1"}]},
            "characters.json": [{"id": "c1", "realm": "old1"}],
        }
        self.assertEqual(vd.validate_cross_references(loaded), [])

    def test_duplicate_ids_flagged_when_realms_absent(self):
        loaded = {"characters.json": [{"id": "c1"}, {"id": "c1"}]}
        errors = vd.validate_cross_references(loaded)
        self.assertTrue(any("duplicate id" in e for e in errors))

    def test_missing_characters_skipped(self):
        self.assertEqual(vd.validate_cross_references({}), [])


class TestValidateSchemas(unittest.TestCase):
    @unittest.skipIf(vd.HAS_JSONSCHEMA, "jsonschema installed; missing-library branch not exercised")
    def test_missing_library_reports_fail(self):
        errors = vd.validate_schemas({"meta.json": {"version": "1.0"}})
        self.assertTrue(any("jsonschema" in e for e in errors))

    def test_absent_data_file_is_skipped_not_failed(self):
        # an empty loaded dict means no data files present -> no FAILs,
        # regardless of whether jsonschema is installed
        errors = vd.validate_schemas({})
        if vd.HAS_JSONSCHEMA:
            self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
