# Silver Core Maestro SDK 缺陷审计战报 · 第一轮(T56)

- 日期:2026-07-18(UTC+8)
- 派发:守密人「设置目标:审核查证 500 个 bug 并修复,完善集成测试」口谕
- 方法:动态编排 17 路猎手(10 模块深读 + 7 横切面)→ 脚本去重 → 对抗查证
  (查证官持「存疑即毙」缺省)→ 8 批文件不相交修复(每项配 fail-on-old 回归锁)
  → 2 路集成测试补强;单脑整合亲跑全量 + 变异地板复测
- 账目:原始 50 → 去重 36 → **查证确认 29**(查证淘汰 7)→ **29/29 全处置**
  (27 代码修复 + 2 显式记档:台账重复守卫 get-then-put 单写方假设、
  驱动器持久店失败搁浅语义)
- 交付版本:silver-core-maestro-sdk 0.69.0(锁步家族版)
- 集成测试:`tests/integration-full-stack.test.ts`(3 例,五件同店共驻 + 停机安全,
  纯 fake timer)+ `tests/integration-restart.test.ts`(5 例,文件店崩溃重启:
  exactly-once 补偿 / workflow 续跑 / goal 续追 / 原子写)

## 诚实声明(§H,T51 纪律)

目标 500 为守密人设定的上限;本轮审计面为 src 1,769 行 + 全包 ~5.3k 行的新库,
且此前已经两轮对抗审查(5 项)与四变异靶(100/100/97.14→97.84/100)加固。
**第一轮真实确认 29 项,绝无编造凑数**;每项可回源核(file:line + 失败场景 +
原文引用 + 查证理由)。含此前两轮对抗审查的 5 项,累计真缺陷 34。后续轮次
换法再挖(修复回归审计 + 性质推理 + 换粒度横扫),挖到连续枯竭为止,届时
以「累计确认数」如实结案。

## 确认清单(29 项,按严重度)

### 1. [P1] `src/schedule/spec.ts:98` nextFireAt can return t == after for fractional `every`, making firesBetween loop forever

**断言**:For non-dyadic fractional `every` (which validateSpec explicitly accepts: 'finite and > 0', and tests/schedule.test.ts:68 pins `every: 0.5` as valid), the recomputed fire point anchor + steps*every can equal `after` due to float rounding: when fire_k = fl(anchor + k*every) is such that fl((fire_k - anchor)/every) rounds up to exactly k, then floor(...) = k, steps = k+1... but when the division rounds DOWN below k, floor = k-1, steps = k, and the function returns fire_k itself — violating the documented 'STRICTLY greater than after' contract (line 80). firesBetween's loop `t = nextFireAt(spec, 

**失败场景**:Host registers a spec derived by division, e.g. { id: 'poll', intent: 'x', every: 1000/3, anchorAt: 1752822000000 } (three fires per second anchored at a real epoch instant). validateSpec accepts it. On the first scheduler tick after the k=1 fire point enters the window, firesBetween computes t = 1752822000333.3333, pushes it, then nextFireAt(spec, 1752822000333.3333) returns 1752822000333.3333 again (floor((t-anchor)/every) = 0, steps = 1, anchor + 1*every == t). The while condition t <= untilInclusive remains true forever: infinite loop, scheduler stuck, event loop task never completes.

### 2. [P2] `.github/workflows/store-patrol.yml:52` Commit step skipped on partial patrol failure: successful targets' snapshots and ledger state silently discarded

**断言**:examples/store-patrol.mjs writes each successful target's {date}.json, latest.json, changes.jsonl and the persistent ledger file DURING the run, then calls process.exit(1) if ANY target ended 'failed'. In the workflow, the 'Commit and push if changed' step has no `if: always()` (or failure-tolerant equivalent), so when the 'Run store patrol' step exits 1, the commit step is skipped and every file written that day — including the other targets' successful snapshots, a freshly logged change event, and the ledger row recording the failure — is discarded with the runner. This also contradicts CONT

**失败场景**:Day N: steam-appdetails succeeds and detects a real price change (writes day-N snapshot, updates latest.json, appends the change to changes.jsonl); steam-review-summary hangs, exhausts 3 attempts, ends 'failed' -> process exits 1 -> commit step skipped -> all day-N writes vanish. Day N+1 checks out the STALE latest.json, re-detects the same price change and logs it with day-N+1's timestamp. Committed record: day-N snapshot missing entirely for a target that succeeded, and the append-only change log dates the change a day late — wrong audit data from a single endpoint outage.

