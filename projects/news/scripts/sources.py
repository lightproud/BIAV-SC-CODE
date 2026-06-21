#!/usr/bin/env python3
"""
sources.py — 采集源单一真相源（single source of truth）

历史上 split_output.py / archive_platforms.py / silent_sources_audit.py /
collect_global.py 各自维护一份源清单，长期漂移，导致「采了不归档」「归档了不审计」
的盲区。本模块集中定义全部源清单，上述脚本统一 import，杜绝漂移。

清单语义:
  KNOWN_SOURCES     —— 当前在产线采集的活跃源（split_output 据此分文件）
  SOURCE_ALIASES    —— 原始源名 → 规范源名（归一化）
  SPARSE_SOURCES    —— 稀疏源（评论 / 公告 / 同人），使用更宽时间窗口
  CORE_SOURCES      —— 主管线核心源，长期 0 产出视为故障（健康门控）
  ARCHIVE_PLATFORMS —— 需按日归档到 data/platforms/ 的源（= KNOWN - discord）
  BACKFILL_PLATFORMS—— backfill_platforms.py 实际支持回溯的源
  LEGACY_SOURCES    —— data/platforms/ 下仍有历史归档、但采集逻辑已移除的源
"""

# 当前在产线采集的活跃源（与 split_output 历史 KNOWN_SOURCES 对齐）
KNOWN_SOURCES = [
    'bilibili',
    'steam',
    'taptap',
    'discord',
    'youtube',
    'reddit',
    'official',
    'steam_discussion',
    # 全球扩展平台
    'weibo',
    'bahamut',
    'arca_live',
    'appstore',
    'google_play',
    'pixiv',
    # 日语扩展
    'note_com',
    # 韩语扩展
    'ruliweb',
    # 俄语平台
    'stopgame',
    # 中文补充
    'weixin',
    # 官方 X 账号时间线（syndication 接口，无 key；仅官方号，无关键词搜索）
    'twitter',
    # TapTap 评论流（taptap_collector 衍生 source，与 taptap 论坛帖分桶归档；走主线 news.json）
    'taptap_review',
]

# 原始源名 → 规范源名
SOURCE_ALIASES = {
    'bilibili_articles': 'bilibili',
    'bilibili_dynamic': 'bilibili',
    'steam_review': 'steam',
}

# 稀疏源（split_output + collect_global 历史两份清单的并集）
SPARSE_SOURCES = {
    'official',
    'appstore', 'google_play',
    'weixin',
    'pixiv',
    'stopgame',
    'note_com', 'ruliweb', 'arca_live', 'bahamut',
    'taptap', 'taptap_review',
    'discord',
    'twitter',  # 官方号公告，发布不频繁，用 30 天宽窗
}

# 主管线核心源（aggregator.py 直采）。长期 0 产出 = 采集故障，健康门控据此告警。
CORE_SOURCES = [
    'reddit', 'bilibili', 'taptap',
    'steam', 'official', 'youtube', 'discord',
]

# §4.2 R1 硬失败源：本次运行中崩溃且未被 fallback 救回即令整次失败（aggregator.py 据此）。
# 严格子集，区别于 CORE_SOURCES（长期健康门控）：这三个是「单次跑必须有的命脉源」，
# 不含 youtube/discord 等可因 AUTH_GATED 缺 cookie 而预期降级的源。
R1_HARD_FAIL_SOURCES = {'reddit', 'bilibili', 'taptap'}

# 需登录态 cookie / API key 才能采集的源 → 所需环境变量名（单一真相源）。
# 未配置对应 secret 时：该源 0 产出属预期降级（标注「待配」，不计采集故障）；
# 已配置 secret 仍 0 产出：才视为真故障。collect_global 据此区分「待配 cookie」与「核心源静默失败」。
AUTH_GATED = {
    'youtube': 'YOUTUBE_API_KEY',
    'discord': 'DISCORD_BOT_TOKEN',
}

# Discord 有独立归档器（discord_archiver.py），不走 archive_platforms 的按日归档
ARCHIVE_PLATFORMS = [s for s in KNOWN_SOURCES if s != 'discord']

# backfill_platforms.py 的 PLATFORM_BACKFILLERS 实际支持的源（务必与之同步）
BACKFILL_PLATFORMS = [
    'bilibili', 'appstore', 'steam_review', 'arca_live',
    'pixiv', 'ruliweb', 'weixin', 'taptap',
]

# 独立归档源：由专用采集器直接写 data/platforms/，不经主线 news.json
# （故不进 KNOWN_SOURCES——否则 split_output 会按 news.json 切出空 latest 文件）。
# 活跃采集中，需纳入静默源审计的正常分级（见 silent_sources_audit.ALL_REGISTERED_SOURCES）。
INDEPENDENT_ARCHIVE_SOURCES = [
    'youtube_comments',  # collect_video_comments.py 直写 platforms/youtube_comments/
]

# data/platforms/ 下仍有历史归档、但采集逻辑已移除的遗留源。
# 不再产出新数据，仅供审计可见（避免被静默源审计无视）。
LEGACY_SOURCES = [
    'taptap_post',
]


def normalize_source(raw: str) -> str:
    """原始源名归一化为规范源名。"""
    return SOURCE_ALIASES.get(raw, raw)
