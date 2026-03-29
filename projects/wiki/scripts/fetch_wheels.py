#!/usr/bin/env python3
"""
Fetch Wheel of Destiny effect data from Fandom MediaWiki API.

Reads equipment.json, finds wheels with missing or short effect descriptions,
queries the Fandom wiki for detailed effect/passive info, and updates the JSON.

Sources (in priority order):
  1. Fandom MediaWiki API (forget-last-night-morimens.fandom.com)
  2. Fandom alt (morimens.fandom.com)

Usage:
  python3 fetch_wheels.py              # fetch and update equipment.json
  python3 fetch_wheels.py --dry-run    # print results only

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
EQUIPMENT_JSON = SCRIPT_DIR.parent / "data" / "db" / "equipment.json"

UA = "Mozilla/5.0 (compatible; MorimensWikiBot/1.0; +https://github.com/lightproud/brain-in-a-vat)"

FANDOM_WIKIS = [
    "https://forget-last-night-morimens.fandom.com",
    "https://morimens.fandom.com",
]

RATE_LIMIT = 0.5  # seconds between requests

# Minimum effect length to consider "complete" -- shorter ones get re-fetched
MIN_EFFECT_LENGTH = 30


def api_get(url: str) -> dict:
    """Make a GET request and return JSON."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def search_wiki(wiki_base: str, query: str) -> str | None:
    """Search Fandom wiki for a page matching the query. Returns page title or None."""
    params = urllib.parse.urlencode({
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srlimit": "5",
        "format": "json",
    })
    url = f"{wiki_base}/api.php?{params}"
    try:
        data = api_get(url)
        results = data.get("query", {}).get("search", [])
        if not results:
            return None
        # Prefer exact title match
        query_lower = query.lower()
        for r in results:
            if r["title"].lower() == query_lower:
                return r["title"]
        # Fall back to first result
        return results[0]["title"]
    except Exception as e:
        print(f"  [WARN] Search failed on {wiki_base}: {e}")
        return None


def fetch_wikitext(wiki_base: str, page_title: str) -> str | None:
    """Fetch raw wikitext for a page via action=parse."""
    params = urllib.parse.urlencode({
        "action": "parse",
        "page": page_title,
        "prop": "wikitext",
        "format": "json",
    })
    url = f"{wiki_base}/api.php?{params}"
    try:
        data = api_get(url)
        return data.get("parse", {}).get("wikitext", {}).get("*", "")
    except Exception as e:
        print(f"  [WARN] Parse failed for '{page_title}' on {wiki_base}: {e}")
        return None


