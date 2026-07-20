#!/usr/bin/env python3
"""
Discord 存量归档批量紧凑化（S2）—— 把已落盘的 721 万条记录一次性压成紧凑 schema。

复用 `projects/news/scripts/discord_compact.compact_record` 单一权威定义（与归档器写盘
同一份逻辑，杜绝两处漂移）。幂等：已紧凑的记录再跑不变，可安全重入。

安全设计：
  - 每文件先写临时文件再原子 rename，单文件级原子；
  - 提交前整体可 `git checkout -- Public-Info-Pool/Record/Community/discord` 回退；
  - --dry-run 只测不写，输出预计省字节。

用法：
  python3 scripts/compact_discord_archive.py --dry-run     # 只测，不写
  python3 scripts/compact_discord_archive.py               # 实际重写
  python3 scripts/compact_discord_archive.py --limit 50    # 只处理前 50 文件
"""
import argparse
import json
import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / 'projects' / 'news' / 'scripts'))
import archive_layout  # noqa: E402  分仓桥接：数据根 SSOT
from discord_compact import compact_record  # noqa: E402

DISCORD_DIR = archive_layout.discord_root()  # 分仓桥接：env BIAV_SC_DATA_ROOT 或在树默认


def process_file(path: Path, dry_run: bool) -> tuple[int, int, int]:
    """返回 (原字节, 新字节, 记录数)。dry_run 时不落盘。"""
    orig_bytes = 0
    new_bytes = 0
    n = 0
    out_lines = []
    changed = False
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            raw = line.rstrip('\n')
            if not raw:
                continue
            orig_bytes += len(raw.encode('utf-8')) + 1
            try:
                rec = json.loads(raw)
            except json.JSONDecodeError:
                out_lines.append(raw)              # 保留无法解析的行（不丢数据）
                new_bytes += len(raw.encode('utf-8')) + 1
                continue
            n += 1
            comp = json.dumps(compact_record(rec), ensure_ascii=False)
            out_lines.append(comp)
            new_bytes += len(comp.encode('utf-8')) + 1
            if comp != raw:
                changed = True

    if not dry_run and changed:
        tmp = path.with_suffix(path.suffix + '.tmp')
        with open(tmp, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(out_lines) + '\n')
        os.replace(tmp, path)                      # 原子 rename
    return orig_bytes, new_bytes, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()

    files = sorted(DISCORD_DIR.rglob('*.jsonl'))
    if args.limit:
        files = files[:args.limit]

    total_orig = total_new = total_rec = 0
    for i, f in enumerate(files):
        if i % 2000 == 0:
            print(f'  ...{i}/{len(files)}', flush=True)
        o, nb, n = process_file(f, args.dry_run)
        total_orig += o
        total_new += nb
        total_rec += n

    def mb(b):
        return f'{b / 1024 / 1024:.1f} MB'

    mode = 'DRY-RUN（未写盘）' if args.dry_run else '已重写'
    saved = total_orig - total_new
    pct = f'{100 * saved / total_orig:.1f}%' if total_orig else 'n/a'
    print('=' * 56)
    print(f'模式      : {mode}')
    print(f'文件      : {len(files)}')
    print(f'记录      : {total_rec:,}')
    print(f'原始      : {mb(total_orig)}')
    print(f'紧凑后    : {mb(total_new)}')
    print(f'节省      : {mb(saved)}  ({pct})')
    print('=' * 56)


if __name__ == '__main__':
    main()
