#!/usr/bin/env python3
"""Build the story/ structured layer from raw + processed sources.

Reproducible regeneration of projects/wiki/data/processed/story/:
  - lore_entries.json   (1026 CollectionHall entries; verbatim desc recovered
                         from collection_story.txt; story_unit parsed)
  - story_units.json    (chapter spine: prologue / main / star-arc / mind-dive)
  - lore_by_unit.json   (unit -> lore ids)
  - stages_by_unit.json (unit -> StageGroup ids)
  - character_story_links.json (character -> unlock / unit)
  - index.json          (per-unit aggregation)

Originals (Game-Unpacked/*) are read-only; desc / lock_tip kept byte-for-byte.
"""
import json
import re

UNPACKED = 'Public-Info-Pool/Reference/Game-Unpacked'
DESC_SRC = f'{UNPACKED}/全部游戏数据/收藏馆_CollectionHall.txt'
PROCESSED = 'projects/wiki/data/processed'
OUT = f'{PROCESSED}/story'


def load_desc():
    descs = {}
    for line in open(DESC_SRC, encoding='utf-8', errors='ignore'):
        m = re.match(r'CollectionHall_(\d+)_Desc\|(.*)', line.rstrip('\n'))
        if m:
            descs[int(m.group(1))] = m.group(2)
    return descs


def chapter_title_maps(entries):
    """Extract {chapter_no: title} for main arc and star arc from lock_tips."""
    main, star = {}, {}
    for e in entries:
        lt = e.get('lock_tip', '')
        ms = re.search(r'星辰篇第(\d+)章[「『]([^」』]+)[」』]', lt)
        if ms:
            star[int(ms.group(1))] = ms.group(2)
            continue
        mm = re.search(r'调查行动第(\d+)章[「『]([^」』]+)[」』]', lt)
        if mm:
            main[int(mm.group(1))] = mm.group(2)
    return main, star


# 社区证实但解包 lock_tip 中无标题的章节标题（来源:autoresearch 2026-06-21,
# B站全剧情合集 + 官方 V2.4.0.3 维护公告;非解包提取,标注以区分)
COMMUNITY_TITLES_MAIN = {9: '长梦尽时'}


def make_parser(main_titles, star_titles):
    def unit_of(lt):
        if not lt:
            return None
        if '序章' in lt:
            return '序章'
        md = re.search(r'意识潜游[「『]([^」』]+)[」』]', lt)
        if md:
            return f'意识潜游「{md.group(1)}」'
        if '调查行动' in lt or '星辰篇' in lt:
            star = '星辰篇' in lt
            m = re.search(r'第(\d+)章', lt)
            if not m:
                # stage-number format: 调查行动[·困难][ 星辰篇]N-M
                m = re.search(r'(\d+)-\d+', lt)
            if m:
                n = int(m.group(1))
                if star:
                    t = star_titles.get(n)
                    return f'调查行动星辰篇第{n}章「{t}」' if t else f'调查行动星辰篇第{n}章'
                t = main_titles.get(n) or COMMUNITY_TITLES_MAIN.get(n)
                return f'调查行动第{n}章「{t}」' if t else f'调查行动第{n}章'
            return None  # 泛化「可于调查行动中解锁」无法定位
        return None
    return unit_of


def classify_unit(name):
    if name == '序章':
        return 'prologue', 0, '序章'
    ms = re.match(r'调查行动星辰篇第(\d+)章(?:「([^」]+)」)?', name)
    if ms:
        return 'star_chapter', int(ms.group(1)), ms.group(2) or f'第{ms.group(1)}章'
    mm = re.match(r'调查行动第(\d+)章(?:「([^」]+)」)?', name)
    if mm:
        return 'main_chapter', int(mm.group(1)), mm.group(2) or f'第{mm.group(1)}章'
    md = re.match(r'意识潜游「([^」]+)」', name)
    if md:
        return 'mind_dive', None, md.group(1)
    return 'other', None, name


