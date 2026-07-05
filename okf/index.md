# 银芯 OKF Bundle

银芯（BIAV-SC）知识层的 Open Knowledge Format (v0.1) 捆绑包。
公开信息层（整层公开）；本 bundle 主供内部消费（艾瑞卡人格 / 银芯→黑池单向接口 / OKF 可视化器）。

## 章节

* [角色 characters](/characters/index.md) - 72 concept · 唤醒体 concept（一概念一文件）
* [数据源 sources](/sources/index.md) - 17 concept · 社区平台采集健康指针
* [记忆 memory](/memory/index.md) - 47 concept · 记忆层全层指针
* [剧情 story](/story/index.md) - 11 concept · 剧情结构层指针
* [事实圣经 assets](/assets/index.md) - 12 concept · 角色卡/采访/叙事/设计决策指针
* [wiki 数据 wiki-data](/wiki-data/index.md) - 26 concept · 解包自举结构化数据集指针
* [社区档案 community](/community/index.md) - 19 concept · 全量档案分析镜头（full_archive）
* [输出展示 news-output](/news-output/index.md) - 23 concept · 抽样展示层（output）
* [解包 unpacked](/unpacked/index.md) - 13 concept · 客户端一手 text 指针（full_archive）
* [解包上游 extracted](/extracted/index.md) - 4 concept · processed 权威上游（full_archive）
* [产物 resource](/resource/index.md) - 52 concept · 银芯正式报告/分析指针
* [子项目 projects](/projects/index.md) - 18 concept · CONTEXT/藏宝图/工程文档指针

## 运行时导航（LLM 可动态导航）

`kb_index.json` 是本 bundle 的**运行时导航索引**（倒排表 + 邻接表，零 ML，
由 `scripts/build_kb_index.py` 生成）。艾瑞卡经 MCP `kb_*` 工具
（`kb_search` / `kb_get` / `kb_neighbors` / `kb_overview`，后端 `scripts/kb_navigator.py`）
在运行时按需检索概念、取全档、顺关系图遍历——把静态知识层升级为可动态编排的知识库。

## 变更史

* [log.md](/log.md)
