# Silver Core Maestro SDK 设计审视（0.77.0）

> 审视人：艾瑞卡（2026-07-26 会话）· 对象：`projects/silver-core-maestro-sdk/` src 全量 16 档 3,212 行
> 判据来源：需求裁定书 `scs-req-orchestrator-sdk-20260717.md` · 包内 `CONTEXT.md` 三条硬性质 · `CHANGELOG.md`
> **纪律声明**：以下 5 条发现全部经**复现程序实测**，非读码推断；探针为一次性脚本，验毕即删（见各条「实证」段）。

---

## §0 总评

这个包的**工程质量高于本仓平均线**，且高出不少。值得先记账的四件事：

1. **纯核分离到位**：`state.ts` / `schedule/spec.ts` / `workflow/graph.ts` / `goal/decision.ts` 四个零 I/O
   零时钟纯函数核，全部是变异测试靶（地板 97.14–100，周检 CI 值守）。副作用被挤到外层薄壳。
2. **零电池贯彻**：`LedgerStore` 只定接口不带实现，`DeliverySink` 同理。硬性质「库不是框架」不是口号——
   `examples/store-patrol.mjs` 用了台账 + 驱动器却**完全没 import 代理 SDK**，证明零件真能单拿。
3. **每条防御都带审计溯源**：注释里的 `audit r2 / r4 / r5`、`review finding 2026-07-18` 让每个看起来
   多余的守卫都能回答「谁在哪一轮撞过这个坑」。这是本仓最好的一份代码注释。
4. **不假装安全**：`putSessionIf` 是**可选**缝，且明写「不实现时跨进程独占性是宿主的问题——每个 store
   只跑一个认领驱动器」。给出退化边界而非糊过去，比多数库诚实。

下述 5 条是在这个基线之上的设计缺口。**没有一条是「写错了」，全部是「射程没跟上」**——
这也是为什么它们逃过了 67 项五轮审计和 362 个单测。

---

## §1 F1【高 · 规格违反】`cancelled` 终态没穿透场景层

### 现状核实

0.76.0 给状态机加了第六态 `cancelled`（BPT 需求 P0-D1：用户主动取消是一等终态）。需求档 §4 明写：

> `terminal = done / failed / cancelled`

台账层与驱动器改得很彻底（CHANGELOG 0.76.0 逐条列了 6 组改动）。但**场景层三处仍硬编码
「done 或 failed」**，一处都没跟着改：

| 位置 | 代码 | 后果 |
|---|---|---|
| `src/workflow/graph.ts:180` | `if (state === 'failed') return 'failed'` | cancelled 节点既非 failed 也非 done → `allDone=false` → 图状态**永远 `running`** |
| `src/goal/chaser.ts:218` | `state === 'done' \|\| state === 'failed'` | cancelled 轮次**永不满足终态判定** |
| `src/driver.ts:279` | 同上 | 取消**不发 `session:terminal` 事件**（观测缺口，非挂死） |

叠加两个放大因素：

- `WorkflowRun.run()` 与 `GoalChaser` 的 `drainTimeoutMs` **默认不设 = 无限等待**（源码注释原话
  「unset = wait indefinitely」）。所以默认配置下，取消一个节点 / 一轮 = 编排器**永久挂死**。
- `TERMINAL_STATES`（`['failed','done','cancelled']`，值是对的）**在 src 里零消费**——
  `rg TERMINAL_STATES src/` 只命中定义与 re-export，实际消费全在测试。
  **有一个正确的常量，没有任何生产代码用它。**

### 实证

四例探针（vitest，假钟）：

- P1 `graphStatus({a:'cancelled'})` → 返回 `'running'`（断言通过）；
- P2 dispatch 节点 a → `cancelSession` → `run({drainTimeoutMs:100})` → **抛 drain timeout**；
- P3 dispatch 轮 1 → `cancelSession('goal:g1:round-1')` → `chase()` → **抛 drain timeout**；
- 全 4 例通过（exit 0），即上述后果全部成立。

