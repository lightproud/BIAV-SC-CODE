---
type: "documentation"
title: "银芯 OKF Bundle README"
description: "本 bundle 的说明、银芯受限层定位、三条落地铁律与重生成方式。"
tags: ["meta", "documentation"]
timestamp: "2026-06-21"
---

# 银芯 OKF Bundle —— README

本目录是银芯知识层的 **Open Knowledge Format (OKF v0.1)** 捆绑包。
OKF 是 Google Cloud 2026-06-12 发布的厂商中立开放规范：知识 = 一目录带
YAML frontmatter 的 markdown，每文件一 concept，唯一必填字段 `type`，
`index.md`/`log.md` 为保留名。规范：
https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf

## 银芯定位（重要）

银芯是**受限/非公开层**。OKF 官方主卖点「跨组织互操作」对银芯打折——
本 bundle 面向**内部**：艾瑞卡人格消费、银芯→黑池单向接口的线格式候选、
白嫖 OKF 静态可视化器看角色关系图。**不对外发布**。

## 三条落地铁律

1. **一概念一文件**：`characters/` 层 72 角色，各自一份 concept。
2. **放指针不放本体**：`sources/` `memory/` `story/` 层只持 `resource` 指针，
   本体（JSONL 时序档案 / memory *.md / 解包 JSON）原地不动。呼应 RELEASES.md
   「藏宝图」与 CLAUDE.md「只指针不复刻」。
3. **全量 vs 输出层不可互换**：`sources/` 指针 concept 用 `tags: data_layer:*`
   显式标层，防 lesson #30「把抽样当全量」复发。

## 重新生成

```bash
python3 scripts/build_okf_bundle.py
```

生成物，重跑覆盖。本体各自原地不动。

## 消费（白嫖 Google 参考实现）

OKF 随规范放出一个**零后端单文件静态 HTML 可视化器**，可把本 bundle 渲染成
交互式关系图。取用方式见上方规范仓库 `okf/` 目录。

## 一致性

`tests/test_okf_bundle.py` 校验 OKF v0.1 一致性（每个非保留 .md 带非空
`type`；保留文件无 frontmatter）。
