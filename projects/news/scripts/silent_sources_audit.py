#!/usr/bin/env python3
"""
silent_sources_audit.py — 沉默源审计（基于归档历史）

扫描 projects/news/data/platforms/*/*.json 和 data/discord/activity_daily/*.json，
为每个已注册的采集源计算：
  - days_archived：归档天数
  - total_items：累计条目数
  - last_archive_date / first_archive_date：归档窗口
  - silent_days：距最近一次产出的天数
  - level：active / degraded / dormant / never

输出：
  1. 控制台可读报告（按分级排序）
  2. --write：写入 output/source-health.json，供 SilentPlatformTracker 作为种子数据
  3. --suggest-prune：列出建议从 workflow 摘除的源

使用:
    python projects/news/scripts/silent_sources_audit.py
    python projects/news/scripts/silent_sources_audit.py --write
    python projects/news/scripts/silent_sources_audit.py --suggest-prune

注意：归档窗口受 archive_platforms.py 实际运行次数限制。若窗口 < 30 天，
"never" 仅代表"窗口内从未产出"，不等于真正 30 天沉默。
"""

import argparse
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import KNOWN_SOURCES, CORE_SOURCES, LEGACY_SOURCES, INDEPENDENT_ARCHIVE_SOURCES
import archive_layout

ARCHIVE_DIR = _REPO_ROOT / 'Public-Info-Pool' / 'Record' / 'Community'
DISCORD_ARCHIVE_DIR = _REPO_ROOT / 'Public-Info-Pool' / 'Record' / 'Community' / 'discord' / 'activity_daily'
HEALTH_PATH = _REPO_ROOT / 'projects' / 'news' / 'output' / 'source-health.json'

# 已注册采集源 —— 来自 sources.py 单一真相源（含 discord）
ALL_REGISTERED_SOURCES = list(KNOWN_SOURCES) + list(INDEPENDENT_ARCHIVE_SOURCES)

# 与 data_quality.SilentPlatformTracker 保持一致
DEGRADED_THRESHOLD = 7
DORMANT_THRESHOLD = 30

# 布局知识（折叠映射 / 区服递归 / 日期文件过滤）收编进 archive_layout 单一真相源
# （2026-07-02 P0-1）；本模块只管健康分级，遍历全部委派。
_DATE_STEM = archive_layout.DATE_STEM


def _platform_dir(source: str) -> Path:
    return DISCORD_ARCHIVE_DIR if source == 'discord' else ARCHIVE_DIR / source


def _iter_archive_files(source: str):
    """产出某源的全部归档日期文件——遍历逻辑在 archive_layout（布局单一真相源）。"""
    if source == 'discord':
        yield from DISCORD_ARCHIVE_DIR.glob('*.json')
        return
    yield from archive_layout.iter_source_files(source, ARCHIVE_DIR)


def audit_source(source: str) -> dict:
    """Scan a source's archive directory and return its stats.

    Discord 用独立归档格式：按日聚合 `messages` 计数，而非 news 条目。
    这里对 Discord 做特殊处理，把 messages 当作 total_items 用于活跃度判断。
    """
    result = {
        'source': source,
        'days_archived': 0,
        'total_items': 0,
        'last_archive_date': None,
        'first_archive_date': None,
    }
    files = sorted((f for f in _iter_archive_files(source)
                    if _DATE_STEM.match(f.stem)),
                   key=lambda f: f.stem)
    if not files:
        return result

    total = 0
    for f in files:
        try:
            data = json.loads(f.read_text(encoding='utf-8'))
            if source == 'discord':
                # discord_archiver 输出 {messages: [...], ...}，list 长度 = 当日消息数
                msgs = data.get('messages', 0)
                total += len(msgs) if isinstance(msgs, list) else (msgs or 0)
            elif isinstance(data, list):
                # youtube_comments 等日快照为裸列表（无 item_count 包装）
                total += len(data)
            else:
                total += data.get('item_count', 0)
        except Exception:
            continue

    # 区服分层后同一日期可有多文件（global/jp），归档天数按去重日期计
    result['days_archived'] = len({f.stem for f in files})
    result['total_items'] = total
    result['first_archive_date'] = files[0].stem
    result['last_archive_date'] = files[-1].stem
    return result


def compute_silent_days(last_date: str | None, today: str) -> int:
    if not last_date:
        return 9999
    try:
        last = datetime.strptime(last_date, '%Y-%m-%d')
        now = datetime.strptime(today, '%Y-%m-%d')
        return max(0, (now - last).days)
    except Exception:
        return 9999


