#!/usr/bin/env python3
"""
Fetch character skill data from Fandom MediaWiki API and update characters.json.

Queries the forget-last-night-morimens.fandom.com wiki for each character that
is missing a "skills" field, parses the wikitext to extract skill information,
and writes the results back into characters.json.

Usage:
  python3 fetch_skills.py              # fetch and update
  python3 fetch_skills.py --dry-run    # print results only

Requires: Python 3.8+ (stdlib only)
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional

SCRIPT_DIR = Path(__file__).parent
CHARACTERS_JSON = SCRIPT_DIR.parent / "data" / "db" / "characters.json"

UA = "Mozilla/5.0 (compatible; MorimensWikiBot/1.0; +https://github.com/lightproud/brain-in-a-vat)"

FANDOM_BASE = "https://forget-last-night-morimens.fandom.com"

# Character ID -> Fandom page title mapping (from fetch_portraits.py)
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

# ── Fandom API helpers ──────────────────────────────────────────────────────

def api_get(url: str) -> dict:
    """Make a GET request and return JSON."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def fetch_wikitext(page_title: str) -> Optional[str]:
    """Fetch raw wikitext for a Fandom page via the MediaWiki parse API."""
    params = urllib.parse.urlencode({
        "action": "parse",
        "page": page_title,
        "prop": "wikitext",
        "format": "json",
    })
    url = f"{FANDOM_BASE}/api.php?{params}"
    try:
        data = api_get(url)
        wikitext = data.get("parse", {}).get("wikitext", {}).get("*", "")
        return wikitext if wikitext else None
    except Exception as e:
        print(f"  [WARN] Failed to fetch wikitext for '{page_title}': {e}")
        return None


# ── Wikitext parsing helpers ────────────────────────────────────────────────

def strip_wikimarkup(text: str) -> str:
    """Remove common wikitext markup, returning plain text."""
    if not text:
        return ""
    # Remove [[ ]] link syntax, keeping display text
    text = re.sub(r"\[\[[^|\]]*\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    # Remove {{ }} templates (simple single-level)
    text = re.sub(r"\{\{[^}]*\}\}", "", text)
    # Remove '' and ''' (bold/italic)
    text = re.sub(r"'{2,3}", "", text)
    # Remove <ref>...</ref> and <br/> etc.
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.DOTALL)
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def extract_section(wikitext: str, heading_pattern: str) -> str:
    """
    Extract the body of a section whose heading matches heading_pattern (regex).
    Returns text from after the heading to the next heading of equal or higher level.
    """
    # Match == Heading == style (level 2-4)
    pattern = rf"(={{2,4}})\s*{heading_pattern}\s*\1"
    m = re.search(pattern, wikitext, re.IGNORECASE)
    if not m:
        return ""
    level = len(m.group(1))
    start = m.end()
    # Find next heading of same or higher level
    next_heading = re.search(rf"(?:^|\n)(={{2,{level}}})\s*[^=]", wikitext[start:])
    if next_heading:
        end = start + next_heading.start()
    else:
        end = len(wikitext)
    return wikitext[start:end].strip()


def extract_infobox_field(wikitext: str, field_name: str) -> str:
    """Extract a field value from a Fandom infobox template."""
    # Match | field_name = value (possibly multiline until next | or }})
    end_pattern = r"\}\}"
    pattern = rf"\|\s*{re.escape(field_name)}\s*=\s*(.*?)(?=\n\s*\||$|{end_pattern})"
    m = re.search(pattern, wikitext, re.DOTALL)
    if m:
        return strip_wikimarkup(m.group(1).strip())
    return ""


# ── Skill-specific section names (Chinese & English variants) ───────────────

