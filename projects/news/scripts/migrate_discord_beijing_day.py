#!/usr/bin/env python3
"""migrate_discord_beijing_day.py — 把 discord 历史日档从 UTC 日切改成北京日切。

## 为什么要迁

`archive_layout` 声明归档桶名**只有一个基准：北京日期**。但 `discord_archiver` 从第一天起
就用 `ts.strftime('%Y-%m-%d')` 直接取 UTC 日，绕开了那个基准。结果：每天北京 00:00–08:00
（= UTC 前一日 16:00–24:00）的消息，都归进**前一天**的桶。2026-09-17 全量对账：
9,708,177 条里 2,783,113 条（28.67%）错位，漂移清一色 -1 天；同一棵 `Record/Community/`
树下的平台层全按北京日切，读方按文件名做跨层同日对比时两侧整整差一天。

写方已于 2026-09-18 改正（`discord_archiver._bucket_day`）。本脚本迁历史，让整棵树只剩
一套基准——守密人 2026-09-18 裁定「改写方 + 同时迁移历史」。

## 怎么迁（为什么可以流式）

北京日 B 的消息 = UTC `[B-1 16:00Z, B 16:00Z)`，只可能来自 UTC 日档 `B-1` 与 `B` 两个。
所以按日期升序走一遍即可：处理 UTC 档 D 时，手上的 carry（上一档留下的、属于北京日 D 的
那部分）加上本档属于北京日 D 的部分，就是北京日 D 的**全部**；本档属于北京日 D+1 的部分
成为新的 carry。内存只需一天的量，不必把频道整个读进来（最大频道压缩态就有 328 MB）。

去重按消息 id 并集（与 `discord_cold_compress._merge_lines` 同口径）；没有 id 或
timestamp 不可解析的行**原样留在原桶**，不猜、不丢。

冷热分层照 `discord_cold_compress.default_cutoff`：冷月写 `.jsonl.gz`，热月写裸 `.jsonl`。
同日若冷热并存（gz + 裸旁车），两份都读、按 id 并轨，输出只留一份。

产物先落频道目录下的 `.migrate-tmp/`，整个频道重排成功后才替换——中途被杀不会留下
半迁移的频道（那种状态既不是旧基准也不是新基准，最难收拾）。

## activity_daily 一并重算（--recompute-stats）

`{区服}/activity_daily/{date}.json` 的日键出自同一个 `strftime`，所以它和 JSONL 是**同一处
错位**：JSONL 迁到北京日而统计不迁，两份档就互相矛盾。实测 jp 区服 404 个统计日档里 396
个与迁移后的 JSONL 对不上，而**总量分毫不差**（200,978 = 200,978）——这正是「量没错、日子
错了」的签名。故本步不是重新定义统计口径，而是把同一批消息按正确的日子重新落位。

两处随之校正，均与写方改动同源：`hourly_activity` 折北京时（日按北京切、小时仍按 UTC，
等于一份统计里两套钟）；`channel_activity` 的键照写方口径：
论坛帖消息记在紧凑记录自带的 `thread_title` 下，其余记在 `channel_index.json` 的**当前**
频道名下（历史上改过名的普通频道，其旧名不再出现——旧名无从回填，照实记录）。

用法：
  python3 projects/news/scripts/migrate_discord_beijing_day.py --dry-run
  python3 projects/news/scripts/migrate_discord_beijing_day.py --region volunteer
  python3 projects/news/scripts/migrate_discord_beijing_day.py            # 三服全迁
  python3 projects/news/scripts/migrate_discord_beijing_day.py --recompute-stats
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import shutil
import sys
import heapq
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import archive_layout
from discord_cold_compress import default_cutoff

_DAY_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$')
TMP_DIRNAME = '.migrate-tmp'


def _read_lines(path: Path) -> list[str]:
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rt', encoding='utf-8') as fh:
        return [ln.rstrip('\n') for ln in fh if ln.strip()]


def _write_lines(path: Path, lines: list[str], cold: bool) -> None:
    """原子写：临时文件 + os.replace，避免半截档被读方当成损坏或缺口。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    body = '\n'.join(lines) + '\n'
    tmp = path.with_name(path.name + '.tmp')
    if cold:
        with gzip.open(tmp, 'wt', encoding='utf-8') as fh:
            fh.write(body)
    else:
        tmp.write_text(body, encoding='utf-8')
    tmp.replace(path)


