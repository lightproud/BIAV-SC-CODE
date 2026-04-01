#!/usr/bin/env python3
"""
忘却前夜 Morimens - 极简日报生成脚本

读取 output/ 下所有 *-latest.json，过滤最近24小时数据，生成 Markdown 日报。

使用方式:
  python projects/news/scripts/generate_daily.py

输出:
  projects/news/output/daily-report-YYYY-MM-DD.md  — 当天日报
  projects/news/output/daily-latest.md             — 最新一期固定入口
"""

import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
OUTPUT_DIR = REPO_ROOT / 'projects' / 'news' / 'output'

PLATFORM_NAMES = {
    'steam': 'Steam',
    'bilibili': 'Bilibili',
    'twitter': 'Twitter',
    'discord': 'Discord',
    'nga': 'NGA',
    'taptap': 'TapTap',
    'youtube': 'YouTube',
    'reddit': 'Reddit',
    'official': 'Official',
}

CUTOFF_HOURS = 24


def load_all_latest():
    """读取 output/ 下所有 *-latest.json（排除 all-latest.json 和 daily-latest.json）"""
    results = {}
    for path in sorted(OUTPUT_DIR.glob('*-latest.json')):
        name = path.stem.replace('-latest', '')
        if name in ('all', 'daily'):
            continue
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
        except Exception:
            continue
        results[name] = data
    return results


def filter_recent(items, cutoff_hours=CUTOFF_HOURS):
    """过滤最近 cutoff_hours 小时内的条目"""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=cutoff_hours)
    recent = []
    for item in items:
        t = item.get('time', '')
        if not t:
            continue
        try:
            dt = datetime.fromisoformat(t)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt >= cutoff:
                recent.append(item)
        except Exception:
            continue
    return recent


def steam_stats(items):
    """计算 Steam 评论统计"""
    positive = sum(1 for i in items if '[正面]' in i.get('title', ''))
    negative = sum(1 for i in items if '[负面]' in i.get('title', ''))
    total = len(items)
    rate = f'{positive / total * 100:.0f}%' if total > 0 else 'N/A'

    lang_count = {}
    for item in items:
        lang = item.get('lang', '') or 'unknown'
        lang_count[lang] = lang_count.get(lang, 0) + 1

    return {
        'positive': positive,
        'negative': negative,
        'total': total,
        'rate': rate,
        'lang_count': lang_count,
    }


def top_engagement(items, n=5):
    """按 engagement 降序返回前 n 条"""
    return sorted(items, key=lambda x: x.get('engagement', 0), reverse=True)[:n]


def negative_items(items):
    """返回差评条目"""
    return [i for i in items if '[负面]' in i.get('title', '')]


def build_alerts(active_platforms):
    """构建需要关注的警报列表"""
    alerts = []

    # Steam 好评率低于 70%
    if 'steam' in active_platforms:
        _, steam_items = active_platforms['steam']
        stats = steam_stats(steam_items)
        if stats['total'] > 0:
            rate_pct = stats['positive'] / stats['total'] * 100
            if rate_pct < 70:
                alerts.append(f'Steam好评率异常：{rate_pct:.0f}%')

            # 高关注差评（engagement > 5）
            for item in negative_items(steam_items):
                eng = item.get('engagement', 0)
                if eng > 5:
                    summary = item.get('summary', item.get('title', ''))[:60]
                    alerts.append(f'高关注差评：{summary}')

    # Discord 异常沉默（当日消息 < 1000）
    if 'discord' in active_platforms:
        _, discord_items = active_platforms['discord']
        if discord_items:
            first = discord_items[0]
            summary_text = first.get('summary', '')
            # 从摘要中提取消息数："今日 11,812 条消息"
            import re
            m = re.search(r'(\d[\d,]*)\s*条消息', summary_text)
            if m:
                msg_count = int(m.group(1).replace(',', ''))
                if msg_count < 1000:
                    alerts.append(f'Discord异常沉默：仅{msg_count:,}条消息')

    return alerts


