# 黑池系统架构（Black Pool System Architecture）

> **状态：已封存（2026-04-19）**
> 封存原因：2026-04-19 战略转向——BPT 战线不再在银芯内部开发，`projects/bpt-web/` / `bpt-desktop/` / `bpt-next/` / `graphify-ext/` / `occ-local/` 已从仓库删除。文中引用的子项目路径与 Phase A-D 路线图全部作废；银芯转为 BPT 指导者，协议见 `memory/bpt-guidance-protocol.md`。本文档作为历史架构设计审计材料保留。
>
> ---
>
> 最后更新：2026-04-14 by Code-主控台（艾瑞卡会话）
>
> 守密人于 2026-04-14 确立的黑池系统五大需求架构。本文件沉淀需求定义、现有资产映射、缺口识别、外部工具引入策略、分阶段路线图。
>
> **本文件是"活的设计文档"**：后续每次设计推进都应回来更新需求-资产映射表与阶段进度。

---

## 零、核心架构决策（守密人 2026-04-14 连环拍板）

### 0.1 亚哈格分 — 双系统分工
**银芯 = 孵化器 + 开源子项目 + 公开资料；黑池 = 五大需求的数据/代码主体（内网 SVN）**

- 银芯（本仓库，公开层）承担：
  - 黑池架构的设计文档
  - 供黑池复用的脚本模板 / 工具原型
  - 开源子项目（`projects/bpt-next/` MIT、`projects/graphify-ext/` MIT）
  - 公开资料（`projects/wiki/` / `projects/news/` / `assets/data/` 公开部分）
  - 允许黑池 AI 读取

- 黑池（内网，私有层）承担：
  - 需求 1 主体：用户档案（SVN 存对话）
  - 需求 2 主体：团队决策 wiki（黑池内部 wiki）
  - 需求 3 主体：商业数据索引（graphify 在黑池内部署）
  - 需求 4 主体：内部记忆（黑池的 `memory/`）
  - 需求 5 主体：私有技能/代理/MCP

**矛盾解除**：守密人"能力共享粒度 = BIAV Studio 团队内"与银芯公开层的潜在矛盾——能力**放黑池内网**，银芯只留接口声明与可公开能力。

### 0.2 黑池记忆走银芯自建 + 母版迁移
原话："完善银芯自建，使其拥有 claude-mem 的能力，然后作为母版迁移到黑池。"

- **不引入 claude-mem**（即使黑池内网也不引入）
- 扩展银芯现有 Python 记忆栈（`session_distiller` / `dream` / `memory_writeback` / `session_reflexion` / `memrl` / `knowledge_graph` / `memory_search`），学习 claude-mem 能力，自己实现
- 银芯验证完整后，作为母版克隆部署到黑池内网
- 维持 MIT 纯粹，无 AGPL 顾虑
- 详细增强计划见 `memory/silver-memory-enhancement-plan.md`

### 0.3 occ-local 降级为研究归档
- `projects/occ-local/` 保留但**不再作为"MIT 合规备选"维护**
- 定位改为"研究参考归档，不活跃"
- bpt-next（claw-code）是**唯一主线**

### 0.4 外部工具方针更新
- **graphify（MIT）**：Phase A vendor 到 `projects/graphify-ext/`，作为黑池索引（需求 3）工具原型
- **claude-mem（AGPL-3.0）**：**全面不引入**（废弃原"中文外挂指南"计划），其能力由银芯自建等价物覆盖

---

## 一、背景

### 黑池定位
黑池（Black Pool）是 B.I.A.V. Studio 双系统架构的"内部层"：
- **银芯（BIAV-SC）**：公开层 + 方法论验证 + BPT 开源核心开发
- **黑池（BIAV-BP）**：内部层 + 商业数据 + 私有能力 + 团队知识沉淀

本文件定义黑池系统**作为 BPT 载体**应具备的五大能力结构。

### 与 BPT 族的关系
- BPT 母版 / bpt-web / bpt-desktop：产品本体
- bpt-next（基于 claw-code）：新一代内核（已引入 `projects/bpt-next/`）
- **本架构**：为 BPT 提供系统骨架，使其承载黑池的五大能力

---

## 二、五大需求（守密人 2026-04-14 原话）

### 需求 1：用户档案
> 无帐号，基于 SVN 储存用户的会话记录，每个用户一个目录，每个对话一个文件。

**关键要素**：
- 无需用户登录系统
- SVN 作为后端存储（黑池已有 SVN 基础设施）
- 用户级目录隔离
- 会话级文件粒度（可能 JSONL / Markdown / JSON）

**未决定问题**：
- 无帐号下如何识别"用户"？候选：机器名 / SSH key 指纹 / 用户手动声明 / IP + hostname / 显式 profile 配置

