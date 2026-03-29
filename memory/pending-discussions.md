# 待讨论事项

> 最后更新：2026-03-29 by Code-主控台
>
> 跨会话的待决策事项追踪。已决策的条目移入 decisions.md，已落地的条目删除。
> 所有会话启动时应阅读本文件。
>
> 最后更新：2026-03-29

## 采集管线

- [ ] **统一输出 JSON schema** — 当前 aggregator.py 和 report-system/collector.py 两套系统并存，输出格式不统一。需定义统一字段：platform / language / timestamp / content / sentiment / source_url / attachments。不管数据来自 API 自动拉取还是 Chrome 手动采集，都写入同一种格式。
- [ ] **Steam API 定时 cron** — curl 已验证可通（appid 3052450, purchase_type=all, filter=recent, 按 timestamp_created 过滤 24h）。需写成 GitHub Actions 定时任务。
- [ ] **B站 API 试通** — api.bilibili.com/x/web-interface/search/type 不需要登录，可搜视频和动态。优先级在 Steam 之后。
- [ ] **Discord 频道结构发现** — Issue #59 已提交，等 Actions 执行后拿到频道列表。
- [ ] **Discord 频道监控范围** — 等 #59 完成后，由运营官标注哪些频道进日报监控、哪些做资产归档。已确认的高价值频道：影画长廊 Morimens Gallery (ID: 1304022107847659520)。

## 存储

- [ ] **大文件存储方案** — 候选：Git LFS / GitHub Releases / Cloudflare R2 / 阿里云 OSS。等 Discord 频道结构出来后评估实际归档量再决策。核心判断：全量归档 vs 选择性归档（只存官方资产 + 高质量同人图，按频道 + 图片尺寸 + reaction 数过滤）。

## 日报流程

- [ ] **Chrome 手动采集规范** — 小红书、Discord、NGA、贴吧、Arca Live 无公开 API。需定义操作步骤和输出格式，让手动采集数据能进入报告管线。
- [ ] **两套采集系统合并** — aggregator.py vs report-system，功能重叠，需决策保留哪套或合并。

## 数据校验

- [ ] **Wiki JSON 数据抽查** — projects/wiki/data/db/ 下 16 个 JSON 的准确性，运营官负责抽查报告，制作人决定是否派 Issue 修正。尚未启动。
