#!/usr/bin/env python3
"""migrate_video_comment_days.py — 视频评论旧日档：采集轮次 → 评论发布日。

## 为什么要迁

`collect_video_comments.py` 的日档在 2026-08-08 守密人裁定前记的是「**哪一轮采到的**」，
裁定后改成「评论**发布**于哪天」。写方改对了，旧档没动，于是同一个目录里两套语义并存。
2026-09-17 对账实测断崖极干净：裁定前 58 个日档 2,409 条里 1,838 条（76.3%）桶日 ≠ 发布日
（主漂移 -1 天：桶名取 UTC 日而发布日按北京日算；另有 +134 / +25 / +11 天的回填积压），
裁定后 39 个日档 1,295 条错桶 0。守密人 2026-09-18 裁定回填。

旧档每条都带完好的 `published` 字段，所以这是**纯重分桶**：不重采、不猜、总量守恒。
分桶口径直接复用写方的 `collect_video_comments.snapshot_date`——回填与采集共用同一个
判断，才不会迁完又长出第三套语义。

`published` 缺失 / 不可解析的条目回落**原桶日期**（而非「今天」），因为原桶至少是「那一轮
采到它」的真实标签，比迁移当天的日期更接近事实。

用法：
  python3 projects/news/scripts/migrate_video_comment_days.py --dry-run
  python3 projects/news/scripts/migrate_video_comment_days.py
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import archive_layout
from collect_video_comments import snapshot_date
from discord_cold_compress import default_cutoff

_DAY_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})\.json(\.gz)?$')


def comments_root() -> Path:
    return archive_layout.community_root() / 'youtube_comments'


def _load(path: Path) -> list[dict]:
    with archive_layout.open_archive_text(path) as fh:
        data = json.load(fh)
    return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []


def _write(path: Path, rows: list[dict], cold: bool) -> None:
    body = json.dumps(rows, ensure_ascii=False, indent=1)
    tmp = path.with_name(path.name + '.tmp')
    if cold:
        with gzip.open(tmp, 'wt', encoding='utf-8') as fh:
            fh.write(body)
    else:
        tmp.write_text(body, encoding='utf-8')
    tmp.replace(path)


def plan(root: Path) -> tuple[dict[str, list[dict]], int, int, set[Path]]:
    """返回 (发布日 -> 条目, 改桶数, 总条数, 读过的源档)。"""
    by_day: dict[str, list[dict]] = defaultdict(list)
    seen: dict[str, set[str]] = defaultdict(set)
    sources: set[Path] = set()
    moved = total = 0
    for path in sorted(root.iterdir()):
        m = _DAY_RE.match(path.name)
        if not m:
            continue           # comments.jsonl / state.json 等不是日档，不碰
        sources.add(path)
        bucket = m.group(1)
        for row in _load(path):
            total += 1
            day = snapshot_date(row, bucket)
            if day != bucket:
                moved += 1
            rid = row.get('id') or ''
            if rid and rid in seen[day]:
                continue       # 同一条评论在多个旧档里各存一份（回填积压），只留一份
            if rid:
                seen[day].add(rid)
            by_day[day].append(row)
    for rows in by_day.values():
        rows.sort(key=lambda r: -r.get('likes', 0))   # 与写方同序
    return by_day, moved, total, sources


def run(dry_run: bool, cutoff: str | None = None) -> dict:
    root = comments_root()
    cutoff = cutoff or default_cutoff()
    by_day, moved, total, sources = plan(root)
    if dry_run:
        return {'moved': moved, 'total': total, 'days': len(by_day), 'written': 0,
                'cutoff': cutoff}

    written = 0
    if moved:
        for path in sources:
            path.unlink()
        for day, rows in sorted(by_day.items()):
            cold = day[:7] < cutoff
            _write(root / f'{day}.json{".gz" if cold else ""}', rows, cold)
            written += 1
    return {'moved': moved, 'total': total, 'days': len(by_day), 'written': written,
            'cutoff': cutoff}


def main() -> int:
    ap = argparse.ArgumentParser(description='视频评论日档：采集轮次 → 发布日')
    ap.add_argument('--dry-run', action='store_true', help='只报告不改盘')
    ap.add_argument('--cutoff', default=None, help='冷月上界 YYYY-MM（不含；默认 = 上月）')
    args = ap.parse_args()

    root = comments_root()
    if not root.is_dir():
        print(f'视频评论归档目录不存在: {root}（设 BIAV_SC_DATA_ROOT）', file=sys.stderr)
        return 2
    res = run(args.dry_run, args.cutoff)
    print(f"{root}\n条目 {res['total']}，改桶 {res['moved']}"
          f"（{res['moved'] / res['total'] * 100 if res['total'] else 0:.1f}%），"
          f"发布日档 {res['days']} 个，写出 {res['written']} 个"
          f"{'  [dry-run]' if args.dry_run else ''}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
