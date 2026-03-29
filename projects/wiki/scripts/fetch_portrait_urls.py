#!/usr/bin/env python3
"""
Fetch character portrait image URLs from morimens.fandom.com and update characters.json.

Usage:
  python3 fetch_portrait_urls.py              # fetch and update characters.json
  python3 fetch_portrait_urls.py --dry-run    # print found URLs without writing

Requirements: Python 3.8+ (stdlib only, no external deps)

Strategy:
  1. Query the Fandom MediaWiki API for all images (allimages endpoint, no anti-bot block)
  2. Match images to characters by name similarity
  3. For unmatched characters, fetch character page and extract infobox portrait
  4. Write portrait_url fields back to characters.json
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent.parent
CHARACTERS_JSON = REPO_ROOT / "projects" / "wiki" / "data" / "db" / "characters.json"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; MorimensBot/1.0; research)"}

FANDOM_BASE = "https://morimens.fandom.com"
FANDOM_API = f"{FANDOM_BASE}/api.php"

# Map characters.json id → Fandom wiki page slug (best-guess, update if wrong)
CHARACTER_PAGES = {
    "aierwa":            "Elva",
    "duoer":             "Doll_(character)",
    "huanxing_lamengna": "Cyclical_Ramona",
    "aojier":            "Augier",
    "luotan":            "Rotan",
    "lamengna":          "Ramona",
    "pandiya":           "Pandya",
    "nuodila":           "Nodera",
    "jialun":            "Galen",
    "ningfeiya":         "Nymphia",
    "lili":              "Lily",
    "danmo":             "Danmo",
    "miliyamu":          "Miryam",
    "tulu":              "Tulu",
    "shenwang_tulu":     "Divine_King_Tulu",
    "xilaisite":         "Celeste",
    "geliya":            "Goliath",
    "shan":              "Shan",
    "aoruita":           "Aurita",
    "kaikesi":           "Ceyx",
    "faluosi":           "Pharos",
    "youwuhaxi":         "Yuhashi",
    "leiya":             "Rhea",
    "suoleier":          "Soleil",
    "taiyisi":           "Thysia",
    "ailisi":            "Alice",
    "feiyinte":          "Feint",
    "agelipa":           "Agrippa",
    "xiluo":             "Shilo",
    "airuika":           "Erica",
    "lizi":              "Liz",
    "dafudaier":         "Daphne",
    "wenkoer":           "Winkel",
    "kaxiya":            "Cassia",
    "zhankin":           "Jenkins",
    "tingkete":          "Tincture",
    "aoerla":            "Aurla",
    "laike":             "Lake",
    "hamulin":           "Hameln",
    "mofei":             "Murphy",
    "saerwaduo":         "Salvador",
    "tawei":             "Tawil",
    "wangda":            "Wanda",
    "aijisi":            "Aegis",
    "ronghuei_duoer":    "Doll_Inferno",
    "24":                "24",
    "kelaimengting":     "Clementine",
    "keposante":         "Corposant",
    "kaidigula":         "Kathigu-Ra",
    "danwang_mofei":     "Murphy_Fauxborn",
    "moxia":             "Mouchette",
    "xu":                "Xu",
    "kasitoer":          "Castor",
    "bolukesi":          "Pollux",
    "xuelian_xiluo":     "Helot_Catena",
    "lei":               "Leigh",
    "dulesaiyin":        "Doresain",
    "pikeman":           "Pickman",
    "alakeinie":         "Arachne",
}


def fetch(url: str, as_json: bool = False):
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if as_json else raw
    except Exception as e:
        print(f"  [WARN] fetch failed for {url}: {e}", file=sys.stderr)
        return None


def fetch_all_api_images() -> list[dict]:
    """Retrieve every image from the wiki via allimages API (auto-paginates)."""
    results = []
    params = {
        "action": "query", "list": "allimages",
        "ailimit": "500", "format": "json",
        "aiprop": "url|title", "aisort": "name",
    }
    while True:
        url = FANDOM_API + "?" + urllib.parse.urlencode(params)
        print(f"  API call: {url}", file=sys.stderr)
        data = fetch(url, as_json=True)
        if not data:
            break
        batch = data.get("query", {}).get("allimages", [])
        results.extend(batch)
        print(f"  → got {len(batch)} images (total {len(results)})", file=sys.stderr)
        if "continue" not in data:
            break
        params.update(data["continue"])
        time.sleep(0.5)
    return results


def extract_infobox_image(html: str) -> str | None:
    """Extract the first infobox/portrait image from a Fandom character page."""
    patterns = [
        r'class="[^"]*pi-image[^"]*"[^>]*>.*?<img[^>]+src="(https://static\.wikia\.nocookie\.net[^"]+)"',
        r'<img[^>]+src="(https://static\.wikia\.nocookie\.net/morimens/[^"]+\.(png|jpg|webp))"',
        r'"url":"(https://static\.wikia\.nocookie\.net/morimens/[^"]+\.(png|jpg|webp))"',
        r'<meta property="og:image" content="(https://[^"]+)"',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.DOTALL | re.IGNORECASE)
        if m:
            url = m.group(1)
            # Trim scaling params, keep base revision URL
            url = re.sub(r"/revision/latest/.*", "/revision/latest", url)
            return url
    return None


def score_image(title: str, char_names: list[str]) -> int:
    """Return match score for an image title against character names."""
    t = title.lower().replace("file:", "").replace("_", " ").replace("-", " ")
    score = 0
    for name in char_names:
        n = name.lower().replace("_", " ").replace("-", " ")
        if n in t:
            score += len(n)
        # Substring match on short names (≥4 chars)
        if len(n) >= 4 and n[:4] in t:
            score += 2
    # Prefer portrait/artwork over icon/thumb
    if any(kw in t for kw in ("portrait", "artwork", "splash", "full", "illust", "card")):
        score += 5
    if any(kw in t for kw in ("icon", "thumb", "small", "avatar", "logo")):
        score -= 3
    return score


def find_best_image(char_id: str, char: dict, all_images: list[dict]) -> str | None:
    """Try to find the best matching image for a character from all wiki images."""
    names = [
        char.get("name_en", ""),
        char.get("name", ""),
        char_id,
    ] + char.get("aliases", [])

    best_url = None
    best_score = 0

    for img in all_images:
        title = img.get("title", "")
        score = score_image(title, names)
        if score > best_score:
            best_score = score
            best_url = img.get("url")

    return best_url if best_score >= 4 else None


def fetch_from_character_page(char_id: str) -> str | None:
    """Scrape the character's Fandom wiki page for infobox portrait."""
    slug = CHARACTER_PAGES.get(char_id)
    if not slug:
        return None
    url = f"{FANDOM_BASE}/wiki/{slug}"
    print(f"  Fetching page: {url}", file=sys.stderr)
    html = fetch(url)
    if html:
        return extract_infobox_image(html)
    return None


