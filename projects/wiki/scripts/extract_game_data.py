#!/usr/bin/env python3
"""
Extract and parse game data from Morimens (忘却前夜) Unity client exports.

This script processes data files that have been exported from the game client
using tools like AssetStudio or UnityPy. It maps extracted fields to the
wiki database schema (characters.json, equipment.json, etc.).

=== How to extract game data ===

Morimens is a Unity game distributed on Steam (App ID: 3052450 CN, 4226130 JP)
and mobile platforms. Game data can be found in several locations:

1. STEAM CLIENT PATHS:
   Windows:
     C:\\Program Files (x86)\\Steam\\steamapps\\common\\Morimens\\
     C:\\Program Files (x86)\\Steam\\steamapps\\common\\Morimens\\Morimens_Data\\
   macOS:
     ~/Library/Application Support/Steam/steamapps/common/Morimens/

   Key subdirectories:
     Morimens_Data/StreamingAssets/     - External config, localization, audio
     Morimens_Data/Resources/           - Built-in resources
     Morimens_Data/Managed/             - .NET assemblies (game logic)
     Morimens_Data/data.unity3d         - Main asset bundle (or level files)

2. MOBILE CLIENT PATHS (Android APK):
   Unpack the APK (it is a zip file):
     assets/bin/Data/                   - Unity data files
     assets/bin/Data/StreamingAssets/   - External assets
     assets/bin/Data/Managed/           - Assemblies

3. COMMON DATA FORMATS:
   - JSON config tables (character stats, skill data, item definitions)
   - CSV/TSV tables (stat growth curves, drop tables)
   - ScriptableObject exports (.asset files, exportable via AssetStudio as JSON)
   - Flat binary tables (may need reverse engineering)
   - TextAsset (.txt, .bytes, .json embedded in asset bundles)

4. REQUIRED TOOLS:
   - AssetStudio (GUI): https://github.com/Perfare/AssetStudio
     Best for browsing and bulk-exporting assets (textures, audio, text).
   - UnityPy (Python): pip install UnityPy
     Scriptable extraction; can iterate asset bundles programmatically.
   - Il2CppDumper: https://github.com/Perfare/Il2CppDumper
     If the game uses IL2CPP (likely for mobile builds), this recovers
     C# class definitions from native binaries + global-metadata.dat.
   - UABE (Unity Asset Bundle Extractor): for manual asset inspection.
   - dnSpy / ILSpy: for inspecting Managed/*.dll if Mono build.

5. EXTRACTION WORKFLOW:
   a) Locate game install directory
   b) Open Morimens_Data/ in AssetStudio -> Export all assets
      OR use UnityPy script (see unitypy_extract_example() below)
   c) Exported TextAssets often contain JSON/CSV game tables
   d) Run this script on the export directory to parse and map data

Usage:
  python3 extract_game_data.py --input-dir /path/to/exported/data
  python3 extract_game_data.py --input-dir /path/to/exported/data --dry-run
  python3 extract_game_data.py --input-dir /path/to/exported/data --type characters
  python3 extract_game_data.py --input-dir /path/to/exported/data --type all

Requires: Python 3.8+ (stdlib only for core; UnityPy optional for direct extraction)
"""

import argparse
import csv
import io
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent  # brain-in-a-vat/
DB_DIR = SCRIPT_DIR.parent / "data" / "db"
CHARACTERS_JSON = DB_DIR / "characters.json"

# ---------------------------------------------------------------------------
# Schema mapping configuration
# ---------------------------------------------------------------------------

# Maps raw game data field names (various possible conventions) to our schema.
# Keys are possible field names found in game exports; values are our schema keys.
CHARACTER_FIELD_MAP = {
    # ID fields
    "id": "id",
    "Id": "id",
    "ID": "id",
    "characterId": "id",
    "char_id": "id",
    "heroId": "id",
    # Name fields
    "name": "name",
    "Name": "name",
    "name_cn": "name",
    "nameCN": "name",
    "name_en": "name_en",
    "nameEN": "name_en",
    "nameEn": "name_en",
    "name_jp": "name_jp",
    "nameJP": "name_jp",
    "nameJp": "name_jp",
    # Rarity
    "rarity": "rarity",
    "Rarity": "rarity",
    "star": "rarity",
    "quality": "rarity",
    "rank": "rarity",
    # Realm / Attribute
    "realm": "realm",
    "Realm": "realm",
    "attribute": "realm",
    "Attribute": "realm",
    "element": "realm",
    "attr_id": "realm",
    "attrId": "realm",
    # Role type
    "role": "role",
    "Role": "role",
    "roleType": "role",
    "role_type": "role",
    "class": "role",
    "job": "role",
    "jobType": "role",
    # Availability
    "isLimited": "is_limited",
    "is_limited": "is_limited",
    "limited": "is_limited",
    # Description
    "desc": "description",
    "description": "description",
    "Description": "description",
    "profile": "description",
}

