# CONCURRENCY — 并发、竞态与崩溃语义

> 本档解决的问题:**这个包的并发模型比代理侧复杂,而它此前一份文档都没有。**
>
> 代理侧有 `docs/CONCURRENCY.md`,编排侧没有——但真正需要它的是编排侧:per-session 互斥
> + 可选 CAS 围栏 + 认领租约 + 六态状态机(三个终态语义各不相同)+ settle-then-append
> 提交点 + 「哪些 id 本身就是簿记」。这些约束**决定了你的 store 要实现到什么程度**、
> **两个进程能不能共用一个 store**、以及**进程被 kill -9 之后会发生什么**。
> 产品审视 2026-07-26 P4 列此为最大文档缺口;守密人同日裁定「写」。
>
> 读者:要注入自己的 `LedgerStore`、或要跑不止一个驱动器的宿主。先读
> `ONBOARDING.md` 把东西跑起来,再读本档决定生产形态。

---

## §1 一句话结论(先给答案,再讲为什么)

| 你的部署形态 | 你需要做什么 | 后果 |
|---|---|---|
| **一个进程、一个驱动器**(绝大多数宿主) | 什么都不用做 | 全部安全。per-session 互斥已覆盖 |
| **一个进程、驱动器 + 送达通道 / 工作流共用台账** | 什么都不用做 | 安全。同一 `TaskLedger` 实例的互斥覆盖它们 |
| **一个进程、多个 `TaskLedger` 实例共用一个 store** | 别这么做,或实现 `putSessionIf` | 互斥是**每实例**的,跨实例不生效 |
| **多个进程共用一个 store** | **必须**实现 `putSessionIf`,并设 `claimLeaseMs` | 不实现 = 两个驱动器可能认领同一会话 |

**判据一句话:互斥防的是「同一个 `TaskLedger` 实例自己跟自己抢」,CAS 防的是「不同进程互相抢」。
它们不能互相替代。**

小学生比喻:互斥是同一间办公室里只有一支笔,谁拿到谁写;CAS 是两间办公室各写各的,
交上去时看谁的版本号对得上,对不上的那份作废。

---

## §2 第一层:per-session 互斥(白送的,永远开着)

`TaskLedger` 内部对**每个 sessionId** 维护一条 promise 链。所有会改动会话的路径——
`dispatch` / `claimDue` / `claimSession` / `recordOutcome` / `cancelSession` / `purgeSession`,
以及**按会话的读**(`getSession` / `listQueries`)——都排在这条链上。

**它保证什么**:同一个 `TaskLedger` 实例上,针对同一会话的「读—改—写」不会被自己的另一次调用
插进中间。并发两次 `recordOutcome` 不会双写审计行;一次租约清扫不会盖掉同实例另一个调用
刚提交的结果。

**它不保证什么**:
- **跨实例无效**。两个 `new TaskLedger({ store })` 各有各的 Map,互不知情。
- **跨进程无效**。同上,更彻底。
- **`listSessions` 不上锁**(它是全表查询,不属于任何一个会话)。

**为什么按会话的读也上锁**(0.71 r5 修):`recordOutcome` 是 settle-then-append(见 §5),
终态会**先于**它的审计行短暂可见。同实例的读者在那个窗口里会看到「`done` 且零 query 行」——
实测导致 `WorkflowRun` 把依赖摘要持久化成 null、`GoalChaser` 拿缺失数据下判词。
把读排进同一条链就关掉了这个窗口。**不同实例/进程的读者仍可能落进别人的窗口**:
如果这对你重要,把「终态但行缺失」当成「行还没到」处理,别当成「行不存在」。

---

## §3 第二层:`putSessionIf` CAS 围栏(可选缝,跨进程唯一解)

`LedgerStore` 的可选方法:

```ts
putSessionIf?(record: SessionRecord, expectedRevision: number | null): Promise<boolean>
```

语义:**当且仅当**库里那行的 `revision ?? 0` 等于 `expectedRevision` 时整行替换;
`expectedRevision === null` 表示「当且仅当该行不存在时创建」。返回是否写成。
比较与写入**必须相对其他 store 调用是原子的**——这是它唯一的实现要求,也是全部难点所在
(SQL 里是 `UPDATE ... WHERE revision = ?`,KV 里是 CAS 原语,内存里是同步块)。

**实现了会怎样**:台账的每一次会话写都变成 CAS。争抢的双方一个赢一个输,输的那个拿到
`ClaimConflictError` 或 `InvalidTransitionError`,**不会**两边都以为自己赢了。

**不实现会怎样**(诚实说明,不粉饰):台账退化到 `putSession`(无条件覆盖)。
审计 r4 的实测数字:两个宿主共用一个 store 时,**300 次种子交错里 295 次双重认领**——
两个驱动器都认为自己拿到了同一个会话,于是同一件事被跑两遍。
**故不实现 CAS 时的规矩是:一个 store 只跑一个认领驱动器。** 这不是建议,是前提。

