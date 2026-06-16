#!/usr/bin/env python3
"""
Discord 只读连通性探针 — 验证 bot 在指定服务器的接入状态

不写任何文件、不提交、不抓取历史。仅用于确认：
  1. DISCORD_BOT_TOKEN 有效
  2. bot 已入驻目标 guild（DISCORD_GUILD_ID）
  3. bot 拥有 View Channels 权限（能列出频道）
  4. bot 拥有 Read Message History 权限（能读到消息）

用法:
  DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=1402537664619479100 \
    python projects/news/scripts/discord_probe.py
"""

import os
import sys
import time

import requests

API_BASE = 'https://discord.com/api/v10'
READABLE_TYPES = {0: 'text', 5: 'announcement', 15: 'forum'}


def _get(path, headers, **params):
    url = f'{API_BASE}{path}'
    for attempt in range(4):
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        if resp.status_code == 429:
            wait = max(resp.json().get('retry_after', 2), 2)
            time.sleep(wait)
            continue
        return resp
    return resp


def main():
    token = os.environ.get('DISCORD_BOT_TOKEN', '')
    guild_id = os.environ.get('DISCORD_GUILD_ID', '')
    if not token:
        print('FAIL: DISCORD_BOT_TOKEN 未设置')
        return 1
    if not guild_id:
        print('FAIL: DISCORD_GUILD_ID 未设置')
        return 1

    headers = {'Authorization': f'Bot {token}', 'Content-Type': 'application/json'}
    print(f'探测目标 guild_id = {guild_id}')

    # 1. guild 基本信息
    g = _get(f'/guilds/{guild_id}', headers)
    if g.status_code == 401:
        print('FAIL: token 无效（401 Unauthorized）')
        return 1
    if g.status_code == 403:
        print('FAIL: bot 无权访问该 guild（403 — bot 可能未入驻或缺权限）')
        return 1
    if g.status_code == 404:
        print('FAIL: guild 不存在或 bot 未入驻（404）')
        return 1
    if g.status_code != 200:
        print(f'FAIL: 获取 guild 失败 HTTP {g.status_code}: {g.text[:200]}')
        return 1
    guild = g.json()
    print(f'OK  guild 名称: {guild.get("name", "?")}')
    print(f'    成员数(近似): {guild.get("approximate_member_count", "未提供")}')

    # 2. 频道列表（View Channels 权限）
    c = _get(f'/guilds/{guild_id}/channels', headers)
    if c.status_code != 200:
        print(f'FAIL: 列出频道失败 HTTP {c.status_code}: {c.text[:200]}')
        return 1
    channels = c.json()
    type_counts = {}
    for ch in channels:
        t = ch.get('type', 0)
        type_counts[t] = type_counts.get(t, 0) + 1
    workable = [ch for ch in channels if ch.get('type', 0) in READABLE_TYPES]
    print(f'OK  频道总数: {len(channels)}')
    print(f'    可采集频道(文本/公告/论坛): {len(workable)}')
    for t, label in READABLE_TYPES.items():
        if t in type_counts:
            print(f'      - {label}: {type_counts[t]}')

    # 3. 抽样读消息（Read Message History 权限）
    text_channels = [ch for ch in workable if ch.get('type', 0) in (0, 5)]
    if not text_channels:
        print('WARN: 无文本/公告频道可抽样验证读消息权限')
        print('探测结论: bot 已入驻且能列频道，但无文本频道可验证读历史权限')
        return 0

    sample = text_channels[:3]
    readable_ok = 0
    for ch in sample:
        m = _get(f'/channels/{ch["id"]}/messages', headers, limit=1)
        name = ch.get('name', ch['id'])
        if m.status_code == 200:
            msgs = m.json()
            n = len(msgs) if isinstance(msgs, list) else 0
            print(f'OK  读消息「{name}」: 取回 {n} 条样本')
            readable_ok += 1
        elif m.status_code == 403:
            print(f'WARN 频道「{name}」: 403 无 Read Message History 权限')
        else:
            print(f'WARN 频道「{name}」: HTTP {m.status_code}')
        time.sleep(0.25)

    print('---')
    if readable_ok > 0:
        print(f'探测结论: 接入正常。bot 已入驻「{guild.get("name", "?")}」，'
              f'可列 {len(workable)} 个频道，抽样 {readable_ok}/{len(sample)} 个频道读消息成功。')
        return 0
    print('探测结论: bot 已入驻并能列频道，但抽样频道均无法读消息历史 —— '
          '请检查 bot 的 Read Message History 权限及频道级权限覆盖。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
