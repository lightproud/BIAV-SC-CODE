#!/usr/bin/env python3
"""
Fetch and enrich stage/level data with drop tables and recommended levels.

Reads maps.json (and stages.json if it exists), queries the Fandom MediaWiki
API for stage pages, parses wikitext for enemy levels / recommended power /
drop items and rates, then writes enriched data back to stages.json.

Sources:
  1. Fandom MediaWiki API (forget-last-night-morimens.fandom.com)
  2. Fandom alt (morimens.fandom.com)

Usage:
  python3 fetch_stages.py              # fetch, enrich, and save
  python3 fetch_stages.py --dry-run    # print results without writing

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

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data" / "db"
MAPS_JSON = DATA_DIR / "maps.json"
STAGES_JSON = DATA_DIR / "stages.json"
ITEMS_JSON = DATA_DIR / "items.json"

UA = (
    "Mozilla/5.0 (compatible; MorimensWikiBot/1.0; "
    "+https://github.com/lightproud/brain-in-a-vat)"
)

FANDOM_WIKIS = [
    "https://forget-last-night-morimens.fandom.com",
    "https://morimens.fandom.com",
]

RATE_LIMIT = 0.5  # seconds between API requests

# ---------------------------------------------------------------------------
# Known item names (loaded from items.json at startup for cross-referencing)
# ---------------------------------------------------------------------------
KNOWN_ITEMS: set[str] = set()


def load_known_items() -> None:
    """Populate KNOWN_ITEMS from items.json for drop validation."""
    if not ITEMS_JSON.exists():
        return
    with open(ITEMS_JSON, encoding="utf-8") as f:
        data = json.load(f)

    def _collect(obj: object) -> None:
        if isinstance(obj, dict):
            for key, val in obj.items():
                if key == "name" and isinstance(val, str):
                    KNOWN_ITEMS.add(val)
                if key == "name_en" and isinstance(val, str):
                    KNOWN_ITEMS.add(val)
                _collect(val)
        elif isinstance(obj, list):
            for item in obj:
                _collect(item)

    _collect(data)


# ---------------------------------------------------------------------------
# Fandom API helpers
# ---------------------------------------------------------------------------

def api_get(url: str) -> dict:
    """Make a GET request and return JSON."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def fetch_wikitext(wiki_base: str, page_title: str) -> str | None:
    """Fetch raw wikitext for a page via the MediaWiki parse API."""
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


def search_page(wiki_base: str, query: str) -> str | None:
    """Search for a page title on the wiki. Returns the best match or None."""
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
        if results:
            return results[0]["title"]
    except Exception as e:
        print(f"  [WARN] Search failed on {wiki_base}: {e}")
    return None


# ---------------------------------------------------------------------------
# Wikitext parsers
# ---------------------------------------------------------------------------

