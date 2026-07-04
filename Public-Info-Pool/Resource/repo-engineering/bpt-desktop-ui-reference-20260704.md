# BPT Desktop UI 参考实现情报

- **日期**：2026-07-04
- **来源**：守密人转交的 GPT-5.5 搜索梗概 + 银芯 AnySearch 实时核验（2026-07-04，许可证逐项实锤）+ `projects/bpt-agent-sdk/docs/COMPAT.md` 契约对照
- **定位**：银芯 → 黑池**单向输出物**（§1.1-HC 同向）。消费方为 BPT Desktop（Electron/Node）前端线；本档案本体属银芯公开信息层，不含任何黑池数据。
- **背景**：BPT Desktop 已有自研 UI 前端但开发不顺。本档案回答三个问题：该参考谁、哪些代码法律上能直接借、UI 组件怎么对上 bpt-agent-sdk 的消息流。

---

## §1 结论速览

1. **不建议逆向 Claude Desktop**（app.asar 解包只能学交互模式，代码 / 资产 / 提示词一概不可入 BPT——与 SDK 线净室纪律同源，见 §7）。
2. **主路线：开源参考 + 组件库底座**。许可证红绿灯核验结果：**绿区可直接借代码**的有 assistant-ui / Vercel AI Elements / LibreChat / NextChat / Goose / Continue；**红区（AGPL / GPL 传染）只能看不能抄**的有 Cherry Studio / Chatbox；Open WebUI 与 LobeChat 落**黄区**（附加条款，抄代码前须法务判断）。
3. **最短路径**：BPT Desktop 保持 Electron，前端 React + Vite + Tailwind + shadcn/ui + Zustand，聊天层直接铺 **assistant-ui 或 AI Elements**（两者都是 shadcn 系「源码进你仓库随便改」模式，不是黑盒依赖），流式与工具事件直接消费 bpt-agent-sdk 的 `SDKMessage` 流（对接表见 §5）——**不需要自己裸写 fetch + ReadableStream**，SDK 的 `query()` 异步生成器已经是流。

---

## §2 两条路线评估

### 路线 A：研究 Claude Desktop 本体（不推荐作为主路线）

Claude Desktop 是 Electron 应用，renderer bundle 在 `app.asar` 内可解出，能看到打包后
JS / CSS / 资源与状态管理痕迹。但：

- 属闭源客户端逆向，**只适合观察交互模式**（布局层级、工具卡展开时机、权限弹窗文案结构、artifact 面板行为）；
- **任何代码、样式表、图标资产、提示词文本都不得复制进 BPT**——BPT 线的合法性地基是净室纪律（MIT / 公开文档单一输入），逆向产物一旦混入，SDK 线辛苦维持的干净地基一并失守；
- 观察所得应转写成**自然语言行为描述**（「工具调用默认折叠、点击展开入参出参」），再据描述独立实现——与 SDK 线「黑箱行为观测法」同一方法论。

### 路线 B：开源参考 + 组件库底座（主路线）

现成开源项目已把「Claude Desktop 式 UI」的全部件做过一遍：会话列表 / 聊天流 / composer /
附件 chip / 工具调用卡 / MCP 状态 / artifact 面板 / 明暗主题 / 流式与停止重试复制。
选对许可证，可以直接借代码而非只借思路。

---

## §3 开源参考矩阵（许可证 2026-07-04 实时核验）

### 绿区——宽松许可证，可直接借代码入闭源 BPT

| 项目 | 许可证 | 形态 / 技术栈 | 对 BPT 的价值 | 核验 |
|------|--------|--------------|---------------|------|
| **assistant-ui**（assistant-ui/assistant-ui） | MIT（训练期知识，装前 `LICENSE` 复核一眼） | React/TS 聊天组件库，shadcn 式源码落仓 | **聊天层首选底座**：消息流 / 流式 / 分支重试 / 工具 UI 原语齐全，专为「生产级 AI 聊天」造 | npm 活跃（日更级） |
| **Vercel AI Elements**（vercel/ai-elements） | Apache-2.0（LICENSE 实锤） | shadcn/ui 之上的组件注册表 | 组件谱系惊人地贴 BPT 需求：Conversation / Message / Reasoning / **Tool / Task / Artifact / Terminal / Web Preview / Plan / Confirmation**（权限确认卡）——几乎是 agent 客户端零件目录 | 已核 |
| **Goose Desktop**（block/goose） | Apache-2.0（GitHub 元数据实锤） | Rust 引擎 + Electron desktop，MCP 原生 | **与 BPT 架构同构度最高**（本地 agent + MCP + Electron），其「MCP Apps」（扩展在桌面端渲染交互 UI）是 MCP 状态 / 工具面板的最好参照；50K stars | 已核 |
| **LibreChat**（danny-avila/LibreChat） | MIT（训练期知识，装前复核） | TS 全栈 Web，Agents / MCP / Artifacts | 会话管理（搜索 / fork / 预设）与多模型切换最成熟；MCP 文档写得细，适合参考 MCP 配置 UX | 40K stars，活跃 |
| **Continue.dev**（continuedev/continue） | Apache-2.0（训练期知识，装前复核） | TS，IDE 扩展 + GUI | 工具调用流 / diff 预览 / 代码块交互的成熟参照 | 活跃 |
| **NextChat**（ChatGPTNextWeb） | MIT（训练期知识，装前复核） | React 轻量聊天 | 轻量 composer / 快捷键 / 主题的低复杂度参照 | 活跃 |
| **Chatbot UI**（mckaywrigley） | MIT | Next.js | 仅作简洁布局参考，项目已基本停更 | 低活跃 |

