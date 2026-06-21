# News 聚合器 — 会话上下文

> 启动时请先阅读根目录 `CLAUDE.md` 了解全局。
> 最后更新：2026-06-17 by 艾瑞卡会话（新增日服 Discord 归档接入：探测 + 分层 workflow；上次 2026-06-09 主控台状态核验。实时进度权威在 `memory/project-status.md`）

## v2.0 新使命定位（2026-04-26 起）

**news = 银芯三新使命之 #1「黑池信息入口」核心载体**

- **新定位**：GitHub 自动化采集层 / 黑池消费的"眼睛和耳朵" / **银芯→黑池单向输出**
- **关键约束**：**黑池不倒灌银芯**（守密人 4-26 裁定）。news 输出格式与稳定性是黑池能否依赖银芯的关键
- **本子项目在 Phase 2（4-27 → 7-19，84 天）的优先级**：核心主线，与 wiki 并列最高
- **派发关系**：Code-news 接管 Phase 2 全部 news 加固任务，主控台不亲自动 news 业务文件

## 当前状态：Phase 2 加固期（自动化跑稳 + 黑池接口稳定化）

### 2026-06-09 状态核验（实测）
- **采集自动化持续运行**：`update-news` 每小时；`output/*-latest.json` 当日仍在更新
- **Discord → 聚合器桥接已落地**：aggregator 含 discord 通道，`output/discord-latest.json` 持续产出（M1 任务 1 完成）
- **YouTube 已接通**：`output/youtube-latest.json` 持续更新，`data/platforms/youtube{,_comments}/` 在归档（M2 首项完成）
- **新增 workflow（2026-06-05）**：`collect-comments`（每日 02:00 UTC 视频评论归档）/ `recover-fanart`（手动触发，刷新 Discord 过期 URL 恢复同人图）
- **daily-report 定时已停用**：报告改在 Claude Code 会话内订阅生成（零 API 费），workflow 仅留手动触发备用——M1 任务 3 的「日报 workflow 验证」语境已失效
- `data/platforms/` 已扩至 18 个平台目录
- M1 任务 2（月度清理触发）/ 任务 4（黑池接口 schema 评估）状态未在本次复核范围，待 Code-news 确认

## Phase 2 任务（M1-M4，2026-04-27 → 07-19）

### M1 基础设施加固（4-27 → 5-10，14 天）
1. [x] **桥接 Discord 归档数据到聚合器**：已落地（见 6-9 核验）
2. [ ] **Discord 月度清理首次触发**：`scripts/archive_discord.py --force-month YYYY-MM` 参数已实装。当前实测归档 193 MB，待守密人 UI 触发 `force_month=2026-03`（状态待核）
3. ~~验证日报质量~~：daily-report 定时已停用，报告改会话内生成，本项语境失效
4. [ ] **黑池接口稳定性评估**：评估 `output/*-latest.json` 的 schema 一致性（状态待核）

### M2 信息齐备（5-11 → 6-10，31 天）
> 全球采集覆盖范围与接入纪律见 `GLOBAL_COLLECTION_SPEC.md`（规定层，与 sources.py 配套）。
- [x] 接通 YouTube（6-9 实测：latest + 平台归档双通道在产出）
- [ ] Reddit 子版块名确认（r/Morimens 是否存在）
- [ ] Twitter / NGA / TapTap 配置密钥（如 Phase 2 优先级允许）
- [ ] 周报/月报机制（日报之上叠加趋势分析）
- [ ] 黑池接口规范文档对齐（参考 `memory/active/silver-blackpool-interface.md`）

### M3 稳定化（6-11 → 7-10，30 天）
- [ ] 自动化连续 30 天稳定运行验证
- [ ] 哨兵层异常检测覆盖率提升
- [ ] 黑池消费场景实战测试（守密人或黑池会话拉取 latest.json 验证）

### M4 开放测试 + 战略验收（7-11 → 7-19，9 天）
- [ ] 验收：news 自动化连续 30 天稳定运行 + 黑池有可消费的公开信息流（守密人确认）