### 3. [P2] `examples/minimal-loop.ts:121` Loop budget cap violated when queries overlap ticks: each concurrent query armed with the full remaining budget

**断言**:`remaining` is computed from `spentUsd` at query start, but `spentUsd` only accrues when a query's result message arrives (line 163). LedgerDriver runs claimed sessions concurrently (#tick launches #runAttempt without awaiting, and keeps polling), so whenever a query outlasts intervalMs, the next tick's session is claimed and its executor computes remaining from the same not-yet-updated spentUsd — each in-flight query gets maxBudgetUsd = the full remaining cap. Cumulative spend can reach N x remaining for N overlapping queries, violating the module's stated contract 'totalBudgetUsd: The LOOP's

**失败场景**:totalBudgetUsd = 0.05, intervalMs = 5000, agent queries take ~12 s (routine for multi-turn tool use). Tick 1's query is claimed at t~0 with maxBudgetUsd = 0.05; at t=5 s and t=10 s ticks 2 and 3 are dispatched and claimed while tick 1 is still streaming — each computes remaining = 0.05 - 0 and is armed with the full 0.05. All three can legally spend up to ~0.15 total (3x the loop cap) before any result message updates spentUsd and windDown fires.

### 4. [P2] `examples/store-patrol.mjs:188` Crash-orphaned 'running' session permanently wedges the day's patrol