def main():
    dry_run = "--dry-run" in sys.argv

    print("=== Step 1: Fetch all wiki images via API ===", file=sys.stderr)
    all_images = fetch_all_api_images()
    print(f"Total images from API: {len(all_images)}", file=sys.stderr)

    print("\n=== Step 2: Load characters.json ===", file=sys.stderr)
    data = json.loads(CHARACTERS_JSON.read_text(encoding="utf-8"))
    characters = data["characters"]

    print("\n=== Step 3: Match/fetch portrait URLs ===", file=sys.stderr)
    found = 0
    for char in characters:
        if char.get("portrait_url"):
            continue  # already filled

        char_id = char["id"]
        url = find_best_image(char_id, char, all_images)

        if not url:
            # Fallback: fetch character page
            time.sleep(0.3)
            url = fetch_from_character_page(char_id)

        if url:
            print(f"  ✓ {char['name']} ({char_id}): {url}", file=sys.stderr)
            char["portrait_url"] = url
            found += 1
        else:
            print(f"  ✗ {char['name']} ({char_id}): not found", file=sys.stderr)

    print(f"\n=== Done: {found}/{len(characters)} portrait URLs found ===", file=sys.stderr)

    if not dry_run:
        output = json.dumps(data, ensure_ascii=False, indent=2)
        CHARACTERS_JSON.write_text(output, encoding="utf-8")
        print(f"Updated: {CHARACTERS_JSON}", file=sys.stderr)
    else:
        print("[dry-run] No file written.", file=sys.stderr)


if __name__ == "__main__":
    main()