# Realm ID normalization: game may use numeric IDs or alternative names
REALM_NORMALIZE = {
    "1": "chaos",
    "2": "deep_sea",
    "3": "flesh",
    "4": "hyperdimension",
    "chaos": "chaos",
    "deep_sea": "deep_sea",
    "deepSea": "deep_sea",
    "deepsea": "deep_sea",
    "flesh": "flesh",
    "hyperdimension": "hyperdimension",
    "hyper": "hyperdimension",
    "ultra": "hyperdimension",
    # Chinese names
    "混沌": "chaos",
    "深海": "deep_sea",
    "血肉": "flesh",
    "超维": "hyperdimension",
}

# Rarity normalization
RARITY_NORMALIZE = {
    "5": "SSR",
    "4": "SR",
    "3": "R",
    "ssr": "SSR",
    "sr": "SR",
    "r": "R",
    "SSR": "SSR",
    "SR": "SR",
    "R": "R",
}

# Role normalization
ROLE_NORMALIZE = {
    "1": "attack",
    "2": "defense",
    "3": "support",
    "4": "healer",
    "5": "sub_attack",
    "6": "chorus",
    "attack": "attack",
    "defense": "defense",
    "support": "support",
    "healer": "healer",
    "sub_attack": "sub_attack",
    "chorus": "chorus",
    "输出": "attack",
    "防御": "defense",
    "辅助": "support",
    "治疗": "healer",
    "副输出": "sub_attack",
    "合唱": "chorus",
    "dps": "attack",
    "tank": "defense",
    "heal": "healer",
}

# Fields for stat tables (base stats at various levels)
STAT_FIELDS = {
    "hp": "hp",
    "HP": "hp",
    "atk": "atk",
    "ATK": "atk",
    "attack": "atk",
    "Attack": "atk",
    "def": "def",
    "DEF": "def",
    "defense": "def",
    "Defense": "def",
    "spd": "spd",
    "SPD": "spd",
    "speed": "spd",
    "Speed": "spd",
}

# Skill data field mapping
SKILL_FIELD_MAP = {
    "skillId": "skill_id",
    "skill_id": "skill_id",
    "skillName": "name",
    "skill_name": "name",
    "name": "name",
    "skillNameEn": "name_en",
    "cost": "cost",
    "Cost": "cost",
    "mp_cost": "cost",
    "desc": "effect",
    "description": "effect",
    "effect": "effect",
    "skillDesc": "effect",
    "skillType": "type",
    "skill_type": "type",
}


# ---------------------------------------------------------------------------
# File discovery
# ---------------------------------------------------------------------------

def find_data_files(input_dir: Path) -> dict[str, list[Path]]:
    """Scan input directory for parseable data files, grouped by type."""
    results: dict[str, list[Path]] = {
        "json": [],
        "csv": [],
        "tsv": [],
        "txt": [],
        "asset": [],
    }
    for root, _dirs, files in os.walk(input_dir):
        for fname in files:
            fpath = Path(root) / fname
            ext = fpath.suffix.lower()
            if ext == ".json":
                results["json"].append(fpath)
            elif ext == ".csv":
                results["csv"].append(fpath)
            elif ext in (".tsv", ".tab"):
                results["tsv"].append(fpath)
            elif ext == ".txt":
                results["txt"].append(fpath)
            elif ext in (".asset", ".bytes"):
                results["asset"].append(fpath)
    return results