**断言**:The idempotent-dispatch scan only advances past sessions in state 'failed'. A session left in 'running' by a hard crash (SIGKILL / OOM / CI runner timeout after the driver's claim putSession persisted state='running' to ledger.json, but before recordOutcome) is unrecoverable: TaskLedger.claimDue only lists states ['pending','retrying'] (src/ledger/ledger.ts line 117), and the state machine has no transition out of 'running' except an attempt outcome from the in-process driver that died. So every same-day re-run finds existing.state === 'running', exits the while loop, skips dispatch ('skipping

**失败场景**:Day X: CI dispatches patrol:steam-appdetails:2026-07-18, driver claims it (ledger.json now has state 'running'), the runner is killed mid-fetch (job timeout/OOM). Operator re-runs the workflow: scan sees state 'running' (not 'failed'), no :rN session is opened, driver never claims 'running' sessions, drain loop spins 120 s, throws 'store-patrol: drain timeout — sessions still open', exit 1. Every subsequent run that day fails identically; the target's snapshot for the day is never taken.

### 5. [P2] `src/delivery/channel.ts:71` Co-resident driver can steal the audit session in the dispatch->claimSession window

**断言**:deliver() dispatches its audit session as 'pending' with nextRunAt = now (dispatch defaults runAt to now), then only claims it in a SEPARATE awaited step. During that async window the row is indistinguishable from driver work: a co-resident LedgerDriver's claimDue (driver.ts:127) filters only on states ['pending','retrying'] + dueBefore, with no intent filtering, so a driver tick claims the 'agent-delivery' session and feeds it to the host executor. The channel's subsequent claimSession then runs transition('running','claim') which throws InvalidTransitionError (state.ts:89), so deliver() reje

**失败场景**:Host shares one ledger/store between a LedgerDriver (pollIntervalMs 1000, async file/db store) and a delivery channel, as the file-head comment blesses. deliver({body:'alert'}) awaits dispatch (store I/O); a driver tick fires in that window, claimDue returns the delivery session, executor is invoked with intent 'agent-delivery' it does not understand and records an 'error' outcome (maxAttempts 1 -> terminal 'failed'); the channel's claimSession then throws InvalidTransitionError, deliver() rejects, sink never called. The alert is never sent, yet the ledger contains a failed 'agent-delivery' se

### 6. [P2] `src/driver.ts:127` stop() can resolve while a tick's claimDue is in flight; sessions are then claimed and executed after stop

**断言**:#tick never re-checks #running after `await this.#ledger.claimDue(...)`, and the tick promise is not tracked anywhere stop() waits on (#inflight only holds attempt promises, and #controllers only gets controllers created inside #runAttempt). stop() sets #running=false, aborts the (empty) controller set, awaits the (empty) #inflight set, and resolves — then the pending claimDue settles, the loop mutates the store via putSession (state -> running, attempts+1, ledger.ts:121-131) and launches #runAttempt for each claimed session. Those attempts run with freshly created AbortControllers that nothin

**失败场景**:Host uses a DB/file-backed LedgerStore where claimDue takes ~50ms (listSessions + putSession round trips). t=0: poll fires, #tick awaits claimDue. t=10ms: host calls `await driver.stop()` — #controllers and #inflight are empty, so stop() resolves immediately; host proceeds to close the store / exit. t=50ms: claimDue resolves with session S, which is now written to the store as state='running', attempts+1; #runAttempt starts the executor with a signal that will never be aborted. If the store is already closed, recordOutcome throws and S is stranded in 'running' forever (no lease expiry in the l

### 7. [P2] `src/driver.ts:138` stop()-then-start() while a tick's claimDue is in flight forks two concurrent poll chains in one driver

**断言**:Because stop() resolves without awaiting the in-flight #tick (see the line-127 finding), a documented stop-then-restart of the same driver instance can leave the old tick alive: when its claimDue resolves it sees #running === true again (restarted), launches attempts, and calls #scheduleTick — creating a second self-perpetuating poll chain alongside the one start() created. #pollHandle only tracks the most recent timer, so the two chains coexist until the next stop() (each chain's next callback then dies on the #running guard, but until then both poll).

**失败场景**:Config-reload flow: tick T's claimDue is in flight on a slow store; host runs `await driver.stop(); driver.start();` (restart of the same instance is the documented resume story: 'a stopped-then-restarted driver resumes them through the normal retry path'). stop() resolves immediately (nothing tracked); start() schedules chain B. T's claimDue resolves, #running is true, T executes line 138 → chain A continues. Now two chains poll the store; whenever their ticks overlap in time (async store), both chains' claimDue calls interleave at await points and claim the same due session twice within ONE 

### 8. [P2] `src/driver.ts:187` recordOutcome failure strands the session in 'running' forever and discards the executor's result

**断言**:In #runAttempt, if ledger.recordOutcome throws (transient store failure), the catch only emits a 'driver:error' event and drops the attempt's outcome. The session was already claimed to state 'running' with nextRunAt null; claimDue only lists ['pending','retrying'], and no code path in the SDK (including driver restart) ever re-scans or recovers 'running' sessions. The retry/backoff machinery covers executor failures but not bookkeeping failures, so one store hiccup at exactly this write permanently parks the session and loses a possibly-successful executor result (outcome 'ok' + summary). If 

**失败场景**:DB-backed LedgerStore; executor finishes a session with outcome 'ok'. recordOutcome's store.putSession hits a transient network error and throws. Driver emits driver:error (or nothing, if no onEvent) and moves on. The session stays 'running' with nextRunAt null forever: claimDue never selects it, a GoalChaser or WorkflowRun awaiting it polls until drain timeout (or forever), and the completed work's summary is lost. Restarting the driver does not help.

### 9. [P2] `src/ledger/ledger.ts:104` dispatch accepts NaN runAt, creating a session that is never due and silently stuck in pending forever

**断言**:dispatch validates intent and maxAttempts but not runAt. NaN is not nullish, so `input.runAt ?? now` keeps NaN and the session is persisted with nextRunAt=NaN. The store contract's due filter is `nextRunAt <= dueBefore`, and NaN compares false to everything, so claimDue never lists the session; no error is ever raised. This is the exact NaN-poisoning class the campaign already hardened in state.ts (transition, backoffDelayMs) and in dispatch itself for maxAttempts — runAt is the remaining unguarded numeric input.

**失败场景**:Host computes a schedule time from parsing, e.g. `ledger.dispatch({ intent: 'report', runAt: Date.parse(userSuppliedDate) })` where the date string is malformed -> Date.parse returns NaN -> session stored as pending with nextRunAt=NaN -> every claimDue tick filters it out (NaN <= now is false) -> the task never runs, never fails, never surfaces an error; it sits in pending permanently and only a manual listSessions inspection would reveal it.

### 10. [P2] `src/ledger/ledger.ts:116` claimDue still steals inline (dispatch-then-claimSession) sessions: dispatch offers no way to create a session withheld from the due net

**断言**:The 2026-07-18 claimSession fix stopped the delivery channel from stealing the driver's work, but not the reverse. A session created for inline execution (dispatch then claimSession, the exact pattern claimSession's own doc prescribes and delivery/channel.ts implements) is persisted as pending with nextRunAt = now, i.e. immediately visible to a co-resident driver's claimDue between the two calls. If claimDue wins the window, it transitions the session to running, and the inline caller's claimSession computes transition('running', 'claim') which throws InvalidTransitionError. Sharing one ledger

