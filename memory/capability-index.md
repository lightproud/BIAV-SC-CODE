# 银芯功能目录（capability-index）

> 本文件由 `scripts/build_capability_registry.py` 自动生成，**请勿手改**。
> 中文用途补注请改 `memory/capability-annotations.json`；机器权威数据见 `memory/capability-registry.json`。

- 生成日期：2026-06-20
- 功能总数：**78**
- 脚本可达性：活 44 / 仅测试 0 / 孤儿 0

## 总览

| 功能层 | 数量 |
|------|------|
| CI 自动化工作流（编排入口·定时/事件平面） | 21 |
| 顶层脚本（记忆 / 做梦 / 解包 / 运营） | 12 |
| news 采集器脚本 | 25 |
| wiki 数据脚本 | 7 |
| MCP 知识层工具（编排入口·AI 动态平面） | 4 |
| Slash 命令（编排入口·人工平面） | 4 |
| 仓内技能 | 1 |
| 子项目 | 4 |

## 动态编排与可达性

银芯只有四个编排平面，其中只有 MCP 是运行时真动态：

| 编排平面 | 触发 | 动态 |
|------|------|------|
| 定时/事件（工作流）| cron + push | 否（静态调度）|
| AI 动态（MCP 工具）| 艾瑞卡运行时自选 | 是 |
| 人工（slash 命令 / 技能）| 守密人下达 | 半动态 |
| CLI 手动（带 __main__ 的脚本）| 守密人/子进程直跑 | 手动 |
| 会话钩子 | 钩子自动 | 已退役（settings.json 无钩子）|

可达性 = 从活编排入口沿 Python import 图传递闭包。`孤儿` = 无任何活入口可达，建议隔离待裁（§3.1 裁撤属守密人决策，工具只检测不删除）。

## CI 自动化工作流（编排入口·定时/事件平面）（21）

- **`Backfill Data Gap`** _[manual]_ — 手动回填指定时间段的数据缺口。  
  `.github/workflows/backfill-gap.yml`
- **`Backfill & Archive Media`** _[schedule/manual]_ — 定时回填并归档媒体文件（同人图等）。  
  `.github/workflows/backfill-media.yml`
- **`Backfill Historical News`** _[schedule/manual]_ — 定时回填历史社区新闻。  
  `.github/workflows/backfill-news.yml`
- **`Build Capability Registry`** _[push/manual]_ — 功能源变动时自动重生成银芯功能目录。  
  `.github/workflows/build-capability-registry.yml`
- **`Check Morimens Version Updates`** _[schedule/manual]_ — 定时检测 Morimens 客户端版本更新。  
  `.github/workflows/check-version.yml`
- **`Claude Code`** — Claude Code GitHub 协作入口（@claude 触发）。  
  `.github/workflows/claude.yml`
- **`Cleanup Stale Branches`** _[schedule/manual]_ — 定时清理过期分支。  
  `.github/workflows/cleanup-stale-branches.yml`
- **`Collect Video Comments`** _[schedule/manual]_ — 定时采集视频评论。  
  `.github/workflows/collect-comments.yml`
- **`Collect Fan Art`** _[schedule/manual]_ — 定时采集同人图。  
  `.github/workflows/collect-fanart.yml`
- **`Deploy Site`** _[push/manual]_ — push 触发部署 site 静态站。  
  `.github/workflows/deploy-site.yml`
- **`Discord Archive (JP)`** _[schedule/manual]_ — 定时归档日服 Discord 数据。  
  `.github/workflows/discord-archive-jp.yml`
- **`Discord Archive (Volunteer)`** _[schedule/manual]_ — 定时归档志愿者 Discord 数据。  
  `.github/workflows/discord-archive-volunteer.yml`
- **`Discord Archive`** _[schedule/manual]_ — 定时归档主 Discord 数据。  
  `.github/workflows/discord-archive.yml`
