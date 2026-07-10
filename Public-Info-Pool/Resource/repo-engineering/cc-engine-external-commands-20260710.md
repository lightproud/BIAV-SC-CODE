# Claude Code 引擎外命令全景盘点（五类分层）

- 日期：2026-07-10
- 作者：艾瑞卡（守密人 /goal「全面实现建议」工单第 0 步）
- 证据基线：
  - 官方提示词参照库 `Public-Info-Pool/Reference/Claude-Code-System-Prompts/`
    （Piebald-AI 自 `@anthropic-ai/claude-code` npm 编译产物提取，CC v2.1.201，
    上游 commit 2026-07-03，553 份提示词）
  - 官方 Agent SDK TypeScript 文档快照
    `Public-Info-Pool/Reference/Agent-SDK-Docs/typescript-20260705.md`（3550 行）
  - 本仓活样本（`.claude/commands/` 4 命令、会话内 `/model` `/goal` 实际使用）
- 用途：BPT Agent SDK 命令面建设的设计输入；姊妹产物为
  `bpt-desktop-command-framework-requirements-20260710.md`（黑池需求说明书）。

## 0. 核心辨析：「引擎外」的两种含义

Claude Code 的 slash 命令全部定义在引擎（agent 主循环）之外，但按「展开后是否
进引擎」分成两种本质不同的东西：

1. **纯本地命令**：CLI/App 前端直接消化，模型全程不知情（A 类）。
2. **提示词展开型命令**：定义与展开逻辑在 harness，展开产物作为普通 prompt
   进引擎（B/C/D/E 类）。引擎视角它们只是一段用户文本。

对 SDK/引擎工程的推论：只有 A 类真正「引擎够不着」；B/C/D/E 本质全是
「命令 → 提示词展开器」，展开层可以放壳层或引擎侧，引擎主循环无需感知命令概念。

## 1. A 类：纯 UI 本地命令（不进引擎）

前端直接处理，输出走 UI（官方 SDK 以 `SDKLocalCommandOutputMessage` 事件回流，
文档快照 3319 行点名 `/voice` `/usage` 为例）。

已证实存在（快照正文 / 文档 / 会话活样本）：
`/model` `/clear` `/help` `/config` `/login` `/logout` `/usage` `/cost`
`/doctor` `/status` `/resume` `/fast` `/theme` `/vim` `/export` `/mcp`
`/permissions` `/hooks` `/memory` `/memories` `/add-dir` `/agents`
`/statusline` `/bug` `/feedback` `/plugin` `/output-style` `/sandbox`
`/voice` `/rename` `/install-slack-app` `/install-github-app` 等，约 25+
（随版本增长，此清单非穷举）。

`/goal` 归属存疑偏 A 类：官方迁移指南技能明写「in Claude Code, `/goal` sets
direction for the run」（skill-model-migration-guide.md:843），但 553 份提示词中
无其独立技能文件——推断为 harness 状态型命令（设定长程运行的目标锚点 + Stop
hook），或属快照未捕获的新件。挂每周参照刷新观察。

## 2. B 类：提示词展开型命令（骨架提示词随 CLI 打包）

参照库有独立提示词文件实锤的 8 个：

| 命令 | 提示词文件（system-prompts/） | 职能 |
|------|------------------------------|------|
| `/loop`（含动态节奏变体） | skill-loop-slash-command(-dynamic-mode).md | 解析间隔→cron→挂定时任务 |
| `/stuck` | skill-stuck-slash-command.md | 卡死诊断 |
| `/batch` | agent-prompt-batch-slash-command.md | 批量任务派发 |
| `/review` | agent-prompt-review-slash-command.md | PR 评审 |
| `/schedule` | agent-prompt-schedule-slash-command.md | 定时任务 |
| `/security-review` | agent-prompt-security-review-slash-command.md | 安全审查 |
| `/simplify` | agent-prompt-simplify-slash-command.md | 简化重构 |

另有 63 份 skill-* 技能文件中可由用户以 `/名字` 调起者：`/init` `/run`
`/verify` `/code-review`（10+ 份分段提示词的重型技能）`/update-config`
`/design-sync` `/auto-mode-setup` `/remember` `/keybindings-help` 等。

**关键依赖注记**：`/loop` `/schedule` 除提示词外还依赖 harness 级调度平面
（CronCreate / ScheduleWakeup 一族工具）——展开层解决不了它们，见需求说明书
§4「调度平面」。

## 3. C 类：用户自定义命令（`.claude/commands/*.md`）

项目级 `<repo>/.claude/commands/` + 个人级 `~/.claude/commands/`。特性面：
frontmatter（`description` / `argument-hint` / `allowed-tools` / `model`）、
`$ARGUMENTS` 与 `$1`..`$9` 参数替换、`!command` 内嵌 bash、`@file` 文件引用、
子目录命名空间（`frontend/component.md` → `/frontend:component`）。

本仓活样本 4 个：`/biav-report` `/daily-news` `/sync-memory` `/validate-data`。

**BPT SDK 落地状态（v0.38，本工单第 1 期）**：加载 + 列举 + `$ARGUMENTS`/`$1`..`$9`
展开 + frontmatter 消费子集（description / argument-hint）+ ':' 命名空间已实现
（`projects/bpt-agent-sdk/src/engine/slash-commands.ts`）；`!bash` / `@file` /
`allowed-tools` / `model` 声明不支持（见 SDK docs/COMPAT.md「Custom slash
commands」节）。

## 4. D 类：插件命令

插件包携带 commands / skills / agents / hooks 整套装载（官方 SDK 文档快照 938 行
`skipMcpDiscovery`：「loads skills, hooks, agents, and commands from this
plugin」）。对引擎而言仍是展开器的另一个注册来源。

## 5. E 类：MCP prompts 升格命令

MCP 服务端声明的 prompt 以 `/mcp__服务名__提示名` 形式进命令面板。展开 =
调 MCP `prompts/get` 取回消息序列进引擎。

## 6. 官方 SDK 的命令运行时接口（drop-in 对账锚点）

- `supportedCommands(): Promise<SlashCommand[]>`（快照 503 行）
- `SlashCommand = { name; description; argumentHint; aliases? }`（2799 行）
- `system/init.slash_commands: string[]`（1140 行）
- `SDKCommandsChangedMessage`（可用命令集变更事件，980 行）
- `SDKLocalCommandOutputMessage`（本地命令输出回流，3319 行）

BPT SDK v0.38 对齐状态：前三项已真实装配（built-in `compact` + C 类自定义命令）；
`commands_changed` 无变更源（命令一次性装载）；`local_command_output` 无 CC-host
等价物。逐项见 SDK `docs/COMPAT.md`。

## 7. 小学生比喻总表

- A 类 = 车灯开关和空调旋钮：拧了车就变，发动机全程不知情。
- B 类 = 厨房外抽屉里的菜谱卡片：点菜时厨房收到的是展开后的完整做菜指令。
- C/D/E 类 = 自带菜谱（自己写的 / 整本买的 / 外卖平台同步的）：端进厨房前
  都先展开，厨房待遇一致。
- `/loop` 的特殊性 = 巡航按钮背后还要一整套闹钟系统：装按钮容易，装闹钟得改电路。
