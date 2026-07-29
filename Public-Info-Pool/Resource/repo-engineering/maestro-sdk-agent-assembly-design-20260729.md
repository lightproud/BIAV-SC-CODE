# Maestro SDK 第三轮设计审视：Agent SDK 装配与 BPT 介入面

- 日期：2026-07-29
- 审视人：艾瑞卡（守密人派发：「继续审视设计 Maestro SDK，让它能够基于 Agent SDK 实现 loop、例程、goal、后台任务（子代理和脚本），并给出 BPT 客户端介入的 UI 设计案例」）
- 状态：设计档，**裁定完毕**（本轮零 src 代码；裁1–裁5 + D2/D3/D4/D6/D7/D8 全部经守密人 2026-07-29 交互裁定，见 §12；实现另轮）
- 前两轮指针：`maestro-sdk-design-review-20260726.md`（F1–F6，问「写得对不对」，已全落地）· `maestro-sdk-product-review-20260726.md`（P1–P6，问「有没有人要」，已全裁定）
- 宪章：`scs-req-orchestrator-sdk-20260717.md`（三硬性质 / 判别式三维 / §7 非目标）；代理侧地基 `scs-req-repositioning-loop-support-20260717.md`（R1–R6）
- 随档样机：`maestro-sdk-bpt-intervention-ui-mockup-20260729.html`（可交互 HTML，§9 的活体演示）

---

## §0 本轮定位与输入

第一轮问「代码写得对不对」，第二轮问「作为产品是否成立」。第二轮的判词是：**一个被证明「造得出」、但只有一半被证明「有人要」的产品**——已验证三族（ledger / driver / scheduler）的两个消费方都在银芯仓内，实验面三族（goal / delivery / workflow）零真实调用点。

本轮问的是第三个问题：**实验面三族的真实需求已经出现，如何以最小新面接住。**

需求出现的证据链：

1. BPT Cowork 产品档（`bpt-cowork-product-design-20260713.md`）§6 能力三点名的任务生命周期（queued → planning → awaiting_confirm → running → delivered，↘revising↗ / ↘failed 可一键重试）、钉钉 webhook 送达、按计划分步执行——每一条都落在 Maestro 已建成但零消费的那三族里；
2. 守密人本轮指令把 loop / 例程 / goal / 后台任务四原语与「BPT 客户端介入 UI」并列——消费方与介入面第一次被同时点名；
3. BPT 侧已深度在产 agent SDK（options.goal / 记忆面 / MCP / AskUserQuestion），Maestro 接入极浅且曾因两包同名判词踩雷（decisions 2026-07-27「GoalVerdict 家族统一」）——缺的不是零件，是**从 agent SDK 到 Maestro 的装配图纸**。

本轮结论先行：**四原语中三个（loop / goal / 后台任务）的缺口收敛为同一件新零件——AgentExecutor 装配器；只有例程需要一个新管理面（RoutineManager）；Cowork 五态在现有六态封闭机上零新状态即可承载（唯一缺口是 `WorkflowNode` 缺确认门字段）。** 全部新面合计两个模块 + 两个字段级扩展，其余是装配谱系与投影约定——这是对 P2「零消费者维护税」教训的正面回应：不造新轮子，把已造的轮子装上车。

守密人已裁输入（2026-07-29 交互裁定，本档按已裁记档）：

| 裁 | 内容 |
|---|---|
| 裁1 | 设计档先行，本轮零 src 代码，裁定后另轮实现 |
| 裁2 | AgentExecutor 走**注入式**（宿主递 query 函数；maestro 零 import / 零运行时依赖现状不动；P1 不重开） |
| 裁3 | **Maestro 持数据面底座**：六态封闭机分毫不动，Cowork 五态为台账之上的投影层；确认门用现词汇 `manualClaim` + `claimSession` 表达；新增 `WorkflowNode.manualClaim` 字段 |
| 裁4 | 「例程」语义 = **定时例程原语**：Scheduler 之上的 RoutineManager 管理面（命名 / 停启 / 立即触发 / 下次触发点反查 / 列表） |
| 裁5 | UI 案例要更重：档内映射表之外另交付可交互 HTML 样机 |

---

## §1 判据对账筛

本档全部新提案先过宪章筛，再展开。判据 = 三硬性质（①库不是框架 ②无特权通道 ③数据面在 SDK、渲染在宿主）+ 判别式三维（活得比父调用久 / 等墙钟或外部事件 / 触发权）+ §7 五非目标 + 六态封闭裁定。

