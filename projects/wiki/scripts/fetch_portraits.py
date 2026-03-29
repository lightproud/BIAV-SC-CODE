#!/usr/bin/env python3
"""
Fetch character portrait images from wiki sources.

Downloads portraits to assets/images/portraits/ and updates characters.json
with local paths.

Sources (in priority order):
  1. Fandom MediaWiki API (forget-last-night-morimens.fandom.com)
  2. Fandom alt (morimens.fandom.com)

Usage:
  python3 fetch_portraits.py              # fetch and save
  python3 fetch_portraits.py --dry-run    # print results only

Requires: Python 3.8+ (stdlib only)
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent  # brain-in-a-vat/
CHARACTERS_JSON = SCRIPT_DIR.parent / "data" / "db" / "characters.json"
PORTRAITS_DIR = PROJECT_ROOT / "assets" / "images" / "portraits"

UA = "Mozilla/5.0 (compatible; MorimensWikiBot/1.0; +https://github.com/lightproud/brain-in-a-vat)"

# Fandom wikis to try
FANDOM_WIKIS = [
    "https://forget-last-night-morimens.fandom.com",
    "https://morimens.fandom.com",
]

# Character ID -> Fandom page title mapping
# Uses current English slug IDs from characters.json
PAGE_MAP = {
    "alva": "Alva",
    "doll": "Doll",
    "ramona-timeworn": "Ramona:_Timeworn",
    "ogier": "Ogier",
    "lotan": "Lotan",
    "ramona": "Ramona",
    "pandya": "Pandya",
    "nodera": "Nodera",
    "galen": "Galen",
    "nymphia": "Nymphia",
    "lily": "Lily",
    "danmo": "Danmo",
    "miryam": "Miryam",
    "tulu": "Tulu",
    "divine-king-tulu": "Divine_King_Tulu",
    "celeste": "Celeste",
    "goliath": "Goliath",
    "shan": "Shan",
    "aurita": "Aurita",
    "caecus": "Caecus",
    "faros": "Faros",
    "uvhash": "Uvhash",
    "rhea": "Rhea",
    "sorel": "Sorel",
    "thais": "Thais",
    "alice": "Alice",
    "faint": "Faint",
    "agrippa": "Agrippa",
    "shilo": "Shilo",
    "erica": "Erica",
    "liz": "Liz",
    "daffodil": "Daffodil",
    "winkle": "Winkle",
    "casiah": "Casiah",
    "jenkins": "Jenkins",
    "tincture": "Tincture",
    "horla": "Horla",
    "karen": "Karen",
    "hameln": "Hameln",
    "murphy": "Murphy",
    "salvador": "Salvador",
    "tawil": "Tawil",
    "wanda": "Wanda",
    "aigis": "Aigis",
    "doll-inferno": "Doll:_Inferno",
    "24": "24_(character)",
    "clementine": "Clementine",
    "corposant": "Corposant",
    "kathigu-ra": "Kathigu-Ra",
    "murphy-fauxborn": "Murphy:_Fauxborn",
    "mouchette": "Mouchette",
    "xu": "Xu",
    "castor": "Castor",
    "pollux": "Pollux",
    "helot": "Helot",
    "leigh": "Leigh",
    "doresain": "Doresain",
    "pickman": "Pickman",
    "arachne": "Arachne",
}


def api_get(url: str) -> dict:
    """Make a GET request and return JSON."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def fetch_page_images(wiki_base: str, page_title: str) -> list[str]:
    """Get all image URLs from a Fandom wiki page via MediaWiki API."""
    params = urllib.parse.urlencode({
        "action": "query",
        "titles": page_title,
        "prop": "images",
        "imlimit": "50",
        "format": "json",
    })
    url = f"{wiki_base}/api.php?{params}"
    try:
        data = api_get(url)
        pages = data.get("query", {}).get("pages", {})
        images = []
        for page in pages.values():
            for img in page.get("images", []):
                images.append(img["title"])
        return images
    except Exception as e:
        print(f"  [WARN] Failed to query {wiki_base}: {e}")
        return []