# We try multiple heading names because Fandom pages vary in structure.
SECTION_PATTERNS = {
    # Command cards / abilities
    "command_cards": [
        r"(?:Command\s*Cards?|指令卡|Skills?|技能|Abilities|能力)",
        r"(?:Cards?|卡牌)",
    ],
    # Rouse / awakening
    "rouse": [
        r"(?:Rouse|觉醒|灵知觉醒|Awakening)",
    ],
    # Exalt / ultimate
    "exalt": [
        r"(?:Exalt|狂气爆发|Ultimate|大招)",
    ],
    # Enlighten / passives
    "enlighten": [
        r"(?:Enlighten|启灵|Passives?|被动)",
    ],
    # Talent
    "talent": [
        r"(?:Talent|天赋|灵塑适性|Soulforge)",
    ],
}


def find_section(wikitext: str, patterns: List[str]) -> str:
    """Try multiple heading patterns and return the first matching section."""
    for pat in patterns:
        body = extract_section(wikitext, pat)
        if body:
            return body
    return ""


# ── Card / skill item parsing ───────────────────────────────────────────────

def parse_card_items(text: str) -> List[dict]:
    """
    Parse a section of wikitext into a list of card dicts.
    Looks for bold names, cost numbers, and effect descriptions.
    """
    cards = []
    # Strategy 1: look for list items or bold entries
    # Patterns like: * '''Card Name''' (Cost: N) - Effect text
    #                * Card Name — Effect text
    item_pattern = re.compile(
        r"(?:^|\n)\s*[\*#]\s*"                      # list marker
        r"(?:''')?([^':\n(]+?)(?:''')?"              # card name (possibly bold)
        r"(?:\s*[\(/（].*?(\d+).*?[\)/）])?"         # optional cost in parens
        r"(?:\s*[-–—:：]\s*)"                         # separator
        r"(.+?)(?=\n\s*[\*#]|\n\n|$)",               # effect text
        re.DOTALL,
    )
    for m in item_pattern.finditer(text):
        name = strip_wikimarkup(m.group(1)).strip()
        cost_str = m.group(2)
        effect = strip_wikimarkup(m.group(3)).strip()
        if not name or len(name) > 60:
            continue
        card: dict = {"name": name, "effect": effect}
        if cost_str:
            card["cost"] = int(cost_str)
        cards.append(card)

    # Strategy 2: if nothing found, try table rows (|| delimited or newline | delimited)
    if not cards:
        # Try || style first: | Name || Cost || Effect
        row_pattern = re.compile(
            r"(?:^|\n)\s*\|\s*(?:''')?([^|'\n]{2,40})(?:''')?\s*"  # name cell
            r"\|\|\s*(\d+)?\s*"                                      # cost cell
            r"\|\|\s*(.+?)(?=\n|$)",                                  # effect cell
        )
        for m in row_pattern.finditer(text):
            name = strip_wikimarkup(m.group(1)).strip()
            cost_str = m.group(2)
            effect = strip_wikimarkup(m.group(3)).strip()
            if not name or len(name) > 60 or not effect:
                continue
            if name.lower() in ("name", "名称", "card", "cost", "effect", "效果"):
                continue
            card: dict = {"name": name, "effect": effect}
            if cost_str:
                card["cost"] = int(cost_str)
            cards.append(card)

    # Strategy 2b: newline-delimited table rows (each cell on its own line)
    if not cards:
        row_pattern = re.compile(
            r"(?:^|\n)\s*\|\s*(?:''')?([^|'\n]{2,40})(?:''')?\s*\n"  # name cell
            r"\s*\|\s*(\d+)?\s*\n"                                     # cost cell
            r"\s*\|\s*(.+?)(?=\n\s*\|\-|\n\s*\|\}|$)",                # effect cell
            re.DOTALL,
        )
        for m in row_pattern.finditer(text):
            name = strip_wikimarkup(m.group(1)).strip()
            cost_str = m.group(2)
            effect = strip_wikimarkup(m.group(3)).strip()
            if not name or len(name) > 60 or not effect:
                continue
            if name.lower() in ("name", "名称", "card", "cost", "effect", "效果"):
                continue
            card: dict = {"name": name, "effect": effect}
            if cost_str:
                card["cost"] = int(cost_str)
            cards.append(card)

    # Strategy 3: plain bold entries separated by newlines
    if not cards:
        bold_pattern = re.compile(
            r"'''([^']{2,40})'''\s*[-–—:：]?\s*(.+?)(?=\n'''|\n\n|$)",
            re.DOTALL,
        )
        for m in bold_pattern.finditer(text):
            name = strip_wikimarkup(m.group(1)).strip()
            effect = strip_wikimarkup(m.group(2)).strip()
            if name and effect:
                cards.append({"name": name, "effect": effect})

    return cards