- **`Discord Discover Guilds`** _[manual]_ — 定时发现新的 Discord 服务器。  
  `.github/workflows/discord-discover-guilds.yml`
- **`Discord History Backfill`** _[schedule/manual]_ — 定时回填 Discord 历史消息。  
  `.github/workflows/discord-history-backfill.yml`
- **`Extract Game Data from Client`** _[push/manual]_ — 解包提取客户端游戏数据（wiki 数据源）。  
  `.github/workflows/extract-game-data.yml`
- **`Recover Fan Art`** _[manual]_ — 恢复丢失的同人图。  
  `.github/workflows/recover-fanart.yml`
- **`Test All Data Collectors`** _[manual]_ — 运行采集器单元测试。  
  `.github/workflows/test-collectors.yml`
- **`Run Tests`** _[push/pull_request/manual]_ — 运行全量 pytest 单元测试。  
  `.github/workflows/test.yml`
- **`Update Community News`** _[schedule/manual]_ — 每小时采集社区新闻并更新输出层。  
  `.github/workflows/update-news.yml`
- **`Validate Wiki Data`** _[push/pull_request/manual]_ — 校验 wiki JSON 数据（push/PR 触发）。  
  `.github/workflows/validate-data.yml`

## 顶层脚本（记忆 / 做梦 / 解包 / 运营）（12）

- **`build_capability_registry.py`** _[活:cli+workflow]_ — build_capability_registry.py — 银芯功能目录 + 动态编排可达性分析器  
  `scripts/build_capability_registry.py`
- **`character_persona.py`** _[活:cli+mcp]_ — 艾瑞卡角色人格 prompt 生成器，MCP character_persona 后端。  
  `scripts/character_persona.py`
- **`generate_wiki_pages.py`** _[活:cli+workflow]_ — Generate VitePress Markdown pages from processed JSON data.  
  `scripts/generate_wiki_pages.py`
- **`lua_parse.py`** _[活:import]_ — 解包 Lua 表 dump 的共享解析库，供各 parse_* CLI 工具调用。  
  `scripts/lua_parse.py`
- **`mcp_server.py`** _[活:cli+mcp]_ — MCP 服务端 biav-sc-memory，暴露 4 个平台互补工具。  
  `scripts/mcp_server.py`
- **`parse_awaker_config.py`** _[活:cli]_ — [CLI 手动] 解析 AwakerConfig.lua 为角色档案 JSON（wiki 数据流水线）。  
  `scripts/parse_awaker_config.py`
- **`parse_cg_gallery.py`** _[活:cli]_ — [CLI 手动] 解析 CG 画廊清单为分章 JSON。  
  `scripts/parse_cg_gallery.py`
- **`parse_collection_hall.py`** _[活:cli]_ — [CLI 手动] 解析 CollectionHall.lua 为世界观百科 JSON。  
  `scripts/parse_collection_hall.py`
- **`parse_item_stories.py`** _[活:cli]_ — [CLI 手动] 解析 Item.lua 提取带背景故事的道具。  
  `scripts/parse_item_stories.py`
- **`parse_voice_lines.py`** _[活:cli]_ — [CLI 手动] 解析 Voice.lua 为 wiki 语音页 JSON。  
  `scripts/parse_voice_lines.py`
- **`report_render.py`** _[活:cli+command]_ — 银芯报告渲染器 — 结构化 markdown → 统一视觉风格的 PDF + HTML。  
  `scripts/report_render.py`
- **`silver_memory_tools.py`** _[活:cli+mcp]_ — 记忆写入工具库（current_continuity / record_decision / record_lesson），由 mcp_server 注册。  
  `scripts/silver_memory_tools.py`

## news 采集器脚本（25）

- **`aggregator.py`** _[活:cli+command+workflow]_ — 忘却前夜 Morimens - 社区热点聚合器  
  `projects/news/scripts/aggregator.py`
