# ASSEMBLY — 四原语接线谱

> 设计第三轮产物(2026-07-29,裁定 D3:**不建 LoopRunner,组合即 loop**——本档
> 就是需求档 §3「loop 骨架」条的兑现形态)。四个原语(loop / 例程 / goal /
> 后台任务)全部用现有零件拼出;三个原语的缺口收敛为同一件零件
> `createAgentExecutor`,只有例程需要 `RoutineManager` 管理面。
> 全档设计依据:`Public-Info-Pool/Resource/repo-engineering/maestro-sdk-agent-assembly-design-20260729.md`。

先读 `docs/ONBOARDING.md`(store 样板)与 `docs/CONCURRENCY.md`(并发语义);
本档只讲**怎么接**。

## 0. 执行座位:createAgentExecutor(注入式)

一切装配的公共件。把 agent SDK 的 `query()` 装进 `LedgerDriver` 的 executor
座位——**注入,不 import**(裁2):本包对 `silver-core-agent-sdk` 保持零 import、
零运行时依赖;宿主把自己的 `query` 函数递进来,结构化类型对上即可。

```js
import { LedgerDriver, TaskLedger, createAgentExecutor } from 'silver-core-maestro-sdk';
import { query } from 'silver-core-agent-sdk';   // 宿主侧 import——这正是分界

const ledger = new TaskLedger({ store });        // store: 宿主注入(ONBOARDING 样板)
const driver = new LedgerDriver({
  ledger,
  executor: createAgentExecutor({
    query,                       // 唯一必填:注入缝
    onMessage: (session, m) => ui.liveFeed(session.id, m),   // task_* 子代理消息由此过河
    onResult:  (session, r) => db.saveRich(session.id, r),   // agentSessionId / raw 富数据
  }),
  maxConcurrent: 2,              // 一次 attempt 一次付费调用——生产必设(README 三件事)
  queryTimeoutMs: 10 * 60 * 1000,
});
driver.start();
```

会话 payload 约定(默认提取器 `extractPlainAgent` 读取):

```js
await ledger.dispatch({
  id: 'agent:brief:2026-07-29',
  intent: 'agent:daily-brief',
  payload: { agent: {
    prompt: '总结今天的巡检快照。',
    options: { model: 'claude-sonnet-5', maxTurns: 8 },   // 逐字透传
    maxBudgetUsd: 0.5,                                    // 并入 options.maxBudgetUsd
    // resume: '<agentSessionId>',                        // 显式续接(见「恢复」)
  } },
});
```

要点(全部有测试钉住):

- **fail-loud**:payload 没有合法请求 → attempt 以 error 落账走正常重试路径,
  绝不静默空转(当年 `/loop` 静默透传的教训)。
- **成本入账(D2)**:引擎报的 `total_cost_usd` 转录进 `QueryRecord.costUsd`;
  会话累计 = Σ `listQueries`,重开链累计沿 `reopenChain` 再 Σ。
- **中止**:驱动器 `queryTimeoutMs` / `stop()` 触发 `ctx.signal` →
  `interrupt()` 礼貌停,`interruptGraceMs`(默认 5s)内不收尾则 `close()` 硬停;
  超时最终由驱动器落 `timeout`。
- **重试 = 重跑(D6)**:不自动跨 attempt 续接。恢复是宿主的显式动作:
  `reopenSession(id, { payload: { agent: { ...原请求, resume: 上次 onResult 给的
  agentSessionId } } })`。

## 1. loop(周期值班循环)

**Scheduler + LedgerDriver + AgentExecutor,组合即 loop**——不存在也不需要
LoopRunner(D3;两个已验证消费方 store-patrol / testbed daemon 就是这么拼的)。

```js
import { Scheduler } from 'silver-core-maestro-sdk';

const scheduler = new Scheduler({
  ledger,
  specs: [{
    id: 'daily-brief',
    intent: 'agent:daily-brief',
    dailyAt: { hour: 7, minute: 15 },        // UTC
    catchUp: 'latest',
    payload: { agent: { prompt: '……' } },    // 信封里的 data.agent 默认提取器认识
  }],
  seedFirstRun: true,                        // 短命宿主(每日 CI)必开,见 G3
});
scheduler.start();   // 驱动器照 §0 起好;跨重启恢复、错过补偿全部自动
```

预算帽三层:单 attempt = `payload.agent.maxBudgetUsd`(引擎 R2 事件流执法);
单会话 = `maxAttempts` × 单 attempt;总量 = 宿主读 Σ `costUsd` 自行决策(库不设策)。

## 2. 例程(可管理的值班任务面)

`RoutineManager`(裁4)包住 Scheduler,补上管理四问:叫什么 / 停没停 /
下次几点 / 上次跑得怎么样——BPT 收件箱「值班例程区」的直接数据源。

