#!/usr/bin/env python3
"""Build a banner <-> character cross-index for Morimens summon banners.

Reads:
    projects/wiki/data/processed/summon.json   (raw extraction, 366 banners)
    projects/wiki/data/db/characters.json      (curated awakener roster, 24+ records)

Writes:
    projects/wiki/data/processed/banners_by_character.json
        Shape: {
            "_meta": {...},
            "banners_by_character": { "<character_id>": [banner_id, ...] },
            "characters_by_banner": { "<banner_id>": [character_id, ...] },
            "unmatched_rate_up_terms": ["..."]
        }

Strategy:
    Each banner has a free-text "rate_up" / "title" / "name" field listing the
    rate-up character names in Chinese. We match against the canonical
    character roster by name_zh (primary) and slug (secondary). Any term that
    fails to match goes into unmatched_rate_up_terms for human review.

Usage:
    python projects/wiki/scripts/build_banner_character_index.py
    python projects/wiki/scripts/build_banner_character_index.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent / "data"
DB_DIR = DATA_DIR / "db"
PROCESSED_DIR = DATA_DIR / "processed"

# Source of truth (2026-06-14): retired the hand-curated db/characters.json (24
# stubs) in favour of client-unpacked data/processed/characters.json (72 real
# awakeners). processed is a flat schema, normalised below into name_zh/slug.
CHARACTERS_JSON = PROCESSED_DIR / "characters.json"
SUMMON_JSON = PROCESSED_DIR / "summon.json"
OUTPUT_PATH = PROCESSED_DIR / "banners_by_character.json"

# Curated english slugs preserved from the retired db/characters.json (keyed by
# id). Keep in sync with docs/.vitepress/theme/data/characters.ts (SLUG_MAP).
SLUG_MAP: dict[str, str] = {
    "15560": "pandia", "15561": "source_tincture", "15562": "lizz", "15563": "tulu",
    "15564": "goliath", "15565": "notilia", "15566": "celeste", "15567": "bloodchain_hilo",
    "15568": "cycle_ramona", "15569": "rotan", "15570": "dole", "15571": "garen",
    "15572": "cassia", "15573": "orita", "15574": "tincture", "15575": "faros",
    "15576": "murphy", "15577": "faint", "15578": "jenkin", "15579": "winkle",
    "15580": "nymphia", "15581": "lily", "15582": "miriam", "15593": "jenkin_duplicate_15593",
}


def load_characters() -> list[dict]:
    if not CHARACTERS_JSON.exists():
        print(f"  [ERROR] {CHARACTERS_JSON} not found")
        sys.exit(2)
    with open(CHARACTERS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    rows = data if isinstance(data, list) else data.get("characters", [])
    out: list[dict] = []
    for c in rows:
        if "name_zh" in c or "slug" in c:  # legacy db shape passes through
            out.append(c)
            continue
        cid = str(c.get("id"))
        out.append({
            **c,
            "id": cid,
            "name_zh": c.get("name"),
            "title_zh": c.get("title") or c.get("name"),
            "slug": SLUG_MAP.get(cid, f"awk-{cid}"),
        })
    return out


def load_banners() -> list[dict]:
    if not SUMMON_JSON.exists():
        print(f"  [ERROR] {SUMMON_JSON} not found")
        sys.exit(2)
    with open(SUMMON_JSON, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("banners", [])


def build_name_to_id(characters: list[dict]) -> dict[str, str]:
    """Map every plausible string handle (name_zh, title_zh, slug, name_en) -> character.id."""
    mapping: dict[str, str] = {}
    for char in characters:
        cid = str(char.get("id"))
        for key in ("name_zh", "title_zh", "slug", "name_en", "name_ja"):
            value = char.get(key)
            if value and isinstance(value, str):
                mapping[value.strip()] = cid
                # Also accept normalized forms
                stripped = value.strip().replace(" ", "")
                if stripped and stripped not in mapping:
                    mapping[stripped] = cid
    return mapping


# Heuristic field weights — banner text fields most likely to contain a name
NAME_FIELDS = ("rate_up", "title", "name", "short_desc", "desc")


def extract_terms(banner: dict) -> list[str]:
    """Return candidate name terms found in any banner text field."""
    terms: list[str] = []
    for f in NAME_FIELDS:
        v = banner.get(f)
        if isinstance(v, str) and v.strip():
            # Split on common separators; the source data uses spaces, /, ,, +, ·, 、
            parts = re.split(r"[\s/,，+·、\\|]+", v)
            terms.extend(p.strip() for p in parts if p.strip())
    return terms


def match_banner(banner: dict, name_index: dict[str, str]) -> tuple[set[str], set[str]]:
    """Return (matched_character_ids, unmatched_terms_seen) for one banner."""
    terms = extract_terms(banner)
    matched: set[str] = set()
    unmatched: set[str] = set()
    for term in terms:
        if term in name_index:
            matched.add(name_index[term])
        else:
            # Try substring matching against canonical names (handles 「玛修·基列莱特」inside a sentence)
            substring_hit = False
            for name, cid in name_index.items():
                if len(name) >= 2 and name in term:
                    matched.add(cid)
                    substring_hit = True
                    break
            if not substring_hit and len(term) >= 2:
                unmatched.add(term)
    return matched, unmatched


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print summary without writing")
    parser.add_argument("--show-unmatched", action="store_true", help="Print first 50 unmatched terms")
    args = parser.parse_args()

    characters = load_characters()
    banners = load_banners()
    name_index = build_name_to_id(characters)

    banners_by_character: dict[str, set[int]] = defaultdict(set)
    characters_by_banner: dict[int, set[str]] = defaultdict(set)
    unmatched_terms: set[str] = set()

    for banner in banners:
        bid = banner.get("id")
        if bid is None:
            continue
        matched, unmatched = match_banner(banner, name_index)
        for cid in matched:
            banners_by_character[cid].add(int(bid))
            characters_by_banner[int(bid)].add(cid)
        unmatched_terms.update(unmatched)

    matched_banner_count = len(characters_by_banner)
    matched_char_count = len(banners_by_character)

    print(f"  characters loaded : {len(characters)}")
    print(f"  banners loaded    : {len(banners)}")
    print(f"  banners matched   : {matched_banner_count}")
    print(f"  characters seen   : {matched_char_count}")
    print(f"  unmatched terms   : {len(unmatched_terms)} (review these for missing aliases)")
    if args.show_unmatched:
        sample = sorted(unmatched_terms)[:50]
        for term in sample:
            print(f"    - {term}")

    out = {
        "_meta": {
            "source_characters": str(CHARACTERS_JSON.relative_to(SCRIPT_DIR.parent)),
            "source_banners": str(SUMMON_JSON.relative_to(SCRIPT_DIR.parent)),
            "characters_loaded": len(characters),
            "banners_loaded": len(banners),
            "banners_matched": matched_banner_count,
            "characters_matched": matched_char_count,
            "unmatched_term_count": len(unmatched_terms),
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "banners_by_character": {
            cid: sorted(bset) for cid, bset in sorted(banners_by_character.items())
        },
        "characters_by_banner": {
            str(bid): sorted(cset) for bid, cset in sorted(characters_by_banner.items())
        },
        "unmatched_rate_up_terms": sorted(unmatched_terms),
    }

    print(f"  output            : {OUTPUT_PATH.relative_to(SCRIPT_DIR.parent)}")

    if args.dry_run:
        print("  (dry-run: no file written)")
        return 0

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"  wrote             : {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
