#!/usr/bin/env python3
"""
Fetch and enrich card data for all characters from Fandom wiki.

Reads characters.json for existing card/skill data, fetches missing details
from the Fandom MediaWiki API (wikitext parsing), and writes a unified
cards.json database.

Sources:
  1. Local characters.json (existing command_cards, rouse, exalt, enlighten)
  2. Fandom MediaWiki API (forget-last-night-morimens.fandom.com)

Usage:
  python3 fetch_cards.py              # fetch, enrich, and save
  python3 fetch_cards.py --dry-run    # print results only, no file writes

Requires: Python 3.8+ (stdlib only)
"""

import json
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
CHARACTERS_JSON = DATA_DIR / "characters.json"
CARDS_JSON = DATA_DIR / "cards.json"

UA = (
    "Mozilla/5.0 (compatible; MorimensWikiBot/1.0; "
    "+https://github.com/lightproud/brain-in-a-vat)"
)

FANDOM_BASE = "https://forget-last-night-morimens.fandom.com"
FANDOM_ALT = "https://morimens.fandom.com"

# Character ID -> Fandom page title.
# Mirrors the mapping in fetch_portraits.py; extend as needed.
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

RATE_LIMIT = 0.5  # seconds between requests

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def api_get(url: str) -> dict:
    """Make a GET request and return parsed JSON."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


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
        return data.get("parse", {}).get("wikitext", {}).get("*")
    except Exception as e:
        print(f"  [WARN] Failed to fetch wikitext from {wiki_base}: {e}")
        return None


# ---------------------------------------------------------------------------
# Wikitext parsing
# ---------------------------------------------------------------------------

def strip_wikimarkup(text: str) -> str:
    """Remove common wikitext markup, returning plain text."""
    if not text:
        return ""
    # Remove [[ ]] links, keeping display text
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", text)
    # Remove {{ }} templates (simple, non-nested)
    text = re.sub(r"\{\{[^}]*\}\}", "", text)
    # Remove '' and ''' (bold/italic)
    text = re.sub(r"'{2,3}", "", text)
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def parse_infobox_field(wikitext: str, field_name: str) -> str | None:
    """Extract a value from a mediawiki infobox |field = value pattern."""
    end_marker = r"\}\}"
    pattern = rf"\|\s*{re.escape(field_name)}\s*=\s*(.+?)(?=\n\s*\||\n\s*{end_marker})"
    m = re.search(pattern, wikitext, re.DOTALL)
    if m:
        return strip_wikimarkup(m.group(1).strip())
    return None


def parse_cards_from_wikitext(wikitext: str) -> dict:
    """
    Parse card/skill data from character page wikitext.

    Returns a dict with possible keys:
      command_cards: list of card dicts
      rouse: dict
      exalt: dict
      enlighten: list
      talent: dict
    """
    result = {}

    # --- Command Cards ---
    # Look for sections with skill/card tables or headings
    cards = []

    # Strategy 1: Look for tabber / card sections with cost and effect
    # Common patterns: == Skills == or == Command Cards ==
    # Card entries often in templates like {{Skill|name=...|cost=...|effect=...}}
    skill_template_pattern = re.compile(
        r"\{\{(?:Skill|Card|CommandCard)[^}]*?"
        r"\|\s*name\s*=\s*(?P<name>[^|}\n]+)"
        r"(?:[^}]*?\|\s*(?:name_en|english)\s*=\s*(?P<name_en>[^|}\n]+))?"
        r"(?:[^}]*?\|\s*cost\s*=\s*(?P<cost>[^|}\n]+))?"
        r"(?:[^}]*?\|\s*(?:effect|description)\s*=\s*(?P<effect>[^}]+))?"
        r"\}\}",
        re.IGNORECASE | re.DOTALL,
    )
    for m in skill_template_pattern.finditer(wikitext):
        card = {"name": strip_wikimarkup(m.group("name"))}
        if m.group("name_en"):
            card["name_en"] = strip_wikimarkup(m.group("name_en"))
        cost_raw = m.group("cost")
        if cost_raw:
            cost_raw = cost_raw.strip()
            try:
                card["cost"] = int(cost_raw)
            except ValueError:
                card["cost"] = cost_raw
        if m.group("effect"):
            card["effect"] = strip_wikimarkup(m.group("effect"))
        cards.append(card)

    # Strategy 2: Look for wikitable rows with card data
    # Pattern: || card name || cost || effect ||
    table_row_pattern = re.compile(
        r"\|\|\s*(?P<name>[^\|]+?)\s*"
        r"\|\|\s*(?P<cost>\d+)\s*"
        r"\|\|\s*(?P<effect>[^\|]+?)\s*(?:\|\||$)",
        re.MULTILINE,
    )
    for m in table_row_pattern.finditer(wikitext):
        name = strip_wikimarkup(m.group("name"))
        # Skip header rows
        if name.lower() in ("name", "card", "skill", ""):
            continue
        card = {"name": name}
        try:
            card["cost"] = int(m.group("cost").strip())
        except ValueError:
            card["cost"] = m.group("cost").strip()
        card["effect"] = strip_wikimarkup(m.group("effect"))
        # Avoid duplicates
        if not any(c.get("name") == card["name"] for c in cards):
            cards.append(card)

    # Strategy 3: Section-based parsing for == Strike ==, == Defense ==, etc.
    section_pattern = re.compile(
        r"={2,3}\s*(?P<heading>[^=]+?)\s*={2,3}\s*\n(?P<body>.*?)(?=\n={2,3}\s|\Z)",
        re.DOTALL,
    )
    card_section_keywords = {
        "strike", "defense", "command card", "skill",
        "打击", "防御", "指令", "技能",
    }
    for m in section_pattern.finditer(wikitext):
        heading = m.group("heading").strip().lower()
        body = m.group("body").strip()

        # Rouse / Spirit Awakening
        if any(kw in heading for kw in ("rouse", "灵知觉醒", "spirit awakening", "觉醒")):
            rouse_data = _parse_skill_section(body)
            if rouse_data:
                result["rouse"] = rouse_data

        # Exalt / Fury Burst
        elif any(kw in heading for kw in ("exalt", "狂气爆发", "fury", "burst")):
            exalt_data = _parse_skill_section(body)
            if exalt_data:
                result["exalt"] = exalt_data

        # Overexalt
        elif any(kw in heading for kw in ("overexalt", "超限", "over exalt")):
            overexalt_data = _parse_skill_section(body)
            if overexalt_data:
                result["overexalt"] = overexalt_data

        # Enlighten
        elif any(kw in heading for kw in ("enlighten", "启灵")):
            enlighten = _parse_enlighten_section(body)
            if enlighten:
                result["enlighten"] = enlighten

        # Talent
        elif any(kw in heading for kw in ("talent", "天赋", "passive")):
            talent_data = _parse_skill_section(body)
            if talent_data:
                result["talent"] = talent_data

    if cards:
        result["command_cards"] = cards

    # --- Infobox fallbacks ---
    # Try to pull cost/effect from infobox fields if no cards found
    if not cards:
        for field_prefix in ("skill1", "skill2", "skill3", "skill4"):
            name_val = parse_infobox_field(wikitext, f"{field_prefix}_name")
            effect_val = parse_infobox_field(wikitext, f"{field_prefix}_effect")
            if name_val and effect_val:
                card = {"name": name_val, "effect": effect_val}
                cost_val = parse_infobox_field(wikitext, f"{field_prefix}_cost")
                if cost_val:
                    try:
                        card["cost"] = int(cost_val)
                    except ValueError:
                        card["cost"] = cost_val
                cards.append(card)
        if cards:
            result["command_cards"] = cards

    if not result.get("rouse"):
        rouse_name = parse_infobox_field(wikitext, "rouse_name") or parse_infobox_field(wikitext, "awakening_name")
        rouse_effect = parse_infobox_field(wikitext, "rouse_effect") or parse_infobox_field(wikitext, "awakening_effect")
        if rouse_name and rouse_effect:
            result["rouse"] = {"name": rouse_name, "effect": rouse_effect}

    if not result.get("exalt"):
        exalt_name = parse_infobox_field(wikitext, "exalt_name") or parse_infobox_field(wikitext, "burst_name")
        exalt_effect = parse_infobox_field(wikitext, "exalt_effect") or parse_infobox_field(wikitext, "burst_effect")
        if exalt_name and exalt_effect:
            result["exalt"] = {"name": exalt_name, "effect": exalt_effect}

    return result


def _parse_skill_section(body: str) -> dict | None:
    """Parse a skill name + effect from a section body."""
    lines = [l.strip() for l in body.strip().splitlines() if l.strip()]
    if not lines:
        return None

    # Try to find name: xxx / effect: xxx pattern
    name = None
    effect_parts = []
    for line in lines:
        clean = strip_wikimarkup(line)
        if not clean:
            continue
        name_match = re.match(r"(?:name|名称)\s*[:：]\s*(.+)", clean, re.IGNORECASE)
        if name_match:
            name = name_match.group(1).strip()
            continue
        effect_match = re.match(r"(?:effect|效果|description)\s*[:：]\s*(.+)", clean, re.IGNORECASE)
        if effect_match:
            effect_parts.append(effect_match.group(1).strip())
            continue
        # Collect remaining text as effect
        if not clean.startswith(("*", "#", "!")):
            effect_parts.append(clean)
        else:
            effect_parts.append(clean.lstrip("*# "))

    if not name and effect_parts:
        # First non-empty line as name if it's short
        if len(effect_parts[0]) < 30:
            name = effect_parts.pop(0)

    effect = " ".join(effect_parts).strip() if effect_parts else None
    if name or effect:
        result = {}
        if name:
            result["name"] = name
        if effect:
            result["effect"] = effect
        return result
    return None


def _parse_enlighten_section(body: str) -> list:
    """Parse enlighten levels from a section body."""
    entries = []
    # Look for numbered entries: 1. name - effect  or  Level 1: ...
    level_pattern = re.compile(
        r"(?:(?:level|lv|启灵)\s*)?(\d)\s*[.：:)\-]\s*(.+)",
        re.IGNORECASE,
    )
    for m in level_pattern.finditer(body):
        level = int(m.group(1))
        text = strip_wikimarkup(m.group(2).strip())
        # Try to split name - effect
        parts = re.split(r"\s*[-–—:：]\s*", text, maxsplit=1)
        entry = {"level": level}
        if len(parts) == 2 and len(parts[0]) < 30:
            entry["name"] = parts[0]
            entry["effect"] = parts[1]
        else:
            entry["effect"] = text
        entries.append(entry)
    return entries


# ---------------------------------------------------------------------------
# Card database building
# ---------------------------------------------------------------------------

def load_existing_cards() -> dict:
    """Load existing cards.json if it exists."""
    if CARDS_JSON.exists():
        with open(CARDS_JSON, encoding="utf-8") as f:
            return json.load(f)
    return {
        "description": "忘却前夜角色卡牌数据库。每位唤醒体拥有4张指令卡+1张灵知觉醒卡，以及狂气爆发和启灵技能。",
        "description_en": "Morimens character card database. Each Awakener has 4 Command Cards + 1 Rouse Card, plus Exalt and Enlighten skills.",
        "cards": [],
    }


def extract_cards_from_characters() -> dict[str, dict]:
    """
    Extract existing card/skill data from characters.json.
    Returns {char_id: skills_dict}.
    """
    with open(CHARACTERS_JSON, encoding="utf-8") as f:
        data = json.load(f)

    extracted = {}
    for char in data["characters"]:
        char_id = char["id"]
        skills = char.get("skills")
        if not skills:
            continue

        entry = {}
        if "command_cards" in skills:
            entry["command_cards"] = skills["command_cards"]
        if "rouse" in skills:
            entry["rouse"] = skills["rouse"]
        if "exalt" in skills:
            entry["exalt"] = skills["exalt"]
        if "overexalt" in skills:
            entry["overexalt"] = skills["overexalt"]
        if "enlighten" in skills:
            entry["enlighten"] = skills["enlighten"]
        if "talent" in skills:
            entry["talent"] = skills["talent"]

        if entry:
            extracted[char_id] = entry

    return extracted


def build_card_entry(char: dict, skills_data: dict) -> dict:
    """Build a card database entry for one character."""
    entry = {
        "character_id": char["id"],
        "character_name": char["name"],
        "character_name_en": char.get("name_en", ""),
        "rarity": char.get("rarity", ""),
        "realm": char.get("realm", ""),
    }

    if "command_cards" in skills_data:
        entry["command_cards"] = skills_data["command_cards"]
    if "rouse" in skills_data:
        entry["rouse"] = skills_data["rouse"]
    if "exalt" in skills_data:
        entry["exalt"] = skills_data["exalt"]
    if "overexalt" in skills_data:
        entry["overexalt"] = skills_data["overexalt"]
    if "enlighten" in skills_data:
        entry["enlighten"] = skills_data["enlighten"]
    if "talent" in skills_data:
        entry["talent"] = skills_data["talent"]

    return entry


def is_incomplete(skills_data: dict) -> bool:
    """Check if card data is incomplete (missing key fields)."""
    if not skills_data:
        return True
    if "command_cards" not in skills_data:
        return True
    cards = skills_data.get("command_cards", [])
    if len(cards) < 2:
        return True
    # Check if any card is missing effect
    for card in cards:
        if not card.get("effect") or card["effect"] in ("标准打击卡", "标准防御卡"):
            return True
    # Missing rouse is a strong signal of incompleteness
    if "rouse" not in skills_data:
        return True
    return False


def merge_skills(existing: dict, fetched: dict) -> dict:
    """
    Merge fetched wiki data into existing data.
    Existing data takes precedence for fields that are already populated
    with meaningful values. Fetched data fills gaps.
    """
    merged = dict(existing)

    for key in ("rouse", "exalt", "overexalt", "talent"):
        if key not in merged and key in fetched:
            merged[key] = fetched[key]
        elif key in merged and key in fetched:
            # Fill missing sub-fields
            for subkey, subval in fetched[key].items():
                if subkey not in merged[key]:
                    merged[key][subkey] = subval

    if "enlighten" not in merged and "enlighten" in fetched:
        merged["enlighten"] = fetched["enlighten"]

    if "command_cards" not in merged and "command_cards" in fetched:
        merged["command_cards"] = fetched["command_cards"]
    elif "command_cards" in merged and "command_cards" in fetched:
        # Fill in placeholders
        existing_cards = {c.get("name"): c for c in merged["command_cards"]}
        for fc in fetched["command_cards"]:
            fname = fc.get("name")
            if fname and fname in existing_cards:
                ec = existing_cards[fname]
                # Fill missing fields
                for fk, fv in fc.items():
                    if fk not in ec:
                        ec[fk] = fv
                    elif ec[fk] in ("标准打击卡", "标准防御卡") and fk == "effect" and fv:
                        ec[fk] = fv
            elif fname and fname not in existing_cards:
                merged["command_cards"].append(fc)

    return merged


# ---------------------------------------------------------------------------
# Main workflow
# ---------------------------------------------------------------------------

def main():
    dry_run = "--dry-run" in sys.argv

    print("=== Morimens Card Data Enrichment ===\n")

    # Step 1: Load characters
    with open(CHARACTERS_JSON, encoding="utf-8") as f:
        char_data = json.load(f)
    characters = char_data["characters"]
    char_by_id = {c["id"]: c for c in characters}
    print(f"Loaded {len(characters)} characters from characters.json")

    # Step 2: Extract existing card data
    existing_skills = extract_cards_from_characters()
    print(f"Found existing skill data for {len(existing_skills)} characters")

    # Step 3: Identify incomplete entries
    incomplete = []
    for char in characters:
        cid = char["id"]
        if cid not in PAGE_MAP:
            continue
        skills = existing_skills.get(cid, {})
        if is_incomplete(skills):
            incomplete.append(cid)

    print(f"Identified {len(incomplete)} characters with incomplete card data")
    print()

    # Step 4: Fetch from wiki
    fetch_results = {}
    total = len(incomplete)
    for i, cid in enumerate(incomplete, 1):
        page_title = PAGE_MAP[cid]
        char = char_by_id[cid]
        print(f"[{i}/{total}] {cid} ({char['name']}) -> {page_title}")

        wikitext = None
        for wiki_base in (FANDOM_BASE, FANDOM_ALT):
            wikitext = fetch_wikitext(wiki_base, page_title)
            if wikitext:
                break

        if not wikitext:
            print("  [SKIP] No wikitext found")
            time.sleep(RATE_LIMIT)
            continue

        parsed = parse_cards_from_wikitext(wikitext)
        if parsed:
            fetch_results[cid] = parsed
            fields = list(parsed.keys())
            print(f"  [OK] Parsed: {', '.join(fields)}")
        else:
            print("  [SKIP] No card data parsed from wikitext")

        time.sleep(RATE_LIMIT)

    print(f"\n=== Fetched data for {len(fetch_results)}/{total} characters ===\n")

    # Step 5: Merge and build final card entries
    all_skills = {}
    for char in characters:
        cid = char["id"]
        existing = existing_skills.get(cid, {})
        fetched = fetch_results.get(cid, {})
        if existing or fetched:
            all_skills[cid] = merge_skills(existing, fetched)

    # Step 6: Build cards.json
    cards_db = load_existing_cards()
    card_entries = []
    enriched_count = 0
    for char in characters:
        cid = char["id"]
        skills = all_skills.get(cid, {})
        if skills:
            entry = build_card_entry(char, skills)
            card_entries.append(entry)
            if cid in fetch_results:
                enriched_count += 1

    cards_db["cards"] = card_entries

    # Step 7: Report
    with_cards = sum(1 for e in card_entries if "command_cards" in e)
    with_rouse = sum(1 for e in card_entries if "rouse" in e)
    with_exalt = sum(1 for e in card_entries if "exalt" in e)
    with_enlighten = sum(1 for e in card_entries if "enlighten" in e)

    print(f"Card database summary:")
    print(f"  Total entries:      {len(card_entries)}")
    print(f"  With command_cards: {with_cards}")
    print(f"  With rouse:         {with_rouse}")
    print(f"  With exalt:         {with_exalt}")
    print(f"  With enlighten:     {with_enlighten}")
    print(f"  Enriched from wiki: {enriched_count}")
    print()

    if dry_run:
        print("[DRY RUN] Would write to:", CARDS_JSON)
        print("[DRY RUN] Preview of first 3 entries:")
        for entry in card_entries[:3]:
            print(json.dumps(entry, ensure_ascii=False, indent=2)[:500])
            print("---")
        return

    # Step 8: Write cards.json
    CARDS_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(CARDS_JSON, "w", encoding="utf-8") as f:
        json.dump(cards_db, ensure_ascii=False, indent=2, fp=f)
        f.write("\n")

    print(f"Wrote {CARDS_JSON}")


if __name__ == "__main__":
    main()
