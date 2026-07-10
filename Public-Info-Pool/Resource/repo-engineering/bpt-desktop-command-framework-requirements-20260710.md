# BPT Desktop 壳层命令框架 需求说明书 v1.1

- 日期：2026-07-10（v1.1 同日修订：补 R5 目标门控，依赖基线升 v0.39）
- 作者：艾瑞卡（守密人 /goal「全面实现建议 + 落档给黑池的需求说明书」工单终件）
- 性质：银芯 → 黑池**单向输出物**（与 §1.1-HC 防火墙同向；本档为公开信息层
  工程产物，黑池侧实现细节不回流）
- 消费方：BPT Desktop（Electron 壳）开发线
- 依赖基线：`bpt-agent-sdk` **v0.39.0**（自定义命令加载器 + Stop 钩子阻断语义均已落地）；
  背景盘点见姊妹档 `cc-engine-external-commands-20260710.md`（五类命令全景）；
  行为观测语料见 `cc-command-behavior-observations-20260710.md`（/goal 机制 OBS-002）
- 参考对照：CC v2.1.201 官方行为（提示词参照库 + Agent SDK 文档快照）

---

## 1. 目标与非目标

**目标**：让 BPT Desktop 获得与 Claude Code 同构的「引擎外命令」体验——
用户输入 `/xxx` 时得到与官方 CLI 一致的行为分层：本地命令即时生效、
自定义命令展开进引擎、定时类命令真的到点会跑。

**非目标（本期不做）**：

- B 类官方骨架提示词（/review /simplify /security-review 等 8 命令）的文本
  再现——**挂账待守密人裁定**（G8「公开信息再现」同款定位问题，见 §6）。
- 插件系统（D 类）与 MCP prompts 升格（E 类）——待壳层插件面设计定稿后另立需求。
- `!command` 内嵌 bash 与 `@file` 引用的 SDK 侧支持（SDK COMPAT.md 已声明
  不支持；壳层不得自行绕过——安全边界见 §3.4）。

## 2. 分工边界（总架构约束）

```
用户输入 "/xxx args"
   │
   ├─ A 类命中（本地命令表）──→ 壳层直接执行，绝不进引擎        [壳层职责]
   │
   ├─ C 类命中（.claude/commands）──→ 原文透传给 SDK，
   │        SDK v0.38 引擎侧自动展开（壳层零展开逻辑）          [SDK 已实现]
   │
   ├─ /loop、/schedule 类命中 ──→ 壳层解析 + 挂本地调度器，
   │        到点以普通 prompt 重入会话（resume）               [壳层职责]
   │
   └─ 未命中 ──→ 原文作为普通 prompt 进引擎（SDK 会原样透传）
```

**铁律**：命令概念不进引擎主循环。引擎（SDK）只认识两样东西：内建 `/compact`
特判与 `.claude/commands` 展开层（均已在 SDK v0.38 内）。壳层不得要求 SDK
新增命令感知钩子——需要新命令行为时优先落 `.claude/commands` 文件（C 类），
其次壳层本地实现（A 类）。

## 3. 需求分项

### 3.1 R1 命令面板（A 类，壳层实现，P0）

- **R1.1** 输入框以 `/` 起始时弹出命令面板，数据源三合一：
  ① 壳层本地命令表（见 R1.3）；② SDK `query.supportedCommands()` 返回的
  `SlashCommand[]`（含 `name` / `description` / `argumentHint`，v0.38 起为
  built-in `compact` + 全部 `.claude/commands` 自定义命令）；③ 定时类命令
  （R3）。三源去重，本地命令优先展示。
- **R1.2** `system/init` 消息的 `slash_commands: string[]`（bare name）可作
  会话启动即渲染的快速数据源；`supportedCommands()` 作按需刷新源。
- **R1.3** 本地命令最小集（P0）：`/model`（切模型，调 `query.setModel()`）、
  `/clear`（新会话）、`/resume`（会话恢复列表）、`/compact`（原文透传进引擎——
  SDK 内建特判接手）、`/help`（命令面板全列表）。P1 扩展：`/permissions`
  （权限模式切换，`setPermissionMode()`）、`/mcp`（`mcpServerStatus()` 展示 +
  `reconnectMcpServer()`）、`/usage`（会话 result 消息的 usage 累计展示）。
