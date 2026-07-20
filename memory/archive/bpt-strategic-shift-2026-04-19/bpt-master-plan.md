# BPT — Black Pool Terminal 母版重建计划 v2

> **状态：已封存（2026-04-19）**
> 封存原因：2026-04-19 战略转向——BPT 战线不再在银芯内部开发，`projects/bpt/` 相关重建计划作废。本文档作为历史设计审计材料保留。
>
> ---
>
> 最后更新：2026-04-12 by 主控台（记忆反思管理）

## 1. Context

### 背景

Light 是 B.I.A.V. Studio 制作人，负责《忘却前夜》。**不写一行代码**，整套银芯基础设施（9 个 MCP 工具 / 记忆宫殿 / 知识图谱 / Dream / 哨兵）全 AI 驱动搭建。

团队目前用公司内网 **Qoder**，三堵墙：模型不自由、额度不透明、工具集不懂本项目。Qoder 新出的 Quest 模式是 Claude Code 范式，Light 用过觉得对路，但 Qoder 挂不了银芯/黑池。

上一次尝试 `projects/biav-desktop/`（Electron 33 + React 18 + Vite 6）死于 **tool call token 占对话 80%**——schema 每轮重发、result 不截断、history 不压缩、网关对 Anthropic SDK 适配有 bug、cache_control 疑似失效。加上 `self-evolve` 插件让应用"改自己的代码"，最终代码出现字面 `\r\n` 污染，修复成本和继续使用成本都超预算。

### 核心命题

**把 Claude Code 范式工作流产品化，替代 Qoder，交给全团队用。**

BPT 是：
- Claude Code 交互范式（对话式 agentic + tool use 循环 + 流式 + 工具结果透明）
- 懂这个项目（银芯 9 工具 + 黑池海量数据的语义检索）
- 非程序员可维护（Light + AI 就能继续迭代）
- 团队级部署（SVN 分发，与黑池数据一起更新）

### 历史项目关系

| 项目 | 状态 | 本次处置 |
|------|------|----------|
| `projects/biav/` | 旧 PWA 快照 v0.16.0 | 不动 |
| `projects/biav-desktop/` | 已废 Electron 桌面端 | 不动，仅作参考 |
| `projects/bpt/` | **新建，本次交付物** | 母版 |

---

## 2. Day-0 四条硬性差异化

BPT 第一天就必须到位的四条，否则和 Qoder 没区别：

1. **模型自由** — UI 直接切换网关任意模型（Sonnet / Opus / GPT / 国产），切换不重启不清对话。
2. **额度透明** — 对话顶部永远显示多维 token 开销（system / tools / history / generation / cache hit / cache write）六项拆开 + 人民币成本估算实时跟随。
3. **工具可扩展** — 银芯内置 + MCP 标准协议外部 server + 配置目录热加载自定义工具。白名单审计。
4. **懂你们项目** — 双引擎：银芯（记忆/图谱/推荐）+ 黑池浏览器 BPE（百万行代码 + 120 个大配置的语义检索）。不是"通用 AI 助手碰巧连了你的文件"，是"出厂就理解你们项目结构"的专用终端。

---

## 3. Prime Directive — Token 经济纪律

biav-desktop 死因。所有架构决策向它妥协。

### 红线

| # | 规则 | 违反后果 |
|---|------|----------|
| T1 | tool schema 首轮发送 + `cache_control: ephemeral`，后续轮次必须命中 cache。命中率 < 80% 状态栏亮红灯 | schema 重复计费，每轮多 2-5k token |
| T2 | 工具返回 > 2000 token 必须截断/摘要。完整版存本地 artifact，用户点击展开 | 长结果撑爆 history |
| T3 | 对话 > 20 轮或 > 60k token 触发滚动压缩（保留最近 K 轮原文 + 之前全压成摘要）。用户可见/可手动触发/可撤回 | history 无限膨胀 |
| T4 | active tool set 按档位最小化（见下文"档位"段）。切档时重发一次 schema 并重置 cache | 9+ 工具 schema 常驻 = 每轮白花 3-5k |
| T5 | 每轮写结构化日志：6 维 token 分布 + cache 命中率 + 工具名 + 成本估算。存本地 SQLite，可导出 | 额度透明无法兑现 |

