# ONBOARDING — 30 分钟接上一个循环任务

> 本档解决一件具体的事:**你要写的那个 `LedgerStore` 长什么样。**
>
> 本包刻意不内置存储实现(需求档 §7 非目标:不把消费方绑在某个数据库上),但产品审视
> 2026-07-26 实测发现代价被转嫁了——仓内两个真实消费方各自手写了文件型 store,
> **43 行 / 38 行、逐行相似度 86%**;而本包对这件事原本给出的唯一帮助是一套 16 项契约
> 套件用来检查你抄得对不对。**套件的存在本身就承认这活容易写错,却没给那份"抄什么"。**
> 守密人 2026-07-26 裁定:发一份文档样板(不发代码——§7 不变)。下面就是那份样板。

---

## §1 五分钟版:内存 store

拿去改。这份**不做持久化**,适合先跑通、写测试、看事件流。

```ts
import type { LedgerStore, QueryRecord, SessionFilter, SessionRecord } from 'silver-core-maestro-sdk';

export function memoryLedgerStore(): LedgerStore {
  const sessions = new Map<string, SessionRecord>();
  let queries: QueryRecord[] = [];
  return {
    async putSession(record) {
      // 创建或整行替换(不是打补丁),且必须存副本 —— 见 §3 陷阱 1
      sessions.set(record.id, { ...record });
    },
    async getSession(id) {
      const row = sessions.get(id);
      return row === undefined ? null : { ...row };
    },
    async listSessions(filter?: SessionFilter) {
      let all = [...sessions.values()];
      // 两个筛选字段都要实现,且要能同时生效 —— 见 §3 陷阱 2
      if (filter?.states !== undefined) {
        all = all.filter((s) => filter.states!.includes(s.state));
      }
      if (filter?.dueBefore !== undefined) {
        all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= filter.dueBefore!);
      }
      return all.map((s) => ({ ...s }));
    },
    async appendQuery(record) {
      queries.push({ ...record }); // 只追加,永不改写既有行
    },
    async listQueries(sessionId) {
      // 按追加顺序返回该会话的行
      return queries.filter((q) => q.sessionId === sessionId).map((q) => ({ ...q }));
    },
    // 可选缝(0.78.0):不实现则台账只增不减 —— 见 §4
    async deleteSession(id) {
      if (!sessions.has(id)) return false;
      sessions.delete(id);
      queries = queries.filter((q) => q.sessionId !== id); // 连 query 行一起删,必须
      return true;
    },
  };
}
```

## §2 生产起步版:单文件 JSON store

跨重启恢复靠的就是这个。**原子改名**保证进程被杀时不留半个文件。

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function fileLedgerStore(filePath: string): LedgerStore {
  const state: { sessions: Record<string, SessionRecord>; queries: QueryRecord[] } =
    existsSync(filePath)
      ? JSON.parse(readFileSync(filePath, 'utf8'))
      : { sessions: {}, queries: [] };
  const save = (): void => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath + '.tmp', JSON.stringify(state, null, 2) + '\n');
    renameSync(filePath + '.tmp', filePath); // 原子:要么旧文件,要么新文件
  };
  // ...其余方法与 §1 相同,每个写方法末尾多一句 save()
}
```

**明写它的天花板**:每次写都全量重写整个文件,规模是 O(全表)/写。一个每天 2 会话的巡检
任务一年约 730 会话,这份实现完全够用;要跑成千上万会话就该换 DB(此时 §4 的保留策略
与 `putSessionIf` 的跨进程围栏才真正开始重要)。完整可运行版见
`examples/store-patrol.mjs` 的 `fileLedgerStore`。

## §3 写完必跑契约套件

**不要靠读文档确认自己写对了。** 本包随包发一套自检:

```ts
import { runLedgerStoreContractSuite } from 'silver-core-maestro-sdk';

