"""Parse CollectionHall.lua into structured JSON for world lore encyclopedia."""
# NOTE: 源数据层 Public-Info-Pool/Reference/Game-Unpacked/ 已于 2026-07-12 守密人裁定整层删除
#       （wiki 冻结后解析管线停派）。重跑本脚本前先从 git 历史或 Releases「解包」桶还原源数据。
import json

from lua_parse import parse_lua_blocks

def parse_collection_hall(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    entries = []
    for entry_id, fields in parse_lua_blocks(content):
        if 'Title' not in fields:
            continue

        entry = {
            'id': entry_id,
            'title': fields['Title'],
        }
        if 'Desc' in fields and fields['Desc']:
            entry['desc'] = fields['Desc']
        if 'LockTip' in fields and fields['LockTip']:
            entry['lock_tip'] = fields['LockTip']
        entries.append(entry)

    entries.sort(key=lambda x: x['id'])

    # Categorize by content type
    categories = {
        'locations': [],       # Places, organizations
        'creatures': [],       # Monsters, entities
        'concepts': [],        # World concepts, dimensions
        'uncategorized': [],   # Everything else
    }

    # Simple keyword-based categorization
    location_keywords = ['大学', '城', '协会', '教会', '学院', '区', '馆', '港', '镇', '岛', '河', '山', '谷', '街']
    creature_keywords = ['狼', '兔', '蛛', '虫', '鸟', '兽', '怪', '附肢', '触手', '蠕', '蜘蛛']
    concept_keywords = ['维度', '融蚀', '界域', '质体', '银芯', '黑印', '狂气', '深渊', '混沌', '超维']

    with_desc = 0
    with_lock = 0

    for entry in entries:
        title = entry['title']
        desc = entry.get('desc', '')
        lock = entry.get('lock_tip', '')

        if desc:
            with_desc += 1
        if lock:
            with_lock += 1

        categorized = False
        for kw in concept_keywords:
            if kw in title or kw in desc:
                categories['concepts'].append(entry)
                categorized = True
                break
        if not categorized:
            for kw in location_keywords:
                if kw in title:
                    categories['locations'].append(entry)
                    categorized = True
                    break
        if not categorized:
            for kw in creature_keywords:
                if kw in title or kw in desc:
                    categories['creatures'].append(entry)
                    categorized = True
                    break
        if not categorized:
            categories['uncategorized'].append(entry)

    result = {
        '_meta': {
            'source': 'CollectionHall.lua (runtime memory extraction)',
            'total_entries': len(entries),
            'with_description': with_desc,
            'with_lock_condition': with_lock,
            'generated': '2026-04-12',
            'category_counts': {k: len(v) for k, v in categories.items()},
        },
        'all_entries': entries,
        'by_category': categories,
    }
    return result


if __name__ == '__main__':
    src = 'Public-Info-Pool/Reference/Game-Unpacked/Lua表还原/CollectionHall.lua'
    dst = 'projects/wiki/data/processed/world_lore.json'
    data = parse_collection_hall(src)
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    meta = data['_meta']
    print(f"World lore: {meta['total_entries']} entries ({meta['with_description']} with desc) -> {dst}")
    print(f"Categories: {meta['category_counts']}")
