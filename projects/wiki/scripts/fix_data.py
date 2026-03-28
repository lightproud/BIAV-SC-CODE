#!/usr/bin/env python3
"""Fix known data errors in characters.json and related files.

Fixes:
1. name_en corrections per task doc (Fandom/kaiden.gg verified)
2. realm values: deep_sea→aequor, flesh→caro, hyperdimension→ultra
3. role normalization: dps→attack, sub_dps→sub_attack, tank→defense
4. id fields: pinyin→english slug
"""

import json
import os
import re

DB_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'db')

# === 1. Name corrections (confirmed from task doc) ===
NAME_EN_FIXES = {
    "艾尔瓦": "Alva",
    "朵尔": "Doll",
    "萝坦": "Lotan",
    "凯刻斯": "Caecus",
    "法洛思": "Faros",
    "尤乌哈希": "Uvhash",
    "索蕾尔": "Sorel",
    "泰旖丝": "Thais",
    "达芙黛尔": "Daffodil",
    "卡茜亚": "Casiah",
    "艾继丝": "Aigis",
    "菲茵特": "Faint",
    "温柯尔": "Winkle",
    "奥吉尔": "Ogier",        # kaiden.gg slug is "ogier"
    "环行·拉蒙娜": "Ramona: Timeworn",  # kaiden.gg uses "g-ramona"
    "奥尔拉": "Horla",         # kaiden.gg slug is "horla"
    "莱克": "Karen",           # kaiden.gg slug is "karen"
    "血链·希洛": "Helot",       # kaiden.gg slug is "helot"
    "希洛": "Shilo",           # keep as-is, newer character
    "熔毁·朵尔": "Doll: Inferno",  # already correct format
}

# === 2. Realm mapping ===
REALM_FIXES = {
    "deep_sea": "aequor",
    "flesh": "caro",
    "hyperdimension": "ultra",
}

# === 3. Role mapping ===
ROLE_FIXES = {
    "dps": "attack",
    "sub_dps": "sub_attack",
    "tank": "defense",
    # "defense" stays "defense"
    # "support" stays "support"
    # "chorus" stays "chorus"
    # "healer" stays "healer"
}

# === 4. ID mapping (pinyin → english slug) ===
def make_slug(name_en):
    """Convert English name to URL-friendly slug."""
    slug = name_en.lower()
    slug = slug.replace(": ", "-").replace(":", "-")
    slug = slug.replace(" ", "-")
    slug = re.sub(r'[^a-z0-9\-]', '', slug)
    slug = re.sub(r'-+', '-', slug).strip('-')
    return slug


def fix_characters():
    path = os.path.join(DB_DIR, 'characters.json')
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Fix role_types
    new_role_types = {
        "attack": {"name": "输出", "name_en": "Attack", "description": "主要输出角色，负责造成伤害。"},
        "sub_attack": {"name": "副输出", "name_en": "Sub-Attack", "description": "副输出角色，配合主C输出。"},
        "support": {"name": "辅助", "name_en": "Support", "description": "提供增益、减益等辅助效果。"},
        "defense": {"name": "防御", "name_en": "Defense", "description": "承受伤害、保护队友。"},
        "healer": {"name": "治疗", "name_en": "Healer", "description": "恢复队友生命值。"},
        "chorus": {"name": "合唱", "name_en": "Chorus", "description": "v2.4新增角色类型，合唱型角色。与主C配合产生特殊联携效果。"}
    }
    data['role_types'] = new_role_types

    for char in data['characters']:
        # Fix name_en
        if char['name'] in NAME_EN_FIXES:
            old = char['name_en']
            char['name_en'] = NAME_EN_FIXES[char['name']]
            if old != char['name_en']:
                print(f"  name_en: {char['name']} {old} → {char['name_en']}")

        # Fix realm
        if char['realm'] in REALM_FIXES:
            old = char['realm']
            char['realm'] = REALM_FIXES[char['realm']]
            print(f"  realm: {char['name']} {old} → {char['realm']}")

        # Fix role
        if char['role'] in ROLE_FIXES:
            old = char['role']
            char['role'] = ROLE_FIXES[char['role']]
            print(f"  role: {char['name']} {old} → {char['role']}")

        # Fix id (pinyin → english slug)
        old_id = char['id']
        new_id = make_slug(char['name_en'])
        if new_id != old_id:
            char['id'] = new_id
            print(f"  id: {char['name']} {old_id} → {new_id}")

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\n✓ characters.json updated ({len(data['characters'])} characters)")


def fix_realms():
    path = os.path.join(DB_DIR, 'realms.json')
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    for realm in data.get('realms', []):
        old_id = realm.get('id', '')
        if old_id in REALM_FIXES:
            realm['legacy_id'] = old_id
            realm['id'] = REALM_FIXES[old_id]
            print(f"  realm id: {old_id} → {realm['id']} (legacy_id preserved)")

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("✓ realms.json updated")


def fix_json_realms_global():
    """Replace old realm values in all JSON files."""
    for filename in os.listdir(DB_DIR):
        if not filename.endswith('.json'):
            continue
        if filename == 'characters.json' or filename == 'realms.json':
            continue  # already handled

        path = os.path.join(DB_DIR, filename)
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()

        original = content
        for old, new in REALM_FIXES.items():
            # Replace as JSON string values
            content = content.replace(f'"realm": "{old}"', f'"realm": "{new}"')
            content = content.replace(f'"realm_affinity": "{old}"', f'"realm_affinity": "{new}"')
            # Replace in descriptive text cautiously (only exact field values)
            content = content.replace(f'"{old}"', f'"{new}"')

        if content != original:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"  ✓ {filename}: realm values updated")
        else:
            print(f"  - {filename}: no realm changes needed")


if __name__ == '__main__':
    print("=== Fixing characters.json ===")
    fix_characters()
    print("\n=== Fixing realms.json ===")
    fix_realms()
    print("\n=== Fixing realm values in other JSON files ===")
    fix_json_realms_global()
    print("\n✓ All fixes applied!")
