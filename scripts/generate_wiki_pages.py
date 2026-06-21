"""Generate VitePress Markdown pages from processed JSON data.

Source of truth: projects/wiki/data/processed/ (PROCESSED_DIR below).
Driven by: .github/workflows/deploy-site.yml (step "Regenerate wiki pages
with media assets"). Builds encyclopedia + voice-line + media-asset pages.

Distinct from projects/wiki/scripts/generate_pages.py, which generates the
per-character detail pages from data/db/ and is driven by fetch-wiki-data.yml.
The two generators write different page sets from different sources; keep their
source dirs (processed/ here vs db/ there) in sync to avoid drift (ARCH-05).
"""
import json
import os
import glob

PROCESSED_DIR = 'projects/wiki/data/processed'
DOCS_DIR = 'projects/wiki/docs'
SITE_BASE = '/brain-in-a-vat/wiki/'

# 界域：解包无 realm 字段，玩法层（character_skills.md）是唯一界域归属来源。
REALM_KEYS = {'混沌': 'chaos', '深海': 'aequor', '血肉': 'caro', '超维': 'ultra'}
REALM_LABEL = {'chaos': '混沌', 'aequor': '深海', 'caro': '血肉', 'ultra': '超维'}
REALM_ORDER = ['chaos', 'aequor', 'caro', 'ultra']
REALM_TAGLINE = {
    'chaos': '可与任意界域混编 · 反击 / 打击 / 过牌',
    'aequor': '触腕体系 · 深渊号令',
    'caro': '日服译「狂魔」· 胚胎 / 中毒 / 卖血',
    'ultra': '超维空间 · 额外回合 / 斩杀',
}


def load_playstyle():
    """解析玩法层 character_skills.md → name → {realm, role, card}。

    玩法卡为单行段落，形如 `**名字**（注） — 定位。正文……`。
    name 归一化去掉「中文 / English」尾巴；realm 取自所在界域小节；
    role 取破折号后到首个句号/括号的片段；card 保留整行正文供详情页渲染。"""
    import re
    path = f'{PROCESSED_DIR}/character_skills.md'
    out = {}
    if not os.path.exists(path):
        return out
    realm = None
    with open(path, 'r', encoding='utf-8') as f:
        for ln in f:
            m = re.match(r'## (混沌|深海|血肉|超维)界域', ln)
            if m:
                realm = REALM_KEYS[m.group(1)]
                continue
            line = ln.rstrip('\n')
            m = re.match(r'\*\*([^*]+)\*\*(.*)', line)
            if not (m and realm):
                continue
            name = m.group(1).split(' / ')[0].split('（')[0].split('(')[0].strip()
            rest = m.group(2)
            # role = 破折号（— 或 -）后到首个分隔符的片段
            role = ''
            mm = re.search(r'[—-]\s*([^。；;，,（(]+)', rest)
            if mm:
                role = mm.group(1).strip()
            out[name] = {'realm': realm, 'role': role, 'card': line}
    return out


def _slug(ch):
    return str(ch['id'])


def _realm_badge(realm):
    if not realm:
        return '<span class="realm-badge" style="opacity:.5">界域待考</span>'
    return f'<span class="realm-badge realm-{realm}">{REALM_LABEL[realm]}</span>'


def _awakener_card(ch, p):
    """渲染图鉴/列表页的角色卡 <a>。title 与 name 重复时不重复显示。"""
    realm = p['realm'] if p else None
    accent = f' realm-accent-{realm}' if realm else ''
    role = (p.get('role') if p else '') or ('玩法待补' if p is None else '—')
    href = f'{SITE_BASE}zh/awakeners/{_slug(ch)}.html'
    title = ch.get('title', '')
    tcell = f'<span class="ac-title">{title}</span>' if title and title != ch['name'] else ''
    return (f'<a class="awakener-card{accent}" href="{href}">'
            f'<span class="ac-name">{ch["name"]}</span>'
            f'<span class="ac-role">{role}</span>{tcell}</a>')


