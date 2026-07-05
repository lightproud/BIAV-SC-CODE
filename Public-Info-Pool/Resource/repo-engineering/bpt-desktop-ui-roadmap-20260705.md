# BPT Desktop UI 落地路线草案（M0–M4）

- **日期**：2026-07-05
- **定位**：银芯 → 黑池单向输出物，Desktop UI 参考线第四弹。前三弹回答「参考谁 / 长什么样 /
  怎么接」，本档回答「先建哪块、每步验收什么」。
- **前置阅读**：`bpt-desktop-ui-reference-20260704-r2.md`（许可证红绿灯 + 对接表 + 底座三层辨析）、
  `claude-desktop-ui-structure-20260704-r2.md`（Claude Desktop 结构规格 + 12 条设计模式）
- **假设声明（草案性质）**：本路线按通用假设排布——BPT Desktop 为 Electron/Node、已有一个
  开发不顺的自研 UI、目标是换 bpt-agent-sdk 引擎后重建可靠前端。**BPT 侧实际存量（哪些件已
  能跑、团队人力）会改变 M1/M2 内部顺序**，拿到现状输入后应出 r2 校准。

---

## 总原则

1. **每个里程碑以「可用」收口，不以「代码写完」收口**——验收项全部是用户可操作的行为。
2. **引擎先行、界面跟进**：M0 把 SDK 在主进程跑通并定死 IPC 契约，之后 UI 迭代不再碰引擎。
3. **窄启动、留位演进**：起步是单活动会话 + 会话列表（姊妹档案 §4 骨架）；「会话 = 一等资源」
  （规格档模式 1）作为演进方向在数据模型里预留，不在 M1 实现。
4. **反模式红线**（规格档模式 12）：任何新增工作面必须挂顶层导航同级、一步可返回。

## M0 地基：引擎接线 + IPC 契约（不出界面）

**做**：
- 主进程集成 bpt-agent-sdk（`npm pack` tarball 或私有 registry；接线范本
  `examples/electron-host.mjs`、迁移清单 `docs/MIGRATION.md`）
- 定死三条 IPC 通道契约：
  1. `query 流`：主进程迭代 `query()` 生成器 → 逐条 `SDKMessage` 推 renderer（含
     `stream_event` 细粒度流）；
  2. `控制`：renderer → 主进程的 `interrupt / setPermissionMode / setModel / streamInput / close`；
  3. `权限 RPC`：主进程 `canUseTool` 回调 → renderer 弹窗 → 用户决策回传（带 requestId
     关联与超时兜底，超时默认 deny）。
- 凭据只存主进程（安全存储），renderer 永不见 API key。
- adapter 层雏形：`SDKMessage` → UI 消息模型的纯函数 reducer（见参考档 §6.1 底座辨析）。

**验收**：无界面，用一个临时脚本经 IPC 发一句 prompt，能在日志里看到流式回包、
一次工具调用的权限询问往返、以及 `interrupt` 生效。

## M1 聊天核心：最小可信对话环

**做**（对接表行号见参考档 §5）：
- AppShell + 侧栏会话列表（`listSessions` / `resume` / `continue` / 改名 / 删除）
- 消息流：流式打字机（`stream_event`）、markdown 渲染、思考块折叠、工具调用卡
  （tool_use 挂起 → tool_result 填充）
- Composer：发送 / **停止**（interrupt）、附件、模型选择、**权限模式五档切换**
  （default / acceptEdits / plan / dontAsk / bypassPermissions——SDK 实有档位，无 auto）
- **权限弹窗**（canUseTool RPC）：允许 / 拒绝 + 入参展示——这是「可信」的核心件
- 错误与重试可见：`rate_limit_event` 倒计时条 / `api_retry` 状态条
- UI 组件底座选型在此里程碑定死（assistant-ui 或 AI Elements，adapter 成本见参考档 §6.1）

**验收**：日常真实使用一整天不需要打开 DevTools——对话、打断、换模式、看清每次
工具调用与权限询问、断网重试可见。

## M2 agent 透明化：把「它在干嘛」全部画出来

**做**：
- TodoWrite 任务清单件（三态列表）+ AskUserQuestion 选项卡（点选回流）
- 子代理任务卡（`task_*` 四事件，注意消息边界排空的时序特性）
- 转录密度三档（Normal / Verbose / Summary，纯前端过滤 `SDKMessage.type`——性价比最高的一件）
- 上下文压缩指示条（`compact_boundary`）+ 用量 / 成本仪表（`result.metrics`）
- 会话级权限审计列表（`permission_denials` 台账）

**验收**：跑一个含子代理 + 十次以上工具调用的长任务，用户全程不困惑：能说出它正在哪一步、
花了多少钱、哪些操作被拒过；切 Summary 档能一屏读完结果。

## M3 工程面：工具与环境的管理界

**做**：
- MCP 面板：server 状态灯（`mcpServerStatus`）+ 配置 CRUD（配置文件由宿主管理）
- 后台 shell 面板（`run_in_background` + BashOutput 增量 / KillShell；前端 xterm.js 级渲染可后置）
- 文件检查点回滚 UI（「改坏一键回」）
- 会话 fork / side-chat（`forkSession`——借上下文不回写主线，规格档模式 5）
- Hook 审计面板（`includeHookEvents`，可选开关）

**验收**：接一个真实 MCP server 全流程（配置 → 状态灯 → 工具调用 → 只读自动放行 /
非只读弹窗）；跑一个后台任务并中途击杀；一次误编辑经检查点回滚。

## M4 演进留位（不排期，按需启动）

- 会话 = 一等资源化（多会话并行 + 状态过滤侧栏，向规格档 §5.2 靠拢）
- pane 化工作区（dockview 类，MIT——装前复核）
- Artifacts 级产物只读预览面板（按模式 11 给「可编辑画布」留布局位，不实现）
- 计划模式专用视图、diff 审查面板
- 斜杠命令菜单（需自建命令注册表，SDK `supportedCommands()` 为静态空）

## 里程碑外的常备纪律

- 每合入一个绿区组件，按参考档 §7 留版权头与 NOTICE；
- 每个新 UI 件先查对接表有无现成 SDK 事件源，**没有数据源的件不做**（避免摆设件）；
- 顶层导航全程可达（模式 12），新工作面一律与主界面同级。

---

*本档为草案（假设声明见头部）。守密人回填 BPT 前端现状（能跑的件 / 人力 / 最痛的三个问题）后升 r2 校准。*