### 注意事项
- update-news.yml 每小时运行一次（cron: '0 * * * *'）
- discord-archive.yml 已从每小时降到每日 1 次（18:00 UTC）+ 每月 1 日月度归档（Global 官方服，数据落 data/discord/ 根）
- discord-archive-volunteer.yml 每小时 :15（志愿者服务器 guild，数据落 guilds/{id}/）
- discord-archive-jp.yml 日服服务器归档（数据落 guilds/{id}/）：待填 JP_GUILD_ID 并启用 :45 错峰 cron，详见下「日服 Discord 接入」
- discord-discover-guilds.yml 手动触发：列出 bot 所在全部服务器，发现待接入 guild ID
- collect-comments.yml 每日 02:00 UTC（2026-06-05 新增）；recover-fanart.yml 手动触发（同日新增）
- daily-report.yml 定时已停用，仅手动备用（报告改会话内订阅生成）

### 日服 Discord 接入（2026-06-17）
bot 已接入日服 Discord，纳入归档计划。归档器（`discord_archiver.py`）按 guild_id 自动分层，
无需改采集代码，复用同一 `DISCORD_BOT_TOKEN`（与志愿者服务器同模式）。两步启用：

1. **发现 guild ID**：在 Actions 运行 `Discord Discover Guilds`（`discord-discover-guilds.yml`，
   仅手动触发）。脚本 `discord_list_guilds.py` 调 `/users/@me/guilds` 列出 bot 所在全部服务器，
   对照已登记清单（Global / 志愿者）高亮「未登记」者，快照写入
   `projects/news/data/discord/guilds_seen.json` 并提交回仓库。日服 ID 即在该快照中。
2. **启用归档**：把日服 ID 填入 `discord-archive-jp.yml` 的 `env.JP_GUILD_ID`，取消其
   `schedule` 区块注释（保留 `:45` 错峰，避开 Global 与志愿者）。在 ID 配置前，该 workflow
   经 Guard 步骤安全跳过——绝不因空 ID 回落到 Global guild。

首跑会全量回溯日服建服至今的历史（归档器对新 guild 的 cold-start 行为），数据隔离落
`data/discord/guilds/{JP_GUILD_ID}/`，与 Global / 志愿者互不污染。

## 已完成
- [x] aggregator.py 基础架构（Reddit/Bilibili/Twitter/NGA/TapTap/Steam）
- [x] index.html 前端页面（深色主题，平台筛选）
- [x] GitHub Actions 自动抓取
- [x] B站 + Steam 数据源接通
- [x] Discord 全量归档系统（537 频道）
- [x] split_output.py Steam 数据标准化修复

## 多平台按日归档
- **已完成**：`archive_platforms.py` — 将 *-latest.json 按日期存入 `data/platforms/{platform}/YYYY-MM-DD.json`
- 覆盖平台：Steam / Bilibili / Official / Reddit / Twitter / YouTube / NGA / TapTap
- Discord 已有独立归档器（`discord_archiver.py`），不重复
- 已集成到 `update-news.yml` workflow，每次聚合后自动归档
- 支持去重合并、指定日期归档、统计报表
- 运行方式：`python scripts/archive_platforms.py [--date YYYY-MM-DD] [--stats]`
- ⚠ 上述扁平 `data/platforms/{platform}/` 结构为**旧布局**，按下方《采集源命名与归档结构规范》迁移中。

## 采集源命名与归档结构规范（2026-06-21 grilling 对齐，待实施）

> 守密人 2026-06-21 拷问对齐定案。解决「来源名混乱、未含子类、区服拼名过细」三病。

### 核心原则
1. **数据根 = `Public-Info-Pool/Record/Community/`**，无 `platforms/` 中间层。
2. **层级 = `平台 / 区服 / 类型 / YYYY-MM-DD.json`**；区服在上、类型在下；**维度按需展开**（无区服平台省区服层，单类型平台省类型层）。
3. **source 标识 = 归档相对路径**：如 `steam/jp/review`、`taptap/cn/post`、`youtube/global/comments`、`discord/global`、`weibo`。
4. **区服准则**：不同 appid / 独立运营 → **拆区服目录**；同 appid 多国 → 留 `platform_region` 字段、不拆。
5. **父子衍生子类不拆 source**：视频↔评论是父子（评论依附视频），收编主源（YouTube），用类型层子目录区分。

### 子类型词表
`review`（带评分商店评价）/ `news`（官方公告）/ `discussion`（官方讨论区）/ `post`（社区/论坛帖）/ `strategy`（攻略）/ `video` / `comments`

