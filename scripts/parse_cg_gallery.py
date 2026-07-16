"""Parse art_assets manifest.json to extract CG gallery data grouped by chapter."""
# NOTE: 源数据 projects/wiki/data/extracted/（art_assets 清单）已于 2026-07-12 守密人裁定整删
#       （目录规范化 + wiki 冻结）。重跑前先从 git 历史或 Releases 美术桶还原源数据。
import json
import re

def parse_cg_gallery(manifest_path):
    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    # manifest is a dict with 'files' array; CG entries have paths starting with 'cg/'
    all_files = manifest.get('files', [])
    cg_entries = [f for f in all_files if f.get('path', '').startswith('cg/')]

    # Group by chapter
    chapters = {}
    special_groups = {}

    # Chapter name mapping
    chapter_names = {
        '00': 'Arc 1 - Prologue (序章)',
        '01': 'Arc 1 - Ch.1 东区秘事',
        '02': 'Arc 1 - Ch.2 以蜡像之名',
        '03': 'Arc 1 - Ch.3',
        '04': 'Arc 1 - Ch.4',
        '05': 'Arc 1 - Ch.5',
        '06': 'Arc 1 - Ch.6',
        '07': 'Arc 1 - Ch.7',
        '08': 'Arc 1 - Ch.8 (终章)',
        '201': 'Arc 2 - Prologue (序章)',
        '202': 'Arc 2 - Ch.1',
        '203': 'Arc 2 - Ch.2',
        '204': 'Arc 2 - Ch.3',
        '205': 'Arc 2 - Ch.4',
        '09': 'Arc 1 - Interlude (幕间)',
    }

    # Special non-chapter categories
    special_names = {
        'cg_coll': 'Collection CG (收藏CG)',
        'cg_sd': 'SD / Chibi CG (Q版CG)',
    }

    for entry in cg_entries:
        name = entry.get('name', '')
        path = entry.get('path', '')

        # Extract chapter from path directory: cg/c00/..., cg/c201/...
        chapter_key = None
        parts = path.split('/')
        if len(parts) >= 2:
            m = re.match(r'c(\d+)', parts[1])
            if m:
                chapter_key = m.group(1)

        if chapter_key is not None:
            if chapter_key not in chapters:
                chapters[chapter_key] = {
                    'chapter_id': chapter_key,
                    'chapter_name': chapter_names.get(chapter_key, f'Chapter {chapter_key}'),
                    'images': [],
                }
            chapters[chapter_key]['images'].append({
                'name': name,
                'path': path,
                'size': entry.get('size', 0),
            })
        else:
            # Group into special categories by subdir
            subdir = parts[1] if len(parts) >= 2 else 'other'
            if subdir not in special_groups:
                special_groups[subdir] = {
                    'group_id': subdir,
                    'group_name': special_names.get(subdir, subdir),
                    'images': [],
                }
            special_groups[subdir]['images'].append({
                'name': name,
                'path': path,
                'size': entry.get('size', 0),
            })

    # Sort chapters
    sorted_chapters = []
    for key in sorted(chapters.keys(), key=lambda x: int(x)):
        ch = chapters[key]
        ch['image_count'] = len(ch['images'])
        ch['images'].sort(key=lambda x: x['name'])
        sorted_chapters.append(ch)

    # Build special groups list
    sorted_specials = []
    total_special = 0
    for key in sorted(special_groups.keys()):
        sg = special_groups[key]
        sg['image_count'] = len(sg['images'])
        sg['images'].sort(key=lambda x: x['name'])
        total_special += sg['image_count']
        sorted_specials.append(sg)

    result = {
        '_meta': {
            'source': 'art_assets/manifest.json (UnityPy extraction)',
            'total_cg': len(cg_entries),
            'story_chapters': len(sorted_chapters),
            'special_groups': len(sorted_specials),
            'generated': '2026-04-12',
        },
        'chapters': sorted_chapters,
        'special': sorted_specials,
    }

    return result


if __name__ == '__main__':
    src = 'projects/wiki/data/extracted/art_assets/manifest.json'
    dst = 'projects/wiki/data/processed/cg_gallery.json'
    data = parse_cg_gallery(src)
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    meta = data['_meta']
    print(f"CG gallery: {meta['total_cg']} images in {meta['story_chapters']} chapters + {meta['special_groups']} special groups -> {dst}")
    for ch in data['chapters']:
        print(f"  {ch['chapter_id']}: {ch['chapter_name']} ({ch['image_count']} images)")
