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
import gc
import json
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from multiprocessing import cpu_count
from pathlib import Path
from typing import Any

# Raise Windows file handle limit (default 512 is too low for large games)
if sys.platform == "win32":
    try:
        import ctypes
        ctypes.cdll.msvcrt._setmaxstdio(8192)
    except Exception:
        pass

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

# File extensions that UnityPy can load (Unity asset formats)
UNITY_EXTENSIONS = {
    ".unity3d", ".assets", ".bundle", ".ab", ".asset", ".sharedassetsb",
    "",  # extensionless files (some Unity bundles have no extension)
}

# File extensions to skip entirely (not Unity formats)
SKIP_EXTENSIONS = {
    ".wem", ".bnk", ".mp4", ".mp3", ".ogg", ".wav", ".webm",
    ".meta", ".manifest", ".dll", ".pdb", ".xml", ".resS", ".resource",
    ".css", ".html", ".js",
}

# Plain text/data extensions to copy directly (no UnityPy needed)
DIRECT_COPY_EXTENSIONS = {
    ".json", ".txt", ".csv", ".tsv", ".lua", ".cfg", ".ini", ".yaml", ".yml",
    ".bytes",
}

# File patterns to scan inside Morimens_Data/ (top-level Unity files)
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


def find_asset_files(game_data_dir: Path) -> tuple[list[Path], list[Path]]:
    """Find all files to process.

    Returns:
        (unity_files, direct_copy_files) — Unity bundles for UnityPy, and
        plain text/config files to copy directly.
    """
    unity_files = []
    direct_files = []

    # Direct files in Morimens_Data/ (top-level .assets, etc.)
    for pattern in ASSET_PATTERNS:
        for f in game_data_dir.glob(pattern):
            if f.is_file():
                unity_files.append(f)

    # StreamingAssets + Persistent data
    scan_dirs = []
    streaming = game_data_dir / "StreamingAssets"
    if streaming.exists():
        scan_dirs.append(streaming)
    persistent = game_data_dir / "PersistentData"
    if persistent.exists():
        scan_dirs.append(persistent)

    for scan_dir in scan_dirs:
        for f in scan_dir.rglob("*"):
            if not f.is_file():
                continue
            ext = f.suffix.lower()
            if ext in SKIP_EXTENSIONS:
                continue
            if ext in DIRECT_COPY_EXTENSIONS:
                direct_files.append(f)
            elif ext in UNITY_EXTENSIONS or ext == "":
                unity_files.append(f)
            else:
                # Unknown extension — try as Unity file if small enough
                # (large unknowns are likely binary data)
                try:
                    if f.stat().st_size < 100 * 1024 * 1024:  # < 100MB
                        unity_files.append(f)
                except OSError:
                    pass

    # Deduplicate
    def dedup(files):
        seen = set()
        unique = []
        for f in files:
            fp = f.resolve()
            if fp not in seen:
                seen.add(fp)
                unique.append(f)
        return sorted(unique)

    return dedup(unity_files), dedup(direct_files)


def copy_direct_files(
    direct_files: list[Path],
    game_data_dir: Path,
    output_dir: Path,
) -> dict:
    """Copy non-Unity config/text files directly to output."""
    stats = {"direct_copied": 0, "direct_errors": []}
    for f in direct_files:
        try:
            rel = f.relative_to(game_data_dir) if f.is_relative_to(game_data_dir) else Path(f.name)
            dest = output_dir / "text" / "raw" / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            import shutil
            shutil.copy2(f, dest)
            stats["direct_copied"] += 1
        except Exception as e:
            stats["direct_errors"].append(f"{f.name}: {e}")
    return stats


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
                elif stripped.startswith("--") or "function " in stripped[:200] or "local " in stripped[:200]:
                    ext = ".lua"
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
                elif ext == ".lua":
                    stats["lua_files"] = stats.get("lua_files", 0) + 1

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
                if name_filter and name_filter.strip():
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


