# CONTEXT — silver-core-maestro-sdk(银芯编排 SDK)

> 动手前先读本档。需求裁定书(建成什么样的唯一权威):
> `Public-Info-Pool/Resource/repo-engineering/scs-req-orchestrator-sdk-20260717.md`
> 地基(代理侧定位与 R1–R6 接口面):
> `Public-Info-Pool/Resource/repo-engineering/scs-req-repositioning-loop-support-20260717.md`

## 定位

编排 SDK 持有分子:钟、跨会话状态、会话装配。代理 SDK(`projects/silver-core-sdk/`,
npm 名 `silver-core-agent-sdk`)持有原子:一次结构化调用。判别式**三项**(第三项为守密人
2026-07-26 产品审视 P5 补维):节点要活得比父调用久、或要等墙钟/外部事件、**或由 agent 侧
主动发起且需在台账留审计的对外动作(触发权)** → 编排;否则 → 代理引擎内。
补维缘由:`createDeliveryChannel` 不满足原两项(只用 clock 打时间戳、零 setTimeout),
但需求档 §3 一直按「触发权」把它归编排——**是判据表述漏了 §3 已在用的那一维,不是它放错了**。

三条硬性质(红线,违规推倒重来):

1. 库不是框架——宿主持有 main(),零件可单独拿取。
2. 对代理 SDK 无特权通道——只准 import `silver-core-agent-sdk` 公开面;深路径 / 相对路径
   伸进代理源码 = 违规。CI `check-dep-direction` 机器执法(反向 import 亦红)。
3. 数据面在 SDK、渲染在宿主——送达/显示只定契约缝,实现宿主注入。

## 家族纪律

- **版本钟锁步同版**(守密人 2026-07-18 裁定,覆盖需求档 §2「永不同步」条):两包永远同号、任一侧 shipped 变更双双 bump,CI 守卫版本相等;未动侧 CHANGELOG 记一行锁步对齐注。
- 依赖单向:编排 → 代理。共享代码只准下沉进代理 SDK 或独立第三包。
- **不声明对代理 SDK 的 peerDependency**(守密人 2026-07-26 裁定,覆盖需求档 §2 该条):
  本包 `src/` 对代理 SDK 零 import,声明一个从不使用的包会被 npm 7+ 自动装上,
  与硬性质①「整箱不要」冲突。`devDependencies` 保留(测试与两个例程真用它)。
- 发版纪律与代理侧同构:改 shipped 运行时代码即 bump + CHANGELOG 一行。
- monorepo:仓库根 `package.json` workspaces 持两包,单一根 lockfile;
  `npm ci` 在仓库根跑,workspace 内 `npm run <script>` 照常。

## 当前状态

<!-- CONTEXT-FACTS:BEGIN 机器生成，勿手改；重算 `python3 scripts/build_status_facts.py` -->

**当前版本 `0.93.0`** · 发布日 2026-07-28 · 家族锁步对端 `silver-core-agent-sdk` = `0.93.0`

> 本行由 `scripts/build_status_facts.py` 从 `package.json` + `CHANGELOG.md` 生成，**勿手改**；规模数字不在此列，指 `memory/project-status.md` 的 STATUS-FACTS 块。下方叙述由人写（「这一版做了什么」是判断、生成不出来），其**新鲜度**由`tests/test_status_doc_facts.py` 守。

<!-- CONTEXT-FACTS:END -->

**v0.93.0（2026-07-28）：锁步对齐**（本包零运行时改动）——agent SDK 0.93.0 修复 recap 截断丢最新进度（BPT P1 活锁事故根因，`buildRecap` 改头尾双保留）并把截断纪律注册表扩到全 `src/`；家族版本钟锁步，本包同步升位。

**v0.92.1（2026-07-28）：锁步对齐**（本包零运行时改动）——agent SDK 0.92.1 修复自动续跑时「被拒绝的控制面覆写仍被留存并重放」；家族版本钟锁步（守密人 2026-07-18 裁定），本包同步升位。

**v0.92.0（2026-07-27）：锁步对齐**——本包**零代码改动**。家族版本钟随 agent SDK 0.92.0（Workflow 改真异步启动，对该工具调用方为行为破坏性变更）前进。

**v0.91.0 / v0.90.0（2026-07-27）：锁步对齐两连**——本包**零代码改动**。家族版本钟随 agent SDK 同号前进（四工具补结构化产出 + 零产出面台账守卫 · checkpoint blob 上限 T74 甲案）。