**失败场景**:Driver polls every 1000ms against a DB-backed store; host calls deliver(msg). deliver awaits ledger.dispatch (audit row: pending, nextRunAt=now), and before its claimSession getSession lands, the driver's tick runs claimDue -> the audit session is due, gets claimed (running, attempts=1) and handed to the host Executor, which has no runner for intent 'agent-delivery'. deliver()'s claimSession then throws InvalidTransitionError, which per the audit-before-send contract propagates out of deliver() as a hard abort -> the message is never passed to the sink, the caller sees a crash instead of a rec

### 11. [P2] `src/ledger/state.ts:122` backoffDelayMs fallback returns non-finite policy.maxDelayMs verbatim, breaking its 'never Infinity/NaN' guarantee and silently wedging sessions in 'retrying'

**断言**:The overflow fallback trusts policy.maxDelayMs without checking it is a finite non-negative number, so a NaN/undefined/Infinity cap is returned as the delay even when the raw exponential delay was perfectly finite — Math.min(raw, NaN) is NaN, which fails the guard and the function then returns the poisoned cap itself, directly contradicting the function's documented contract on lines 113-114 ('capped at maxDelayMs. A non-finite blowup (factor overflow) lands on the cap, never on Infinity/NaN').

**失败场景**:Host constructs `new TaskLedger({ store, retry: { maxDelayMs: cfg.maxDelay } })` where cfg.maxDelay is undefined — this typechecks (Partial<RetryPolicy> without exactOptionalPropertyTypes, which the tsconfig does not enable) and the spread merge in ledger.ts line 76 overrides the default 60000 with undefined. First failed attempt of any multi-attempt session: recordOutcome calls backoffDelayMs(1, {...}) -> raw = 1000 (finite, normal), capped = Math.min(1000, undefined) = NaN -> guard fails -> returns undefined (declared return type: number). ledger.ts line 190 computes nextRunAt = now + undefi

### 12. [P2] `src/schedule/scheduler.ts:66` start() during an unsettled stop() forks a second permanent poll loop; stop() then can't drain it

**断言**:start() guards only on the #running flag and ignores a prior run's still-in-flight tick. A tick that was mid-await when stop() flipped #running false resurrects when start() flips it true again: on resume it passes the line-115 running check and unconditionally reschedules itself at line 126, while start()'s own #scheduleTick(0) spawns a fresh chain — yielding two self-perpetuating timer loops. Because #tickInFlight and #pollHandle are single-slot (overwritten at lines 98-103), a later stop() clears and awaits only the last-written chain; the other chain's in-flight tick outlives stop() resolu

**失败场景**:Host restarts synchronously — `scheduler.stop(); scheduler.start();` with stop() un-awaited (e.g. a sync config-reload or SIGHUP handler) — while tick t1 is awaiting `ledger.dispatch`. stop(): #running=false, clearTimeout no-ops on the already-fired handle, awaits t1 (promise ignored). start(): #running=true, schedules a 0-delay tick t2. t1 resumes, sees #running=true, completes, reschedules at line 126 → chains A (from t1) and B (from t2) both poll every pollIntervalMs indefinitely, each overwriting #pollHandle/#tickInFlight. Later the host does `await scheduler.stop()`: only chain B's handle

### 13. [P3] `.github/workflows/sdk-mutation-ratchet.yml:44` Single-target workflow_dispatch skip step is a no-op; full matrix always runs

**断言**:The 'Skip when a single target was requested and this is not it' step (present in both the agent 'ratchet' job, lines 42-44, and the maestro 'ratchet-maestro' job, lines 108-110) runs `exit 0` inside a step, which merely ends that step successfully. All following steps (checkout, npm ci, build, Stryker round, ratchet check) have no `if:` condition, so they execute unconditionally. In GitHub Actions, skipping the rest of a job requires a job-level `if:` or conditions on each subsequent step; a step exiting 0 does not skip anything. The `target` dispatch input is therefore entirely non-functiona

**失败场景**:Keeper dispatches the workflow with input target='ledger-state' expecting one ~7-12-minute Stryker round. Instead all 8 matrix jobs (4 agent + 4 maestro) run full mutation rounds (~1-1.5h of CI), and if any UNRELATED target (e.g. agent 'sessions') happens to sit below its floor that week, the dispatched run reds — the single-target run reports failure for a target the user explicitly excluded, making 'red' unusable as a signal for the requested target.

### 14. [P3] `README.md:24` README status section stale at 0.2.0: claims schedule/workflow/goal/delivery are future campaigns while they are shipped exports