def parse_single_skill(text: str) -> Optional[dict]:
    """
    Parse a section that describes a single skill (rouse, exalt, talent).
    Returns a dict with name + effect, or None.
    """
    text = text.strip()
    if not text:
        return None

    name = ""
    effect = ""

    # Try to find a bold name
    bold_m = re.search(r"'''([^']{2,60})'''", text)
    if bold_m:
        name = strip_wikimarkup(bold_m.group(1)).strip()
        after = text[bold_m.end():]
        effect = strip_wikimarkup(re.sub(r"^\s*[-–—:：]\s*", "", after)).strip()
    else:
        # First line is name, rest is effect
        lines = [l.strip() for l in text.split("\n") if l.strip()]
        if lines:
            first = strip_wikimarkup(lines[0])
            # Remove list markers
            first = re.sub(r"^[\*#]+\s*", "", first)
            if len(first) < 60:
                name = first
                effect = strip_wikimarkup("\n".join(lines[1:]))
            else:
                effect = strip_wikimarkup(text)

    if not name and not effect:
        return None

    # Clean up effect - collapse whitespace
    effect = re.sub(r"\s+", " ", effect).strip()

    result: dict = {}
    if name:
        result["name"] = name
    if effect:
        result["effect"] = effect
    return result if result else None


def parse_enlighten_items(text: str) -> List[dict]:
    """
    Parse enlighten/passive entries which have levels.
    Looks for patterns like: Level 1 / 启灵1 / Enlighten 1 — Name — Effect
    """
    items = []

    # Pattern: level number followed by name and effect
    level_pattern = re.compile(
        r"(?:(?:level|lv\.?|启灵|enlighten)\s*(\d))"  # level number
        r"(?:\s*[-–—:：]\s*|\s+)"                       # separator
        r"(?:''')?([^'\n]{2,60})(?:''')?"               # name
        r"(?:\s*[-–—:：]\s*)"                            # separator
        r"(.+?)(?=\n.*?(?:level|lv|启灵|enlighten)\s*\d|$)",  # effect
        re.DOTALL | re.IGNORECASE,
    )
    for m in level_pattern.finditer(text):
        level = int(m.group(1))
        name = strip_wikimarkup(m.group(2)).strip()
        effect = strip_wikimarkup(m.group(3)).strip()
        effect = re.sub(r"\s+", " ", effect).strip()
        if name and effect:
            items.append({"level": level, "name": name, "effect": effect})

    # Fallback: numbered list items
    if not items:
        numbered_pattern = re.compile(
            r"(?:^|\n)\s*#\s*(?:''')?([^'\n]{2,60})(?:''')?"
            r"(?:\s*[-–—:：]\s*)"
            r"(.+?)(?=\n\s*#|\n\n|$)",
            re.DOTALL,
        )
        for i, m in enumerate(numbered_pattern.finditer(text), 1):
            name = strip_wikimarkup(m.group(1)).strip()
            effect = strip_wikimarkup(m.group(2)).strip()
            effect = re.sub(r"\s+", " ", effect).strip()
            if name and effect:
                items.append({"level": i, "name": name, "effect": effect})

    # Another fallback: plain list items treated as sequential levels
    if not items:
        card_items = parse_card_items(text)
        for i, card in enumerate(card_items, 1):
            item: dict = {"level": i, "name": card["name"], "effect": card["effect"]}
            items.append(item)

    return items


# ── Template-based extraction ───────────────────────────────────────────────