### 验证基准

Phase 0 必须通过 **"10 轮 token 预算测试"**：
- 挂 12 个工具（银芯 4 MCP + fs 读 + BPE 2 个窄口径）
- 连续 10 个普通问题，每个触发 1-2 次 tool use
- 累计输入 token ≤ 30k（其中 cache hit > 70%），输出 ≤ 10k
- 不达标就调截断阈值 / 压缩点 / active 分组，达标了才算交付

---

## 4. Secondary Directive — 非程序员 + AI 维护上限

Light 自己 + AI 必须能继续迭代 BPT。反直觉但必须遵守：

1. **单目录单 package.json** — 不引入 monorepo / workspace / pnpm / turbo
2. **禁止自迭代反射** — 不搞 `self-evolve`、不搞运行时动态代码加载。扩展走插件（配置 + 独立文件）
3. **源码可读性 > 性能** — 宁可啰嗦 if/else 也不用晦涩函数式管道。AI 30 秒能讲清楚
4. **注释写"为什么"** — 每个非平凡函数写清楚理由，给未来 AI 会话的断档补救
5. **禁 `any` / 禁 `as unknown as`** — TypeScript strict 全开
6. **一文件一模块** — 没有 helpers.ts / utils.ts 垃圾桶
7. **业务代码写 assert** — 核心路径守不变式，出问题时自己能发现自己坏了

---

## 5. UI 档位设计

一个 UI，两个负载档位。切换按钮在输入框旁边，像汽车换挡。

### 对话档（默认）

- **用途**：问答、讨论、分析
- **Active tool set**：银芯读工具（memory_search / graph_query / recommend_context）+ BPE 查询（bpe_search）≈ 4 个
- **Schema 成本**：约 1.5k token
- **特征**：轻、快、省

### 工作档

- **用途**：写代码、改配置、执行操作
- **Active tool set**：对话档全部 + fs 读写 + 命令执行 + store_facts + graph_related_files ≈ 10 个
- **Schema 成本**：约 4k token
- **特征**：重、能力全、贵
- **切入时提示**："切换到工作档将增加约 2.5k token/轮的工具成本，确认？"

切档规则：
- 切档 = 清一次 tool schema cache + 重发新 schema + 标记 `cache_control`
- 不清对话历史，不重启会话
- 档位状态显示在状态栏

---

## 6. 数据层访问模型

银芯和黑池是两种截然不同的数据形态，不能套同一种访问方式。

### 银芯（小数据、已语义化）

| 层级 | 谁调 | 走什么通道 | 示例 |
|------|------|-----------|------|
| **Tier 1 直接调用** | UI 面板 / system prompt 注入 / 管理操作 | 主进程 ↔ Python 子进程 JSON-RPC | 银芯面板搜索、每轮自动注入 top-3 记忆、rebuild_indexes |
| **Tier 2 MCP** | LLM 主动调用 | MCP stdio 协议 | LLM 判断"我需要查记忆" → memory_search / graph_query / store_facts / graph_related_files（4 个） |
| **Tier 3 外部 MCP** | LLM / UI | MCP stdio/SSE | 未来挂 Filesystem / Brave Search / 团队自制 MCP server |

银芯 MCP 工具从 9 个砍到 **4 个**（memory_search / graph_query / graph_related_files / store_facts），其余 5 个只走 Tier 1 直接调用，不进 LLM schema。

### 黑池原始数据（海量、结构化、查询形态 = 自然语言语义）

**绝不让 LLM 自由搜索大仓库。** 这是 biav-desktop 死因的精确复现条件。

黑池走一个独立子系统 **BPE（Black Pool Explorer）**，架构见下节。

---

## 7. BPE — Black Pool Explorer 子系统

### 数据特征

