#!/usr/bin/env python3
"""
Fetch character voice lines from Fandom wiki and update voice_lines.json.

Usage:
  python3 fetch_voice_lines.py              # fetch and update
  python3 fetch_voice_lines.py --dry-run    # print results only

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
VOICE_JSON = SCRIPT_DIR.parent / "data" / "db" / "voice_lines.json"

UA = "Mozilla/5.0 (compatible; MorimensWikiBot/1.0; +https://github.com/lightproud/brain-in-a-vat)"

FANDOM_WIKIS = [
    "https://forget-last-night-morimens.fandom.com",
    "https://morimens.fandom.com",
]

# Character ID -> Fandom voice/quote page title
VOICE_PAGE_MAP = {
    "tulu": "Tulu/Voice",
    "doll": "Doll/Voice",
    "ramona": "Ramona/Voice",
    "alva": "Alva/Voice",
    "lily": "Lily/Voice",
    "24": "24_(character)/Voice",
    "miryam": "Miryam/Voice",
    "tawil": "Tawil/Voice",
    "celeste": "Celeste/Voice",
    "liz": "Liz/Voice",
}

TRIGGER_MAP = {
    "login": ["login", "登录", "ログイン"],
    "idle": ["idle", "闲置", "待機", "standby"],
    "battle_start": ["battle start", "战斗开始", "戦闘開始"],
    "skill": ["skill", "技能", "スキル", "attack"],
    "rouse": ["rouse", "觉醒", "覚醒", "awakening"],
    "victory": ["victory", "胜利", "勝利", "win"],
    "defeat": ["defeat", "阵亡", "撃破", "death", "ko"],
    "affection_1": ["affection", "好感度", "好感度1", "bond"],
    "affection_2": ["affection 2", "好感度2", "bond 2"],
}


def api_get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def fetch_voice_page(wiki_base: str, page_title: str) -> str | None:
    """Fetch wikitext of a voice line page."""
    params = urllib.parse.urlencode({
        "action": "parse",
        "page": page_title,
        "prop": "wikitext",
        "format": "json",
    })
    try:
        data = api_get(f"{wiki_base}/api.php?{params}")
        return data.get("parse", {}).get("wikitext", {}).get("*", "")
    except Exception as e:
        print(f"  [WARN] {e}")
        return None


def classify_trigger(text: str) -> str | None:
    text_lower = text.lower().strip()
    for trigger_id, keywords in TRIGGER_MAP.items():
        for kw in keywords:
            if kw.lower() in text_lower:
                return trigger_id
    return None


def parse_voice_lines(wikitext: str) -> list[dict]:
    """Parse voice lines from wikitext. Returns list of {trigger, text}."""
    lines = []
    current_trigger = None

    for line in wikitext.split("\n"):
        line = line.strip()
        # Section header
        header_match = re.match(r"={2,4}\s*(.+?)\s*={2,4}", line)
        if header_match:
            trigger = classify_trigger(header_match.group(1))
            if trigger:
                current_trigger = trigger
            continue

        # Table row or quote
        if current_trigger and line and not line.startswith("{{") and not line.startswith("|-"):
            # Clean wikitext markup
            text = re.sub(r"\[\[.*?\|(.*?)\]\]", r"\1", line)
            text = re.sub(r"\[\[(.*?)\]\]", r"\1", text)
            text = re.sub(r"'''?", "", text)
            text = re.sub(r"<.*?>", "", text)
            text = text.strip("|").strip()
            if len(text) > 5 and not text.startswith("!"):
                lines.append({"trigger": current_trigger, "text": text})
                current_trigger = None

    return lines


def main():
    dry_run = "--dry-run" in sys.argv

    with open(VOICE_JSON) as f:
        voice_data = json.load(f)

    char_map = {c["id"]: c for c in voice_data["characters"]}
    total = len(VOICE_PAGE_MAP)
    updated = 0

    print("=== Fetching character voice lines ===\n")

    for i, (char_id, page_title) in enumerate(VOICE_PAGE_MAP.items(), 1):
        print(f"[{i}/{total}] {char_id} -> {page_title}")

        for wiki_base in FANDOM_WIKIS:
            wikitext = fetch_voice_page(wiki_base, page_title)
            if not wikitext:
                continue

            parsed = parse_voice_lines(wikitext)
            if not parsed:
                # Try main page with /Quotes suffix
                alt_title = page_title.replace("/Voice", "/Quotes")
                wikitext = fetch_voice_page(wiki_base, alt_title)
                if wikitext:
                    parsed = parse_voice_lines(wikitext)

            if parsed:
                print(f"  ✓ Found {len(parsed)} voice lines")
                if char_id in char_map:
                    for p in parsed:
                        for line in char_map[char_id]["lines"]:
                            if line["trigger"] == p["trigger"] and line["text_source"] == "placeholder":
                                line["text_en"] = p["text"]
                                line["text_source"] = "wiki"
                                updated += 1
                break
            else:
                print(f"  No voice lines parsed from {wiki_base}")

        time.sleep(0.5)

    print(f"\n=== Updated {updated} voice lines ===\n")

    if dry_run:
        return

    with open(VOICE_JSON, "w") as f:
        json.dump(voice_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Saved to {VOICE_JSON}")


if __name__ == "__main__":
    main()