def classify_file(fpath: Path) -> Optional[str]:
    """Heuristic: determine what kind of game data a file contains."""
    name = fpath.stem.lower()
    # Character-related
    char_patterns = [
        "character", "hero", "char", "awakener", "unit",
        "角色", "唤醒体",
    ]
    if any(p in name for p in char_patterns):
        return "characters"
    # Skill-related
    skill_patterns = ["skill", "ability", "card", "技能", "卡牌"]
    if any(p in name for p in skill_patterns):
        return "skills"
    # Equipment / items
    equip_patterns = [
        "equip", "item", "weapon", "artifact", "relic",
        "covenant", "密契", "装备",
    ]
    if any(p in name for p in equip_patterns):
        return "equipment"
    # Stats
    stat_patterns = ["stat", "growth", "level", "属性", "成长"]
    if any(p in name for p in stat_patterns):
        return "stats"
    # Stage / map
    stage_patterns = ["stage", "map", "dungeon", "关卡", "地图"]
    if any(p in name for p in stage_patterns):
        return "stages"
    # Localization
    loc_patterns = ["locale", "lang", "text", "string", "i18n", "翻译"]
    if any(p in name for p in loc_patterns):
        return "localization"
    return None


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

def parse_json_file(fpath: Path) -> Any:
    """Parse a JSON file, handling BOM and common encoding issues."""
    for encoding in ("utf-8-sig", "utf-8", "utf-16", "gbk", "shift_jis"):
        try:
            text = fpath.read_text(encoding=encoding)
            return json.loads(text)
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    print(f"  WARNING: Could not parse JSON: {fpath}", file=sys.stderr)
    return None


def parse_csv_file(fpath: Path, delimiter: str = ",") -> list[dict]:
    """Parse a CSV/TSV file into list of dicts."""
    for encoding in ("utf-8-sig", "utf-8", "gbk", "shift_jis"):
        try:
            text = fpath.read_text(encoding=encoding)
            reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
            return list(reader)
        except (UnicodeDecodeError, csv.Error):
            continue
    print(f"  WARNING: Could not parse CSV: {fpath}", file=sys.stderr)
    return []


