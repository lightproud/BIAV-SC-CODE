---
type: "dataset"
title: "appstore 社区数据源"
description: "appstore 平台采集档案，全量 765 条，健康度 active。"
resource: "/Public-Info-Pool/Record/Community/appstore/global/"
tags: ["data_layer:full_archive", "platform:appstore", "health:active"]
timestamp: "2026-08-30T11:14:22.954382+00:00"
---

# 数据层指针

> 放指针不放本体：原始数据原地存放于 `resource`，本 concept 仅描述与定位。

| 项 | 值 |
|------|------|
| 平台 | appstore |
| 全量档案层（本体） | `Public-Info-Pool/Record/Community/appstore/global/` |
| 全量条数 | 765 |
| 采集健康度 | active |
| 最后成功 | 2026-08-26 |

# 数据纪律（硬约束）

- 长窗口分析 / 完整性审计 / 历史回溯 → **必须用全量档案层**（本 concept 的 `resource`）。
- 日报展示 / 快查 / 热度榜 → 同样回全量档案层按窗口取样：原「输出展示层」（projects/news/output/）已于 2026-08-21 整层删除，仓内不再存在可直读的抽样快照。
