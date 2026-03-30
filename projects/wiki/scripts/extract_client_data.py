#!/usr/bin/env python3
"""
Extract game data from Morimens Unity client using UnityPy.

Scans Morimens_Data/ for AssetBundles, extracts:
- TextAsset → JSON/CSV config tables (characters, skills, items, stages, etc.)
- MonoBehaviour → ScriptableObject data (via typetree)
- Texture2D → Character portraits and UI sprites (optional)

Usage:
    python3 extract_client_data.py /path/to/Morimens_Data
    python3 extract_client_data.py /path/to/Morimens_Data --no-textures
    python3 extract_client_data.py /path/to/Morimens_Data --output ./extracted
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

try:
    import UnityPy
    from UnityPy.enums import ClassIDType
except ImportError:
    print("ERROR: UnityPy not installed. Run: pip install UnityPy", file=sys.stderr)
    sys.exit(1)

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DB_DIR = PROJECT_ROOT / "data" / "db"

# Keywords to identify data-relevant assets (skip pure art/audio/shader bundles)
DATA_KEYWORDS = [
    "config", "table", "data", "text", "locale", "lang", "i18n",
    "character", "hero", "skill", "card", "equip", "item", "stage",
    "quest", "mission", "gacha", "shop", "buff", "effect",
    "level", "growth", "stat", "attr",
]

# File patterns to scan inside Morimens_Data/
ASSET_PATTERNS = [
    "*.unity3d",
    "*.assets",
    "*.bundle",
    "*.ab",
    "data.unity3d",
    "sharedassets*.assets",
    "resources.assets",
    "level*",
]


def find_asset_files(game_data_dir: Path) -> list[Path]:
    """Find all Unity asset files to scan."""
    files = []

    # Direct files in Morimens_Data/
    for pattern in ASSET_PATTERNS:
        files.extend(game_data_dir.glob(pattern))

    # StreamingAssets (often contains config bundles)
    streaming = game_data_dir / "StreamingAssets"
    if streaming.exists():
        for f in streaming.rglob("*"):
            if f.is_file() and f.suffix not in (".meta", ".manifest"):
                files.append(f)

    # Persistent data path (hot-update downloads)
    # On Windows: %AppData%/../LocalLow/<Company>/<Product>/
    # We accept it as additional input
    persistent = game_data_dir / "PersistentData"
    if persistent.exists():
        for f in persistent.rglob("*"):
            if f.is_file() and f.suffix not in (".meta", ".manifest", ".log"):
                files.append(f)

    # Deduplicate
    seen = set()
    unique = []
    for f in files:
        fp = f.resolve()
        if fp not in seen:
            seen.add(fp)
            unique.append(f)

    return sorted(unique)


def extract_text_assets(env, output_dir: Path, stats: dict) -> None:
    """Extract TextAsset objects (JSON/CSV/TXT config tables)."""
    for obj in env.objects:
        if obj.type == ClassIDType.TextAsset:
            try:
                data = obj.read()
                name = data.m_Name
                script = data.m_Script

                if isinstance(script, bytes):
                    try:
                        text = script.decode("utf-8")
                    except UnicodeDecodeError:
                        try:
                            text = script.decode("utf-8-sig")
                        except UnicodeDecodeError:
                            stats["binary_skipped"] += 1
                            continue
                else:
                    text = script

                if not text or len(text.strip()) < 2:
                    continue

                # Determine extension
                stripped = text.strip()
                if stripped.startswith(("{", "[")):
                    ext = ".json"
                    # Validate JSON
                    try:
                        json.loads(text)
                    except json.JSONDecodeError:
                        ext = ".txt"
                elif "\t" in stripped.split("\n")[0]:
                    ext = ".tsv"
                elif "," in stripped.split("\n")[0] and stripped.count("\n") > 1:
                    ext = ".csv"
                else:
                    ext = ".txt"

                out_file = output_dir / "text" / f"{name}{ext}"
                out_file.parent.mkdir(parents=True, exist_ok=True)
                out_file.write_text(text, encoding="utf-8")
                stats["text_assets"] += 1

                if ext == ".json":
                    stats["json_files"] += 1

            except Exception as e:
                stats["errors"].append(f"TextAsset: {e}")


def extract_monobehaviours(env, output_dir: Path, stats: dict) -> None:
    """Extract MonoBehaviour/ScriptableObject data via typetree."""
    for obj in env.objects:
        if obj.type == ClassIDType.MonoBehaviour:
            try:
                data = obj.read()
                name = getattr(data, "m_Name", None)
                if not name:
                    continue

                # Try reading typetree for structured data
                try:
                    tree = obj.read_typetree()
                    if tree and isinstance(tree, dict) and len(tree) > 2:
                        out_file = output_dir / "mono" / f"{name}.json"
                        out_file.parent.mkdir(parents=True, exist_ok=True)
                        out_file.write_text(
                            json.dumps(tree, ensure_ascii=False, indent=2, default=str),
                            encoding="utf-8",
                        )
                        stats["mono_assets"] += 1
                except Exception:
                    # Typetree not available (IL2CPP without metadata)
                    pass

            except Exception as e:
                stats["errors"].append(f"MonoBehaviour: {e}")


def extract_textures(env, output_dir: Path, stats: dict, name_filter: str = None) -> None:
    """Extract Texture2D as PNG (for portraits)."""
    if not HAS_PIL:
        return

    for obj in env.objects:
        if obj.type == ClassIDType.Texture2D:
            try:
                data = obj.read()
                name = data.m_Name

                # Filter for portrait-like textures if specified
                if name_filter:
                    name_lower = name.lower()
                    if not any(kw in name_lower for kw in name_filter.split(",")):
                        continue

                img = data.image
                if img.width < 32 or img.height < 32:
                    continue  # Skip tiny textures (icons, etc.)

                out_file = output_dir / "textures" / f"{name}.png"
                out_file.parent.mkdir(parents=True, exist_ok=True)
                img.save(str(out_file))
                stats["textures"] += 1

            except Exception as e:
                stats["errors"].append(f"Texture2D {getattr(data, 'm_Name', '?')}: {e}")


def scan_and_extract(
    game_data_dir: Path,
    output_dir: Path,
    extract_tex: bool = False,
    tex_filter: str = None,
) -> dict:
    """Main extraction: scan all asset files and extract data."""
    asset_files = find_asset_files(game_data_dir)
    print(f"Found {len(asset_files)} asset files to scan")

    stats = {
        "asset_files_scanned": 0,
        "asset_files_failed": 0,
        "text_assets": 0,
        "json_files": 0,
        "mono_assets": 0,
        "textures": 0,
        "binary_skipped": 0,
        "errors": [],
    }

    for i, asset_file in enumerate(asset_files):
        rel = asset_file.relative_to(game_data_dir) if asset_file.is_relative_to(game_data_dir) else asset_file.name
        print(f"  [{i+1}/{len(asset_files)}] {rel} ", end="", flush=True)

        try:
            env = UnityPy.load(str(asset_file))
            obj_count = len(env.objects)
            print(f"({obj_count} objects)", end="")

            extract_text_assets(env, output_dir, stats)
            extract_monobehaviours(env, output_dir, stats)

            if extract_tex:
                extract_textures(env, output_dir, stats, tex_filter)

            stats["asset_files_scanned"] += 1
            print(f" ✓")

        except Exception as e:
            stats["asset_files_failed"] += 1
            stats["errors"].append(f"File {rel}: {e}")
            print(f" ✗ ({e})")

    return stats


def map_to_wiki_schema(output_dir: Path) -> dict:
    """Post-process: map extracted JSON files to wiki database schema."""
    text_dir = output_dir / "text"
    if not text_dir.exists():
        return {"mapped": 0}

    results = {
        "characters": [],
        "skills": [],
        "equipment": [],
        "stages": [],
        "localization": {},
        "unmapped_files": [],
        "mapped": 0,
    }

    for json_file in sorted(text_dir.glob("*.json")):
        try:
            data = json.loads(json_file.read_text("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue

        name = json_file.stem.lower()

        # Classify by filename and content
        if any(kw in name for kw in ("character", "hero", "awakener", "unit", "role")):
            results["characters"].append({"file": json_file.name, "data": data})
            results["mapped"] += 1
        elif any(kw in name for kw in ("skill", "ability", "card")):
            results["skills"].append({"file": json_file.name, "data": data})
            results["mapped"] += 1
        elif any(kw in name for kw in ("equip", "weapon", "wheel", "covenant", "relic")):
            results["equipment"].append({"file": json_file.name, "data": data})
            results["mapped"] += 1
        elif any(kw in name for kw in ("stage", "map", "dungeon", "level", "quest")):
            results["stages"].append({"file": json_file.name, "data": data})
            results["mapped"] += 1
        elif any(kw in name for kw in ("locale", "lang", "text", "string", "i18n")):
            results["localization"][json_file.name] = data
            results["mapped"] += 1
        else:
            # Try to classify by content
            if isinstance(data, list) and data and isinstance(data[0], dict):
                keys = set(data[0].keys())
                if keys & {"hp", "atk", "def", "attack", "defense", "HP", "ATK"}:
                    results["characters"].append({"file": json_file.name, "data": data})
                    results["mapped"] += 1
                    continue
                elif keys & {"cost", "effect", "skillName", "skill_name"}:
                    results["skills"].append({"file": json_file.name, "data": data})
                    results["mapped"] += 1
                    continue

            results["unmapped_files"].append({
                "file": json_file.name,
                "type": type(data).__name__,
                "size": len(data) if isinstance(data, (list, dict)) else None,
                "sample_keys": list(data[0].keys())[:10] if isinstance(data, list) and data and isinstance(data[0], dict) else
                               list(data.keys())[:10] if isinstance(data, dict) else None,
            })

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Extract game data from Morimens Unity client.",
    )
    parser.add_argument(
        "game_data_dir",
        type=Path,
        help="Path to Morimens_Data/ directory",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=None,
        help="Output directory (default: projects/wiki/output/client_extract/)",
    )
    parser.add_argument(
        "--no-textures",
        action="store_true",
        help="Skip Texture2D extraction (faster, smaller output)",
    )
    parser.add_argument(
        "--tex-filter",
        type=str,
        default="portrait,avatar,char,hero,face,bust",
        help="Comma-separated keywords to filter texture names (default: portrait-related)",
    )
    parser.add_argument(
        "--map-schema",
        action="store_true",
        help="After extraction, map JSON files to wiki database schema",
    )

    args = parser.parse_args()

    if not args.game_data_dir.is_dir():
        print(f"ERROR: Not a directory: {args.game_data_dir}", file=sys.stderr)
        sys.exit(1)

    output_dir = args.output or (PROJECT_ROOT / "output" / "client_extract")
    output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("Morimens Client Data Extractor")
    print(f"Input:     {args.game_data_dir.resolve()}")
    print(f"Output:    {output_dir.resolve()}")
    print(f"Textures:  {'filtered' if not args.no_textures else 'skip'}")
    print("=" * 60)

    stats = scan_and_extract(
        args.game_data_dir,
        output_dir,
        extract_tex=not args.no_textures,
        tex_filter=args.tex_filter if not args.no_textures else None,
    )

    # Save stats
    print(f"\n{'=' * 60}")
    print(f"Extraction complete:")
    print(f"  Asset files scanned: {stats['asset_files_scanned']}")
    print(f"  Asset files failed:  {stats['asset_files_failed']}")
    print(f"  TextAssets:          {stats['text_assets']} ({stats['json_files']} JSON)")
    print(f"  MonoBehaviours:      {stats['mono_assets']}")
    print(f"  Textures:            {stats['textures']}")
    print(f"  Binary skipped:      {stats['binary_skipped']}")
    if stats["errors"]:
        print(f"  Errors:              {len(stats['errors'])}")
        for err in stats["errors"][:10]:
            print(f"    - {err}")

    stats_file = output_dir / "extraction_stats.json"
    stats["errors"] = stats["errors"][:50]  # Truncate for JSON
    stats_file.write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(f"\n  Stats saved: {stats_file}")

    # Schema mapping
    if args.map_schema:
        print(f"\n{'=' * 60}")
        print("Mapping to wiki schema...")
        mapping = map_to_wiki_schema(output_dir)
        print(f"  Characters files: {len(mapping['characters'])}")
        print(f"  Skills files:     {len(mapping['skills'])}")
        print(f"  Equipment files:  {len(mapping['equipment'])}")
        print(f"  Stages files:     {len(mapping['stages'])}")
        print(f"  Localization:     {len(mapping['localization'])}")
        print(f"  Unmapped files:   {len(mapping['unmapped_files'])}")

        # Save mapping report
        report = {k: v for k, v in mapping.items() if k != "data"}
        # Don't include full data in report, just file names
        for category in ("characters", "skills", "equipment", "stages"):
            report[category] = [item["file"] for item in mapping[category]]

        report_file = output_dir / "schema_mapping_report.json"
        report_file.write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  Mapping report: {report_file}")

    # List extracted JSON files for quick review
    text_dir = output_dir / "text"
    if text_dir.exists():
        json_files = sorted(text_dir.glob("*.json"))
        if json_files:
            print(f"\n  JSON files extracted ({len(json_files)}):")
            for f in json_files[:30]:
                size = f.stat().st_size
                print(f"    {f.name} ({size:,} bytes)")
            if len(json_files) > 30:
                print(f"    ... and {len(json_files) - 30} more")

    print("\nDone.")


if __name__ == "__main__":
    main()
