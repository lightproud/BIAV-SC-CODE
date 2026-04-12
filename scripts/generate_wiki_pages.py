"""Generate VitePress Markdown pages from processed JSON data."""
import json
import os

PROCESSED_DIR = 'projects/wiki/data/processed'
DOCS_DIR = 'projects/wiki/docs'


def generate_voice_lines():
    """Generate voice lines page from voice_lines.json."""
    with open(f'{PROCESSED_DIR}/voice_lines.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    lines = []
    lines.append('# 角色语音台词')
    lines.append('')
    lines.append(f'> 数据来源：Voice.lua（运行时内存提取） | 共 {data["_meta"]["total_lines"]} 条语音 / {data["_meta"]["character_groups"]} 个角色组')
    lines.append('')
    lines.append('::: warning 注意')
    lines.append('由于角色 ID 与角色名的映射关系存储在 Lua 字节码常量表中（未被字符串扫描捕获），当前以 ID 范围标识角色分组。')
    lines.append(':::')
    lines.append('')

    for i, char in enumerate(data['characters']):
        lines.append(f'## 角色组 {i+1}（ID {char["id_range"]}，{char["line_count"]} 条）')
        lines.append('')

        for cat_name, cat_lines in char['categories'].items():
            lines.append(f'### {cat_name}')
            lines.append('')

            for vl in cat_lines:
                title = vl['title']
                content = vl['content']
                unlock = vl.get('unlock_desc', '')

                lines.append(f'**{title}**')
                lines.append('')
                lines.append(f'> {content}')
                if unlock:
                    lines.append(f'>')
                    lines.append(f'> *{unlock}*')
                lines.append('')

    with open(f'{DOCS_DIR}/voice-lines.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Voice lines page: {len(lines)} lines')


def generate_collection_hall():
    """Generate collection hall / world lore page from world_lore.json."""
    with open(f'{PROCESSED_DIR}/world_lore.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    meta = data['_meta']
    lines = []
    lines.append('# 收藏馆百科')
    lines.append('')
    lines.append(f'> 数据来源：CollectionHall.lua（运行时内存提取） | 共 {meta["total_entries"]} 条词条，{meta["with_description"]} 条含描述')
    lines.append('')

    # Group entries into sections by ID ranges for readability
    entries = data['all_entries']

    # Separate entries with and without descriptions
    with_desc = [e for e in entries if e.get('desc')]
    without_desc = [e for e in entries if not e.get('desc')]

    lines.append(f'## 有描述的词条（{len(with_desc)} 条）')
    lines.append('')

    for entry in with_desc:
        title = entry['title']
        desc = entry['desc']
        lock = entry.get('lock_tip', '')

        lines.append(f'### {title}')
        lines.append('')
        lines.append(desc)
        if lock:
            lines.append('')
            lines.append(f'*解锁条件：{lock}*')
        lines.append('')

    lines.append(f'## 仅标题词条（{len(without_desc)} 条）')
    lines.append('')
    lines.append('以下词条在客户端数据中仅有标题，无描述文本。')
    lines.append('')

    # List them compactly
    for entry in without_desc:
        title = entry['title']
        lock = entry.get('lock_tip', '')
        if lock:
            lines.append(f'- **{title}** — *{lock}*')
        else:
            lines.append(f'- **{title}**')

    lines.append('')

    with open(f'{DOCS_DIR}/collection-hall.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Collection hall page: {len(lines)} lines')


def generate_cg_gallery():
    """Generate CG gallery page from cg_gallery.json."""
    with open(f'{PROCESSED_DIR}/cg_gallery.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    meta = data['_meta']
    lines = []
    lines.append('# CG 画廊')
    lines.append('')
    lines.append(f'> 数据来源：美术资产 manifest.json（UnityPy 解包） | 共 {meta["total_cg"]} 张 CG，{meta["story_chapters"]} 个章节')
    lines.append('')
    lines.append('::: info 说明')
    lines.append('CG 原始 PNG 文件（共约 701 MB）存储在本地，不包含在 git 仓库中。此处列出文件名和路径索引。')
    lines.append(':::')
    lines.append('')

    # Story chapters
    lines.append('## 主线章节 CG')
    lines.append('')

    for ch in data['chapters']:
        lines.append(f'### {ch["chapter_name"]}')
        lines.append('')
        lines.append(f'共 {ch["image_count"]} 张')
        lines.append('')
        lines.append('| 文件名 | 路径 | 大小 |')
        lines.append('|--------|------|------|')
        for img in ch['images']:
            size_kb = img['size'] / 1024
            if size_kb > 1024:
                size_str = f'{size_kb/1024:.1f} MB'
            else:
                size_str = f'{size_kb:.0f} KB'
            lines.append(f'| {img["name"]} | `{img["path"]}` | {size_str} |')
        lines.append('')

    # Special groups
    if data.get('special'):
        lines.append('## 特殊 CG')
        lines.append('')
        for sg in data['special']:
            lines.append(f'### {sg["group_name"]}')
            lines.append('')
            lines.append(f'共 {sg["image_count"]} 张')
            lines.append('')
            lines.append('| 文件名 | 路径 | 大小 |')
            lines.append('|--------|------|------|')
            for img in sg['images']:
                size_kb = img['size'] / 1024
                if size_kb > 1024:
                    size_str = f'{size_kb/1024:.1f} MB'
                else:
                    size_str = f'{size_kb:.0f} KB'
                lines.append(f'| {img["name"]} | `{img["path"]}` | {size_str} |')
            lines.append('')

    with open(f'{DOCS_DIR}/cg-gallery.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'CG gallery page: {len(lines)} lines')


def generate_item_stories():
    """Generate item stories page from item_stories.json."""
    with open(f'{PROCESSED_DIR}/item_stories.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    meta = data['_meta']
    cats = meta['category_counts']
    lines = []
    lines.append('# 道具背景故事')
    lines.append('')
    lines.append(f'> 数据来源：Item.lua StoryDesc 字段（运行时内存提取） | 共 {meta["total_with_story"]} 条')
    lines.append('')

    cat_labels = {
        'weapons': '命轮',
        'artifacts': '密契',
        'skills': '钥令',
        'materials': '材料',
        'other': '其他道具',
    }

    for cat_key, cat_label in cat_labels.items():
        items = data['by_category'].get(cat_key, [])
        if not items:
            continue

        lines.append(f'## {cat_label}（{len(items)} 条）')
        lines.append('')

        for item in items:
            lines.append(f'### {item["name"]}')
            lines.append('')
            if item.get('desc'):
                lines.append(f'*{item["desc"]}*')
                lines.append('')
            lines.append(item['story'])
            lines.append('')

    with open(f'{DOCS_DIR}/item-stories.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Item stories page: {len(lines)} lines')


if __name__ == '__main__':
    generate_voice_lines()
    generate_collection_hall()
    generate_cg_gallery()
    generate_item_stories()
    print('All wiki pages generated.')
