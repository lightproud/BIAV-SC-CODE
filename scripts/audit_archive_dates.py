#!/usr/bin/env python3
"""audit_archive_dates.py — 社区全量档案层「桶日期 vs 信息发生日期」对账（只读诊断）。

## 它回答什么

归档日文件的文件名（`YYYY-MM-DD`）是**桶日期**，语义由 `archive_layout` 声明为
**北京日期**（UTC+8）。桶里每条条目另带自己的发生时刻（平台条目 `time` / 视频评论
`published` / discord 消息 `timestamp`）。两者本应同日——不同日即意味着读方按文件名
做的一切时序判断（日报、热度榜、月聚合、断崖检测）都在读一个**采集/归档节拍**，
而不是**社区真实发生节拍**。

本脚本把这层错位算出来，分四类报告：

1. **bucket_mismatch**  桶日 ≠ 条目自身北京日。历史遗留（旧的「整轮一个日期」落桶）
   与回填挤压都长这样。
2. **clock_equals_archive**  条目 `time` 落在该档 `archived_at` 的 ±15 分钟内 = 采集
   时刻被当成发生时刻。采集层本有 `time_is_approximate` 标记这种条目，但
   `news_common.validate_news_item` 的白名单重建不放行该字段，标记落档即蒸发，
   故此处用「时刻贴着归档时刻」反推。
3. **constant_clock**  某层过半条目的 UTC 时刻恒为同一值 = 上游只给了**日期**，被
   补成当地零点再折算时区。零点是最容易被时区推翻的时刻，一折就跨日。
4. **discord_utc_bucket**  discord 归档器用 `ts.strftime('%Y-%m-%d')` 直接取 UTC 日切
   桶，绕开日期基准 SSOT `archive_layout.archive_date_str`（北京日）。

只读：不写任何归档文件。数据根经 `BIAV_SC_DATA_ROOT` 解析（见 CLAUDE.md §5.2）。

用法：
  python3 scripts/audit_archive_dates.py                 # 全量（含 discord，约数分钟）
  python3 scripts/audit_archive_dates.py --skip-discord  # 只对账平台层
  python3 scripts/audit_archive_dates.py --json out.json # 机器可读结果
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from news_bridge import archive_layout  # noqa: E402  归档布局 / 日期基准 SSOT

BEIJING = timezone(timedelta(hours=8))
#: 条目时刻与 archived_at 的差在此窗内即判为「采集时刻冒充发生时刻」。窗取 15 分钟：
#: 一轮采集从抓取到落档的真实耗时是分钟级，而真实发布时刻贴着归档时刻到这个精度
#: 属小概率——窗再放大就会把「刚发出来就被采到」的真条目误伤。
NEAR_WINDOW_SEC = 900
#: 恒定时刻占比超过此比例即判为 date-only 被补成零点（见 docstring 第 3 类）。
CONSTANT_CLOCK_RATIO = 0.5

_JSON_DAY = re.compile(r'^(\d{4}-\d{2}-\d{2})\.json(\.gz)?$')
_JSONL_DAY = re.compile(r'^(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$')
#: discord JSONL 逐行取 timestamp 用正则而非 json.loads：全量 970 万条，只需要一个
#: 字段，整行反序列化是数量级的浪费。
_TS_RE = re.compile(rb'"timestamp"\s*:\s*"([^"]+)"')


def _parse(raw) -> datetime | None:
    """宽松解析 ISO 8601；naive 视作 UTC（与 archive_layout.archive_date_str 同口径）。"""
    if not raw or not isinstance(raw, str):
        return None
    try:
        dt = datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _beijing_day(dt: datetime) -> str:
    return dt.astimezone(BEIJING).strftime('%Y-%m-%d')


def _load_doc(path: Path):
    """读日档（冷热透明）。归档 schema 有两种：带表头的 dict 与裸 list。"""
    with archive_layout.open_archive_text(path) as fh:
        return json.load(fh)


def audit_platforms(root: Path) -> dict:
    """对账非 discord 平台层（条目时刻字段 = `time`，视频评论 = `published`）。"""
    layers: dict[str, dict] = {}
    for path in sorted(root.rglob('*.json*')):
        if 'discord' in path.parts or not _JSON_DAY.match(path.name):
            continue
        bucket = _JSON_DAY.match(path.name).group(1)
        layer = '/'.join(path.relative_to(root).parts[:-1])
        try:
            doc = _load_doc(path)
        except Exception as exc:  # 损坏档案照实计数，不静默吞
            layers.setdefault(layer, _blank_layer())['unreadable'] += 1
            print(f'  ! 跳过不可读归档 {path}: {type(exc).__name__}: {exc}', file=sys.stderr)
            continue
        if isinstance(doc, list):
            archived_at, items = None, doc
        else:
            archived_at, items = _parse(doc.get('archived_at')), doc.get('items') or []
        st = layers.setdefault(layer, _blank_layer())
        st['files'] += 1
        for item in items:
            if not isinstance(item, dict):
                continue
            st['items'] += 1
            # youtube_comments 走自己的 schema（published + fetched_at），其余用 time。
            when = _parse(item.get('time') or item.get('published'))
            if when is None:
                st['no_timestamp'] += 1
                continue
            if item.get('time_is_approximate'):
                st['flagged_approximate'] += 1
            if _beijing_day(when) != bucket:
                st['bucket_mismatch'] += 1
                delta = (datetime.strptime(bucket, '%Y-%m-%d')
                         - datetime.strptime(_beijing_day(when), '%Y-%m-%d')).days
                st['drift_days'][delta] += 1
                st['mismatch_months'][bucket[:7]] += 1
            if archived_at and abs((when - archived_at).total_seconds()) < NEAR_WINDOW_SEC:
                st['clock_equals_archive'] += 1
                st['near_months'][bucket[:7]] += 1
            st['clock'][when.astimezone(timezone.utc).strftime('%H:%M:%S')] += 1
    return {name: _finish_layer(st) for name, st in sorted(layers.items())}


def _blank_layer() -> dict:
    return {'files': 0, 'items': 0, 'no_timestamp': 0, 'unreadable': 0,
            'flagged_approximate': 0, 'bucket_mismatch': 0, 'clock_equals_archive': 0,
            'drift_days': Counter(), 'mismatch_months': Counter(),
            'near_months': Counter(), 'clock': Counter()}


def _finish_layer(st: dict) -> dict:
    out = {k: v for k, v in st.items() if not isinstance(v, Counter)}
    out['drift_days'] = dict(sorted(st['drift_days'].items()))
    out['mismatch_months'] = dict(sorted(st['mismatch_months'].items()))
    out['near_months'] = dict(sorted(st['near_months'].items()))
    top = st['clock'].most_common(1)
    out['constant_clock'] = None
    if top and st['items'] and top[0][1] / st['items'] >= CONSTANT_CLOCK_RATIO:
        out['constant_clock'] = {'utc_clock': top[0][0], 'count': top[0][1],
                                 'ratio': round(top[0][1] / st['items'], 4)}
    return out


def audit_discord(root: Path) -> dict:
    """对账 discord：消息 timestamp 的北京日 vs 桶日（桶由归档器按 UTC 日切）。"""
    out = {'messages': 0, 'bucket_mismatch': 0, 'no_timestamp_lines': 0,
           'drift_days': Counter(), 'by_region': defaultdict(lambda: [0, 0])}
    for path in root.rglob('*.jsonl*'):
        m = _JSONL_DAY.match(path.name)
        if not m:
            continue
        bucket = m.group(1)
        region = path.relative_to(root).parts[0]
        opener = gzip.open if path.suffix == '.gz' else open
        try:
            with opener(path, 'rb') as fh:
                for line in fh:
                    hit = _TS_RE.search(line)
                    if not hit:
                        out['no_timestamp_lines'] += 1
                        continue
                    when = _parse(hit.group(1).decode())
                    if when is None:
                        out['no_timestamp_lines'] += 1
                        continue
                    out['messages'] += 1
                    out['by_region'][region][0] += 1
                    day = _beijing_day(when)
                    if day != bucket:
                        out['bucket_mismatch'] += 1
                        out['by_region'][region][1] += 1
                        out['drift_days'][(datetime.strptime(bucket, '%Y-%m-%d')
                                           - datetime.strptime(day, '%Y-%m-%d')).days] += 1
        except Exception as exc:
            print(f'  ! 跳过不可读归档 {path}: {type(exc).__name__}: {exc}', file=sys.stderr)
    out['drift_days'] = dict(sorted(out['drift_days'].items()))
    out['by_region'] = {k: {'messages': v[0], 'bucket_mismatch': v[1]}
                        for k, v in sorted(out['by_region'].items())}
    return out


def render(platforms: dict, discord: dict | None) -> None:
    print('=== 平台层：桶日期 vs 条目发生日期 ===')
    head = f'{"层":26s} {"文件":>5s} {"条目":>7s} {"错桶":>6s} {"≈归档时刻":>9s} {"无时刻":>6s} {"标近似":>6s}'
    print(head)
    tot = Counter()
    for name, st in platforms.items():
        print(f'{name:26s} {st["files"]:5d} {st["items"]:7d} {st["bucket_mismatch"]:6d} '
              f'{st["clock_equals_archive"]:9d} {st["no_timestamp"]:6d} {st["flagged_approximate"]:6d}')
        for key in ('files', 'items', 'bucket_mismatch', 'clock_equals_archive',
                    'no_timestamp', 'flagged_approximate'):
            tot[key] += st[key]
    print('-' * len(head))
    print(f'{"合计":26s} {tot["files"]:5d} {tot["items"]:7d} {tot["bucket_mismatch"]:6d} '
          f'{tot["clock_equals_archive"]:9d} {tot["no_timestamp"]:6d} {tot["flagged_approximate"]:6d}')

    const = {n: s['constant_clock'] for n, s in platforms.items() if s['constant_clock']}
    print('\n=== 恒定时刻（日期级来源被补成当地零点，折算即跨日）===')
    print('  （无）' if not const else '')
    for name, c in const.items():
        print(f'  {name:26s} UTC {c["utc_clock"]} 占 {c["ratio"]*100:.1f}%（{c["count"]} 条）')

    if discord is not None:
        d = discord
        ratio = d['bucket_mismatch'] / d['messages'] * 100 if d['messages'] else 0
        print(f'\n=== discord：{d["messages"]} 条消息，桶日≠北京发生日 {d["bucket_mismatch"]} 条'
              f'（{ratio:.2f}%）===')
        print('  漂移分布:', ' '.join(f'{k:+d}d×{v}' for k, v in d['drift_days'].items()))
        for region, v in d['by_region'].items():
            r = v['bucket_mismatch'] / v['messages'] * 100 if v['messages'] else 0
            print(f'  {region:12s} {v["messages"]:9d} 条，错桶 {v["bucket_mismatch"]:7d}（{r:.2f}%）')


def main() -> int:
    ap = argparse.ArgumentParser(description='社区归档桶日期与发生日期对账（只读）')
    ap.add_argument('--skip-discord', action='store_true', help='跳过 discord 全量扫描')
    ap.add_argument('--json', metavar='PATH', help='把结果另存为 JSON')
    args = ap.parse_args()

    root = archive_layout.community_root()
    if not root.exists():
        print(f'社区归档根不存在: {root}（设 BIAV_SC_DATA_ROOT 指向 BIAV-SC-DATA checkout）',
              file=sys.stderr)
        return 2
    print(f'归档根: {root}')
    platforms = audit_platforms(root)
    discord = None if args.skip_discord else audit_discord(archive_layout.discord_root())
    render(platforms, discord)

    if args.json:
        payload = {'generated_at': datetime.now(timezone.utc).isoformat(),
                   'archive_root': str(root), 'platforms': platforms, 'discord': discord}
        Path(args.json).write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                                   encoding='utf-8')
        print(f'\nJSON 结果: {args.json}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
