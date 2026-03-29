#!/usr/bin/env python3
"""
Fetch character base stats (HP/ATK/DEF) from Fandom wiki sources.

Parses wikitext infoboxes to extract numerical stats and adds them to
characters.json under a "stats" field.

Sources:
  1. Fandom MediaWiki API (forget-last-night-morimens.fandom.com)
  2. Fandom alt (morimens.fandom.com)

Usage:
  python3 fetch_stats.py              # fetch and save
  python3 fetch_stats.py --dry-run    # print results only

Requires: Python 3.8+ (stdlib only)
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
CHARACTERS_JSON = SCRIPT_DIR.parent / "data" / "db" / "characters.json"

UA = "Mozilla/5.0 (compatible; MorimensWikiBot/1.0; +https://github.com/lightproud/brain-in-a-vat)"

FANDOM_WIKIS = [
    "https://forget-last-night-morimens.fandom.com",
    "https://morimens.fandom.com",
]

# Character ID -> Fandom page title mapping
# Copied from fetch_portraits.py
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

# Stat field patterns to look for in wikitext infoboxes.
# Maps normalized stat key -> list of possible wikitext field names (case-insensitive).
STAT_ALIASES = {
    "hp": ["hp", "health", "生命", "生命值", "base_hp", "basehp", "max_hp", "maxhp",
            "体质", "constitution"],
    "atk": ["atk", "attack", "攻击", "攻击力", "base_atk", "baseatk", "力量", "power",
            "strength"],
    "def": ["def", "defense", "defence", "防御", "防御力", "base_def", "basedef",
            "耐力", "endurance"],
}


def api_get(url: str) -> dict:
    """Make a GET request and return JSON."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def fetch_wikitext(wiki_base: str, page_title: str) -> str | None:
    """Fetch raw wikitext for a page via MediaWiki API."""
    params = urllib.parse.urlencode({
        "action": "parse",
        "page": page_title,
        "prop": "wikitext",
        "format": "json",
    })
    url = f"{wiki_base}/api.php?{params}"
    try:
        data = api_get(url)
        return data.get("parse", {}).get("wikitext", {}).get("*")
    except Exception as e:
        print(f"  [WARN] Failed to fetch wikitext from {wiki_base}: {e}")
        return None


def parse_number(s: str) -> int | None:
    """Extract the first integer from a string, stripping commas and whitespace."""
    s = s.replace(",", "").replace(" ", "").strip()
    m = re.search(r"(\d+)", s)
    return int(m.group(1)) if m else None


