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
- [§ 2.4 Cognee](#24-cognee)
- [§ 2.5 Cursor 项目记忆](#25-cursor-项目记忆)
- [§ 2.6 claude-mem](#26-claude-mem)
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
