#!/usr/bin/env python3
"""Validate all wiki JSON data files against schemas and cross-references.

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
SCHEMA_DIR = SCRIPT_DIR.parent / "data" / "schemas"

# Try to import jsonschema; fall back to basic validation if unavailable
try:
    import jsonschema
    HAS_JSONSCHEMA = True
except ImportError:
    HAS_JSONSCHEMA = False

# Mapping of data files to their schema files
SCHEMA_MAP = {
    "meta.json": "meta.schema.json",
    "realms.json": "realms.schema.json",
    "characters.json": "characters.schema.json",
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


def validate_schemas(loaded: dict[str, object]) -> list[str]:
    """Validate data files against their JSON schemas."""
    errors = []

    if not HAS_JSONSCHEMA:
        print("  SKIP  Schema validation (jsonschema not installed)")
        return errors

    for data_file, schema_file in SCHEMA_MAP.items():
        if data_file not in loaded:
            errors.append(f"  FAIL  {data_file}: not loaded, cannot validate schema")
            continue

        schema_path = SCHEMA_DIR / schema_file
        schema, err = load_json(schema_path)
        if err:
            errors.append(f"  FAIL  {schema_file}: {err}")
            continue

        try:
            jsonschema.validate(instance=loaded[data_file], schema=schema)
            print(f"  PASS  {data_file} matches {schema_file}")
        except jsonschema.ValidationError as e:
            path_str = " -> ".join(str(p) for p in e.absolute_path) if e.absolute_path else "(root)"
            errors.append(f"  FAIL  {data_file} schema: {path_str}: {e.message}")

    return errors


def validate_cross_references(loaded: dict[str, object]) -> list[str]:
    """Cross-reference checks between data files."""
    errors = []

    realms_data = loaded.get("realms.json")
    chars_data = loaded.get("characters.json")

    if not realms_data or not chars_data:
        print("  SKIP  Cross-reference checks (missing realms.json or characters.json)")
        return errors

    # Build valid realm IDs (include legacy_id as well)
    valid_realm_ids = set()
    for realm in realms_data.get("realms", []):
        valid_realm_ids.add(realm["id"])
        if "legacy_id" in realm:
            valid_realm_ids.add(realm["legacy_id"])

    # Build valid role keys
    valid_roles = set(chars_data.get("role_types", {}).keys())

    # Check each character (SSR)
    all_chars = chars_data.get("characters", [])
    for char in all_chars:
        char_id = char.get("id", "unknown")

        realm = char.get("realm")
        if realm not in valid_realm_ids:
            errors.append(
                f"  FAIL  characters.json: character '{char_id}' has unknown realm '{realm}' "
                f"(valid: {sorted(valid_realm_ids)})"
            )

        role = char.get("role")
        if role not in valid_roles:
            errors.append(
                f"  FAIL  characters.json: character '{char_id}' has unknown role '{role}' "
                f"(valid: {sorted(valid_roles)})"
            )

    # Check SR characters (realm only -- SR roles may differ from role_types)
    sr_chars = chars_data.get("sr_characters", [])
    for char in sr_chars:
        char_id = char.get("id", "unknown")

        realm = char.get("realm")
        if realm not in valid_realm_ids:
            errors.append(
                f"  FAIL  characters.json: SR character '{char_id}' has unknown realm '{realm}' "
                f"(valid: {sorted(valid_realm_ids)})"
            )

    total = len(all_chars) + len(sr_chars)
    if not errors:
        print(f"  PASS  Cross-references: all {total} characters have valid realm and role")

    return errors


def main() -> int:
    print("=" * 60)
    print("Morimens Wiki Data Validation")
    print("=" * 60)
    print()

    all_errors: list[str] = []

    # 1. JSON syntax validation
    print("[1/3] JSON syntax check")
    syntax_errors, loaded = validate_json_syntax(DB_DIR)
    all_errors.extend(syntax_errors)
    print()

    # 2. Schema validation
    print("[2/3] Schema validation")
    schema_errors = validate_schemas(loaded)
    all_errors.extend(schema_errors)
    print()

    # 3. Cross-reference validation
    print("[3/3] Cross-reference checks")
    xref_errors = validate_cross_references(loaded)
    all_errors.extend(xref_errors)
    print()

    # Summary
    print("=" * 60)
    if all_errors:
        print(f"FAILED: {len(all_errors)} error(s)")
        for err in all_errors:
            print(err)
        return 1
    else:
        total_files = len(list(DB_DIR.glob("*.json")))
        schemas_checked = sum(1 for f in SCHEMA_MAP if f in loaded) if HAS_JSONSCHEMA else 0
        print(f"ALL PASSED: {total_files} files checked, {schemas_checked} schemas validated")
        return 0


if __name__ == "__main__":
    sys.exit(main())