**断言**:README's '## 状态' section states the package is at campaign 0+1 (0.2.0) and lists schedule, workflow graph, goal chaser and delivery contract as FUTURE campaigns ('后续战役:schedule、workflow 图、goal 追逐器、送达契约。'), while src/index.ts (the shipped public surface at 0.68.0) already exports all four ('export { Scheduler } from './schedule/scheduler.js';' / 'export { WorkflowRun, workflowSessionId } from './workflow/run.js';' / 'export { GoalChaser, goalRoundSessionId } from './goal/chaser.js';' / 'export { createDeliveryChannel } from './delivery/channel.js';') and CHANGELOG 0.4.0 records them as landed. 

**失败场景**:A consumer installing silver-core-maestro-sdk@0.68.0 reads the packaged README, concludes the scheduler / workflow graph / goal chaser / delivery channel do not exist yet ('后续战役' = upcoming campaigns), and builds their own — the README actively denies the majority of the package's actual public API surface.

### 15. [P3] `examples/minimal-loop.ts:134` Caller-supplied budget hooks in queryOptions.hooks are silently discarded, contradicting the pass-through contract

**断言**:queryOptions is documented as 'Pass-through to the agent query (model / provider / persistSession / ...)', and the hooks object spreads `...opts.queryOptions?.hooks` — but then the object-literal keys 'budget:threshold' and 'budget:exhausted' unconditionally REPLACE any hook groups the caller registered under those two events instead of appending to them (an array concat would preserve both). The caller's observers for exactly the two budget events this example is about are silently dropped with no error.

**失败场景**:Host calls runMinimalLoop({ ..., queryOptions: { hooks: { 'budget:threshold': [{ hooks: [alertOps] }] } } }) to page an operator when the cap threshold is crossed. The spread puts that group in, then the literal's own 'budget:threshold' key overwrites it; alertOps is never invoked even though the threshold event fires (result.thresholdSeen === true). No warning, no error.

### 16. [P3] `examples/minimal-loop.ts:175` Summary truncation slices UTF-16 code units and can end the summary with a lone surrogate

**断言**:The minimal-loop executor bounds the agent result with resultText.slice(0, 200), which cuts at UTF-16 code-unit index 200. Any astral-plane character (emoji, rare CJK-extension ideographs) straddling that boundary is split, leaving the persisted QueryRecord.summary ending in an unpaired high surrogate -- a malformed Unicode string written into the ledger as the canonical attempt summary.

**失败场景**:The demo prompt ('what time-of-day vibe is it?') gets a reply containing emoji; one emoji's high surrogate lands at index 199 and its low surrogate at 200. slice(0, 200) stores a summary whose last code unit is a lone \uD83D. Any downstream UTF-8 encoding of that summary (webhook sink, DB column, TextEncoder) mangles it to U+FFFD, and strict JSON consumers that reject unpaired surrogate escapes refuse the serialized record; the corruption is silent because the store write itself succeeds (JSON.stringify escapes the lone surrogate).

### 17. [P3] `src/delivery/channel.ts:48` Options doc says 'DEDICATED ledger — see the design constraint in the file-head comment' but the head comment says that constraint was removed

**断言**:DeliveryChannelOptions.ledger is documented as 'DEDICATED ledger — see the design constraint in the file-head comment', but the file-head comment (lines 10-14) states the opposite: claimSession 'removed the constraint' and the channel 'can safely share a ledger/store with a driver'. The two doc blocks in the same file contradict each other, so a host cannot tell which contract holds (and per finding 1, the dedicated-ledger reading is actually the only safe one). tests/delivery.test.ts line 14 still says 'DEDICATED to the delivery channel by design' while its 'claim surgery' test exercises a sh

**失败场景**:A host reading DeliveryChannelOptions in editor hover sees 'DEDICATED ledger ... design constraint', provisions a second store partition unnecessarily; another host reading the file head shares the ledger with a driver and hits the finding-1 race. Same file, two opposite contracts.

### 18. [P3] `src/goal/chaser.ts:165` Mid-chase dispatch collision throws unhandled DuplicateSessionError; chaser is not idempotent despite deterministic ids

**断言**:chase() calls ledger.dispatch() with the deterministic round id and no DuplicateSessionError handling, so any round session that comes into existence after the one upfront resume scan (line 143) crashes the chase mid-goal. Line 20 documents the round id as 'the idempotency/resume key', and the two sibling dispatchers built on the same pattern (workflow run.ts lines 137-144, scheduler scheduler.ts lines 167-174) both catch DuplicateSessionError typed and adopt the existing record as 'the whole resume contract'; the goal chaser alone omits it, and its idempotency holds only at scan time, not at 