- 代码：百万行，主要 **C# / Lua / Python / JavaScript**
- 配置：120 个文件，每个 1-2MB，格式 **CSV（策划源）→ JSON + Lua（运行时）**
- 查询形态：**(e) 自然语言**——"哪里控制了狂战士的暴击率"
- 现有索引：内部 AI 写的简单索引，**不可靠，丢弃重建**

### 核心架构

```
BPE UI 面板（零 LLM 成本）
  │ direct IPC
  ▼
BPE 查询层
  1. query → bge-m3 embedding
  2. vector search → top-20 候选
  3. Haiku 重排 → top-5 + 每条一句话摘要（~$0.003/次）
  4. 返回 UI
  │
  ▼
BPE 索引层（3 个 SQLite 文件，随 SVN 分发）
  - chunks.db   — 切片文本 + 源文件 + 行号 + 元数据
  - vectors.db  — sqlite-vss 向量索引
  - keywords.db — SQLite FTS5 关键词兜底索引
  │
  ▼
BPE 索引构建器（scripts/bpe_indexer.py）
  - 扫仓库 → chunking → embedding → 写 3 个 SQLite
  - 增量模式：只处理 svn diff 变更文件
  - 由 Dev 或 CI 触发，团队 svn up 获取成品
```

### Embedding 模型选型

**首选：`BAAI/bge-m3`**（MIT 许可，本地 CPU 可跑）

| 指标 | bge-m3 | bge-base-zh-v1.5 | jina-v3 | gte-Qwen2-1.5B |
|------|--------|-------------------|---------|-----------------|
| 大小 | 2.2GB | 400MB | 2.4GB | 3GB |
| 维度 | 1024 | 768 | 1024 | 1536 |
| 最大 Token | **8192** | 512 | 8192 | 32768 |
| 中文检索 | ★★★★★ | ★★★★ | ★★★★ | ★★★★★ |
| 代码能力 | **★★★★** | ★★☆ | ★★★★ | ★★★★☆ |
| 许可证 | MIT | MIT | ⚠️ NC | Apache 2.0 |
| CPU 可用 | ✓ | ✓ | ✓ | ✗（太慢） |

选 bge-m3 的理由：
- **唯一同时满足**中文 + 代码 + 8192 长上下文 + MIT 许可 + CPU 可跑
- 支持稠密 + 稀疏双模式，稀疏对中文关键词（"暴击率"）有额外加成
- 2.2GB 进 SVN 只需首次下载，之后 update 不动它

备选：若 2.2GB 太大，用 **bge-base-zh-v1.5**（400MB）处理中文配置 + 对代码单独做 BM25 关键词索引兜底。

### Chunking 策略

| 文件类型 | 切法 | 解析工具 |
|----------|------|----------|
| C# | 按 class / method | tree-sitter-c-sharp |
| Lua | 按 function / 顶层 table | tree-sitter-lua |
| Python | 按 function / class | tree-sitter-python |
| JavaScript | 按 function / class | tree-sitter-javascript |
| JSON 配置 | 按顶层 key / 数组元素 | Python json 标准库 |
| Lua 表配置 | 按顶层 table 条目 | tree-sitter-lua |
| CSV | 按行（或 N 行一组） | Python csv 标准库 |

预估切片总量：代码 ~5 万（百万行 ÷ 20 行/函数）+ 配置 ~6 万（120 文件 × 500 切片/文件）= **~11 万条目**。sqlite-vss 轻松承载。

### BPE 对 LLM 的暴露

LLM **只能**通过两个受约束的 MCP 工具访问黑池：

- `bpe_semantic_search(query, limit=5)` → 返回 top-5 切片（每个 ≤ 500 token）+ 源文件 + 行号
- `bpe_lookup_symbol(name, limit=3)` → 返回符号定义位置 + 上下文 20 行

**禁止提供**：grep 全仓 / 读完整大文件 / 递归列目录。LLM 看到的永远是预裁剪的小切片。

### @Cite 机制

用户在 BPE 面板找到结果后，点 "Cite" 按钮，该切片作为附件进入当前对话（类似 Claude Code 的 @filename）。LLM 只看到用户挑出的小块，不是自己翻的。