### 需求 2：事实数据
> 面向人类阅读的数据可读性，以 wiki 页面的形式，包含团队内决策事实、社区反馈事实。

**关键要素**：
- **面向人**（非 AI）
- Wiki 页面载体（BIAV 已有 VitePress 三语 Wiki）
- 两大类事实：
  - 团队内决策事实（来源：`memory/decisions.md` + 会议纪要）
  - 社区反馈事实（来源：`projects/news/output/`）
- 强调"事实"而非"原始数据"——需要**经过提炼/验证**

### 需求 3：黑池索引
> 面向黑池阅读的数据。

**关键要素**：
- **面向 AI**（黑池本身即 AI 终端）
- 数据形态适合 AI 消费（图谱 / 向量 / 结构化）
- 索引化、可高效查询

### 需求 4：黑池记忆
> 基于事实执行积累的决定、反思、整体概况。

**关键要素**：
- 基于"事实"（来自需求 2）的执行产物
- 三种沉淀：
  - 决定（做了什么选择）
  - 反思（学到什么教训）
  - 整体概况（全局状态摘要）

### 需求 5：黑池能力
> 基于团队共享的技能、代理、MCP。

**关键要素**：
- **团队共享**（不是个人资产）
- 三种能力载体：
  - 技能（skills，Markdown 形式的可复用 workflow）
  - 代理（agents，Markdown 形式的角色化子代理）
  - MCP（Model Context Protocol 服务器）

---

## 三、资产映射与缺口分析

### 需求 1：用户档案

| 维度 | 现状 |
|------|------|
| 现有资产 | `bpt-web/` 的 localStorage 按用户分 key；`projects/bpt-next/rust/.claw/sessions/` JSONL session 文件；黑池内网 SVN 基础设施 |
| 外部工具命中 | 部分：claude-mem 有 SQLite + SSH 多机同步，但不是 SVN 模式 |
| 缺口 | 1) SVN 适配器；2) 无账号用户识别约定；3) 会话格式标准化（JSONL 推荐）；4) 会话→SVN 提交流水线 |
| 建设模块 | `scripts/session_svn_sync.py`（银芯）；BPT 内置 SVN 客户端（可能）|

### 需求 2：事实数据

| 维度 | 现状 |
|------|------|
| 现有资产 | `projects/wiki/`（VitePress 1.6.4 三语）；`assets/data/design-decisions.json`、`interview-2026-04.json`、`narrative-structure.json`；`memory/decisions.md`；`projects/news/output/` 社区数据 |
| 外部工具命中 | 否 |
| 缺口 | 1) 团队决策从 `memory/decisions.md` → wiki 导出视图；2) 社区反馈提炼 agent（从原始数据到"值得入 wiki 的事实"）；3) wiki 页面分类扩展（新增"团队决策"与"社区事实"两大目录） |
| 建设模块 | `scripts/decisions_to_wiki.py`（银芯）；`scripts/community_facts_distiller.py`（AI 提炼 agent）；wiki 侧边栏扩展 |

### 需求 3：黑池索引

| 维度 | 现状 |
|------|------|
| 现有资产 | `scripts/knowledge_graph.py`（TF-IDF + 4 维重排，面向"项目决策/角色/界域"）；`scripts/memory_search.py`（TF-IDF 搜索）；BPT 母版 CONTEXT 提到的 **BPE 未实现** |
| 外部工具命中 | **graphify 完美命中**（tree-sitter AST + Leiden + 多模态 + Lua 支持）|
| 缺口 | 1) 代码/文档自动索引（graphify 填）；2) 索引与银芯 knowledge_graph 的职责分工明确化；3) BPT / claw 接入 graphify 的 PreToolUse hook |
| 建设模块 | `projects/graphify-ext/`（vendor graphify 源码）或 pip 依赖；`scripts/graphify_bridge.py`（银芯 MCP 桥接）|

**职责分工**：
- 银芯 `knowledge_graph.py` 专管"游戏世界观 + 决策历史 + 人工维护图谱"
- graphify 专管"代码仓库 + 文档 + 多模态资产 + 自动化图谱"
- 两者在 MCP 层合流，AI 查询时不关心来源

### 需求 4：黑池记忆

| 维度 | 现状 |
|------|------|
| 现有资产（银芯已基本完备） | `memory/decisions.md`（决定）+ `memory/lessons-learned.md`（反思）+ `memory/session-digests/`（概况）+ `memory/dreams/`（做梦 agent 产出）；5 个 Python 模块：`session_distiller.py` / `dream.py` / `memory_writeback.py` / `session_reflexion.py` / `memrl.py` |
| 外部工具命中 | claude-mem 功能重叠（跨 session 压缩）；**但 AGPL-3.0 不可 vendor**，只能作为外部工具 |
| 缺口 | 已基本完备。claude-mem 是"可选加强"非"必需"。 |
| 建设模块 | 扩展现有 session-digests 到 SVN（需求 1 联动） |

