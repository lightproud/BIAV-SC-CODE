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

## 安装与家族结构

两包版本钟**锁步同版**(守密人 2026-07-18 裁定,覆盖需求档 §2「永不同步」条):
永远同号、家族整体 bump,CI 守卫版本相等。本包 peerDependency 声明兼容的
代理版本区间。不做伞包——安装哪个包即用户对自身位形的声明。
