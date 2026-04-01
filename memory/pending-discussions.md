# 待讨论事项

> 最后更新：2026-04-01 by Code-主控台
>
> 跨会话的待决策事项追踪。已决策的条目移入 decisions.md，已落地的条目删除。
> 所有会话启动时应阅读本文件。

## 采集管线

- [ ] **Discord 频道监控范围** — 由制作人标注哪些频道进日报监控、哪些做资产归档。已确认的高价值频道：影画长廊 Morimens Gallery (ID: 1304022107847659520)。activity_daily 统计已覆盖全服概览
- [ ] **Twitter/X 接入** — 需 TWITTER_BEARER_TOKEN
- [ ] **NGA 接入** — 需 NGA_FORUM_ID
- [ ] **TapTap 接入** — 需 TAPTAP_APP_ID
- [ ] **两套采集系统合并** — 当前方案：aggregator.py 为主线，report-system 暂冻结。aggregator 已覆盖 Bilibili/Steam/Discord/Reddit/YouTube/Fandom，report-system 待 aggregator 稳定后决定去留

## 日报流程

- [ ] **Chrome 手动采集规范** — 小红书、NGA、贴吧、Arca Live 无公开 API。需定义操作步骤和输出格式，让手动采集数据能进入报告管线
- [ ] **日报推送方式** — 当前日报只生成在仓库里，制作人需要主动查看。讨论是否需要通过 Discord Bot 或邮件自动推送

## 数据校验

- [ ] **Wiki JSON 数据抽查** — projects/wiki/data/db/ 下 18 个 JSON 的准确性，运营官负责抽查报告，制作人决定是否派 Issue 修正。尚未启动

## 事实圣经

- [ ] **事实圣经 v1.0 数据补全** — narrative-structure.json ✅ / design-decisions.json ✅ / characters.json dev_notes ✅（12个角色已补充，nautila 不在数据库中待确认）

## 站点

- [ ] **启用 GitHub Discussions** — Giscus 评论系统（Issue #91）需要在仓库 Settings → General → Features 中启用 Discussions 功能才能生效