### 黄区——附加条款，抄代码前须逐条判断

| 项目 | 许可证 | 风险点 |
|------|--------|--------|
| **Open WebUI** | BSD-3 + **品牌保护条款**（v0.6.6 起，2025-04；已非 OSI 认证开源） | 移除 / 更改 "Open WebUI" 品牌即构成违约（豁免线：≤50 用户部署或贡献者）。BPT 若借其代码做换皮桌面端，正踩条款红线。**建议只学功能设计，不搬代码** |
| **LobeChat** | **LobeHub Community License**（Apache-2.0 基底 + 附加条件，1.0 起） | 自用 / 作为服务跑没问题；**基于它开发并分发衍生品需向 LobeHub 购买商业授权**。BPT 是分发的桌面产品——正中限制。只学设计（它的桌面版交互与主题系统确实漂亮），不搬代码 |

### 红区——Copyleft 传染，闭源 BPT 一行都不能抄

| 项目 | 许可证 | 说明 |
|------|--------|------|
| **Cherry Studio** | **AGPL-3.0 双许可**（LICENSE 实锤：默认 AGPLv3；>10 人组织须购商业授权） | 国产桌面 AI 客户端最强完成度（48K stars，Electron/TS，MCP 支持），**当交互样板间看，代码零借用** |
| **Chatbox** | **GPLv3**（LICENSE 实锤） | 轻量桌面客户端参照，同上：只看不抄 |
| **5ire** | **未核验到许可证**（GitHub 页未露出，按红区处理直到核清） | 卖点是「简洁 MCP 客户端」，其 MCP 工具启用 / 运行时依赖提示的 UX 值得看一眼 |

> 红黄区的正确用法：跑起来截图、记录交互行为、转写成自然语言规格，再在绿区底座上独立实现。
> 与净室方法完全一致，法律上干净。

---

## §4 推荐组件骨架

GPT-5.5 给出的骨架方向正确，按 bpt-agent-sdk 实际契约修订如下（增补处以 `*` 标注）：

```text
AppShell
├─ Sidebar
│  ├─ NewChat / Search
│  ├─ ConversationList          ← SDK listSessions()（JSONL 存储）
│  │  └─ ConversationItem       ← rename / tag / fork / delete 均有 SDK 方法*
│  └─ Settings（模型 / 凭据 / MCP 配置 / 快捷键 / 主题）
├─ ChatMain
│  ├─ Header：标题 · 模型 · MCP 状态灯 ← mcpServerStatus()*
│  ├─ MessageList
│  │  ├─ UserMessage / AssistantMessage（流式打字机）
│  │  ├─ ToolCallCard（折叠展开：入参 / 出参 / 耗时）
│  │  ├─ SubagentTaskCard*      ← task_* 生命周期事件（v0.4 真发射）
│  │  ├─ PermissionPromptCard*  ← canUseTool 回调（阻塞待用户决策）
│  │  └─ StatusStrip*           ← rate_limit_event / api_retry / permission_denied
│  └─ Composer
│     ├─ AttachmentBar（文件 chip）
│     ├─ Textarea + Send / Stop ← Stop = query.interrupt() / AbortController
│     └─ ModeSwitch*（permissionMode：default / acceptEdits / plan / dontAsk）
└─ RightPanel
   ├─ ArtifactPreview / FilePreview
   ├─ ToolTrace（全量工具时间线）
   ├─ ShellPanel*               ← 后台 Bash：BashOutput 增量拉取 / KillShell（v0.5）
   └─ RunMetricsDash*           ← result.metrics 成本 / 缓存命中 / 逐轮耗时（v0.3）
```

## §5 核心增值：UI 组件 ↔ bpt-agent-sdk 消息流对接表

通用聊天 UI 参考项目解决不了的那一半，恰是 BPT 独有的：UI 事件源不是裸 HTTP 流，而是
bpt-agent-sdk 的 `SDKMessage` 异步生成器。逐件对接（契约出处 `docs/COMPAT.md`）：