| 提案 | 硬性质① | 硬性质② | 硬性质③ | 判别式 | §7 非目标 | 六态封闭 |
|---|---|---|---|---|---|---|
| AgentExecutor（§3） | 通过：可单拿（不用则递自己的 executor，纯 HTTP 宿主零连带） | 通过：只消费 agent SDK 公开面（query 返回值迭代 + interrupt/close），宿主徒手可复刻每一行 | 通过：onMessage/onResult 只出数据 | 通过：它本身活在一次 attempt 内，但它是「跨调用状态」的执行座位填充物——属宪章 §1「会话装配」职责 | 通过：不管 query 内部（子代理消息只转发不解释） | 不触碰 |
| RoutineManager（§5） | 通过：不用则直接用 Scheduler | 通过：纯台账反查 + Scheduler 组合 | 通过：list()/get() 返回数据，渲染宿主侧 | 通过：等墙钟（第二维） | **边界句**：`name` / `nextFireAt` / `list` 是数据出缝；若未来有人提「Routine 面板组件」即越「不做界面显示」线，当场拒绝 | 不触碰 |
| `WorkflowNode.manualClaim`（§8） | 通过：可选字段，缺省行为逐字节不变 | 通过：纯台账词汇（dispatch runAt:null 已存在，delivery 已在用） | 通过 | 通过：等外部事件（人的确认，第二维） | 通过 | 不触碰（复用既有 manualClaim 语义，零新状态零新边） |
| `QueryRecord.costUsd?`（§3.4，已裁 D2） | 通过 | 通过：值由宿主经 onResult 侧递入或 executor 填报，SDK 不算价 | 通过 | 通过：跨场景查询面通用维度（宪章 §4） | 通过 | 不触碰状态集；**触碰记录形状**——0.79.0 加可选字段有先例，已单列裁定（D2 取甲） |
| `docs/ASSEMBLY.md` + `examples/agent-loop.mjs`（§4） | 通过：文档与例程，零运行时面 | 通过：例程只准 import 两包公开面（宪章 §6 铁律） | 通过 | 不适用 | 通过 | 不触碰 |
| Cowork 五态投影表（§8） | 不适用：**文档约定，非 SDK 代码**——投影发生在宿主渲染层 | 通过 | 通过：这正是「数据面在 SDK、渲染在宿主」的教科书应用 | 不适用 | 通过：投影表不是界面实现 | 不触碰 |

全表零红格。与 Cowork 产品档「状态机由产品层持有」一句的关系：该句出自产品档自陈的**建议性推测部分**（作者受防火墙约束看不到黑池代码，仅 §5 界面规格是规范性的）；裁3 定为 Maestro 持数据面底座后，产品层持有的是**投影与渲染**，不是第二套状态账——跨会话审计只有一处真相源。

---

## §2 四原语需求矩阵

| 原语 | 需求（源） | 现有六族映射 | 缺口 | 新零件 |
|---|---|---|---|---|
| **loop** | 周期轮询 + 预算帽 + 跨重启恢复，长在台账上（宪章 §3）；BPT 值班任务无人值守常驻（R1–R6 背景注） | Scheduler（定点 + 补偿 + 恢复）+ LedgerDriver（持钟执行 + 重试 + 超时）+ TaskLedger（跨重启状态）——**机制已齐**，store-patrol / testbed daemon 两个已验证消费方即活证 | executor 座位至今只被纯 HTTP / 假执行器填过；「基于 Agent SDK 的 loop」缺的是把 query() 装进座位的那只手 | **AgentExecutor**（§3）；不建 LoopRunner（§4，待裁 D3） |
| **例程** | 可管理的值班任务：命名、停启、立即触发、下次触发点反查、列表（裁4；BPT 收件箱「值班例程区」数据源） | Scheduler 有 spec 与恢复，但管理面为零：停启要重建实例，触发点反查要自己算，「跑过没有、跑成没成」要自己扫台账 | 管理面整体缺失 | **RoutineManager**（§5） |
| **goal** | 跨会话目标循环：引擎 goal 管一次 query 内达标，跨 query 重发起归编排（宪章 §3）；BPT 07-27 实测踩过「接了 Maestro 却没接 GoalChaser」的空档 | GoalChaser 完整在册（轮 = 会话、resume 扫描、abort 缝、判词校验 1.3.0 已补） | 零真实消费方的根因同 loop：executor 座位没有 agent 装配件，GoalChaser 派发的轮会话没人会跑；另缺「介入动作 → 现词汇」的对照表 | AgentExecutor 复用（`extractGoalRound` 提取器）+ §6 介入映射（**零新 API**） |
| **后台任务**（子代理和脚本） | 后台任务追踪 + 派发 + 介入（宪章 §3 首战；守密人指令点名「子代理和脚本」两形态） | 台账六族全套；脚本任务 = store-patrol 模式已验证；**query 内子代理 = 引擎领地**（宪章 §7「不管 query 内部」，Task 嵌套 / run_in_background / task_* 观测消息俱在引擎） | 子代理的 task_* 观测消息目前死在 query 消息流里，没有约定的过河通道给宿主 UI；三类任务在 UI 上如何统一呈现无映射原则 | AgentExecutor 的 `onMessage` 观测缝（§3.3）+ §7 三层呈现原则（**零新模块**） |

收敛判定：矩阵四行里三行的「新零件」列指向同一件东西。这不是巧合——**loop / goal / 后台 agent 任务的差异全在派发侧（谁造会话：Scheduler / GoalChaser / 宿主），执行侧是同一个座位**。座位只需要填一次。

---

## §3 AgentExecutor 装配零件（本档核心）

### 3.1 接入形态（已裁：裁2 注入式）

裁定前呈过的三案与取舍，记档备审计：

| 维度 | 甲 注入式（宿主递 query 函数）【已裁】 | 乙 可选子路径导出 | 丙 直接 import（裸标识符） |
|---|---|---|---|
| P1 裁定（0.78.1 删 peerDependency） | 兼容——零 import 现状不动，README「本包不声明对代理 SDK 依赖」承诺不破 | 需恢复 `peerDependenciesMeta.optional`，P1 评过 optional 案且守密人取删除案，等于翻案 | 必须重开 P1：可执行 import 出现即须恢复依赖声明 |
| 硬性质①（零件可单拿） | 纯 HTTP 宿主（store-patrol）装本包依旧零连带 | 主入口零连带、子路径连带 | 每个消费方连带 agent SDK 整包 |
| 类型对齐 | 结构化类型 + **GoalVerdict 逐字重声明先例**（agent 侧 `subsystems.ts` 明注 maestro re-declares verbatim, no cross-package import） | 同丙 | 直引无漂移，但代价见上两行 |
| 维护面 | 重声明最小 `AgentQueryHandle` 形状，靠锁步钟 + 家族级形状裁定看住 | 双入口双维护 | 单一 |