**v0.89.0（2026-07-27）：锁步对齐**——本包**零代码改动**。家族版本钟随 agent SDK 0.89.0（类型面漂移检测工具化：`type-parity.mjs` 只报新漂移，首跑挖出四条「发货了却没声明」的类型缺陷）前进。

**v0.88.0 / v0.87.x（2026-07-27）：锁步对齐**——本包**零代码改动**。家族版本钟随 agent SDK
0.87.0（截断纪律全家对齐）、0.87.1（嵌套路径普查）、0.88.0（处方卡型 + sessions 体检面）
前进，逐版详见该包 CHANGELOG。

**v0.84.0（2026-07-27）：锁步对齐**——本包**零代码改动**。家族版本钟随 agent SDK 0.84.0
（记忆索引纪律 + 整理规程）前进，详见该包 CHANGELOG。

**v0.85.0（2026-07-27）：goal 判词统一为 agent SDK 正典形状（BREAKING，实验面）**——`GoalVerdict` 从 `{achieved: boolean, feedback, impossible?}` 迁为与 agent SDK **逐字同形**的 `{status: 'achieved'|'not_achieved'|'impossible', reason?}`。这终结一个已咬到首个真实消费者的陷阱：两包各自导出**同名不同形**判词，评审器接错缝时引擎判 malformed 并 fail-open 放行停止（BPT 2026-07-27 症状「接了 goal 模型照样停」的 SDK 侧根源之一）。统一后一个宿主评审器经结构类型同时服务两缝；**声明式重复、不跨包 import**（硬性质 §1.2 不声明对 agent 依赖）；`nextGoalAction` 改依 `status` 判分支、四动作与优先序不变；`GoalRoundPayload.feedback` 字段名保留（持久化 payload schema）、改承载判词 `reason`。迁移映射与破坏面理由见 CHANGELOG 0.85.0；goal 族仍属实验面（GoalChaser 零调用点），本次即「签名随首个真实消费方调整」条款的兑现，且赶在首次接线之前。
**v0.83.0（2026-07-27）：锁步对齐**——本包**零代码改动**。家族版本钟随 agent SDK 0.85.0（工具真正产出结构化结果并以 `toolUseResult` 交付消费方；MCP 接受列表扩到官方最老修订）前进。

**v0.82.0（2026-07-27）：锁步对齐**——本包**零代码改动**。家族版本钟随 agent SDK 0.82.0（Read 通读 >256KB 改为拒绝，源自首次对官方 2.1.220 二进制的偏离普查）前进。

**v0.81.0 / 0.80.2 / 0.80.1 / 0.80.0（2026-07-27）：锁步对齐四连**——本包**零代码改动**，
家族版本钟随 agent SDK 同号前进（Read 截断页脚三件套 · 快照基准对齐 + 吻合度尺子 ·
溯源 slug 改锚 + cron 自检 · 工具输出上限对齐 2.1.141）。逐版叙述见该包 CHANGELOG。

**v0.79.1（2026-07-27）：锁步对齐**——本包**零代码改动**。家族版本钟随 agent SDK 0.79.1
（transport / MCP 内部去重）前进。

**v0.79.0（2026-07-26）：重开语义 + 三项余项推进**（守密人「1.写 2.3.4.5.6.按你建议推进」）。
**T67 重开（甲案）**：`reopenSession` / `reopenChain`——新会话 + `reopenOf`/`attemptRound` 链，
**封闭状态机分毫未动**（终态不可变是 CAS 围栏 / 幂等派发 / 重启不复活的共同立足点；缺的从来不是一条边，
是那个**链接**）。前驱须终态 · `cancelled` 默认拒绝需 `force` · 后继 id 从**链根**派生（累加版被自己的回归锁首跑抓到）·
payload 可覆盖（e2e 抓到示例继承旧 target 重打本该迁离的端点）。`store-patrol.mjs` 弃手写 `:rN` 环改用真 API。
**T68 `docs/CONCURRENCY.md`**（本包第二份文档，产品审视列为最大缺口）。
**T69 变异棘轮 `cadence` 分档**：三个零消费靶降月检（加字段不删腿），cadence 自身加三条治理断言。
**T70 空转措辞钉死 + `scripts/sdk_substantive_versions.py`**（守卫首跑抓到两条真漂移）。
测试 404 → **421**。

