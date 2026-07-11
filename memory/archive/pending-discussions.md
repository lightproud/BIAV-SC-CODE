# 待讨论事项

> **⚠ 定格快照（2026-04-26）**：文中 `collector.py` / `generate-report.yml` / `report-system/scripts/` 等路径反映当时 news 采集层结构，部分已重构/退役；现行采集器以 `ls projects/news/scripts/` 为准。
>
> 最后更新：2026-04-26 by 艾瑞卡会话（数据层审计副产物落档）
>
> **⚠ 已归档（2026-07-11 仓库精简裁定项 5）**：待办 / 待裁唯一权威已收归 `memory/todo.md`
>（2026-07-10 裁定），本档「所有会话启动时应阅读」的旧定位作废；归档时余 18 条未销开账
> 已并账为 `memory/todo.md` T30 复核项，销案以 todo.md 为准。
>
> （原定位，已作废）跨会话的待决策事项追踪。

## 采集管线

- [ ] **Discord 频道监控范围** — 由制作人标注哪些频道进日报监控、哪些做资产归档。已确认的高价值频道：影画长廊 Morimens Gallery (ID: 1304022107847659520)。activity_daily 统计已覆盖全服概览
- [ ] **Twitter/X 接入** — 需 TWITTER_BEARER_TOKEN
- [ ] **NGA 接入** — 需 NGA_FORUM_ID
- [ ] **TapTap 接入** — 需 TAPTAP_APP_ID
- [x] ~~**两套采集系统合并** — 当前方案：aggregator.py 为主线，report-system 暂冻结~~ **已解决（2026-04-11）**：`report-system/` 子目录下线；`collector.py` / `taptap_collector.py` 迁至 `projects/news/scripts/global_collectors.py` / `taptap_collector.py`，其余死代码（analyst/reporter/notifier/scheduler）删除，`generate-report.yml` workflow 也一并清理

## 日报流程

- [ ] **Chrome 手动采集规范** — 小红书、NGA、贴吧、Arca Live 无公开 API。需定义操作步骤和输出格式，让手动采集数据能进入报告管线
- [ ] **日报推送方式** — 当前日报只生成在仓库里，制作人需要主动查看。讨论是否需要通过 Discord Bot 或邮件自动推送

## 数据校验

- [x] **Wiki JSON 数据抽查（2026-04-20 B3 修正后作废）**：原任务基于假设"projects/wiki/data/db/ 下有 18 个 JSON"，B3 调研揭露该目录从未存在。Phase 2 W1 以 `memory/wiki-characters-schema-v1.md`（守密人 2026-04-20 裁决锁定）为基线重新规划，此条旧任务不再适用

## 事实圣经

- [ ] **事实圣经 v1.0 数据补全** — narrative-structure.json ✅ / design-decisions.json ✅ / characters.json dev_notes ✅（12个角色已补充，nautila 不在数据库中待确认）

## 站点

- [ ] **启用 GitHub Discussions** — Giscus 评论系统（Issue #91）需要在仓库 Settings → General → Features 中启用 Discussions 功能才能生效

## 数据层 / 采集器（2026-04-26 数据层审计 §六 副产物落档）

- [ ] **`steam_review` archiver 路径冲突复核** — `aggregator.fetch_steam_reviews` + `backfill_steam_reviews` 直接写 `data/platforms/steam_review/`，绕过 `archive_platforms.py`。本会话 commit 已把 `'steam_review'` 加入 `archive_platforms.PLATFORMS`，需复核是否会重复写入或冲突；如冲突则需选定单一权威 archiver
- [ ] **Discord 频道一致性 reconcile** — `data/discord/channels/` 实际 468 个子目录，但 `channel_index.json` 仅记录 146 个、`guild_meta.json` 记录 163 个。差集（约 305 个目录）可能是已离线/重命名/已删频道的历史归档。需要 `discord_archiver.py` 增加 reconcile 步骤，标记或迁移孤儿目录
- [ ] **`gap_report.json` 5173 缺口决策** — `repair_gaps.py` 报告 5173 个 platform-date 缺失。其中 appstore 占大头（自 2023-12 起几乎每日缺）。决策方向二选一：(a) 启动大规模 backfill（appstore RSS 不支持历史回溯，可能无解）；(b) 接受缺口为"非系统问题"，关闭 gap_report 的 appstore 监控
- [ ] **`weixin/2016-02-03.json` 数据真实性核查** — weixin archive 历史最深至 2016-02-03，跨度 10 年。但 `fetch_weixin` 当前实现是搜狗实时检索，不可能产生 2016 历史数据。需查档：是否早期手工导入 / 搜狗历史搜索结果 / 数据迁移残留，决定保留 or 清理种子数据
- [ ] **`COLLECTION_ARCHITECTURE.md` 全文重写** — 该文档 2026-04-11 创建后未维护，至今 (4-26) 累计偏差严重：仍提"29 个数据源"（实际 22）+ Twitter API（已删）+ wiki 类（已删）+ 不存在的 `report-system/scripts/collector.py` 路径 + 已删的 xiaohongshu/extended-latest.json 输出。建议主控台启动一次性重写
- [ ] **`platforms/{gamerch,miraheze_wiki}/` 历史归档处置** — wiki 类采集已废弃但 `data/platforms/` 下仍残留两目录（gamerch 8 文件 / 83 KB，miraheze_wiki 1 文件 / 2 KB）。决策：迁移到 `data/platforms/_legacy/` 子目录注释化，or 直接删除

## 数据层 / 采集器（守密人前序指令"不补 secret"导致的待解锁源）

- [ ] **NGA 接入解锁** — 沙箱 + cloudscraper 探查均返回 503/HTML（需登录态），cloudscraper 无法绕过。如要恢复 NGA 产出，需在 GitHub Secrets 配置 `NGA_COOKIE`。当前函数已就绪，仅缺 secret
- [ ] **Weibo m.weibo.cn API 接入** — 当前直接 GET 返回"Sina Visitor System"访客系统页面（非 JSON）。需要 `WEIBO_COOKIE` 或切换到 Playwright fallback。守密人前述"不补 secret"的策略下，建议优先走 Playwright fallback 路径
- [ ] **Bahamut / Arca.live selector 验证** — 沙箱 DNS 限制无法本地探查（503），实际 selector 可能仍有效（CI 环境正常 IP），等下次 cron 真实产出验证。如果 cron 仍 0 产出，参考 ruliweb 同模式做 HTML probe + 重写

## 数据层 / 采集器（待下一轮深修的 publish_time 污染）

- [ ] **bahamut HTML fallback `datetime.now()`** — `fetch_bahamut` API 路径已正确用 ctime，仅 HTML fallback（API 失败时极少触发）路径有 `datetime.now()` 污染。优先级低，可待修
