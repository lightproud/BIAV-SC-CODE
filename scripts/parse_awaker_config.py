"""Parse AwakerConfig.lua into structured character profiles JSON."""
import re
import json
import os

LUA_DIR = 'projects/wiki/data/extracted/lua_tables'
OUT_DIR = 'projects/wiki/data/processed'


def clean_markup(text):
    """Remove Unity rich text / custom markup tags, keep display text."""
    text = re.sub(r'<color=[^>]+>', '', text)
    text = re.sub(r'</color>', '', text)
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


if __name__ == '__main__':
    main()