**核心倒转：不是让 LLM 搜索黑池，是让用户搜索黑池、LLM 理解用户挑出来的东西。**

---

## 8. 架构分层

```
┌─────────────────────────────────────────────────┐
│ L5  Plugin Layer（本期只写协议文档，不实现）      │
├─────────────────────────────────────────────────┤
│ L4  Renderer（React 渲染进程）                    │
│     - ChatView / Sidebar / StatusBar             │
│     - SilverPanel（银芯面板）                     │
│     - BPEPanel（黑池浏览器面板）                  │
│     - TokenMeter（多维 token 仪表盘）            │
│     - GearSwitch（档位切换器）                    │
├─────────────────────────────────────────────────┤
│ L3  Conversation Engine                          │
│     - LLM Provider 抽象 + Claude 适配            │
│     - Streaming + Tool Use Loop                  │
│     - History Compression                        │
│     - Tool Result Truncation                     │
│     - Token Accounting（6 维计量）               │
├─────────────────────────────────────────────────┤
│ L2  Data Engines（双引擎，差异化核心）            │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │ Silver Core      │  │ BPE (Black Pool      │ │
│  │ - MCP Client     │  │      Explorer)       │ │
│  │ - Direct Python  │  │ - Vector Search      │ │
│  │   JSON-RPC       │  │ - Haiku Reranker     │ │
│  │ - 4 MCP tools    │  │ - 2 MCP tools        │ │
│  │ - 5 direct-only  │  │ - @Cite injection    │ │
│  └──────────────────┘  └──────────────────────┘ │
├─────────────────────────────────────────────────┤
│ L1  Core Services                                │
│     - IPC Trunk / electron-store Config          │
│     - Logger / Token Log SQLite                  │
├─────────────────────────────────────────────────┤
│ L0  Shell（Electron 主进程）                      │
│     - Window / Tray / Hotkey (Ctrl+Shift+B)      │
│     - BPE Index Loader                           │
└─────────────────────────────────────────────────┘
```

---

## 9. 目录结构

```
projects/bpt/
├── package.json                  # Electron 33 + React 18 + Vite 6 + TS 5 + Tailwind
├── tsconfig.json / tsconfig.node.json
├── vite.config.ts / tailwind.config.js / postcss.config.js
├── index.html / .gitignore
├── README.md / CONTEXT.md / CHANGELOG.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── MASTER-PROTOCOL.md
│   └── PLUGIN-PROTOCOL.md
│
├── electron/                     # 主进程（L0-L3）
│   ├── main.ts                   # 入口：窗口 + IPC + 托盘 + 热键
│   ├── preload.ts                # contextIsolation 桥 → window.bpt.*
│   ├── core/
│   │   ├── ipc-trunk.ts          # IPC 主干分派
│   │   ├── config.ts             # electron-store 封装
│   │   └── logger.ts             # 结构化日志 + token 日志写 SQLite
│   ├── silver/                   # L2 银芯引擎
│   │   ├── mcp-client.ts         # stdio 挂 scripts/mcp_server.py（4 个 MCP 工具）
│   │   ├── direct-client.ts      # JSON-RPC 直调 Python（5 个 direct-only 工具）
│   │   ├── memory-api.ts         # 9 工具强类型 TS wrapper（统一入口）
│   │   └── silver-ipc.ts         # 暴露给渲染进程
│   ├── bpe/                      # L2 黑池浏览器引擎
│   │   ├── index-loader.ts       # 加载 3 个 SQLite（chunks/vectors/keywords）
│   │   ├── search.ts             # 向量搜索 + FTS5 兜底 + Haiku 重排
│   │   ├── cite.ts               # @Cite 注入对话上下文
│   │   └── bpe-ipc.ts            # 暴露给渲染进程
│   ├── llm/
│   │   ├── provider.ts           # LLMProvider 抽象接口
│   │   ├── claude.ts             # Anthropic SDK 适配（流式 + tool_use + cache_control）
│   │   ├── token-accounting.ts   # 6 维 token 计量 + 成本估算
│   │   └── tool-registry.ts      # 工具注册表（built-in / mcp / plugin 三类）
│   ├── conversation/
│   │   ├── stream.ts             # 流式响应处理
│   │   ├── tool-loop.ts          # 工具调用循环 + 结果截断
│   │   └── compressor.ts         # 历史压缩（滚动摘要）
│   ├── shell/
│   │   ├── window.ts             # 窗口管理 + 状态持久化
│   │   ├── tray.ts               # 系统托盘
│   │   └── hotkey.ts             # 全局快捷键
│   └── plugin/
│       └── README.md             # 占位，本期不实现
│
├── src/                          # L4 渲染进程（React）
│   ├── main.tsx / App.tsx / index.css
│   ├── types.ts                  # 母版协议共享类型
│   ├── lib/
│   │   ├── ipc.ts                # window.bpt.* 包装
│   │   └── hooks.ts              # 银芯 + BPE + token 相关 React hooks
│   └── components/
│       ├── ChatView.tsx           # 对话视图（流式 + 工具调用 + @Cite 附件）
│       ├── Sidebar.tsx            # 对话列表 + 新建
│       ├── SilverPanel.tsx        # 银芯面板（记忆搜索 / 图谱查询）
│       ├── BPEPanel.tsx           # 黑池浏览器面板（语义搜索 + @Cite）
│       ├── TokenMeter.tsx         # 多维 token 仪表盘
│       ├── GearSwitch.tsx         # 档位切换器
│       └── StatusBar.tsx          # MCP 状态 / 版本 / 档位
│
├── build/
│   └── icon.svg
│
└── models/                       # bge-m3 模型文件（2.2GB，SVN 分发）
    └── README.md                 # 说明如何下载 / 更新模型
```