### 为何这条最要紧

0.76.0 存在的**唯一理由**就是「用户点了取消」。而在默认配置下，用户点取消 → 工作流 / 目标追逐
永久卡住。功能的动机场景恰好是它的失效场景。

小学生比喻：给电梯加了「紧急停止」按钮，按钮本身接得很结实，**但楼层显示屏不认识「已停止」这个状态**，
于是永远显示「正在运行中」，等电梯的人就一直等下去。

### 修法建议（不越权，仅陈述）

`graphStatus` 把 cancelled 归入哪一档是**语义裁定**（fail-fast 归 failed？新增第四档 `cancelled`？
还是当作 done 放过下游？）——三种都自洽，选哪种是守密人的事。技术上三处都应改为消费
`TERMINAL_STATES` 而非重写字面量，这样第七态（若有）不会再漏一次。

---

## §2 F2【高】驱动器无并发上限

### 现状核实

`LedgerDriver.#tick()` 拿到 `claimDue()` 的全部结果后：

```ts
for (const session of claimed) {
  const attempt = this.#runAttempt(session, generation);   // 不 await
  ...
}
```

链路上**三处都没有帽子**：`SessionFilter` 没有 `limit` 字段 · `claimDue` 不接批量上限 ·
`#tick` 的循环不串行化。到期多少就同时起飞多少。

### 实证

探针：200 个立即到期会话 + 一个 50ms 的 executor，断言**首次任何 attempt 完成之前**的峰值并发：

```
expect(peak).toBe(200)   // 通过
```

即峰值并发 = 到期会话数，一比一。

### 为何是设计问题而非调参问题

对 BPT 而言一次 attempt = 一次**付费** API 调用。三条现实路径都能一次性堆出大批到期会话：

1. `catchUp: 'all'` + 一次停机 → `firesBetween` cap=100 → 恢复瞬间 **100 个 fire 同时起飞**；
2. `WorkflowRun` 的扇出层（无依赖的节点一次全 ready）→ 宽图一次全发；
3. 宿主重启后 store 里积压的 pending 一次全due。

宿主想限流，当前**没有缝可用**——只能自己在 executor 里排队，而那时 attempt 已经被认领（`running`
且 attempts 已 +1，租约已起算），排队等于让租约在队列里空烧。

小学生比喻：食堂窗口把「今天来吃饭的人」一次全放进厨房，厨师有多少只手不管；
想限流只能让人先领了餐盘再排队，可餐盘上的计时器已经开始跑了。

---

## §3 F3【中】台账只增不减，接口层没有保留缝

### 现状核实

`LedgerStore` 六个方法：`putSession` / `getSession` / `listSessions` / `appendQuery` /
`listQueries` / `putSessionIf?`。**没有任何 delete / prune / 截断能力。**

于是：

- `store-patrol` 生产循环每天 2 会话 + 2 query，**永久累积**（当前 `state/ledger.json`
  4 会话 / 4 query / 3,940 字节，因 07-19→07-25 推送腿断裂 7 天只落了两个日期；修复后按
  每天 2 条计，年化 ~730 会话）；
- `createDeliveryChannel` 每送达一条消息写一条审计会话，`delivery:{uuid}`，同样永不回收；
- `Scheduler.#recover()` 每次 `start()` 做**无过滤全表** `listSessions()`（`scheduler.ts:179`），
  再经 `TaskLedger.listSessions` 逐行浅拷贝——恢复成本随全部历史线性增长，且这是**每次启动**都付。

示例文件店每写一次全量重写 JSON（`putSession`/`appendQuery` 各调一次 `save()`），
年化是 O(n²)。这一条示例侧已诚实注明「生产宿主该注入 DB」，**不算缺陷**；
真正的设计缺口是：**接口层没给宿主实现保留策略的缝**，宿主要清理只能绕过 SDK 直接动库，
那就绕过了 CAS 围栏与 per-session 互斥。

小学生比喻：记账本设计得很严谨，每一笔都不许涂改——但**没设计怎么换新本子**，
于是只能一直往同一本上写，还得每次从第一页翻起才知道上次记到哪。