裁2 取甲。补一条定位澄清：**宪章 §1 的「会话装配」职责由「把宿主递来的 query 装进 Executor 座位」兑现——装配的是形状，不是包。** CI `check-dep-direction.mjs` 四条规则零改动。

### 3.2 API 草图

```ts
// src/assembly/agent-executor.ts —— 新模块族 assembly（第七族；落地首日为「已交付」级，
// 实验面标注 + 去标路径见 §10）

/**
 * 与 agent SDK Query 结构兼容的最小形状。逐字重声明、不跨包 import
 * （GoalVerdict 同款纪律，硬性质②与依赖单向共同要求）；改形状须家族级裁定。
 * query() 的真实返回值（Query）结构上超集于此形状，宿主直接递入即可。
 */
export interface AgentQueryHandle extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>;
  close(): void;
}
export type AgentQueryFn = (args: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AgentQueryHandle;

/** session.payload 内的执行请求约定（数据面 schema；由 Scheduler payload.data、
 *  GoalRoundPayload 适配或宿主直书）。 */
export interface AgentRunRequest {
  prompt: string;
  /** 逐字透传 agent SDK options（model / mcpServers / goal / permissionMode ...）。 */
  options?: Record<string, unknown>;
  /** agent 侧会话 id；设置则并入 options.resume（续接语义，见 3.5）。 */
  resume?: string;
  /** 并入 options.maxBudgetUsd（单次 attempt 的预算帽，引擎 R2 事件流执法）。 */
  maxBudgetUsd?: number;
}
export interface AgentRunPayload { agent: AgentRunRequest; }

export interface AgentRunResult {
  /** 折叠后的终局：'ok' | 'error'（超时由驱动器自己的 timedOut 旗落 'timeout'，
   *  executor 不分辨）。 */
  outcome: 'ok' | 'error';
  /** result 消息原文的规范化摘录：error_code / providerError 优先，无则消息文本。 */
  error?: string;
  summary?: string;
  /** agent 侧会话 id（宿主续接 / getSessionAccounting 的钥匙）。 */
  agentSessionId?: string;
  /** result 消息报告的单次 query 成本（估算口径，SDK 不算价只转录）。 */
  costUsd?: number;
  /** result 消息原对象，供宿主取 usage / structured_output 等富数据。 */
  raw?: unknown;
}

export interface AgentExecutorOptions {
  /** 注入缝（唯一必填）：宿主递 silver-core-agent-sdk 的 query（或任何同形函数）。 */
  query: AgentQueryFn;
  /**
   * payload → 请求提取器。缺省 = extractPlainAgent（读 payload.agent，
   * 兼容 Scheduler 信封 payload.data.agent）。返回 null = fail-loud：
   * executor 直接返回 error 结果，不空转烧 attempt。
   */
  extract?: (session: SessionRecord) => AgentRunRequest | null;
  /** 消息流观测缝：query 吐出的每条消息（含 task_started / task_progress /
   *  task_updated / task_notification 子代理四件）原样过河给宿主 UI 实时区。
   *  回调异常吞掉（驱动器 onEvent 同款纪律）。 */
  onMessage?: (session: SessionRecord, message: unknown) => void;
  /** 结果观测缝：AgentRunResult 富数据出缝，由宿主选择持久化（costUsd 入账
   *  路线见 3.4 / D2）。 */
  onResult?: (session: SessionRecord, result: AgentRunResult) => void;
  /** abort 后的收尾宽限：signal 触发先 interrupt()（礼貌停），宽限内未终结
   *  则 close()（硬停）。默认 5000。依注入 Clock 计时（零裸全局钟纪律）。 */
  interruptGraceMs?: number;
  clock?: Clock;
}

/** 返回一个可直接放进 LedgerDriverOptions.executor 座位的执行器。 */
export function createAgentExecutor(opts: AgentExecutorOptions): Executor;

/** 具名提取器三件（与三个派发方对应）。 */
export function extractPlainAgent(session: SessionRecord): AgentRunRequest | null;
export function extractGoalRound(
  format: (p: GoalRoundPayload, session: SessionRecord) => AgentRunRequest,
): (session: SessionRecord) => AgentRunRequest | null;
export function extractWorkflowNode(session: SessionRecord): AgentRunRequest | null;
```

### 3.3 行为规格

