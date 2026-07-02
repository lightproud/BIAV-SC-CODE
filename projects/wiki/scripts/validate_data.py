#!/usr/bin/env python3
"""Validate all wiki JSON data files against schemas and cross-references.

Current validation target (2026-07-02 realignment): the W2 trusted baseline
projects/wiki/data/processed/characters.json (shape {_meta, characters[]},
schema characters.processed.schema.json). The legacy data/db/ structured
layer was wiped by keeper ruling 2026-06-15; its absence is expected (NOTE,
not FAIL) and its schemas stay registered as SKIP until that layer is
rebuilt.

Usage:
    python projects/wiki/scripts/validate_data.py

Exit codes:
    0 = all validations passed
    1 = one or more validations failed
"""

import json
import sys
from pathlib import Path

# Resolve paths relative to this script's location
SCRIPT_DIR = Path(__file__).resolve().parent
DB_DIR = SCRIPT_DIR.parent / "data" / "db"
PROCESSED_DIR = SCRIPT_DIR.parent / "data" / "processed"
SCHEMA_DIR = SCRIPT_DIR.parent / "data" / "schemas"

# Try to import jsonschema; fall back to basic validation if unavailable
try:
    import jsonschema
    HAS_JSONSCHEMA = True
except ImportError:
    HAS_JSONSCHEMA = False

# Mapping of legacy data/db/ files to their schema files (layer wiped
# 2026-06-15; entries stay registered and SKIP until the layer is rebuilt)
SCHEMA_MAP = {
    "meta.json": "meta.schema.json",
    "realms.json": "realms.schema.json",
    "characters.json": "characters.schema.json",
    "trinkets.json": "trinkets.schema.json",
    "banners.json": "banners.schema.json",
    "stages.json": "stages.schema.json",
    "items.json": "items.schema.json",
}

# Mapping of current data/processed/ baseline files to their schema files
PROCESSED_SCHEMA_MAP = {
    "characters.json": "characters.processed.schema.json",
}


