# 业界 AI 记忆系统对标矩阵 2026-04

> 最后更新：2026-04-26 by Code-strategy（艾瑞卡 opus4.7，分支 `claude/code-strategy-bootstrap-XTmMR`）
>
> 上游 brief：`memory/dispatch-brief-code-strategy-memory-restructure.md` § 三 Q2
>
> 状态：**v0.1 草案，分批撰写中**。骨架已落地，各厂商章节将逐步追加。

---

## 一、扫描范围

7 家方案 + 1 个原生参照：

| 简称 | 全称 | 类型 | OSS / 商业 | License |
|------|------|------|-----------|---------|
| Letta | Letta（前身 MemGPT） | Agent 平台 + 记忆 | OSS + Cloud | Apache 2.0 |
| Mem0 | Mem0 / Mem0g | 记忆层中间件 | OSS + Cloud | Apache 2.0 |
| Zep | Zep / Graphiti | 时序图谱记忆 | OSS（Graphiti） + Cloud（Zep） | Apache 2.0 |
| Cognee | Cognee | ECL 知识引擎 | OSS + Cloud | Apache 2.0 |
| Cursor | Cursor 项目记忆 | IDE 内置 | 闭源 | 商业 |
| claude-mem | thedotmack/claude-mem | Claude Code 插件 | OSS | AGPL-3.0 |
| Native | Claude Code 原生（CLAUDE.md / Skills / Subagents / Hooks） | 平台原语 | 闭源平台 | 商业 |

---

## 二、纵向逐家档案

（章节锚点，逐家追加中）