def parse_enemy_level(text: str) -> str | None:
    """Extract enemy level or level range from wikitext."""
    patterns = [
        r"[Ee]nemy\s*[Ll](?:eve)?l\.?\s*[:：]\s*([\d\s~–\-]+)",
        r"敌人等级\s*[:：]\s*([\d\s~–\-]+)",
        r"[Ll]evel\s*[:：]\s*([\d\s~–\-]+)",
        r"[Ll]v\.?\s*[:：]?\s*(\d[\d\s~–\-]*\d)",
        r"推荐等级\s*[:：]\s*([\d\s~–\-]+)",
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            return m.group(1).strip()
    return None


def parse_recommended_power(text: str) -> str | None:
    """Extract recommended power / training value from wikitext."""
    patterns = [
        r"[Rr]ecommended\s*[Pp]ower\s*[:：]\s*([\d,]+)",
        r"推荐战力\s*[:：]\s*([\d,]+)",
        r"推荐特训值\s*[:：]\s*([\d,]+)",
        r"[Tt]raining\s*[Vv]alue\s*[:：]\s*([\d,]+)",
        r"特训值\s*[:：]\s*([\d,]+)",
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            return m.group(1).strip().replace(",", "")
    return None


def parse_drop_table(text: str) -> list[dict]:
    """
    Parse drop items and rates from wikitext.

    Looks for table rows, template calls, and bulleted lists that describe
    drops. Returns a list of dicts: {item, rate (optional), rarity (optional)}.
    """
    drops: list[dict] = []
    seen: set[str] = set()

    # Pattern 1: wiki table rows like  | Item Name || 30% || Rare
    table_row_pat = re.compile(
        r"\|\|\s*([^\|}{]+?)\s*\|\|\s*([\d.]+%?)\s*(?:\|\|.*)?$",
        re.MULTILINE,
    )
    for m in table_row_pat.finditer(text):
        item_name = m.group(1).strip().strip("[]'")
        rate = m.group(2).strip()
        if item_name and item_name not in seen:
            seen.add(item_name)
            drops.append({"item": item_name, "rate": rate})

    # Pattern 2: template-style  {{Drop|item=XXX|rate=YY%}}
    template_pat = re.compile(
        r"\{\{[Dd]rop\s*\|([^}]+)\}\}"
    )
    for m in template_pat.finditer(text):
        body = m.group(1)
        item_m = re.search(r"item\s*=\s*([^|]+)", body)
        rate_m = re.search(r"rate\s*=\s*([^|]+)", body)
        if item_m:
            item_name = item_m.group(1).strip()
            if item_name not in seen:
                seen.add(item_name)
                entry: dict = {"item": item_name}
                if rate_m:
                    entry["rate"] = rate_m.group(1).strip()
                drops.append(entry)

    # Pattern 3: bulleted lists like  * Item Name (30%)  or  * Item Name - 30%
    bullet_pat = re.compile(
        r"^\*\s*\[?\[?([^\]\|\n]+?)\]?\]?\s*(?:[\(（]\s*([\d.]+%)\s*[\)）]|[-–—]\s*([\d.]+%))?",
        re.MULTILINE,
    )
    for m in bullet_pat.finditer(text):
        item_name = m.group(1).strip().strip("[]'")
        # Skip overly long strings (likely not item names)
        if len(item_name) > 40 or not item_name:
            continue
        rate = (m.group(2) or m.group(3) or "").strip()
        if item_name not in seen:
            seen.add(item_name)
            entry = {"item": item_name}
            if rate:
                entry["rate"] = rate
            drops.append(entry)

    # Pattern 4: Inline mentions like 掉落：XXX、YYY、ZZZ
    inline_pat = re.compile(r"(?:掉落|获得|奖励|[Dd]rop|[Rr]eward)s?\s*[:：]\s*(.+)", re.MULTILINE)
    for m in inline_pat.finditer(text):
        line = m.group(1).strip()
        # Split by Chinese/English comma and 、
        parts = re.split(r"[,，、;；]", line)
        for part in parts:
            item_name = part.strip().strip("[]()（）")
            if not item_name or len(item_name) > 40:
                continue
            if item_name not in seen:
                seen.add(item_name)
                drops.append({"item": item_name})

    # Cross-reference with known items to flag recognized ones
    for drop in drops:
        if drop["item"] in KNOWN_ITEMS:
            drop["verified"] = True

    return drops


def parse_stamina_cost(text: str) -> int | None:
    """Extract stamina (墨诺芬 / Menophine) cost from wikitext."""
    patterns = [
        r"(?:墨诺芬|[Ss]tamina|[Mm]enophine|体力)\s*[:：]?\s*(\d+)",
        r"(\d+)\s*(?:墨诺芬|[Ss]tamina|[Mm]enophine)",
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            return int(m.group(1))
    return None


# ---------------------------------------------------------------------------
# Stage data bootstrap from maps.json
# ---------------------------------------------------------------------------

def build_stages_from_maps(maps_data: dict) -> list[dict]:
    """
    Create a baseline stages list from maps.json content.

    Generates entries for resource dungeons, challenge modes, and story
    chapters where stage IDs are identifiable.
    """
    stages: list[dict] = []

    # Resource dungeons
    for rd in maps_data.get("resource_dungeons", []):
        stage = {
            "id": _slugify(rd.get("name_en", rd["name"])),
            "name": rd["name"],
            "name_en": rd.get("name_en", ""),
            "type": rd.get("type", "resource"),
            "category": "resource_dungeon",
            "reset": rd.get("reset", ""),
            "unlock": rd.get("unlock", ""),
            "stamina_cost": rd.get("stamina_cost"),
            "known_drops": rd.get("drops", []),
            "drop_table": [],
            "recommended_level": None,
            "enemy_level": None,
        }
        stages.append(stage)

    # Challenge modes
    for cm in maps_data.get("challenge_modes", []):
        stage = {
            "id": _slugify(cm.get("name_en", cm["name"])),
            "name": cm["name"],
            "name_en": cm.get("name_en", ""),
            "type": cm.get("type", "challenge"),
            "category": "challenge_mode",
            "reset": cm.get("reset", ""),
            "unlock": cm.get("unlock", ""),
            "known_drops": cm.get("drops", []),
            "drop_table": [],
            "recommended_level": None,
            "enemy_level": None,
        }
        # Carry over alert-level enemy ranges if present
        if "alert_levels" in cm:
            stage["alert_levels"] = cm["alert_levels"]
        stages.append(stage)

    # Daily/weekly
    for dw in maps_data.get("daily_weekly_system", []):
        stage = {
            "id": _slugify(dw.get("name_en", dw["name"])),
            "name": dw["name"],
            "name_en": dw.get("name_en", ""),
            "type": "daily_weekly",
            "category": "daily_weekly",
            "reset": dw.get("reset", ""),
            "known_drops": dw.get("drops", []),
            "drop_table": [],
            "recommended_level": None,
            "enemy_level": None,
        }
        stages.append(stage)

    return stages


def _slugify(name: str) -> str:
    """Convert a name to a lowercase slug ID."""
    s = name.lower().strip()
    s = re.sub(r"[/:：]", "-", s)
    s = re.sub(r"[^a-z0-9\-]", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "unknown"


# ---------------------------------------------------------------------------
# Page title guessing for Fandom lookup
# ---------------------------------------------------------------------------

# Map stage categories / names to likely Fandom page titles
FANDOM_PAGE_OVERRIDES: dict[str, str] = {
    "dissolution-ruins": "Dissolution_Ruins",
    "forbidden-inscriptions": "Forbidden_Inscriptions",
    "transcendent-existence": "Transcendent_Existence",
    "erosion-disaster-zone---dissolution-zone": "Erosion_Disaster_Zone",
    "phantasmal-dive---dream-dive": "Phantasmal_Dive",
    "phase-chess---phase-confrontation": "Phase_Chess",
    "lightless-realm": "Lightless_Realm",
    "d-effect-zone": "D-Effect_Zone",
    "arcane-dominion": "Arcane_Dominion",
    "under-the-outer-sky": "Under_the_Outer_Sky",
    "door-of-all-things": "Door_of_All_Things",
    "daily-training": "Daily_Training",
    "weekly-trial": "Weekly_Trial",
    "assignments---outfield-agent": "Assignments",
    "curriculum": "Curriculum",
}


def guess_page_title(stage: dict) -> str:
    """Guess the Fandom page title for a stage entry."""
    sid = stage["id"]
    if sid in FANDOM_PAGE_OVERRIDES:
        return FANDOM_PAGE_OVERRIDES[sid]
    # Fall back to English name with spaces replaced
    name_en = stage.get("name_en", "")
    if name_en:
        # Take the first alternative if there's a slash
        name_en = name_en.split("/")[0].strip()
        return name_en.replace(" ", "_")
    return stage["name"]


# ---------------------------------------------------------------------------
# Main enrichment logic
# ---------------------------------------------------------------------------

def enrich_stage(stage: dict, dry_run: bool = False) -> bool:
    """
    Query Fandom for a stage and enrich it with drop / level data.

    Returns True if new data was found.
    """
    page_title = guess_page_title(stage)
    found = False

    for wiki_base in FANDOM_WIKIS:
        # First try the guessed title, then search if that fails
        wikitext = fetch_wikitext(wiki_base, page_title)
        if wikitext is None:
            # Try searching
            searched = search_page(wiki_base, stage.get("name_en") or stage["name"])
            if searched:
                wikitext = fetch_wikitext(wiki_base, searched)
                if wikitext:
                    page_title = searched

        if not wikitext:
            continue

        # Parse fields
        enemy_lvl = parse_enemy_level(wikitext)
        rec_power = parse_recommended_power(wikitext)
        drops = parse_drop_table(wikitext)
        stamina = parse_stamina_cost(wikitext)

        if enemy_lvl or rec_power or drops or stamina:
            found = True
            if enemy_lvl:
                stage["enemy_level"] = enemy_lvl
            if rec_power:
                stage["recommended_level"] = rec_power
            if drops:
                stage["drop_table"] = drops
            if stamina is not None:
                stage["stamina_cost"] = stamina
            stage["_wiki_source"] = f"{wiki_base}/wiki/{urllib.parse.quote(page_title)}"
            break

    return found


def main() -> None:
    dry_run = "--dry-run" in sys.argv

    # Load known items for cross-referencing
    load_known_items()
    print(f"Loaded {len(KNOWN_ITEMS)} known item names for cross-reference.\n")

    # Load or bootstrap stages data
    if STAGES_JSON.exists():
        print(f"Reading existing {STAGES_JSON}")
        with open(STAGES_JSON, encoding="utf-8") as f:
            stages_data = json.load(f)
        stages = stages_data.get("stages", [])
    else:
        print(f"stages.json not found — bootstrapping from {MAPS_JSON}")
        if not MAPS_JSON.exists():
            print(f"ERROR: {MAPS_JSON} not found. Cannot proceed.")
            sys.exit(1)
        with open(MAPS_JSON, encoding="utf-8") as f:
            maps_data = json.load(f)
        stages = build_stages_from_maps(maps_data)
        stages_data = {
            "description": "忘却前夜关卡数据（含掉落表与推荐等级）",
            "stages": stages,
        }
        print(f"  Bootstrapped {len(stages)} stage entries from maps.json\n")

    # Enrich each stage via Fandom API
    total = len(stages)
    enriched = 0

    print("=== Fetching stage data from Fandom ===\n")

    for i, stage in enumerate(stages, 1):
        label = stage.get("name_en") or stage.get("name") or stage.get("id")
        print(f"[{i}/{total}] {label}")

        success = enrich_stage(stage, dry_run)
        if success:
            enriched += 1
            if stage.get("drop_table"):
                n = len(stage["drop_table"])
                print(f"  -> {n} drop(s), enemy_level={stage.get('enemy_level')}, "
                      f"recommended={stage.get('recommended_level')}")
            else:
                print(f"  -> metadata found (no drop table)")
        else:
            print(f"  -> no wiki data found")

        time.sleep(RATE_LIMIT)

    print(f"\n=== Results: {enriched}/{total} stages enriched ===\n")

    if dry_run:
        print("[DRY RUN] Would write the following to stages.json:\n")
        print(json.dumps(stages_data, ensure_ascii=False, indent=2)[:3000])
        if len(json.dumps(stages_data, ensure_ascii=False)) > 3000:
            print("\n  ... (truncated)")
        return

    # Write enriched data
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(STAGES_JSON, "w", encoding="utf-8") as f:
        json.dump(stages_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Wrote {STAGES_JSON}")


if __name__ == "__main__":
    main()