def get_image_url(wiki_base: str, file_title: str) -> str | None:
    """Get the direct URL for a File: page."""
    params = urllib.parse.urlencode({
        "action": "query",
        "titles": file_title,
        "prop": "imageinfo",
        "iiprop": "url",
        "format": "json",
    })
    url = f"{wiki_base}/api.php?{params}"
    try:
        data = api_get(url)
        pages = data.get("query", {}).get("pages", {})
        for page in pages.values():
            info = page.get("imageinfo", [{}])
            if info:
                return info[0].get("url")
    except Exception:
        pass
    return None


def find_portrait_image(images: list[str], char_name: str) -> str | None:
    """Find the most likely portrait image from a list of File: titles."""
    name_lower = char_name.lower().replace("_", " ").replace(":", "")
    candidates = []
    for img in images:
        img_lower = img.lower()
        # Skip common non-portrait images
        if any(skip in img_lower for skip in ["icon", "logo", "banner", "map", "ui_"]):
            continue
        # Prioritize images with portrait/full/splash/card in name
        if any(kw in img_lower for kw in ["portrait", "full", "splash", "card_art"]):
            candidates.insert(0, img)
        elif name_lower.split()[0] in img_lower:
            candidates.append(img)
    return candidates[0] if candidates else (images[0] if images else None)


def download_image(url: str, dest: Path) -> bool:
    """Download an image file to the destination path."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as resp:
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as f:
                f.write(resp.read())
        return True
    except Exception as e:
        print(f"  [WARN] Download failed: {e}")
        return False


def get_extension(url: str) -> str:
    """Extract file extension from URL."""
    path = urllib.parse.urlparse(url).path
    ext = os.path.splitext(path)[1].lower()
    return ext if ext in (".png", ".jpg", ".jpeg", ".webp") else ".png"


def fetch_all_portraits(dry_run: bool = False) -> dict[str, dict]:
    """Fetch portrait URLs and download images for all characters."""
    results = {}
    total = len(PAGE_MAP)

    for i, (char_id, page_title) in enumerate(PAGE_MAP.items(), 1):
        # Skip if already downloaded
        existing = list(PORTRAITS_DIR.glob(f"{char_id}.*"))
        if existing and not dry_run:
            print(f"[{i}/{total}] {char_id} -> already exists, skipping")
            results[char_id] = {
                "url": None,
                "local": f"assets/images/portraits/{existing[0].name}",
            }
            continue

        print(f"[{i}/{total}] {char_id} -> {page_title}")
        found = False

        for wiki_base in FANDOM_WIKIS:
            images = fetch_page_images(wiki_base, page_title)
            if not images:
                continue

            best = find_portrait_image(images, page_title)
            if best:
                url = get_image_url(wiki_base, best)
                if url:
                    ext = get_extension(url)
                    local_path = PORTRAITS_DIR / f"{char_id}{ext}"
                    rel_path = f"assets/images/portraits/{char_id}{ext}"

                    if dry_run:
                        results[char_id] = {"url": url, "local": rel_path}
                        print(f"  ✓ {url[:80]}...")
                    else:
                        if download_image(url, local_path):
                            results[char_id] = {"url": url, "local": rel_path}
                            print(f"  ✓ saved to {rel_path}")
                        else:
                            continue
                    found = True
                    break

        if not found:
            print(f"  ✗ No portrait found")

        time.sleep(0.5)  # Rate limiting

    return results


def main():
    dry_run = "--dry-run" in sys.argv

    PORTRAITS_DIR.mkdir(parents=True, exist_ok=True)

    print("=== Fetching character portraits ===\n")
    portraits = fetch_all_portraits(dry_run)

    print(f"\n=== Results: {len(portraits)}/{len(PAGE_MAP)} portraits found ===\n")

    if dry_run:
        for char_id, info in portraits.items():
            print(f"  {char_id}: {info['url']}")
        return

    # Update characters.json with local portrait paths
    with open(CHARACTERS_JSON) as f:
        data = json.load(f)

    updated = 0
    for char in data["characters"]:
        if char["id"] in portraits:
            char["portrait_url"] = portraits[char["id"]]["local"]
            updated += 1

    with open(CHARACTERS_JSON, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Updated {updated} portrait paths in characters.json")


if __name__ == "__main__":
    main()
