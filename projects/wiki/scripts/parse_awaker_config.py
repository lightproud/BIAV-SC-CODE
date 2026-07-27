"""Parse AwakerConfig.lua into structured character profiles JSON."""
# NOTE: 源数据层 Public-Info-Pool/Reference/Game-Unpacked/ 已于 2026-07-12 守密人裁定整层删除
#       （wiki 冻结后解析管线停派）。重跑本脚本前先从 git 历史或 Releases「解包」桶还原源数据。
import re
import json
import os

LUA_DIR = 'Public-Info-Pool/Reference/Game-Unpacked/Lua表还原'
OUT_DIR = 'projects/wiki/data/processed'


def clean_markup(text):
    """Remove Unity rich text / custom markup tags, keep display text."""
    text = re.sub(r'<color=[^>]+>', '', text)
    text = re.sub(r'</color>', '', text)
    text = re.sub(r'<size=[^>]+>', '', text)
    text = re.sub(r'</size>', '', text)
    text = re.sub(r'<b>', '', text)
    text = re.sub(r'</b>', '', text)
    text = re.sub(r'<i>', '', text)
    text = re.sub(r'</i>', '', text)
    text = re.sub(r'<[A-Za-z_]+:([^>]+)>', r'\1', text)
    return text.strip()


def parse_lua_table(filepath):
    """Parse a Lua table file into dict of {id: {field: value}}."""
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()

    result = {}
    blocks = re.finditer(
        r'\[(\d+)\]\s*=\s*\{(.*?)\n    \}',
        text, re.DOTALL
    )
    for m in blocks:
        entry_id = int(m.group(1))
        content = m.group(2)
        fields = {}
        for fm in re.finditer(r'(\w+)\s*=\s*"([^"]*)"', content):
            key, val = fm.group(1), fm.group(2)
            if key in fields:
                if isinstance(fields[key], list):
                    fields[key].append(val)
                else:
                    fields[key] = [fields[key], val]
            else:
                fields[key] = val
        result[entry_id] = fields
    return result


def parse_awaker_config():
    data = parse_lua_table(os.path.join(LUA_DIR, 'AwakerConfig.lua'))

    characters = []
    for cid in sorted(data.keys()):
        entry = data[cid]
        intro = entry.get('Introduction', '')
        if isinstance(intro, list):
            intro = intro[-1]

        awaker_intro = entry.get('AwakerIntroduction', '')
        if isinstance(awaker_intro, list):
            awaker_intro = awaker_intro[0]

        char = {
            'id': cid,
            'name': entry.get('Name', ''),
            'title': entry.get('Title', ''),
            'gender': entry.get('Gender', ''),
            'birthday': entry.get('Age', ''),
            'height': entry.get('Height', ''),
            'weight': entry.get('Weight', ''),
            'gi': entry.get('Gi', ''),
            'voice_actor': entry.get('VoiceActor', ''),
            'painter': entry.get('Painter', ''),
            'characteristic': entry.get('Characteristic', ''),
            'introduction': clean_markup(intro),
            'gameplay_intro': clean_markup(awaker_intro),
            'summon_slogan': clean_markup(entry.get('SummonSlogan', '')),
        }
        characters.append(char)

    return characters


def parse_summon():
    data = parse_lua_table(os.path.join(LUA_DIR, 'Summon.lua'))

    banners = []
    for sid in sorted(data.keys()):
        entry = data[sid]
        banner = {
            'id': sid,
            'name': entry.get('Name', ''),
            'title': entry.get('Title', ''),
            'desc': clean_markup(entry.get('Desc', '')),
            'short_desc': clean_markup(entry.get('ShortDesc', '')),
            'rate_up': clean_markup(entry.get('ProbabilityUpDesc', '')),
            'rate_ssr': clean_markup(entry.get('RateListTextSSR', '')),
            'rate_sr': clean_markup(entry.get('RateListTextSR', '')),
            'rate_r': clean_markup(entry.get('RateListTextR', '')),
        }
        banners.append(banner)

    return banners