**仓库根新增**：

```
scripts/
└── bpe_indexer.py                # BPE 索引构建器（扫仓库 → chunk → embed → 3 SQLite）
```

---

## 10. Phase 0 交付范围

### 做什么

**A. 骨架 + 工具链**（~10 文件）
- package.json / tsconfig / vite.config / tailwind / postcss / index.html / .gitignore
- 文档：README.md / CONTEXT.md / CHANGELOG.md
- 协议文档：docs/ARCHITECTURE.md / MASTER-PROTOCOL.md / PLUGIN-PROTOCOL.md

**B. L0-L1 Shell + Core**（~6 文件）
- electron/main.ts — 窗口 + IPC 注册 + 托盘 + 热键
- electron/preload.ts — window.bpt.* 桥
- electron/core/ipc-trunk.ts — IPC 分派
- electron/core/config.ts — electron-store
- electron/core/logger.ts — 结构化日志 + token SQLite

**C. L2 银芯引擎**（~4 文件）
- electron/silver/mcp-client.ts — stdio 挂 mcp_server.py（4 MCP 工具）
- electron/silver/direct-client.ts — JSON-RPC 直调（5 direct 工具）
- electron/silver/memory-api.ts — 统一 TS wrapper
- electron/silver/silver-ipc.ts — 暴露给渲染

**D. L2 BPE 引擎**（~4 文件 + 索引构建器）
- electron/bpe/index-loader.ts — 加载 SQLite 索引
- electron/bpe/search.ts — 向量搜索 + FTS5 + Haiku 重排
- electron/bpe/cite.ts — @Cite 注入
- electron/bpe/bpe-ipc.ts — 暴露给渲染
- scripts/bpe_indexer.py — 构建器（chunk + embed + 写 SQLite）

**E. L3 对话引擎**（~5 文件）
- electron/llm/provider.ts — LLMProvider 抽象
- electron/llm/claude.ts — Anthropic SDK 适配（流式 + tool_use + cache_control）
- electron/llm/token-accounting.ts — 6 维计量
- electron/llm/tool-registry.ts — 工具注册表
- electron/conversation/stream.ts + tool-loop.ts + compressor.ts

**F. L4 渲染层**（~10 文件）
- src/main.tsx + App.tsx + index.css（Tailwind 暗金主题）
- src/types.ts — 母版协议类型
- src/lib/ipc.ts + hooks.ts
- src/components/ChatView.tsx + Sidebar.tsx + SilverPanel.tsx + BPEPanel.tsx + TokenMeter.tsx + GearSwitch.tsx + StatusBar.tsx