def extract_from_templates(wikitext: str) -> dict:
    """
    Try to extract skill data from infobox-style templates.
    Many Fandom pages use templates like {{Skill|name=...|cost=...|effect=...}}.
    """
    skills: dict = {}

    # Look for skill/ability templates
    template_pattern = re.compile(
        r"\{\{\s*(?:Skill|Ability|Card|技能|指令卡)\s*\|([^}]+)\}\}",
        re.IGNORECASE | re.DOTALL,
    )
    cards = []
    for m in template_pattern.finditer(wikitext):
        params = m.group(1)
        name = ""
        cost = None
        effect = ""
        name_en = ""

        for param in re.split(r"\|(?![^{]*\})", params):
            param = param.strip()
            kv = param.split("=", 1)
            if len(kv) == 2:
                key, val = kv[0].strip().lower(), strip_wikimarkup(kv[1].strip())
                if key in ("name", "名称", "名字"):
                    name = val
                elif key in ("name_en", "english", "en"):
                    name_en = val
                elif key in ("cost", "费用", "算力"):
                    try:
                        cost = int(val)
                    except ValueError:
                        pass
                elif key in ("effect", "效果", "description", "desc"):
                    effect = val

        if name:
            card: dict = {"name": name, "effect": effect}
            if name_en:
                card["name_en"] = name_en
            if cost is not None:
                card["cost"] = cost
            cards.append(card)

    if cards:
        skills["command_cards"] = cards

    # Look for Rouse/Exalt/Talent templates
    for skill_type, template_names in [
        ("rouse", ["Rouse", "觉醒", "Awakening"]),
        ("exalt", ["Exalt", "狂气爆发", "Ultimate"]),
        ("talent", ["Talent", "天赋", "Soulforge"]),
    ]:
        for tname in template_names:
            t_pattern = re.compile(
                rf"\{{\{{\s*{re.escape(tname)}\s*\|([^}}]+)\}}\}}",
                re.IGNORECASE | re.DOTALL,
            )
            tm = t_pattern.search(wikitext)
            if tm:
                params = tm.group(1)
                entry: dict = {}
                for param in re.split(r"\|(?![^{]*\})", params):
                    param = param.strip()
                    kv = param.split("=", 1)
                    if len(kv) == 2:
                        key = kv[0].strip().lower()
                        val = strip_wikimarkup(kv[1].strip())
                        if key in ("name", "名称"):
                            entry["name"] = val
                        elif key in ("name_en", "english", "en"):
                            entry["name_en"] = val
                        elif key in ("effect", "效果", "description"):
                            entry["effect"] = val
                if entry:
                    skills[skill_type] = entry
                break

    return skills


# ── Main extraction pipeline ────────────────────────────────────────────────

def extract_skills_from_wikitext(wikitext: str) -> dict:
    """
    Main entry point: extract all skill data from a character's wikitext.
    Tries template extraction first, then falls back to section-based parsing.
    """
    skills: dict = {}

    # Strategy 1: template-based extraction
    template_skills = extract_from_templates(wikitext)
    if template_skills:
        skills.update(template_skills)

    # Strategy 2: section-based extraction
    # Command cards
    if "command_cards" not in skills:
        section = find_section(wikitext, SECTION_PATTERNS["command_cards"])
        if section:
            cards = parse_card_items(section)
            if cards:
                skills["command_cards"] = cards

    # Rouse
    if "rouse" not in skills:
        section = find_section(wikitext, SECTION_PATTERNS["rouse"])
        if section:
            parsed = parse_single_skill(section)
            if parsed:
                skills["rouse"] = parsed

    # Exalt
    if "exalt" not in skills:
        section = find_section(wikitext, SECTION_PATTERNS["exalt"])
        if section:
            parsed = parse_single_skill(section)
            if parsed:
                skills["exalt"] = parsed

    # Enlighten
    if "enlighten" not in skills:
        section = find_section(wikitext, SECTION_PATTERNS["enlighten"])
        if section:
            items = parse_enlighten_items(section)
            if items:
                skills["enlighten"] = items

    # Talent
    if "talent" not in skills:
        section = find_section(wikitext, SECTION_PATTERNS["talent"])
        if section:
            parsed = parse_single_skill(section)
            if parsed:
                skills["talent"] = parsed

    # Strategy 3: scan the entire wikitext for tabber / tab-style skill blocks
    # Some pages use <tabber> tags with skill info
    if not skills:
        skills = extract_from_tabber(wikitext)

    # Strategy 4: try infobox fields as a last resort
    if not skills:
        for field, key in [
            ("skill1", "rouse"),
            ("skill2", "exalt"),
            ("talent", "talent"),
            ("passive", "talent"),
        ]:
            val = extract_infobox_field(wikitext, field)
            if val:
                skills[key] = {"effect": val}

    return skills