1. **组装**：`extract(session)` 得请求；options 合成序 = 透传 `options` ← `resume` 并入 ← `maxBudgetUsd` 并入（后并入者覆写同名键）。`extract` 返回 null → 立即 `{ outcome: 'error', error: 'session payload carries no agent run request' }`——错误可见地落台账走正常重试路径，绝不静默吞（bpt-loop-goal 发货注三条纪律之一：静默透传是当年 /loop 缺口的病根）。
2. **折叠**：迭代消息流至终结。终局 result 消息 `subtype === 'success'` → `outcome: 'ok'`，`summary` = 结果文本截断（上限进实现期定数）+ 成本一行；其余 subtype → `'error'`，`error` 取 `error_code` / `providerError` 规范化文本（agent SDK 已提供稳定机器码，不做字符串匹配）。**流中途抛出 → 任由其抛**：驱动器契约「executor 拒绝记 error、驱动器永不因 executor 崩溃」已覆盖（driver.ts 注释明文），不重复包一层。
3. **中止桥接**：`ctx.signal` abort → `handle.interrupt()`；`interruptGraceMs` 内消息流未终结 → `handle.close()`；随后返回 `'error'` 结果。**超时情形驱动器自己落 `'timeout'`**（`queryTimeoutMs` 到点即 abort signal + timedOut 旗），executor 不区分「谁按的停」——这保持了 Executor 契约的既有分工：signal 语义属驱动器。
4. **观测过河**：每条消息先递 `onMessage` 再入折叠逻辑。子代理 task_* 四件由此到达宿主 UI 实时区——**引擎领地不被跨越**（消息是引擎公开流的转发，不是对 query 内部的干预），宪章 §7「不管 query 内部」无损。
5. **禁做清单**：不在 executor 内重试（重试是台账状态机的事）；不在 executor 内持墙钟做周期（钟在驱动器与调度器）；不解释 prompt 文本（斜杠已永久退出引擎，编排层同样不碰）。

### 3.4 成本记账（已裁 D2：取甲，加字段）

- 甲【已裁】：`QueryRecord` 增可选 `costUsd?: number`，`OutcomeInput` 对应增可选入参。理由：成本是宪章 §4「查询面跨场景通用」的通用维度（在跑什么、挂了什么、**花了多少**），BPT 收件箱与周报都要按会话汇总成本；跨 attempt 累计 = Σ listQueries，跨修订链累计 = 沿 reopenChain 再 Σ——全在查询面一次算清。0.79.0（reopenOf / attemptRound）有加可选字段先例，状态集与事件集零触碰。
- 乙：不动 schema，成本只走 `onResult` 缝由宿主自记。代价：每个宿主重建一套成本账（P3 转嫁教训重演），且台账查询面自身答不了「这条链花了多少」。

### 3.5 跨 attempt 自动 resume：刻意不做（已裁 D6：不做）

重试的语义是**重跑**（幂等假设），不是**续聊**。若 executor 在 attempt 2 自动带上 attempt 1 的 agentSessionId 续接，会得到「半份上下文 + 半份重跑」的杂交语义，且台账无法审计两次 attempt 的边界。恢复语义由宿主显式表达：`reopenSession(id, { payload: { agent: { ...原请求, resume: 上次的 agentSessionId } } })`——重开链（T67 甲案）本就是「显式续命」的正门。`AgentRunResult.agentSessionId` 经 `onResult` 出缝正是为此准备的钥匙。

### 3.6 双层 goal 分工表（防混用，07-27 事故的正面防护）

| | 引擎侧 `options.goal`（agent SDK） | 编排侧 GoalChaser（Maestro） |
|---|---|---|
| 管辖 | **一次 query 内**达标：Stop 门拦截、裁判反馈注回、impossible 逃生、maxBlocks 帽 | **跨 query 轮次**：每轮一个台账会话，轮间反馈经 GoalRoundPayload.feedback 传递 |
| 判词 | `{ status: 'achieved' \| 'not_achieved' \| 'impossible', reason? }`（家族正典） | 同形逐字重声明；GoalChaser 1.3.0 起入口校验，malformed 直接抛 |
| 失败方向 | fail-open（坏法官绝不困死 agent；拦停是它的危险动作） | fail-loud（malformed 抛 TypeError；续轮是它的危险动作——方向相反是刻意的，chaser.ts 注释明文） |
| 一个 evaluator 两处服役 | 可以：判词同形（0.83.0 统一的目的）。但**「内层达标 ≠ 外层达标」**：内层问「这次 query 把活干完没」，外层问「目标整体达成没」。evaluator 语义按缝位写清，不共用一段含混措辞 | 同左 |
| 叠加装配 | `AgentRunRequest.options.goal` 透传即得内层门 | GoalChaser 派轮 + AgentExecutor(extractGoalRound) 跑轮 |

---

## §4 loop 骨架：组合即 loop（已裁 D3：不建 LoopRunner）

宪章 §3 写了「loop 骨架：周期轮询 + 预算帽 + 跨重启恢复，长在台账上」，但实现从未出现同名模块——它一直是例程里的宿主装配代码。本轮判定这**不是漏项，是正确答案**，理由三条：

1. 两个「已验证」消费方（store-patrol / testbed daemon）都是徒手三件套（Scheduler + LedgerDriver + executor）组合成 loop 的——组合面无漏缝的活体证明已存在两个；
2. 建 LoopRunner 落地首日就是第七个零真实消费方模块，正面重蹈 P2「零消费者维护税」判词；
3. 骨架一旦持有装配意见（默认 pollIntervalMs、默认预算策略），就开始违反硬性质①「宿主持有 main()」。

替代交付两件（实现轮落地）：

- **`docs/ASSEMBLY.md`**（本包第三份 docs）：四原语各一节接线谱——loop（Scheduler + Driver + AgentExecutor）、例程（RoutineManager + Driver）、goal（GoalChaser + Driver + extractGoalRound）、后台任务（三层呈现 + 介入动作表）。同时吸收 README「宿主必须自己决定的三件事」，向 T68 遗留的 OPERATIONS.md 靠拢或合并（实现轮酌定）。
- **`examples/agent-loop.mjs`**（第五份例程）：把 memory-tidy 例程的 executor 座位换成 `createAgentExecutor` 的最小演示；宪章 §6 铁律照守（只准 import 两包公开面）——**这份例程同时是注入式接法的活体证明**：例程写得出来 = AgentQueryHandle 形状面无漏缝。

