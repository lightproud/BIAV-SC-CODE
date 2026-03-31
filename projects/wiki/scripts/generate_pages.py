#!/usr/bin/env python3
"""
Auto-generate VitePress character detail pages from characters.json + equipment.json.

Usage:
    python generate_pages.py                  # generate all langs
    python generate_pages.py --lang zh        # Chinese only
    python generate_pages.py --lang en        # English only
    python generate_pages.py --lang ja        # Japanese only
    python generate_pages.py --dry-run        # preview without writing
    python generate_pages.py --dry-run --lang zh
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent                       # projects/wiki
DATA_DIR = PROJECT_ROOT / "data" / "db"
DOCS_DIR = PROJECT_ROOT / "docs"

CHARACTERS_JSON = DATA_DIR / "characters.json"
EQUIPMENT_JSON = DATA_DIR / "equipment.json"

# ---------------------------------------------------------------------------
# i18n labels (only needed for SEO title/description)
# ---------------------------------------------------------------------------
LABELS: dict[str, dict[str, str]] = {
    "zh": {
        "title_suffix": "忘却前夜 Wiki",
        "description_tpl": "{name}（{name_en}）{realm}属性{role}角色详细资料",
    },
    "en": {
        "title_suffix": "Morimens Wiki",
        "description_tpl": "Full profile of {name_en} ({name}), a {realm} {role} in Morimens",
    },
    "ja": {
        "title_suffix": "忘却前夜 Wiki",
        "description_tpl": "{name}（{name_en}）{realm}属性{role}キャラクター詳細",
    },
}

REALM_NAMES: dict[str, dict[str, str]] = {
    "zh": {"chaos": "混沌", "aequor": "深海", "caro": "血肉", "ultra": "超维"},
    "en": {"chaos": "Chaos", "aequor": "Aequor", "caro": "Caro", "ultra": "Ultra"},
    "ja": {"chaos": "混沌", "aequor": "深海", "caro": "血肉", "ultra": "超次元"},
}

ROLE_NAMES: dict[str, dict[str, str]] = {
    "zh": {
        "attack": "输出", "sub_attack": "副输出", "support": "辅助",
        "defense": "防御", "healer": "治疗", "chorus": "合唱", "dps": "输出",
    },
    "en": {
        "attack": "Attack", "sub_attack": "Sub-Attack", "support": "Support",
        "defense": "Defense", "healer": "Healer", "chorus": "Chorus", "dps": "DPS",
    },
    "ja": {
        "attack": "攻撃型", "sub_attack": "副攻撃型", "support": "支援型",
        "defense": "防御型", "healer": "回復型", "chorus": "合唱型", "dps": "攻撃型",
    },
}


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_characters() -> list[dict[str, Any]]:
    with open(CHARACTERS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    chars = list(data.get("characters", []))
    chars.extend(data.get("sr_characters", []))
    return chars


# ---------------------------------------------------------------------------
# Markdown generation — now minimal: frontmatter + CharacterSheet component
# ---------------------------------------------------------------------------

def generate_character_page(char: dict, lang: str) -> str:
    """Generate minimal markdown with frontmatter + CharacterSheet Vue component."""
    L = LABELS[lang]
    cid = char["id"]
    name = char["name"]
    name_en = char.get("name_en", name)
    realm_key = char.get("realm", "chaos")
    role_key = char.get("role", "attack")

    realm_display = REALM_NAMES[lang].get(realm_key, realm_key)
    role_display = ROLE_NAMES[lang].get(role_key, role_key)

    # SEO metadata
    desc_text = L["description_tpl"].format(
        name=name, name_en=name_en, realm=realm_display, role=role_display
    )
    title_name = name_en if lang == "en" else name
    title_val = f"{title_name} | {L['title_suffix']}"

    # Quote YAML values containing colons
    if ':' in title_val:
        title_val = f'"{title_val}"'
    if ':' in desc_text:
        desc_text = f'"{desc_text}"'

    return f"""---
title: {title_val}
description: {desc_text}
portrait: /portraits/{cid}.png
pageClass: character-page
---

<CharacterSheet characterId="{cid}" />
"""


# ---------------------------------------------------------------------------
# List page update
# ---------------------------------------------------------------------------

def update_list_page(characters: list[dict], lang: str, dry_run: bool) -> str | None:
    """Append <CharacterGrid /> component to list page if not already present."""
    list_path = DOCS_DIR / lang / "awakeners" / "list.md"
    if not list_path.exists():
        return None

    content = list_path.read_text(encoding="utf-8")
    if "<CharacterGrid" in content:
        return None  # already has it

    new_content = content.rstrip() + "\n\n<CharacterGrid />\n"
    if not dry_run:
        list_path.write_text(new_content, encoding="utf-8")
    return str(list_path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate VitePress character detail pages")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing files")
    parser.add_argument(
        "--lang",
        choices=["zh", "en", "ja", "all"],
        default="all",
        help="Language to generate (default: all)",
    )
    args = parser.parse_args()

    langs = ["zh", "en", "ja"] if args.lang == "all" else [args.lang]

    # Load data
    characters = load_characters()

    print(f"Loaded {len(characters)} characters")
    print(f"Languages: {', '.join(langs)}")
    print(f"Dry run: {args.dry_run}")
    print()

    generated = 0
    updated_lists: list[str] = []

    for lang in langs:
        out_dir = DOCS_DIR / lang / "awakeners"
        if not args.dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)

        for char in characters:
            cid = char["id"]
            page_path = out_dir / f"{cid}.md"
            content = generate_character_page(char, lang)

            if args.dry_run:
                print(f"  [DRY-RUN] {page_path.relative_to(PROJECT_ROOT)}")
                generated += 1
            else:
                page_path.write_text(content, encoding="utf-8")
                generated += 1

        # Update list page
        result = update_list_page(characters, lang, args.dry_run)
        if result:
            updated_lists.append(result)

    # Summary
    print()
    print("=" * 60)
    print(f"  Generated: {generated} character pages")
    print(f"  Languages: {', '.join(langs)}")
    print(f"  Characters: {len(characters)}")
    if updated_lists:
        print(f"  Updated list pages: {len(updated_lists)}")
        for p in updated_lists:
            print(f"    - {p}")
    if args.dry_run:
        print("  (dry-run mode — no files written)")
    print("=" * 60)


if __name__ == "__main__":
    main()
