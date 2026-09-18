#!/usr/bin/env python3
"""migrate_platform_rebucket.py — 平台层历史错桶回填（D4）。

## 为什么要回填

2026-07 之前，平台层归档走的是「整轮一个日期」的落桶逻辑（外加回填时把整批历史内容塞进
当轮桶，以及一条对已带偏移的时刻再手工加 8 小时的旧路径）。2026-09-17 全量对账查出 4,045 条
条目的桶名不是它自身的发生日期；2026-09-18 定因确认**全部是历史存量**——桶日期停在
2026-07-27，2026-08 起归零，代码层已无那些路径。守密人同日裁定回填。

## 只搬该搬的那一条，别的一律不碰

本脚本**不重整**任何日档：它只找出「桶名 ≠ 自身北京日」的条目，把它们从原档摘走、并进
目标日档，其余条目原地不动、原序不变。

这条边界是刻意的。这一层里还有另一种历史问题——同一条内容被重复采集、在**同一个**日档
里存了几十上百份（weixin 单篇 883 份是已知极值，真因是搜狗中转链接每次重新签发、URL 做不了
去重键）。那是 D3 射程里的重复堆积，守密人尚未裁定清理。若本脚本顺手把日档整个重写一遍并
去重，就会把那件事一并做掉——那不是回填，是替守密人做决定。

去重只发生在**搬入目标桶**时（同一日档内不得有两条相同 item_key，本就是该层写入契约），
所以条目总数只会因为「搬来的条目与目标桶已有条目撞键」而减少，且每一条都可解释。

判不出自身日期的条目留在原桶，不猜。

用法：
  python3 projects/news/scripts/migrate_platform_rebucket.py --dry-run
  python3 projects/news/scripts/migrate_platform_rebucket.py --layer weixin
  python3 projects/news/scripts/migrate_platform_rebucket.py
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import archive_layout
from archive_platforms import item_key
from discord_cold_compress import default_cutoff

_DAY_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})\.json(\.gz)?$')
#: 自带归档器 / 自带语义、不归本脚本管的目录。
_SKIP_TOPS = {'discord', 'youtube_comments'}


def _day_of(row: dict) -> str | None:
    try:
        return archive_layout.archive_date_str(datetime.fromisoformat(row['time']))
    except (ValueError, TypeError, KeyError):
        return None


def _load(path: Path) -> dict:
    with archive_layout.open_archive_text(path) as fh:
        return json.load(fh)


def _items_of(doc) -> list[dict]:
    rows = doc if isinstance(doc, list) else (doc.get('items') or [])
    return [r for r in rows if isinstance(r, dict)]


def _dump(path: Path, doc, cold: bool) -> None:
    body = json.dumps(doc, ensure_ascii=False, indent=2)
    tmp = path.with_name(path.name + '.tmp')
    if cold:
        with gzip.open(tmp, 'wt', encoding='utf-8') as fh:
            fh.write(body)
    else:
        tmp.write_text(body, encoding='utf-8')
    tmp.replace(path)


def _with_items(doc, rows: list[dict]):
    """保持原 schema 写回：裸 list 仍是 list，带表头的 dict 只更新条目与计数。"""
    if isinstance(doc, list):
        return rows
    out = dict(doc)
    out['items'] = rows
    out['item_count'] = len(rows)
    return out


def _layer_dirs(root: Path) -> list[Path]:
    """含日档的目录（平台可能分区服 / 子类型，故按日档反推目录）。"""
    dirs = set()
    for path in root.rglob('*.json*'):
        if not _DAY_RE.match(path.name):
            continue
        if path.relative_to(root).parts[0] in _SKIP_TOPS:
            continue
        dirs.add(path.parent)
    return sorted(dirs)


def rebucket_dir(layer_dir: Path, root: Path, cutoff: str, dry_run: bool) -> dict:
    moved: dict[str, list[dict]] = defaultdict(list)
    stays: dict[Path, tuple] = {}          # 源档 → (doc, 留下的条目)
    total = 0

    for path in sorted(layer_dir.iterdir()):
        m = _DAY_RE.match(path.name)
        if not m:
            continue
        bucket = m.group(1)
        doc = _load(path)
        keep, leaving = [], []
        for row in _items_of(doc):
            total += 1
            day = _day_of(row)
            (leaving if day and day != bucket else keep).append(
                (row, day) if day and day != bucket else row)
        for row, day in leaving:
            moved[day].append(row)
        if leaving:
            stays[path] = (doc, keep)

    n_moved = sum(len(v) for v in moved.values())
    if dry_run:
        # 撞键数在 dry-run 里也要算出来：它就是「这次回填会少掉几条」，
        # 报告里写 0 而实跑掉了条目，等于让人在不知情的前提下按下执行。
        dropped = 0
        for day, rows in moved.items():
            seen = set()
            for cand in (layer_dir / f'{day}.json', layer_dir / f'{day}.json.gz'):
                if cand.exists():
                    seen = {item_key(r) for r in _items_of(_load(cand))}
                    break
            for row in rows:
                k = item_key(row)
                if k in seen:
                    dropped += 1
                else:
                    seen.add(k)
        return {'items': total, 'moved': n_moved, 'targets': len(moved),
                'sources': len(stays), 'dropped': dropped}
    if not n_moved:
        return {'items': total, 'moved': 0, 'targets': 0,
                'sources': len(stays), 'dropped': 0}

    dropped = 0
    # 1) 源档：摘走搬出的条目，其余原地不动、原序不变。空了就删档。
    for path, (doc, keep) in stays.items():
        if keep:
            _dump(path, _with_items(doc, keep), path.suffix == '.gz')
        else:
            path.unlink()

    # 2) 目标档：并入搬来的条目，按 item_key 去重（同日档不得有两条相同键）。
    for day, rows in sorted(moved.items()):
        cold = day[:7] < cutoff
        target = layer_dir / f'{day}.json{".gz" if cold else ""}'
        twin = layer_dir / f'{day}.json{"" if cold else ".gz"}'
        base_doc, existing = None, []
        for cand in (target, twin):
            if cand.exists():
                base_doc = _load(cand)
                existing = _items_of(base_doc)
                break
        if base_doc is None:
            base_doc = {'date': day, 'archived_at': '', 'source': layer_dir.name,
                        'item_count': 0, 'items': []}
            rel = layer_dir.relative_to(root).parts
            base_doc['source'] = rel[0]
            if len(rel) > 1:
                base_doc['region'] = rel[1]
            if len(rel) > 2:
                base_doc['content_subtype'] = rel[2]
        merged = list(existing)
        at = {item_key(r): i for i, r in enumerate(merged)}
        for row in rows:
            k = item_key(row)
            if k in at:
                # 同一条内容的两份副本。实测差异只在**缺省字段**上（一份早于某次
                # schema 补字段，另一份带 tags/[] media_url/'' 等默认值），所以不是
                # 二选一：以目标桶那份为底、用搬来的那份补它缺的键，两边的字段都不丢。
                keep = merged[at[k]]
                merged[at[k]] = {**row, **keep}
                dropped += 1
                continue
            at[k] = len(merged)
            merged.append(row)
        _dump(target, _with_items(base_doc, merged), cold)
        if twin.exists() and twin != target:
            twin.unlink()          # 同日冷热并存会被读方双计，只留该月该留的那一份
    return {'items': total, 'moved': n_moved, 'targets': len(moved),
            'sources': len(stays), 'dropped': dropped}


def run(layers: list[str] | None, dry_run: bool, cutoff: str | None = None) -> dict:
    root = archive_layout.community_root()
    cutoff = cutoff or default_cutoff()
    out: dict[str, dict] = {}
    for layer_dir in _layer_dirs(root):
        name = '/'.join(layer_dir.relative_to(root).parts)
        if layers and name not in layers and name.split('/')[0] not in layers:
            continue
        res = rebucket_dir(layer_dir, root, cutoff, dry_run)
        if res['moved']:
            out[name] = res
    return {'cutoff': cutoff, 'dry_run': dry_run, 'layers': out}


def main() -> int:
    ap = argparse.ArgumentParser(description='平台层历史错桶回填（只搬错桶条目）')
    ap.add_argument('--layer', action='append', help='只处理指定层（可重复）')
    ap.add_argument('--dry-run', action='store_true', help='只报告不改盘')
    ap.add_argument('--cutoff', default=None, help='冷月上界 YYYY-MM（不含；默认 = 上月）')
    args = ap.parse_args()

    root = archive_layout.community_root()
    if not root.is_dir():
        print(f'社区归档根不存在: {root}（设 BIAV_SC_DATA_ROOT）', file=sys.stderr)
        return 2
    res = run(args.layer, args.dry_run, args.cutoff)
    print(f"归档根: {root}  冷月上界: {res['cutoff']}"
          f"{'  [dry-run]' if args.dry_run else ''}")
    tot = {'moved': 0, 'dropped': 0}
    for name, r in res['layers'].items():
        print(f"  {name:24s} 条目 {r['items']:6d}  搬桶 {r['moved']:5d}  "
              f"源档 {r['sources']:4d} → 目标日档 {r['targets']:4d}  撞键并轨 {r['dropped']:4d}")
        tot['moved'] += r['moved']
        tot['dropped'] += r['dropped']
    print(f"合计搬桶 {tot['moved']} 条，撞键并轨 {tot['dropped']} 条")
    return 0


if __name__ == '__main__':
    sys.exit(main())
