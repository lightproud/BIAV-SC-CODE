"""Parse Item.lua to extract items with background stories (StoryDesc field)."""
import json

from lua_parse import parse_lua_blocks

def parse_item_stories(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    entries = []
    for entry_id, fields in parse_lua_blocks(content):
        if 'StoryDesc' not in fields:
            continue
        story = fields['StoryDesc']
        # Skip placeholder/test entries
        if story in ('', '未完成', '测试', '临时文本'):
            continue
        # Skip very short entries (< 10 chars, likely placeholders)
        if len(story) < 10:
            continue

        entry = {
            'id': entry_id,
            'name': fields.get('Name', ''),
            'desc': fields.get('Desc', ''),
            'story': story,
        }
        entries.append(entry)

    entries.sort(key=lambda x: x['id'])

    # Categorize by item type based on Desc content
    categories = {
        'weapons': [],       # Wheels/weapons (命轮)
        'artifacts': [],     # Covenants/artifacts (密契)
        'skills': [],        # Key skills (钥令技能)
        'materials': [],     # Materials and consumables
        'other': [],
    }

    for entry in entries:
        desc = entry['desc']
        name = entry['name']
        if '命轮' in desc or '属性为' in desc:
            categories['weapons'].append(entry)
        elif '密契' in desc or '主属性从' in desc:
            categories['artifacts'].append(entry)
        elif '钥令' in desc or '钥令技能' in desc:
            categories['skills'].append(entry)
        elif '材料' in desc or '碎块' in name or '精华' in name:
            categories['materials'].append(entry)
        else:
            categories['other'].append(entry)

    result = {
        '_meta': {
            'source': 'Item.lua (runtime memory extraction)',
            'total_with_story': len(entries),
            'generated': '2026-04-12',
            'category_counts': {k: len(v) for k, v in categories.items()},
        },
        'all_items': entries,
        'by_category': categories,
    }
    return result


if __name__ == '__main__':
    src = 'Public-Info-Pool/Reference/Game-Unpacked/Lua表还原/Item.lua'
    dst = 'projects/wiki/data/processed/item_stories.json'
    data = parse_item_stories(src)
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    meta = data['_meta']
    print(f"Item stories: {meta['total_with_story']} items with stories -> {dst}")
    print(f"Categories: {meta['category_counts']}")
