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
    """Generate CG gallery page from cg_gallery.json with inline images."""
    with open(f'{PROCESSED_DIR}/cg_gallery.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Build set of available local images (relative to docs/public/)
    available = set()
    public_dir = os.path.join(DOCS_DIR, 'public')
    for root, dirs, files in os.walk(os.path.join(public_dir, 'cg')):
        for fn in files:
            if fn.endswith('.png'):
                rel = os.path.relpath(os.path.join(root, fn), public_dir)
                available.add(rel)
    for root, dirs, files in os.walk(os.path.join(public_dir, 'scenebg')):
        for fn in files:
            if fn.endswith('.png'):
                rel = os.path.relpath(os.path.join(root, fn), public_dir)
                available.add(rel)

    meta = data['_meta']
    lines = []
    lines.append('# CG 画廊')
    lines.append('')
    lines.append(f'> 数据来源：美术资产 manifest.json（UnityPy 解包） | 共 {meta["total_cg"]} 张 CG，{meta["story_chapters"]} 个章节')
    lines.append('')

    displayed = 0
    listed = 0

    def render_images(images, lines):
        nonlocal displayed, listed
        has_img = []
        no_img = []
        for img in images:
            # Check if image exists in public/
            if img['path'] in available:
                has_img.append(img)
            else:
                no_img.append(img)

        if has_img:
            # Use a flex grid via raw HTML for image gallery
            lines.append('<div style="display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0;">')
            for img in has_img:
                src = f'/{img["path"]}'
                lines.append(f'<div style="flex: 1 1 300px; max-width: 480px;">')
                lines.append(f'<img src="{src}" alt="{img["name"]}" style="width: 100%; border-radius: 8px; border: 1px solid #2a2a2a;" loading="lazy" />')
                lines.append(f'<div style="text-align: center; font-size: 0.85em; color: #888; margin-top: 4px;">{img["name"]}</div>')
                lines.append(f'</div>')
                displayed += 1
            lines.append('</div>')
            lines.append('')

        if no_img:
            lines.append('<details>')
            lines.append(f'<summary>其余 {len(no_img)} 张（本地未包含图片文件）</summary>')
            lines.append('')
            lines.append('| 文件名 | 路径 |')
            lines.append('|--------|------|')
            for img in no_img:
                lines.append(f'| {img["name"]} | `{img["path"]}` |')
                listed += 1
            lines.append('')
            lines.append('</details>')
            lines.append('')

    # Story chapters
    lines.append('## 主线章节 CG')
    lines.append('')

    for ch in data['chapters']:
        lines.append(f'### {ch["chapter_name"]}（{ch["image_count"]} 张）')
        lines.append('')
        render_images(ch['images'], lines)

    # Special groups
    if data.get('special'):
        lines.append('## 特殊 CG')
        lines.append('')
        for sg in data['special']:
            lines.append(f'### {sg["group_name"]}（{sg["image_count"]} 张）')
            lines.append('')
            render_images(sg['images'], lines)

    # Scene backgrounds
    scenebg_files = sorted([f for f in available if f.startswith('scenebg/')])
    if scenebg_files:
        lines.append('## 场景背景')
        lines.append('')
        lines.append(f'共 {len(scenebg_files)} 张')
        lines.append('')
        lines.append('<div style="display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0;">')
        for f in scenebg_files:
            name = os.path.splitext(os.path.basename(f))[0]
            lines.append(f'<div style="flex: 1 1 300px; max-width: 480px;">')
            lines.append(f'<img src="/{f}" alt="{name}" style="width: 100%; border-radius: 8px; border: 1px solid #2a2a2a;" loading="lazy" />')
            lines.append(f'<div style="text-align: center; font-size: 0.85em; color: #888; margin-top: 4px;">{name}</div>')
            lines.append(f'</div>')
            displayed += 1
        lines.append('</div>')
        lines.append('')

    with open(f'{DOCS_DIR}/cg-gallery.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'CG gallery page: {displayed} images displayed, {listed} listed as text')


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
