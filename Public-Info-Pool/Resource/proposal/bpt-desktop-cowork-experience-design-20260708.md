# BPT Desktop Cowork 式体验设计（银芯侧情报 + 对接缝）

- **日期**：2026-07-08
- **类型**：proposal（产品体验设计情报）
- **定位**：银芯 → 黑池**单向输出物**（§1.1-HC 防火墙同向）。本档为银芯公开信息层产物，
  **不含任何黑池数据**；产品本体（BPT Desktop）在黑池侧构建，银芯只出**设计情报 + 对接缝**。
- **派发**：守密人 2026-07-08 会话，选定「BPT 体验朝 Cowork 前进——产品体验设计」层。
- **姊妹档案**（本档在此二者之上向前设计，不复刻其侦察）：
  - `Public-Info-Pool/Resource/repo-engineering/claude-desktop-ui-structure-20260704-r2.md`（Chat/Cowork/Code 三标签黑箱结构，§4 = Cowork 标签）
  - `Public-Info-Pool/Resource/repo-engineering/bpt-desktop-ui-reference-20260704-r2.md`（UI↔`SDKMessage` 对接表 + 许可证红绿灯）

---

## §0 边界声明：本档能回答什么、不能碰什么

「BPT 体验朝 Cowork」的**产品本体**（Electron UI、插件市场、账号面）在**黑池侧**，与 §1.1-HC
防火墙同向（银芯 → 黑池单向输出，黑池不回流）。银芯**碰不到产品本体**，能合法交付的只有两样：

1. **产品体验设计情报**——Cowork 式交互范式在 BPT 上应长成什么样（本档 §2、§5、§6）；
2. **对接缝**——该体验的每个面，由本仓 `projects/bpt-agent-sdk/` 的哪条原语/消息流支撑，
   哪些已发货、哪些是缺口（本档 §3、§4）。

> 小学生比喻：银芯是发动机厂，能画出「这台车该怎么开、油门刹车接在发动机哪个接口」的图纸，
> 但**车身在黑池那家总装厂里造**——图纸能寄过去，车银芯摸不着。

---

## §1 结论速览

1. **「朝 Cowork」的本质是加一种工作模型，不是改引擎**。Cowork = 「描述任务 → 审查计划 →
   放手执行 → 交付成品」的**异步任务委派**范式，与 Chat 的「逐步同步对话」并列。BPT 引擎
   （bpt-agent-sdk）**已具备支撑它的大半原语**——缺的是产品外壳与三四处 SDK 对接缝。
2. **MVP 几乎零 SDK 新代码**：Cowork 体验的地基（后台执行 / 跑完通知 / 计划门 / 会话续接 /
   成本可见）本 SDK **v0.4–v0.6 已发货**（§3 对接表）。BPT Desktop 侧铺 UI 即可起步。
3. **四处对接缝缺口是银芯侧可动手的真工作**（§4）：定时/调度原语、coordinator/teams 本体
   （Dispatch 自动派生子会话）、ExitPlanMode 工具（计划审批的干净信号）、通知面富化。
   这些正是 POSITIONING 里「推迟到 v0.6+」的产品面原语——若守密人要真做 Cowork，它们从
   「故意不追」升级为「按需补」。
4. **两条硬约束贯穿设计**：(a) 新工作面必须挂顶层导航同级、**进得去也一步出得来**（Claude
   Design「无返回键子世界」是官方反面教材）；(b) **别把「朝 Cowork」做成「追平官方 Cowork」**
   ——那是 POSITIONING §3 拒绝的「赢不了的跑步机」。

---

## §2 Cowork 心智模型 → BPT 落地形态

### §2.1 三种工作模型（官方壳的骨架）

官方 Claude Desktop 一壳三标签，本质是**三种工作模型共存**：

| 模型 | 标签 | 交付物 | BPT 现状对照 |
|------|------|--------|-------------|
| 同步对话 | Chat | 逐步对话回复 | BPT Desktop 现有形态（旧内核体验，即 POSITIONING 的「固定靶」）|
| **异步任务委派** | **Cowork** | **完成的工作成果**（直接落文件系统的文档/表格/演示）| **本档设计对象，空白** |
| 并行工程会话 | Code | 代码变更 + PR | 部分（BPT 编码用途）|

> 小学生比喻：Chat 是「站你旁边一问一答」，Cowork 是「把活儿交出去、你去忙别的、它干完把
> 成品放你桌上」，Code 是「专门开个工位改代码」。同一台电脑（壳）里三种干活方式。

### §2.2 BPT 该长成哪种形态（设计取舍）

**建议：起步不做满三标签，先在现有 BPT Desktop 内加一个「委派 / Cowork」工作面**，与现有对话面
顶层同级。理由：

- BPT 的固定靶是「旧编码内核体验」（Chat/Code 式），Cowork 是**净增第三种模型**，不是替换；
- 三标签是官方为庞大产品线做的信息架构，BPT 无需一步到位；
- 但**必须挂顶层导航**（§6 反面教材），不可塞成对话面里的一个隐藏模式。