- **`aggregator_base.py`** _[活:import]_ — Shared base for the news aggregator: HTTP/logging setup, config  
  `projects/news/scripts/aggregator_base.py`
- **`aggregator_collectors.py`** _[活:import]_ — Per-platform news collectors (Reddit, Bilibili, NGA, TapTap, Steam,  
  `projects/news/scripts/aggregator_collectors.py`
- **`archive_discord.py`** _[活:cli+workflow]_ — Discord 月度归档脚本 — 打包超 60 天 JSONL → GitHub Releases → 从 git 删除  
  `projects/news/scripts/archive_discord.py`
- **`archive_platforms.py`** _[活:cli+workflow]_ — 多平台按日归档脚本 — 将 news.json（merged 全量层）按每条目真实日期存入 data/platforms/  
  `projects/news/scripts/archive_platforms.py`
- **`backfill_forum_starters.py`** _[活:cli+workflow]_ — backfill_forum_starters.py — 一次性回填所有 forum thread 的 starter 消息  
  `projects/news/scripts/backfill_forum_starters.py`
- **`backfill_gap.py`** _[活:cli+workflow]_ — backfill_gap.py — One-time script to backfill the Apr 13-25 data gap.  
  `projects/news/scripts/backfill_gap.py`
- **`backfill_media.py`** _[活:cli+workflow]_ — 媒体补录器 — 扫全量归档，把仍存活的图片全部下载归档，二进制走 Releases（决策 038/059）。  
  `projects/news/scripts/backfill_media.py`
- **`backfill_platforms.py`** _[活:cli+workflow]_ — backfill_platforms.py — 多平台历史数据回溯采集  
  `projects/news/scripts/backfill_platforms.py`
- **`collect_fanart.py`** _[活:cli+workflow]_ — 同人图采集器 — 把某日各信息源的玩家二创图抓到本地，供日报附录嵌图。  
  `projects/news/scripts/collect_fanart.py`
- **`collect_global.py`** _[活:cli]_ — collect_global.py — 全球社区采集桥接脚本  
  `projects/news/scripts/collect_global.py`
- **`collect_video_comments.py`** _[活:cli+workflow]_ — YouTube 视频评论采集器（累积归档版）。  
  `projects/news/scripts/collect_video_comments.py`
- **`collection_state.py`** _[活:import]_ — collection_state.py — Adaptive time window for news collection pipeline.  
  `projects/news/scripts/collection_state.py`
- **`data_quality.py`** _[活:cli]_ — 数据质量增强模块  
  `projects/news/scripts/data_quality.py`
- **`discord_archiver.py`** _[活:cli+workflow]_ — Discord 全量数据归档器 v2 — 双轨并行 + 断点续传 + JSONL 去重  
  `projects/news/scripts/discord_archiver.py`
- **`discord_list_guilds.py`** _[活:cli+workflow]_ — Discord 服务器清单探测 — 列出 bot 当前加入的所有服务器（guild）  
  `projects/news/scripts/discord_list_guilds.py`
- **`download_media.py`** _[活:cli+workflow]_ — download_media.py — 全平台媒体资源下载器  
  `projects/news/scripts/download_media.py`
- **`global_collectors.py`** _[活:import]_ — 忘却前夜 Morimens - 全球信息收集器  
  `projects/news/scripts/global_collectors.py`
- **`news_common.py`** _[活:import]_ — news_common.py — 采集层共享工具（ARCH-01/02 收敛单一归属）  
  `projects/news/scripts/news_common.py`
- **`playwright_collectors.py`** _[活:cli]_ — Playwright-based collectors for Morimens community news.  
  `projects/news/scripts/playwright_collectors.py`
- **`repair_gaps.py`** _[活:cli+workflow]_ — repair_gaps.py — Detect and report date gaps in platform archives.  
  `projects/news/scripts/repair_gaps.py`
- **`silent_sources_audit.py`** _[活:cli+workflow]_ — silent_sources_audit.py — 沉默源审计（基于归档历史）  
  `projects/news/scripts/silent_sources_audit.py`
- **`sources.py`** _[活:workflow]_ — sources.py — 采集源单一真相源（single source of truth）  
  `projects/news/scripts/sources.py`
- **`split_output.py`** _[活:cli+workflow]_ — split_output.py — 按数据源分割 projects/news/output/news.json  
  `projects/news/scripts/split_output.py`
- **`taptap_collector.py`** _[活:cli]_ — TapTap 社区采集器 - Playwright 无头浏览器方案  
  `projects/news/scripts/taptap_collector.py`

## wiki 数据脚本（7）

- **`build_banner_character_index.py`** _[活:cli]_ — 构建卡池角色索引。  
  `projects/wiki/scripts/build_banner_character_index.py`
- **`build_drop_index.py`** _[活:cli]_ — 构建掉落物索引。  
  `projects/wiki/scripts/build_drop_index.py`
- **`check_version.py`** _[活:cli+workflow]_ — 检测 Morimens 客户端版本更新。  
  `projects/wiki/scripts/check_version.py`
- **`decrypt_and_extract.py`** _[活:cli]_ — 客户端解密 + 解包流水线（经子进程/手动调用）。  
  `projects/wiki/scripts/decrypt_and_extract.py`
- **`extract_client_data.py`** _[活:cli+workflow]_ — 从客户端解包提取结构化游戏数据。  
  `projects/wiki/scripts/extract_client_data.py`
- **`generate_rss.py`** _[活:cli+workflow]_ — generate_rss.py - Generate RSS and Atom feeds for the Morimens wiki.  
  `projects/wiki/scripts/generate_rss.py`
- **`validate_data.py`** _[活:cli+workflow]_ — 校验 wiki 数据库全部 JSON。  
  `projects/wiki/scripts/validate_data.py`

## MCP 知识层工具（编排入口·AI 动态平面）（4）

- **`character_persona`** — 激活角色人格模式，让AI以游戏角色的语气进行对话。  
  `scripts/mcp_server.py`
- **`record_decision`** — 追加决策条目到 memory/decisions.md 的当前有效决策表格末尾。  
  `scripts/mcp_server.py`
- **`record_lesson`** — 追加教训条目到 memory/lessons-learned.md 末尾。  
  `scripts/mcp_server.py`
- **`current_continuity`** — 读取 session 连续性链（上次 session 快照 + topics_hint）。  
  `scripts/mcp_server.py`

## Slash 命令（编排入口·人工平面）（4）

- **`biav-report`** — 产出银芯社区情报深度报告（角色推荐 / bug 修复优先级等）。  
  `.claude/commands/biav-report.md`
- **`daily-news`** — 运行 news 采集器并校验输出，非空才提交。  
  `.claude/commands/daily-news.md`
- **`sync-memory`** — 核对各子项目实际文件状态，同步共享记忆文件。  
  `.claude/commands/sync-memory.md`
- **`validate-data`** — 校验 wiki 数据库全部 JSON 数据文件。  
  `.claude/commands/validate-data.md`

## 仓内技能（1）

- **`anysearch`** — 实时网络检索（多区社区情报 CN/JP/TW），AnySearch API 封装，失败回退内置 WebSearch。  
  `.claude/skills/anysearch/SKILL.md`

## 子项目（4）

- **`game`** — 衍生游戏，退出主线，守密人个人兴趣，不主线派发。  
  `projects/game/`
- **`news`** — 使命#1 黑池信息入口：采集器 + 全量档案层 + 输出展示层，单向送黑池。  
  `projects/news/`
- **`site`** — 使命#3 对外门户：静态站 public/ + 设计令牌 design/。  
  `projects/site/`
- **`wiki`** — 使命#2 社区知识底座：VitePress 站点 + 72 角色数据库（客户端解包自举）。  
  `projects/wiki/`