**v0.78.1（2026-07-26）：产品审视四项裁定**——审视档
`Public-Info-Pool/Resource/repo-engineering/maestro-sdk-product-review-20260726.md`（同日第二轮，
问的不是「代码对不对」而是「作为产品是否成立、是否有效」）。**两包运行时行为零变化。**
**P1** 删除对代理 SDK 的 peerDependency——`src/` 对它零 import（仅两处注释散文），而 npm 7+ 自动装 peer，
等于强迫只想要台账的宿主连带装代理包，与硬性质①冲突；信息价值由锁步同号纪律接替。
**P2** 六族按**两级标尺**标成熟度（需求档 §6 新增）：`ledger`/`driver`/`scheduler` 为**已验证**
（两个互不相干真实消费方：生产商店巡检 + 试金石 daemon）；`workflow`/`goal`/`delivery`/保留缝为
**实验面、无生产消费方**（实测全仓零真实调用点，`WorkflowRun` 仅 1 处自家 demo）。原标尺
「例程写不出来 = 接口面漏缝」检验的是**可行性**不是需求，故补第二级：**须有至少一个不是为演示它而写的消费方**。
**P3** 新增本包**第一份 docs** `docs/ONBOARDING.md`——两个真实消费方各自手写文件型 store
（43/38 行、逐行相似度 86%），而本包原本只给「16 项契约套件检查你抄得对不对」、不给那份「抄什么」；
现给可复制样板 + 四条陷阱各对应一项检查。`tests/onboarding-sample.test.ts` **从 markdown 提取样板
写临时 .ts 真跑契约套件**（负控：删掉样板一行即报「2 orphan query row(s)」）。
**P4** delivery 归属维持，改的是**判别式**（见上「定位」节补维）。测试 400 → **404**。

**v0.78.0（2026-07-26）：设计审视四缝全修**——审视档
`Public-Info-Pool/Resource/repo-engineering/maestro-sdk-design-review-20260726.md`，守密人同日四项裁定（均取推荐案）。
四条**无一是算错了**，全部是「某个约定的射程没铺满」——五轮审计 67 项、三套性质测试、六靶变异棘轮（地板 97–100）全数漏过，
因为这类缺口不产生任何测试信号。**F1** 0.76.0 新增的 `cancelled` 终态没穿透场景层（三处硬编码 `done || failed`），
默认 `drainTimeoutMs` 不设时用户取消 → 工作流 / 目标追逐永久挂死；现 `graphStatus` 按守密人裁定判 fail-fast、
`GoalChaser` 认全部终态并以新 action `'cancelled'` 结案（不问 evaluator），新增 `UNSUCCESSFUL_TERMINAL_STATES` +
`isTerminal` / `isUnsuccessfulTerminal`，并**加治理守卫**禁止 src 内把终态判定写成字面量对（带在码内的
`terminal-literal-ok:` 例外口 + 自陈射程边界）。**F2** 驱动器新增 `maxConcurrent`（实测 200 到期 → 峰值 200；
宿主无法自行补救，executor 内排队会空烧租约）+ 台账 `claimDue(now,{limit})`。**F3** 新增可选存储缝
`deleteSession?` + 网关 `TaskLedger.purgeSession`（持互斥、拒非终态、缺缝响亮失败；契约套件 +4 检查）。
**F4** `run({signal})` / `chase(config,{signal})` 收 AbortSignal，共用的 `waitOrAbort` 恒清定时器。
测试 362 → **400**；三套机制均经逐条回退负控实证（6 例转红）后还原。
**未纳入（不在裁定射程）**：`Scheduler` 恢复仍做无过滤全表扫；F5「重开」语义仍挂待裁。

**v0.77.0（2026-07-26）：锁步对齐（agent 侧 Windows 正确性清扫）**——本包零代码改动。
值得记一笔：同一轮 Windows 探路里 agent SDK 15 个测试档失败，**maestro 362/362 全绿、无需任何改动**——
编排层不含宿主路径与 shell 假设。详见 agent CHANGELOG 0.77.0。

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
- 幂等派发键 `patrol:{target}:{date}`(同日重跑跳过;failed 终态经 0.79.0 `reopenSession` 重开为 `#r2`,
  原为手写 `:r2` 后缀,见 v0.79.0 条);
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