def target_day(line: str) -> str | None:
    """这一行该落哪个北京日；无法判断时返回 None（原样留在原桶）。"""
    try:
        rec = json.loads(line)
        ts = rec.get('timestamp')
        if not ts:
            return None
        return archive_layout.archive_date_str(datetime.fromisoformat(ts))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def _msg_id(line: str) -> str | None:
    try:
        return json.loads(line).get('id') or None
    except (ValueError, json.JSONDecodeError):
        return None


def _dedup(lines: list[str]) -> list[str]:
    """按消息 id 并集；无 id 的行原样保留（它们没有身份，谈不上重复）。"""
    out: list[str] = []
    seen: set[str] = set()
    for ln in lines:
        mid = _msg_id(ln)
        if mid is None:
            out.append(ln)
            continue
        if mid in seen:
            continue
        seen.add(mid)
        out.append(ln)
    return out


def _is_cold(day: str, cutoff: str) -> bool:
    return day[:7] < cutoff


def plan_channel(ch_dir: Path) -> tuple[dict[str, list[str]], int, int]:
    """重排一个频道，返回 (北京日 -> 行, 迁移条数, 总条数)。

    源档按日期升序走一遍；每个 UTC 档只会把消息派给「同日」或「次日」两个北京日。
    """
    by_day: dict[str, list[str]] = defaultdict(list)
    moved = total = 0
    for path in sorted(ch_dir.iterdir(), key=lambda p: p.name):
        m = _DAY_RE.match(path.name)
        if not m:
            continue
        bucket = m.group(1)
        for line in _read_lines(path):
            total += 1
            day = target_day(line)
            if day is None:
                day = bucket  # 判不出发生日就不动它
            elif day != bucket:
                moved += 1
            by_day[day].append(line)
    return {d: _dedup(v) for d, v in by_day.items()}, moved, total


def migrate_channel(ch_dir: Path, cutoff: str, dry_run: bool) -> dict:
    by_day, moved, total = plan_channel(ch_dir)
    if dry_run or not moved:
        return {'moved': moved, 'total': total, 'days': len(by_day), 'rewritten': 0}

    tmp_dir = ch_dir / TMP_DIRNAME
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True)
    for day, lines in by_day.items():
        cold = _is_cold(day, cutoff)
        _write_lines(tmp_dir / f'{day}.jsonl{".gz" if cold else ""}', lines, cold)

    # 旧日档全撤，再把重排结果搬回来：目标集合完全由源集合决定，留着旧档就会与
    # 新档并存（同一天两份，读方冷热并出即双计）。
    for path in list(ch_dir.iterdir()):
        if _DAY_RE.match(path.name):
            path.unlink()
    for path in sorted(tmp_dir.iterdir()):
        path.replace(ch_dir / path.name)
    tmp_dir.rmdir()
    return {'moved': moved, 'total': total, 'days': len(by_day), 'rewritten': len(by_day)}



# ── activity_daily 重算 ──────────────────────────────────────────────────────

def _channel_names(region_dir: Path) -> dict[str, str]:
    """channel_id → 当前频道名（缺索引 / 缺条目时回落空串，调用方再退到 id）。"""
    idx = region_dir / 'channel_index.json'
    try:
        data = json.loads(idx.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}
    return {cid: (meta or {}).get('name', '') for cid, meta in data.items()
            if isinstance(meta, dict)}


def _blank_stats() -> dict:
    return {'messages': 0, 'authors': set(), 'reactions_total': 0, 'attachments': 0,
            'channel_activity': Counter(), 'hourly_activity': Counter(),
            'message_types': Counter(), 'top_reacted': []}


