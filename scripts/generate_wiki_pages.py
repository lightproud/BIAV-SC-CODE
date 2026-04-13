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


def _gallery_from_dir(public_subdir, title, desc, sections_config):
    """Generic gallery page generator that scans a public/ subdirectory.

    sections_config: list of (subdir_name, section_title) or None for flat.
    """
    public_dir = os.path.join(DOCS_DIR, 'public', public_subdir)
    lines = []
    lines.append(f'# {title}')
    lines.append('')
    lines.append(f'> {desc}')
    lines.append('')

    total = 0
    base_url = public_subdir

    if sections_config:
        for subdir, section_title in sections_config:
            section_dir = os.path.join(public_dir, subdir)
            if not os.path.isdir(section_dir):
                continue
            images = sorted([f for f in os.listdir(section_dir) if f.endswith('.png')])
            if not images:
                # Check subdirs
                for sub2 in sorted(os.listdir(section_dir)):
                    sub2_path = os.path.join(section_dir, sub2)
                    if os.path.isdir(sub2_path):
                        imgs = sorted([f for f in os.listdir(sub2_path) if f.endswith('.png')])
                        if imgs:
                            images.extend([(sub2, f) for f in imgs])
                if not images:
                    continue

            lines.append(f'## {section_title}（{len(images)} 张）')
            lines.append('')
            lines.append('<div style="display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0;">')
            for img in images:
                if isinstance(img, tuple):
                    sub2, fname = img
                    src = f'/{base_url}/{subdir}/{sub2}/{fname}'
                    name = os.path.splitext(fname)[0]
                else:
                    src = f'/{base_url}/{subdir}/{img}'
                    name = os.path.splitext(img)[0]
                lines.append(f'<div style="flex: 0 1 200px; text-align: center;">')
                lines.append(f'<img src="{src}" alt="{name}" style="width: 100%; border-radius: 6px; border: 1px solid #2a2a2a;" loading="lazy" />')
                lines.append(f'<div style="font-size: 0.8em; color: #888; margin-top: 2px; word-break: break-all;">{name}</div>')
                lines.append(f'</div>')
                total += 1
            lines.append('</div>')
            lines.append('')
    else:
        # Flat directory
        images = sorted([f for f in os.listdir(public_dir) if f.endswith('.png')])
        lines.append(f'共 {len(images)} 张')
        lines.append('')
        lines.append('<div style="display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0;">')
        for img in images:
            src = f'/{base_url}/{img}'
            name = os.path.splitext(img)[0]
            lines.append(f'<div style="flex: 0 1 200px; text-align: center;">')
            lines.append(f'<img src="{src}" alt="{name}" style="width: 100%; border-radius: 6px; border: 1px solid #2a2a2a;" loading="lazy" />')
            lines.append(f'<div style="font-size: 0.8em; color: #888; margin-top: 2px;">{name}</div>')
            lines.append(f'</div>')
            total += 1
        lines.append('</div>')
        lines.append('')

    return lines, total


def generate_portraits_gallery():
    """Generate character portraits gallery."""
    sections = [
        ('full', '全身立绘'),
        ('middle', '半身立绘'),
        ('circularhead', '圆形头像'),
        ('fullhead', '全身头像'),
        ('middleface', '半身面部'),
        ('minihead', '迷你头像'),
        ('miniface', '迷你面部'),
    ]
    lines, total = _gallery_from_dir(
        'portraits',
        '角色立绘画廊',
        f'数据来源：art-assets-v1 Release（UnityPy 解包） | 478 张角色立绘，7 种规格',
        sections,
    )
    with open(f'{DOCS_DIR}/portraits.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Portraits gallery: {total} images')


def generate_bunit_gallery():
    """Generate battle unit gallery."""
    sections = [
        ('awaker', '唤醒体'),
        ('keeper', '守护者'),
        ('monster', '怪物'),
    ]
    lines, total = _gallery_from_dir(
        'bunit',
        '战斗单位画廊',
        f'数据来源：art-assets-v1 Release（UnityPy 解包） | 317 张战斗单位贴图',
        sections,
    )
    with open(f'{DOCS_DIR}/battle-units.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Battle units gallery: {total} images')