- **R1.4** 本地命令的输出在 UI 以系统条目呈现，**不写入会话 transcript**
  （与官方 `local_command_output` 语义对齐）。

### 3.2 R2 自定义命令对接（C 类，SDK 已实现，壳层只做透传与呈现，P0）

- **R2.1** 用户提交 `/name args` 且未命中本地命令表时，壳层**原文透传**给
  SDK（string prompt 或 streaming `SDKUserMessage`）。禁止壳层预展开——
  展开是 SDK 职责（否则双端漂移）。
- **R2.2** UI 呈现约定：会话流里用户气泡显示**原始输入**（`/name args`），
  实际入引擎的展开文本可折叠查看（SDK 回流的 user echo 消息携带展开后内容，
  两者对照即可实现）。
- **R2.3** 壳层提供 `.claude/commands/` 目录的可视化管理入口（列表 / 新建 /
  编辑 markdown），写盘即生效于**下一个** query（SDK 每 query 构造期装载一次，
  无热更新——这是 SDK 声明行为，壳层 UI 需注明「重开会话生效」）。
- **R2.4** frontmatter 支持面以 SDK COMPAT.md「Custom slash commands」节为准：
  编辑器只提示 `description` / `argument-hint` 两个消费键；`allowed-tools` /
  `model` 键显示「本 SDK 不消费」灰条，不得静默假装生效。

### 3.3 R3 调度平面（/loop、/schedule 同族，壳层实现，P1）

- **R3.1** 壳层实现 `/loop [间隔] <prompt>` 解析（官方语法参照：前导
  `\d+[smhd]` token 或尾部 `every N unit` 子句，默认间隔 10m——完整解析规则
  见参照库 skill-loop-slash-command.md）。
- **R3.2** 调度执行体放壳层：Electron 主进程定时器 + 任务注册表（持久化到
  本地存储，应用重启后恢复）。到点行为 = 以注册的 prompt 通过 SDK `resume`
  重入目标会话（会话可重入性 SDK 已支持），跑完一轮回到待命。
- **R3.3** 提供 `/loop` 列表 / 暂停 / 删除的管理 UI；单任务连续失败 3 次自动
  暂停并通知（防止无人值守空转烧钱——**必须**给每轮任务设 `maxBudgetUsd`）。
- **R3.4** 明确非目标：不往 SDK 里加 CronCreate/ScheduleWakeup 工具——官方
  也是 harness 层设施，塞引擎反而偏离 drop-in 基线。若未来模型需要「自我调度」
  能力（模型主动挂定时器），以壳层注入的 MCP server 形式提供，仍不进 SDK 内核。

### 3.4 R4 安全边界（P0，硬约束）

- **R4.1** `!command` 内嵌 bash：SDK 声明不支持，壳层**同样禁止**自行实现
  「提交前先跑命令文件里的 bash」——该执行面绕过 SDK 权限门（gate），等于
  给任意 markdown 文件开了免审执行口。需要动态上下文时改用命令正文引导模型
  调 Bash 工具（走正常权限门）。
- **R4.2** 命令面板渲染 `description` 时按纯文本处理（来自用户可写的 markdown
  frontmatter，防注入 UI）。
- **R4.3** 调度任务的 prompt 落本地持久化时按敏感数据对待（可能含仓库路径 /
  业务上下文），不进任何遥测。

### 3.5 R5 目标门控 /goal 同构（壳层 + SDK v0.39 已备，P1）

行为规格来自活体观测（OBS-002）：官方 /goal = 本地命令注册**带自然语言条件的
会话级 Stop 钩子**，条件不满足阻断停止并驱动继续，满足自动清除。

