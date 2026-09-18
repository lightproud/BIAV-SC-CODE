#!/usr/bin/env python3
"""migrate_platform_timestamps.py — 按已修好的采集器口径订正三层历史时间戳。

守密人 2026-09-18 裁定「只修 ruliweb 与 appstore/google_play」。三处采集器当日已修，
本脚本把**已入库**的条目按同一口径重算，并据新时间重新分桶。对账报告 D5 / D6：

- **ruliweb**（301 / 448 条）：旧写法把日期级发布时间当成 KST 00:00 再折 UTC，于是
  韩国本地 D 日的帖子存成 `{D-1}T15:00:00+00:00`，归档桶也跟着比真实日历日**早一天**。
  订正：还原出原始日历日（time 的日期 + 1），按当地**正午**重算——零点站在时区分界线上，
  正午离两侧日界各 12 小时。只认 `T15:00:00+00:00` 这个签名，带真实时分的条目不碰。
- **appstore**（713 条）：苹果 RSS 的偏移标签全年恒为 `-07:00`，冬令时条目因此偏 1 小时。
  订正：墙钟不动，交给 `America/Los_Angeles` 按当日真实规则重标（复用采集器同一个函数）。
- **google_play**（1,509 条）：时间戳无时区标注，靠「采集恒跑在 UTC runner 上」这条隐性
  假设才碰巧对。订正：显式补 `+00:00`——值不变，把假设写进数据里。

分桶一律经 `archive_layout.archive_date_str`（北京日）。条目去重沿用 `archive_platforms.item_key`。
日档 schema 原样保持（dict 带表头 / 裸 list 两种都见过），`archived_at` 取参与该桶的原档里最新的一个。

用法：
  python3 projects/news/scripts/migrate_platform_timestamps.py --dry-run
  python3 projects/news/scripts/migrate_platform_timestamps.py --layer ruliweb
  python3 projects/news/scripts/migrate_platform_timestamps.py
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import archive_layout
from archive_platforms import item_key
from discord_cold_compress import default_cutoff
from global_collectors import _pacific_wallclock_iso

_DAY_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})\.json(\.gz)?$')
_KST = timezone(timedelta(hours=9))
#: ruliweb 旧写法的签名：日期级发布时间被当作 KST 00:00 折成 UTC 的结果。
_RULIWEB_MIDNIGHT = 'T15:00:00+00:00'
LAYERS = ('ruliweb', 'appstore/global', 'appstore/jp', 'google_play/global', 'google_play/jp')


def fix_ruliweb(t: str) -> str | None:
    """KST 00:00 签名 → 同一日历日的当地正午。非签名值返回 None（不碰）。"""
    if not t.endswith(_RULIWEB_MIDNIGHT):
        return None
    try:
        shifted = datetime.fromisoformat(t).astimezone(_KST)       # = 原始日历日 00:00 KST
    except (ValueError, TypeError):
        return None
    return shifted.replace(hour=12).astimezone(timezone.utc).isoformat()


def fix_appstore(t: str) -> str | None:
    fixed = _pacific_wallclock_iso(t)
    return fixed if fixed and fixed != t else None


def fix_google_play(t: str) -> str | None:
    """naive → 显式 UTC。值不变，只把隐性假设写进数据。"""
    if not t or re.search(r'[+-]\d{2}:?\d{2}$|Z$', t):
        return None
    try:
        return datetime.fromisoformat(t).replace(tzinfo=timezone.utc).isoformat()
    except (ValueError, TypeError):
        return None


FIXERS = {'ruliweb': fix_ruliweb, 'appstore': fix_appstore, 'google_play': fix_google_play}


def _day_of(t: str) -> str | None:
    """时间戳的北京日；判不出返回 None。"""
    try:
        return archive_layout.archive_date_str(datetime.fromisoformat(t))
    except (ValueError, TypeError):
        return None


def _load(path: Path) -> tuple[list[dict], str | None]:
    with archive_layout.open_archive_text(path) as fh:
        doc = json.load(fh)
    if isinstance(doc, list):
        return [r for r in doc if isinstance(r, dict)], None
    items = [r for r in (doc.get('items') or []) if isinstance(r, dict)]
    return items, doc.get('archived_at')


def _write(path: Path, doc: dict, cold: bool) -> None:
    body = json.dumps(doc, ensure_ascii=False, indent=2)
    tmp = path.with_name(path.name + '.tmp')
    if cold:
        with gzip.open(tmp, 'wt', encoding='utf-8') as fh:
            fh.write(body)
    else:
        tmp.write_text(body, encoding='utf-8')
    tmp.replace(path)


def migrate_layer(layer: str, root: Path, cutoff: str, dry_run: bool) -> dict:
    fixer = FIXERS[layer.split('/')[0]]
    layer_dir = root / layer
    if not layer_dir.is_dir():
        return {'items': 0, 'fixed': 0, 'moved': 0, 'written': 0}

    by_day: dict[str, list[dict]] = defaultdict(list)
    arch_of: dict[str, str] = {}
    sources: list[Path] = []
    fixed = moved = items = 0
    subtype_meta: dict[str, str] = {}

    for path in sorted(layer_dir.rglob('*.json*')):
        m = _DAY_RE.match(path.name)
        if not m:
            continue
        sources.append(path)
        bucket = m.group(1)
        rows, archived_at = _load(path)
        for row in rows:
            items += 1
            old_t = row.get('time') or ''
            new_t = fixer(old_t)
            if new_t:
                row['time'] = new_t
                fixed += 1
            # **只有订正真的改了日期的条目才换桶**。两类条目都留在原桶：没被订正的，
            # 以及订正只补了元数据、时刻语义没变的（google_play 补 `+00:00` 即此类——
            # 原先 naive 值本就按 UTC 解释，补标后日期分毫不差）。它们若不在自己的日期
            # 桶里，那是 D4（旧「整轮一个日期」落桶 / 回填挤压）的遗留，而守密人裁的是
            # 「先定因再谈回填」——本脚本不得借订正之便把 D4 顺手做掉。
            day = bucket
            if new_t and _day_of(new_t) != _day_of(old_t):
                day = _day_of(new_t) or bucket
            if day != bucket:
                moved += 1
            by_day[day].append(row)
            if archived_at and archived_at > arch_of.get(day, ''):
                arch_of[day] = archived_at
        subtype_meta.setdefault('source', layer.split('/')[0])

    if dry_run or not fixed:
        return {'items': items, 'fixed': fixed, 'moved': moved, 'written': 0}

    for path in sources:
        path.unlink()
    written = 0
    for day, rows in sorted(by_day.items()):
        seen: set[str] = set()
        merged = []
        for row in rows:
            k = item_key(row)
            if k in seen:
                continue
            seen.add(k)
            merged.append(row)
        merged.sort(key=lambda r: r.get('engagement', 0), reverse=True)
        doc = {'date': day, 'archived_at': arch_of.get(day, ''),
               'source': subtype_meta['source'], 'item_count': len(merged), 'items': merged}
        region, subtype = (layer.split('/') + [None, None])[1:3]
        if region:
            doc['region'] = region
        if subtype:
            doc['content_subtype'] = subtype
        cold = day[:7] < cutoff
        _write(layer_dir / f'{day}.json{".gz" if cold else ""}', doc, cold)
        written += 1
    return {'items': items, 'fixed': fixed, 'moved': moved, 'written': written}


def run(layers: list[str] | None, dry_run: bool, cutoff: str | None = None) -> dict:
    root = archive_layout.community_root()
    cutoff = cutoff or default_cutoff()
    out: dict[str, dict] = {}
    for layer in LAYERS:
        if layers and layer not in layers and layer.split('/')[0] not in layers:
            continue
        out[layer] = migrate_layer(layer, root, cutoff, dry_run)
    return {'cutoff': cutoff, 'dry_run': dry_run, 'layers': out}


def main() -> int:
    ap = argparse.ArgumentParser(description='ruliweb / appstore / google_play 历史时间戳订正')
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
    for layer, r in res['layers'].items():
        print(f"  {layer:20s} 条目 {r['items']:5d}  订正时间戳 {r['fixed']:5d}  "
              f"改桶 {r['moved']:5d}  写出日档 {r['written']:4d}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