def main():
    wl = json.load(open(f'{PROCESSED}/world_lore.json', encoding='utf-8'))
    entries_raw = {e['id']: e for e in wl['all_entries']}
    id2cat = {}
    for cat, lst in wl['by_category'].items():
        for e in lst:
            id2cat[e['id']] = cat
    descs = load_desc()
    bio_ids = {x['id']: x['character'] for x in json.load(open(f'{PROCESSED}/story_character_map.json', encoding='utf-8'))['assigned']}

    main_titles, star_titles = chapter_title_maps(entries_raw.values())
    unit_of = make_parser(main_titles, star_titles)

    # 1. lore_entries
    lore = []
    for eid, e in sorted(entries_raw.items()):
        lt = e.get('lock_tip', '')
        cat = 'character_bio' if eid in bio_ids else id2cat.get(eid, 'uncategorized')
        lore.append({
            'id': eid, 'title': e.get('title', ''),
            'desc': descs.get(eid, ''), 'lock_tip': lt,
            'story_unit': unit_of(lt), 'category': cat,
            'has_description': eid in descs,
        })
    json.dump({'_meta': {
        'purpose': 'CollectionHall 全量 lore:world_lore(title/lock_tip)+ collection_story.txt(desc 逐字)+ 剧情单元解析 + 角色小传标记',
        'source_raw': 'Game-Unpacked/全部游戏数据/收藏馆_CollectionHall.txt, Game-Unpacked/Lua表还原/CollectionHall.lua',
        'note': 'desc/lock_tip 为原始文本逐字;解析器覆盖 序章/主线第N章/星辰篇第N章/意识潜游,含关卡号(N-M)与困难格式',
        'total': len(lore), 'with_description': sum(1 for x in lore if x['has_description']),
        'mapped_to_unit': sum(1 for x in lore if x['story_unit']),
        'generated': '2026-06-21'}, 'entries': lore},
        open(f'{OUT}/lore_entries.json', 'w'), ensure_ascii=False, indent=2)

    # 2. story_units
    units = {}
    for e in lore:
        if e['story_unit']:
            units.setdefault(e['story_unit'], []).append(e['id'])
    unit_list = []
    for name, ids in units.items():
        typ, no, short = classify_unit(name)
        unit_list.append({'unit': name, 'type': typ, 'chapter_no': no,
                          'short_name': short, 'lore_count': len(ids),
                          'first_lore_id': min(ids)})

    def sortkey(x):
        order = {'prologue': 0, 'main_chapter': 1, 'star_chapter': 2, 'mind_dive': 3}
        return (order.get(x['type'], 4), x['chapter_no'] if x['chapter_no'] is not None else x['first_lore_id'])
    unit_list.sort(key=sortkey)
    for i, u in enumerate(unit_list):
        u['order'] = i

    # 3. stages_by_unit (exact-match group name to unit short_name)
    st = json.load(open(f'{PROCESSED}/stages.json', encoding='utf-8'))
    short2unit = {u['short_name']: u['unit'] for u in unit_list}
    unit_groups = {}
    for g in st['groups']:
        nm = re.sub(r'[（(](?:未完成|废弃)[）)]\s*$', '', g.get('name', '')).strip()
        if nm in short2unit:
            unit_groups.setdefault(short2unit[nm], []).append(
                {'group_id': g['id'], 'name': g.get('name', ''), 'type': g.get('type', '')})
    for u in unit_list:
        u['stage_group_ids'] = [x['group_id'] for x in unit_groups.get(u['unit'], [])]
        u['stage_group_count'] = len(u['stage_group_ids'])

    json.dump({'_meta': {
        'purpose': '剧情单元脊柱:序章 / 调查行动主线 / 星辰篇 / 意识潜游',
        'types': 'prologue, main_chapter, star_chapter(星辰篇), mind_dive',
        'note': 'mind_dive 的 order 按首条 lore id 近似;star_chapter 为第二剧情弧',
        'total_units': len(unit_list), 'generated': '2026-06-21'}, 'units': unit_list},
        open(f'{OUT}/story_units.json', 'w'), ensure_ascii=False, indent=2)

    by_unit = {u['unit']: units[u['unit']] for u in unit_list}
    json.dump({'_meta': {'purpose': '剧情单元 -> lore id 列表', 'covered_entries': sum(len(v) for v in by_unit.values()),
               'generated': '2026-06-21'}, 'by_unit': by_unit},
              open(f'{OUT}/lore_by_unit.json', 'w'), ensure_ascii=False, indent=2)

    json.dump({'_meta': {'purpose': '剧情单元 -> 关卡组', 'matching': '组名归一化后精确等于单元短名',
               'limitation': 'Stage/StageGroup 无外键,仅到关卡组层级',
               'matched_groups': sum(len(v) for v in unit_groups.values()), 'covered_units': len(unit_groups),
               'generated': '2026-06-21'}, 'by_unit': unit_groups},
              open(f'{OUT}/stages_by_unit.json', 'w'), ensure_ascii=False, indent=2)

    # 4. character_story_links
    lore_by_id = {e['id']: e for e in lore}

    def unlock_type(lt):
        if not lt:
            return 'unknown'
        if lt.startswith('唤醒') or '唤醒' in lt and '后解锁' in lt:
            return 'acquire_character'
        if '星辰篇' in lt:
            return 'star_arc'
        if '序章' in lt or '调查行动' in lt:
            return 'main_story'
        if '意识潜游' in lt:
            return 'mind_dive'
        if '特遣纪录' in lt:
            return 'special_record'
        if '异梦视界' in lt:
            return 'event_stage'
        if '通关' in lt:
            return 'clear_stage'
        return 'other'
    links = []
    for bid, name in bio_ids.items():
        e = lore_by_id.get(bid, {})
        links.append({'character': name, 'bio_lore_id': bid,
                      'unlock_condition': e.get('lock_tip', ''),
                      'unlock_type': unlock_type(e.get('lock_tip', '')),
                      'story_unit': e.get('story_unit')})
    json.dump({'_meta': {'purpose': '角色 -> 故事链路', 'total': len(links), 'generated': '2026-06-21'},
               'links': sorted(links, key=lambda x: x['bio_lore_id'])},
              open(f'{OUT}/character_story_links.json', 'w'), ensure_ascii=False, indent=2)

    # 5. index
    char_by_unit = {}
    for l in links:
        if l['story_unit']:
            char_by_unit.setdefault(l['story_unit'], []).append(l['character'])
    idx = []
    for u in unit_list:
        idx.append({'unit': u['unit'], 'type': u['type'], 'order': u['order'],
                    'chapter_no': u['chapter_no'], 'short_name': u['short_name'],
                    'lore_ids': by_unit.get(u['unit'], []), 'lore_count': u['lore_count'],
                    'stage_group_ids': u['stage_group_ids'], 'stage_group_count': u['stage_group_count'],
                    'characters': sorted(set(char_by_unit.get(u['unit'], [])))})
    json.dump({'_meta': {'purpose': '故事主索引:每单元聚合 lore/关卡组/登场角色',
               'total_units': len(idx), 'generated': '2026-06-21'}, 'index': idx},
              open(f'{OUT}/index.json', 'w'), ensure_ascii=False, indent=2)

    print(f"lore: {len(lore)} ({sum(1 for x in lore if x['story_unit'])} mapped to {len(unit_list)} units)")
    for u in unit_list:
        print(f"  [{u['order']:>2}] {u['type']:<13} {u['unit']} (lore {u['lore_count']}, 关卡组 {u['stage_group_count']})")


if __name__ == '__main__':
    main()