def recompute_stats(region_dir: Path, cutoff: str, dry_run: bool) -> dict:
    """从 JSONL 全量重算 activity_daily，日键 = 北京日。返回 {写出档数, 差异档数}。"""
    names = _channel_names(region_dir)
    by_day: dict[str, dict] = defaultdict(_blank_stats)
    ch_root = region_dir / 'channels'
    if not ch_root.is_dir():
        return {'written': 0, 'changed': 0, 'days': 0, 'orphans': 0}

    for path in sorted(ch_root.rglob('*.jsonl*')):
        if not _DAY_RE.match(path.name):
            continue
        for line in _read_lines(path):
            try:
                rec = json.loads(line)
                ts = datetime.fromisoformat(rec['timestamp'])
            except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                continue
            beijing = ts.astimezone(archive_layout.BEIJING_TZ)
            st = by_day[beijing.strftime('%Y-%m-%d')]
            st['messages'] += 1
            st['authors'].add(rec.get('author_id', ''))
            cid = rec.get('channel_id', '')
            # 写方的口径：论坛帖消息记在**帖标题**下（归档器给 forum starter 传的是
            # thread_meta['thread_title']），其余记在频道名下。紧凑 schema 保留了
            # thread_title，所以重算能照搬同一口径——只按频道名归会把 global 旧统计里
            # 12,646 个帖标题条目一次性抹平。
            st['channel_activity'][rec.get('thread_title') or names.get(cid) or cid] += 1
            st['hourly_activity'][str(beijing.hour)] += 1
            st['message_types'][str(rec.get('type', 0))] += 1
            st['attachments'] += len(rec.get('attachments', []))
            reacts = sum(r.get('count', 0) for r in rec.get('reactions', []))
            st['reactions_total'] += reacts
            if reacts > 0:
                # 只留 top 20，不把全天有反应的消息都攒在内存里（global 单日上万条）。
                entry = (reacts, {
                    'id': rec.get('id', ''), 'channel_id': cid,
                    'content': rec.get('content', '')[:80],
                    'author': rec.get('author_name', ''), 'reactions': reacts,
                    'channel': rec.get('thread_title') or names.get(cid) or '',
                })
                if len(st['top_reacted']) < 200:
                    st['top_reacted'].append(entry)
                else:
                    st['top_reacted'] = heapq.nlargest(20, st['top_reacted'] + [entry],
                                                       key=lambda kv: kv[0])

    stats_dir = region_dir / 'activity_daily'
    written = changed = 0
    for day, st in sorted(by_day.items()):
        doc = {
            'date': day,
            'messages': st['messages'],
            'unique_authors': len(st['authors']),
            'reactions_total': st['reactions_total'],
            'attachments': st['attachments'],
            'channel_activity': dict(st['channel_activity']),
            'hourly_activity': dict(st['hourly_activity']),
            'message_types': dict(st['message_types']),
            'top_reacted_messages': [e[1] for e in heapq.nlargest(
                20, st['top_reacted'], key=lambda kv: kv[0])],
        }
        cold = _is_cold(day, cutoff)
        target = stats_dir / f'{day}.json{".gz" if cold else ""}'
        old = stats_dir / f'{day}.json'
        old_gz = stats_dir / f'{day}.json.gz'
        prev = None
        for cand in (old, old_gz):
            if cand.exists():
                try:
                    with archive_layout.open_archive_text(cand) as fh:
                        prev = json.load(fh)
                except (OSError, json.JSONDecodeError):
                    prev = None
                break
        if prev != doc:
            changed += 1
        if dry_run:
            continue
        stats_dir.mkdir(parents=True, exist_ok=True)
        body = json.dumps(doc, ensure_ascii=False, indent=2)
        tmp = target.with_name(target.name + '.tmp')
        if cold:
            with gzip.open(tmp, 'wt', encoding='utf-8') as fh:
                fh.write(body)
        else:
            tmp.write_text(body, encoding='utf-8')
        tmp.replace(target)
        # 同日冷热并存时只留该月该留的那一份，否则读方冷热并出即双计。
        for stale in (old, old_gz):
            if stale != target and stale.exists():
                stale.unlink()
        written += 1

    # 旧日键的统计档必须撤掉，重算才算数。日键从 UTC 日改成北京日之后，两套基准的
    # 日期集合在首尾与稀疏区段并不重合：只写不删，那些旧档就成了**孤儿**——JSONL
    # 里根本没有那一天，统计里却有，谁按日对账都会发现这一层自相矛盾（实测
    # volunteer 区服留下 11 个，把区服总量算多了 46 条）。
    orphans = 0
    if not dry_run and stats_dir.is_dir():
        for path in sorted(stats_dir.iterdir()):
            m = re.match(r'^(\d{4}-\d{2}-\d{2})\.json(\.gz)?$', path.name)
            if m and m.group(1) not in by_day:
                path.unlink()
                orphans += 1
    return {'written': written, 'changed': changed, 'days': len(by_day), 'orphans': orphans}