def clean_wikitext(text: str) -> str:
    """Strip wiki markup to plain text."""
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", "", text)
    # Remove file/image links
    text = re.sub(r"\[\[(?:File|Image):[^\]]*\]\]", "", text)
    # Convert wiki links [[Target|Display]] -> Display, [[Target]] -> Target
    text = re.sub(r"\[\[[^|\]]*\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    # Remove templates like {{...}} (simple, non-nested)
    text = re.sub(r"\{\{[^}]*\}\}", "", text)
    # Remove bold/italic markup
    text = re.sub(r"'{2,5}", "", text)
    # Collapse whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_section(wikitext: str, heading_patterns: list[str]) -> str | None:
    """Extract text under a section heading matching any of the patterns."""
    for pattern in heading_patterns:
        # Match ==Heading== through ===Heading=== with flexible whitespace
        regex = re.compile(
            r"={2,4}\s*" + pattern + r"\s*={2,4}\s*\n(.*?)(?=\n={2,4}[^=]|\Z)",
            re.IGNORECASE | re.DOTALL,
        )
        match = regex.search(wikitext)
        if match:
            return clean_wikitext(match.group(1)).strip()
    return None


def parse_wheel_data(wikitext: str) -> dict:
    """Parse wikitext for wheel-related data fields."""
    result = {}

    # --- Effect / Passive ---
    effect_patterns = [
        r"(?:Passive\s*)?Effect",
        r"Passive",
        r"Skill\s*Effect",
        r"Ability",
        r"Description",
        r"Wheel\s*Effect",
    ]
    effect_text = extract_section(wikitext, effect_patterns)
    if effect_text:
        # Take first meaningful paragraph (skip very short ones)
        paragraphs = [p.strip() for p in effect_text.split("\n\n") if p.strip()]
        combined = "\n".join(paragraphs[:3])  # Up to 3 paragraphs
        if len(combined) > 10:
            result["effect_en"] = combined

    # --- Also look for effect in infobox-style templates ---
    if "effect_en" not in result:
        # Try to find |effect = ... or |passive = ... in template params
        for field in ["effect", "passive", "skill_effect", "ability"]:
            match = re.search(
                r"\|\s*" + field + r"\s*=\s*(.+?)(?=\n\||\n\}\}|\Z)",
                wikitext,
                re.IGNORECASE | re.DOTALL,
            )
            if match:
                cleaned = clean_wikitext(match.group(1)).strip()
                if len(cleaned) > 10:
                    result["effect_en"] = cleaned
                    break

    # --- Base stats ---
    stat_patterns = [r"Stat(?:istic)?s?", r"Base\s*Stat(?:s)?", r"Main\s*Stat"]
    stats_text = extract_section(wikitext, stat_patterns)
    if stats_text and len(stats_text) > 5:
        result["base_stats_en"] = stats_text[:300]  # Cap length

    # Also look for stat template fields
    if "base_stats_en" not in result:
        for field in ["main_stat", "base_stat", "stat", "base_stats"]:
            match = re.search(
                r"\|\s*" + field + r"\s*=\s*(.+?)(?=\n\||\n\}\}|\Z)",
                wikitext,
                re.IGNORECASE,
            )
            if match:
                cleaned = clean_wikitext(match.group(1)).strip()
                if len(cleaned) > 3:
                    result["base_stats_en"] = cleaned
                    break

    # --- Max stats ---
    max_patterns = [r"Max\s*Stat(?:s)?", r"Max\s*Level", r"Lv\.?\s*60"]
    max_text = extract_section(wikitext, max_patterns)
    if max_text and len(max_text) > 5:
        result["max_stats_en"] = max_text[:300]

    # --- Recommended characters ---
    rec_patterns = [
        r"Recommend(?:ed)?\s*(?:Character|Awakener|User)s?",
        r"Best\s*(?:Character|Awakener|User)s?",
        r"Suitable\s*(?:Character|Awakener)s?",
    ]
    rec_text = extract_section(wikitext, rec_patterns)
    if rec_text and len(rec_text) > 3:
        # Try to extract a list of names
        names = [n.strip() for n in re.split(r"[,\n;/]", rec_text) if n.strip()]
        names = [n for n in names if len(n) < 40]  # Filter out long non-name strings
        if names:
            result["recommended_en"] = names

    # Also look for recommended in template fields
    if "recommended_en" not in result:
        for field in ["recommended", "best_characters", "suitable"]:
            match = re.search(
                r"\|\s*" + field + r"\s*=\s*(.+?)(?=\n\||\n\}\}|\Z)",
                wikitext,
                re.IGNORECASE,
            )
            if match:
                cleaned = clean_wikitext(match.group(1)).strip()
                names = [n.strip() for n in re.split(r"[,\n;/]", cleaned) if n.strip()]
                names = [n for n in names if len(n) < 40]
                if names:
                    result["recommended_en"] = names
                    break

    return result


def needs_update(wheel: dict) -> bool:
    """Check if a wheel entry needs its effect data fetched."""
    effect = wheel.get("effect", "")
    if not effect:
        return True
    if len(effect) < MIN_EFFECT_LENGTH:
        return True
    return False


def collect_wheels(data: dict) -> list[tuple[str, int, dict]]:
    """Collect all wheel entries that need updating.

    Returns list of (category_name, index, wheel_dict).
    """
    categories = [
        "ssr_limited_oblivion",
        "ssr_limited_stellar",
        "ssr_standard",
        "sr_wheels",
        "r_wheels",
    ]
    to_update = []
    for cat in categories:
        wheels = data.get("wheels_of_destiny", {}).get(cat, [])
        for i, wheel in enumerate(wheels):
            if needs_update(wheel):
                to_update.append((cat, i, wheel))
    return to_update


def fetch_wheel_info(wheel: dict) -> dict:
    """Try to fetch wheel data from Fandom wikis."""
    name_en = wheel.get("name_en", "")
    if not name_en:
        return {}

    for wiki_base in FANDOM_WIKIS:
        # Strategy 1: Search by English name directly
        page_title = search_wiki(wiki_base, name_en)
        if not page_title:
            # Strategy 2: Search with "Wheel" appended
            page_title = search_wiki(wiki_base, f"{name_en} Wheel")
        if not page_title:
            continue

        time.sleep(RATE_LIMIT)

        wikitext = fetch_wikitext(wiki_base, page_title)
        if not wikitext:
            continue

        parsed = parse_wheel_data(wikitext)
        if parsed:
            parsed["_wiki_source"] = wiki_base
            parsed["_wiki_page"] = page_title
            return parsed

        time.sleep(RATE_LIMIT)

    return {}


def apply_update(wheel: dict, info: dict) -> bool:
    """Apply fetched info to a wheel dict. Returns True if anything changed."""
    changed = False

    # Update effect with English wiki data
    if "effect_en" in info:
        wheel["effect_en"] = info["effect_en"]
        changed = True

    # Add base stats if not already present
    if "base_stats_en" in info and "main_stat" not in wheel:
        wheel["base_stats_en"] = info["base_stats_en"]
        changed = True

    # Add max stats
    if "max_stats_en" in info:
        wheel["max_stats_en"] = info["max_stats_en"]
        changed = True

    # Add recommended characters if not already present
    if "recommended_en" in info and "recommended" not in wheel:
        wheel["recommended_en"] = info["recommended_en"]
        changed = True

    # Track wiki source
    if changed:
        wheel["_wiki_source"] = info.get("_wiki_source", "")
        wheel["_wiki_page"] = info.get("_wiki_page", "")

    return changed


def main():
    dry_run = "--dry-run" in sys.argv

    if not EQUIPMENT_JSON.exists():
        print(f"ERROR: {EQUIPMENT_JSON} not found")
        sys.exit(1)

    with open(EQUIPMENT_JSON) as f:
        data = json.load(f)

    to_update = collect_wheels(data)
    total_wheels = sum(
        len(data.get("wheels_of_destiny", {}).get(cat, []))
        for cat in ["ssr_limited_oblivion", "ssr_limited_stellar", "ssr_standard", "sr_wheels", "r_wheels"]
    )

    print(f"=== Fetch Wheel of Destiny Effects ===")
    print(f"Total wheels: {total_wheels}")
    print(f"Need update: {len(to_update)}")
    if dry_run:
        print("Mode: DRY RUN (no files will be modified)\n")
    else:
        print()

    updated = 0
    failed = 0

    for i, (cat, idx, wheel) in enumerate(to_update, 1):
        name = wheel.get("name", "?")
        name_en = wheel.get("name_en", "?")
        current_effect = wheel.get("effect", "")
        print(f"[{i}/{len(to_update)}] {name} ({name_en}) [{cat}]")
        if current_effect:
            print(f"  Current: {current_effect[:60]}...")

        info = fetch_wheel_info(wheel)

        if info:
            print(f"  Found on: {info.get('_wiki_page', '?')} @ {info.get('_wiki_source', '?')}")
            if "effect_en" in info:
                preview = info["effect_en"][:80].replace("\n", " ")
                print(f"  Effect: {preview}...")
            if "base_stats_en" in info:
                print(f"  Stats: {info['base_stats_en'][:60]}")
            if "recommended_en" in info:
                print(f"  Recommended: {', '.join(info['recommended_en'][:5])}")

            if not dry_run:
                # Apply to the actual data structure
                target = data["wheels_of_destiny"][cat][idx]
                if apply_update(target, info):
                    updated += 1
                else:
                    failed += 1
            else:
                updated += 1
        else:
            print(f"  [MISS] No wiki data found")
            failed += 1

        time.sleep(RATE_LIMIT)

    print(f"\n=== Results ===")
    print(f"Updated: {updated}")
    print(f"Not found: {failed}")
    print(f"Already complete: {total_wheels - len(to_update)}")

    if not dry_run and updated > 0:
        with open(EQUIPMENT_JSON, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"\nSaved to {EQUIPMENT_JSON}")
    elif dry_run:
        print("\nDry run complete. No files modified.")


if __name__ == "__main__":
    main()