---

## §4 F4【中】两个长跑组件没有中止缝

同一个包里三个长跑组件，三套生命周期约定：

| 组件 | 停 | 中止在飞工作 |
|---|---|---|
| `LedgerDriver` | `stop()`（await 在飞 tick、按 generation 隔离） | ✅ 给 executor 发 `AbortSignal` |
| `Scheduler` | `stop()`（同款 generation 隔离） | 不适用（只派发） |
| `WorkflowRun.run()` | ✗ 无 | ✗ 不收 signal |
| `GoalChaser.chase()` | ✗ 无 | ✗ 不收 signal |

后两者唯一的逃生口是 `drainTimeoutMs`，而它**默认不设 = 无限**。宿主要中途放弃一个工作流 /
目标追逐，只能让 promise 悬着（其 `#clock.setTimeout` 句柄也从不 clear，`run.ts:207` / `chaser.ts:228`）。

驱动器把 generation 隔离、stop-await-tick、AbortSignal 三件事做得很讲究，说明这套约定包内是有的；
问题是它只覆盖了三个长跑组件里的一个半。F1 之所以能挂死，也正是因为这两个组件缺中止缝——
有 stop() 的话「取消挂死」至少是可救的。

小学生比喻：三个人一起干活，只有一个人身上装了「停」的开关，另两个开始干就没法叫停，
只能提前跟他们约好「最多干多久」——而那个约定默认是「不限」。

---

## §5 F5【中】状态机无「重开」边，宿主各自发明绕行

`failed` 是终态无出边，`SessionEvent` 里也没有 reopen / requeue。于是生产例程自己造了绕行
（`examples/store-patrol.mjs:205-210`）：

```js
let existing = await ledger.getSession(id);
while (existing !== null && existing.state === 'failed') {
  id = `${baseId}:r${(n += 1)}`;          // 换个 id 重开一条
  existing = await ledger.getSession(id);
}
```

绕行的三笔代价：

1. **同一件事在台账里裂成多条会话**（`patrol:x:date` + `:r2` + `:r3`），审计要靠 id 前缀拼；
2. 每个失败日的 failed 行 + rN 行**全部永久留存**（叠加 F3 的无保留缝）；
3. 「重开」的语义**由每个宿主各自发明**——SDK 定了封闭状态机却把这条常见需求留在门外，
   下一个宿主会造出第二套不一样的绕行。

注意这不是「状态机该开个 failed→pending 的口子」那么简单：终态不可变是这套设计的立身之本
（CAS 围栏 / 幂等 / 不复活全靠它）。**「重开」到底该是新会话 + 显式 `supersededBy` 链，
还是一等 reopen 事件，是设计裁定**，不是补丁。

小学生比喻：作业本规定写错的题不许擦，只能重抄一遍——规定本身是对的，
但没告诉学生「重抄的那题怎么跟原题对上号」，于是每个学生自己发明一套标记法。

---

## §6 F6【低 · 边界非缺陷】`dailyAt` 仅 UTC

`nextFireAt` 的 `dailyAt` 走 `Date.UTC`，无时区参数、无 DST 处理。已在类型注释里写明
「every UTC day at hh:mm」，属**已文档化边界**。

本仓自己靠换算纪律活着（CLAUDE.md §2.1「cron 等以 UTC 落地的配置须换算」，商店巡检
北京 15:15 = UTC 07:15）。代价是「每天当地 9 点」在有 DST 的地区**不可表达**——
夏令时切换后会漂一小时。BPT 若面向多时区用户排期，这条会变成需求。

小学生比喻：闹钟只认格林威治时间，你要它七点响就得自己先算好时差；
平时没事，但一到换夏令时那天，它还是按老账算。

---

## §7 交叉观察：这 5 条为什么能躲过 67 项审计

五轮审计（r1–r5，67 项真缺陷）+ 362 单测 + 六靶变异棘轮，是本仓最密的火力网。它没抓到这 5 条，
原因值得记一笔——**它们全都不是「某个函数算错了」，而是「某个约定的射程没铺满」**：

