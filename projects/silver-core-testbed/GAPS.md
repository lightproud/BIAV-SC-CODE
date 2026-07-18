# 漏缝清单（施工封面 §0.1 / 验收 §4.5）

> 定义：testbed 作为「无宿主世界观的第二消费者」，在只准触碰两包公开导出面的红线下，
> 每一处「必须绕道 / 自造 / 靠文档注脑补」的地方都是接口面漏缝。**漏缝是本项目最有
> 价值的产出之一**——打补丁绕过等于销毁证据，故本清单只记录、不掩盖；每条附 testbed
> 侧的绕行方式（全部走公开面，无一触碰非公开面，故均为「非闭塞」级）。
>
> 空清单 = 接口面首次通过第二消费者检验。本清单**不为空**：四条实缝，见下。
>
> **销缝状态（守密人 2026-07-18「甲」裁定：四条全采纳排期，同日落地家族 0.71.0）**：
> G1/G2/G3 落 silver-core-maestro-sdk 0.71.0，G4 落 silver-core-agent-sdk 0.71.0；
> testbed 已换装消费新面（daemon 用 claimLeaseMs + seedFirstRun、契约测试并跑随包
> 套件、readIfExists 优先 store.read），原绕行件保留为回归证据。逐条落地注见各缝尾。

## G1 · LedgerStore 契约套件未随包交付

- **缝**：agent SDK 为 `MemoryStore` 公开交付了可运行契约套件
  （`runMemoryStoreContractSuite`），maestro SDK 的 `LedgerStore` 却没有对应物——
  第二消费者注入自己的存储时，只能从 `store.ts` 接口文档注（create-or-replace /
  双过滤字段 / append 序）**自行重推导**一套契约测试。
- **风险**：各消费者推导的契约理解可能彼此漂移，且 SDK 侧将来收紧语义时无法机器
  通知存量存储实现。
- **testbed 绕行**：`tests/store-contract.test.mjs` 自写 14 例（纯契约 + 经
  TaskLedger/LedgerDriver 端到端），全绿。
- **建议**：maestro 侧仿 memory 契约套件交付 `runLedgerStoreContractSuite(store)`。
- **✔ 已销（0.71.0）**：`runLedgerStoreContractSuite` + `ledgerStoreContractCheckNames`
  随包交付（12 检查，坏实现落报告不抛出）；testbed 契约测试并跑随包套件全绿。

## G2 · 认领无租约：kill -9 孤儿只能靠宿主自扫

- **缝**：`claimDue` 把会话置 `running` 后，若驱动器进程被硬杀（kill -9 / 断电），
  没有任何 SDK 机制把孤儿 `running` 会话送回执行轨道——无认领租约、无超时回收、
  无「崩溃清扫」原语；`claimDue` 只捞 pending/retrying，孤儿将永远卡在 running。
- **testbed 绕行**：宿主开机自扫（`crashSweep`）——对所有 `running` 会话
  `recordOutcome({outcome:'error'})`，走正常重试路径；演练实证有效
  （kill9 drill：2 孤儿全部清扫入 retrying 并最终完成）。
- **残余风险（绕行无法覆盖）**：自扫仅单驱动器安全——多驱动器共库时，宿主无法
  区分「死进程的孤儿」与「另一台活驱动器的在飞尝试」，一扫就把别人的活干掉。
  租约/心跳戳只能长在 SDK 的记录形状里，宿主侧补不了。
- **建议**：SessionRecord 增认领租约（claimedUntil / 驱动器身份戳）或至少交付
  文档化的 sweep 原语与其安全边界。
- **✔ 已销（0.71.0）**：`TaskLedgerOptions.claimLeaseMs` 认领盖租约戳
  （`SessionRecord.leaseUntil`）+ `TaskLedger.sweepExpiredLeases()`（只动过期租约，
  多驱动器共库安全），驱动器每 tick 自动清扫；无租约台账与存量记录逐字节旧行为。
  testbed 双层并用：租约（在线自愈）+ 开机自扫（重启即时恢复，单驱动器场景）。

## G3 · Scheduler 零号日死锁（短命宿主）+ sched id 无公开构造器

- **缝一（行为）**：Scheduler 恢复语义「无台账足迹的 spec 从 now 起算、刻意不回填」
  对长命进程正确；但**短命宿主**（每日 CI 跑数秒即退，且 cron 落点在 fire point
  之后）每次冷启都重锚 now→足迹永不建立→**该 spec 永远不开火**。这不是边角：
  「每日 CI 补偿驱动」正是 catchUp/恢复机制的招牌场景。
- **缝二（表面）**：绕行需要按 `sched:{specId}:{fireAt}` 手工拼会话 id 播种足迹，
  但该格式只存在于类文档注里——workflow 侧有公开的 `workflowSessionId()`，
  schedule 侧没有对应的 `scheduleSessionId()`，消费者被迫依赖注释级契约。
- **testbed 绕行**：`primeSchedules()`——spec 无足迹时用公开的 `firesBetween`
  算出最近一个已过 fire point、按文档注格式 dispatch 播种；自愈（热层新增 spec
  同样被播种）。实证：首轮 5 spec 全部 primed 并执行。
- **建议**：导出 `scheduleSessionId()`；Scheduler 增 `seedOnFirstRun`（或
  `backfill: 'latest'`）选项原生覆盖短命宿主。
- **✔ 已销（0.71.0）**：`scheduleSessionId()` 公开导出 + `SchedulerOptions.seedFirstRun`
  （无足迹 spec 起点回拨一个节拍，首 tick 恰发最近一个到期点、两种 catchUp 同构；
  默认关，旧行为逐字节不变）。testbed 宿主侧 primeSchedules 绕行件已删除换装。

## G4 · MemoryStore 公开面没有原样读回

- **缝**：`MemoryStore.view()` 返回的是模型面参考格式（`Here's the content of ...`
  头 + 6 字符右对齐行号），公开面上**没有**返回原始字节的读命令——消费者要把自己
  写进去的内容读回来，只能剥壳（正则去头去行号），或绕到 `createLocalMemoryFileOps`
  原语层（那就绕开了限额与路径防御所在的引擎层）。
- **testbed 绕行**：`stripView()` 剥壳；做梦任务经它回读报告全部成功。
- **风险**：剥壳对「内容本身长得像行号格式」的文件不保真（当前场景无此类内容，
  可接受）；参考格式头若随上游对齐变化，剥壳正则会静默漂移。
- **建议**：公开面补 `read(path): Promise<string>`（原样字节，不裁剪不编号）。
- **✔ 已销（0.71.0）**：`MemoryStore.read?(path)` 可选宿主面原样读回（引擎店实现，
  R4 路径校验同行；六条模型面命令逐字节不变；自定义实现可缺省、消费方特性探测）。
  testbed `readIfExists` 优先走 read，stripView 降级保留。

---

*清单建立：2026-07-18 施工首日。后续每轮浸泡 / 对照实验发现新缝追加于此，销缝须注 SDK 版本与迁移方式。*