- [§ 2.1 Letta / MemGPT](#21-letta--memgpt)
- [§ 2.2 Mem0 / Mem0g](#22-mem0--mem0g)

### 2.1 Letta / MemGPT

**来源**：UC Berkeley 起源（arXiv 2310.08560 MemGPT 原论文 → 公司化为 Letta）
**核心隐喻**：操作系统的虚拟内存管理（OS-inspired）
**架构三层**：
- **Core memory**（核心记忆）：固定容量、始终在 system prompt 内，由 agent 主动调用工具读写。类比 RAM。典型用途：用户偏好 / 当前 persona。
- **Archival memory**（档案记忆）：外部向量库，可索引 + 可搜索，容量无上限。类比硬盘。典型用途：长期事实知识 + 外部数据源（"Data Source"）。
- **Recall memory**（回溯记忆）：完整对话历史自动归档至磁盘，按需检索。类比 swap 文件。

**关键创新**：agent **主动管理**自己的记忆——不是被动接收注入，而是显式调用 `core_memory_replace` / `archival_memory_insert` / `archival_memory_search` 等函数移动信息。

**银芯映射**：
- 银芯 `boot-snapshot.md` ≈ Letta 的 core memory（固定容量、始终在 prompt 内）
- 银芯 `assets/data/vectors.json.gz` ≈ Letta 的 archival memory
- 银芯 `memory/session-digests/` ≈ Letta 的 recall memory（但银芯无主动管理）

**银芯缺失**：agent **主动写入** core memory 的能力。当前 boot-snapshot 由 `boot_snapshot.py` 自动生成，艾瑞卡不能 mid-session 调整核心记忆条目。

**适配难度**：中。MCP server 已有 `store_facts` 工具，扩展为 `replace_core_block(block_name, new_content)` 可低成本对齐 Letta 模型。

### 2.2 Mem0 / Mem0g

**来源**：mem0ai/mem0 开源 + 商业云（arXiv 2504.19413 论文）
**核心定位**：跨框架的「AI 记忆中间件」，专注从对话中**自动萃取事实**并维护跨会话上下文。
**架构**：
- **Mem0（向量优先）**：vector search + LLM-driven 事实提取流水线
- **Mem0g（图增强变体）**：在 vector 之上叠加图谱遍历，覆盖关系推理场景
- **三级作用域**：user / session / agent，分级隔离记忆所有权
- **基础设施抽象**：21 框架 + 19 vector store + 3 部署模式（cloud / self-host / local MCP）

**官方 benchmark**（vs full-context）：
- p95 latency 17.12 s → 1.44 s（**-91%**）
- token 消耗 **-90%**
- Mem0g 准确率差距收窄至 < 5 pts（vs full-context），p95 仍维持 2.59 s

**银芯映射**：
- 银芯 `scripts/memory_search.py` 4 维 rerank ≈ Mem0 reranker
- 银芯 `scripts/knowledge_graph.py` ≈ Mem0g 的图层（但银芯无 LLM 自动事实萃取）
- 银芯无对应「user / session / agent 三级作用域」概念——所有 memory 是全局共享的

**银芯缺失**：**LLM-driven fact extraction pipeline**。Mem0 用 LLM 把对话压缩成「事实三元组」（subject-predicate-object）入库；银芯当前 `fact_store.py` 是手动调用，无自动萃取。

**适配难度**：中-高。`scripts/memory_writeback.py` 已检测 git 变更并提取知识，扩展为「会话结束触发 LLM 事实萃取」可借鉴 Mem0 的方法，但要求 API 预算。

- [§ 2.3 Zep / Graphiti](#23-zep--graphiti)

### 2.3 Zep / Graphiti

**来源**：Zep 公司商业产品 + 开源核心 Graphiti（arXiv 2501.13956）
**核心定位**：**时序知识图谱**记忆——信息有「何时为真 / 何时被推翻」的明确时间窗口
**架构**：
- **Graphiti 引擎**（OSS）：bi-temporal 图谱，每条边带 `(t_valid, t_invalid)` 双时间戳
- **Zep 平台**（商业）：在 Graphiti 之上提供托管 + 低延迟检索
- **Neo4j 后端**为主，可换其他图数据库

**关键创新**：bi-temporal 模型——同时记录「事件何时发生」与「事件何时被纳入图谱」。某条事实被新事实推翻时，老边不删除，只标记 `t_invalid`，**保留历史可追溯**。

**官方 benchmark**（LongMemEval）：
- 准确率提升 **+18.5%**（vs full-context / vector-only）
- 平均 context tokens 11.5 万 → **1600**
- 响应延迟 29-31 s → **2.5-3.2 s**
- 在 Deep Memory Retrieval（DMR）基准上**超越 MemGPT**

**银芯映射**：
- 银芯 `decisions.md` 当前用「~~已废除~~」strikethrough + 历史归档**人工**模拟 supersession——Graphiti 这个机制是**结构化的边时间戳**
- 银芯 `knowledge_graph.py` 节点类型有 Decision (141) / File / Character / Concept，但**没有时间戳维度**
- v2.0「银芯重新定位」覆盖 v1.1 → 这种「新决策覆盖旧决策」正是 bi-temporal 模型的本职场景

**银芯缺失**：图谱**时间维度**。当前 565 条边都是「永远成立」的，无法表达「这条决策已在 X 日被覆盖」「这条 lesson 已在 Y 日不再适用」。

**适配难度**：高。要么引入 Graphiti（Python，需 Neo4j）当外挂，要么自建 bi-temporal 边模型。引入 Graphiti 是「替代」9 模块图谱的大动作；自建是中等增量改造。

- [§ 2.4 Cognee](#24-cognee)

### 2.4 Cognee

**来源**：topoteretes/cognee 开源 + 商业云（2025 年从实验项目跑到 70+ 公司生产）
**核心定位**：**ECL 知识引擎**——把任意来源数据「认知化」成图谱 + 向量混合表示
**架构（ECL Pipeline）**：
- **Extract**（抽取）：从 38+ 数据源（PDF / Markdown / API / DB）拉取原始数据
- **Cognify**（认知化）：LLM 把原始数据结构化为知识图谱节点 + 关系 + embeddings
- **Load**（加载）：写入「关系 + 向量 + 图谱」三层统一存储

**关键创新**：**短期 + 长期记忆双层**——session memory（runtime 工作记忆）与 permanent memory（长期知识库）分离，类似人类工作记忆 vs 长期记忆。

**生态广度**：原生集成 Claude Agent SDK / OpenAI Agents SDK / LangGraph / Google ADK / n8n / Neo4j / Amazon Neptune / LanceDB。

**银芯映射**：
- 银芯 `dream.py` 三层（浅睡 / 深睡 / REM）≈ Cognee 的 short-term / long-term 分层思想
- 银芯当前 **没有「Cognify 步骤」** ——原始 lua 表 / extracted/ 解包数据是直接入 TF-IDF 索引，**没有 LLM 结构化处理**
- 银芯无统一三层（关系 + 向量 + 图谱）存储——三者分散在不同 JSON 文件

**银芯缺失**：**LLM 介入的 Cognify 步骤**。`projects/wiki/data/extracted/` 64 MB 解包数据当前是「raw bytes 直接入 TF-IDF」，没有 LLM 把 lua key 翻译成可读事实。Q5「AwakerConfig」召回失败正是此问题。

**适配难度**：高。引入完整 ECL 流水线 = 重做 9 模块；借鉴「Cognify 步骤」概念给特定数据集（如 lua 表）做单点改造则是中等工作量，可借力 dream.py 深睡层做。

- [§ 2.5 Cursor 项目记忆](#25-cursor-项目记忆)

### 2.5 Cursor 项目记忆

**来源**：Cursor IDE 闭源商业产品（与 Claude Code 同生态位竞品）
**核心定位**：**IDE 内嵌的代码库记忆**——专为代码场景优化的 RAG + 规则系统
**两大支柱**：
- **Codebase indexing**：自动 hash 文件结构 + 语义切块（按 function / class / 逻辑块切，**不是**按字符切）+ embeddings
- **Rules 系统**：四级规则继承——Project rules（`.cursor/rules/*.mdc` 入仓库）/ User rules（本机全局）/ Team rules（团队仪表盘）/ `.cursorignore`（排除非源码目录）

**关键创新**：
- **语义切块**而非字符切块——一个函数 / 类作为一个 chunk，避免逻辑被切断
- **规则分层 + 入仓库** —— `.cursor/rules/*.mdc` 跟代码一起 git 化，团队成员共享规则
- **增量索引** —— hash 改变才重建相关片段

**银芯映射**：
- 银芯 `memory_search.py` 当前**按字符切块**（500 字符 + 100 重叠）→ 与 Cursor 的语义切块差距明显
- 银芯 `CLAUDE.md` ≈ Cursor 的 Project rules（已入仓库 ✓）
- 银芯无对应 `.cursorignore` 概念—— 51 MB memory/ 全部入索引（含 30.2% Discord 噪音），无法显式排除

**银芯缺失**：
1. **语义切块**——按 markdown 标题层级 / JSON 顶层 key / Python 函数边界切，而非字符滑窗
2. **索引排除清单** —— 类似 `.searchignore` 显式排除 session-digest 老旧档案 / Discord 月度归档

**适配难度**：低-中。语义切块改造 `memory_search.py:chunk_file()` 函数即可；排除清单加 `.searchignore` 文件 + 索引器读取，半天工作量。

- [§ 2.6 claude-mem](#26-claude-mem)

### 2.6 claude-mem

**来源**：thedotmack/claude-mem（Claude Code 插件，AGPL-3.0）
**核心定位**：**Claude Code 专属记忆插件**——会话事件 → AI 压缩 → 注入下次会话
**架构**：
- **5 个生命周期 hook**：SessionStart / UserPromptSubmit / PostToolUse / Stop / SessionEnd
- **存储双路**：SQLite（`~/.claude-mem/claude-mem.db`，FTS5 全文检索）+ ChromaDB（`~/.claude-mem/vector-db`，向量相似度）
- **Worker 服务**：本地 port 37777 跑 LLM 压缩流水线
- **使用 Claude agent-sdk** 做压缩，**注入相关 context** 到下一次会话

**关键创新**：**全 Claude Code 生命周期 hook 覆盖**——PostToolUse 实时捕获每次工具调用。

**生产可靠性问题**（2026 早期）：
- 2025-11-10 起 PostToolUse / Stop hook 多次故障（GitHub issue #504）
- 2026 早期 issue #727、#897 报多 hook 异常
- License **AGPL-3.0**——传染性强，业务应用慎用

**银芯既有判断**：`memory/decisions.md` 2026-04-14「黑池记忆走银芯自建+母版迁移」条目明确**不引入 claude-mem**（AGPL 风险）。`memory/silver-memory-enhancement-plan.md` 已识别 6 项「claude-mem 有而银芯缺」的能力差距，给出银芯自建等价方案。

**银芯映射**：
- 银芯 SessionStart hook（`session-start-sync.sh`）+ SessionEnd hook（`session-end-distill.sh`）已对应 claude-mem 的两端
- 银芯**缺** PostToolUse / UserPromptSubmit / Stop 三个 hook
- 银芯不引入 ChromaDB 向量库，自建 TF-IDF + 知识图谱

**银芯缺失**：实时会话内 hook 链条（PostToolUse / UserPromptSubmit）。`silver-memory-enhancement-plan.md` 已设计 `session_watch.py` + `session_inject.py` 等价方案，待主控台决策启动。

**适配难度**：N/A——**不直接引入**（许可证风险）。借鉴 hook 拓扑设计自建。

- [§ 2.7 Claude Code 原生（CLAUDE.md / Skills / Subagents / Hooks）](#27-claude-code-原生)

---

## 三、横向对比矩阵

（逐家章节落地后回填）

---

## 四、对银芯的启示

（最后总结章节，待前文完成后撰写）

---

## 五、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v0.1-skeleton | 2026-04-26 | 骨架落档（七家 + 原生参照） | Code-strategy 艾瑞卡 |