def load_json(path: Path) -> tuple[dict | list | None, str | None]:
    """Load and parse a JSON file. Returns (data, error_message)."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data, None
    except json.JSONDecodeError as e:
        return None, f"JSON syntax error: {e}"
    except FileNotFoundError:
        return None, "File not found"


def validate_json_syntax(db_dir: Path) -> tuple[list[str], dict[str, object]]:
    """Validate JSON syntax for all .json files in db_dir.

    Returns (errors, loaded_data_dict).
    """
    errors = []
    loaded = {}
    json_files = sorted(db_dir.glob("*.json"))

    if not json_files:
        errors.append(f"No JSON files found in {db_dir}")
        return errors, loaded

    for fp in json_files:
        data, err = load_json(fp)
        if err:
            errors.append(f"  FAIL  {fp.name}: {err}")
        else:
            loaded[fp.name] = data
            print(f"  PASS  {fp.name} (valid JSON)")

    return errors, loaded


def validate_schemas(loaded: dict[str, object], schema_map: dict[str, str] | None = None,
                     label: str = "") -> list[str]:
    """Validate data files against their JSON schemas.

    Missing data files are reported as SKIP, not FAIL, so registering a
    schema for a not-yet-populated entity (e.g. trinkets.json before the
    trinket dataset is filled) does not block CI. Schema files that exist
    but cannot be loaded are still hard FAILs.
    """
    errors = []
    schema_map = SCHEMA_MAP if schema_map is None else schema_map

    if not HAS_JSONSCHEMA:
        print("  ERROR jsonschema not installed — schema validation cannot run.")
        print("        Install with: pip install jsonschema")
        errors.append(
            "  FAIL  Schema validation: jsonschema library missing"
            " (pip install jsonschema)"
        )
        return errors

    for data_file, schema_file in schema_map.items():
        if data_file not in loaded:
            print(f"  SKIP  {label}{data_file}: file not present (schema {schema_file} stays registered)")
            continue

        schema_path = SCHEMA_DIR / schema_file
        schema, err = load_json(schema_path)
        if err:
            errors.append(f"  FAIL  {schema_file}: {err}")
            continue

        try:
            jsonschema.validate(instance=loaded[data_file], schema=schema)
            print(f"  PASS  {label}{data_file} matches {schema_file}")
        except jsonschema.ValidationError as e:
            path_str = " -> ".join(str(p) for p in e.absolute_path) if e.absolute_path else "(root)"
            errors.append(f"  FAIL  {label}{data_file} schema: {path_str}: {e.message}")

    return errors


def load_processed_baseline() -> tuple[list[str], dict[str, object]]:
    """Load the current data/processed/ baseline files (missing = FAIL)."""
    errors = []
    loaded = {}
    for fname in PROCESSED_SCHEMA_MAP:
        data, err = load_json(PROCESSED_DIR / fname)
        if err:
            errors.append(f"  FAIL  processed/{fname}: {err}")
        else:
            loaded[fname] = data
            print(f"  PASS  processed/{fname} (valid JSON)")
    return errors, loaded


def validate_processed_consistency(loaded: dict[str, object]) -> list[str]:
    """Internal consistency of the processed baseline:
    _meta.total_characters must equal len(characters)."""
    errors = []
    chars = loaded.get("characters.json")
    if not isinstance(chars, dict):
        return errors
    declared = chars.get("_meta", {}).get("total_characters")
    actual = len(chars.get("characters", []))
    if declared != actual:
        errors.append(
            f"  FAIL  processed/characters.json: _meta.total_characters={declared}"
            f" != len(characters)={actual}"
        )
    else:
        print(f"  PASS  processed/characters.json: _meta.total_characters == {actual}")
    return errors


def validate_cross_references(loaded: dict[str, object]) -> list[str]:
    """Cross-reference checks between data files.

    characters.json is a flat array of character records. Each record's
    realm field (when non-null) must match a realm id from realms.json.
    Roles are free-form strings until role_types is reintroduced.
    """
    errors = []

    realms_data = loaded.get("realms.json")
    chars_data = loaded.get("characters.json")

    if not chars_data:
        print("  SKIP  Cross-reference checks (missing characters.json)")
        return errors

    # Normalize characters.json to a flat list (handles both the legacy
    # object-with-characters-key shape and the current top-level array shape).
    if isinstance(chars_data, list):
        all_chars = chars_data
    else:
        all_chars = list(chars_data.get("characters", []))
        all_chars.extend(chars_data.get("sr_characters", []))

    if not realms_data:
        print(f"  SKIP  Realm cross-reference (realms.json absent); checked {len(all_chars)} character ids only")
        seen_ids: dict[str, str] = {}
        for char in all_chars:
            cid = str(char.get("id", "unknown"))
            if cid in seen_ids:
                errors.append(f"  FAIL  characters.json: duplicate id '{cid}'")
            else:
                seen_ids[cid] = char.get("slug", "")
        if not errors:
            print(f"  PASS  Cross-references: {len(all_chars)} unique character ids")
        return errors

    valid_realm_ids = set()
    for realm in realms_data.get("realms", []):
        valid_realm_ids.add(realm["id"])
        if "legacy_id" in realm:
            valid_realm_ids.add(realm["legacy_id"])

    for char in all_chars:
        char_id = str(char.get("id", "unknown"))
        realm = char.get("realm")
        # Stub characters carry realm=None; only validate when non-null
        if realm is not None and realm not in valid_realm_ids:
            errors.append(
                f"  FAIL  characters.json: character '{char_id}' has unknown realm '{realm}' "
                f"(valid: {sorted(valid_realm_ids)})"
            )

    if not errors:
        print(f"  PASS  Cross-references: {len(all_chars)} characters validated against realms.json")

    return errors


def main() -> int:
    print("=" * 60)
    print("Morimens Wiki Data Validation")
    print("=" * 60)
    print()

    all_errors: list[str] = []

    # 1. Legacy db layer (wiped 2026-06-15; absence is expected, not an error)
    print("[1/4] Legacy data/db/ JSON syntax check")
    db_loaded: dict[str, object] = {}
    if DB_DIR.exists() and any(DB_DIR.glob("*.json")):
        syntax_errors, db_loaded = validate_json_syntax(DB_DIR)
        all_errors.extend(syntax_errors)
    else:
        print("  NOTE  data/db/ absent (structured layer wiped by keeper ruling"
              " 2026-06-15); current baseline lives in data/processed/")
    print()

    # 2. Current processed baseline (missing = FAIL)
    print("[2/4] Processed baseline load")
    load_errors, processed_loaded = load_processed_baseline()
    all_errors.extend(load_errors)
    print()

    # 3. Schema validation (legacy map SKIPs; processed map validates)
    print("[3/4] Schema validation")
    all_errors.extend(validate_schemas(db_loaded))
    all_errors.extend(validate_schemas(processed_loaded, PROCESSED_SCHEMA_MAP, label="processed/"))
    all_errors.extend(validate_processed_consistency(processed_loaded))
    print()

    # 4. Cross-reference validation (processed shape normalized inside;
    # if the db layer is ever rebuilt its characters.json takes precedence
    # only when processed is absent)
    print("[4/4] Cross-reference checks")
    merged = {**db_loaded, **processed_loaded}
    all_errors.extend(validate_cross_references(merged))
    print()

    # Summary
    print("=" * 60)
    if all_errors:
        print(f"FAILED: {len(all_errors)} error(s)")
        for err in all_errors:
            print(err)
        return 1
    else:
        total_files = len(db_loaded) + len(processed_loaded)
        schemas_checked = 0
        if HAS_JSONSCHEMA:
            schemas_checked = (sum(1 for f in SCHEMA_MAP if f in db_loaded)
                               + sum(1 for f in PROCESSED_SCHEMA_MAP if f in processed_loaded))
        print(f"ALL PASSED: {total_files} files checked, {schemas_checked} schemas validated")
        return 0


if __name__ == "__main__":
    sys.exit(main())