配套（已裁 D8：补注，实现轮随 PR 落宪章）：宪章 §3「loop 骨架」条加覆盖注——「loop 骨架 = 组合谱系文档（ASSEMBLY.md），不建同名模块；2026-07-29 第三轮审视裁定」。

---

## §5 RoutineManager：定时例程管理面（裁4 已定语义）

### 5.1 缺口的精确形状

Scheduler 是**派发器**，不是**管理面**：spec 列表构造期锁死（停启一条例程 = 整实例重建）；「下次几点跑」要宿主自己拿 nextFireAt 算并先答对「上次跑到哪」；「最近一次跑成没成」要宿主自己格式化 session id 去台账扫。BPT 收件箱「值班例程区」需要的恰是这四问的现成答案。

### 5.2 API 草图

```ts
// src/routine/manager.ts —— 新模块族 routine（第八族；「已交付」级，去标路径见 §10）

export interface RoutineSpec extends ScheduleSpec {
  /** 人类可读名（数据面字段，渲染宿主侧——与 intent 同款定位）。 */
  name?: string;
}

export interface RoutineStatus {
  spec: RoutineSpec;
  enabled: boolean;
  /** 台账足迹反查的最近触发点（正点 + 手动皆计入）；无足迹 = null。 */
  lastFireAt: number | null;
  /** nextFireAt(spec, max(lastFireAt, now))；disabled 时为 null。 */
  nextFireAt: number | null;
  /** 最近一次触发的会话记录（state / lastError / attempts 供收件箱直读）。 */
  lastSession: SessionRecord | null;
}

export type RoutineEvent =
  | { type: 'routine:enabled' | 'routine:disabled'; routineId: string }
  | { type: 'routine:manual-fire'; routineId: string; sessionId: string; firedAt: number }
  | { type: 'schedule:fire'; specId: string; fireAt: number; sessionId: string }   // 透传
  | { type: 'schedule:error'; error: unknown };                                    // 透传

export interface RoutineManagerOptions {
  ledger: TaskLedger;
  routines: readonly RoutineSpec[];
  /** 初始停用表。运行期翻转经 RoutineEvent 出缝，宿主自行持久化
   *  （v1 无 RoutineStore，见 5.3 / D4）。 */
  initiallyDisabled?: readonly string[];
  clock?: Clock;
  pollIntervalMs?: number;
  seedFirstRun?: boolean;
  onEvent?: (event: RoutineEvent) => void;
}

export class RoutineManager {
  constructor(opts: RoutineManagerOptions);
  start(): void;
  stop(): Promise<void>;
  isRunning(): boolean;
  enable(id: string): void;
  disable(id: string): void;
  /**
   * 立即触发一次：绕过节拍直接派发。幂等键 `manual:{id}:{firedAt}`——
   * 独立前缀是硬约束：绝不可落 `sched:` 前缀，否则 Scheduler 恢复扫描会把
   * 该点当正点足迹、移动补偿窗口、吞掉窗内本应补的正点（#recover 按前缀 +
   * 数字后缀重建 lastFired）。同毫秒重复调用命中台账 DuplicateSessionError，
   * 复用 adopt-don't-crash 语义防双击。payload 信封与正点同构：
   * { schedule: { specId, fireAt: firedAt, manual: true }, data }。
   */
  triggerNow(id: string, opts?: { payload?: unknown }): Promise<SessionRecord>;
  list(): Promise<RoutineStatus[]>;
  get(id: string): Promise<RoutineStatus | null>;
}
```

### 5.3 设计要点

- **内部持一个 Scheduler**（specs = enabled 子集）。enable/disable = `stop()` → 以新子集重建 → `start()`：Scheduler 轮询无状态、足迹在台账、generation 纪律现成，重建零代价——不给 Scheduler 加热改缝（改一处不如包一层）。
- **`lastFireAt` 反查须与 Scheduler 恢复共用同一解析**：`#recover` 的足迹解析（前缀匹配 + 严格数字后缀 + 8.64e15 上界三重防御）是审计 r2/r4/r5 逐条打磨过的私有逻辑；RoutineManager 若自行复刻即造出第二份会漂移的解析。实现轮把它抽为 `schedule/spec.ts` 导出纯函数（如 `latestFirePoint(sessionIds, specId)`，同时识别 `sched:` 与 `manual:` 前缀——manual 计入 lastFireAt 展示，但 Scheduler 恢复仍只认 `sched:`，两侧消费同一函数不同前缀集）。这也是把 F3 附带发现的全表扫成本**顺手收口**的机会：解析函数以 id 集合为入参，扫描策略（全表 / 前缀过滤）由调用方决定，实现轮可一并评估 `listSessions` 前缀过滤缝（不在本轮射程，如实挂账）。
- **停启状态存哪（已裁 D4：取丙，纯内存）**：甲 复用 LedgerStore（否——Routine 不是 session，硬塞进会话表是语义污染）；乙 新 RoutineStore 注入缝（会复制 P3 债：每宿主再手写一份易错 store，而全部状态只有一张 enabled 表）；丙【已裁】纯内存 + `initiallyDisabled` 入参 + 事件出缝，持久化归宿主（BPT 有 DB，例程一行 JSON；「库不是框架」的最小案）。
- `RoutineSpec.name` 沿用 ScheduleSpec 的 id 纪律（不含冒号的约束在 id，name 自由文本）。

---

## §6 goal 跨会话装配与介入

### 6.1 装配谱

