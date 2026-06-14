#!/usr/bin/env python3
"""
Auto-generate VitePress character detail pages from characters.json + equipment.json.

Source of truth: projects/wiki/data/db/ (DATA_DIR below).
Driven by: .github/workflows/fetch-wiki-data.yml (step "generate_pages",
runs with working-directory projects/wiki, i.e. `python3 scripts/generate_pages.py`).

Distinct from scripts/generate_wiki_pages.py (top-level), which generates the
encyclopedia/voice/media pages from data/processed/ and is driven by
deploy-site.yml. The two generators write different page sets from different
sources; keep their source dirs (db/ here vs processed/ there) in sync (ARCH-05).

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
from pathlib import Path
from typing import Any

import yaml

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent                       # projects/wiki
DATA_DIR = PROJECT_ROOT / "data" / "db"
DOCS_DIR = PROJECT_ROOT / "docs"

# Source of truth (2026-06-14): the hand-curated db/characters.json (24 stubs)
# was retired in favour of client-unpacked data/processed/characters.json (72
# real awakeners, AwakerConfig.lua runtime extraction). processed is a flat
# schema, so load_characters() normalises it into the keys used below.
CHARACTERS_JSON = PROJECT_ROOT / "data" / "processed" / "characters.json"
EQUIPMENT_JSON = DATA_DIR / "equipment.json"

# Curated english slugs preserved from the retired db/characters.json (keyed by
# id) so existing detail-page URLs and portrait filenames stay stable; the
# remaining ids fall back to a deterministic `awk-<id>`. Keep in sync with
# docs/.vitepress/theme/data/characters.ts (SLUG_MAP).
SLUG_MAP: dict[str, str] = {
    "15560": "pandia", "15561": "source_tincture", "15562": "lizz", "15563": "tulu",
    "15564": "goliath", "15565": "notilia", "15566": "celeste", "15567": "bloodchain_hilo",
    "15568": "cycle_ramona", "15569": "rotan", "15570": "dole", "15571": "garen",
    "15572": "cassia", "15573": "orita", "15574": "tincture", "15575": "faros",
    "15576": "murphy", "15577": "faint", "15578": "jenkin", "15579": "winkle",
    "15580": "nymphia", "15581": "lily", "15582": "miriam", "15593": "jenkin_duplicate_15593",
}
# Confirmed public realm/role facts not carried by the unpacked source.
REALM_OVERRIDES: dict[str, str] = {"15560": "caro"}
ROLE_OVERRIDES: dict[str, str] = {"15560": "attack"}

# ---------------------------------------------------------------------------
# i18n labels (only needed for SEO title/description)
# ---------------------------------------------------------------------------
LABELS: dict[str, dict[str, str]] = {
    "zh": {"title_suffix": "忘却前夜 Wiki"},
    "en": {"title_suffix": "Morimens Wiki"},
    "ja": {"title_suffix": "忘却前夜 Wiki"},
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

def _normalise(char: dict[str, Any]) -> dict[str, Any]:
    """Normalise a record into the keys this generator consumes.

    The unpacked source (processed/characters.json) is a flat schema
    (id:int, name, title, ...) with no slug/realm/role; map it onto the
    db-style keys (id:str, name_zh, slug, realm, role). Records that already
    carry db-style keys (legacy) pass through unchanged.
    """
    if "name_zh" in char or "slug" in char:
        return char
    cid = str(char.get("id"))
    return {
        **char,
        "id": cid,
        "name_zh": char.get("name"),
        "title_zh": char.get("title") or char.get("name"),
        "slug": SLUG_MAP.get(cid, f"awk-{cid}"),
        "realm": REALM_OVERRIDES.get(cid),
        "role": ROLE_OVERRIDES.get(cid),
    }


def load_characters() -> list[dict[str, Any]]:
    """Load characters; handles the unpacked processed shape
    ({_meta, characters:[...]}), a top-level array, and the legacy
    dict-with-characters-key shape."""
    with open(CHARACTERS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        chars = data
    else:
        chars = list(data.get("characters", []))
        chars.extend(data.get("sr_characters", []))
    return [_normalise(c) for c in chars]


# ---------------------------------------------------------------------------
# Markdown generation — now minimal: frontmatter + CharacterSheet component
# ---------------------------------------------------------------------------

def generate_character_page(char: dict, lang: str) -> str:
    """Generate minimal markdown with frontmatter + CharacterSheet Vue component.

    Pages are routed by slug (SEO-friendly) and the Vue component is bound by
    characterId so links remain stable even if a slug changes.
    """
    L = LABELS[lang]
    cid = char["id"]
    slug = char.get("slug") or cid
    # Current data shape uses name_zh; legacy uses name. Support both.
    name = char.get("name_zh") or char.get("name") or slug
    # Null fields are omitted from output rather than filled with defaults,
    # so stub characters don't get fabricated realm/role/name_en text.
    name_en = char.get("name_en")
    realm_key = char.get("realm")
    role_key = char.get("role")

    realm_display = REALM_NAMES[lang].get(realm_key, realm_key) if realm_key else None
    role_display = ROLE_NAMES[lang].get(role_key, role_key) if role_key else None

    # SEO metadata
    if lang == "en":
        subject = name_en or name
        desc_text = f"Full profile of {subject}"
        if name_en:
            desc_text += f" ({name})"
        attrs = " ".join(p for p in (realm_display, role_display) if p)
        if attrs:
            desc_text += f", a {attrs}"
        desc_text += " in Morimens"
    else:
        desc_text = name
        if name_en:
            desc_text += f"（{name_en}）"
        if realm_display:
            desc_text += f"{realm_display}属性"
        if role_display:
            desc_text += role_display
        desc_text += "角色详细资料" if lang == "zh" else "キャラクター詳細"
    title_name = (name_en or name) if lang == "en" else name
    title_val = f"{title_name} | {L['title_suffix']}"

    frontmatter = {
        "title": title_val,
        "description": desc_text,
        "portrait": f"/portraits/{slug}.png",
        "pageClass": "character-page",
    }
    fm_block = yaml.safe_dump(
        frontmatter, allow_unicode=True, default_flow_style=False, sort_keys=False
    )

    return f"---\n{fm_block}---\n\n<CharacterSheet characterId=\"{cid}\" />\n"


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
    parser.add_argument(
        "--only",
        action="append",
        default=None,
        help="Restrict generation to specific character ids or slugs (repeatable)",
    )
    args = parser.parse_args()

    # Keeper ruling 2026-06-09: en/ja publication paused until localized
    # names land in characters.json (23/24 name_en/name_ja are null).
    langs = ["zh"] if args.lang == "all" else [args.lang]

    # Load data
    characters = load_characters()

    if args.only:
        keys = set(args.only)
        characters = [c for c in characters if c.get("id") in keys or c.get("slug") in keys]
        if not characters:
            print(f"  no characters matched --only filter: {sorted(keys)}")
            return

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
            slug = char.get("slug") or cid
            page_path = out_dir / f"{slug}.md"
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