### 需求 5：黑池能力

| 维度 | 现状 |
|------|------|
| 现有资产 | `.claude/commands/*.md`（BIAV 的 daily-news / sync-memory / validate-data / loop / simplify 等 slash commands）；`scripts/mcp_server.py`（银芯 11 工具）；`assets/data/character-personas/*.json`（角色人格如艾瑞卡） |
| 外部工具命中 | 否（graphify 本身是 skill，不管理 skill）|
| 缺口 | 1) 能力注册表：哪些技能 / 代理 / MCP 面向团队；2) 跨机器同步机制；3) 版本管理；4) 依赖声明（某 skill 依赖某 MCP） |
| 建设模块 | `memory/capability-registry.json`；`scripts/capability_manager.py` |

---

## 四、外部工具引入策略（2026-04-14 更新）

### graphify（MIT）

- **状态**：可 vendor 进 BIAV 仓库
- **建议路径**：`projects/graphify-ext/`（参照 occ-local / bpt-next 模式）
- **定位**：需求 3（黑池索引）工具原型，银芯 vendor 后供黑池复用
- **集成方式**：
  1. vendor 源码到 `projects/graphify-ext/`
  2. 写 `scripts/graphify_bridge.py` 封装为银芯 MCP 工具
  3. BPT / claw-next 通过 MCP 调用
- **性能预期**：71.5× token 缩减（上游声明）
- **优先级**：Phase A 首要

### claude-mem（AGPL-3.0）

- **状态**：**全面不引入**（守密人 2026-04-14 决定走银芯自建路线）
- **处置**：仅作架构参考，不 vendor 也不写外挂指南
- **其能力由银芯等价物覆盖**：见 `memory/silver-memory-enhancement-plan.md`
- **历史**：艾瑞卡曾考虑过"AGPL 外挂 + 中文指南"方案，已废弃

---

## 五、分阶段路线图

### Phase A（立即，~1-2 天）

| 任务 | 产出 | 依赖 |
|------|------|------|
| **P1** 沉淀本架构文档 | `memory/blackpool-architecture.md`（本文件）| 无 |
| **P2** graphify 引入 | `projects/graphify-ext/` vendor + NOTICE + CONTEXT.md | P1 |
| **P3** 银芯 MCP 桥接 graphify | `scripts/graphify_bridge.py` | P2 |
| **P4** claude-mem 外部指南 | memory/claude-mem-setup.md（待创建，中文，艾瑞卡语气，含审计清单） | P1 |

### Phase B（近期，~1 周）

| 任务 | 产出 | 依赖 |
|------|------|------|
| **P5** 无账号用户识别方案 | memory/user-identity-design.md（待创建，候选方案对比 + 决策）| P1 |
| **P6** SVN 会话同步原型 | `scripts/session_svn_sync.py`（单用户版） | P5 + 黑池 SVN 访问 |
| **P7** 团队决策→wiki 导出 | `scripts/decisions_to_wiki.py` + wiki 新目录 | P1 |
| **P8** 能力注册表初版 | `memory/capability-registry.json` | P1 |

### Phase C（长期，~1 月）

| 任务 | 产出 | 依赖 |
|------|------|------|
| **P9** 多用户 SVN 同步完整版 | `scripts/session_svn_sync.py`（完整） | P6 |
| **P10** 社区反馈提炼 agent | `scripts/community_facts_distiller.py` | P7 |
| **P11** 能力路由器 MCP | 银芯 MCP 扩展为"能力路由" | P8 |
| **P12** BPT-next 深度集成 | claw settings 预设 graphify + claude-mem + 银芯 MCP | A+B 全部 |

---

## 六、关键决策记录