def generate_voice_lines():
    """Generate voice lines page from voice_character_map.json.

    Uses the character-to-voice-line mapping built by text matching on
    AwakerVoiceTitle (pattern: 关于X) and UnlockDesc (pattern:
    获得唤醒体「X」后解锁).  Voice lines are grouped by character name
    where a mapping exists, with unmapped lines in a separate section.
    """
    map_path = f'{PROCESSED_DIR}/voice_character_map.json'
    if not os.path.exists(map_path):
        # Fallback to legacy voice_lines.json
        _generate_voice_lines_legacy()
        return

    with open(map_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    meta = data['_meta']
    lines = []
    lines.append('# 角色语音台词')
    lines.append('')
    lines.append(
        f'> 数据来源：Voice.lua + AwakerConfig.lua（运行时内存提取）'
        f' | 共 {meta["total_voice_entries"]} 条语音'
        f' / {meta["big_group_clusters"]} 个角色语音组'
        f' / {meta["about_relation_count"]} 条角色引用'
    )
    lines.append('')

    # --- Section 1: Character voice references ---
    char_voices = data.get('character_voices', {})
    if char_voices:
        lines.append('## 角色语音引用')
        lines.append('')
        lines.append(
            '以下语音台词通过标题文本匹配（「关于X」=谈论角色X）'
            '或解锁条件（「获得唤醒体「X」后解锁」）关联到具体角色。'
        )
        lines.append('')

        for char_name, char_data in char_voices.items():
            vls = char_data['voice_lines']
            if not vls:
                continue
            char_id_str = ', '.join(str(i) for i in char_data['character_ids'])
            lines.append(
                f'### {char_name}（ID: {char_id_str},'
                f' {char_data["voice_line_count"]} 条引用）'
            )
            lines.append('')

            for vl in vls:
                relation_tag = {
                    'about': '谈及',
                    'unlock_requires': '解锁需',
                    'speaker': '说话者',
                    'speaker_unconfirmed': '疑似说话者',
                }.get(vl['relation'], vl['relation'])

                lines.append(f'**{vl["title"]}** `[{relation_tag}]`')
                lines.append('')
                lines.append(f'> {vl["content"]}')
                unlock = vl.get('unlock_desc', '')
                if unlock:
                    lines.append('>')
                    lines.append(f'> *{unlock}*')
                lines.append('')

    # --- Section 2: Voice groups (big group clusters) ---
    voice_groups = data.get('voice_groups', [])
    if voice_groups:
        lines.append('## 角色语音组（主语音库）')
        lines.append('')
        lines.append(
            '::: info 说明\n'
            '以下 44 个语音组来自主语音库（ID 4908-6765），每组对应一位唤醒体。'
            '由于角色与语音组的对应关系存储在 Lua 字节码常量表中（未被字符串扫描捕获），'
            '当前通过排序聚类分组，说话者身份待确认。'
            '标题中带有「关于X」的台词已标注引用角色。\n'
            ':::'
        )
        lines.append('')

        for vg in voice_groups:
            # Collect referenced characters in this group
            referenced = set()
            for vl in vg['voice_lines']:
                ac = vl.get('about_character')
                if ac:
                    referenced.add(ac)

            ref_str = ''
            if referenced:
                ref_str = f'，谈及：{", ".join(sorted(referenced))}'

            lines.append(
                f'### 语音组 {vg["group_id"] + 1}'
                f'（ID {vg["id_range"]}，{vg["line_count"]} 条{ref_str}）'
            )
            lines.append('')

            # Group voice lines by category
            categories = {}
            for vl in vg['voice_lines']:
                # Extract category from title (part before the dot)
                title = vl['title']
                cat = _voice_category(title)
                if cat not in categories:
                    categories[cat] = []
                categories[cat].append(vl)

            for cat_name, cat_lines in categories.items():
                lines.append(f'#### {cat_name}')
                lines.append('')
                for vl in cat_lines:
                    title = vl['title']
                    content = vl['content']
                    unlock = vl.get('unlock_desc', '')
                    about = vl.get('about_character', '')

                    suffix = f' `[关于{about}]`' if about else ''
                    lines.append(f'**{title}**{suffix}')
                    lines.append('')
                    lines.append(f'> {content}')
                    if unlock:
                        lines.append('>')
                        lines.append(f'> *{unlock}*')
                    lines.append('')

    # --- Section 3: Small voice groups ---
    small_groups = data.get('small_voice_groups', [])
    if small_groups:
        lines.append('## 追加语音组')
        lines.append('')
        lines.append(
            '以下语音组来自其他 ID 区间，通常为版本更新追加的语音内容。'
        )
        lines.append('')

        for sg in small_groups:
            ref_chars = sg.get('referenced_characters', [])
            ref_str = ''
            if ref_chars:
                ref_str = f'，关联角色：{", ".join(ref_chars)}'

            lines.append(
                f'### 追加组（ID {sg["id_range"]}，'
                f'{sg["line_count"]} 条{ref_str}）'
            )
            lines.append('')

            for vl in sg['voice_lines']:
                title = vl['title']
                content = vl['content']
                unlock = vl.get('unlock_desc', '')
                about = vl.get('about_character', '')

                suffix = f' `[关于{about}]`' if about else ''
                lines.append(f'**{title}**{suffix}')
                lines.append('')
                lines.append(f'> {content}')
                if unlock:
                    lines.append('>')
                    lines.append(f'> *{unlock}*')
                lines.append('')

    # --- Section 4: Unmapped voice lines ---
    unmapped = data.get('unmapped_voices', [])
    if unmapped:
        lines.append('## 未映射语音')
        lines.append('')
        lines.append(
            f'以下 {len(unmapped)} 条语音暂无角色关联，'
            '标题中未包含可识别的角色名称或解锁条件。'
        )
        lines.append('')

        for vl in unmapped:
            title = vl['title']
            content = vl['content']
            unlock = vl.get('unlock_desc', '')

            lines.append(f'**{title}**')
            lines.append('')
            lines.append(f'> {content}')
            if unlock:
                lines.append('>')
                lines.append(f'> *{unlock}*')
            lines.append('')

    with open(f'{DOCS_DIR}/voice-lines.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Voice lines page: {len(lines)} lines written')


def _voice_category(title):
    """Extract a display category from a voice line title."""
    # Common category prefixes in voice titles
    prefixes = [
        '闲话', '同调率', '启灵', '获得提升', '调查', '唤醒',
        '灵知觉醒', '超限狂气爆发', '狂气爆发',
        '打击', '防御', '受击', '技能', '特殊技能',
    ]
    for p in prefixes:
        if title.startswith(p):
            return p
    return '其他'


def _generate_voice_lines_legacy():
    """Legacy generator using voice_lines.json (no character mapping)."""
    with open(f'{PROCESSED_DIR}/voice_lines.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    lines = []
    lines.append('# 角色语音台词')
    lines.append('')
    lines.append(
        f'> 数据来源：Voice.lua（运行时内存提取）'
        f' | 共 {data["_meta"]["total_lines"]} 条语音'
        f' / {data["_meta"]["character_groups"]} 个角色组'
    )
    lines.append('')
    lines.append('::: warning 注意')
    lines.append(
        '由于角色 ID 与角色名的映射关系存储在 Lua 字节码常量表中'
        '（未被字符串扫描捕获），当前以 ID 范围标识角色分组。'
    )
    lines.append(':::')
    lines.append('')

    for i, char in enumerate(data['characters']):
        lines.append(
            f'## 角色组 {i+1}（ID {char["id_range"]}，'
            f'{char["line_count"]} 条）'
        )
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
                    lines.append('>')
                    lines.append(f'> *{unlock}*')
                lines.append('')

    with open(f'{DOCS_DIR}/voice-lines.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Voice lines page (legacy): {len(lines)} lines')


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
    """Generate CG gallery page with iOS Photos-style dense grid + lightbox."""
    with open(f'{PROCESSED_DIR}/cg_gallery.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    available = set()
    public_dir = os.path.join(DOCS_DIR, 'public')
    for root, dirs, files in os.walk(os.path.join(public_dir, 'cg')):
        for fn in files:
            if fn.endswith('.png'):
                available.add(os.path.relpath(os.path.join(root, fn), public_dir))
    for root, dirs, files in os.walk(os.path.join(public_dir, 'scenebg')):
        for fn in files:
            if fn.endswith('.png'):
                available.add(os.path.relpath(os.path.join(root, fn), public_dir))

    meta = data['_meta']
    lines = []

    # Vue script + style for lightbox
    lines.append('<script setup>')
    lines.append('import { ref } from "vue"')
    lines.append('const show = ref(false)')
    lines.append('const src = ref("")')
    lines.append('const alt = ref("")')
    lines.append('function openCg(e) {')
    lines.append('  const img = e.target.closest("img")')
    lines.append('  if (img && img.closest(".cg-grid")) {')
    lines.append('    src.value = img.src')
    lines.append('    alt.value = img.alt')
    lines.append('    show.value = true')
    lines.append('  }')
    lines.append('}')
    lines.append('function closeCg() { show.value = false }')
    lines.append('</script>')
    lines.append('')
    lines.append('<style>')
    lines.append('.cg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:2px;margin:8px 0}')
    lines.append('@media(min-width:768px){.cg-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:3px}}')
    lines.append('.cg-grid img{width:100%;aspect-ratio:16/9;object-fit:cover;cursor:pointer;border-radius:2px;transition:opacity .15s}')
    lines.append('.cg-grid img:hover{opacity:.8}')
    lines.append('.cg-overlay{position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer}')
    lines.append('.cg-overlay img{max-width:95vw;max-height:90vh;object-fit:contain;border-radius:4px}')
    lines.append('.cg-overlay span{color:#888;font-size:13px;margin-top:8px}')
    lines.append('</style>')
    lines.append('')

    # Overlay component
    lines.append('<div v-if="show" class="cg-overlay" @click="closeCg">')
    lines.append('  <img :src="src" :alt="alt" />')
    lines.append('  <span>{{ alt }}</span>')
    lines.append('</div>')
    lines.append('')

    lines.append('# CG 画廊')
    lines.append('')
    lines.append(f'> 共 {meta["total_cg"]} 张 CG，{meta["story_chapters"]} 个章节 | 点击缩略图查看大图')
    lines.append('')

    displayed = 0
    listed = 0

    def render_grid(images, lines):
        nonlocal displayed, listed
        has_img = [img for img in images if img['path'] in available]
        no_img = [img for img in images if img['path'] not in available]

        if has_img:
            lines.append('<div class="cg-grid" @click="openCg">')
            for img in has_img:
                lines.append(f'<img :src="\'/{img["path"]}\'" alt="{img["name"]}" loading="lazy" />')
                displayed += 1
            lines.append('</div>')
            lines.append('')

        if no_img:
            lines.append(f'<details><summary>{len(no_img)} 张未包含图片文件</summary>')
            lines.append('')
            for img in no_img:
                lines.append(f'- `{img["name"]}`')
                listed += 1
            lines.append('')
            lines.append('</details>')
            lines.append('')

    lines.append('## 主线章节')
    lines.append('')
    for ch in data['chapters']:
        lines.append(f'### {ch["chapter_name"]}（{ch["image_count"]}）')
        lines.append('')
        render_grid(ch['images'], lines)

    if data.get('special'):
        lines.append('## 特殊 CG')
        lines.append('')
        for sg in data['special']:
            lines.append(f'### {sg["group_name"]}（{sg["image_count"]}）')
            lines.append('')
            render_grid(sg['images'], lines)

    scenebg_files = sorted([f for f in available if f.startswith('scenebg/')])
    if scenebg_files:
        lines.append('## 场景背景')
        lines.append('')
        lines.append('<div class="cg-grid" @click="openCg">')
        for f in scenebg_files:
            name = os.path.splitext(os.path.basename(f))[0]
            lines.append(f'<img :src="\'/{f}\'" alt="{name}" loading="lazy" />')
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
                lines.append(f'<img :src="\'/portrait-card/card/{img}\'" alt="{name}" style="width: 100%; border-radius: 6px; border: 1px solid #2a2a2a;" loading="lazy" />')
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
                lines.append(f'<img :src="\'/{rel}\'" alt="{name}" style="width: 100%; border-radius: 6px; border: 1px solid #2a2a2a;" loading="lazy" />')
                lines.append(f'<div style="font-size: 0.8em; color: #888; margin-top: 2px; word-break: break-all;">{name}</div>')
                lines.append(f'</div>')
                total += 1
            lines.append('</div>')
            lines.append('')

    with open(f'{DOCS_DIR}/ui-resources.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'UI resources gallery: {total} images')


CATEGORY_SECTIONS = [
    ('playable', '可玩唤醒体', '可获取、可编入队伍的正式唤醒体。'),
    ('unreleased', '未上线唤醒体', '客户端已埋入数据但游戏内尚未正式上线（含废弃卡池角色）。'),
    ('easter_egg', '彩蛋 / NPC', '非战斗角色或特殊彩蛋单位。'),
]
UNLOCK_LABEL = {
    'acquire_character': '获取角色后解锁', 'main_story': '主线剧情解锁',
    'star_arc': '星辰篇解锁', 'mind_dive': '意识潜游解锁',
    'special_record': '特遣纪录解锁', 'event_stage': '活动关卡解锁',
    'clear_stage': '通关关卡解锁', 'other': '其他', 'unknown': '未知',
}


def generate_characters():
    """Generate character encyclopedia from characters.json, grouped by the
    守密人-confirmed category (playable / unreleased / easter_egg). Story
    unlock / gossip cross-refs come from character_index.json when present."""
    with open(f'{PROCESSED_DIR}/characters.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    cidx = {}
    try:
        with open(f'{PROCESSED_DIR}/character_index.json', 'r', encoding='utf-8') as f:
            for c in json.load(f)['characters']:
                cidx[c['id']] = c
    except (FileNotFoundError, KeyError):
        pass

    meta = data['_meta']
    chars = data['characters']
    play = load_playstyle()
    by_cat = {}
    for ch in chars:
        by_cat.setdefault(ch.get('category', 'playable'), []).append(ch)

    playable = by_cat.get('playable', [])
    L = []
    L.append('# 唤醒体图鉴')
    L.append('')
    summary = '、'.join(f'{label} {len(by_cat.get(key, []))}'
                        for key, label, _ in CATEGORY_SECTIONS if by_cat.get(key))
    L.append(f'> 数据来源：AwakerConfig.lua（运行时内存提取） | 共 {meta["total_characters"]} 位唤醒体（{summary}）')
    L.append('>')
    L.append('> 分类经守密人逐一确认；「未上线」表示客户端已有数据但游戏内尚未正式开放。界域归属取自[玩法图鉴](/playstyle)（社区源，非解包）。')
    L.append('')
    L.append('点击任意可玩唤醒体进入其**详情页**（档案 + 界域定位 + 玩法 + 召唤台词 + 语音/CG 入口）。')
    L.append('')

    # —— 可玩：按界域分组成卡片网格 ——
    L.append('## 可玩唤醒体（按界域）')
    L.append('')
    by_realm = {}
    no_realm = []
    for ch in playable:
        p = play.get(ch['name'])
        (by_realm.setdefault(p['realm'], []).append((ch, p)) if p else no_realm.append(ch))
    for realm in REALM_ORDER:
        grp = by_realm.get(realm, [])
        if not grp:
            continue
        L.append(f'### {_realm_badge(realm)} {REALM_LABEL[realm]}界域（{len(grp)}）')
        L.append('')
        L.append(f'<p class="realm-tagline">{REALM_TAGLINE[realm]}</p>')
        L.append('')
        L.append('<div class="awakener-grid">')
        for ch, p in sorted(grp, key=lambda x: x[0]['id']):
            L.append(_awakener_card(ch, p))
        L.append('</div>')
        L.append('')
    if no_realm:
        L.append('### 界域待考（暂无玩法卡）')
        L.append('')
        L.append('<div class="awakener-grid">')
        for ch in sorted(no_realm, key=lambda x: x['id']):
            L.append(_awakener_card(ch, None))
        L.append('</div>')
        L.append('')

    # —— 未上线 / 彩蛋：紧凑表（无详情页）——
    for key, label, desc in CATEGORY_SECTIONS:
        if key == 'playable':
            continue
        group = by_cat.get(key, [])
        if not group:
            continue
        L.append(f'## {label}（{len(group)}）')
        L.append('')
        L.append(f'> {desc}')
        L.append('')
        L.append('| 名称 | 称号 | 声优 | 画师 |')
        L.append('|------|------|------|------|')
        for ch in sorted(group, key=lambda x: x['id']):
            L.append(f'| {ch["name"]} | {ch.get("title","")} | {ch.get("voice_actor","")} | {ch.get("painter","")} |')
        L.append('')

    with open(f'{DOCS_DIR}/characters.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(L))
    print(f'Characters page: {len(playable)} playable in {len(by_realm)} realms + '
          f'{sum(len(by_cat.get(k,[])) for k in ("unreleased","easter_egg"))} non-playable')

    generate_awakener_pages(chars, by_cat, play, cidx)
    generate_playstyle(playable, play)


def generate_awakener_pages(chars, by_cat, play, cidx):
    """每个可玩唤醒体一张详情页 docs/zh/awakeners/<id>.md，并重写列表页 index.md。"""
    out_dir = f'{DOCS_DIR}/zh/awakeners'
    os.makedirs(out_dir, exist_ok=True)
    # 清掉旧的烂尾样板页（pandia.md 依赖已清空的 db 数据层）
    stale = f'{out_dir}/pandia.md'
    if os.path.exists(stale):
        os.remove(stale)

    playable = by_cat.get('playable', [])
    count = 0
    for ch in playable:
        p = play.get(ch['name'])
        realm = p['realm'] if p else None
        ci = cidx.get(ch['id'], {})
        D = []
        D.append('---')
        D.append(f'title: {ch["name"]} - 唤醒体详情')
        D.append('---')
        D.append('')
        D.append(f'# {ch["name"]}')
        D.append('')
        badges = _realm_badge(realm)
        if p and p.get('role'):
            badges += f' <span class="role-badge">{p["role"]}</span>'
        D.append(f'<p class="awakener-badges">{badges}</p>')
        D.append('')
        if ch.get('title') and ch['title'] != ch['name']:
            D.append(f'> {ch["title"]}')
            D.append('')
        # 档案表
        D.append('## 档案')
        D.append('')
        D.append('| 属性 | 信息 |')
        D.append('|------|------|')
        for lab, key in [('称号', 'title'), ('性别', 'gender'), ('生日', 'birthday'),
                         ('身高', 'height'), ('体重', 'weight'), ('GI 值', 'gi'),
                         ('声优', 'voice_actor'), ('画师', 'painter'),
                         ('战斗特征', 'characteristic')]:
            v = ch.get(key)
            if v:
                D.append(f'| {lab} | {v} |')
        if ci.get('story_unlock_type'):
            D.append(f'| 故事解锁 | {UNLOCK_LABEL.get(ci["story_unlock_type"], ci["story_unlock_type"])} |')
        if ci.get('gossip_about_count'):
            D.append(f'| 被提及（闲话） | {ci["gossip_about_count"]} 条 |')
        D.append('')
        if ch.get('introduction'):
            D.append('## 简介')
            D.append('')
            D.append(f'> {ch["introduction"]}')
            D.append('')
        # 玩法
        D.append('## 界域与玩法')
        D.append('')
        if p:
            D.append('::: tip 玩法定位（社区源，非解包，数值随版本浮动）')
            D.append(p['card'])
            D.append(':::')
        else:
            D.append('::: warning 玩法待补')
            D.append(f'{ch["name"]} 的技能玩法卡尚未收录。技能数据为已知解包缺口，'
                     '待社区源补全后并入[玩法图鉴](/playstyle)。')
            D.append(':::')
        D.append('')
        if ch.get('gameplay_intro'):
            D.append(f'**官方战斗机制描述：** {ch["gameplay_intro"]}')
            D.append('')
        if ch.get('summon_slogan'):
            D.append(f'<p class="summon-slogan">「{ch["summon_slogan"]}」</p>')
            D.append('')
        # 延伸入口
        D.append('## 延伸资料')
        D.append('')
        D.append(f'- [语音台词](/voice-lines)（搜索「{ch["name"]}」）')
        D.append('- [CG 画廊](/cg-gallery) · [角色立绘](/portraits)')
        D.append('- [战斗机制总览](/battle-system) · [玩法图鉴](/playstyle)')
        D.append('')
        D.append('[← 返回唤醒体图鉴](/characters)')
        D.append('')
        with open(f'{out_dir}/{_slug(ch)}.md', 'w', encoding='utf-8') as f:
            f.write('\n'.join(D))
        count += 1

    # 列表页（带界域分组网格）
    by_realm = {}
    no_realm = []
    for ch in playable:
        p = play.get(ch['name'])
        (by_realm.setdefault(p['realm'], []).append((ch, p)) if p else no_realm.append(ch))
    I = []
    I.append('---')
    I.append('title: 唤醒体列表')
    I.append('---')
    I.append('')
    I.append('# 唤醒体列表')
    I.append('')
    I.append(f'> 共 {len(playable)} 位可玩唤醒体，按界域分组。点击进入详情页。')
    I.append('')
    for realm in REALM_ORDER:
        grp = by_realm.get(realm, [])
        if not grp:
            continue
        I.append(f'## {_realm_badge(realm)} {REALM_LABEL[realm]}（{len(grp)}）')
        I.append('')
        I.append('<div class="awakener-grid">')
        for ch, p in sorted(grp, key=lambda x: x[0]['id']):
            I.append(_awakener_card(ch, p))
        I.append('</div>')
        I.append('')
    with open(f'{out_dir}/index.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(I))
    print(f'Awakener detail pages: {count} pages + index')


def generate_playstyle(playable, play):
    """玩法图鉴 docs/playstyle.md：按界域罗列玩法卡（沿用 character_skills.md 正文）。"""
    src = f'{PROCESSED_DIR}/character_skills.md'
    if not os.path.exists(src):
        return
    with open(src, 'r', encoding='utf-8') as f:
        body = f.read()
    # 去掉原档一级标题（与本页标题重复），其余正文原样保留（含 [[toc]] 等）
    parts = body.split('\n', 1)
    rest = parts[1] if len(parts) > 1 else ''
    legend = ['<p class="realm-legend">']
    for realm in REALM_ORDER:
        legend.append(f'{_realm_badge(realm)} {REALM_TAGLINE[realm]}<br>')
    legend.append('</p>')
    out = (
        '---\ntitle: 玩法图鉴\n---\n\n'
        '# 玩法图鉴\n\n'
        + '\n'.join(legend) + '\n'
        + rest
    )
    with open(f'{DOCS_DIR}/playstyle.md', 'w', encoding='utf-8') as f:
        f.write(out)
    print('Playstyle page generated.')


def generate_summon():
    """Generate summon/gacha page, deduplicated by title."""
    with open(f'{PROCESSED_DIR}/summon.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    meta = data['_meta']
    banners = data['banners']

    named = [b for b in banners if b.get('title')]
    unnamed = [b for b in banners if not b.get('title')]

    # Group named banners by title
    from collections import OrderedDict
    groups = OrderedDict()
    for b in named:
        title = b['title']
        if title not in groups:
            groups[title] = []
        groups[title].append(b)

    lines = []
    lines.append('# 唤醒系统')
    lines.append('')
    lines.append(f'> Summon.lua | {meta["total_banners"]} 条记录，{len(groups)} 个唯一卡池')
    lines.append('')

    # Standard rate table (shared by ~95% of banners)
    std_ssr = 'SSR物品基础出率：3.03%（含保底综合出率：5.02%）'

    for title, group in groups.items():
        representative = group[0]
        lines.append(f'### {title}')
        lines.append('')
        lines.append(f'**{representative["name"]}**')
        if representative['desc']:
            lines.append(f' -- {representative["desc"]}')
        lines.append('')
        if representative['short_desc']:
            lines.append(f'> {representative["short_desc"]}')
            lines.append('')

        # Rate-up characters/items as compact list
        rate_ups = []
        for b in group:
            if b['rate_up'] and b['rate_up'] not in rate_ups:
                rate_ups.append(b['rate_up'])

        if rate_ups:
            if len(rate_ups) == 1:
                lines.append(f'UP: {rate_ups[0]}')
            else:
                lines.append(f'UP 角色/命轮（{len(rate_ups)} 期）：')
                lines.append('')
                for ru in rate_ups:
                    lines.append(f'- {ru}')
            lines.append('')

        # Show rate table only if non-standard or first occurrence
        is_std = representative.get('rate_ssr', '').startswith('SSR物品基础出率：3.03%')
        if not is_std and (representative['rate_ssr'] or representative['rate_sr'] or representative['rate_r']):
            lines.append('| 稀有度 | 概率 |')
            lines.append('|--------|------|')
            if representative['rate_ssr']:
                lines.append(f'| SSR | {representative["rate_ssr"]} |')
            if representative['rate_sr']:
                lines.append(f'| SR | {representative["rate_sr"]} |')
            if representative['rate_r']:
                lines.append(f'| R | {representative["rate_r"]} |')
            lines.append('')

        # Multiple realm variants
        descs = list(OrderedDict.fromkeys(b['short_desc'] for b in group if b['short_desc']))
        if len(descs) > 1:
            lines.append(f'界域变体：{" / ".join(descs)}')
            lines.append('')

        if len(group) > 1:
            lines.append(f'*共 {len(group)} 期*')
            lines.append('')

        lines.append('---')
        lines.append('')

    if unnamed:
        lines.append('## 其他卡池')
        lines.append('')
        lines.append('| 名称 | 说明 |')
        lines.append('|------|------|')
        for b in unnamed:
            desc = b['desc'] or b['short_desc'] or ''
            lines.append(f'| {b["name"]} | {desc[:80]} |')
        lines.append('')

    # Appendix: standard rates
    lines.append('## 标准概率表')
    lines.append('')
    lines.append('绝大多数卡池共享以下概率：')
    lines.append('')
    lines.append('| 稀有度 | 概率 |')
    lines.append('|--------|------|')
    lines.append(f'| SSR | {std_ssr} |')
    lines.append('| SR | SR物品基础出率：15.85%（含保底综合出率：25.00%） |')
    lines.append('| R | R物品基础出率：81.12%（含保底综合出率：69.98%） |')
    lines.append('')

    with open(f'{DOCS_DIR}/summon.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Summon page: {len(groups)} unique titles (from {len(named)} records) + {len(unnamed)} other')


def generate_stages():
    """Generate stage/dungeon navigation page from stages.json."""
    with open(f'{PROCESSED_DIR}/stages.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    meta = data['_meta']
    groups = data['groups']
    lines = []
    lines.append('# 关卡导航')
    lines.append('')
    lines.append(f'> 数据来源：Stage.lua + StageGroup.lua（运行时内存提取） | {meta["total_groups"]} 个关卡组 / {meta["total_stages"]} 个关卡')
    lines.append('')

    by_type = {}
    for g in groups:
        t = g.get('type') or '其他'
        if t not in by_type:
            by_type[t] = []
        by_type[t].append(g)

    sorted_types = sorted(by_type.keys(), key=lambda t: -len(by_type[t]))

    for stage_type in sorted_types:
        type_groups = by_type[stage_type]
        seen_names = set()
        unique = []
        for g in type_groups:
            if g['name'] not in seen_names:
                seen_names.add(g['name'])
                unique.append(g)

        lines.append(f'## {stage_type}（{len(type_groups)} 组）')
        lines.append('')
        lines.append('| 名称 | 说明 | 奖励 |')
        lines.append('|------|------|------|')
        for g in unique:
            reward = g.get('reward_desc', '')
            lines.append(f'| {g["name"]} | {g["desc"][:60]} | {reward} |')
        lines.append('')

    with open(f'{DOCS_DIR}/stages.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Stages page: {len(sorted_types)} types, {len(groups)} groups')


def generate_audio_index():
    """Generate audio page. If OGG files exist locally, embed inline players."""
    RELEASE_URL = 'https://github.com/lightproud/brain-in-a-vat/releases/tag'
    audio_dir = f'{DOCS_DIR}/public/audio'
    ogg_files = sorted(glob.glob(f'{audio_dir}/**/*.ogg', recursive=True) +
                       glob.glob(f'{audio_dir}/*.ogg'))

    lines = []
    lines.append('# 音频资产')
    lines.append('')

    if ogg_files:
        lines.append(f'> 共 {len(ogg_files)} 条音轨 | 在线播放')
        lines.append('')
        lines.append(f'::: info\n批量下载请前往 [GitHub Releases]({RELEASE_URL}/audio-assets-v1)。\n:::')
        lines.append('')
        for ogg in ogg_files:
            rel = os.path.relpath(ogg, f'{DOCS_DIR}/public')
            name = os.path.splitext(os.path.basename(ogg))[0]
            lines.append(f'**{name}**')
            lines.append('')
            lines.append(f'<audio controls preload="none" src="/{rel}"></audio>')
            lines.append('')
    else:
        lines.append('> 数据来源：Wwise 音频银行解包 + 格式转换 | 共 2,325 条 OGG 音轨')
        lines.append('')
        lines.append(f'全部音轨发布于 [GitHub Releases `audio-assets-v1`]({RELEASE_URL}/audio-assets-v1)，分为两个压缩包：')
        lines.append('')
        lines.append('| 文件 | 内容 |')
        lines.append('|------|------|')
        lines.append('| `morimens-audio-ogg-part1.tar.gz` | 1,132 条音轨 + 61 条 bnk 派生音频 |')
        lines.append('| `morimens-audio-ogg-part2.tar.gz` | 1,132 条音轨 |')
        lines.append('')
        lines.append(f'原始 Wwise 文件见 [GitHub Releases `audio-raw-v1`]({RELEASE_URL}/audio-raw-v1)。')
        lines.append('')

    with open(f'{DOCS_DIR}/audio.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Audio index page: {len(ogg_files)} tracks ({"inline" if ogg_files else "links only"})')


def generate_video_index():
    """Generate video page. If MP4 files exist locally, embed inline players."""
    RELEASE_URL = 'https://github.com/lightproud/brain-in-a-vat/releases/tag'
    video_dir = f'{DOCS_DIR}/public/video'
    mp4_files = sorted(glob.glob(f'{video_dir}/**/*.mp4', recursive=True) +
                       glob.glob(f'{video_dir}/*.mp4'))

    # Classify videos by filename prefix
    def _video_category(name):
        if name.startswith('C0') or name.startswith('C20'):
            return '章节过场'
        if 'CG_SD' in name:
            return 'CG SD 动画'
        if 'GN_Switch' in name:
            return '场景过渡'
        if name.startswith('RD_'):
            return 'RD 场景'
        if name.startswith('Vx_') or name.startswith('VX_'):
            return '超维视频'
        if 'Logo' in name:
            return 'Logo'
        if 'PV' in name or 'Login' in name:
            return '登录 PV'
        if 'AVG' in name:
            return 'AVG 过渡'
        return '其他'

    lines = []
    lines.append('# 视频资产')
    lines.append('')

    if mp4_files:
        lines.append(f'> 共 {len(mp4_files)} 个视频 | 在线播放')
        lines.append('')
        lines.append(f'::: info\n批量下载请前往 [GitHub Releases]({RELEASE_URL}/video-assets-v1)。\n:::')
        lines.append('')

        cats = {}
        for mp4 in mp4_files:
            name = os.path.splitext(os.path.basename(mp4))[0]
            cat = _video_category(name)
            if cat not in cats:
                cats[cat] = []
            cats[cat].append(mp4)

        for cat_name, files in cats.items():
            lines.append(f'## {cat_name}（{len(files)}）')
            lines.append('')
            for mp4 in files:
                rel = os.path.relpath(mp4, f'{DOCS_DIR}/public')
                name = os.path.splitext(os.path.basename(mp4))[0]
                lines.append(f'### {name}')
                lines.append('')
                lines.append(f'<video controls preload="none" width="100%" src="/{rel}"></video>')
                lines.append('')
    else:
        lines.append('> 共 201 个 MP4 文件（975 MB）')
        lines.append('')
        lines.append(f'全部视频发布于 [GitHub Releases `video-assets-v1`]({RELEASE_URL}/video-assets-v1)。')
        lines.append('')
        lines.append('| 分类 | 内容 |')
        lines.append('|------|------|')
        lines.append('| 章节过场 | C00-C09, C202-C203 主线剧情动画 |')
        lines.append('| CG SD 动画 | SD 风格角色动画片段 |')
        lines.append('| 登录 PV | 启动及登录界面宣传影片 |')
        lines.append('| 场景过渡 | GN_Switch 界面切换动画 |')
        lines.append('| 超维视频 | 版本更新演示视频 |')
        lines.append('| AVG 过渡 | 文字冒险模式过渡动画 |')
        lines.append('')
    lines.append('')

    with open(f'{DOCS_DIR}/video.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Video index page: {len(mp4_files)} videos ({"inline" if mp4_files else "links only"})')


def generate_panel_text():
    """Generate panel text reference page from panel_text.json, grouped by UI category."""
    with open(f'{PROCESSED_DIR}/panel_text.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    meta = data['_meta']
    categories = data['categories']

    # Human-readable category labels
    cat_labels = {
        'Events': '活动系统', 'Awaker': '唤醒体', 'Pvp': 'PvP / 相位对弈',
        'Social': '社交', 'Dungeons': '地下城', 'Dungeous': '地下城（旧）',
        'Event': '活动', 'Recharge': '充值商店', 'Summon': '召唤/唤醒',
        'Passport': '通行证', 'Team': '队伍编成', 'Battle': '战斗',
        'Shop': '商店', 'Collection': '收藏馆', 'Alchemy': '冶炼室',
        'Mail': '邮件', 'Card': '卡牌', 'Bag': '背包',
        'Research': '研究', 'Home': '大厅', 'Homeland': '家园',
        'Guide': '引导', 'Story': '剧情', 'Chapter': '章节',
        'Chaper': '章节（旧）', 'Copy': '副本', 'Task': '任务',
        'Setting': '设置', 'Login': '登录', 'Address': '通讯器',
        'Weapon': '命轮', 'Keeper': '守护者', 'Item': '道具',
        'Common': '通用', 'Michi': '密契', 'Protagonist': '守密人',
        'Community': '社区', 'Course': '教程', 'InvitationCode': '邀请码',
        'Announcement': '公告', 'Vindicate': '申辩', 'Pocket': '口袋',
        'Main': '主界面', 'PopMsg': '弹窗消息', 'Popup': '弹窗',
        'Dbgcopy': '调试副本', 'Vx': '超维', 'PVP': 'PvP',
        'Suummoon': '召唤（旧）', 'Icon': '图标', 'Btn': '按钮',
        'Com': '组件', 'Panel': '面板', 'Text': '文本',
        'Simple': '简易', 'Other': '其他',
    }

    lines = []
    lines.append('# UI 面板文本')
    lines.append('')
    lines.append(f'> 数据来源：PanelText.lua（运行时内存提取） | 共 {meta["total_entries"]} 条，{meta["total_categories"]} 个分类')
    lines.append('')
    lines.append('::: info 说明')
    lines.append('本页收录游戏客户端中所有 UI 面板的静态文本字符串，按功能模块分类展示。文本键名中的层级结构反映了 UI 组件的嵌套关系。')
    lines.append(':::')
    lines.append('')

    # Table of contents
    lines.append('## 分类索引')
    lines.append('')
    sorted_cats = sorted(categories.items(), key=lambda x: -len(x[1]))
    seen_ids = {}
    cat_anchors = {}
    for cat, items in sorted_cats:
        anchor = cat.lower()
        if anchor in seen_ids:
            seen_ids[anchor] += 1
            anchor = f'{anchor}-{seen_ids[anchor]}'
        else:
            seen_ids[anchor] = 0
        cat_anchors[cat] = anchor
        label = cat_labels.get(cat, cat)
        lines.append(f'- [{label}（{len(items)}）](#{anchor})')
    lines.append('')

    # Each category
    for cat, items in sorted_cats:
        label = cat_labels.get(cat, cat)
        anchor = cat_anchors[cat]
        lines.append(f'## {label} {{#{anchor}}}')
        lines.append('')
        lines.append(f'共 {len(items)} 条')
        lines.append('')
        lines.append('| 键名 | 文本 |')
        lines.append('|------|------|')
        for entry in items:
            # Shorten key for display: remove PanelText_UI_ or PanelText_ prefix
            display_key = entry['key']
            if display_key.startswith('PanelText_UI_'):
                display_key = display_key[13:]
            elif display_key.startswith('PanelText_'):
                display_key = display_key[10:]
            val = entry['value'].replace('|', '/').replace('\n', ' ')
            if len(val) > 120:
                val = val[:117] + '...'
            lines.append(f'| `{display_key}` | {val} |')
        lines.append('')

    with open(f'{DOCS_DIR}/panel-text.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Panel text page: {meta["total_entries"]} entries in {meta["total_categories"]} categories')


def generate_update_notices():
    """Generate update notices timeline page from update_notices.json."""
    import re as _re

    with open(f'{PROCESSED_DIR}/update_notices.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    meta = data['_meta']
    notices = [n for n in data['notices']
               if not n['text'].lstrip().startswith('{')
               and len(n['text']) < 50000]

    # Classify notices into types for better presentation
    full_notes = []      # Long entries with newlines (complete patch notes)
    maintenance = []     # Maintenance announcements
    bug_fixes = []       # Individual bug fix lines
    compensation = []    # Compensation notices
    feature_notes = []   # Feature/design notes from Light or designers
    activity_rules = []  # Activity/event rules
    other = []           # Everything else

    for n in notices:
        text = n['text']
        if '\n' in text and len(text) > 400:
            full_notes.append(n)
        elif _re.search(r'(设施修复|设施维护|設施修復|設施維護|预计于|將於|将于)', text):
            maintenance.append(n)
        elif text.startswith(('● ', '○ ')):
            bug_fixes.append(n)
        elif _re.search(r'(补偿|補償|补给物资|補給物資)', text) and len(text) < 200:
            compensation.append(n)
        elif _re.search(r'(校猫|校貓|設計師|设计师)', text):
            feature_notes.append(n)
        elif _re.search(r'(活动|活動|守密人可|规则|規則)', text) and len(text) > 80:
            activity_rules.append(n)
        else:
            other.append(n)

    lines = []
    lines.append('# 更新公告')
    lines.append('')
    lines.append(f'> 数据来源：UpdateNotices.lua（游戏客户端内嵌更新公告） | 共 {meta["total_entries"]} 条')
    lines.append('')
    lines.append('::: info 说明')
    lines.append('本页收录游戏客户端中内嵌的更新公告、维护通知和补丁说明。内容包含简体中文和繁体中文两个版本的公告文本（游戏同时服务两岸三地玩家）。完整版公告以折叠形式呈现。')
    lines.append(':::')
    lines.append('')

    # Summary
    lines.append('## 内容概览')
    lines.append('')
    lines.append(f'| 类别 | 数量 |')
    lines.append(f'|------|------|')
    lines.append(f'| 完整版更新公告 | {len(full_notes)} |')
    lines.append(f'| 维护通知 | {len(maintenance)} |')
    lines.append(f'| 问题修复记录 | {len(bug_fixes)} |')
    lines.append(f'| 补偿通知 | {len(compensation)} |')
    lines.append(f'| 制作人/设计师手记 | {len(feature_notes)} |')
    lines.append(f'| 活动规则说明 | {len(activity_rules)} |')
    lines.append(f'| 其他 | {len(other)} |')
    lines.append('')

    # Full patch notes (most valuable)
    if full_notes:
        lines.append('## 完整版更新公告')
        lines.append('')
        lines.append(f'共 {len(full_notes)} 篇完整公告（含维护说明、补偿内容和详细更新日志）。')
        lines.append('')
        for n in full_notes:
            text = n['text']
            # Extract a preview (first line or first 100 chars)
            first_line = text.split('\n')[0].strip()
            if len(first_line) > 100:
                first_line = first_line[:97] + '...'
            lines.append(f'<details>')
            lines.append(f'<summary>#{n["id"]} - {first_line}</summary>')
            lines.append('')
            # Render the full text with proper line breaks
            for para in text.split('\n'):
                para = para.strip()
                if para:
                    lines.append(para)
                    lines.append('')
            lines.append('</details>')
            lines.append('')

    # Designer notes
    if feature_notes:
        lines.append('## 制作人与设计师手记')
        lines.append('')
        lines.append('来自弥萨格校猫 Light 和各位设计师的开发札记与设计思路。')
        lines.append('')
        for n in feature_notes:
            text = n['text'].replace('\n', ' ').strip()
            if len(text) > 300:
                lines.append(f'<details>')
                lines.append(f'<summary>#{n["id"]} - {text[:80]}...</summary>')
                lines.append('')
                lines.append(text)
                lines.append('')
                lines.append('</details>')
            else:
                lines.append(f'> **#{n["id"]}** {text}')
            lines.append('')

    # Maintenance
    if maintenance:
        lines.append('## 维护通知')
        lines.append('')
        for n in maintenance:
            text = n['text'].replace('\n', ' ').strip()
            if len(text) > 150:
                text = text[:147] + '...'
            lines.append(f'- **#{n["id"]}** {text}')
        lines.append('')

    # Bug fixes
    if bug_fixes:
        lines.append('## 问题修复记录')
        lines.append('')
        lines.append(f'共 {len(bug_fixes)} 条独立修复/优化记录。')
        lines.append('')
        for n in bug_fixes:
            text = n['text'].replace('\n', ' ').strip()
            if len(text) > 200:
                text = text[:197] + '...'
            lines.append(f'- {text}')
        lines.append('')

    # Compensation
    if compensation:
        lines.append('## 补偿通知')
        lines.append('')
        for n in compensation:
            text = n['text'].replace('\n', ' ').strip()
            lines.append(f'- **#{n["id"]}** {text}')
        lines.append('')

    # Activity rules
    if activity_rules:
        lines.append('## 活动规则说明')
        lines.append('')
        for n in activity_rules:
            text = n['text'].replace('\n', ' ').strip()
            if len(text) > 200:
                text = text[:197] + '...'
            lines.append(f'- **#{n["id"]}** {text}')
        lines.append('')

    # Other
    if other:
        lines.append('## 其他公告内容')
        lines.append('')
        lines.append(f'<details>')
        lines.append(f'<summary>展开查看其余 {len(other)} 条</summary>')
        lines.append('')
        for n in other:
            text = n['text'].replace('\n', ' ').strip()
            if len(text) > 200:
                text = text[:197] + '...'
            lines.append(f'- **#{n["id"]}** {text}')
        lines.append('')
        lines.append('</details>')
        lines.append('')

    with open(f'{DOCS_DIR}/update-notices.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'Update notices page: {len(notices)} entries ({len(full_notes)} full notes, {len(maintenance)} maintenance, {len(bug_fixes)} fixes)')


def generate_story():
    """Generate the chapter-organized story timeline page from the story/
    structured layer (story_units / index / lore_entries / stages_by_unit)."""
    import html as _html
    sd = f'{PROCESSED_DIR}/story'
    try:
        idx = json.load(open(f'{sd}/index.json', encoding='utf-8'))['index']
        lore = {e['id']: e for e in json.load(open(f'{sd}/lore_entries.json', encoding='utf-8'))['entries']}
        sbu = json.load(open(f'{sd}/stages_by_unit.json', encoding='utf-8'))['by_unit']
    except FileNotFoundError:
        print('Story layer not found; skipping story page')
        return

    def esc(t):
        return _html.escape(t or '', quote=False)

    tl = {'prologue': '序章', 'main_chapter': '主线', 'star_chapter': '星辰篇', 'mind_dive': '意识潜游'}
    L = ['# 剧情时间线', '']
    L.append('> 按**剧情单元**（序章 → 调查行动主线 → 意识潜游）组织的故事浏览页。')
    L.append('> 数据来源：CollectionHall.lua（收藏馆词条，正文逐字）+ StageGroup.lua（关卡组）。')
    L.append('>')
    L.append('> 全量收藏馆词条见[收藏馆百科](/collection-hall)；本页仅含可挂到剧情章节的词条。')
    L.append('')
    L.append('## 章节概览')
    L.append('')
    L.append('| 单元 | 类型 | 词条 | 关卡组 | 关联角色 |')
    L.append('|------|------|------|--------|---------|')
    for u in idx:
        if not u['lore_count'] and not u['stage_group_count']:
            continue
        chars = '、'.join(esc(c) for c in u['characters']) if u['characters'] else '—'
        L.append(f"| {esc(u['unit'])} | {tl.get(u['type'], u['type'])} | {u['lore_count']} | {u['stage_group_count']} | {chars} |")
    L.append('')
    L.append('---')
    L.append('')
    for u in idx:
        if not u['lore_ids'] and not u['stage_group_ids']:
            continue
        L.append(f"## {esc(u['unit'])}")
        L.append('')
        sub = tl.get(u['type'], u['type'])
        if u['type'] == 'main_chapter' and u['chapter_no'] is not None:
            sub += f" · 第 {u['chapter_no']} 章"
        L.append(f'*{sub}*')
        L.append('')
        if u['characters']:
            L.append(f"**关联角色**：{'、'.join(esc(c) for c in u['characters'])}")
            L.append('')
        if u['stage_group_ids']:
            grps = sbu.get(u['unit'], [])
            L.append('**关卡组**：' + '、'.join(esc(g['name']) for g in grps))
            L.append('')
        if u['lore_ids']:
            L.append('### 收藏馆词条')
            L.append('')
            for lid in u['lore_ids']:
                e = lore.get(lid, {})
                L.append(f"#### {esc(e.get('title', ''))}")
                L.append('')
                d = e.get('desc', '')
                L.append(esc(d) if d else '*（无正文）*')
                L.append('')
                if e.get('lock_tip'):
                    L.append(f"<small>解锁：{esc(e['lock_tip'])}</small>")
                    L.append('')
        L.append('---')
        L.append('')
    with open(f'{DOCS_DIR}/story.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(L))
    print(f'Story page: {len([u for u in idx if u["lore_ids"] or u["stage_group_ids"]])} story units')


if __name__ == '__main__':
    generate_voice_lines()
    generate_collection_hall()
    generate_cg_gallery()
    generate_item_stories()
    generate_portraits_gallery()
    generate_bunit_gallery()
    generate_icons_gallery()
    generate_ui_gallery()
    generate_characters()
    generate_story()
    generate_summon()
    generate_stages()
    generate_audio_index()
    generate_video_index()
    generate_panel_text()
    generate_update_notices()
    print('All wiki pages generated.')