**revision 从哪来**:台账每次写会话时自增 `record.revision`,store 只需**像存别的字段一样
存住它**。旧行没有这个字段 → 读作 revision 0,自动兼容。

---

## §4 第三层:认领租约(`claimLeaseMs`,防死驱动器)

配置了 `claimLeaseMs` 后,每次认领会盖一个 `leaseUntil = now + claimLeaseMs` 戳。
`sweepExpiredLeases()`(驱动器每 tick 自动调)会把**租约已过期的 `running` 会话**
按错误结清、送回正常重试路径。

**它治的病**:驱动器被 `kill -9` / 断电 / 容器被回收——会话永远卡在 `running`,
没有任何东西会再碰它。租约让别的驱动器(或重启后的自己)能安全接手。

**怎么设这个数**:**明显大于最坏情况下的单次尝试耗时**(把驱动器的 `queryTimeoutMs`
算进去)。设小了会发生这件事:一个还活着、只是慢的尝试被清扫掉,它稍后的 `recordOutcome`
撞上围栏抛 `InvalidTransitionError`——**这是设计如此,不是 bug**,但你会白跑一次。

**三条边界**:
- 不设 `claimLeaseMs` = 完全没有租约,`sweepExpiredLeases()` 是**零 store 调用**的真空转;
- 只碰**已过期**的租约,活的一律不动;
- **`cancelled` 会话永不被清扫**——`cancelSession` 在落终态的同时把 `leaseUntil` 清空,
  所以一个被取消的会话在清扫器眼里不可能像「过期的认领」。

---

## §5 提交点:settle-then-append,以及崩在中间会怎样

`recordOutcome` 的顺序是**先写会话行(状态流转),再追加审计行**。会话写是**提交点**。

**为什么是这个顺序**(r4 修,原来是反的):在 CAS store 上,跨进程的结清竞争(清扫器 vs
迟到的租约持有者)必须在**任何一方写审计行之前**分出胜负。输的那方在 CAS 处就失败、
根本不会 append,于是只追加的库里**不可能出现同一 attempt 的两条矛盾审计行**。
早先的「先追加后结清」让两边都先追加了,再由会话写去挑赢家——库里已经脏了。

**崩在提交点与追加之间**:丢的是**审计行**,不是**状态**。这是刻意选的方向——
状态是下一步动作的依据,审计行是事后追溯。台账为这个窗口留了**补写**:
一次「与已记录内容一致」的重试会把缺失的那行补上(一致性判据:结果种类要与已结清的状态相符,
失败类还要求错误文本与会话的 `lastError` 相等)。`ok` 类补写没有可交叉核对的文本,
**属残留信任,已在源码注明**。

**读者能观察到的**:见 §2 末段——终态先于审计行可见的那个短窗口。

---

## §6 六个状态,三个终态,语义各不相同

```
pending  --claim-->            running
retrying --claim-->            running
running  --attempt:ok-->       done
running  --attempt:error-->    retrying | failed   (看 attempts vs maxAttempts)
running  --attempt:timeout-->  retrying | failed
pending / running / retrying --cancel--> cancelled
```

**三个终态不是一回事,别用一个判据打发**:

| 终态 | 含义 | 会被自动重跑吗 | 有审计行吗 |
|---|---|---|---|
| `done` | 某次尝试成功 | 否 | 有(该 attempt 的 ok 行) |
| `failed` | 尝试次数耗尽 | 否 | 有(最后一次失败行) |
| `cancelled` | 宿主下令停止 | **永不** | 从 `running` 取消时有一条墓志铭行;从 `pending`/`retrying` 取消时**没有**(当时没有在飞的尝试,伪造一个 attempt 号会污染逐次审计史) |

**判定终态请用 `isTerminal(state)`,不要写 `state === 'done' || state === 'failed'`。**
后者正是 0.76.0 加 `cancelled` 时在场景层留下三处漏读的写法——默认配置下会让工作流与
目标追逐**永久挂死**(设计审视 F1)。src 内现有治理守卫禁止这个拼法。

**取消 vs 在飞尝试,两个方向都钉死了**:
- 取消先落账 → 被中止的 executor 迟到的 `recordOutcome` 抛 `InvalidTransitionError`,
  **驱动器静默丢弃这一种拒绝**(用户取消不该读成驱动器故障,不发 `driver:error`);
- 尝试先落账 → 对 `done`/`failed` 取消会抛错(已结清的结果不可改写成取消),
  对 `retrying` 正常取消。
- **`cancelSession` 不会中止你的 executor**——台账不持有执行器。中止你自己的运行时是宿主的事,
  两件事什么顺序都可以。

---

## §6.5 重开:终态不可变的正解(0.79.0)