def parse_stages():
    stages = parse_lua_table(os.path.join(LUA_DIR, 'Stage.lua'))
    groups = parse_lua_table(os.path.join(LUA_DIR, 'StageGroup.lua'))

    stage_list = []
    for sid in sorted(stages.keys()):
        entry = stages[sid]
        stage_list.append({
            'id': sid,
            'name': entry.get('Name', ''),
            'desc': clean_markup(entry.get('Desc', '')),
        })

    group_list = []
    for gid in sorted(groups.keys()):
        entry = groups[gid]
        group_list.append({
            'id': gid,
            'name': entry.get('Name', ''),
            'desc': clean_markup(entry.get('Desc', '')),
            'type': entry.get('TypeText', ''),
            'reward_desc': clean_markup(entry.get('StageGroupRewardDescription', '')),
        })

    return stage_list, group_list


def parse_potency():
    data = parse_lua_table(os.path.join(LUA_DIR, 'AwakerPotency.lua'))

    potencies = []
    for pid in sorted(data.keys()):
        entry = data[pid]
        desc = entry.get('PotencyDesc', '')
        if isinstance(desc, list):
            desc = desc[0]
        potencies.append({
            'id': pid,
            'name': entry.get('PotencyName', ''),
            'desc': clean_markup(desc),
        })
    return potencies


def parse_tasks():
    data = parse_lua_table(os.path.join(LUA_DIR, 'Task.lua'))
    tasks = []
    for tid in sorted(data.keys()):
        entry = data[tid]
        tasks.append({
            'id': tid,
            'name': entry.get('Name', ''),
            'desc': clean_markup(entry.get('Desc', '')),
        })
    return tasks


def parse_feature_unlock():
    data = parse_lua_table(os.path.join(LUA_DIR, 'FeatureUnlock.lua'))
    features = []
    for fid in sorted(data.keys()):
        entry = data[fid]
        features.append({
            'id': fid,
            'feature_name': entry.get('FeatureName', ''),
            'lock_tip': clean_markup(entry.get('LockTip', '')),
            'unlock_desc': clean_markup(entry.get('UnlockDesc', '')),
        })
    return features


def _unescape_lua_string(s):
    """Unescape a Lua string literal captured by regex from file text.

    The reconstructed Lua files use doubled backslashes for escape sequences
    (file bytes 5c 5c 6e = ``\\n`` meaning newline).  The regex captures
    each ``\\.`` pair as two Python chars (backslash + next char), so in
    the captured group the sequence ``\\n`` appears as *three* Python chars:
    ``\\`` + ``\\`` + ``n``.  We therefore match ``\\\\(.)`` (two
    backslashes followed by one char) in a single pass.
    """
    def _replace_escape(m):
        ch = m.group(1)
        if ch == 'n':
            return '\n'
        elif ch == 't':
            return '\t'
        elif ch == '"':
            return '"'
        elif ch == '/':
            return '/'
        elif ch == '\\':
            return '\\'
        else:
            return ch
    return re.sub(r'\\\\(.)', _replace_escape, s)


def parse_lua_string_table(filepath):
    """Parse a Lua table of ["key"] = "value" pairs (no nested blocks)."""
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()

    result = {}
    for m in re.finditer(r'\["([^"]+)"\]\s*=\s*"((?:[^"\\]|\\.)*)"', text):
        key = m.group(1)
        val = _unescape_lua_string(m.group(2))
        result[key] = val
    return result


def parse_lua_indexed_string_table(filepath):
    """Parse a Lua table of [n] = "value" pairs (integer-indexed strings)."""
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()

    result = {}
    for m in re.finditer(r'\[(\d+)\]\s*=\s*"((?:[^"\\]|\\.)*)"', text):
        idx = int(m.group(1))
        val = _unescape_lua_string(m.group(2))
        result[idx] = val
    return result


def parse_panel_text():
    data = parse_lua_string_table(os.path.join(LUA_DIR, 'PanelText.lua'))

    entries = []
    for key in sorted(data.keys()):
        val = data[key]
        # Extract UI category from the key pattern:
        # PanelText_UI_{Category}_... or PanelText_{Category}_...
        parts = key.split('_')
        # Remove leading 'PanelText' prefix
        parts = parts[1:] if parts and parts[0] == 'PanelText' else parts
        # Determine category
        if len(parts) >= 2 and parts[0] == 'UI':
            category = parts[1]
        elif len(parts) >= 1 and parts[0]:
            category = parts[0]
        else:
            category = 'Other'

        entries.append({
            'key': key,
            'value': clean_markup(val),
            'category': category,
        })

    return entries