def extract_from_tabber(wikitext: str) -> dict:
    """
    Extract skills from <tabber> blocks used on some Fandom pages.
    Format: <tabber>Tab Name=content|-|Tab Name2=content</tabber>
    """
    skills: dict = {}
    tabber_match = re.search(
        r"<tabber>(.*?)</tabber>", wikitext, re.DOTALL | re.IGNORECASE
    )
    if not tabber_match:
        return skills

    content = tabber_match.group(1)
    tabs = re.split(r"\|-\|", content)

    for tab in tabs:
        parts = tab.split("=", 1)
        if len(parts) != 2:
            continue
        tab_name = parts[0].strip().lower()
        tab_body = parts[1].strip()

        if any(kw in tab_name for kw in ("command", "card", "指令", "卡", "skill", "技能", "abilities")):
            cards = parse_card_items(tab_body)
            if cards:
                skills["command_cards"] = cards
        elif any(kw in tab_name for kw in ("rouse", "觉醒", "awaken")):
            parsed = parse_single_skill(tab_body)
            if parsed:
                skills["rouse"] = parsed
        elif any(kw in tab_name for kw in ("exalt", "狂气", "ultimate", "大招")):
            parsed = parse_single_skill(tab_body)
            if parsed:
                skills["exalt"] = parsed
        elif any(kw in tab_name for kw in ("enlighten", "启灵", "passive")):
            items = parse_enlighten_items(tab_body)
            if items:
                skills["enlighten"] = items
        elif any(kw in tab_name for kw in ("talent", "天赋", "soulforge")):
            parsed = parse_single_skill(tab_body)
            if parsed:
                skills["talent"] = parsed

    return skills


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    dry_run = "--dry-run" in sys.argv

    # Load characters
    with open(CHARACTERS_JSON) as f:
        data = json.load(f)

    # Find characters without skills
    targets = []
    for char in data["characters"]:
        if "skills" not in char:
            char_id = char["id"]
            if char_id in PAGE_MAP:
                targets.append((char_id, PAGE_MAP[char_id], char))
            else:
                print(f"[SKIP] {char_id}: no page mapping")

    print(f"=== Fetching skills for {len(targets)} characters ===\n")

    updated = 0
    failed = 0

    for i, (char_id, page_title, char_obj) in enumerate(targets, 1):
        print(f"[{i}/{len(targets)}] {char_id} -> {page_title}")

        wikitext = fetch_wikitext(page_title)
        if not wikitext:
            print(f"  [WARN] No wikitext returned, skipping")
            failed += 1
            time.sleep(0.5)
            continue

        try:
            skills = extract_skills_from_wikitext(wikitext)
        except Exception as e:
            print(f"  [WARN] Parsing failed: {e}, skipping")
            failed += 1
            time.sleep(0.5)
            continue

        if not skills:
            print(f"  [WARN] No skills extracted from wikitext")
            failed += 1
        else:
            skill_keys = list(skills.keys())
            print(f"  OK: extracted {skill_keys}")
            if dry_run:
                print(f"  (dry-run) {json.dumps(skills, ensure_ascii=False)[:200]}")
            else:
                char_obj["skills"] = skills
            updated += 1

        time.sleep(0.5)  # Rate limiting

    print(f"\n=== Results: {updated} extracted, {failed} failed ===\n")

    if not dry_run and updated > 0:
        with open(CHARACTERS_JSON, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"Updated {updated} characters in {CHARACTERS_JSON}")
    elif dry_run:
        print("(dry-run mode, no files written)")


if __name__ == "__main__":
    main()