def _extract_single_file(
    asset_file: Path,
    game_data_dir: Path,
    output_dir: Path,
    extract_tex: bool,
    tex_filter: str | None,
    verbose: bool = False,
) -> dict:
    """Extract a single asset file. Designed to run in a subprocess."""
    stats = {
        "asset_files_scanned": 0,
        "asset_files_failed": 0,
        "text_assets": 0,
        "json_files": 0,
        "mono_assets": 0,
        "textures": 0,
        "binary_skipped": 0,
        "errors": [],
        "object_types": {},  # Diagnostic: ClassIDType -> count
    }
    rel = asset_file.relative_to(game_data_dir) if asset_file.is_relative_to(game_data_dir) else asset_file.name
    env = None
    try:
        env = UnityPy.load(str(asset_file))

        # Diagnostic: count object types in this bundle
        for obj in env.objects:
            type_name = obj.type.name if hasattr(obj.type, "name") else str(obj.type)
            stats["object_types"][type_name] = stats["object_types"].get(type_name, 0) + 1

        extract_text_assets(env, output_dir, stats)
        extract_monobehaviours(env, output_dir, stats)
        if extract_tex:
            extract_textures(env, output_dir, stats, tex_filter)
        stats["asset_files_scanned"] = 1
    except Exception as e:
        stats["asset_files_failed"] = 1
        stats["errors"].append(f"File {rel}: {e}")
    finally:
        # Close file handles to avoid "Too many open files"
        if env is not None:
            try:
                for f in getattr(env, "_files", {}).values():
                    if hasattr(f, "close"):
                        f.close()
            except Exception:
                pass
            del env
    stats["_rel"] = str(rel)
    return stats


def scan_and_extract(
    game_data_dir: Path,
    output_dir: Path,
    extract_tex: bool = False,
    tex_filter: str = None,
    workers: int = 0,
    verbose: bool = False,
) -> dict:
    """Main extraction: scan all asset files and extract data.

    Args:
        workers: number of parallel workers. 0 = auto (cpu_count), 1 = sequential.
        verbose: print per-file object type diagnostics.
    """
    unity_files, direct_files = find_asset_files(game_data_dir)
    print(f"Found {len(unity_files)} Unity asset files to scan")
    print(f"Found {len(direct_files)} direct config/text files to copy")

    # Step 1: Copy direct files (non-Unity text/config)
    if direct_files:
        print(f"\nCopying {len(direct_files)} direct files...")
        direct_stats = copy_direct_files(direct_files, game_data_dir, output_dir)
        print(f"  Copied: {direct_stats['direct_copied']}")
        if direct_stats["direct_errors"]:
            print(f"  Errors: {len(direct_stats['direct_errors'])}")

    # Step 2: Extract Unity asset files
    total_stats = {
        "asset_files_scanned": 0,
        "asset_files_failed": 0,
        "text_assets": 0,
        "json_files": 0,
        "mono_assets": 0,
        "textures": 0,
        "binary_skipped": 0,
        "direct_copied": direct_stats["direct_copied"] if direct_files else 0,
        "errors": [],
        "all_object_types": {},  # Aggregate type counts across all files
    }

    if not unity_files:
        print("No Unity asset files found.")
        return total_stats

    if workers == 0:
        workers = min(cpu_count() or 4, 8, len(unity_files) or 1)

    print(f"\nScanning {len(unity_files)} Unity files...")
    if workers > 1 and len(unity_files) > 1:
        print(f"Using {workers} parallel workers")
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(
                    _extract_single_file,
                    af, game_data_dir, output_dir, extract_tex, tex_filter, verbose,
                ): af
                for af in unity_files
            }
            done_count = 0
            for future in as_completed(futures):
                done_count += 1
                result = future.result()
                rel = result.pop("_rel", "?")
                obj_types = result.pop("object_types", {})
                extracted = result["text_assets"] + result["mono_assets"] + result["textures"]
                status = "✓" if result["asset_files_scanned"] else "✗"
                suffix = f" ({extracted} extracted)" if extracted else ""
                if verbose and obj_types:
                    suffix += f" types={obj_types}"
                print(f"  [{done_count}/{len(unity_files)}] {rel} {status}{suffix}")
                # Merge stats
                for key in total_stats:
                    if key == "errors":
                        total_stats["errors"].extend(result["errors"])
                    elif key == "all_object_types":
                        for t, c in obj_types.items():
                            total_stats["all_object_types"][t] = total_stats["all_object_types"].get(t, 0) + c
                    else:
                        total_stats[key] += result.get(key, 0)
    else:
        # Sequential fallback
        for i, asset_file in enumerate(unity_files):
            result = _extract_single_file(
                asset_file, game_data_dir, output_dir, extract_tex, tex_filter, verbose,
            )
            # Force GC after every file to release file handles (Windows has low limit)
            gc.collect()
            rel = result.pop("_rel", "?")
            obj_types = result.pop("object_types", {})
            extracted = result["text_assets"] + result["mono_assets"] + result["textures"]
            status = "✓" if result["asset_files_scanned"] else "✗"
            suffix = f" ({extracted} extracted)" if extracted else ""
            if verbose and obj_types:
                suffix += f" types={obj_types}"
            print(f"  [{i+1}/{len(unity_files)}] {rel} {status}{suffix}")
            for key in total_stats:
                if key == "errors":
                    total_stats["errors"].extend(result["errors"])
                elif key == "all_object_types":
                    for t, c in obj_types.items():
                        total_stats["all_object_types"][t] = total_stats["all_object_types"].get(t, 0) + c
                else:
                    total_stats[key] += result.get(key, 0)

    return total_stats