**失败场景**:Two chases of the same goal id run concurrently (e.g. a Routine double-fire, or a host restarts a chase while the old process is still draining). Chase A judges round 1 -> continue -> dispatches 'goal:g:round-2'. Chase B, which scanned before round 2 existed, finishes re-judging round 1 and also dispatches 'goal:g:round-2' -> ledger.dispatch throws DuplicateSessionError -> chase B's returned promise rejects with an internal ledger error instead of adopting/awaiting the existing round; the host loses B's chase result and rounds array. Same crash from a gap in round ids: if a host store pruned '

### 19. [P3] `src/goal/chaser.ts:143` Resume scan capped at maxRounds re-judges a stale middle round as 'latest' and drops later rounds from the result

**断言**:The resume scan stops at n = maxRounds of the CURRENT call, not at the first missing round of the goal. When a goal already has more persisted rounds than the new call's maxRounds, the round at index maxRounds is treated as 'the latest existing round' and re-judged, and every later round session is silently excluded. This contradicts both in-file contracts: line 87 ('Every round session of this goal, in round order') and lines 117-119 ('the latest existing round is awaited/re-judged').

**失败场景**:A goal 'g' previously exhausted with rounds 1-5 persisted. The host re-chases with a smaller budget: chase({ id: 'g', description: ..., maxRounds: 3 }). The scan collects only rounds 1-3, sets pending = round 3, and the evaluator is invoked with round 3's session/summary as if it were the goal's latest state — round 5's later (and actually latest) output is never judged. If the evaluator now says achieved, the chase settles action 'done' with rounds [1,2,3], omitting the existing round-4/5 sessions from GoalChaseResult.rounds, so a host consuming 'every round session of this goal' gets a trunc

### 20. [P3] `src/ledger/ledger.ts:89` Duplicate-id guard is a non-atomic get-then-put: concurrent dispatches with the same idempotency key both succeed

**断言**:The 'duplicate explicit id throws' contract is enforced by getSession followed later by putSession with no conditional-write primitive (the LedgerStore contract offers none — putSession is unconditional create-or-replace). Two concurrent dispatch calls with the same id can both observe null and both put; the second silently replaces the first instead of throwing DuplicateSessionError. The idempotency guarantee that scheduler/workflow dedupe (typed DuplicateSessionError swallowing) is built on therefore only holds for serialized dispatchers — an assumption beyond the store contract.

**失败场景**:Two dispatchers sharing a DB store (e.g. two host processes both running the scheduler over one ledger) fire the same spec tick with the same deterministic session id: both getSession calls return null, both putSession calls succeed, neither sees DuplicateSessionError, so both proceed as if they created the fire. If a driver claims the session between the two puts (running, attempts=1), the second put rewrites it to pending/attempts=0 -> the session is executed twice, and the first attempt's recordOutcome computes transition('pending', ...) and throws, losing that outcome. Documented behavior 

### 21. [P3] `src/schedule/spec.ts:89` dailyAt branch silently returns NaN for finite `after` beyond the JS Date range

**断言**:The guard at lines 83-85 rejects only non-finite `after`, but the dailyAt branch feeds `after` through `new Date(after)`, which is an Invalid Date for |after| > 8.64e15 (the ECMAScript Date range). Then getUTCFullYear()/getUTCMonth()/getUTCDate() all return NaN, Date.UTC(NaN, ...) returns NaN, `sameDay > after` is false, and the function returns NaN from line 92 — no throw, despite the module's stated contract of returning the smallest fire point and its pattern of throwing RangeError on bad time inputs. Verified in Node: after = 9e15 (finite, passes the guard) with dailyAt {hour:6, minute:0} 

**失败场景**:nextFireAt({ id: 'd', intent: 'x', dailyAt: { hour: 6, minute: 0 } }, 9e15) returns NaN instead of throwing; firesBetween with such a bound returns [] instead of erroring. Only reachable with timestamps past year ~275760 or before ~-271821, so latent: a host bug that passes a garbage-but-finite epoch value gets silence instead of the RangeError the finite guard was built to provide.

### 22. [P3] `src/workflow/graph.ts:121` Prototype-chain reads: node ids named like Object.prototype keys wedge the run forever

**断言**:readyNodes and graphStatus index the states Record with raw plain-object property access, so a node id that collides with an Object.prototype key ('__proto__', 'constructor', 'toString', ...) — which validateGraph accepts, since only ':' is banned — reads an inherited value instead of undefined. Compounding it, WorkflowRun.#readStates (run.ts:97) writes 'states[node.id] = session?.state' into a plain {} object, and assignment to the key '__proto__' hits the inherited setter, which silently no-ops for non-object values, so no own property is ever created.