```ts
const ledger = new TaskLedger({ store });
const driver = new LedgerDriver({
  ledger,
  executor: createAgentExecutor({
    query,                                  // 宿主 import 自 silver-core-agent-sdk
    extract: extractGoalRound((p) => ({
      prompt: [
        p.goal.description,
        p.feedback === null ? '' : `上一轮未达标的裁判意见：${p.feedback}`,
        `（第 ${p.round} 轮）`,
      ].join('\n'),
      options: { model, maxTurns, goal: innerGoalConfig /* 可选内层门 */ },
    })),
    onMessage: uiRelay, onResult: costSink,
  }),
  maxConcurrent: 1,
});
driver.start();
const chaser = new GoalChaser({ ledger, evaluator, drainTimeoutMs, onEvent: uiRelay });
const result = await chaser.chase(
  { id: 'weekly-report', description: '…', maxRounds: 5 },
  { signal: abort.signal },
);
```

### 6.2 介入缝：全部现词汇，零新 API

| 介入动作 | 现词汇表达 | 语义依据 |
|---|---|---|
| 中止整个追逐（放弃但可回头） | `AbortController.abort()`（chase 的 opts.signal） | F4 已落地：轮记录留在台账，同 goal id 的下一次 chase 从 resume 扫描接续 |
| 终止追逐（永久，不再回头） | `cancelSession(goalRoundSessionId(id, 当前轮))` | 0.78.0 语义：cancelled 轮 settle 整个 chase（action 'cancelled'）且不问 evaluator |
| 调 maxRounds | abort → 以新 `maxRounds` 重新 `chase()` | resume 契约：既有轮原样保留，从中断处续 |
| 注入人工指导语 | evaluator 是宿主函数：人工意见在宿主侧合入下一轮 verdict.reason | 数据面在 SDK、判词内容在宿主——goal 语义本就只活在 payload 与 evaluator 里 |
| 观察轮次进展 | `onEvent`（goal:round / goal:settled）+ 台账查询面（intent = `goal:{id}`） | 观测缝既有 |

---

## §7 后台任务三层统一呈现

守密人指令点名「子代理和脚本」。加上 agent 会话任务，共三层——**归属由判别式三维机械判定，UI 不发明第二套生命周期**：

| 层 | 领地 | 生命周期 | 观测通道 | 停止动作 | 收件箱 |
|---|---|---|---|---|---|
| query 内子代理（Agent 工具，含 run_in_background） | 引擎（宪章 §7「不管 query 内部」） | 活不过父 query | task_started / task_progress / task_updated / task_notification 经 AgentExecutor.onMessage 过河 → **详情页实时区** | `Query.stopTask(taskId)`（宿主对 query 句柄直调） | **不进**——它不是台账会话，进了就是第二真相源 |
| 跨会话 agent 任务 | Maestro | 台账六态 | DriverEvent + 台账查询面 | `cancelSession(id)` | 进（真相源） |
| 脚本任务（纯 HTTP / shell executor，store-patrol 模式） | Maestro | 台账六态 | 同上 | 同上 | 进；与 agent 任务的呈现差异走 intent 词汇约定（如 `patrol:` / `agent:` 前缀族），不加类型字段 |

映射原则一句话：**台账是收件箱的唯一真相源；引擎内子代理只进详情页实时区。** 引擎侧 `background_tasks_changed` 不发射、Monitor 无 push——这不构成缺口：收件箱数据源本就不该是引擎消息流，而是台账轮询/查询（BPT 侧按其既有节拍拉取）。

---

## §8 Cowork 五态投影表（实验面三族的真实需求接口）

裁3 已定：六态封闭机分毫不动，Cowork 生命周期是台账之上的**投影**。载体 = workflow 图（图即数据，宪章 §3）：`plan 节点 → 确认门节点 → execute 节点（可扇出）→ deliver 节点`。

### 8.1 新零件：`WorkflowNode.manualClaim`（裁3 附带已定，实现轮落地）

现状核实：`dispatch({ runAt: null })` 即 manualClaim 会话（`nextRunAt` 恒 null、claimDue 永不认领、claimSession 唯一启动路径且竞态安全——delivery 通道已在用此语义）；但 `WorkflowNode` 无此字段、`WorkflowRun.#dispatchNode` 不传 runAt——**图内节点无法以确认门形态派发**。提案：

```ts
export interface WorkflowNode {
  id: string;
  intent: string;
  payload?: unknown;
  deps?: string[];
  maxAttempts?: number;
  /** true = 以 runAt: null 派发：节点就绪后停在 pending+manualClaim，
   *  等宿主 claimSession（人的确认）才进入执行。缺省行为逐字节不变。 */
  manualClaim?: true;
}
```

`readyNodes` / `graphStatus` 纯核零改动（确认门节点在图上就是一个「已派发未终态」的普通节点）；声明式加载层（loadWorkflowGraphFile）同步认识该字段。零新状态、零新边、零新事件。

### 8.2 投影表

| Cowork 态（产品档 §6） | 台账词汇投影 | 备注 |
|---|---|---|
| queued | plan 节点 `pending`（已派发未认领） | |
| planning | plan 节点 `running` / `retrying` | 重试细分由 UI 徽标承担，投影不区分 |
| awaiting_confirm | **确认门节点 `pending` + `manualClaim: true`** | 零新状态的关键一格 |
| running | execute 节点 `running` / `retrying`（扇出时任一） | |
| delivered | 末节点 `done`，交付动作 = `createDeliveryChannel` 推钉钉 sink（宿主注入 webhook） | **delivery 族由此获得首个真实消费方**（§10） |
| revising | plan 节点 reopen 链：`reopenSession(planNode, { payload: 携用户修改意见 })`，`attemptRound` 即修订轮数 | T67 甲案直接复用；`reopenSession` 支持 runAt 入参，修订后可重挂确认门 |
| failed | 任一节点 `failed`（fail-fast 收束整图） | 「一键重试」= `reopenSession`（cancelled 前驱需 `force: true`，UI 应二次确认） |
| （产品档未列） | `cancelled` | 已裁 D7：UI 单列「已取消」，不并入 failed——0.76.0 裁定 cancelled 是与 failed 可区分的一等终局，投影层不得把它抹回去 |