def parse_scriptable_object(fpath: Path) -> Any:
    """
    Attempt to parse a ScriptableObject export.
    AssetStudio exports ScriptableObjects as JSON-like dumps.
    Some may also be YAML (Unity serialization format).
    """
    text = None
    for encoding in ("utf-8-sig", "utf-8"):
        try:
            text = fpath.read_text(encoding=encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        return None

    # Try JSON first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try line-based key-value (common in Unity YAML exports)
    result = {}
    for line in text.splitlines():
        line = line.strip()
        if ":" in line and not line.startswith("#") and not line.startswith("-"):
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip()
            if val:
                result[key] = val
    return result if result else None


def try_parse_txt_as_table(fpath: Path) -> Optional[list[dict]]:
    """Some .txt files are actually TSV or CSV tables."""
    text = None
    for encoding in ("utf-8-sig", "utf-8", "gbk"):
        try:
            text = fpath.read_text(encoding=encoding)
            break
        except UnicodeDecodeError:
            continue
    if not text:
        return None

    lines = text.strip().splitlines()
    if len(lines) < 2:
        return None

    # Detect delimiter
    first_line = lines[0]
    if "\t" in first_line:
        delimiter = "\t"
    elif "," in first_line:
        delimiter = ","
    elif "|" in first_line:
        delimiter = "|"
    else:
        return None

    try:
        reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
        rows = list(reader)
        return rows if rows else None
    except csv.Error:
        return None


# ---------------------------------------------------------------------------
# Data mappers
# ---------------------------------------------------------------------------

def map_character_record(raw: dict) -> Optional[dict]:
    """Map a raw game data record to our characters.json schema."""
    mapped = {}
    for raw_key, raw_val in raw.items():
        schema_key = CHARACTER_FIELD_MAP.get(raw_key)
        if schema_key:
            mapped[schema_key] = raw_val

    if "id" not in mapped and "name" not in mapped:
        return None  # Not enough data to identify

    # Normalize realm
    if "realm" in mapped:
        realm_raw = str(mapped["realm"]).strip().lower()
        mapped["realm"] = REALM_NORMALIZE.get(
            realm_raw, REALM_NORMALIZE.get(str(mapped["realm"]).strip(), mapped["realm"])
        )

    # Normalize rarity
    if "rarity" in mapped:
        rarity_raw = str(mapped["rarity"]).strip()
        mapped["rarity"] = RARITY_NORMALIZE.get(
            rarity_raw, RARITY_NORMALIZE.get(rarity_raw.lower(), mapped["rarity"])
        )

    # Normalize role
    if "role" in mapped:
        role_raw = str(mapped["role"]).strip()
        mapped["role"] = ROLE_NORMALIZE.get(
            role_raw, ROLE_NORMALIZE.get(role_raw.lower(), mapped["role"])
        )

    # Generate id from name if missing
    if "id" not in mapped and "name_en" in mapped:
        mapped["id"] = re.sub(r"[^a-z0-9]+", "_", mapped["name_en"].lower()).strip("_")
    elif "id" not in mapped and "name" in mapped:
        mapped["id"] = str(mapped["name"])

    # Ensure is_limited is boolean
    if "is_limited" in mapped:
        val = mapped["is_limited"]
        if isinstance(val, str):
            mapped["is_limited"] = val.lower() in ("true", "1", "yes")
        elif isinstance(val, (int, float)):
            mapped["is_limited"] = bool(val)

    # Set defaults for missing fields
    mapped.setdefault("aliases", [])
    mapped.setdefault("tags", [])
    mapped.setdefault("is_limited", False)

    return mapped


def map_skill_record(raw: dict) -> Optional[dict]:
    """Map a raw skill record to our skill schema."""
    mapped = {}
    for raw_key, raw_val in raw.items():
        schema_key = SKILL_FIELD_MAP.get(raw_key)
        if schema_key:
            mapped[schema_key] = raw_val

    if "name" not in mapped:
        return None

    # Ensure cost is int
    if "cost" in mapped:
        try:
            mapped["cost"] = int(mapped["cost"])
        except (ValueError, TypeError):
            pass

    return mapped


# ---------------------------------------------------------------------------
# Merge logic
# ---------------------------------------------------------------------------

def load_existing_characters() -> dict:
    """Load current characters.json and index by id."""
    if not CHARACTERS_JSON.exists():
        return {}
    data = json.loads(CHARACTERS_JSON.read_text("utf-8"))
    chars = data.get("characters", [])
    return {c["id"]: c for c in chars}


def merge_character(existing: dict, new_data: dict) -> dict:
    """Merge new extracted data into existing character record.

    New data fills in blanks but does not overwrite existing non-empty values,
    since the wiki may have manually curated information.
    """
    merged = dict(existing)
    for key, val in new_data.items():
        if key not in merged or merged[key] in (None, "", [], {}):
            merged[key] = val
    return merged


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

def process_directory(input_dir: Path, data_type: str, dry_run: bool) -> dict:
    """Process all data files in the input directory."""
    print(f"Scanning: {input_dir}")
    file_groups = find_data_files(input_dir)

    total_files = sum(len(v) for v in file_groups.values())
    print(f"Found {total_files} data files:")
    for ftype, files in file_groups.items():
        if files:
            print(f"  {ftype}: {len(files)} files")

    results = {
        "characters": [],
        "skills": [],
        "equipment": [],
        "stats": [],
        "stages": [],
        "localization": [],
        "unclassified": [],
    }

    # Process JSON files
    for fpath in file_groups["json"]:
        category = classify_file(fpath)
        if data_type != "all" and category != data_type:
            continue
        print(f"\n  Processing JSON: {fpath.name} (classified as: {category or 'unknown'})")
        data = parse_json_file(fpath)
        if data is None:
            continue
        _process_parsed_data(data, category, fpath, results)

    # Process CSV files
    for fpath in file_groups["csv"]:
        category = classify_file(fpath)
        if data_type != "all" and category != data_type:
            continue
        print(f"\n  Processing CSV: {fpath.name} (classified as: {category or 'unknown'})")
        rows = parse_csv_file(fpath, delimiter=",")
        if rows:
            _process_parsed_data(rows, category, fpath, results)

    # Process TSV files
    for fpath in file_groups["tsv"]:
        category = classify_file(fpath)
        if data_type != "all" and category != data_type:
            continue
        print(f"\n  Processing TSV: {fpath.name} (classified as: {category or 'unknown'})")
        rows = parse_csv_file(fpath, delimiter="\t")
        if rows:
            _process_parsed_data(rows, category, fpath, results)

    # Process .txt files (may be tables)
    for fpath in file_groups["txt"]:
        category = classify_file(fpath)
        if data_type != "all" and category != data_type:
            continue
        rows = try_parse_txt_as_table(fpath)
        if rows:
            print(f"\n  Processing TXT (table): {fpath.name} (classified as: {category or 'unknown'})")
            _process_parsed_data(rows, category, fpath, results)

    # Process .asset / .bytes (ScriptableObject exports)
    for fpath in file_groups["asset"]:
        category = classify_file(fpath)
        if data_type != "all" and category != data_type:
            continue
        print(f"\n  Processing Asset: {fpath.name} (classified as: {category or 'unknown'})")
        data = parse_scriptable_object(fpath)
        if data:
            _process_parsed_data(data, category, fpath, results)

    return results


def _process_parsed_data(
    data: Any, category: Optional[str], fpath: Path, results: dict
) -> None:
    """Route parsed data to appropriate mapper based on category."""
    # Normalize to list of records
    records = []
    if isinstance(data, list):
        records = [r for r in data if isinstance(r, dict)]
    elif isinstance(data, dict):
        # Could be a single record or a wrapper with a list inside
        for key in ("data", "list", "items", "records", "characters", "heroes",
                     "skills", "equipment", "stages"):
            if key in data and isinstance(data[key], list):
                records = [r for r in data[key] if isinstance(r, dict)]
                break
        if not records:
            records = [data]

    if not records:
        return

    if category == "characters":
        for rec in records:
            mapped = map_character_record(rec)
            if mapped:
                results["characters"].append(mapped)
                print(f"    -> Character: {mapped.get('name', mapped.get('id', '?'))}")
    elif category == "skills":
        for rec in records:
            mapped = map_skill_record(rec)
            if mapped:
                results["skills"].append(mapped)
    elif category in results:
        results[category].extend(records)
    else:
        results["unclassified"].append({
            "source": str(fpath),
            "record_count": len(records),
            "sample_keys": list(records[0].keys()) if records else [],
        })
        print(f"    -> Unclassified: {len(records)} records, "
              f"keys: {list(records[0].keys())[:8] if records else '(empty)'}")


def save_results(results: dict, dry_run: bool) -> None:
    """Save mapped results back to the wiki database."""
    # Characters
    if results["characters"]:
        print(f"\n=== Characters: {len(results['characters'])} extracted ===")
        existing = load_existing_characters()
        new_count = 0
        updated_count = 0
        for char in results["characters"]:
            cid = char.get("id", "")
            if cid in existing:
                merged = merge_character(existing[cid], char)
                if merged != existing[cid]:
                    existing[cid] = merged
                    updated_count += 1
                    print(f"  Updated: {cid}")
            else:
                existing[cid] = char
                new_count += 1
                print(f"  New: {cid}")

        print(f"\n  Summary: {new_count} new, {updated_count} updated, "
              f"{len(existing)} total")

        if not dry_run and (new_count > 0 or updated_count > 0):
            # Read full file, update characters list, write back
            full_data = json.loads(CHARACTERS_JSON.read_text("utf-8"))
            full_data["characters"] = list(existing.values())
            CHARACTERS_JSON.write_text(
                json.dumps(full_data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"  Saved to: {CHARACTERS_JSON}")
        elif dry_run:
            print("  (dry-run: no files written)")

    # Dump extraction summary
    output_dir = SCRIPT_DIR.parent / "output"
    summary = {
        "characters_found": len(results["characters"]),
        "skills_found": len(results["skills"]),
        "equipment_found": len(results["equipment"]),
        "unclassified": results["unclassified"],
    }
    if not dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)
        summary_path = output_dir / "extraction_summary.json"
        summary_path.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"\n  Extraction summary: {summary_path}")

        # Save raw extracted data for review
        if results["characters"]:
            raw_path = output_dir / "extracted_characters_raw.json"
            raw_path.write_text(
                json.dumps(results["characters"], ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"  Raw character data: {raw_path}")
        if results["skills"]:
            raw_path = output_dir / "extracted_skills_raw.json"
            raw_path.write_text(
                json.dumps(results["skills"], ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"  Raw skill data: {raw_path}")
    else:
        print(f"\n  Extraction summary (dry-run): {json.dumps(summary, indent=2)}")


# ---------------------------------------------------------------------------
# UnityPy direct extraction helper
# ---------------------------------------------------------------------------

def unitypy_extract_example():
    """
    Example code for extracting TextAssets directly from Unity asset bundles
    using UnityPy. This is NOT called by the main script; it is reference code
    that users can adapt.

    Install: pip install UnityPy
    """
    example_code = '''
import UnityPy
from pathlib import Path
import json

def extract_text_assets(game_data_dir: str, output_dir: str):
    """Extract all TextAsset objects from Unity data files."""
    game_path = Path(game_data_dir)
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # Find all asset files (data.unity3d, level*, sharedassets*, etc.)
    asset_files = []
    for pattern in ["*.unity3d", "level*", "sharedassets*", "resources.assets"]:
        asset_files.extend(game_path.glob(pattern))

    # Also check StreamingAssets for additional bundles
    streaming = game_path / "StreamingAssets"
    if streaming.exists():
        for f in streaming.rglob("*"):
            if f.is_file() and f.suffix not in (".meta",):
                asset_files.append(f)

    print(f"Found {len(asset_files)} asset files to scan")

    for asset_file in asset_files:
        try:
            env = UnityPy.load(str(asset_file))
        except Exception as e:
            print(f"  Skip {asset_file.name}: {e}")
            continue

        for obj in env.objects:
            if obj.type.name == "TextAsset":
                data = obj.read()
                name = data.m_Name
                # Save the text content
                ext = ".json" if _looks_like_json(data.m_Script) else ".txt"
                out_file = out_path / f"{name}{ext}"
                if isinstance(data.m_Script, bytes):
                    out_file.write_bytes(data.m_Script)
                else:
                    out_file.write_text(data.m_Script, encoding="utf-8")
                print(f"  Extracted: {name}{ext} from {asset_file.name}")

            elif obj.type.name == "Texture2D":
                data = obj.read()
                name = data.m_Name
                img = data.image
                out_file = out_path / f"{name}.png"
                img.save(str(out_file))

            elif obj.type.name == "MonoBehaviour":
                # ScriptableObjects are MonoBehaviour assets
                data = obj.read()
                if hasattr(data, "m_Name") and data.m_Name:
                    try:
                        tree = obj.read_typetree()
                        out_file = out_path / f"{data.m_Name}.json"
                        out_file.write_text(
                            json.dumps(tree, ensure_ascii=False, indent=2),
                            encoding="utf-8"
                        )
                        print(f"  Extracted ScriptableObject: {data.m_Name}")
                    except Exception:
                        pass

def _looks_like_json(text):
    if isinstance(text, bytes):
        text = text[:100].decode("utf-8", errors="ignore")
    return text.strip().startswith(("{", "["))

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Usage: python unitypy_extract.py <game_data_dir> <output_dir>")
        sys.exit(1)
    extract_text_assets(sys.argv[1], sys.argv[2])
'''
    return example_code


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Extract and map Morimens game data to wiki schema.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scan exported data and show what would be imported
  python3 extract_game_data.py --input-dir ./exported_assets --dry-run

  # Import only character data
  python3 extract_game_data.py --input-dir ./exported_assets --type characters

  # Import everything
  python3 extract_game_data.py --input-dir ./exported_assets --type all

  # Print UnityPy extraction example code
  python3 extract_game_data.py --show-unitypy-example
        """,
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        help="Directory containing exported game data files",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and display results without writing to database files",
    )
    parser.add_argument(
        "--type",
        choices=["all", "characters", "skills", "equipment", "stats", "stages"],
        default="all",
        help="Type of data to extract (default: all)",
    )
    parser.add_argument(
        "--show-unitypy-example",
        action="store_true",
        help="Print example UnityPy extraction script and exit",
    )

    args = parser.parse_args()

    if args.show_unitypy_example:
        print(unitypy_extract_example())
        return

    if not args.input_dir:
        parser.error("--input-dir is required (or use --show-unitypy-example)")

    if not args.input_dir.is_dir():
        print(f"ERROR: Not a directory: {args.input_dir}", file=sys.stderr)
        sys.exit(1)

    print("=" * 60)
    print("Morimens Game Data Extractor")
    print(f"Input:    {args.input_dir.resolve()}")
    print(f"Type:     {args.type}")
    print(f"Dry-run:  {args.dry_run}")
    print("=" * 60)

    results = process_directory(args.input_dir, args.type, args.dry_run)
    save_results(results, args.dry_run)

    print("\nDone.")


if __name__ == "__main__":
    main()