def parse_language_config():
    data = parse_lua_string_table(os.path.join(LUA_DIR, 'LanguageConfig.lua'))

    entries = []
    for key in sorted(data.keys()):
        val = data[key]
        # Strip _CN suffix if present
        display_key = key
        if display_key.endswith('_CN'):
            display_key = display_key[:-3]
        entries.append({
            'key': key,
            'display_key': display_key,
            'value': clean_markup(val),
        })

    return entries


def parse_update_notices():
    data = parse_lua_indexed_string_table(
        os.path.join(LUA_DIR, 'UpdateNotices.lua'))

    entries = []
    for idx in sorted(data.keys()):
        val = data[idx]
        entries.append({
            'id': idx,
            'text': clean_markup(val),
        })

    return entries


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    characters = parse_awaker_config()
    output = {
        '_meta': {
            'source': 'AwakerConfig.lua (runtime memory extraction)',
            'total_characters': len(characters),
            'generated': '2026-04-25',
        },
        'characters': characters,
    }
    with open(os.path.join(OUT_DIR, 'characters.json'), 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f'Characters: {len(characters)} profiles')

    banners = parse_summon()
    output = {
        '_meta': {
            'source': 'Summon.lua (runtime memory extraction)',
            'total_banners': len(banners),
            'generated': '2026-04-25',
        },
        'banners': banners,
    }
    with open(os.path.join(OUT_DIR, 'summon.json'), 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f'Summon banners: {len(banners)}')

    stages, groups = parse_stages()
    output = {
        '_meta': {
            'source': 'Stage.lua + StageGroup.lua (runtime memory extraction)',
            'total_stages': len(stages),
            'total_groups': len(groups),
            'generated': '2026-04-25',
        },
        'groups': groups,
        'stages': stages,
    }
    with open(os.path.join(OUT_DIR, 'stages.json'), 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f'Stages: {len(stages)} stages, {len(groups)} groups')

    potencies = parse_potency()
    output = {
        '_meta': {
            'source': 'AwakerPotency.lua (runtime memory extraction)',
            'total_potencies': len(potencies),
            'generated': '2026-04-25',
        },
        'potencies': potencies,
    }
    with open(os.path.join(OUT_DIR, 'potency.json'), 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f'Potencies: {len(potencies)} entries')

    tasks = parse_tasks()
    output = {
        '_meta': {
            'source': 'Task.lua (runtime memory extraction)',
            'total_tasks': len(tasks),
            'generated': '2026-04-25',
        },
        'tasks': tasks,
    }
    with open(os.path.join(OUT_DIR, 'tasks.json'), 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f'Tasks: {len(tasks)} entries')

    features = parse_feature_unlock()
    output = {
        '_meta': {
            'source': 'FeatureUnlock.lua (runtime memory extraction)',
            'total_features': len(features),
            'generated': '2026-04-25',
        },
        'features': features,
    }
    with open(os.path.join(OUT_DIR, 'feature_unlock.json'), 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f'Feature unlocks: {len(features)} entries')

    # Panel Text
    panel_entries = parse_panel_text()
    # Group by category
    categories = {}
    for e in panel_entries:
        cat = e['category']
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(e)
    output = {
        '_meta': {
            'source': 'PanelText.lua (runtime memory extraction)',
            'total_entries': len(panel_entries),
            'total_categories': len(categories),
            'generated': '2026-04-26',
        },
        'categories': {cat: items for cat, items in sorted(categories.items())},
    }
    with open(os.path.join(OUT_DIR, 'panel_text.json'), 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f'Panel text: {len(panel_entries)} entries in {len(categories)} categories')

    # Language Config
    lang_entries = parse_language_config()
    output = {
        '_meta': {
            'source': 'LanguageConfig.lua (runtime memory extraction)',
            'total_entries': len(lang_entries),
            'generated': '2026-04-26',
        },
        'entries': lang_entries,
    }
    with open(os.path.join(OUT_DIR, 'language_config.json'), 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f'Language config: {len(lang_entries)} entries')

    # Update Notices
    notice_entries = parse_update_notices()
    output = {
        '_meta': {
            'source': 'UpdateNotices.lua (game update/maintenance notices)',
            'total_entries': len(notice_entries),
            'generated': '2026-04-26',
        },
        'notices': notice_entries,
    }
    with open(os.path.join(OUT_DIR, 'update_notices.json'), 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f'Update notices: {len(notice_entries)} entries')


if __name__ == '__main__':
    main()