const report = await runLedgerStoreContractSuite(() => memoryLedgerStore());
if (!report.passed) console.error(report.results.filter((r) => !r.ok));
```

每项检查都拿一个**全新** store(所以检查之间无顺序依赖),失败落报告而**不抛出**。
实现了可选缝的 store 会自动多跑对应检查(`putSessionIf` 3 项 / `deleteSession` 4 项)。

**四个最常踩的陷阱**(每条对应套件里的一项检查):

1. **返回了 store 内部的活对象**。宿主拿到后一改,台账状态就被从读侧改掉了。
   进出都存副本(`{ ...row }`)。
2. **`listSessions` 只实现了一个筛选字段,或两个不能同时生效**。驱动器认领到期会话用的正是
   `{ states, dueBefore }` **同时**生效;只实现一半 → 认领到不该认领的会话。
3. **`appendQuery` 写成了 upsert**。审计行是只追加的,改写既有行会让「同一 attempt 的
   committed 行」判定失效,进而破坏崩溃后的补写修复。
4. **`deleteSession` 只删了会话行**。留下的孤儿 query 行正是这条缝要治的累积;
   而且 id 复用时会翻出上一世的 attempt。

## §4 接线之后必须自己决定的三件事

`README.md`「宿主必须自己决定的三件事」有完整版,这里只给一句话与默认值:

| 事 | 不设的后果 | 怎么设 |
|---|---|---|
| **并发上限** | 一 tick 内全部到期会话同时起飞(实测 200 到期 → 峰值 200) | `new LedgerDriver({ maxConcurrent: N })` |
| **保留策略** | 台账**只增不减**,永久累积 | store 实现 `deleteSession?`,经 `ledger.purgeSession(id)` 清理**终态**会话 |
| **放弃口** | `WorkflowRun.run()` / `GoalChaser.chase()` **无限等待** | 传 `{ signal }`,或至少设 `drainTimeoutMs` |

**失败之后要重跑怎么办**:别自己造 `:r2` 这样的新 id(那是 0.79.0 之前每个宿主各自
发明的做法,代价是同一件事在台账里裂成互不相干的几行)。用 `ledger.reopenSession(id)`——
它造一条链回前驱的新会话、拒绝重开非终态、默认拒绝重开已取消的,`reopenChain(id)` 再把
整条链还原出来。细节见 `CONCURRENCY.md` §6.5。

**保留策略的反作用,先读再动手**:有些会话 id **本身就是簿记**。删
`sched:{specId}:{fireAt}` 会让 `Scheduler` 恢复丢失足迹并重锚(那个 spec 会被当成从未跑过);
删 `wf:{graph}:{run}:{node}` 会让工作流重发该节点。**保留策略须保住每个 spec 的最新触发点,
且不碰未完成的 run。**

## §5 最小骨架:台账 + 驱动器

```ts
import { TaskLedger, LedgerDriver } from 'silver-core-maestro-sdk';

const ledger = new TaskLedger({ store: fileLedgerStore('./state/ledger.json') });
const driver = new LedgerDriver({
  ledger,
  maxConcurrent: 4,
  queryTimeoutMs: 30_000,
  executor: async (session, ctx) => {
    // ctx.signal 在超时与 driver.stop() 时中止 —— 请把它传给你的 fetch / query
    const result = await doTheWork(session.payload, ctx.signal);
    return { outcome: 'ok', summary: result.oneLine };
  },
  onEvent: (e) => console.log(e.type, 'session' in e ? e.session.id : ''),
});

// 幂等派发:同一个 id 再派一次抛 DuplicateSessionError —— 这就是「今天已经跑过了」
await ledger.dispatch({ id: `patrol:${today}`, intent: 'daily patrol', payload: {...} });
driver.start();
// ...宿主自己决定何时停(它持有 main())
await driver.stop();
```

**这就是全部必要接线**。`Scheduler`(定点触发 + 错过补偿)、`WorkflowRun`(依赖图)、
`GoalChaser`(跨轮次目标)都长在这两个零件之上,可以完全不用——硬性质①:
**零件可单独拿取,整箱不要。** 本包不声明对代理 SDK 的依赖,`executor` 里要不要调 agent
是宿主的自由(商店巡检的 executor 就是裸 HTTP)。

## §6 成熟度提醒

`README.md`「状态」节按两级标尺标了每族的成熟度。**本档教的 `TaskLedger` / `LedgerDriver` /
`Scheduler` 三族是「已验证」**(两个互不相干的真实消费方在用);workflow / goal / delivery
当前是**实验面、无生产消费方**,签名与语义可能随第一个真实消费方调整。接线前先看那一节。
