#!/usr/bin/env python3
"""archive_layout.py — 归档布局单一真相源（SSOT）。

背景（2026-07-02 体质改进 P0-1）：Record/Community 的目录布局知识此前散落在
写方（archive_platforms / backfill_platforms）与读方（silent_sources_audit /
repair_gaps / build_community_index）各自的代码里，2026-06-22 区服/类型分层
实施后读写认知漂移，造成 6 个采集源被误判沉默 10+ 天（同类病根还包括
collect_video_comments 写旧读新、backfill 写平级与分层写方对冲的隐患）。

本模块之后：**某源的数据落在哪、怎么找，全仓只有这里回答。**
写方与读方均 import 本模块；`tests/test_archive_layout.py` 以读写往返
契约测试锁定「写方落的路径，读方必能找回来」。

布局规范（甲方案，守密人 2026-06-21 裁定）：
  <平台>/<区服>/<类型>/YYYY-MM-DD.json —— 维度按需展开，单子类平台保持裸名平铺
  （bilibili/reddit/weibo/... 无区服维度，平级即规范形态，不是遗留）。

约定：本模块只提供**相对路径与遍历逻辑**，归档根目录由调用方持有并传入
（便于单测 monkeypatch 调用方自己的 ARCHIVE_DIR，不与本模块耦合）。
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Iterator

# 归档文件名 = 日期；state.json / manifest 等辅助文件不参与日期语义
DATE_STEM = re.compile(r'^\d{4}-\d{2}-\d{2}$')

# ── 折叠映射：源 → (宿主平台, 类型子目录) ────────────────────────────────────
# steam 家族三子类共享宿主 steam；taptap 评论流归 taptap/*/review。
# 与 sources.SOURCE_ALIASES / ARCHIVE_PLATFORM_FOLD 语义对齐（那边管「叫什么」，
# 这边管「放哪里」）。
FOLDED_SOURCE_LAYOUT: dict[str, tuple[str, str]] = {
    'steam':            ('steam', 'review'),
    'official':         ('steam', 'news'),
    'steam_discussion': ('steam', 'discussion'),
    'taptap_review':    ('taptap', 'review'),
}

# 宿主平台下被折叠源认领的类型子目录（宿主默认递归遍历时须避开，防双计）
CLAIMED_SUBTYPES: dict[str, set[str]] = {}
for _src, (_plat, _sub) in FOLDED_SOURCE_LAYOUT.items():
    if _src != _plat:
        CLAIMED_SUBTYPES.setdefault(_plat, set()).add(_sub)

# ── 写方默认落点：item 未携带 region/archive_subtype 字段时的兜底 ─────────────
# 只为「新数据已走分层」的平台设默认——防止无字段条目（如 backfill 回填的
# 历史条目）在迁移后又长出平级文件（lesson #42 对冲永动机）。
# 未列平台（bilibili 等单子类）保持平铺，属规范形态。
DEFAULT_REGION: dict[str, str] = {
    'steam': 'global',
    'appstore': 'global',
    'google_play': 'global',
    'youtube': 'global',
}
DEFAULT_SUBTYPE: dict[str, str] = {
    'youtube': 'video',
}


def build_relpath(platform: str, region: str | None, subtype: str | None,
                  date_str: str) -> Path:
    """归档相对路径（不含归档根）：<平台>[/<区服>][/<类型>]/YYYY-MM-DD.json。"""
    parts = [platform]
    if region:
        parts.append(region)
    if subtype:
        parts.append(subtype)
    return Path(*parts) / f'{date_str}.json'


def resolve_write_layout(source: str, region: str | None = None,
                         subtype: str | None = None) -> tuple[str, str | None, str | None]:
    """写方唯一落点解析：源名 → (宿主平台, 区服, 类型)。

    折叠源套 FOLDED_SOURCE_LAYOUT 给出宿主与类型；缺 region 的分层平台补
    DEFAULT_REGION；缺 subtype 的补 DEFAULT_SUBTYPE。未分层平台原样返回
    （region/subtype 保持 None → 平铺）。
    """
    if source in FOLDED_SOURCE_LAYOUT:
        platform, folded_subtype = FOLDED_SOURCE_LAYOUT[source]
        subtype = subtype or folded_subtype
    else:
        platform = source
    region = region or DEFAULT_REGION.get(platform)
    subtype = subtype or DEFAULT_SUBTYPE.get(platform)
    # 有类型必有区服（规范：区服上、类型下），防写出 <平台>/<类型>/ 畸形层级
    if subtype and not region:
        region = 'global'
    return platform, region, subtype


def iter_source_files(source: str, archive_dir: Path) -> Iterator[Path]:
    """读方唯一遍历：产出某源的全部归档日期文件（平铺旧布局 + 分层新布局）。

    折叠源：本源旧平级目录 + 宿主平台 <任意区服>/<类型>/ 下的文件。
    普通源：源目录递归，但跳过被其他折叠源认领的类型子目录。
    discord 不经本函数（独立归档器与目录语义，调用方自理）。
    """
    if source in FOLDED_SOURCE_LAYOUT:
        legacy = archive_dir / source
        if legacy.exists():
            yield from legacy.glob('*.json')
        platform, subtype = FOLDED_SOURCE_LAYOUT[source]
        base = archive_dir / platform
        if base.exists():
            yield from base.glob(f'*/{subtype}/*.json')
        return
    pdir = archive_dir / source
    if not pdir.exists():
        return
    claimed = CLAIMED_SUBTYPES.get(source, set())
    for f in pdir.rglob('*.json'):
        if f.parent.name in claimed:
            continue
        yield f


def dated_files(source: str, archive_dir: Path) -> list[Path]:
    """某源全部日期文件，按日期（stem）升序；过滤 state/manifest 类非日期文件。"""
    return sorted((f for f in iter_source_files(source, archive_dir)
                   if DATE_STEM.match(f.stem)),
                  key=lambda f: f.stem)
