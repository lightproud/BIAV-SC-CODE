"""Integration tests for validate_data.py against the REAL jsonschema library
and the REAL wiki schemas in projects/wiki/data/schemas/.

Recommendation #3 of the test-hardening effort: the unit sweep
(test_validate_data_unit.py) mocked jsonschema / stubbed HAS_JSONSCHEMA and fed
toy schemas, so the env-gated real-schema branch (validate_data.validate_schemas,
~lines 100-111) was never exercised against the production schemas. These tests
do that end-to-end with no mocks on jsonschema:

  - require the real jsonschema (importorskip; the module must actually import it),
  - copy the REAL schemas into tmp_path and point SCHEMA_DIR/DB_DIR there,
  - feed a VALID dataset -> assert validation PASSES,
  - feed an INVALID dataset (wrong type / missing required) -> assert it FAILS.

The real projects/wiki/data tree is NEVER mutated: only SCHEMA_DIR/DB_DIR module
globals are redirected (via monkeypatch) into tmp_path.
"""

import json
import shutil
import sys
from pathlib import Path

import pytest

# Require the genuine jsonschema dependency. If it cannot be imported the whole
# module skips with a clear reason rather than silently passing on a stub.
pytest.importorskip("jsonschema")

REPO = Path(__file__).resolve().parent.parent
WIKI_SCRIPTS = REPO / "projects" / "wiki" / "scripts"
REAL_SCHEMA_DIR = REPO / "projects" / "wiki" / "data" / "schemas"

sys.path.insert(0, str(WIKI_SCRIPTS))

import validate_data as vd  # noqa: E402


def test_module_imported_real_jsonschema():
    """validate_data must have imported the genuine jsonschema (not a stub)."""
    assert vd.HAS_JSONSCHEMA is True, (
        "validate_data.HAS_JSONSCHEMA is False -> the real jsonschema import "
        "inside the module failed even though jsonschema is installed."
    )


def _valid_realm() -> dict:
    return {
        "id": "chaos",
        "name": "混沌",
        "name_en": "Chaos",
        "color": "#aabbcc",
        "icon": "icon_chaos",
        "difficulty": 3,
        "team_rule_v1": "rule one",
        "team_rule_v2": "rule two",
        "realm_talent": {"name": "天赋", "description": "talent desc"},
        "pure_resonance": {"name": "纯共鸣", "description": "resonance desc"},
        "co_resonance": [],
        "core_mechanic": "core mechanic text",
        "starter_tip": "starter tip text",
    }


def _valid_character() -> dict:
    """A schema-conforming stub-state character record (status=fixture)."""
    return {
        "id": "10001",
        "slug": "test_awakener",
        "name_zh": "测试唤醒体",
        "title_zh": "测试称号",
        "realm": "chaos",
        "gender": "female",
        "voice_actor": "VA",
        "painter": "Painter",
        "characteristic": ["trait_a", "trait_b"],
        "skills": "pending",
        "trinkets": "pending",
        "commune": "pending",
        "background_story": "pending",
        "portraits": {"default": None, "awaker": None, "skins": []},
        "source": {"extracted_from": "fixture", "extracted_at": "2026-06-21"},
        "last_verified": "2026-06-21",
        "status": "fixture",
    }


@pytest.fixture()
def schema_env(tmp_path, monkeypatch):
    """Copy the REAL schemas into tmp_path and redirect SCHEMA_DIR/DB_DIR there.

    Returns (db_dir, schema_dir). The real data tree is never touched.
    """
    schema_dir = tmp_path / "schemas"
    db_dir = tmp_path / "db"
    schema_dir.mkdir()
    db_dir.mkdir()
    for sf in REAL_SCHEMA_DIR.glob("*.schema.json"):
        shutil.copy2(sf, schema_dir / sf.name)
    monkeypatch.setattr(vd, "SCHEMA_DIR", schema_dir)
    monkeypatch.setattr(vd, "DB_DIR", db_dir)
    return db_dir, schema_dir


def test_valid_dataset_passes_real_schemas(schema_env):
    """A conforming dataset validated against the real schemas reports no errors."""
    loaded = {
        "realms.json": {
            "description": "realm definitions",
            "team_rule": "global team rule",
            "realms": [_valid_realm()],
        },
        "characters.json": [_valid_character()],
    }
    errors = vd.validate_schemas(loaded)
    assert errors == [], f"expected clean validation, got: {errors}"


def test_invalid_wrong_type_fails_real_schema(schema_env):
    """realms.json with a wrong-typed field is rejected by the real schema."""
    bad = {
        "description": "realm definitions",
        "team_rule": "global team rule",
        "realms": [{**_valid_realm(), "difficulty": "not-an-integer"}],
    }
    errors = vd.validate_schemas({"realms.json": bad})
    assert any("realms.json schema" in e for e in errors), errors


def test_invalid_missing_required_fails_real_schema(schema_env):
    """A character record missing a required field is rejected by the real schema."""
    char = _valid_character()
    del char["status"]  # 'status' is required by characters.schema.json
    errors = vd.validate_schemas({"characters.json": [char]})
    assert any("characters.json schema" in e for e in errors), errors


def test_main_end_to_end_passes_with_real_schemas(schema_env):
    """Full main() driver: write real-schema-conforming files to the redirected
    DB_DIR and run the complete 3-stage validation; exit code must be 0."""
    db_dir, _ = schema_env
    (db_dir / "realms.json").write_text(
        json.dumps(
            {
                "description": "realm definitions",
                "team_rule": "global team rule",
                "realms": [_valid_realm()],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (db_dir / "characters.json").write_text(
        json.dumps([_valid_character()], ensure_ascii=False),
        encoding="utf-8",
    )
    rc = vd.main()
    assert rc == 0


def test_main_end_to_end_fails_on_schema_violation(schema_env):
    """Full main() driver with a schema-violating realms.json returns exit 1."""
    db_dir, _ = schema_env
    (db_dir / "realms.json").write_text(
        json.dumps(
            {
                "description": "realm definitions",
                "team_rule": "global team rule",
                "realms": [{**_valid_realm(), "difficulty": 99}],  # max is 5
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    rc = vd.main()
    assert rc == 1
