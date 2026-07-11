---
type: "dataset"
title: "appstore 社区数据源"
description: "appstore 平台采集档案，全量 688 条，健康度 active。"
resource: "/Public-Info-Pool/Record/Community/appstore/global/"
tags: ["data_layer:full_archive", "platform:appstore", "health:active"]
timestamp: "2026-07-11T02:02:01.865467+00:00"
---

# 数据层指针

> 放指针不放本体：原始数据原地存放于 `resource`，本 concept 仅描述与定位。

| 项 | 值 |
|------|------|
| 平台 | appstore |
| 全量档案层（本体） | `Public-Info-Pool/Record/Community/appstore/global/` |
| 输出展示层（抽样） | `projects/news/output/appstore-latest.json` |
| 全量条数 | 688 |
| 采集健康度 | active |
| 最后成功 | 2026-07-08 |

# 数据纪律（硬约束）

- 长窗口分析 / 完整性审计 / 历史回溯 → **必须用全量档案层**（本 concept 的 `resource`）。
- 日报展示 / 快查 / 热度榜 → 用输出展示层即可。
- 两层语义**不可互换**（CLAUDE.md §4.1，lesson #30）。
