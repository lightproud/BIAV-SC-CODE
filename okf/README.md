---
type: "documentation"
title: "银芯 OKF Bundle README"
description: "本 bundle 的说明、银芯公开层定位、三条落地铁律与重生成方式。"
tags: ["meta", "documentation"]
timestamp: "2026-07-18"
---

# 银芯 OKF Bundle —— README

本目录是银芯知识层的 **Open Knowledge Format (OKF v0.1)** 捆绑包。
OKF 是 Google Cloud 2026-06-12 发布的厂商中立开放规范：知识 = 一目录带
YAML frontmatter 的 markdown，每文件一 concept，唯一必填字段 `type`，
`index.md`/`log.md` 为保留名。规范：
https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf

## 银芯定位（重要）

银芯为**公开信息层**（整层公开，守密人 2026-06-21 裁定；本 bundle 作为工程产物亦属公开信息）。
OKF 官方主卖点「跨组织互操作」对银芯打折——本 bundle 主供**内部消费**：艾瑞卡人格消费、
银芯→黑池单向接口的线格式候选、白嫖 OKF 静态可视化器看角色关系图，**非以对外互操作为目标**。

## 三条落地铁律

1. **一概念一文件**：`characters/` 层 72 角色，各自一份 concept。
2. **放指针不放本体**：`sources/` `memory/` `story/` 层只持 `resource` 指针，
   本体（JSONL 时序档案 / memory *.md / 解包 JSON）原地不动。呼应 RELEASES.md
   「藏宝图」与 CLAUDE.md「只指针不复刻」。
3. **全量 vs 输出层不可互换**：`sources/` 指针 concept 用 `tags: data_layer:*`
   显式标层，防 lesson #30「把抽样当全量」复发。

## 重新生成

```bash
python3 scripts/build_okf_bundle.py            # 仅重建 bundle
python3 scripts/build_okf_bundle.py --tarball okf-bundle.tar.gz  # 顺带导出单向输出物
```

生成物，重跑覆盖。本体各自原地不动。

## 消费：自包含可视化器

`okf/visualizer.html` 是一个**零后端、零安装、数据不离开页面**的单文件静态
关系图（对齐 OKF 消费端参考实现精神，自写零依赖力导向图）。双击直接在浏览器
打开即可：节点按 `type` 上色，角色按画师 / CV 聚类成簇，拖动 / 缩放 / 悬停看详情。
图数据另存 `okf/graph.json` 供其他消费端（搜索 / agent）取用。

## 消费：运行时导航（LLM 可动态导航的知识库）

`okf/kb_index.json` 是本 bundle 的**运行时导航索引**——倒排表（词→概念）+ 邻接表
（概念→邻居），由 `scripts/build_kb_index.py` 从 concept 元数据 + 正文 + `graph.json`
关系边生成（词典法分词，**确定性、零 ML、零常驻**）。艾瑞卡在唯一的运行时动态
平面（MCP）上经 `kb_*` 四工具动态导航（后端 `scripts/kb_navigator.py`）：

- `kb_search(query)` —— 按词检索概念，返回排序摘要 + `resource` 指针；
- `kb_get(concept_id)` —— 取单个概念全档（元数据 + 正文 + 邻居）；
- `kb_neighbors(concept_id)` —— 顺 OKF 关系图遍历邻居；
- `kb_overview()` —— 知识库楼层平面图（分区 / 类型 / 入口）。

思想溯源：OKF（一概念一文件 + 关系图）为底座，LLMwiki（LLM 顺图逐跳导航、按需
取概念）为消费范式。放指针不放本体：导航层只返回元信息 + 指针，本体仍原地不动。

## 银芯 → 黑池单向线格式

OKF 的「格式即契约，两端工具独立可换」正是银芯→黑池**单向输出**的理想载体：
黑池**无需银芯任何 SDK / 账号**即可消费本 bundle 的策展知识（concept + 指针）。
`--tarball` 产出 `.tar.gz` 即单向输出物（信息只出不回，黑池→银芯始终关闭）。
注意：仅**策展知识层**走此线，原始时序数据本体仍只放指针、不进 bundle。

## 一致性

`tests/test_okf_bundle.py` 校验 OKF v0.1 一致性（每个非保留 .md 带非空
`type`；保留文件无 frontmatter）。