- 确认动作 = 宿主 `claimSession(gateId)` → 立即 `recordOutcome({ outcome: 'ok', summary: '守密人确认' })`——确认门的 executor 是人。
- 拒绝 = `cancelSession(gateId, { reason: 'user-rejected' })` → fail-fast 收束整图。
- 确认超时（用户一周不理）：现词汇 = 宿主定时 `cancelSession`；不加自动过期缝（诚实标注：这是宿主责任，SDK 不持这口钟的理由与「台账只增不减」同款——策略性决定归宿主）。

### 8.3 对「状态机由产品层持有」的正面回应

产品档该句成立的部分被保留：**产品层持有投影规则与渲染**（哪个节点算 plan、徽标怎么画、钉钉话术）。被修正的部分：**跨会话状态的账本只有一处**——否则收件箱态与台账态迟早分叉，审计断在两套账之间。银芯已建成的零件不该被黑池重造一遍，这正是产品审视起点二两个相反处置里「升级」的那一个，本档以最小新面（一个字段）兑现它。

---

## §9 BPT 介入 UI 案例

规范衔接：页面骨架与五卡片沿 Cowork 产品档 §5（三页面：任务收件箱 / 任务详情页 / 创建任务流；五卡片：计划 / 进度 / 变更 diff / 交付 / 错误）。本节只补**介入面**——§5 没有覆盖的「人对运行中系统下手」的那一层。可交互样机见随档 `maestro-sdk-bpt-intervention-ui-mockup-20260729.html`（每个介入按钮点击即显对应 SDK 调用，样机即映射表的活体演示）。

### 9.1 文字线框

```
┌ 任务收件箱 ────────────────────────────────┐
│ [值班例程区]                                │
│  每日商店巡检     下次 14:32 后(2h13m)  [开] [立即巡检] │
│  记忆整理(做梦)   下次 03:00           [开] [立即执行] │
│  社区周报         已停用                [关] [立即执行] │
│ ──────────────────────────────────────── │
│ [任务流]  进行中(2) | 待确认(1) | 已收尾(12)  │
│  ◆ 周报生成 goal 第2/5轮   running   [详情] │
│  ◆ 竞品分析     awaiting_confirm  [去确认] │
│  ◆ 商店巡检 07-29  delivered              │
└────────────────────────────────────────┘

┌ 任务详情页：竞品分析 ────────────────────────┐
│ 步骤时间线: 计划(done) → 确认门(待确认) → 执行 → 交付 │
│ [确认卡]  计划共4步…    [确认] [修改计划] [全部拒绝] │
│ [子代理实时区] (task_* 消息流，仅运行中显示)       │
│ [介入动作条] [取消任务] [一键重试] [中止追逐]        │
│ [成本行] 本任务累计 $0.83 (3 次查询)              │
└────────────────────────────────────────┘
```

### 9.2 「UI 动作 → SDK 调用」映射表

| # | UI 动作 | 具体调用（m = maestro，a = agent SDK，宿主 = BPT 自持） | 备注 |
|---|---|---|---|
| 1 | 暂停 / 恢复例程 | m `RoutineManager.disable(id)` / `enable(id)` | enabled 表宿主持久化（D4 丙） |
| 2 | 立即巡检 / 立即执行 | m `RoutineManager.triggerNow(id)` | 幂等键 `manual:{id}:{firedAt}`，双击安全 |
| 3 | 下次触发倒计时 | m `RoutineManager.list()` → `nextFireAt` | disabled 显示「已停用」 |
| 4 | 例程最近一次结果徽标 | m `RoutineStatus.lastSession.state` / `lastError` | |
| 5 | 收件箱任务流 | m `ledger.listSessions(filter)` + §8 投影表 | 台账 = 唯一真相源 |
| 6 | 确认计划 | m `ledger.claimSession(gateId)` → `recordOutcome({ outcome: 'ok' })` | 确认门 executor 是人 |
| 7 | 修改计划（revising） | m `ledger.reopenSession(planNodeId, { payload: 携用户意见 })` | attemptRound = 修订轮数 |
| 8 | 全部拒绝 | m `ledger.cancelSession(gateId, { reason: 'user-rejected' })` | fail-fast 收束整图 |
| 9 | 取消运行中任务 | m `ledger.cancelSession(id, { reason: 'user' })` | 一等终局，永不自动重跑 |
| 10 | 一键重试 | m `ledger.reopenSession(id)`；cancelled 前驱须 `force: true` | UI 对 force 路径二次确认 |
| 11 | 中止 goal 追逐（可回头） | 宿主 `AbortController.abort()`（chase opts.signal） | 轮记录保留，可续 |
| 12 | 终止 goal 追逐（永久） | m `ledger.cancelSession(goalRoundSessionId(id, n))` | chase settle 'cancelled' |
| 13 | 查看子代理进度 | AgentExecutor `onMessage` 过河的 `task_progress` 等渲染 | 详情页实时区，不进收件箱 |
| 14 | 停掉某个后台子代理 | a `Query.stopTask(taskId)`（宿主持 query 句柄时） | 引擎领地 |
| 15 | 查任务成本 | m `ledger.listQueries(id)` → Σ `costUsd`（D2 甲）；或宿主 a `getSessionAccounting(agentSessionId)` | 链上累计沿 reopenChain 再 Σ |
| 16 | 交付通知（钉钉） | m `createDeliveryChannel({ ledger, sink: 钉钉 webhook }).deliver(msg)` | 审计先行，sink 失败落回执不抛 |
| 17 | 运行中调预算 | **不可用**——引擎无此缝（诚实标注） | 预算在创建时 `payload.agent.maxBudgetUsd` 定死；调 = 取消后带新预算 reopen |
| 18 | 断线重连后恢复视图 | m `listSessions` + `RoutineManager.list()` 全量重拉 | 台账天生跨重启，「断线是常态且必须无感」由数据面免费兑现 |

