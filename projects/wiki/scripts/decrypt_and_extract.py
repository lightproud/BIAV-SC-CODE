#!/usr/bin/env python3
"""
Decrypt and extract Morimens encrypted AssetBundles.

Uses UnityPy's brute_force_key with global-metadata.dat to find the
encryption key, then extracts config data.

Usage:
    python decrypt_and_extract.py "D:\SteamLibrary\steamapps\common\Morimens"
"""

from __future__ import annotations

import gc
import json
import sys
from pathlib import Path

# Raise Windows file handle limit
if sys.platform == "win32":
    try:
        import ctypes
        ctypes.cdll.msvcrt._setmaxstdio(8192)
    except Exception:
        pass

try:
    import UnityPy
    from UnityPy.enums import ClassIDType
    from UnityPy.helpers.ArchiveStorageManager import brute_force_key
except ImportError:
    print("ERROR: UnityPy not installed. Run: pip install UnityPy")
    sys.exit(1)


def find_paths(game_root: Path) -> dict:
    """Auto-detect key paths."""
    # Find *_Data directory
    data_dir = None
    for d in game_root.iterdir():
        if d.is_dir() and d.name.endswith("_Data"):
            data_dir = d
            break
    if not data_dir:
        data_dir = game_root  # fallback

    streaming = data_dir / "StreamingAssets"
    metadata = data_dir / "il2cpp_data" / "Metadata" / "global-metadata.dat"

    return {
        "data_dir": data_dir,
        "streaming": streaming,
        "metadata": metadata,
    }


def try_brute_force(metadata_path: Path, sample_ab: Path) -> bytes | None:
    """Try to brute-force the encryption key using global-metadata.dat."""
    print(f"Loading encrypted bundle to get signatures: {sample_ab.name}")

    # Read the raw file to get key_sig and data_sig from the error
    try:
        env = UnityPy.load(str(sample_ab))
        print("  File loaded without error — may not be encrypted?")
        return b""  # Not encrypted
    except Exception as e:
        error_msg = str(e)
        if "encrypted" not in error_msg.lower():
            print(f"  Unexpected error: {e}")
            return None

    # Parse key_sig and data_sig from error message
    import ast
    import re
    key_sig_match = re.search(r"key_sig\s*=\s*(b'[^']*'|b\"[^\"]*\")", error_msg)
    data_sig_match = re.search(r"data_sig\s*=\s*(b'[^']*'|b\"[^\"]*\")", error_msg)

    if not key_sig_match or not data_sig_match:
        print(f"  Could not parse signatures from error message")
        print(f"  Error: {error_msg[:500]}")
        return None

    # Use ast.literal_eval to properly decode byte strings with \x escapes
    try:
        key_sig = ast.literal_eval(key_sig_match.group(1))
        data_sig = ast.literal_eval(data_sig_match.group(1))
    except Exception as e:
        print(f"  Failed to parse signatures: {e}")
        print(f"  key_sig raw: {key_sig_match.group(1)}")
        print(f"  data_sig raw: {data_sig_match.group(1)}")
        return None

    print(f"  key_sig = {key_sig} ({len(key_sig)} bytes)")
    print(f"  data_sig = {data_sig} ({len(data_sig)} bytes)")
    print(f"  metadata = {metadata_path}")
    print()
    print("Brute-forcing encryption key... (this may take a while)")
    print("Reading global-metadata.dat...")

    try:
        key = brute_force_key(str(metadata_path), key_sig, data_sig)
        if key:
            print(f"\n  KEY FOUND (via metadata): {key}")
            return key
        else:
            print("\n  Key not found in global-metadata.dat")
    except Exception as e:
        print(f"\n  Brute-force error (metadata): {e}")

    # Fallback: try GameAssembly.dll (IL2CPP compiled code often contains the key)
    game_assembly = metadata_path.parent.parent.parent / "GameAssembly.dll"
    if not game_assembly.exists():
        # Try parent directories
        for parent in metadata_path.parents:
            candidate = parent / "GameAssembly.dll"
            if candidate.exists():
                game_assembly = candidate
                break

    if game_assembly.exists():
        print(f"\n  Trying GameAssembly.dll ({game_assembly.stat().st_size / 1024 / 1024:.1f} MB)...")
        try:
            key = brute_force_key(str(game_assembly), key_sig, data_sig)
            if key:
                print(f"\n  KEY FOUND (via GameAssembly.dll): {key}")
                return key
            else:
                print("  Key not found in GameAssembly.dll")
        except Exception as e:
            print(f"  Brute-force error (GameAssembly): {e}")
    else:
        print(f"\n  GameAssembly.dll not found")

    # Fallback 2: try UnityPlayer.dll
    for dll_name in ["UnityPlayer.dll", "baselib.dll"]:
        dll_path = metadata_path.parent.parent.parent / dll_name
        if not dll_path.exists():
            for parent in metadata_path.parents:
                candidate = parent / dll_name
                if candidate.exists():
                    dll_path = candidate
                    break
        if dll_path.exists():
            print(f"  Trying {dll_name} ({dll_path.stat().st_size / 1024 / 1024:.1f} MB)...")
            try:
                key = brute_force_key(str(dll_path), key_sig, data_sig)
                if key:
                    print(f"\n  KEY FOUND (via {dll_name}): {key}")
                    return key
            except Exception as e:
                print(f"  Error: {e}")

    print("\n  All brute-force attempts failed.")
    return None


