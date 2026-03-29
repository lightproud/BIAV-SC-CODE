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
# i18n labels
# ---------------------------------------------------------------------------
LABELS: dict[str, dict[str, str]] = {
    "zh": {
        "title_suffix": "忘却前夜 Wiki",
        "rarity": "稀有度",
        "realm": "界域",
        "role": "职能",
        "limited": "限定",
        "obtain": "获取",
        "yes": "是",
        "no": "否",
        "attr": "属性",
        "value": "值",
        "intro": "简介",
        "skills": "技能",
        "command_cards": "指令卡",
        "rouse": "觉醒卡",
        "exalt": "狂气爆发",
        "overexalt": "超限爆发",
        "enlighten": "启灵",
        "talent": "天赋",
        "recommended_equipment": "推荐装备",
        "signature_wheel": "专属命轮",
        "recommended_wheel": "推荐命轮",
        "pending": "数据待补充",
        "card_name": "卡名",
        "cost": "费用",
        "effect": "效果",
        "level": "等级",
        "note": "备注",
        "description_tpl": "{name}（{name_en}）{realm}属性{role}角色详细资料",
    },
    "en": {
        "title_suffix": "Morimens Wiki",
        "rarity": "Rarity",
        "realm": "Realm",
        "role": "Role",
        "limited": "Limited",
        "obtain": "Availability",
        "yes": "Yes",
        "no": "No",
        "attr": "Attribute",
        "value": "Value",
        "intro": "Introduction",
        "skills": "Skills",
        "command_cards": "Command Cards",
        "rouse": "Rouse (Awakening)",
        "exalt": "Exalt",
        "overexalt": "Over-Exalt",
        "enlighten": "Enlighten",
        "talent": "Talent",
        "recommended_equipment": "Recommended Equipment",
        "signature_wheel": "Signature Wheel",
        "recommended_wheel": "Recommended Wheel",
        "pending": "Data pending",
        "card_name": "Card",
        "cost": "Cost",
        "effect": "Effect",
        "level": "Level",
        "note": "Note",
        "description_tpl": "Full profile of {name_en} ({name}), a {realm} {role} in Morimens",
    },
    "ja": {
        "title_suffix": "忘却前夜 Wiki",
        "rarity": "レアリティ",
        "realm": "界域",
        "role": "役割",
        "limited": "限定",
        "obtain": "入手方法",
        "yes": "はい",
        "no": "いいえ",
        "attr": "属性",
        "value": "値",
        "intro": "紹介",
        "skills": "スキル",
        "command_cards": "指令カード",
        "rouse": "覚醒カード",
        "exalt": "狂気爆発",
        "overexalt": "超限爆発",
        "enlighten": "啓霊",
        "talent": "天賦",
        "recommended_equipment": "推奨装備",
        "signature_wheel": "専用命輪",
        "recommended_wheel": "推奨命輪",
        "pending": "データ準備中",
        "card_name": "カード名",
        "cost": "コスト",
        "effect": "効果",
        "level": "レベル",
        "note": "備考",
        "description_tpl": "{name}（{name_en}）{realm}属性{role}キャラクター詳細",
    },
}

REALM_NAMES: dict[str, dict[str, str]] = {
    "zh": {"chaos": "混沌", "aequor": "深海", "caro": "血肉", "ultra": "超维"},
    "en": {"chaos": "Chaos", "aequor": "Aequor", "caro": "Caro", "ultra": "Ultra"},
    "ja": {"chaos": "混沌", "aequor": "深海", "caro": "血肉", "ultra": "超次元"},
}

REALM_CSS: dict[str, str] = {
    "chaos": "realm-chaos",
    "aequor": "realm-aequor",
    "caro": "realm-caro",
    "ultra": "realm-ultra",
}