def map_to_wiki_schema(output_dir: Path) -> dict:
    """Post-process: map extracted JSON files to wiki database schema."""
    results = {
        "characters": [],
        "skills": [],
        "equipment": [],
        "stages": [],
        "localization": {},
        "unmapped_files": [],
        "mapped": 0,
    }

    text_dir = output_dir / "text"
    if not text_dir.exists():
        return results

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
    parser.add_argument(
        "--workers", "-j",
        type=int,
        default=0,
        help="Parallel workers (0=auto, 1=sequential)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show per-file object type diagnostics",
    )

    args = parser.parse_args()

    if not args.game_data_dir.is_dir():
        print(f"ERROR: Not a directory: {args.game_data_dir}", file=sys.stderr)
        sys.exit(1)

    # Auto-detect: if user passed game root (e.g. .../Morimens/), find *_Data inside
    game_data_dir = args.game_data_dir
    if not list(game_data_dir.glob("*.assets")) and not (game_data_dir / "StreamingAssets").exists():
        for d in game_data_dir.iterdir():
            if d.is_dir() and d.name.endswith("_Data"):
                print(f"Auto-detected game data directory: {d.name}/")
                game_data_dir = d
                break
    args.game_data_dir = game_data_dir

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
        workers=args.workers,
        verbose=args.verbose,
    )

    # Save stats
    print(f"\n{'=' * 60}")
    print(f"Extraction complete:")
    print(f"  Asset files scanned: {stats['asset_files_scanned']}")
    print(f"  Asset files failed:  {stats['asset_files_failed']}")
    print(f"  Direct files copied: {stats.get('direct_copied', 0)}")
    print(f"  TextAssets:          {stats['text_assets']} ({stats['json_files']} JSON)")
    print(f"  MonoBehaviours:      {stats['mono_assets']}")
    print(f"  Textures:            {stats['textures']}")
    print(f"  Binary skipped:      {stats['binary_skipped']}")

    # Show object type summary (diagnostic)
    obj_types = stats.get("all_object_types", {})
    if obj_types:
        print(f"\n  Unity object types found across all files:")
        for t, c in sorted(obj_types.items(), key=lambda x: -x[1]):
            print(f"    {t}: {c}")

    if stats["errors"]:
        print(f"\n  Errors:              {len(stats['errors'])}")
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