def generate_report(all_data, now_utc8):
    """生成 Markdown 日报文本"""
    date_str = now_utc8.strftime('%Y-%m-%d')
    time_str = now_utc8.strftime('%Y-%m-%d %H:%M')

    lines = []
    lines.append(f'# 忘却前夜 社区日报 {date_str}')
    lines.append('')
    lines.append(f'> 采集时间：{time_str} UTC+8')
    lines.append('')

    # 总览表格
    lines.append('## 总览')
    lines.append('')
    lines.append('| 平台 | 数据条数 |')
    lines.append('|------|----------|')

    active_platforms = {}
    silent_platforms = []

    for key, data in all_data.items():
        items = data.get('items', [])
        recent = filter_recent(items)
        display = PLATFORM_NAMES.get(key, key)
        if len(recent) > 0:
            active_platforms[key] = (display, recent)
            lines.append(f'| {display} | {len(recent)} |')
        else:
            # 检查是否有任何数据（不限时间）
            count = data.get('item_count', len(items))
            if count == 0:
                silent_platforms.append(display)
                lines.append(f'| {display} | 0（沉默）|')
            else:
                # 有数据但24小时内无新内容
                silent_platforms.append(display)
                lines.append(f'| {display} | 0（24h内无新内容）|')

    lines.append('')

    # 需要关注区块（条件触发）
    alerts = build_alerts(active_platforms)
    if alerts:
        lines.append('## ⚠️ 需要关注')
        lines.append('')
        for alert in alerts:
            lines.append(f'- ⚠️ {alert}')
        lines.append('')

    # Discord 摘要（完整文本）
    if 'discord' in active_platforms:
        _, discord_items = active_platforms['discord']
        if discord_items:
            first = discord_items[0]
            summary_text = first.get('summary', '')
            if summary_text:
                lines.append('## Discord')
                lines.append('')
                lines.append(summary_text)
                lines.append('')
                # 其余热门内容
                rest = top_engagement(discord_items[1:], n=5) if len(discord_items) > 1 else []
                if rest:
                    lines.append('### 热门话题')
                    lines.append('')
                    for idx, item in enumerate(rest, 1):
                        title = item.get('title', '(无标题)')[:60]
                        eng = item.get('engagement', 0)
                        lines.append(f'{idx}. {title} — engagement: {eng}')
                    lines.append('')

    # Steam 评论详情
    if 'steam' in active_platforms:
        _, steam_items = active_platforms['steam']
        stats = steam_stats(steam_items)

        lines.append('## Steam 评论')
        lines.append('')
        lines.append(
            f'- 好评 {stats["positive"]} / 差评 {stats["negative"]} / 好评率 {stats["rate"]}'
        )

        if stats['lang_count']:
            lang_str = ', '.join(
                f'{k} {v}' for k, v in
                sorted(stats['lang_count'].items(), key=lambda x: -x[1])
            )
            lines.append(f'- 语言分布：{lang_str}')

        lines.append('')

        # 热门好评（按 engagement）
        positive_items = [i for i in steam_items if '[正面]' in i.get('title', '')]
        top = top_engagement(positive_items)
        if top:
            lines.append('### 热门好评')
            lines.append('')
            for idx, item in enumerate(top, 1):
                title = item.get('title', '(无标题)')[:60]
                eng = item.get('engagement', 0)
                lines.append(f'{idx}. {title} — engagement: {eng}')
            lines.append('')

        # 差评（单独区块，带警告标记）
        negs = negative_items(steam_items)
        if negs:
            lines.append('### ⚠️ 差评')
            lines.append('')
            for item in negs:
                lang = item.get('lang', '') or 'unknown'
                eng = item.get('engagement', 0)
                summary = item.get('summary', item.get('title', ''))[:80]
                lines.append(f'- ⚠️ [{lang}] {summary} — engagement: {eng}')
            lines.append('')

    # 其他活跃平台（跳过已单独处理的 steam 和 discord）
    for key, (display, items) in active_platforms.items():
        if key in ('steam', 'discord'):
            continue
        lines.append(f'## {display}')
        lines.append('')
        top = top_engagement(items)
        for idx, item in enumerate(top, 1):
            title = item.get('title', '(无标题)')[:60]
            eng = item.get('engagement', 0)
            lines.append(f'{idx}. {title} — engagement: {eng}')
        lines.append('')

    # 沉默平台
    if silent_platforms:
        lines.append('## 沉默平台')
        lines.append('')
        lines.append(', '.join(silent_platforms))
        lines.append('')

    return '\n'.join(lines)


def main():
    now_utc = datetime.now(timezone.utc)
    now_utc8 = now_utc + timedelta(hours=8)
    date_str = now_utc8.strftime('%Y-%m-%d')

    all_data = load_all_latest()
    if not all_data:
        print('未找到任何 *-latest.json 文件，请先运行聚合器。')
        return

    report = generate_report(all_data, now_utc8)

    dated_path = OUTPUT_DIR / f'daily-report-{date_str}.md'
    latest_path = OUTPUT_DIR / 'daily-latest.md'

    dated_path.write_text(report, encoding='utf-8')
    latest_path.write_text(report, encoding='utf-8')

    print(f'日报已生成：')
    print(f'  {dated_path}')
    print(f'  {latest_path}')


if __name__ == '__main__':
    main()