ROLE_NAMES: dict[str, dict[str, str]] = {
    "zh": {
        "attack": "输出",
        "sub_attack": "副输出",
        "support": "辅助",
        "defense": "防御",
        "healer": "治疗",
        "chorus": "合唱",
        "dps": "输出",
    },
    "en": {
        "attack": "Attack",
        "sub_attack": "Sub-Attack",
        "support": "Support",
        "defense": "Defense",
        "healer": "Healer",
        "chorus": "Chorus",
        "dps": "DPS",
    },
    "ja": {
        "attack": "攻撃型",
        "sub_attack": "副攻撃型",
        "support": "支援型",
        "defense": "防御型",
        "healer": "回復型",
        "chorus": "合唱型",
        "dps": "攻撃型",
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


def load_equipment() -> dict[str, Any]:
    with open(EQUIPMENT_JSON, encoding="utf-8") as f:
        return json.load(f)


def build_wheel_index(equip_data: dict[str, Any]) -> dict[str, list[dict]]:
    """Build a mapping from character name -> list of wheels."""
    index: dict[str, list[dict]] = {}
    wheels = equip_data.get("wheels_of_destiny", {})
    for category_key, wheel_list in wheels.items():
        if not isinstance(wheel_list, list):
            continue
        for wheel in wheel_list:
            if not isinstance(wheel, dict):
                continue
            char_field = wheel.get("character")
            if char_field:
                # character field like "希莱斯特(Celeste)" — extract the Chinese name
                cn_name = char_field.split("(")[0].strip()
                index.setdefault(cn_name, []).append(wheel)
            # Also check recommended list
            for rec_name in wheel.get("recommended", []):
                index.setdefault(rec_name, []).append(wheel)
    return index


# ---------------------------------------------------------------------------
# Markdown generation
# ---------------------------------------------------------------------------

def _esc(text: Any) -> str:
    """Ensure we have a string and lightly escape pipe chars for tables."""
    if text is None:
        return ""
    return str(text).replace("|", "\\|")


def render_command_cards(skills: dict, lang: str) -> str:
    L = LABELS[lang]
    cards = skills.get("command_cards")
    if not cards:
        note = skills.get("command_cards_note", "")
        if note:
            return f"### {L['command_cards']}\n\n{note}\n"
        return f"### {L['command_cards']}\n\n{L['pending']}\n"

    lines = [
        f"### {L['command_cards']}",
        "",
        f"| {L['card_name']} | {L['cost']} | {L['effect']} |",
        "|------|------|------|",
    ]
    for card in cards:
        name = card.get("name_en", card.get("name", "")) if lang == "en" else card.get("name", "")
        cost = _esc(card.get("cost", "—"))
        effect = _esc(card.get("effect", ""))
        note = card.get("note", "")
        cell = effect
        if note:
            cell += f" ({_esc(note)})"
        lines.append(f"| {_esc(name)} | {cost} | {cell} |")

        # Handle upgrades
        for upg in card.get("upgrades", []):
            uname = _esc(upg.get("name", ""))
            ueffect = _esc(upg.get("effect", ""))
            lines.append(f"| ↳ {uname} | — | {ueffect} |")

    note = skills.get("command_cards_note", "")
    if note:
        lines.extend(["", f"::: tip\n{note}\n:::"])
    lines.append("")
    return "\n".join(lines) + "\n"


def render_rouse(skills: dict, lang: str) -> str:
    L = LABELS[lang]
    rouse = skills.get("rouse")
    if not rouse:
        return f"### {L['rouse']}\n\n{L['pending']}\n"

    name = rouse.get("name_en", rouse.get("name", "")) if lang == "en" else rouse.get("name", "")
    effect = rouse.get("effect", L["pending"])
    lines = [f"### {L['rouse']}", "", f"**{name}**", "", effect, ""]
    return "\n".join(lines) + "\n"


def render_exalt(skills: dict, lang: str) -> str:
    L = LABELS[lang]
    exalt = skills.get("exalt")
    if not exalt:
        return f"### {L['exalt']}\n\n{L['pending']}\n"

    name = exalt.get("name_en", exalt.get("name", "")) if lang == "en" else exalt.get("name", "")
    effect = exalt.get("effect", L["pending"])
    lines = [f"### {L['exalt']}", "", f"**{name}**", "", effect]
    scaling = exalt.get("scaling", "")
    if scaling:
        lines.extend(["", f"*{scaling}*"])
    note = exalt.get("note", "")
    if note:
        lines.extend(["", f"::: tip\n{note}\n:::"])
    lines.append("")
    return "\n".join(lines) + "\n"


def render_overexalt(skills: dict, lang: str) -> str:
    L = LABELS[lang]
    oe = skills.get("overexalt")
    if not oe:
        return ""
    name = oe.get("name_en", oe.get("name", "")) if lang == "en" else oe.get("name", "")
    effect = oe.get("effect", L["pending"])
    return f"### {L['overexalt']}\n\n**{name}**\n\n{effect}\n\n"


def render_enlighten(skills: dict, lang: str) -> str:
    L = LABELS[lang]
    enlighten = skills.get("enlighten")
    if not enlighten:
        return f"### {L['enlighten']}\n\n{L['pending']}\n"

    lines = [
        f"### {L['enlighten']}",
        "",
        f"| {L['level']} | {L['card_name']} | {L['effect']} |",
        "|------|------|------|",
    ]
    for e in enlighten:
        level = e.get("level", "?")
        name = e.get("name_en", e.get("name", "")) if lang == "en" else e.get("name", "")
        effect = _esc(e.get("effect", ""))
        lines.append(f"| {level} | {_esc(name)} | {effect} |")
    lines.append("")
    return "\n".join(lines) + "\n"


def render_talent(skills: dict, lang: str) -> str:
    L = LABELS[lang]
    talent = skills.get("talent")
    if not talent:
        return ""
    name = talent.get("name_en", talent.get("name", "")) if lang == "en" else talent.get("name", "")
    effect = talent.get("effect", L["pending"])
    return f"### {L['talent']}\n\n**{name}**\n\n{effect}\n\n"


def render_equipment(char: dict, wheel_index: dict[str, list[dict]], lang: str) -> str:
    L = LABELS[lang]
    char_name = char["name"]
    char_name_en = char.get("name_en", "")

    wheels = wheel_index.get(char_name, [])
    # Also try English name match
    if not wheels and char_name_en:
        wheels = wheel_index.get(char_name_en, [])

    if not wheels:
        return f"## {L['recommended_equipment']}\n\n{L['pending']}\n"

    lines = [f"## {L['recommended_equipment']}", ""]

    seen = set()
    for w in wheels:
        wname = w.get("name", "")
        if wname in seen:
            continue
        seen.add(wname)

        wname_en = w.get("name_en", "")
        is_signature = w.get("character") is not None
        tag = L["signature_wheel"] if is_signature else L["recommended_wheel"]

        display = f"{wname}" if lang == "zh" else (f"{wname_en}" if lang == "en" else f"{wname}（{wname_en}）")

        lines.append(f"### {tag}: {display}")
        lines.append("")

        effect = w.get("effect", "")
        effect_en = w.get("effect_en", "")
        if lang == "en" and effect_en:
            lines.append(effect_en.split("\n")[0] if "\n" in effect_en else effect_en)
        elif effect:
            lines.append(effect)
        else:
            lines.append(L["pending"])
        lines.append("")

    return "\n".join(lines) + "\n"


def generate_character_page(char: dict, wheel_index: dict[str, list[dict]], lang: str) -> str:
    """Generate full markdown for one character in the given language."""
    L = LABELS[lang]
    cid = char["id"]
    name = char["name"]
    name_en = char.get("name_en", name)
    rarity = char.get("rarity", "?")
    realm_key = char.get("realm", "chaos")
    role_key = char.get("role", "attack")
    is_limited = char.get("is_limited", False)
    obtain = char.get("obtain", L["pending"])
    description = char.get("description", L["pending"])

    realm_display = REALM_NAMES[lang].get(realm_key, realm_key)
    role_display = ROLE_NAMES[lang].get(role_key, role_key)
    limited_display = L["yes"] if is_limited else L["no"]

    # Frontmatter
    desc_text = L["description_tpl"].format(
        name=name, name_en=name_en, realm=realm_display, role=role_display
    )
    title_name = name_en if lang == "en" else name

    # Quote YAML values that contain colons to avoid parse errors
    title_val = f"{title_name} | {L['title_suffix']}"
    if ':' in title_val:
        title_val = f'"{title_val}"'
    desc_val = desc_text
    if ':' in desc_val:
        desc_val = f'"{desc_val}"'

    fm = [
        "---",
        f"title: {title_val}",
        f"description: {desc_val}",
        f"portrait: /portraits/{cid}.png",
        "---",
    ]

    # Header
    header_name = f"{name_en} ({name})" if lang == "en" else f"{name} ({name_en})"
    body = [
        "",
        f"# {header_name}",
        "",
        '<div class="character-header">',
        f'  <img :src="\'/brain-in-a-vat/wiki/portraits/{cid}.png\'" alt="{name}" class="portrait" />',
        "",
        f"  | {L['attr']} | {L['value']} |",
        "  |------|-----|",
        f"  | {L['rarity']} | {rarity} |",
        f"  | {L['realm']} | {realm_display} |",
        f"  | {L['role']} | {role_display} |",
        f"  | {L['limited']} | {limited_display} |",
        f"  | {L['obtain']} | {obtain} |",
        "</div>",
        "",
    ]

    # Intro
    body.extend([f"## {L['intro']}", "", description, ""])

    # Skills section
    skills = char.get("skills")
    if skills:
        body.extend([f"## {L['skills']}", ""])
        body.append(render_command_cards(skills, lang))
        body.append(render_rouse(skills, lang))
        body.append(render_exalt(skills, lang))
        oe = render_overexalt(skills, lang)
        if oe:
            body.append(oe)
        body.append(render_enlighten(skills, lang))
        talent = render_talent(skills, lang)
        if talent:
            body.append(talent)
    else:
        body.extend([f"## {L['skills']}", "", L["pending"], ""])

    # Equipment
    body.append(render_equipment(char, wheel_index, lang))

    # Component
    body.extend(["", "<CharacterCompare />", ""])

    return "\n".join(fm) + "\n".join(body)


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
    equip_data = load_equipment()
    wheel_index = build_wheel_index(equip_data)

    print(f"Loaded {len(characters)} characters, {sum(len(v) for v in wheel_index.values())} wheel mappings")
    print(f"Languages: {', '.join(langs)}")
    print(f"Dry run: {args.dry_run}")
    print()

    generated = 0
    skipped = 0
    updated_lists: list[str] = []

    for lang in langs:
        out_dir = DOCS_DIR / lang / "awakeners"
        if not args.dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)

        for char in characters:
            cid = char["id"]
            page_path = out_dir / f"{cid}.md"
            content = generate_character_page(char, wheel_index, lang)

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