**Cowork 面的最小骨架**（组件谱系可直接映射姊妹档 §4 的 AppShell，此处只列 Cowork 增量）：

```text
CoworkView（顶层导航同级）
├─ TaskComposer          描述任务（自然语言 + 附件 + 目标文件夹范围）
├─ PlanReviewCard        审查计划：agent 先出计划、用户批准/改/驳（→ §4 缺口 ExitPlanMode）
├─ RunTimeline           放手执行：后台跑，展示 task_* 生命周期 + 工具时间线
│  └─ ProgressBadge      turn N/M 进度（task_progress 真发射）
├─ DeliverableTray       交付成品：落盘文件的成品托盘（非逐条对话）
├─ PermissionModeToggle  双模式：Ask before acting / Act without asking
├─ ScheduledPanel        定时任务（→ §4 缺口：调度原语）
└─ DispatchStrip*        远程派单入口（手机续接同一会话；→ §4 缺口：coordinator）
```

---

## §3 体验 ↔ SDK 原语对接缝表（Cowork 特有面）

姊妹档 §5 已给通用聊天 UI 的对接表；本表**只补 Cowork 范式特有的面**，逐件对本 SDK 原语。
契约状态取自 `projects/bpt-agent-sdk/docs/COMPAT.md` 与 project-status「## BPT Agent SDK」。

| Cowork 体验面 | 支撑它的 SDK 原语 | 状态 |
|---------------|-------------------|------|
| 任务委派输入 | `query()` 初始 prompt + 流式输入 | ✅ 已发货 |
| **放手执行 / 后台跑** | Bash `run_in_background` + `BashOutput`/`KillShell`（每 query 一个 ShellManager，v0.5）| ✅ 已发货 |
| **跑完喊你（通知）** | `classifyBackgroundState`（后台转录尾判 working/blocked/done/failed → 通知门，v0.6，fail-safe 不伪造 blocked）+ 观测臂 `task_notification`（仅后台子代理，v0.4）| ✅ 已发货 |
| 看它干活（进度）| 观测臂 `task_started`/`task_progress`（turn N/M）/`task_updated`（终态 + 500 字预览），v0.4 真发射 | ✅ 已发货（注意消息边界排空，非毫秒实时）|
| 交付成品落盘 | Write/Edit 工具 + 文件检查点「一键回」（v0.2）| ✅ 已发货 |
| 权限双模式 | `permissionMode`：`acceptEdits`/`dontAsk`（≈Act without asking）vs `default`（≈Ask before acting）+ `canUseTool` 阻塞回调 | ✅ 已发货 |
| 永久删除始终需批 | 权限门 mandatory 政策（非只读工具不自动放行；v0.6 沙箱 escape 独立维度走 ask，fail-closed）| ✅ 已发货 |
| 跨设备续接同会话 | `sessions/` JSONL 存储 `resume`/`continue`/`forkSession`；或外部 `sessionStore` 接黑池自己的库 | ✅ 已发货（无 Claude Code 存储互通，BPT 场景无碍）|
| 会话自动命名 | `generateSessionTitle` / `generateTitleAndBranch`（v0.6，Haiku、temp 0）| ✅ 已发货 |
| 成本 / 效率可见 | `result.metrics`（perTurn/perTool/cacheHitRatio/成本，v0.3）| ✅ 已发货 |
| **计划审查（审查计划）** | `permissionMode:'plan'` 只读门**已实现**；但 **ExitPlanMode 工具缺席**（agent「计划就绪→请批」的干净信号面无原语）| ⚠ 半缺口（见 §4-③）|
| **定时任务（/schedule）** | **无调度原语**（循环/调度在 POSITIONING「推迟 v0.6+」，故意未追）| ✗ 缺口（见 §4-①）|
| **Dispatch 自动派生子会话** | subagent 运行时 + `WORKER_FORK_AGENT` preset 已发；**coordinator/teams 本体（O-B2）未发**、SendMessage 工具本体待建 | ⚠ 半缺口（见 §4-②）|
| 插件 / 连接器 / routines | **无官方 API**（上一轮已确认）——纯自建产品面 | ✗ 产品侧自建 |

> 小学生比喻：这张表就是「Cowork 这台车每个功能，接在发动机哪个现成接口上」。打 ✅ 的接口
> 都焊好了，插 UI 线就通电；打 ✗ / ⚠ 的是发动机上还没开的四个孔，得先钻孔（§4）。

---

## §4 SDK 侧对接缝缺口（银芯侧可动手的真工作）

以下四项是 Cowork 体验会撞上的 SDK 原语缺口。**它们在银芯侧**（`projects/bpt-agent-sdk/`），
即便产品本体在黑池侧，缝也得银芯焊。守密人若后续要真推 Cowork，这四项即工作清单：