- **R5.1** 壳层命令 `/goal <条件文本>`：向当前 query 的 `options.hooks` 注册 Stop
  钩子——matcher 带 `condition`（SDK 内建模型评估器判据），callback 返回
  `{decision:'block', reason:<未达成说明>}`。SDK v0.39 起引擎按官方语义处理：
  block → reason 作为用户回合注入 → 继续跑；`stop_hook_active` 在后续 Stop 输入
  上为 true（钩子据此可自限）；`continue:false` 强停优先。
- **R5.2** `/goal clear` 提前解除；条件达成后自动解除（callback 侧判达成即返回
  空对象不再 block）。UI 常驻显示当前目标与门控状态（活动/已达成/已清除）。
- **R5.3** 防失控三闸（SDK 侧已内建，壳层必须显式配置）：per-query `maxTurns` 与
  `maxBudgetUsd` 必填（顽固 block 会被引擎按此终止并返回 error_max_turns /
  error_max_budget_usd）；壳层再加一道「同一目标连续 N 次 block 后提示用户确认」。
- **R5.4** 作用域：目标门只作用于主会话循环——SDK 保证子代理不被捕获
  （SubagentStop 语义另管），壳层无需处理。

## 4. 验收标准（可执行清单）

| # | 场景 | 预期 |
|---|------|------|
| V1 | 输入 `/` | 面板弹出，含 compact + 本地命令 + `.claude/commands` 全部命令及 argumentHint |
| V2 | `.claude/commands/greet.md` 含 `$ARGUMENTS`，输入 `/greet Alice` | 气泡显示原文，引擎收到替换后正文（SDK echo 可证），模型按展开文本作答 |
| V3 | 输入 `/unknown xyz` | 原文作为普通 prompt 进引擎，无报错弹窗 |
| V4 | 输入 `/compact 保留结论` | SDK 内建压缩触发，回流 `compact_boundary` 消息，UI 显示压缩标记 |
| V5 | `/loop 5m 检查构建` 后关闭再打开应用 | 任务仍在、到点重入会话执行 |
| V6 | `/model` 切换 | 后续 assistant 消息的 model 字段变化，transcript 无本地命令残留 |
| V7 | 命令 md 文件含 `!rm -rf` 行 | 该行仅作为普通文本进 prompt，壳层无任何本地执行 |
| V8 | `/goal 测试全绿` 后模型交出未跑测试的答案 | 引擎不停：reason 注入为用户回合、继续跑至条件达成或撞 maxTurns；子代理不受门控 |

## 5. SDK v0.39 对接面速查（黑池侧只读参考）

- 列举：`query.supportedCommands()` → `SlashCommand[]{name, description, argumentHint}`
- 启动快照：`system/init.slash_commands: string[]`（bare name）
- 展开：引擎内自动（纯文本 `/name args` 用户回合）；混合内容（带图）不展开
- 展开优先级：内建 compact > project > user；未知名透传
- 装载时机：query 构造期一次；`commands_changed` 事件无源（勿等）
- 声明不支持：`!bash` / `@file` / `allowed-tools` / `model` frontmatter /
  模型侧 SlashCommand 工具（逐项见 SDK docs/COMPAT.md）
- 目标门控（v0.39）：Stop 钩子 `decision:'block'` → reason 注入续跑；
  `stop_hook_active` 防死循环；`continue:false` 强停优先；仅主循环、
  maxTurns/maxBudgetUsd 兜底（COMPAT hooks 表 Stop 行）

## 6. 挂账与裁定点

1. **B 类骨架提示词再现——已裁定（2026-07-10）**：取「**结构再现 + 文本自写**」
   为默认（编排思想照学、提示词文本不复制），逐命令例外通道保留（重型件如
   code-review 可单独过裁定）。G8「公开信息再现」射程不外延至 B 类文本。
   落地路径：以 C 类机制自写命令卡（R2 落地即天然可用）。
2. **`/goal` 机制——已收口（2026-07-10）**：活体观测（OBS-002）补齐行为规格，
   升格为本档 R5 正式需求；SDK 侧积木随 v0.39 落地。原「挂每周参照刷新观察」
   降级为背景比对（快照若日后捕获官方实现，与 R5 对照校正即可）。
3. **D/E 类（插件 / MCP prompts）**：待壳层插件面设计定稿后另立需求文档。
