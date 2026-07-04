# 银芯 OKF Bundle

银芯（BIAV-SC）知识层的 Open Knowledge Format (v0.1) 捆绑包。
公开信息层（整层公开）；本 bundle 主供内部消费（艾瑞卡人格 / 银芯→黑池单向接口 / OKF 可视化器）。

## 章节

* [角色 characters](/characters/index.md) - 72 个唤醒体 concept（一概念一文件）
* [数据源 sources](/sources/index.md) - 17 个社区平台**指针** concept
* [记忆 memory](/memory/index.md) - 10 份记忆层**指针** concept
* [剧情 story](/story/index.md) - 5 份剧情结构层**指针** concept

## 运行时导航（LLM 可动态导航）

`kb_index.json` 是本 bundle 的**运行时导航索引**（倒排表 + 邻接表，零 ML，
由 `scripts/build_kb_index.py` 生成）。艾瑞卡经 MCP `kb_*` 工具
（`kb_search` / `kb_get` / `kb_neighbors` / `kb_overview`，后端 `scripts/kb_navigator.py`）
在运行时按需检索概念、取全档、顺关系图遍历——把静态知识层升级为可动态编排的知识库。

## 变更史

* [log.md](/log.md)