- **① 调度 / 定时原语**（撑 `/schedule` 与周期任务）：现 SDK 无循环/调度层（POSITIONING §4
  「故意不追产品面大件 / 循环调度」）。Cowork 定时任务要么在**产品侧**（黑池 Electron 主进程
  用 OS 定时器 + SDK `resume` 重入会话）实现、SDK 只当被唤醒的执行器；要么 SDK 补一层薄调度
  原语。**建议走产品侧**——调度是宿主职责，SDK 保持「无常驻」纯净（与银芯「零常驻」一贯）。
  > 比喻：闹钟不该装进发动机里，装在车上定点打火就行。

- **② coordinator/teams 本体 + SendMessage**（撑 Dispatch 自动派生子会话）：`WORKER_FORK_AGENT`
  preset 与 fork 机制已发（v0.6 O-B0），但 coordinator preset **刻意未发**（依赖 SendMessage
  工具本体，标记 O-B2）。Dispatch「判定开发类任务→自动 spawn 一个 Code 子会话」正需这条。
  **这是银芯侧一等真工作项**（选「SDK 引擎原语」层时的头号候选）。

- **③ ExitPlanMode 工具**（撑计划审查的干净信号）：`permissionMode:'plan'` 只读门已实现，但
  ExitPlanMode 列在 project-status「T4 缺席工具（Monitor/Workflow/ExitPlanMode/EnterWorktree）」。
  没有它，agent 无法用官方语义发「计划已就绪、请批准执行」信号——PlanReviewCard 只能靠产品侧
  约定（如识别 plan 模式末轮文本）拼凑。**补 ExitPlanMode 是低成本高体验回报项**。

- **④ 通知面富化**（撑「跑完喊你」的多态通知）：`classifyBackgroundState` + `task_notification`
  已给「done/blocked」两类基本通知门，但 Cowork 的「需审批」「计划待批」「定时任务触发」等
  多态通知可能需扩通知语义面。**优先级低于 ①②③**，现有两态足够 MVP。

---

## §5 分阶段落地

| 阶段 | 内容 | SDK 依赖 |
|------|------|---------|
| **P0（MVP，几乎零 SDK 新代码）** | 加 CoworkView 顶层面：TaskComposer + RunTimeline（task_* 事件）+ DeliverableTray + 双模式 toggle + 后台执行 + 跑完通知 + 成本仪表 | 全部已发货（§3 打 ✅ 项）|
| **P1（补计划审查 + 派生）** | PlanReviewCard 走真 ExitPlanMode；Dispatch 自动派生子会话走 coordinator | 需 §4-②③（银芯侧补）|
| **P2（定时 + 远程 + 富通知）** | ScheduledPanel（宿主侧调度）+ 手机远程派单（宿主侧续接）+ 多态通知 | §4-①④ + 产品侧远程入口 |

**结论：Cowork 体验可以立刻起步（P0），不必等 SDK。** P1/P2 才触发 §4 的银芯侧补缝工作。

---

## §6 硬边界与反面教材

1. **§1.1-HC 防火墙**：产品本体、账号面、任何黑池数据均不进银芯；本档只出设计 + 对接缝。
2. **「无返回键子世界」反面教材**（Claude Design 并入桌面的社区批评）：新工作面**必须挂顶层
   导航同级，进得去也一步出得来**。宁可多一个标签，不可让用户掉进无返回键的子世界。
3. **别追平官方 Cowork**（POSITIONING §3）：官方 Cowork 是闭源快速移动目标，逐版追平是
   「赢不了的跑步机」。BPT 的 Cowork 只需**贴住「异步委派」这个工作模型的骨架**，加自己的
   主权特性（直连引擎、无子进程、可换 provider），不必逐像素复刻官方。
4. **许可证红绿灯不变**（姊妹档 §7）：Cowork UI 组件仍在绿区底座（AI Elements 的 Task /
   Plan / Confirmation 组件几乎一一对应本档 §2.2 骨架）上自建；红黄区只看不抄。

---

## §7 依赖与待守密人裁定

- **POSITIONING 固定靶重定义（前置依赖，非本轮任务）**：现 POSITIONING §1 的参照系是「禁令
  时点的旧编码内核体验」（Chat/Code 式）。真做 Cowork = **固定靶新增「异步委派」模型**。
  这是定位级扩张，建议守密人明裁后更新 `projects/bpt-agent-sdk/docs/POSITIONING.md`
  与 `memory/decisions.md`（决策档仅守密人可改）。本档先落设计、不代改定位。
- **产品本体归黑池**：CoworkView 的 Electron 实现、账号/订阅面在黑池侧，银芯止于本档 + §4 缝。
- **银芯侧后续可动手项**（守密人若加选「SDK 引擎原语」层）：§4-②（coordinator/teams + SendMessage）
  与 §4-③（ExitPlanMode）是最高回报的两项。