| 审计火力 | 擅长 | 对这 5 条为何哑 |
|---|---|---|
| 变异测试（地板 97–100） | 单函数分支是否被行为钉死 | `graphStatus` 每个分支都被钉死了——**钉的是它现在的语义**，缺一个 case 不产生存活变异体 |
| 性质测试 fast-check | 单核不变量 | 三套性质测试各测**一个核**；F1 是跨核一致性（state.ts 认识 cancelled，graph.ts 不认识）|
| 故障注入（r4）| 崩在哪都不坏账 | 注入的是**故障**，F2 是「一切正常时也会同时打 200 个请求」|
| 契约套件（G1）| 宿主 store 是否合约 | 只能测**已定义**的方法；F3 是「该定义的方法没定义」|

推论（可复用）：**加一个枚举值时，真正的工作量不在改状态机，在找齐所有「隐式假设旧枚举集」的读方。**
这类缺口的成本极不对称——写方一行，读方 N 处，而 N 处里漏掉的那几处不产生任何测试信号。

对应的机器化手段（若守密人要架）：**禁止在 src 里出现字面量终态比较**，一律经 `TERMINAL_STATES`；
这条可由治理测试（grep 级）机械执法，且它正好属于本仓「哨兵化标尺」那条一句话判据
（`memory/methodology.md`）——「它是否依赖某人在正确的时刻想起某件事？」目前的答案是「是」。

---

## §8 硬性质合规复核（三条红线，全部通过）

| 硬性质 | 判定 | 依据 |
|---|---|---|
| 1 库不是框架，宿主持有 main() | ✅ | `store-patrol` 例程完全不 import 代理 SDK 即可用台账 + 驱动器；四个纯核可单独 import |
| 2 对代理 SDK 无特权通道 | ✅ | src 全量零 `silver-core-sdk` import（本包 src 根本不 import 代理侧）；CI `check-dep-direction` 在 required 检查集内 |
| 3 数据面在 SDK、渲染在宿主 | ✅ | `DeliverySink` / `onEvent` 三处观测缝均为宿主注入，且回调异常一律吞掉不带垮组件 |

版本钟锁步：`package.json` 0.77.0 = agent 0.77.0 ✅ · `MAESTRO_SDK_VERSION` 常量 0.77.0 ✅。

---

## §9 待裁清单（不含已判定为非缺陷的 F6 语义部分）

| # | 事项 | 性质 |
|---|---|---|
| F1 | `cancelled` 穿透场景层三处 + `graphStatus` 归档语义（failed / 新第四档 / 放过） | 规格违反，需语义裁定 |
| F2 | 驱动器并发上限缝（`maxConcurrent`？`SessionFilter.limit`？两者？） | 新接口面，需裁 |
| F3 | 台账保留缝（`LedgerStore.deleteSession?` 可选缝？归档导出？） | 新接口面，需裁 |
| F4 | `WorkflowRun` / `GoalChaser` 补 `AbortSignal` 或 `stop()` | API 一致性，需裁 |
| F5 | 「重开」语义（新会话 + supersededBy 链 vs 一等 reopen 事件 vs 维持宿主自理） | 设计裁定 |
| — | 治理：禁止 src 内字面量终态比较的哨兵 | 可随 F1 一并落 |

---

## 附：审视方法

- 读全部 16 个 src 档（3,212 行）+ `CONTEXT.md` + `CHANGELOG.md` 0.76.0 全文 + 需求裁定书相关节
  + 4 个 examples；
- 5 条发现各写一次性 vitest 探针实测（假钟，无真实时钟），**探针验毕即删**——不留 scratch 档在树里；
- 交叉核对 `rg` 全仓：`TERMINAL_STATES` 消费点 · 并发相关标识 · `listSessions` 全部调用点 ·
  src 内裸全局时钟（结果：零裸全局，全部经 Clock 缝，这一条查过是干净的）。
