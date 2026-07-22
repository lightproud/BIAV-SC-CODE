# CONTEXT — silver-core-maestro-sdk(银芯编排 SDK)

> 动手前先读本档。需求裁定书(建成什么样的唯一权威):
> `Public-Info-Pool/Resource/repo-engineering/scs-req-orchestrator-sdk-20260717.md`
> 地基(代理侧定位与 R1–R6 接口面):
> `Public-Info-Pool/Resource/repo-engineering/scs-req-repositioning-loop-support-20260717.md`

## 定位

编排 SDK 持有分子:钟、跨会话状态、会话装配。代理 SDK(`projects/silver-core-sdk/`,
npm 名 `silver-core-agent-sdk`)持有原子:一次结构化调用。判别式:节点要活得比父调用久、
或要等墙钟/外部事件 → 编排;否则 → 代理引擎内。

三条硬性质(红线,违规推倒重来):

1. 库不是框架——宿主持有 main(),零件可单独拿取。
2. 对代理 SDK 无特权通道——只准 import `silver-core-agent-sdk` 公开面;深路径 / 相对路径
   伸进代理源码 = 违规。CI `check-dep-direction` 机器执法(反向 import 亦红)。
3. 数据面在 SDK、渲染在宿主——送达/显示只定契约缝,实现宿主注入。

## 家族纪律

- **版本钟锁步同版**(守密人 2026-07-18 裁定,覆盖需求档 §2「永不同步」条):两包永远同号、任一侧 shipped 变更双双 bump,CI 守卫版本相等;未动侧 CHANGELOG 记一行锁步对齐注。
- 依赖单向:编排 → 代理。共享代码只准下沉进代理 SDK 或独立第三包。
- 发版纪律与代理侧同构:改 shipped 运行时代码即 bump + CHANGELOG 一行。
- monorepo:仓库根 `package.json` workspaces 持两包,单一根 lockfile;
  `npm ci` 在仓库根跑,workspace 内 `npm run <script>` 照常。

## 当前状态

第零战(monorepo 迁移)+ 第一战(任务台账 + 驱动器,0.2.0)完成:

- 封闭状态机(`pending | running | retrying | failed | done`,定稿回填需求档 §4)
  + 纯核 `src/ledger/state.ts` **变异分 100%**(棘轮地板 100,周检 CI 值守);
- `LedgerStore` 存储缝(宿主注入,零内置电池)/ `TaskLedger` / `LedgerDriver`
  (持钟活组件,宿主生杀,stop 中止走正常重试路径、重启自然续跑);
- 例程一 `examples/minimal-loop.ts`(周期派发 + 预算帽 + 到帽收尾,消费代理侧
  R2 预算事件流),e2e 对本地仿真器真跑双 R2 事件 + closeout。

第二战(商店巡检真实场景接入,2026-07-18 守密人点火)完成:

- `examples/store-patrol.mjs` + `store-patrol.targets.json`(注册表:加新商店 = 加一段
  配置零新代码)——首个**生产**循环任务长在台账 + 驱动器上:Morimens Steam 双端点
  (appdetails 价格/发行面 + appreviews 评价总量面)每日指纹比对,快照 + 变更日志落
  `Public-Info-Pool/Record/store-patrol/`;台账经宿主文件店持久化,跨重启恢复真实生效;
- 幂等派发键 `patrol:{target}:{date}`(同日重跑跳过,failed 终态自动 r2 重开);
  驱动器超时经 AbortSignal 真中断 fetch;全部失败反映到进程退出码(CI 可见);
- CI `store-patrol.yml` 每日北京 15:15(07:15 UTC)自动跑,机器提交带 [skip ci];
- e2e `tests/store-patrol.e2e.test.ts` 四场景(基线/跨日变更+幂等/500 重试/挂死超时耗尽);
  2026-07-18 首次生产真跑绿(两目标 done,基线:免费/发行 2024-08-01/Very Positive 3989:797)。

第三至六战(0.4.0,2026-07-18 守密人「动态编排令」——四路文件不相交实现代理 +
双对抗审查 + 单脑整合)完成:

- **schedule**(§6.2 例程二):纯核 `nextFireAt`/`firesBetween`(UTC dailyAt +
  锚定间隔,错过窗封顶保最新)+ 只派发 `Scheduler`(fire 记账在台账
  `sched:{id}:{fireAt}` 幂等键,跨重启扫描恢复;补偿策略 latest/all);
- **workflow 图**(§6.3 例程三):图即数据——`validateGraph`(环检出报精确环路径)
  /`readyNodes`/`graphStatus`(fail-fast)+ `WorkflowRun`(节点=会话,幂等键即断点
  续跑,join 节点收上游 ok summary);