```js
import { RoutineManager } from 'silver-core-maestro-sdk';

const manager = new RoutineManager({
  ledger,
  routines: [{ id: 'store-patrol', name: '每日商店巡检', intent: 'patrol',
               dailyAt: { hour: 7, minute: 15 }, payload: { agent: { prompt: '……' } } }],
  initiallyDisabled: await db.loadDisabledRoutines(),   // 停启表宿主持久化(D4)
  onEvent: (e) => { if (e.type.startsWith('routine:')) db.saveRoutineEvent(e); },
  seedFirstRun: true,
});
manager.start();

// UI 动作 → 调用(设计档 §9.2 映射表节选):
await manager.disable('store-patrol');          // 暂停
await manager.enable('store-patrol');           // 恢复
await manager.triggerNow('store-patrol');       // 立即巡检(幂等键 manual:{id}:{firedAt})
const panel = await manager.list();             // name / enabled / lastFireAt / nextFireAt / lastSession
```

**id 分段硬约束**:手动触发落 `manual:` 段,**绝不落 `sched:`**——Scheduler 恢复
只认 `sched:` 足迹,手动触发若混入会推进足迹、吞掉补偿窗口内本应补的正点
(共享解析器 `parseFirePoint` / `latestFirePoint` 是唯一真相,别自己 split)。

## 3. goal(跨会话目标循环)

引擎侧 `options.goal` 管**一次 query 内**达标(Stop 门);`GoalChaser` 管
**跨 query 轮次**。判词同形(家族正典 `{ status, reason? }`),一个 evaluator
可两处服役——但「内层达标 ≠ 外层达标」,措辞按缝位分开写。

```js
import { GoalChaser, extractGoalRound, createAgentExecutor } from 'silver-core-maestro-sdk';

const driver = new LedgerDriver({
  ledger,
  executor: createAgentExecutor({
    query,
    extract: extractGoalRound((p) => ({
      prompt: [
        p.goal.description,
        p.feedback === null ? '' : `上一轮未达标的裁判意见:${p.feedback}`,
        `(第 ${p.round} 轮)`,
      ].filter(Boolean).join('\n'),
      options: { model: 'claude-sonnet-5' },
    })),
  }),
  maxConcurrent: 1,
});
driver.start();

const abort = new AbortController();
const chaser = new GoalChaser({ ledger, evaluator, drainTimeoutMs: 30 * 60 * 1000 });
const { action, rounds } = await chaser.chase(
  { id: 'weekly-report', description: '产出可发布的周报', maxRounds: 5 },
  { signal: abort.signal },
);
```

介入全部现词汇,零新 API:中止(可回头)= `abort.abort()`;终止(永久)=
`cancelSession(goalRoundSessionId(id, n))`;调 maxRounds = abort 后带新配置重
`chase()`(resume 扫描自动续轮);注入人工意见 = evaluator 是宿主函数,意见并入
verdict.reason 即传给下一轮。

## 4. 后台任务(子代理 / agent 会话 / 脚本)三层表

| 层 | 领地 | 观测 | 停止 | 收件箱 |
|---|---|---|---|---|
| query 内子代理(Agent 工具) | 引擎(§7 不管 query 内部) | `task_*` 消息经 `onMessage` 过河 → 详情页实时区 | 宿主对 query 句柄 `stopTask` | **不进**(活不过父调用) |
| 跨会话 agent 任务 | 本包 | DriverEvent + 台账查询面 | `cancelSession` | 进(真相源) |
| 脚本任务(纯 HTTP/shell executor) | 本包 | 同上 | 同上 | 进;差异走 intent 词汇 |

一句话:**台账是收件箱的唯一真相源;引擎内子代理只进详情页实时区。**

## 5. Cowork 确认门(manualClaim 节点)

workflow 图(图即数据)承载 Cowork 生命周期投影,六态封闭机零新状态:

```json
{ "id": "cowork-task", "nodes": [
  { "id": "plan",    "intent": "draft-plan",
    "payload": { "agent": { "prompt": "按产物分步出计划……" } } },
  { "id": "gate",    "intent": "await-confirmation", "manualClaim": true, "deps": ["plan"] },
  { "id": "execute", "intent": "do-the-work", "deps": ["gate"],
    "payload": { "agent": { "prompt": "……" } } },
  { "id": "deliver", "intent": "deliver", "deps": ["execute"] }
] }
```

`manualClaim: true` 的节点以 `runAt: null` 派发:停在 `pending`+`manualClaim`,
`claimDue` 永不认领——**确认门的 executor 是人**:

```js
// 用户点「确认」:
await ledger.claimSession(run.sessionId('gate'));
await ledger.recordOutcome(run.sessionId('gate'),
  { outcome: 'ok', summary: '守密人确认', startedAt: Date.now(), endedAt: Date.now() });
// 用户点「全部拒绝」:
await ledger.cancelSession(run.sessionId('gate'), { reason: 'user-rejected' });  // fail-fast 收束
// 用户点「修改计划」(revising):
await ledger.reopenSession(run.sessionId('plan'), { payload: { revise: '用户意见' } });
```

投影表(Cowork 态 ↔ 台账词汇)与「UI 动作 → SDK 调用」18 条全表见设计档
§8 / §9;执行节点接 §0 的 AgentExecutor(`extractWorkflowNode` 读
`payload.node.agent`);交付通知走 `createDeliveryChannel`(审计先行,sink
宿主注入)。确认超时(用户一周不理)是宿主的定时 `cancelSession`——本包不
持这口钟(策略性决定归宿主,与「台账只增不减」同款)。
