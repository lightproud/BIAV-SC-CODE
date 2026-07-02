#!/usr/bin/env python3
"""migrate_flat_archives_to_layout.py — 平级历史归档一次性归位到区服/类型分层。

背景（2026-07-02 体质改进 P1-4）：2026-06-22 起写方按甲方案分层落盘
（steam/global/review/ 等），但此前的历史文件仍平铺在 <平台>/ 顶层，形成
「新数据进新楼、历史住旧平房」的半迁移状态——读方必须永远维护双布局兼容，
且是 6 源假 degraded 一类事故的温床。本脚本把平级历史一次性迁入规范落点，
落点由 archive_layout（布局单一真相源）解析，与现行写方完全一致。

迁移范围（仅「新数据已走分层」的平台；taptap 系写方仍平铺、不在本次范围）：
  steam/*.json             -> steam/global/review/
  official/*.json          -> steam/global/news/      （目录清空后移除）
  steam_discussion/*.json  -> steam/global/discussion/（目录清空后移除）
  appstore/*.json          -> appstore/global/
  google_play/*.json       -> google_play/global/
  youtube/*.json           -> youtube/global/video/

区服正确性依据：历史文件全部来自 global 侧 app/频道（REGION_APPS 的 jp 侧
2026-06-17 才接入、且自始即分层落盘，不存在平级 jp 历史）。

行为：
  * 目标不存在 -> 直接移动；
  * 目标已存在（06-22 前后重叠日）-> 按条目去重键合并（url 优先，
    与 archive_platforms.item_key 同构），重算 item_count，删除源文件；
  * 幂等：重跑无平级文件即零操作；--dry-run 只报告不动盘。

用法：
    python3 scripts/migrate_flat_archives_to_layout.py --dry-run
    python3 scripts/migrate_flat_archives_to_layout.py
"""
import argparse
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / 'projects' / 'news' / 'scripts'))
import archive_layout  # noqa: E402

ARCHIVE_DIR = _REPO_ROOT / 'Public-Info-Pool' / 'Record' / 'Community'

# 待归位的源（顺序无关）；落点一律问 archive_layout，不在此重复布局知识
MIGRATE_SOURCES = ['steam', 'official', 'steam_discussion',
                   'appstore', 'google_play', 'youtube']


def _item_key(item: dict) -> str:
    url = item.get('url', '').strip()
    if url:
        return url
    return f"{item.get('title', '')}|{item.get('time', '')}|{item.get('author', '')}"


def _load_items(path: Path) -> tuple[dict, list]:
    """读归档文件 -> (元数据 dict, items 列表)。容忍裸列表等历史形态。"""
    data = json.loads(path.read_text(encoding='utf-8'))
    if isinstance(data, list):
        return {}, data
    return data, data.get('items', [])


def migrate_source(source: str, dry_run: bool) -> tuple[int, int]:
    """迁移一个源的全部平级日期文件。返回 (moved, merged) 计数。"""
    src_dir = ARCHIVE_DIR / source
    if not src_dir.exists():
        return 0, 0
    platform, region, subtype = archive_layout.resolve_write_layout(source)
    moved = merged = 0
    for f in sorted(src_dir.glob('*.json')):
        if not archive_layout.DATE_STEM.match(f.stem):
            continue  # state/manifest 类文件留在原地
        dst = ARCHIVE_DIR / archive_layout.build_relpath(platform, region, subtype, f.stem)
        if dst == f:
            continue
        if not dst.exists():
            if not dry_run:
                dst.parent.mkdir(parents=True, exist_ok=True)
                f.rename(dst)
            moved += 1
            continue
        # 同日冲突（06-22 前后重叠）：条目并集，保留目标（分层侧）元数据
        if not dry_run:
            meta_dst, items_dst = _load_items(dst)
            _meta_src, items_src = _load_items(f)
            seen = {_item_key(i) for i in items_dst}
            for it in items_src:
                if _item_key(it) not in seen:
                    seen.add(_item_key(it))
                    items_dst.append(it)
            meta_dst['items'] = items_dst
            meta_dst['item_count'] = len(items_dst)
            dst.write_text(json.dumps(meta_dst, ensure_ascii=False, indent=2),
                           encoding='utf-8')
            f.unlink()
        merged += 1
    # 折叠源目录清空后移除（official/steam_discussion 迁往宿主 steam/）
    if not dry_run and source != platform and src_dir.exists() and not any(src_dir.iterdir()):
        src_dir.rmdir()
    return moved, merged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    total_moved = total_merged = 0
    for source in MIGRATE_SOURCES:
        moved, merged = migrate_source(source, args.dry_run)
        total_moved += moved
        total_merged += merged
        if moved or merged:
            print(f'  {source:18} moved {moved:4}  merged {merged:2}')
    tag = 'DRY-RUN ' if args.dry_run else ''
    print(f'{tag}total: moved {total_moved}, merged {total_merged}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