| UI 件 | SDK 事件源 | 契约状态 |
|-------|-----------|---------|
| 流式打字机 | `options.includePartialMessages: true` → `stream_event`（原始 SSE 事件逐 token）；消息级消费 `SDKAssistantMessage` | FULL |
| 工具调用卡 | assistant 消息 `tool_use` 块 → 卡片挂起；对应 `tool_result` 到达 → 填充出参 | FULL |
| 权限弹窗 | `canUseTool(toolName, input, {suggestions, requestId})` 回调——UI 弹窗、await 用户点击、返回 allow/deny；拒绝后流内会出 `permission_denied` 消息 + `result.permission_denials` 台账可作会话级审计列表 | FULL（真发射） |
| 子代理任务卡 | `task_started`（task_name）/ `task_progress`（`turn N/M` 进度）/ `task_updated`（终态 + 500 字符结果预览）/ `task_notification`（仅后台子代理，可接系统通知） | FULL（v0.4 真发射；注意事件在消息边界排空，前台事件在其工具组结束后浮出，UI 勿假设毫秒级实时） |
| 重试 / 限流状态条 | `rate_limit_event`（含 `retry_after_ms`，可做倒计时条）/ `api_retry`（status/reason） | FULL（真发射） |
| Hook 审计面板 | `hook_started` / `hook_response` 成对（`options.includeHookEvents` 门控，hook_id 关联） | FULL（v0.4） |
| MCP 状态灯 | `mcpServerStatus()`（含 config / tools[] / scope） | 已富化（task #17） |
| 成本仪表盘 | `result.metrics`（`SDKRunMetrics`：perTurn / perTool / cacheHitRatio / 用量 / 成本 / API 耗时）——直接可视化，回应「效率不可见」之忧 | FULL（v0.3 头号交付） |
| 会话列表 / 分叉 | `listSessions` / `getSessionMessages` / `renameSession` / `tagSession` / `forkSession` / `resume` / `continue`（SDK 自有 JSONL 存储，或外部 `sessionStore` 接 BPT 自己的库） | PARTIAL（无 Claude Code 存储互通，BPT 场景无碍） |
| 停止按钮 | `query.interrupt()` / AbortController | FULL |
| 后台 shell 面板 | Bash `run_in_background` + `BashOutput`（增量 + 按行 filter）/ `KillShell` | FULL（v0.5） |
| 文件检查点 / 回滚 | 文件检查点（v0.2）——「改坏了一键回」的 UI 挂点 | 已落地 |
| Electron 主进程接线 | `examples/electron-host.mjs`（四个 host callback 接线范本）+ `docs/MIGRATION.md`（凭据 / 已知行为差异七条 / 试点验收清单） | v0.5 换装就绪包 |

## §6 技术栈建议

| 层 | 建议 | 理由 |
|----|------|------|
| 桌面壳 | **保持 Electron** | BPT Desktop 已是 Electron/Node；SDK 换装范本也按 Electron 写。Tauri 迁移是另一个项目，别和 UI 重建捆一起 |
| 前端 | React + Vite + TypeScript | 绿区参考项目全在此生态，借代码零翻译成本 |
| UI 底座 | Tailwind + shadcn/ui，聊天层 **assistant-ui 或 AI Elements 二选一** | 源码进仓可魔改；AI Elements 的 Tool / Task / Confirmation / Terminal 组件与 §5 对接表几乎一一对应 |
| 状态 | Zustand（会话 / 设置）+ 组件内状态（流式缓冲） | 轻，样板少 |
| 流式 | 直接迭代 SDK `query()` 生成器，renderer 经 IPC 订阅 | 主进程跑 SDK（持文件 / shell / 凭据权限），renderer 纯展示——天然进程隔离，别把 API key 放进 renderer |
| 本地配置 | JSON 文件起步，量大再 SQLite | 会话本体 SDK 的 JSONL 存储已管 |

## §7 净室与许可证硬边界（与 SDK 线共用地基）

1. **Claude Desktop 逆向产物（代码 / 资产 / 提示词）零复制**；泄漏 / 流传的官方材料不入仓（泄漏 ≠ 公开文档）。
2. **红区（AGPL / GPL）代码零借用**——AGPL 对「分发的桌面应用」传染性最强，Cherry Studio / Chatbox 只能当样板间。
3. **黄区抄码前逐条款判断**：Open WebUI 的品牌条款、LobeChat 的衍生品分发限制，都正中「换皮桌面产品」场景。
4. **绿区也要留证**：借入的每个文件头部保留原版权声明与许可证标注（MIT / Apache-2.0 均要求），Apache-2.0 另附 NOTICE。
5. 训练期知识标注的许可证（assistant-ui / LibreChat / Continue / NextChat）在 `npm install` 前花十秒复核 `LICENSE` 文件——许可证是会变的，Open WebUI 与 LobeChat 就是前车之鉴。

---

*核验来源（2026-07-04 AnySearch）：Open WebUI 官方 license 文档与 discussions #8467；LobeHub LICENSE（lobehub/lobe-chat）；CherryHQ/cherry-studio LICENSE（双许可声明）；Bin-Huang/chatbox LICENSE（GPLv3）；block/goose GitHub 元数据（Apache-2.0）；vercel/ai-elements LICENSE（Apache-2.0）；assistant-ui npm / 官网。*