def classify(silent_days: int, total_items: int) -> str:
    if total_items == 0:
        return 'never'
    if silent_days >= DORMANT_THRESHOLD:
        return 'dormant'
    if silent_days >= DEGRADED_THRESHOLD:
        return 'degraded'
    return 'active'


def build_report() -> dict:
    today = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime('%Y-%m-%d')
    entries = []
    # Audit window 只看 platforms/ 下的非 discord 源；discord 有独立生命周期
    platform_first_dates = []
    for source in ALL_REGISTERED_SOURCES:
        stat = audit_source(source)
        stat['silent_days'] = compute_silent_days(stat['last_archive_date'], today)
        stat['level'] = classify(stat['silent_days'], stat['total_items'])
        entries.append(stat)
        if stat['first_archive_date'] and source != 'discord':
            platform_first_dates.append(stat['first_archive_date'])

    window_start = min(platform_first_dates) if platform_first_dates else today
    try:
        window_days = (datetime.strptime(today, '%Y-%m-%d')
                       - datetime.strptime(window_start, '%Y-%m-%d')).days + 1
    except Exception:
        window_days = 0

    return {
        'today': today,
        'window_start': window_start,
        'window_days': window_days,
        'entries': entries,
    }


def print_report(report: dict) -> None:
    entries = report['entries']
    print('\n=== 沉默源审计（基于归档历史）===')
    print(f'审计窗口: {report["window_start"]} ~ {report["today"]}  ({report["window_days"]} 天)\n')

    by_level = {'active': [], 'degraded': [], 'dormant': [], 'never': []}
    for e in entries:
        by_level[e['level']].append(e)

    def print_section(title: str, rows: list[dict]) -> None:
        if not rows:
            return
        print(f'【{title}】({len(rows)})')
        rows_sorted = sorted(rows, key=lambda x: (-x['total_items'], x['silent_days']))
        for r in rows_sorted:
            last = r['last_archive_date'] or '从未'
            silent = r['silent_days']
            silent_str = '' if silent >= 9999 else f'沉默 {silent}d'
            print(f'  {r["source"]:18s}  {r["days_archived"]:4d}d  {r["total_items"]:6d} 条  '
                  f'last={last:10s}  {silent_str}')
        print()

    print_section('活跃（近 7 天内有产出）', by_level['active'])
    print_section('⚠  降级（7-30 天沉默）', by_level['degraded'])
    print_section('休眠（>30 天沉默）', by_level['dormant'])
    print_section(
        f'从未产出（审计窗口 {report["window_days"]}d 内 0 条）',
        by_level['never'],
    )

    summary = (
        f'合计 {len(entries)} 源 / '
        f'{len(by_level["active"])} 活跃 / '
        f'{len(by_level["degraded"])} 降级 / '
        f'{len(by_level["dormant"])} 休眠 / '
        f'{len(by_level["never"])} 从未产出'
    )
    print(summary)
    if report['window_days'] < DORMANT_THRESHOLD:
        print(f'⚠  归档窗口仅 {report["window_days"]}d < {DORMANT_THRESHOLD}d，'
              f'"从未产出"仅代表窗口内沉默，不等于真正 30 天 dormant。')
    print()


def write_health(report: dict) -> None:
    """Seed source-health.json 供 SilentPlatformTracker 使用。"""
    # 保留 tracker 写入的 last_check_date：丢失它会让 dormant 源的
    # 「每日一次探测」退化为每小时探测（每次 --write 重置检查记录）。
    existing = {}
    if HEALTH_PATH.exists():
        try:
            existing = json.loads(HEALTH_PATH.read_text(encoding='utf-8')).get('platforms', {})
        except Exception:
            existing = {}
    platforms = {}
    for e in report['entries']:
        # "never" 永远种子化为 active：archive 缺失常常是因为该源还没在产线跑过，
        # 直接标 dormant 会让 SilentPlatformTracker 跳过采集，形成
        # never→dormant→跳过→永远 never 的死循环。让 tracker 基于实时尝试
        # 结果（update_platform_status）自然降级到 degraded/dormant 才是正确路径。
        if e['level'] == 'never':
            level = 'active'
            silent = 0
        else:
            level = e['level']
            silent = e['silent_days'] if e['silent_days'] < 9999 else report['window_days']

        platforms[e['source']] = {
            'level': level,
            'last_success_date': e['last_archive_date'],
            'last_check_date': existing.get(e['source'], {}).get('last_check_date'),
            'consecutive_silent_days': silent,
            'total_items': e['total_items'],
            'errors': [],
        }

    payload = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'seeded_from': 'silent_sources_audit',
        'audit_window': {
            'start': report['window_start'],
            'end': report['today'],
            'days': report['window_days'],
        },
        'platforms': platforms,
    }
    HEALTH_PATH.parent.mkdir(parents=True, exist_ok=True)
    HEALTH_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    print(f'写入 {HEALTH_PATH.relative_to(_REPO_ROOT)}')


