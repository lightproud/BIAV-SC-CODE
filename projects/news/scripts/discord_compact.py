#!/usr/bin/env python3
"""
Discord 记录紧凑 schema — 单一权威定义（归档器写盘 + 存量批量重写器共用此一份）

背景与裁定见 `memory/decisions.md`（2026-06-22 守密人裁定）与
`memory/strategy/repo-slimming-plan.md`。实测全量 721 万条中 91.8% 字节是元数据 + 重复
JSON key，content 正文仅 8.2%；多数字段近 100% 恒为默认值。本模块把「缺字段 = 默认值」
作为 schema 契约，恒删恒定/空值字段，变体 A（保留 channel_id，不耦合外部索引）。

契约（读取方据此还原缺省字段，全部可逆、零信息损失）：
  恒留      : id / author_id / author_name / content / timestamp
  非空才留  : edited_timestamp / mentions / reactions / attachments / reply_to / embeds
  非默认才留: type(!=0) / author_bot(true) / pinned(true) / flags(!=0) /
              has_thread(true) / thread_id(!=null)
  channel_id: 保留（变体 A——每行自足，grep 命中即知归属，不寄生 channel_index.json）

读取方约定：缺字段按默认值解释——
  type→0  author_bot→False  pinned→False  flags→0  has_thread→False
  thread_id→None  edited_timestamp→None  mentions/reactions/attachments/embeds→[]  reply_to→None
"""

# 恒留字段（按原 schema 顺序，保持人读友好）
_ALWAYS = ('id', 'channel_id', 'author_id', 'author_name', 'content', 'timestamp')
# 非空才留（容器 / 可空标量）
_KEEP_IF_TRUTHY = ('edited_timestamp', 'mentions', 'reactions', 'attachments', 'embeds', 'reply_to')


def compact_record(rec: dict) -> dict:
    """把完整 schema 记录压成紧凑 schema（变体 A）。幂等：紧凑记录再压仍是自身。"""
    out = {}
    for k in _ALWAYS:
        v = rec.get(k)
        # id/author_id/author_name/content/timestamp 恒留（即便空串也留占位）；
        # channel_id 仅在有值时留（理论恒有值，防御性处理）
        if k == 'channel_id':
            if v:
                out[k] = v
        else:
            out[k] = v if v is not None else ''
    if rec.get('type'):            # type != 0（回复 type=19 / 系统消息等）
        out['type'] = rec['type']
    if rec.get('author_bot'):      # true only
        out['author_bot'] = rec['author_bot']
    if rec.get('pinned'):
        out['pinned'] = rec['pinned']
    if rec.get('flags'):           # != 0
        out['flags'] = rec['flags']
    if rec.get('has_thread'):
        out['has_thread'] = rec['has_thread']
    if rec.get('thread_id') is not None:
        out['thread_id'] = rec['thread_id']
    for k in _KEEP_IF_TRUTHY:
        v = rec.get(k)
        if v:                      # 非空 list / 非 null / 非空串
            out[k] = v
    return out


def expand_record(rec: dict) -> dict:
    """把紧凑记录补回完整默认字段（供需要稳定 schema 的读取方；多数消费方用 .get 即可，无需此函数）。"""
    return {
        'id': rec.get('id', ''),
        'channel_id': rec.get('channel_id', ''),
        'type': rec.get('type', 0),
        'author_id': rec.get('author_id', ''),
        'author_name': rec.get('author_name', ''),
        'author_bot': rec.get('author_bot', False),
        'content': rec.get('content', ''),
        'timestamp': rec.get('timestamp', ''),
        'edited_timestamp': rec.get('edited_timestamp'),
        'pinned': rec.get('pinned', False),
        'mentions': rec.get('mentions', []),
        'reactions': rec.get('reactions', []),
        'attachments': rec.get('attachments', []),
        'embeds': rec.get('embeds', []),
        'reply_to': rec.get('reply_to'),
        'has_thread': rec.get('has_thread', False),
        'thread_id': rec.get('thread_id'),
        'flags': rec.get('flags', 0),
    }
