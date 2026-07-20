"""Parse Voice.lua into structured JSON for wiki voice lines page."""
# NOTE: 源数据层 Public-Info-Pool/Reference/Game-Unpacked/ 已于 2026-07-12 守密人裁定整层删除
#       （wiki 冻结后解析管线停派）。重跑本脚本前先从 git 历史或 Releases「解包」桶还原源数据。
import json

from lua_parse import parse_lua_blocks

def parse_voice_lua(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    entries = []
    for entry_id, fields in parse_lua_blocks(content):
        if 'AwakerVoiceContent' not in fields:
            continue

        entry = {
            'id': entry_id,
            'title': fields.get('AwakerVoiceTitle', ''),
            'content': fields.get('AwakerVoiceContent', ''),
        }
        if 'UnlockDesc' in fields:
            entry['unlock_desc'] = fields['UnlockDesc']
        entries.append(entry)

    # Sort by ID
    entries.sort(key=lambda x: x['id'])

    # Group by character (consecutive ID blocks)
    # Voice IDs for same character are consecutive; detect gaps > 50 as character boundary
    groups = []
    current_group = []
    prev_id = None
    for e in entries:
        if prev_id is not None and e['id'] - prev_id > 50:
            if current_group:
                groups.append(current_group)
            current_group = []
        current_group.append(e)
        prev_id = e['id']
    if current_group:
        groups.append(current_group)

    # Build character voice data
    characters = []
    for group in groups:
        # Categorize voice lines
        categories = {}
        for line in group:
            title = line['title']
            # Extract category from title (before the dot)
            if '·' in title:
                cat = title.split('·')[0]
            else:
                cat = title
            if cat not in categories:
                categories[cat] = []
            categories[cat].append(line)

        char_data = {
            'id_range': f"{group[0]['id']}-{group[-1]['id']}",
            'line_count': len(group),
            'categories': {},
        }
        for cat, lines in categories.items():
            char_data['categories'][cat] = [
                {k: v for k, v in l.items()} for l in lines
            ]
        characters.append(char_data)

    result = {
        '_meta': {
            'source': 'Voice.lua (runtime memory extraction)',
            'total_lines': len(entries),
            'character_groups': len(characters),
            'generated': '2026-04-12',
        },
        'characters': characters,
    }
    return result


if __name__ == '__main__':
    src = 'Public-Info-Pool/Reference/Game-Unpacked/Lua表还原/Voice.lua'
    dst = 'projects/wiki/data/processed/voice_lines.json'
    data = parse_voice_lua(src)
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Voice lines: {data['_meta']['total_lines']} lines in {data['_meta']['character_groups']} character groups -> {dst}")