**失败场景**:graph = { id: 'g', nodes: [{ id: '__proto__', intent: 'x' }] } passes validateGraph. WorkflowRun.tick(): #readStates does states['__proto__'] = undefined (no session yet) — no-op via the __proto__ setter; readyNodes then reads states['__proto__'] which returns Object.prototype, !== undefined, so the node is treated as already dispatched and is never dispatched; graphStatus sees a state that is neither 'failed' nor 'done' and returns 'running'. run() polls forever (or throws drain timeout) with zero sessions ever created. Direct pure-function use fails too: readyNodes({id:'g',nodes:[{id:'constr

### 23. [P3] `src/workflow/graph.ts:67` validateGraph throws raw TypeError (not GraphError) on missing/non-string node id; empty node id accepted

**断言**:The doc contract (lines 44-48) says validateGraph 'Throws GraphError unless the graph is well-formed', and graph-level fields are runtime-guarded (typeof graph.id, Array.isArray(graph.nodes)), but node.id has no type or emptiness check: a node with id undefined (JSON row missing "id") or a non-string id crashes at node.id.includes(':') with a bare TypeError, and node id '' validates clean while graph id '' is rejected.

**失败场景**:validateGraph({ id: 'g', nodes: [{ intent: 'x' }] } as WorkflowGraph) — a plausible malformed JSON graph definition — throws TypeError: Cannot read properties of undefined (reading 'includes') instead of GraphError, so host code doing catch (e) { if (e instanceof GraphError) rejectDefinition(e) else rethrowAsInternalBug(e) } misclassifies bad input as an SDK crash. A node { id: '', intent: 'x' } passes validation entirely and yields the trailing-colon session id 'wf:g:run:'.

### 24. [P3] `src/workflow/run.ts:168` run() drainTimeoutMs unvalidated: NaN silently disables the timeout (infinite hang)

**断言**:run() computes `deadline = clock.now() + opts.drainTimeoutMs` with no finiteness/positivity validation, unlike GoalChaser which rejects the same option (chaser.ts:107-108: `!Number.isFinite(opts.drainTimeoutMs) || opts.drainTimeoutMs <= 0` -> RangeError) and unlike this same class's constructor which validates pollIntervalMs with Number.isFinite. If drainTimeoutMs is NaN, deadline becomes NaN and the guard `this.#clock.now() >= deadline` is false forever, so the caller who explicitly asked for a bounded wait gets an unbounded one with no error.

**失败场景**:Host computes a timeout, e.g. `wf.run({ drainTimeoutMs: budgetEndMs - Date.now() })` where budgetEndMs is undefined/corrupt -> NaN. deadline = now + NaN = NaN; every loop iteration evaluates `now() >= NaN` === false, so with a stalled driver (the exact situation drainTimeoutMs exists for, pinned by the 'throws when the graph never settles' test) run() polls forever instead of throwing the drain-timeout error. The caller's watchdog is silently a no-op.

### 25. [P3] `src/workflow/run.ts:94` Plain-object states map: a node id '__proto__' is never dispatchable, run() spins forever

**断言**:#readStates builds the per-node state map as a plain object and writes via `states[node.id] = session?.state`. For the legal node id '__proto__' (validateGraph only bans ':' and duplicates), the assignment hits Object.prototype's __proto__ setter and is a silent no-op for non-object values, while the read returns Object.prototype (an object). Verified in node: after `states['__proto__'] = undefined`, `states['__proto__'] === undefined` is false, and after `states['__proto__'] = 'done'` the read still isn't 'done'. So in readyNodes `states[node.id] === undefined` is false (node never ready, nev

**失败场景**:Graph loaded from JSON config: `{ id: 'g', nodes: [{ id: '__proto__', intent: 'work' }] }` passes validateGraph and the WorkflowRun constructor. tick() finds no ready nodes (states['__proto__'] reads as Object.prototype, not undefined), dispatches nothing, and graphStatus returns 'running' forever. run() without drainTimeoutMs polls infinitely; with drainTimeoutMs it throws a misleading drain-timeout despite an idle, healthy driver. Same id-hygiene defect class as the already-fixed ':' bans, but the outcome is a silent permanent hang instead of a collision; no test covers it.

