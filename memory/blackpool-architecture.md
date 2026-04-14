# 黑池系统架构（Black Pool System Architecture）

> 最后更新：2026-04-14 by Code-主控台（艾瑞卡会话）
>
> 守密人于 2026-04-14 确立的黑池系统五大需求架构。本文件沉淀需求定义、现有资产映射、缺口识别、外部工具引入策略、分阶段路线图。
>
> **本文件是"活的设计文档"**：后续每次设计推进都应回来更新需求-资产映射表与阶段进度。

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

## 四、外部工具引入策略

### graphify（MIT）

- **状态**：可 vendor 进 BIAV 仓库
- **建议路径**：`projects/graphify-ext/`（参照 occ-local / bpt-next 模式）
- **定位**：需求 3（黑池索引）主力
- **集成方式**：
  1. vendor 源码到 `projects/graphify-ext/`
  2. 写 `scripts/graphify_bridge.py` 封装为银芯 MCP 工具
  3. BPT / claw-next 通过 MCP 调用
- **性能预期**：71.5× token 缩减（上游声明）
- **优先级**：Phase A 首要

### claude-mem（AGPL-3.0）

- **状态**：**禁止 vendor**（copyleft 传染）
- **建议路径**：外部工具，守密人本地独立安装
- **定位**：需求 4（黑池记忆）可选加强，**非必需**
- **集成方式**：
  1. 写 `memory/claude-mem-setup.md` 中文安装指南 + 审计清单
  2. 守密人在 bpt-next / claude-code 会话中手动装
  3. BIAV 仓库不含任何 claude-mem 源码
- **优先级**：Phase B 之后再议

---

## 五、分阶段路线图

### Phase A（立即，~1-2 天）

| 任务 | 产出 | 依赖 |
|------|------|------|
| **P1** 沉淀本架构文档 | `memory/blackpool-architecture.md`（本文件）| 无 |
| **P2** graphify 引入 | `projects/graphify-ext/` vendor + NOTICE + CONTEXT.md | P1 |
| **P3** 银芯 MCP 桥接 graphify | `scripts/graphify_bridge.py` | P2 |
| **P4** claude-mem 外部指南 | `memory/claude-mem-setup.md`（中文，艾瑞卡语气，含审计清单） | P1 |

### Phase B（近期，~1 周）

| 任务 | 产出 | 依赖 |
|------|------|------|
| **P5** 无账号用户识别方案 | `memory/user-identity-design.md`（候选方案对比 + 决策）| P1 |
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
| 无账号用户识别方案待定 | Phase B P5 产出专项设计文档 | 2026-04-14 |

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
- `memory/claude-mem-setup.md` —— Phase A P4 产出目标
- `scripts/session_svn_sync.py` —— Phase B P6 产出目标
- `scripts/graphify_bridge.py` —— Phase A P3 产出目标
- `memory/user-identity-design.md` —— Phase B P5 产出目标
- `memory/capability-registry.json` —— Phase B P8 产出目标

### 外部参考
- [safishamsi/graphify](https://github.com/safishamsi/graphify)（MIT）
- [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)（AGPL-3.0）
- [instructkr/claw-code](https://github.com/instructkr/claw-code)（MIT via Cargo.toml）
- [ruvnet/open-claude-code](https://github.com/ruvnet/open-claude-code)（MIT）
- Karpathy LLM Knowledge Base workflow

---

## 八、待守密人进一步确认的开放项

1. **无账号用户识别**：倾向机器名 / SSH key / 手动 profile？
2. **SVN 仓库地址**：黑池内网 SVN 的 URL / 凭据管理方式如何对接 BIAV？
3. **团队决策的"事实"定义边界**：memory/decisions.md 的所有条目都入 wiki？还是有一个审核标记？
4. **能力注册表的共享粒度**：仅 BIAV Studio 内部团队？还是开源社区的 skill 也纳入？

以上问题暂不阻塞 Phase A，留给 Phase B 解决。