**G. Shell**（~3 文件）
- electron/shell/window.ts + tray.ts + hotkey.ts

**总计约 42 个新文件。**

### 不做什么（本期不做）

- 完整 Artifacts 面板（留接口位）
- 多 LLM 后端（只通 Claude，OpenAI/Ollama 留 provider 接口）
- SQLite 会话持久化（先用 electron-store 存对话列表）
- 插件加载器代码（只有协议文档）
- 打包发布 / 自动更新 / 错误上报
- PDF / 图片 / Excel 内容工具
- 63 角色人格切换 / Dream 可视化 / 哨兵告警 UI
- BPE 向量索引的实际构建（bpe_indexer.py 写好但不跑，因为需要 bge-m3 模型文件；Phase 0 用 FTS5 关键词兜底做 smoke test）

### 从 biav-desktop 继承什么

**可参考（已废目录，仅作参考，不复制粘贴）**：
- `projects/biav-desktop/electron/mcp/manager.ts` — MCP stdio spawn 模式（127 行，仅作参考）
- `projects/biav-desktop/electron/main.ts` — IPC 注册模式（仅作参考，避免它的 16 路全注册反模式）
- `projects/biav-desktop/CONTEXT.md` — 技术栈版本（仅作参考）

**明确不继承**：
- `self-evolve` 插件系统 — 有毒模式
- 16 路 IPC 全注册 — 违反 active tool set 最小化
- 任何含 `\r\n` 字面量的代码 — 污染源

---

## 11. 部署与内网约束

- **分发方式**：BPT 随黑池 SVN 仓库分发。团队 `svn update` 即获取最新版
- **网络**：内网隔离，所有 LLM 流量必走公司网关（OpenAI 兼容接口）
- **不做 electron-builder 打包**：Phase 0 是源码级分发 + `npm install` + `npm run electron:dev`
- **模型文件**：bge-m3（2.2GB）通过 SVN 分发到 `projects/bpt/models/`，首次 checkout 后不变
- **BPE 索引**：3 个 SQLite 文件通过 SVN 分发，Dev 构建后 commit，团队 update 获取

---

## 12. 验证方式（Smoke Test）

Phase 0 写完后逐条验证：

| # | 测试 | 通过标准 |
|---|------|----------|
| V1 | `cd projects/bpt && npm install && npx tsc --noEmit` | 零类型错误 |
| V2 | `npm run build:vite` | 产出 dist/ |
| V3 | `npm run electron:dev` | 窗口打开，标题 "BPT"，暗色主题，侧边栏 + 状态栏 + 档位切换器可见 |
| V4 | MCP 连接 | 启动时 spawn mcp_server.py，状态栏显示 connected/error，连接后列出 4 个 MCP 工具 |
| V5 | 银芯面板 | SilverPanel 输入查询 → 调 memory_search → 结果渲染（前提：先跑过 memory_search.py --build） |
| V6 | BPE 面板（FTS5 兜底） | BPEPanel 输入查询 → 关键词搜索 → 结果列表 + @Cite 按钮可用（向量搜索需 bge-m3，Phase 0 用 FTS5 兜底） |
| V7 | LLM 对话 | 设置里填 API 端点 + Key → 发消息 → 看到流式回复 |
| V8 | Token 仪表盘 | 对话后 TokenMeter 显示 6 维分布 + 成本估算 |
| V9 | 档位切换 | 对话档 ↔ 工作档切换，状态栏反映，工具列表变化 |
| V10 | 快捷键 | Ctrl/Cmd+Shift+B 切换窗口可见性 |
| V11 | 托盘 | 系统托盘图标出现，右键菜单含显示/退出 |
| V12 | 10 轮 token 预算 | 挂 12 工具连问 10 题，input ≤ 30k / cache hit > 70% / output ≤ 10k |

未通过项写入 CHANGELOG v0.1.0 的 "Known Issues"。