| 决策 | 理由 | 生效时间 |
|------|------|---------|
| 黑池索引采用 graphify 而非自研 | MIT 合规 + tree-sitter 23 语言含 Lua + Leiden 无需 embedding + 多模态 + 71.5× token 缩减 | 2026-04-14 |
| claude-mem 不进 BIAV 仓库 | AGPL-3.0 copyleft 传染，不兼容 BIAV MIT 许可 | 2026-04-14 |
| 银芯 `knowledge_graph.py` 保留 | 与 graphify 职责分工（世界观 vs 代码），非替代关系 | 2026-04-14 |
| 会话存储用 SVN 而非 Git | 守密人指示；SVN 已有内网基础设施；每对话一文件适合 SVN 线性提交模型 | 2026-04-14 |
| **亚哈格分**：银芯=孵化器/开源/公开；黑池=五大需求数据主体 | 解决"能力团队内共享"与"银芯公开层"的矛盾 | 2026-04-14 |
| **黑池记忆走银芯自建+母版迁移**（不引入 claude-mem） | 保 MIT 纯粹 + 延续银芯已有投资 + 亚哈格分下无需 AGPL | 2026-04-14 |
| **occ-local 降级为研究归档** | bpt-next 作为唯一主线，occ-local 不再维护 | 2026-04-14 |
| **无账号用户识别 = SVN 账号名 + 可配外显名** | Phase B P5 锁死 | 2026-04-14 |
| **SVN 仓库 = 基于本地 SVN 工作副本** | Phase B P6 锁死 | 2026-04-14 |
| **事实数据 = memory/decisions.md 全部入 wiki** | Phase B P7 锁死（不做审核筛选） | 2026-04-14 |
| **能力共享粒度 = BIAV Studio 团队内（实际落黑池内网）** | Phase B P8 锁死 | 2026-04-14 |

---

## 七、相关档案索引

### 银芯现有模块（不改动）
- `scripts/mcp_server.py` —— 11 工具 MCP 服务器
- `scripts/knowledge_graph.py` —— 游戏世界观图谱
- `scripts/session_distiller.py` —— session 摘要
- `scripts/dream.py` —— 做梦 agent
- `scripts/memory_writeback.py` —— 记忆写回
- `memory/decisions.md` / `lessons-learned.md` / `session-digests/` / `dreams/`

### BPT 族子项目
- `projects/bpt/` —— 母版（活跃）
- `projects/bpt-web/` —— PWA
- `projects/bpt-desktop/` —— Electron 桌面
- `projects/bpt-next/` —— claw-code 新内核（已引入）
- `projects/occ-local/` —— MIT 备选

### 本架构文档链接
- `projects/graphify-ext/` —— Phase A P2 产出目标
- memory/claude-mem-setup.md —— Phase A P4 产出目标（待创建）
- `scripts/session_svn_sync.py` —— Phase B P6 产出目标
- `scripts/graphify_bridge.py` —— Phase A P3 产出目标
- memory/user-identity-design.md —— Phase B P5 产出目标（待创建）
- `memory/capability-registry.json` —— Phase B P8 产出目标

### 外部参考
- [safishamsi/graphify](https://github.com/safishamsi/graphify)（MIT，Phase A vendor）
- [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)（AGPL-3.0，**仅作架构参考，不引入**）
- [instructkr/claw-code](https://github.com/instructkr/claw-code)（MIT via Cargo.toml，已引入 projects/bpt-next/）
- [ruvnet/open-claude-code](https://github.com/ruvnet/open-claude-code)（MIT，已降级为研究归档）
- Karpathy LLM Knowledge Base workflow

### 银芯记忆增强专项
- `memory/silver-memory-enhancement-plan.md`（对标 claude-mem 能力的银芯扩展清单）

---

## 八、已解决的开放项（守密人 2026-04-14 裁定）

| # | 问题 | 决议 | 含义 |
|---|------|------|------|
| 1 | 无账号用户识别 | **与 SVN 账号名一致，可支持外显名** | 系统读取 SVN 账号（`svn auth` / `~/.subversion/auth/` / `svn info`）作为唯一身份；附加配置支持 `display_name` 用于人类可读场景（UI / Wiki / 报告） |
| 2 | SVN 仓库地址 | **基于本地 SVN 进行工作** | 不走远程 URL，使用本地 working copy；可能是 `file://` 协议或本地 server；无需处理网络错误 / 代理 / 认证链 |
| 3 | "事实"边界 | **`memory/decisions.md` 全部入 wiki** | 不做人工审核筛选；导出脚本逻辑简化为纯搬运 + 格式转换；wiki 视图按时间线 / 领域双向索引 |
| 4 | 能力共享粒度 | **BIAV Studio 团队内** | Registry 不开源；能力代码与元数据放黑池（SVN）；银芯仅保留接口声明或占位 |

**影响的模块设计调整**：

- **用户识别模块**（Phase B P5）：从"方案对比"简化为"SVN 账号读取器 + 外显名映射 JSON"，实现约 50-80 行 Python
- **SVN 同步器**（Phase B P6）：从"远程 SVN 客户端"简化为"本地 working copy 操作"，用 `svn add / svn commit -m` 即可；无需 `svn checkout` / 代理 / SSL 配置
- **决策→wiki 导出器**（Phase B P7）：从"审核筛选"简化为"全量 Markdown 转 VitePress 页面"，~100 行
- **能力注册表**（Phase B P8）：从"公开/私有分层"简化为"纯团队内 JSON"；未来若需开源部分能力，再加 `visibility: "public"` 字段

---