def run(regions: list[str] | None, dry_run: bool, cutoff: str | None = None,
        stats: bool = False, messages: bool = True) -> dict:
    root = archive_layout.discord_root()
    cutoff = cutoff or default_cutoff()
    totals = {'channels': 0, 'moved': 0, 'total': 0, 'rewritten': 0,
              'stats_written': 0, 'stats_changed': 0, 'stats_orphans': 0}
    per_region: dict[str, dict] = {}
    for region, region_dir in sorted(archive_layout.discord_region_roots(root).items()):
        if regions and region not in regions:
            continue
        ch_root = region_dir / 'channels'
        if not ch_root.is_dir():
            continue
        acc = {'channels': 0, 'moved': 0, 'total': 0, 'rewritten': 0,
               'stats_written': 0, 'stats_changed': 0, 'stats_orphans': 0}
        if messages:
            for ch_dir in sorted(p for p in ch_root.iterdir() if p.is_dir()):
                res = migrate_channel(ch_dir, cutoff, dry_run)
                acc['channels'] += 1
                for k in ('moved', 'total', 'rewritten'):
                    acc[k] += res[k]
                if res['moved']:
                    print(f"  {region}/{ch_dir.name}: {res['moved']}/{res['total']} 条改桶,"
                          f" {res['days']} 个北京日档")
        if stats:
            sres = recompute_stats(region_dir, cutoff, dry_run)
            acc['stats_written'] = sres['written']
            acc['stats_changed'] = sres['changed']
            acc['stats_orphans'] = sres['orphans']
            print(f"  {region}/activity_daily: {sres['days']} 个北京日档，"
                  f"{sres['changed']} 个与旧档不同，撤掉旧日键孤儿 {sres['orphans']} 个")
        per_region[region] = acc
        for k in acc:
            totals[k] += acc[k]
    return {'cutoff': cutoff, 'dry_run': dry_run, 'totals': totals, 'per_region': per_region}


def main() -> int:
    ap = argparse.ArgumentParser(description='discord 历史日档 UTC 日 → 北京日迁移')
    ap.add_argument('--region', action='append', help='只迁指定区服（可重复）')
    ap.add_argument('--dry-run', action='store_true', help='只报告不改盘')
    ap.add_argument('--cutoff', default=None, help='冷月上界 YYYY-MM（不含；默认 = 上月）')
    ap.add_argument('--recompute-stats', action='store_true',
                    help='一并按北京日重算 activity_daily（日键与 JSONL 同基准）')
    ap.add_argument('--stats-only', action='store_true',
                    help='只重算 activity_daily，不动 JSONL 日档')
    args = ap.parse_args()

    root = archive_layout.discord_root()
    if not root.exists():
        print(f'discord 归档根不存在: {root}（设 BIAV_SC_DATA_ROOT）', file=sys.stderr)
        return 2
    print(f'归档根: {root}  冷月上界: {args.cutoff or default_cutoff()}'
          f"{'  [dry-run]' if args.dry_run else ''}")
    res = run(args.region, args.dry_run, args.cutoff,
              stats=args.recompute_stats or args.stats_only,
              messages=not args.stats_only)
    t = res['totals']
    print(f"\n频道 {t['channels']} 个，消息 {t['total']} 条，改桶 {t['moved']} 条"
          f"（{t['moved'] / t['total'] * 100 if t['total'] else 0:.2f}%），"
          f"重写日档 {t['rewritten']} 个")
    if t['stats_written'] or t['stats_changed']:
        print(f"activity_daily 重写 {t['stats_written']} 个日档"
              f"（{t['stats_changed']} 个与旧档不同）")
    for region, acc in res['per_region'].items():
        print(f"  {region:10s} 频道 {acc['channels']:4d}  消息 {acc['total']:9d}  "
              f"改桶 {acc['moved']:8d}  统计档 {acc['stats_written']:5d}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