def extract_with_key(
    ab_file: Path,
    key: bytes,
    output_dir: Path,
) -> dict:
    """Extract a single .ab file using the decryption key."""
    stats = {"text": 0, "mono": 0, "tex": 0, "errors": []}

    try:
        env = UnityPy.load(str(ab_file))
    except Exception as e:
        stats["errors"].append(str(e))
        return stats

    for obj in env.objects:
        try:
            if obj.type == ClassIDType.TextAsset:
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
                            continue
                else:
                    text = script

                if not text or len(text.strip()) < 2:
                    continue

                stripped = text.strip()
                if stripped.startswith(("{", "[")):
                    ext = ".json"
                elif stripped.startswith("--") or "function " in stripped[:200] or "local " in stripped[:200]:
                    ext = ".lua"
                elif "\t" in stripped.split("\n")[0]:
                    ext = ".tsv"
                elif "," in stripped.split("\n")[0] and stripped.count("\n") > 1:
                    ext = ".csv"
                else:
                    ext = ".txt"

                out = output_dir / "text" / f"{name}{ext}"
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(text, encoding="utf-8")
                stats["text"] += 1

            elif obj.type == ClassIDType.MonoBehaviour:
                data = obj.read()
                name = getattr(data, "m_Name", None)
                if not name:
                    continue
                try:
                    tree = obj.read_typetree()
                    if tree and isinstance(tree, dict) and len(tree) > 2:
                        out = output_dir / "mono" / f"{name}.json"
                        out.parent.mkdir(parents=True, exist_ok=True)
                        out.write_text(
                            json.dumps(tree, ensure_ascii=False, indent=2, default=str),
                            encoding="utf-8",
                        )
                        stats["mono"] += 1
                except Exception:
                    pass

            elif obj.type == ClassIDType.Texture2D:
                data = obj.read()
                name = data.m_Name
                try:
                    img = data.image
                    if img.width >= 64 and img.height >= 64:
                        out = output_dir / "textures" / f"{name}.png"
                        out.parent.mkdir(parents=True, exist_ok=True)
                        img.save(str(out))
                        stats["tex"] += 1
                except Exception:
                    pass

        except Exception as e:
            stats["errors"].append(f"{obj.type}: {e}")

    # Cleanup
    try:
        for f in getattr(env, "_files", {}).values():
            if hasattr(f, "close"):
                f.close()
    except Exception:
        pass
    del env
    gc.collect()

    return stats