### 各平台结构
| 平台 | 结构 | 备注 |
|------|------|------|
| steam | `steam/{global,jp}/{review,news,discussion}/` | global=3052450 / jp=4226130 |
| appstore | `appstore/{global,jp}/` | global=6447354150 多国走字段 / jp=6743462069（AltPlus 独立 app） |
| google_play | `google_play/{global,jp}/` | global=com.qookkagames.z1.gp.hk / **jp 包名待查** |
| youtube | `youtube/{global,jp}/{video,comments}/` | 视频+评论合并收编 |
| twitter (X) | `twitter/{global,jp}/` | global=@MorimensOfcl / jp=@bokyakuzenya；单类型 |
| taptap | `taptap/cn/{review,post,strategy}/` | cn = 364992（预约）+ 374995（测试服）合并，`app_id` 字段区分 |
| discord | `discord/{global,jp,volunteer}/<channel_id>/` | 三服务器；频道即最细层，无类型层 |
| 单类型裸名 | `weibo/`、`bilibili/`、`reddit/`、`pixiv/`、`ruliweb/`、`stopgame/`、`weixin/`、`bahamut/`、`arca_live/`、`note_com/` | 直接日期文件 |

### 日本版 = AltPlus Inc. 独立发行
忘却前夜日本版在各平台为 AltPlus 单独运营的独立 app/账号，故一律拆 `jp/` 区服目录（非同 appid 多国）。

### 实施待办（独立任务，非本次 grilling 范围）
- 改 `sources.py`：source 标识改路径式 + 合并重复 taptap 评论栈（aggregator `fetch_taptap` 仅 4 条 → 弃；统一走 taptap_collector）。
- 新增日本版/日服采集：steam jp(4226130)、appstore jp(6743462069)、youtube jp 频道、google_play jp 包名（**待查**）、discord jp 已接入。
- taptap 评论采全（440 → 1163，API total）+ 新增 `post`/`strategy`（Playwright DOM）。
- `discord_archiver` 统一三服务器到 `discord/<区服>/`（现全球服在 channels/ 根、其余在 guilds/，不一致）。
- 历史归档目录迁移到新层级。
- `official` 并入 `steam/global/news`；`youtube_comments` 并入 `youtube/*/comments`。

## 后续待做（非本周）
- Reddit 子版块名需确认（r/Morimens 是否存在）
- Twitter/NGA/TapTap 需配置密钥
- YouTube 需 API Key（代码已就绪）

## 文件说明
- `index.html` — 前端展示页面（纯 HTML/CSS/JS，深色主题）
- `projects/news/scripts/aggregator.py` — 主采集管线（每小时自动运行）
- `projects/news/scripts/global_collectors.py` — 全球 29 个平台零成本采集器集合（被 `collect_global.py` 和 `backfill_platforms.py` 引用）
- `projects/news/scripts/taptap_collector.py` — TapTap Playwright 采集器（`global_collectors.py` 的依赖）
- `projects/news/scripts/collect_global.py` — 全球采集桥接脚本，合并 aggregator 输出
- `projects/news/scripts/backfill_platforms.py` — 多平台历史回溯采集
- `projects/news/scripts/split_output.py` / `archive_platforms.py` / `download_media.py` — 后处理管线（split 拆分到 *-latest.json，archive 按日归档到 data/platforms/）
- `requirements.txt` — Python 依赖
- `.env.example` — 环境变量配置模板

## 验证清单
- [ ] aggregator.py 运行后 news.json 条目数 > 0
- [ ] 所有条目有 title、url、source、time 字段
- [ ] 无重复条目

## 给 Code 会话的指令
- 工作目录：`projects/news/`
- 聚合输出写入：`projects/news/output/news.json`
- 中间产出放：`projects/news/output/`
- 不要修改其他子项目的文件

## 启动验证清单

新会话启动时，请逐项检查：

- [ ] 阅读根目录 `CLAUDE.md` 了解全局上下文
- [ ] 阅读 `memory/project-status.md` 确认 news 子项目当前状态
- [ ] 检查 `projects/news/output/news.json` 最新更新时间，确认聚合器是否正常运行
- [ ] 检查 GitHub Actions 最近一次 `news-aggregator` 工作流是否成功
- [ ] 确认你要修改的文件不属于其他子项目
- [ ] 完成任务后更新本文件"当前状态"和"待解决"部分