---

## §10 首消费方计划（防新面重蹈 P2）

两级标尺自我约束：新面落地首日必为「已交付」级，本档随档写死去标路径——真实需求已在排队，不许它们停在实验面：

| 新面 | 指定首个非演示消费方 | 顺带去标 |
|---|---|---|
| AgentExecutor | 甲案：`memory-tidy` 例程生产化为黑池「做梦」值班任务（银芯侧可自证）；乙案：BPT Cowork 步四执行节点（黑池侧接线，银芯只能凭回报确认） | goal 族（extractGoalRound 接线即 GoalChaser 首个真实消费方） |
| RoutineManager | testbed daemon 或 store-patrol 的例程面改造（把手写的「每日一发」翻成 RoutineSpec） | — |
| WorkflowNode.manualClaim + 投影表 | BPT Cowork 任务流（黑池侧） | workflow 声明式加载族 + delivery 族（钉钉 sink） |

黑池侧消费属回报制（防火墙内银芯不可见）：以「归因回流 = 需求非数据」纪律核实，凭守密人口述销案。

---

## §11 既有裁定碰撞检查

| # | 触点 | 判定 |
|---|---|---|
| 1 | P1（删 peerDependency） | 裁2 注入式与之兼容；若未来改判 import 案，须显式重开 P1，不得当实现细节滑过 |
| 2 | 六态封闭 + T67 终态不可变 | 全档零新状态零新边；确认门 / 修订 / 重试全部复用既有词汇 |
| 3 | 「goal 不入表」 | AgentRunPayload / GoalRoundPayload 只进 payload，台账 schema 对 goal 语义保持无知 |
| 4 | `QueryRecord.costUsd`（D2） | 动记录形状不动状态集；0.79.0 先例在，已显式裁定（取甲） |
| 5 | 「不做界面显示」 | RoutineManager 全部方法返回数据；样机是**档案交付物**（银芯 Resource 层），不是 SDK 组件——SDK 不含一行渲染代码 |
| 6 | `manual:` 幂等键前缀 | 硬约束：绝不可落 `sched:`（污染 Scheduler 恢复足迹、移动补偿窗口）；足迹解析抽纯函数由两侧共用，防第二份漂移解析 |
| 7 | 「已验证」两级标尺 | §10 随档写死首消费方与去标路径；缺此节则本档自身违反 P2 处置纪律 |
| 8 | 引擎定位（不持钟 / 不认识斜杠 / 不管 query 内部） | AgentExecutor 不解释 prompt、不持墙钟、只转发引擎公开消息流；对引擎的全部消费限于公开面（硬性质②自证：宿主徒手可复刻每一行） |
| 9 | 锁步版本钟 | 实现轮为一次 minor（新增可选面 + 可选字段），家族同号齐发；本档自身不触发版本 |

---

## §12 已裁与待裁清单

**已裁记档**（2026-07-29 守密人交互裁定）：

- 裁1 设计档先行（本档即产物，实现另轮）
- 裁2 AgentExecutor 注入式（§3.1）
- 裁3 Maestro 持数据面底座 + Cowork 五态投影 + `WorkflowNode.manualClaim` 纳入（§8）
- 裁4 例程 = 定时例程原语，RoutineManager 立项（§5）
- 裁5 UI 案例加重为可交互样机（随档 html）

**已裁第二批**（2026-07-29 同日守密人逐项交互裁定，均取推荐案）：

| # | 事项 | 裁定 | 位置 |
|---|---|---|---|
| D2 | `QueryRecord.costUsd?` 可选字段 vs 仅 onResult 观测缝 | **加字段（甲）** | §3.4 |
| D3 | LoopRunner 建 / 不建 | **不建**，代之 ASSEMBLY.md + agent-loop 例程 | §4 |
| D4 | Routine 停启状态存储 | **纯内存 + 宿主持久化（丙）** | §5.3 |
| D6 | 跨 attempt 自动 resume | **不做**，恢复走 reopen + payload.resume | §3.5 |
| D7 | `cancelled` 在 Cowork UI 呈现 | **单列「已取消」**，不并入 failed | §8.2 |
| D8 | 宪章 §3「loop 骨架」条补覆盖注 | **补注**（实现轮随 PR 落宪章） | §4 |

（编号缺 D1 / D5：原候选项已并入裁2 / 裁3，留号防指针断链。）

本档全部设计决策至此裁定完毕，实现轮待守密人派发（范围：assembly 族 + routine 族 + `WorkflowNode.manualClaim` + `QueryRecord.costUsd` + ASSEMBLY.md + agent-loop 例程 + 宪章补注，家族一次 minor 锁步齐发）。