- **goal 追逐器**:跨 query 重发起,轮=会话 `goal:{id}:round-{n}`,宿主 evaluator
  判轮、feedback 注回下轮 payload,goal 语义只在 payload 不进台账 schema;
- **送达契约**(§5):`DeliverySink` 宿主注入 + `createDeliveryChannel`——每次送达
  即一条台账审计会话(审计先行:落账失败不发信;sink 失败入回执与台账不上抛);
- **审查整改五处**(4 major + 1 minor 全修全锁):类型化 `DuplicateSessionError`
  (宽匹配吞真错误根治)、台账新 API `claimSession`(送达并发抢占根治)、四处 id
  冒号封禁(会话键分隔符碰撞根治)、goal 排水超时逃生口;
- 变异靶扩编三处:schedule-spec **100** / workflow-graph **97.14**(3 存活为
  记档等价类)/ goal-decision **100**,周检矩阵四靶;测试 171(15 文件)。

第七战(0.69.0,2026-07-18 守密人待办批第 4/5 项)完成:

- **workflow 声明式加载**(热层闸):`parseWorkflowGraphSource` / `loadWorkflowGraphFile`
  (json / md 首个 ```json fence;坏文件**永不抛**、降级 `{ok:false}` 跳过;ok 必已过
  validateGraph);变异分 100(棘轮靶 `workflow-load`);
- **例程四「综合整理任务」**(`examples/memory-tidy.mjs` + 假钟 e2e):定时派发 → 读
  健康面(agent 侧 `assessMemoryStoreHealth`)→ 归并写卡 → 删碎片 → 台账收口,
  只 import 两包公开面——黑池做梦例程原型(executor 座位换 agent query 即真梦);
- **schedule 错过补偿核对**:已实现有测试(catchUp latest/all + 跨重启恢复,
  组件级假钟 + e2e 双层覆盖),免补;
- **质量方向切换**:棘轮五族全靶(新增 delivery-channel 100 / workflow-load 100,
  CI 矩阵六靶);四份 e2e 全部假钟化(有界 drive 循环,三连跑稳,秒级降毫秒级),
  全套件零真实钟;测试 171 → 180。

试金石漏缝采纳批(0.71.0——原编 0.69.0,合并时因 main 并行会话(#743/#744)占号
让号;0.70.0 审计批同场合并,2026-07-18 守密人「甲」裁定,testbed GAPS.md 四缝):

- G1 `runLedgerStoreContractSuite` 随包契约套件(12 检查,坏实现落报告不抛出);
- G2 认领租约:`claimLeaseMs` 盖 `leaseUntil` 戳 + `sweepExpiredLeases()`(只动过期
  租约,多驱动器安全)+ 驱动器每 tick 自动清扫;无租约台账逐字节旧行为;
- G3 `seedFirstRun`(短命宿主零号日死锁修复:无足迹 spec 起点回拨一节拍,首 tick
  恰发最近到期点)+ `scheduleSessionId()` 公开导出;
- (G4 `MemoryStore.read` 在 agent 侧同版落地。)

cancelled 封闭终局(0.76.0,BPT 需求 P0-D1「用户主动取消的封闭终局语义」,2026-07-22):

- 状态机第六态 `cancelled`(终态、无出边,`SESSION_STATES` 末尾追加保索引序)+
  事件 `cancel`(pending / running / retrying 三态皆可入);
- `TaskLedger.cancelSession(id, { reason?, cancelledAt? })`:幂等重复、done/failed
  抛 InvalidTransitionError、互斥 + CAS 围栏(丢 CAS 有界重读重放);nextRunAt /
  leaseUntil 无条件清空——取消后永不到期、永不被 claimDue / sweepExpiredLeases 碰;
- query 级口径 = 需求 §4.4 方案 A:`QueryOutcome` 增 `'cancelled'`,running 取消落
  在飞 attempt 墓志铭行(error = reason),pending/retrying 取消不伪造行;
  recordOutcome 拒收 'cancelled'(会话级命令不是 executor 可上报结果);
- session 级增量字段 `cancelledAt` / `cancelReason`(lastError 不挪用);
- 取消 vs 在飞 attempt 双向竞态钉死:取消先落账 → 迟到 recordOutcome 抛错、驱动器
  对这一种拒绝**静默丢弃**(用户取消不冒充驱动器故障);attempt 先落账 → 对
  done/failed 取消抛错、对 retrying 正常取消;
- 契约套件新增 cancelled 落库往返检查(重启不复活);测试 362(29 档,+20 例)。

**不在已完范围**:周报 loop 迁入生产切换(机制已由 schedule 承载;切换待 T37
推送形态裁定 + 判卷侧充值,见 todo)。agent 侧棘轮 floor 抬升待每周 CI 实测
出分后按 bump 提示落地(本地不盲抬)。