def extract_stats_from_wikitext(wikitext: str) -> dict | None:
    """
    Parse wikitext to extract base stats (hp, atk, def).

    Looks for infobox template parameters like:
      |hp = 1000
      |hp_max = 5000
      |atk = 200
      |生命值 = 1000
    Also handles tabular stat blocks and various formatting.

    Returns dict like:
      {"hp": {"base": X, "max": Y}, "atk": {...}, "def": {...}}
    or None if no stats found.
    """
    stats = {}

    # Strategy 1: Look for infobox-style |key = value pairs
    # Match both |key=value and |key = value patterns
    infobox_pairs = re.findall(
        r"\|\s*([A-Za-z0-9_\u4e00-\u9fff]+)\s*=\s*([^\n|}{]+)",
        wikitext,
    )

    for key, value in infobox_pairs:
        key_lower = key.lower().strip()
        for stat_name, aliases in STAT_ALIASES.items():
            # Check for base/min stat
            if key_lower in aliases:
                num = parse_number(value)
                if num is not None and num > 0:
                    stats.setdefault(stat_name, {})
                    stats[stat_name]["base"] = num

            # Check for max stat variants
            max_suffixes = ["_max", "max", "_lv60", "_60", "_lvmax"]
            for suffix in max_suffixes:
                if key_lower in [a + suffix for a in aliases]:
                    num = parse_number(value)
                    if num is not None and num > 0:
                        stats.setdefault(stat_name, {})
                        stats[stat_name]["max"] = num

            # Check for base stat with explicit "base" prefix/suffix
            base_variants = ["base_" + a for a in aliases] + [a + "_base" for a in aliases]
            base_variants += [a + "_lv1" for a in aliases] + [a + "_1" for a in aliases]
            if key_lower in base_variants:
                num = parse_number(value)
                if num is not None and num > 0:
                    stats.setdefault(stat_name, {})
                    stats[stat_name]["base"] = num

    # Strategy 2: Look for stat tables like:
    #   {| class="wikitable"
    #   |-
    #   ! Stat !! Base !! Max
    #   |-
    #   | HP || 1000 || 5000
    if not stats:
        # Look for rows with stat labels followed by numbers
        table_patterns = [
            # "HP: 1000 / 5000" or "HP: 1000 → 5000"
            r"(?:HP|生命值?|体质)\s*[:：]\s*(\d[\d,]*)\s*[/→~\-]\s*(\d[\d,]*)",
            r"(?:ATK|攻击力?|力量)\s*[:：]\s*(\d[\d,]*)\s*[/→~\-]\s*(\d[\d,]*)",
            r"(?:DEF|防御力?|耐力)\s*[:：]\s*(\d[\d,]*)\s*[/→~\-]\s*(\d[\d,]*)",
        ]
        stat_keys = ["hp", "atk", "def"]
        for pattern, stat_key in zip(table_patterns, stat_keys):
            m = re.search(pattern, wikitext, re.IGNORECASE)
            if m:
                base = parse_number(m.group(1))
                mx = parse_number(m.group(2))
                if base is not None:
                    stats.setdefault(stat_key, {})
                    stats[stat_key]["base"] = base
                    if mx is not None:
                        stats[stat_key]["max"] = mx

    # Strategy 3: Look for single stat values (no base/max distinction)
    if not stats:
        single_patterns = [
            (r"(?:HP|生命值?|体质)\s*[:：=]\s*(\d[\d,]*)", "hp"),
            (r"(?:ATK|攻击力?|力量)\s*[:：=]\s*(\d[\d,]*)", "atk"),
            (r"(?:DEF|防御力?|耐力)\s*[:：=]\s*(\d[\d,]*)", "def"),
        ]
        for pattern, stat_key in single_patterns:
            m = re.search(pattern, wikitext, re.IGNORECASE)
            if m:
                num = parse_number(m.group(1))
                if num is not None and num > 0:
                    stats.setdefault(stat_key, {})
                    stats[stat_key]["base"] = num

    if not stats:
        return None

    # Ensure consistent structure: every stat has at least "base"
    for key in stats:
        if "max" not in stats[key]:
            stats[key]["max"] = None
        if "base" not in stats[key]:
            stats[key]["base"] = None

    return stats


def fetch_character_stats(char_id: str, page_title: str) -> dict | None:
    """Fetch and parse stats for a single character from Fandom wikis."""
    for wiki_base in FANDOM_WIKIS:
        wikitext = fetch_wikitext(wiki_base, page_title)
        if wikitext is None:
            continue

        stats = extract_stats_from_wikitext(wikitext)
        if stats:
            return stats

    return None


def main():
    dry_run = "--dry-run" in sys.argv

    # Load characters.json
    with open(CHARACTERS_JSON) as f:
        data = json.load(f)

    characters = data["characters"]
    total = len(PAGE_MAP)
    fetched = 0
    skipped_existing = 0
    skipped_no_page = 0
    failed = 0

    print(f"=== Fetching character stats ({'DRY RUN' if dry_run else 'LIVE'}) ===\n")

    # Build a lookup by character ID for fast access
    char_by_id = {c["id"]: c for c in characters}

    for i, (char_id, page_title) in enumerate(PAGE_MAP.items(), 1):
        char = char_by_id.get(char_id)
        if char is None:
            print(f"[{i}/{total}] {char_id} -> not found in characters.json, skipping")
            skipped_no_page += 1
            continue

        # Skip characters that already have stats
        if char.get("stats"):
            print(f"[{i}/{total}] {char_id} -> already has stats, skipping")
            skipped_existing += 1
            continue

        print(f"[{i}/{total}] {char_id} -> {page_title}")

        stats = fetch_character_stats(char_id, page_title)
        if stats:
            fetched += 1
            if dry_run:
                print(f"  -> {json.dumps(stats, ensure_ascii=False)}")
            else:
                char["stats"] = stats
                print(f"  -> found stats: {json.dumps(stats, ensure_ascii=False)}")
        else:
            failed += 1
            print(f"  -> no stats found in wikitext")

        time.sleep(0.5)  # Rate limiting

    print(f"\n=== Results ===")
    print(f"  Fetched:          {fetched}")
    print(f"  Already had stats:{skipped_existing}")
    print(f"  Not in JSON:      {skipped_no_page}")
    print(f"  No stats found:   {failed}")

    if not dry_run and fetched > 0:
        with open(CHARACTERS_JSON, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"\nUpdated {fetched} characters in {CHARACTERS_JSON}")
    elif dry_run:
        print(f"\nDry run complete, no files modified.")
    else:
        print(f"\nNo new stats to write.")


if __name__ == "__main__":
    main()