def generate_icons_gallery():
    """Generate icons gallery."""
    # Scan subdirs dynamically
    icon_dir = os.path.join(DOCS_DIR, 'public', 'icon')
    section_labels = {
        'career': '职业图标',
        'copytitle': '副本标题',
        'emoji': '表情',
        'gift': '礼物',
        'keytoken_crystal': '钥令结晶',
        'keytoken_props': '钥令道具',
        'keytoken_skill': '钥令技能',
        'material': '材料',
        'relic': '遗物',
        'resonance': '共鸣',
        'skingift': '皮肤礼物',
        'topbaritem': '顶栏道具',
        'weapon_full': '命轮全图',
        'weapon_small': '命轮小图',
    }
    sections = []
    for d in sorted(os.listdir(icon_dir)):
        if os.path.isdir(os.path.join(icon_dir, d)):
            label = section_labels.get(d, d)
            sections.append((d, label))

    lines, total = _gallery_from_dir(
        'icon',
        '图标画廊',
        f'数据来源：art-assets-v1 Release（UnityPy 解包） | 169 个图标',
        sections,
    )
    with open(f'{DOCS_DIR}/icons.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Icons gallery: {total} images')


def generate_ui_gallery():
    """Generate UI resources gallery."""
    ui_dir = os.path.join(DOCS_DIR, 'public', 'uiresources', 'uibigimages')
    section_labels = {
        'ui_alchemy': '炼金',
        'ui_awaker': '唤醒体',
        'ui_battle': '战斗',
        'ui_card': '卡牌',
        'ui_chapter': '章节',
        'ui_collection': '收藏馆',
        'ui_collection_image': '收藏馆图片',
        'ui_common': '通用',
        'ui_dbgcopy': '调试副本',
        'ui_dungeous': '地下城',
        'ui_events': '活动',
        'ui_guide': '引导',
        'ui_keytoken': '钥令',
        'ui_large': '大图',
        'ui_mail': '邮件',
        'ui_mask': '遮罩',
        'ui_passport': '通行证',
        'ui_pvp': 'PvP',
        'ui_research': '研究',
        'ui_story_texture': '剧情贴图',
        'ui_summon': '召唤',
    }

    lines = []
    lines.append('# UI 资源画廊')
    lines.append('')
    lines.append('> 数据来源：art-assets-v1 Release（UnityPy 解包）')
    lines.append('')

    total = 0

    # Card portraits
    card_dir = os.path.join(DOCS_DIR, 'public', 'portrait-card', 'card')
    if os.path.isdir(card_dir):
        images = sorted([f for f in os.listdir(card_dir) if f.endswith('.png')])
        if images:
            lines.append(f'## 卡面立绘（{len(images)} 张）')
            lines.append('')
            lines.append('<div style="display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0;">')
            for img in images:
                name = os.path.splitext(img)[0]
                lines.append(f'<div style="flex: 0 1 200px; text-align: center;">')
                lines.append(f'<img src="/portrait-card/card/{img}" alt="{name}" style="width: 100%; border-radius: 6px; border: 1px solid #2a2a2a;" loading="lazy" />')
                lines.append(f'<div style="font-size: 0.8em; color: #888; margin-top: 2px;">{name}</div>')
                lines.append(f'</div>')
                total += 1
            lines.append('</div>')
            lines.append('')

    # UI big images by category
    if os.path.isdir(ui_dir):
        for d in sorted(os.listdir(ui_dir)):
            dpath = os.path.join(ui_dir, d)
            if not os.path.isdir(dpath):
                continue
            label = section_labels.get(d, d)
            # Collect images recursively
            imgs = []
            for root, dirs, files in os.walk(dpath):
                for f in sorted(files):
                    if f.endswith('.png'):
                        rel = os.path.relpath(os.path.join(root, f), os.path.join(DOCS_DIR, 'public'))
                        imgs.append((rel, os.path.splitext(f)[0]))
            if not imgs:
                continue
            lines.append(f'## {label}（{len(imgs)} 张）')
            lines.append('')
            lines.append('<div style="display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0;">')
            for rel, name in imgs:
                lines.append(f'<div style="flex: 0 1 280px; text-align: center;">')
                lines.append(f'<img src="/{rel}" alt="{name}" style="width: 100%; border-radius: 6px; border: 1px solid #2a2a2a;" loading="lazy" />')
                lines.append(f'<div style="font-size: 0.8em; color: #888; margin-top: 2px; word-break: break-all;">{name}</div>')
                lines.append(f'</div>')
                total += 1
            lines.append('</div>')
            lines.append('')

    with open(f'{DOCS_DIR}/ui-resources.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'UI resources gallery: {total} images')


if __name__ == '__main__':
    generate_voice_lines()
    generate_collection_hall()
    generate_cg_gallery()
    generate_item_stories()
    generate_portraits_gallery()
    generate_bunit_gallery()
    generate_icons_gallery()
    generate_ui_gallery()
    print('All wiki pages generated.')
