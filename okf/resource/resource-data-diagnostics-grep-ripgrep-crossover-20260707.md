---
type: "documentation"
title: "grep-ripgrep-crossover-20260707"
description: "**拐点不由「仓库大小」单独决定，而由「这次查询是否必须全量扫描整个语料」决定。** 命中 250 条早停的查询几乎与仓库大小无关（恒 ~140ms）；必须全扫的查询（稀有词 / count / `head_limit:0` / 命中不足 250）成本**线性于总字节，且 97% 花在串行 `fs.readFile` 上，不是正则**。后者在 4K–12K 文件仓上比 ripgrep 慢 **87–127 倍**。（格式：md）"
resource: "/Public-Info-Pool/Resource/data-diagnostics/grep-ripgrep-crossover-20260707.md"
tags: ["data_layer:curated", "deliverable", "topic:data-diagnostics"]
timestamp: "2026-07-15"
---

# 指针概念

> 放指针不放本体：本体权威在 `Public-Info-Pool/Resource/data-diagnostics/grep-ripgrep-crossover-20260707.md`，本 concept 仅描述与定位、不复刻正文。

- 本体路径：`Public-Info-Pool/Resource/data-diagnostics/grep-ripgrep-crossover-20260707.md`
- 摘要：**拐点不由「仓库大小」单独决定，而由「这次查询是否必须全量扫描整个语料」决定。** 命中 250 条早停的查询几乎与仓库大小无关（恒 ~140ms）；必须全扫的查询（稀有词 / count / `head_limit:0` / 命中不足 250）成本**线性于总字节，且 97% 花在串行 `fs.readFile` 上，不是正则**。后者在 4K–12K 文件仓上比 ripgrep 慢 **87–127 倍**。（格式：md）
- 标签：data_layer:curated · deliverable · topic:data-diagnostics
