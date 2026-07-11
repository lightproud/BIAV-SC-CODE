---
type: "knowledge-pointer"
title: "Discord 数据归档系统设计方案"
description: "忘却前夜 Discord 服务器数据量远超预期——单个频道历史消息达 **76 万条**。纯 git 存储不可持续，需要设计分级存储 + 增量抓取方案。"
resource: "/memory/discord-archiver-design.md"
tags: ["memory", "data_layer:curated"]
timestamp: "2026-07-11"
---

# 记忆层指针

> 放指针不放本体：正文权威在 `memory/discord-archiver-design.md`，本 concept 不复刻其内容。

- 本体路径：`memory/discord-archiver-design.md`
- 摘要：忘却前夜 Discord 服务器数据量远超预期——单个频道历史消息达 **76 万条**。纯 git 存储不可持续，需要设计分级存储 + 增量抓取方案。
