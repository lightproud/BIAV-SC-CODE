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

**不在已完范围**:周报 loop 迁入生产切换(机制已由 schedule 承载;切换待 T37
推送形态裁定 + 判卷侧充值,见 todo)。