---

## 13. 已知风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 公司网关不兼容 Anthropic SDK 的 `cache_control` | T1 红线失守，token 经济崩盘 | Phase 0 验证时重点测 cache 命中率；若网关不支持，退到手动 system prompt 复用策略 |
| bge-m3 2.2GB 模型 SVN 首次下载太慢 | 新成员 onboarding 慢 | 可用内网文件服务器单独分发模型，SVN 里只放 README 指向下载地址 |
| sqlite-vss 跨平台编译问题 | BPE 向量搜索在某些 Windows 版本上跑不起来 | Phase 0 用纯 FTS5 兜底；sqlite-vss 编译成功后再启用向量路径 |
| tree-sitter C# 语法包对 Unity 特殊语法支持不全 | 部分 C# 文件 chunking 失败 | fallback 到按行数固定切（每 30 行一块），有损但不停机 |
| Haiku 重排质量不稳定 | BPE 搜索结果排序不准 | 重排是可选步骤，关掉后退到纯向量相似度排序 |
| 非程序员独立运维 BPT 出问题时排障困难 | Light 被困在错误日志里 | CONTEXT.md 写清楚常见错误 → 解法映射表；logger 日志格式对 AI 友好（结构化 JSON） |

---

## 14. 关键设计取舍

1. **为什么另起 `projects/bpt/` 而不是重构 biav-desktop**
   biav-desktop 有 `self-evolve` 毒性 + `\r\n` 污染 + 16 路全注册反模式。重构 = 背历史债。用户明确选了新建。

2. **为什么 Electron 而不是 Tauri**
   MCP 客户端用 Node.js spawn Python 最自然；团队技术栈偏 TS；electron-store/electron-builder 生态成熟。

3. **为什么银芯 MCP 从 9 砍到 4**
   Token 经济纪律。rebuild_indexes / memory_writeback / check_cache / memory_utility / recommend_context 这 5 个要么是管理操作（LLM 不该碰）、要么是系统自动注入（不需要 LLM 决策）。砍掉后 schema 成本腰斩。

4. **为什么 BPE 不让 LLM 自由搜索**
   biav-desktop 精确死因复现：LLM grep 大仓库 → 分页 → 每页一个完整 LLM 轮次 → token 爆炸。倒转为 UI 优先 + @Cite 注入。

5. **为什么选 bge-m3 而不是更小的模型**
   120 个配置 × 1-2MB = 切片可能 > 512 token，bge-small/base 的 512 上限会截断。bge-m3 的 8192 上下文能完整嵌入大切片，且代码能力远超 zh 专项模型。2.2GB 是值得的代价。

6. **为什么 Phase 0 BPE 用 FTS5 而不是直接上向量**
   sqlite-vss 跨平台编译有风险；bge-m3 模型下载是额外步骤。FTS5 零额外依赖，关键词搜索已能完成 smoke test。向量路径作为 Phase 0.5 增量交付。

---

## 15. 后续阶段

- **Phase 0.5**：BPE 向量搜索上线（bge-m3 + sqlite-vss）、bpe_indexer.py 跑通完整仓库
- **Phase 1**：SQLite 会话持久化 / Artifacts 面板 / 多 LLM 后端 / ErrorBoundary
- **Phase 2**：插件加载器实现 / 沙箱 / 第一个示例插件
- **Phase 3**：63 角色人格 / Dream 面板 / 哨兵告警 / 社区日报
- **Phase 4**：打包发布流水线（electron-builder / 自动更新）
- **Phase 5**：母版 SDK 导出，让内网版本作为纯插件加载

---

## 参考文件（只读，已废目录仅作参考）

- `projects/biav-desktop/electron/mcp/manager.ts` — MCP spawn 模式（仅作参考）
- `projects/biav-desktop/electron/main.ts` — IPC 注册模式（仅作参考，反面教材）
- `projects/biav-desktop/CONTEXT.md` — 技术栈版本（仅作参考）
- `scripts/mcp_server.py` — 银芯 9 工具签名
- `memory/boot-snapshot.md` — 银芯启动快照