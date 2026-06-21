"""Unit tests for validate_data.py (wiki JSON schema/cross-ref validator)."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects/wiki/scripts"))

import validate_data as vd  # noqa: E402


def _write(path: Path, obj, raw=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if raw is not None:
        path.write_text(raw, encoding="utf-8")
    else:
        path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


class TestLoadJson:
    def test_valid(self, tmp_path):
        p = tmp_path / "a.json"
        _write(p, {"k": 1})
        data, err = vd.load_json(p)
        assert data == {"k": 1}
        assert err is None

    def test_syntax_error(self, tmp_path):
        p = tmp_path / "b.json"
        _write(p, None, raw="{bad")
        data, err = vd.load_json(p)
        assert data is None
        assert "syntax" in err

    def test_not_found(self, tmp_path):
        data, err = vd.load_json(tmp_path / "missing.json")
        assert data is None
        assert err == "File not found"


class TestValidateJsonSyntax:
    def test_no_files(self, tmp_path):
        errors, loaded = vd.validate_json_syntax(tmp_path)
        assert any("No JSON files" in e for e in errors)
        assert loaded == {}

    def test_mix_of_valid_and_invalid(self, tmp_path):
        _write(tmp_path / "good.json", {"x": 1})
        _write(tmp_path / "bad.json", None, raw="{broken")
        errors, loaded = vd.validate_json_syntax(tmp_path)
        assert "good.json" in loaded
        assert any("bad.json" in e for e in errors)


class TestValidateSchemas:
    def test_no_jsonschema(self, monkeypatch):
        monkeypatch.setattr(vd, "HAS_JSONSCHEMA", False)
        errors = vd.validate_schemas({"meta.json": {}})
        assert any("jsonschema library missing" in e for e in errors)

    def test_skip_when_data_absent(self, monkeypatch):
        monkeypatch.setattr(vd, "HAS_JSONSCHEMA", True)
        errors = vd.validate_schemas({})  # no data files loaded
        assert errors == []

    def test_passes_against_schema(self, tmp_path, monkeypatch):
        if not vd.HAS_JSONSCHEMA:
            pytest.skip("jsonschema not installed")
        schema_dir = tmp_path / "schemas"
        _write(schema_dir / "meta.schema.json", {"type": "object"})
        monkeypatch.setattr(vd, "SCHEMA_DIR", schema_dir)
        errors = vd.validate_schemas({"meta.json": {"current_version": "1"}})
        assert errors == []

    def test_validation_failure(self, tmp_path, monkeypatch):
        if not vd.HAS_JSONSCHEMA:
            pytest.skip("jsonschema not installed")
        schema_dir = tmp_path / "schemas"
        _write(schema_dir / "meta.schema.json",
               {"type": "object", "required": ["must_have"]})
        monkeypatch.setattr(vd, "SCHEMA_DIR", schema_dir)
        errors = vd.validate_schemas({"meta.json": {}})
        assert any("meta.json schema" in e for e in errors)

    def test_schema_file_missing_is_fail(self, tmp_path, monkeypatch):
        if not vd.HAS_JSONSCHEMA:
            pytest.skip("jsonschema not installed")
        monkeypatch.setattr(vd, "SCHEMA_DIR", tmp_path / "empty_schemas")
        errors = vd.validate_schemas({"meta.json": {}})
        assert any("meta.schema.json" in e for e in errors)


class TestCrossReferences:
    def test_skip_no_characters(self):
        assert vd.validate_cross_references({}) == []

    def test_no_realms_unique_ids_pass(self):
        chars = [{"id": "1"}, {"id": "2"}]
        assert vd.validate_cross_references({"characters.json": chars}) == []

    def test_no_realms_duplicate_id_fails(self):
        chars = [{"id": "1"}, {"id": "1"}]
        errors = vd.validate_cross_references({"characters.json": chars})
        assert any("duplicate id" in e for e in errors)

    def test_legacy_dict_shape(self):
        loaded = {
            "characters.json": {"characters": [{"id": "1"}], "sr_characters": [{"id": "2"}]},
        }
        assert vd.validate_cross_references(loaded) == []

    def test_realm_xref_pass(self):
        loaded = {
            "realms.json": {"realms": [{"id": "alpha"}, {"id": "beta", "legacy_id": "b"}]},
            "characters.json": [{"id": "1", "realm": "alpha"}, {"id": "2", "realm": "b"}],
        }
        assert vd.validate_cross_references(loaded) == []

    def test_realm_xref_unknown_realm_fails(self):
        loaded = {
            "realms.json": {"realms": [{"id": "alpha"}]},
            "characters.json": [{"id": "1", "realm": "ghost"}],
        }
        errors = vd.validate_cross_references(loaded)
        assert any("unknown realm" in e for e in errors)

    def test_null_realm_skipped(self):
        loaded = {
            "realms.json": {"realms": [{"id": "alpha"}]},
            "characters.json": [{"id": "1", "realm": None}],
        }
        assert vd.validate_cross_references(loaded) == []


class TestMain:
    def test_main_all_passed(self, tmp_path, monkeypatch):
        db = tmp_path / "db"
        _write(db / "characters.json", [{"id": "1"}])
        monkeypatch.setattr(vd, "DB_DIR", db)
        monkeypatch.setattr(vd, "HAS_JSONSCHEMA", False)
        # Schema step will FAIL because HAS_JSONSCHEMA False -> ensure that path
        rc = vd.main()
        assert rc == 1  # jsonschema missing produces an error

    def test_main_all_passed_with_jsonschema(self, tmp_path, monkeypatch):
        if not vd.HAS_JSONSCHEMA:
            pytest.skip("jsonschema not installed")
        db = tmp_path / "db"
        schema_dir = tmp_path / "schemas"
        _write(db / "characters.json", [{"id": "1"}])
        _write(schema_dir / "characters.schema.json", {"type": "array"})
        monkeypatch.setattr(vd, "DB_DIR", db)
        monkeypatch.setattr(vd, "SCHEMA_DIR", schema_dir)
        rc = vd.main()
        assert rc == 0

    def test_main_failure(self, tmp_path, monkeypatch):
        db = tmp_path / "db"
        _write(db / "bad.json", None, raw="{broken")
        monkeypatch.setattr(vd, "DB_DIR", db)
        rc = vd.main()
        assert rc == 1