def main():
    if len(sys.argv) < 2:
        print("Usage: python decrypt_and_extract.py <game_root_dir>")
        print("  e.g.: python decrypt_and_extract.py D:\\SteamLibrary\\steamapps\\common\\Morimens")
        sys.exit(1)

    game_root = Path(sys.argv[1])
    if not game_root.is_dir():
        print(f"ERROR: Not a directory: {game_root}")
        sys.exit(1)

    paths = find_paths(game_root)
    print("=" * 60)
    print("Morimens AssetBundle Decryptor")
    print(f"  Game data:  {paths['data_dir']}")
    print(f"  Streaming:  {paths['streaming']}")
    print(f"  Metadata:   {paths['metadata']}")
    print("=" * 60)

    if not paths["metadata"].exists():
        print(f"\nERROR: global-metadata.dat not found at {paths['metadata']}")
        print("Please check if this path exists:")
        print(f"  {paths['data_dir'] / 'il2cpp_data' / 'Metadata'}")
        sys.exit(1)

    if not paths["streaming"].exists():
        print(f"\nERROR: StreamingAssets not found at {paths['streaming']}")
        sys.exit(1)

    # Priority targets: config and script bundles
    priority_files = [
        "config.ab",
        "gamescript.ab",
        "config_debug.ab",
        "ejoysdk_lua.ab",
        "foundation.ab",
        "share.ab",
        "vue.ab",
        "gamelauncher.ab",
        "sproto.ab",
    ]

    # Find the first encrypted .ab to use for key brute-force
    sample_ab = None
    for name in priority_files:
        candidate = paths["streaming"] / name
        if candidate.exists():
            sample_ab = candidate
            break

    if not sample_ab:
        # Fallback: find any .ab file
        for f in paths["streaming"].rglob("*.ab"):
            sample_ab = f
            break

    if not sample_ab:
        print("\nERROR: No .ab files found")
        sys.exit(1)

    print(f"\nStep 1: Brute-force decryption key using {sample_ab.name}")
    print("-" * 60)

    key = try_brute_force(paths["metadata"], sample_ab)
    if key is None:
        print("\nFailed to find decryption key.")
        print("The encryption may use a method that brute-force cannot crack.")
        sys.exit(1)

    if key:
        print(f"\nSetting decryption key...")
        UnityPy.set_assetbundle_decrypt_key(key)

    # Step 2: Extract priority bundles
    output_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else game_root / "decrypted_extract"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nStep 2: Extracting priority bundles to {output_dir}")
    print("-" * 60)

    total = {"text": 0, "mono": 0, "tex": 0, "errors": []}

    for name in priority_files:
        ab_path = paths["streaming"] / name
        if not ab_path.exists():
            print(f"  {name} — not found, skipping")
            continue

        print(f"  Extracting {name} ({ab_path.stat().st_size / 1024 / 1024:.1f} MB)...")
        stats = extract_with_key(ab_path, key, output_dir)
        print(f"    text={stats['text']} mono={stats['mono']} tex={stats['tex']}")
        if stats["errors"]:
            print(f"    errors: {len(stats['errors'])}")
            for err in stats["errors"][:3]:
                print(f"      {err[:100]}")

        total["text"] += stats["text"]
        total["mono"] += stats["mono"]
        total["tex"] += stats["tex"]
        total["errors"].extend(stats["errors"])

    # Step 3: If successful, also extract art bundles with character data
    if total["text"] > 0 or total["mono"] > 0:
        print(f"\nStep 3: Scanning character-related art bundles...")
        print("-" * 60)
        char_keywords = ["char", "hero", "portrait", "avatar", "bust", "face", "npc"]
        count = 0
        for ab in sorted(paths["streaming"].rglob("*.ab")):
            name_lower = ab.name.lower()
            if any(kw in name_lower for kw in char_keywords):
                print(f"  {ab.relative_to(paths['streaming'])}...")
                stats = extract_with_key(ab, key, output_dir)
                if stats["text"] or stats["mono"] or stats["tex"]:
                    print(f"    text={stats['text']} mono={stats['mono']} tex={stats['tex']}")
                total["text"] += stats["text"]
                total["mono"] += stats["mono"]
                total["tex"] += stats["tex"]
                count += 1
                if count >= 100:
                    break

    print(f"\n{'=' * 60}")
    print(f"TOTAL EXTRACTED:")
    print(f"  TextAssets:      {total['text']}")
    print(f"  MonoBehaviours:  {total['mono']}")
    print(f"  Textures:        {total['tex']}")
    print(f"  Errors:          {len(total['errors'])}")
    print(f"  Output:          {output_dir}")

    # List extracted files
    text_dir = output_dir / "text"
    if text_dir.exists():
        files = sorted(text_dir.iterdir())
        if files:
            print(f"\nExtracted text files ({len(files)}):")
            for f in files[:50]:
                print(f"  {f.name} ({f.stat().st_size:,} bytes)")
            if len(files) > 50:
                print(f"  ... and {len(files) - 50} more")

    print("\nDone.")


if __name__ == "__main__":
    main()
