#!/usr/bin/env python3
"""
Batch extract art assets from Morimens encrypted AssetBundles.
Reads AB files from input directory, decrypts with UnityCN key,
and exports Texture2D/Sprite as PNG.
"""

import sys
from pathlib import Path

import UnityPy
from UnityPy.enums import ClassIDType

KEY = b"d111859c344a467e"
UnityPy.set_assetbundle_decrypt_key(KEY)


def extract_ab(ab_path: Path, output_dir: Path, category: str) -> list:
    """Extract images from a single AB file. Returns list of (name, w, h)."""
    results = []
    try:
        env = UnityPy.load(str(ab_path))
    except Exception as e:
        print(f"  SKIP {ab_path.name}: {e}")
        return results

    for obj in env.objects:
        if obj.type == ClassIDType.Texture2D:
            try:
                data = obj.read()
                name = data.m_Name
                if not name or data.m_Width == 0 or data.m_Height == 0:
                    continue
                img = data.image
                cat_dir = output_dir / category
                cat_dir.mkdir(parents=True, exist_ok=True)
                out_path = cat_dir / f"{name}.png"
                # Handle duplicate names
                if out_path.exists():
                    i = 2
                    while out_path.exists():
                        out_path = cat_dir / f"{name}_{i}.png"
                        i += 1
                img.save(str(out_path))
                results.append((name, data.m_Width, data.m_Height))
            except Exception as e:
                print(f"  ERR Texture2D in {ab_path.name}: {e}")
    return results


def batch_extract(input_dir: Path, output_dir: Path):
    """Walk input_dir for .ab files and extract all images."""
    output_dir.mkdir(parents=True, exist_ok=True)

    ab_files = sorted(input_dir.rglob("*.ab"))
    print(f"Found {len(ab_files)} AB files in {input_dir}")

    total_images = 0
    errors = 0

    for i, ab_path in enumerate(ab_files):
        # Determine category from path relative to input_dir
        rel = ab_path.relative_to(input_dir)
        parts = rel.parts
        if len(parts) >= 2:
            category = parts[0]  # e.g., cg, portrait, portraits, icon
            if len(parts) >= 3:
                category = f"{parts[0]}/{parts[1]}"  # e.g., cg/c203/static
        else:
            category = "other"

        results = extract_ab(ab_path, output_dir, category)
        total_images += len(results)

        if results:
            for name, w, h in results:
                pass  # quiet
            if (i + 1) % 50 == 0 or i == 0:
                print(f"  [{i+1}/{len(ab_files)}] {total_images} images extracted...")

        if not results and len(list(UnityPy.load(str(ab_path)).objects if False else [])) == 0:
            pass  # Skip logging for non-image bundles

    print(f"\nDone! Extracted {total_images} images from {len(ab_files)} AB files.")
    return total_images


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <input_dir> <output_dir>")
        sys.exit(1)

    input_dir = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    batch_extract(input_dir, output_dir)
