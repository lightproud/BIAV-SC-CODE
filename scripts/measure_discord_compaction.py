#!/usr/bin/env python3
"""
Discord 记录精简方案 — 只读测量器（不写任何数据，零风险）

背景：discord 全量 JSONL（Public-Info-Pool/Record/Community/discord）实测约 92% 字节是
元数据 + 重复 JSON key，仅 8% 是 content 正文。多数字段长期恒为默认值（pinned/has_thread/
thread_id/flags/author_bot 近 100% 默认、embeds 98% 空、edited_timestamp 97% 空）。本脚本
**只读**遍历全量，精确测算「精简 schema」能省多少字节，用真实数字替代估算。绝不修改数据。

精简规则（保留分析地基、删除恒定/空值水分）：
  恒留：id / author_id / author_name / content / timestamp
  非空才留：edited_timestamp / mentions / reactions / attachments / reply_to
  非默认才留：type(!=0) / author_bot(true) / pinned(true) / flags(!=0) / has_thread(true) /
              thread_id(!=null) / embeds(非空)
  变体 A（保守）：保留每行 channel_id（同文件内恒定，但保留以防万一）
  变体 B（激进）：丢弃每行 channel_id（可由目录/ channel_index.json 还原）

用法：
  python3 scripts/measure_discord_compaction.py                 # 全量
  python3 scripts/measure_discord_compaction.py --limit 200     # 抽样 200 文件快测
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
DISCORD_DIR = _REPO_ROOT / 'Public-Info-Pool' / 'Record' / 'Community' / 'discord' / 'channels'

# 恒留字段
ALWAYS = ('id', 'author_id', 'author_name', 'content', 'timestamp')
# 非空才留（容器/可空）
KEEP_IF_TRUTHY = ('edited_timestamp', 'mentions', 'reactions', 'attachments', 'reply_to', 'embeds')


def compact(rec: dict, drop_channel_id: bool) -> dict:
    out = {k: rec[k] for k in ALWAYS if k in rec}
    if not drop_channel_id and rec.get('channel_id'):
        out['channel_id'] = rec['channel_id']
    if rec.get('type'):                       # type != 0
        out['type'] = rec['type']
    if rec.get('author_bot'):                 # true only
        out['author_bot'] = rec['author_bot']
    if rec.get('pinned'):
        out['pinned'] = rec['pinned']
    if rec.get('flags'):                      # != 0
        out['flags'] = rec['flags']
    if rec.get('has_thread'):
        out['has_thread'] = rec['has_thread']
    if rec.get('thread_id') is not None:
        out['thread_id'] = rec['thread_id']
    for k in KEEP_IF_TRUTHY:
        v = rec.get(k)
        if v:                                 # 非空 list / 非 null / 非空串
            out[k] = v
    return out


def line_bytes(d: dict) -> int:
    return len(json.dumps(d, ensure_ascii=False).encode('utf-8')) + 1  # +1 换行


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='只扫前 N 个文件（0=全量）')
    args = ap.parse_args()

    files = sorted(DISCORD_DIR.rglob('*.jsonl'))
    if args.limit:
        files = files[:args.limit]

    n_files = len(files)
    n_rec = 0
    orig_bytes = 0
    slim_a = 0
    slim_b = 0
    content_bytes = 0
    # 字段命中默认值统计（看水分集中在哪）
    default_hits = defaultdict(int)
    DEFAULT_CHECKS = {
        'pinned': lambda r: r.get('pinned') is False,
        'has_thread': lambda r: r.get('has_thread') is False,
        'thread_id': lambda r: r.get('thread_id') is None,
        'flags': lambda r: r.get('flags') == 0,
        'author_bot': lambda r: r.get('author_bot') is False,
        'embeds_empty': lambda r: r.get('embeds') == [],
        'edited_null': lambda r: r.get('edited_timestamp') is None,
        'mentions_empty': lambda r: r.get('mentions') == [],
        'reactions_empty': lambda r: r.get('reactions') == [],
        'attachments_empty': lambda r: r.get('attachments') == [],
        'reply_to_null': lambda r: r.get('reply_to') is None,
        'type_zero': lambda r: r.get('type') == 0,
    }

    for i, f in enumerate(files):
        if i % 2000 == 0:
            print(f'  ...扫描 {i}/{n_files}', flush=True)
        try:
            with open(f, encoding='utf-8') as fh:
                for line in fh:
                    line = line.rstrip('\n')
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    n_rec += 1
                    orig_bytes += len(line.encode('utf-8')) + 1
                    content_bytes += len(str(rec.get('content', '')).encode('utf-8'))
                    slim_a += line_bytes(compact(rec, drop_channel_id=False))
                    slim_b += line_bytes(compact(rec, drop_channel_id=True))
                    for name, chk in DEFAULT_CHECKS.items():
                        if chk(rec):
                            default_hits[name] += 1
        except OSError:
            continue

    def pct(part, whole):
        return f'{100 * part / whole:.1f}%' if whole else 'n/a'

    def mb(b):
        return f'{b / 1024 / 1024:.1f} MB'

    print('\n' + '=' * 60)
    print(f'扫描文件数      : {n_files}')
    print(f'记录总数        : {n_rec:,}')
    print(f'原始体量        : {mb(orig_bytes)}')
    print(f'  其中 content  : {mb(content_bytes)}  ({pct(content_bytes, orig_bytes)} — 真正的正文)')
    print(f'  其中元数据/key: {mb(orig_bytes - content_bytes)}  ({pct(orig_bytes - content_bytes, orig_bytes)} — 水分区)')
    print('-' * 60)
    print(f'变体 A（保留 channel_id）: {mb(slim_a)}   省 {pct(orig_bytes - slim_a, orig_bytes)}（-{mb(orig_bytes - slim_a)}）')
    print(f'变体 B（丢 channel_id）  : {mb(slim_b)}   省 {pct(orig_bytes - slim_b, orig_bytes)}（-{mb(orig_bytes - slim_b)}）')
    print('-' * 60)
    print('字段默认值命中率（越高=越纯水分，删了零信息损失）：')
    for name in DEFAULT_CHECKS:
        h = default_hits[name]
        print(f'  {name:18s} {h:>10,} / {n_rec:,}  ({pct(h, n_rec)})')
    print('=' * 60)


if __name__ == '__main__':
    main()
