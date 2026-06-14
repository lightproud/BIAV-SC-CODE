# News 聚合器 — 会话上下文

> 启动时请先阅读根目录 `CLAUDE.md` 了解全局。
> 最后更新：2026-06-09 by 主控台（艾瑞卡会话，状态核验刷新；实时进度权威在 `memory/project-status.md`）

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
- [ ] 黑池接口规范文档对齐（参考 `memory/silver-blackpool-interface.md`）

### M3 稳定化（6-11 → 7-10，30 天）
- [ ] 自动化连续 30 天稳定运行验证
- [ ] 哨兵层异常检测覆盖率提升
- [ ] 黑池消费场景实战测试（守密人或黑池会话拉取 latest.json 验证）

### M4 开放测试 + 战略验收（7-11 → 7-19，9 天）
- [ ] 验收：news 自动化连续 30 天稳定运行 + 黑池有可消费的公开信息流（守密人确认）

### 注意事项
- update-news.yml 每小时运行一次（cron: '0 * * * *'）
- discord-archive.yml 已从每小时降到每日 1 次（18:00 UTC）+ 每月 1 日月度归档
- collect-comments.yml 每日 02:00 UTC（2026-06-05 新增）；recover-fanart.yml 手动触发（同日新增）
- daily-report.yml 定时已停用，仅手动备用（报告改会话内订阅生成）

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