「这件事失败了,我要再跑一次」——注意它**不是**一次状态流转。终态没有出边,而且这一点
正是 §3 的 CAS 围栏、幂等派发与「重启不复活已结清会话」共同的立足点:一旦 `done`/`failed`
变成「暂时结清」,每一条把终态当最终的不变量都要重审。

所以 `reopenSession(id)` 造的是**一条新会话**,并把来路记在 `reopenOf` / `attemptRound`
两个字段上:

```
job (failed)  ←reopenOf─  job#r2 (failed)  ←reopenOf─  job#r3 (pending)
   round 1                    round 2                      round 3
```

- 前驱**必须是终态**(否则同一件事会被跑两遍);
- `cancelled` 前驱**默认拒绝重开**——取消的意思是「永远停下」,常规重试环不该悄悄推翻它;
  确要重开传 `{ force: true }`,链上照样留痕;
- 后继 id 从**链根**派生(`job#r3` 而非 `job#r2#r3`),整条链一个前缀 grep 得到;
- `reopenChain(id)` 传链上**任何一环**都返回整条链——拿着一行记录的审计者不该先知道
  自己拿的是头还是尾。

**并发上的性质**:重开走的是普通 `dispatch()`,故享有同一套重复 id 守卫——两个宿主同时
重开,只会生成一条会话,输的那个拿 `DuplicateSessionError`。前驱**分毫不动**。

## §7 并发上限与「未认领」的关系

`LedgerDriver.maxConcurrent` 不设 = 无上限:一 tick 内全部到期会话同时起飞。
细节与三条会堆出积压的路径见 `README.md`;这里只讲**与并发语义相关的那一点**:

**上限必须落在认领处,不能落在 executor 里。** 一旦会话被认领,它就已经是 `running`、
`attempts` 已 +1、租约已开始走。此时在 executor 里排队 = **让租约在队列里空烧**,
排够久还会被自己的清扫器判为过期。所以驱动器的做法是**只认领自己有空位跑的数量**,
其余的**分毫不动**留在库里(仍是 `pending`/`retrying`、仍到期、无 attempts 增量、无租约),
下一 tick 再说。

**零空位的那一 tick 仍然会跑租约清扫**——驱动器打满,恰恰是死掉的对端需要回收租约的时候。

---

## §8 驱动器自身的生命周期竞态

- **`start()` 幂等**,并且每次 `start()` 开一个新**代(generation)**。仍在飞的旧代 tick
  发现代号不匹配就自行终止,**不会**再排下一次轮询——所以 stop-then-start 不会分叉出第二条轮询链。
- **`stop()` 会等**:先等在飞的 tick(`claimDue` 一旦发出就取消不掉),再中止并等待
  **本代及更早**的尝试。一个「陈旧的 stop」(在等 tick 时有人 `start()` 了新代)
  只会中止它自己那一代,不碰新代的活。
- **停止时被中止的尝试记为 `error`**,于是走正常重试路径——重启后自然续跑,不会卡在 `running`。
- **`onEvent` 回调抛异常一律被吞掉**。观测缝不能把驱动器带垮。

---

## §9 你的 store 需要保证什么(核对清单)

写完拿 `runLedgerStoreContractSuite` 跑一遍(样板见 `ONBOARDING.md`)。契约本身是:

1. `putSession` 是**按 id 整行创建或替换**,不是打补丁;
2. `listSessions` 的 `states` 与 `dueBefore` 两个筛选**都要实现,且能同时生效**;
3. `appendQuery` **只追加**,`listQueries` 按追加顺序返回该会话的行;
4. 进出都**存副本**,不要把内部活对象交出去;
5. **可选** `putSessionIf`:CAS 必须相对其他 store 调用原子(跨进程唯一解,见 §3);
6. **可选** `deleteSession`:删会话**必须连它的 query 行一起删**。

多写一句:契约套件测的是**语义**,测不了**原子性**——你的 `putSessionIf` 是不是真原子,
只有你的存储引擎能回答。SQL 用 `UPDATE ... WHERE revision = ?` 并检查影响行数;
别用「先 SELECT 再 UPDATE」,那正是它要防的东西。

---

## §10 已知边界(不修,写明)

- **跨进程 purge 无围栏**。`purgeSession` 删的是行,行没了就没有版本可比,CAS 无从下手。
  规矩:**从一个地方 purge**,且只 purge 老到没人再看的会话。
- **跨实例读窗口**。§2 末段那个窗口在同实例内已关闭,跨实例/跨进程仍在。
- **`listSessions` 无上限**。`Scheduler` 的跨重启恢复目前是**无过滤全表扫**,每次
  `start()` 付一次,成本随全部历史线性增长。已知,未修(产品审视记录在案)。
- **`dailyAt` 只认 UTC**,无时区/DST。北京时间请自行换算。