def suggest_prune(report: dict) -> None:
    entries = report['entries']
    never = [e for e in entries if e['level'] == 'never']
    dormant = [e for e in entries if e['level'] == 'dormant']
    degraded = [e for e in entries if e['level'] == 'degraded']

    print('\n=== 清理建议 ===\n')
    if not (never or dormant or degraded):
        print('所有源近期都有产出，无需清理。')
        return

    if never:
        print(f' 候选摘除（窗口 {report["window_days"]}d 内从未产出，共 {len(never)}）:')
        for e in sorted(never, key=lambda x: x['source']):
            print(f'  - {e["source"]}')
        print()
    if dormant:
        print(f'⚠  强制调查（>30d 沉默，共 {len(dormant)}）:')
        for e in dormant:
            print(f'  - {e["source"]}  last={e["last_archive_date"]}  '
                  f'silent={e["silent_days"]}d')
        print()
    if degraded:
        print(f'轻度观察（7-30d 沉默，共 {len(degraded)}）:')
        for e in degraded:
            print(f'  - {e["source"]}  last={e["last_archive_date"]}  '
                  f'silent={e["silent_days"]}d')
        print()

    if report['window_days'] < DORMANT_THRESHOLD:
        print(f'提示：归档窗口仅 {report["window_days"]}d，建议累积 30 天后再做硬性摘除。'
              f'当前阶段可先通过 --write 将它们标记为 degraded，由 tracker 降频采集。')


def scan_unregistered_dirs() -> list[str]:
    """列出 data/platforms/ 下存在、但不在已注册源清单中的目录。

    捕获采集逻辑已移除却仍留有历史归档的遗留源（如 taptap_post），
    否则它们对沉默源审计完全不可见。
    """
    if not ARCHIVE_DIR.exists():
        return []
    registered = set(ALL_REGISTERED_SOURCES)
    found = []
    for d in sorted(ARCHIVE_DIR.iterdir()):
        if d.is_dir() and d.name not in registered:
            found.append(d.name)
    return found


def print_legacy_section(unregistered: list[str]) -> None:
    if not unregistered:
        return
    print('【遗留源（有归档但未注册采集）】')
    for name in unregistered:
        stat = audit_source(name)
        tag = '已知遗留' if name in LEGACY_SOURCES else '未登记'
        last = stat['last_archive_date'] or '从未'
        print(f'  {name:18s}  {stat["days_archived"]:4d}d  {stat["total_items"]:6d} 条  '
              f'last={last:10s}  [{tag}]')
    print()


def core_source_alarms(report: dict) -> list[str]:
    """返回处于 never/dormant 的核心源名（健康门控用）。"""
    alarmed = []
    for e in report['entries']:
        if e['source'] in CORE_SOURCES and e['level'] in ('never', 'dormant'):
            alarmed.append(e['source'])
    return alarmed


def main() -> None:
    parser = argparse.ArgumentParser(description='沉默源审计（基于归档历史）')
    parser.add_argument('--write', action='store_true',
                        help='写入 output/source-health.json，供 SilentPlatformTracker 种子')
    parser.add_argument('--suggest-prune', action='store_true',
                        help='输出建议清理列表')
    parser.add_argument('--strict', action='store_true',
                        help='核心源处于 never/dormant 时以非零退出（健康门控）')
    args = parser.parse_args()

    report = build_report()
    print_report(report)
    print_legacy_section(scan_unregistered_dirs())

    if args.suggest_prune:
        suggest_prune(report)
    if args.write:
        write_health(report)

    alarmed = core_source_alarms(report)
    if alarmed:
        print(f'[健康门控] 核心源零产出 / 长期沉默: {", ".join(alarmed)}')
        if args.strict:
            sys.exit(1)


if __name__ == '__main__':
    main()