### 26. [P3] `src/workflow/run.ts:67` Statically invalid node fields (empty intent, bad maxAttempts) pass construction and abort the run mid-flight after side effects

**断言**:The constructor's only graph gate is validateGraph(), which checks ids/deps/cycles but not node.intent or node.maxAttempts. Those are validated only at dispatch time inside TaskLedger.dispatch (ledger.ts:81-87: intent non-empty TypeError, maxAttempts integer >= 1 RangeError — the recently landed 'ledger dispatch validation'). Both fields are static graph data fully checkable at construction, so a graph with a bad downstream node is accepted, its upstream nodes are dispatched and executed by the driver (real side effects), and only when the bad node becomes ready does #dispatchNode's ledger.dis

**失败场景**:graph = { id: 'g', nodes: [{ id: 'a', intent: 'send-email' }, { id: 'b', intent: '', deps: ['a'] }] }. new WorkflowRun(...) succeeds. run(): tick 1 dispatches 'a'; the host driver executes it (email sent). Once 'a' is done, the next tick dispatches 'b' -> ledger.dispatch throws TypeError('dispatch: intent must be a non-empty string') -> run() rejects. The workflow is permanently wedged (a=done, b undispatchable) and the invalid definition was only surfaced after irreversible work, instead of at construction like every other graph-shape error.

### 27. [P3] `tests/schedule-loop.e2e.test.ts:57` Schedule-loop e2e compensation assertions pass even with compensation/recovery deleted

**断言**:Both e2e tests are named for missed-fire compensation and cross-restart recovery ("restart re-fires nothing and compensates the newest missed point", "every point missed during the gap is compensated"), but no assertion can distinguish compensated fires from ordinary real-time cadence: nothing checks that any phase-2 fire point is <= the restart timestamp, and the example (examples/schedule-loop.mjs) does not expose restart time or wall-clock arrival times. Consecutive fire points are 200ms-multiples apart whether they were replayed from the gap or fired live.

**失败场景**:Mutate scheduler.ts so catchUp:'all' behaves as 'latest' (drop the ternary at #fireDue line 156), or delete #recover() entirely (lastFired falls back to `?? now`): phase 2 then fires only future points at live 200ms cadence — still >= 3 fires well inside the 15s deadline, still ascending, still exactly 200 apart, still all > the last phase-1 point and disjoint from phase-1 ids. Every expect in both tests passes; the e2e suite stays green while the exact behavior it is named for is gone. (The unit-level scheduler.test.ts does pin this correctly with fake timers; the e2e's claim of end-to-end pr

### 28. [P3] `tests/store-patrol.e2e.test.ts:103` Shared storefront fixture mutated by test 2 is never reset, coupling tests to declaration order

**断言**:The module-level `storefront` object is shared across tests; beforeEach (lines 32-34) resets only `flakyRemaining` and `hangRequests`, but the "next day with a moved store" test permanently overwrites `storefront.reviews.query_summary` with `total_positive: 150, total_reviews: 160`, while the baseline test asserts `latest.signature.total_reviews` is 110. Correctness of the suite currently depends on in-file declaration order.

**失败场景**:Run the suite with `vitest run --sequence.shuffle` (or move/insert tests so the day-2 test executes before the baseline test): the baseline test's fake storefront now serves total_reviews 160, `expect(latest.signature.total_reviews).toBe(110)` fails — a spurious red against a fully correct implementation, which is exactly the kind of flake that trains people to re-run instead of investigate.

### 29. [P3] `tests/workflow-fanout.e2e.test.ts:12` Fan-out e2e silently self-disables on any package-load failure; its guard test is a tautology

**断言**:The module-level gate swallows EVERY import failure (`() => null` catches missing export, stale/corrupt dist, exports-map mismatch alike), `it.skipIf(!wired)` then converts both e2e tests into green skips, and the third test — named "reports wiring status honestly (never a silent skip)" — asserts only `expect(typeof wired).toBe('boolean')`, which is true by construction (`wired` is an `&&` of boolean expressions) and therefore passes identically whether the e2e ran or not. WorkflowRun IS wired today (confirmed in dist/index.js), so the header's stated reason for the scaffold ("while WorkflowRu

**失败场景**:Delete `export { WorkflowRun, workflowSessionId } from './workflow/run.js'` from src/index.ts. Typecheck passes (nothing else imports it from the package: workflow-run.test.ts imports ../src/workflow/run.js directly), build passes, `wired` becomes false, both fan-out e2e tests skip, the guard test passes, CI is fully green — the package has lost a public export and its only package-surface e2e coverage with zero red signal.
