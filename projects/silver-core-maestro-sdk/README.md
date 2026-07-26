# silver-core-maestro-sdk

银芯编排 SDK。持有分子:钟、跨会话状态、会话装配——把「活得比一次调用久」的
agent 所需的脏活(循环、调度、重试、恢复、台账)做成可复用零件,交给宿主装配。

与 `silver-core-agent-sdk`(银芯代理 SDK)的分界一句话:**代理持有原子(一次结构化
调用,含 query 内子代理),编排持有分子(跨调用的钟与状态)。** 判别式:节点要
活得比父调用久、或要等墙钟/外部事件 → 编排;否则 → 代理引擎内。

三条硬性质(需求档 §1,全包无例外):

1. **库,不是框架。** 宿主持有 main();每件零件可单独拿取、自由组合、整箱不要。
2. **对代理 SDK 无特权通道。** 本包能做到的一切,宿主徒手用 `silver-core-agent-sdk`
   公开接口(R1–R5)也必须能做到。依赖单向 编排 → 代理,CI 机器执法。
3. **数据面在 SDK,渲染在宿主。** 送达/显示只定契约缝,实现由宿主注入。

需求全文:`Public-Info-Pool/Resource/repo-engineering/scs-req-orchestrator-sdk-20260717.md`

## 身份声明(as-is)

本仓为一个游戏项目的**副产品**,按 as-is 提供:**无支持承诺,issue / PR 可能
不被处理**。回贡仅收**契约套件全绿**的 PR(`npm test` 全量通过 + 涉及变异棘轮
目标时分数不破地板);其余一概不设期待。English: this repository is a game
project's by-product, provided as-is with no support commitment; PRs may go
unanswered, and contributions are only considered with the full test suite
green.

## 状态

五个模块族全部落地(与代理包锁步同版,版本见 `package.json`):封闭状态机台账
(`TaskLedger` + `LedgerStore` 宿主注入缝)、持钟驱动器(`LedgerDriver`)、
调度器(`Scheduler`,定点触发 + 错过补偿 + 跨重启恢复)、workflow 图
(`validateGraph` / `WorkflowRun` + `loadWorkflowGraphFile` 声明式 md/json
加载、坏文件降级跳过)、goal 追逐器(`GoalChaser`)、送达契约
(`createDeliveryChannel`)。例程四份:最小 loop / schedule loop /
workflow 扇出 / 记忆综合整理(`examples/memory-tidy.mjs`,黑池做梦例程原型),
均只 import 两包公开面。生产循环:商店巡检(`examples/store-patrol.mjs`,
每日 CI)。实时进度以 `memory/project-status.md` 为唯一权威。

## 宿主必须自己决定的三件事(0.78.0)

本包是库不是框架,以下三处**默认值刻意保守**——它们保持 0.78.0 之前的行为
逐字节不变,所以升级不会改变任何既有宿主的行为。代价是:不显式设置就等于选了
那个默认,而其中两个默认在生产里是需要过问的。

1. **并发上限 `LedgerDriver.maxConcurrent`**——**不设 = 无上限**。驱动器会把
   一 tick 内全部到期会话同时起飞(实测 200 到期 → 峰值并发 200)。三条日常
   路径都会堆出积压:调度器停机后补偿(`catchUp: 'all'`,`firesBetween` 上限
   100 个触发点一次到齐)、宽图扇出(无依赖节点一次全 ready)、宿主重启后
   store 里的 pending 一次全到期。**若一次 attempt 是一次付费 API 调用,请显式
   设置。** 注意这件事宿主无法在 executor 里自行补救:排队时 attempt 早已被
   认领(`running`、attempts 已 +1、租约已起算),排队等于让租约空烧。
2. **保留策略**——台账**只增不减**,除非宿主 store 实现可选缝
   `deleteSession?` 并经 `TaskLedger.purgeSession(id)` 清理(该网关持会话互斥、
   拒绝非终态会话、缺缝时响亮失败而非静默不清)。每日循环任务与每条
   `deliver()` 审计会话都会永久累积。**注意反作用**:会话 id 即簿记的那些行,
   删了行就删了簿记——清理 `sched:{spec}:{fireAt}` 会让 `Scheduler` 恢复丢失
   足迹并重锚,清理 `wf:{graph}:{run}:{node}` 会让工作流重发该节点。保留策略
   须保住每个 spec 的最新触发点、且不碰未完成的 run。
3. **长跑组件的放弃口**——`WorkflowRun.run({ signal })` /
   `GoalChaser.chase(config, { signal })` 收 `AbortSignal`;不传且
   `drainTimeoutMs` 也不设时,两者会**无限等待**(驱动器不跑就永远等下去)。
   中止只停这一次循环,台账记录照留,故稍后重跑从原处续上。

三条的来由与实测数字见
`Public-Info-Pool/Resource/repo-engineering/maestro-sdk-design-review-20260726.md`。

## 安装与家族结构

两包版本钟**锁步同版**(守密人 2026-07-18 裁定,覆盖需求档 §2「永不同步」条):
永远同号、家族整体 bump,CI 守卫版本相等。本包 peerDependency 声明兼容的
代理版本区间。不做伞包——安装哪个包即用户对自身位形的声明。
