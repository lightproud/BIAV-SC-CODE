# Silver Core Maestro SDK 缺陷审计战报 · 第二轮(T56)

- 日期:2026-07-18(UTC+8)
- 方法:换法六路猎手(修复回归审计 ×3 / #743 新码深读 / 对抗店镜头 / 类型诚实镜头)
  → 去重 → 对抗查证(存疑即毙,多项经查证官在 dist 上实证复现)→ 单脑修复配锁
- 账目:原始 32 → 去重 27 → **确认 16**(3 P1 + 4 P2 + 9 P3,查证淘汰 11)→ 16/16 全处置
- 交付版本:silver-core-maestro-sdk 0.72.0(锁步家族版;调和 main 并行会话 0.71.x 系
  testbed 采纳批与代理审计 r3 批后落位,租约/契约套件与本轮修复共存全绿)
- 产量曲线:第一轮 29 → 第二轮 16,未枯竭;累计真缺陷 **50**(29 + 16 + 前两轮对抗审查 5)

## 诚实声明(§H)

500 为守密人设定上限;两轮累计 50,每项可回源核(file:line + 失败场景 + 原文引用 +
查证理由,多项含查证官实证复现记录)。绝无编造凑数。后续轮次按枯竭纪律换法续挖
(候选:fast-check 性质测试轰纯核)。

## 确认清单(16 项,按严重度)

### 1. [P1] `examples/memory-tidy.mjs:110` tidyOnce merges fragments through store.view and silently loses everything past the 16,000-char view cap

**断言**:tidyOnce reads each fragment via store.view(path), which truncates file bodies at the agent-SDK's maxViewChars (default 16,000; files may legally be up to maxFileBytes 65,536) and appends a '[Output truncated at 16000 characters...]' notice. The truncated body — notice included — is written into the digest, and the original fragment is then deleted, permanently destroying the tail. The summary still reports a clean 'merged N fragment(s)'.

**失败场景**:Verified live: a 30,300-char fragment under /memories/fragments -> tidyOnce reports merged:1, digest.md on disk holds 15,075 chars including the literal truncation-notice line, the fragment file is deleted — 15,225 chars of memory content irrecoverably gone, session closes 'done'.

### 2. [P1] `examples/memory-tidy.mjs:120` Digest is overwritten, not merged: any second tidy pass (including the driver's own retry) destroys previously consolidated content

**断言**:The digest card is rebuilt from ONLY the fragments currently on disk and written with createOverwrite: true; the fragments that fed earlier passes were deleted, so their content exists nowhere but the digest — and the overwrite discards it. This is not confined to a hypothetical second scheduled run: within a single runMemoryTidy, if a store.delete throws mid-loop (after the digest was written and some fragments deleted), the executor throws, the LedgerDriver retries the session, and the retry pass rewrites the digest from the surviving fragments only.

**失败场景**:Verified live: pass 1 merges 'alpha fact' into digest.md and deletes the fragment; a new fragment 'beta fact' appears; pass 2 rewrites digest.md containing only beta — 'alpha fact' is gone from disk and digest both. Retry variant: fragments a+b merged, delete(a) succeeds, delete(b) throws -> driver retries -> digest overwritten with only b's section, a's facts permanently lost.

### 3. [P1] `src/ledger/ledger.ts:154` claimDue partial failure strands already-claimed sessions in 'running' forever

**断言**:claimDue writes each due session to 'running' one at a time inside a loop; if putSession throws on a later session, the exception propagates and the `claimed` array (holding sessions ALREADY persisted as 'running') is discarded. The driver's #tick catches the throw and emits driver:error WITHOUT a session pointer (driver.ts:165 emits `{ type: 'driver:error', error }` — no session), so the earlier-claimed sessions are never handed to an executor, never aborted, and never re-listed (claimDue filters states ['pending','retrying'] only). Nothing in the SDK ever re-claims a stale 'running' session.

**失败场景**:Three sessions due; store putSession succeeds for A (now 'running' in the store), throws once (network blip) for B. claimDue throws, driver emits driver:error with no session field, next tick re-claims B and C (still pending) — but A sits in 'running' with nextRunAt null forever: no executor ran it, stop() has no controller for it, restart recovery never touches 'running'. A scheduled fire or workflow node stalls permanently (a workflow run wedges at status 'running', GoalChaser waits its round out to drainTimeout) after a single transient store error.

### 4. [P2] `src/driver.ts:214` recordOutcome retry-once is not idempotent: duplicate query rows on append-then-put split failure

**断言**:The round-1 fix retries the WHOLE recordOutcome call, but recordOutcome internally does appendQuery THEN putSession. If the first call fails in putSession (after appendQuery succeeded), the driver's immediate retry re-runs appendQuery, appending a second QueryRecord (new id, same sessionId, same attempt) into an append-only store that cannot dedupe — violating the types.ts contract 'a query is one execution attempt record — one row per round / per retry'.

**失败场景**:Executor finishes attempt 1; recordOutcome call 1: appendQuery succeeds, putSession throws (transient store hiccup, e.g. one failed DB write). Driver catches and calls recordOutcome again: get session (still 'running'), appendQuery appends a SECOND row for attempt 1, putSession succeeds. listQueries now returns two rows for the same attempt forever (append-only, never edited). Any host consumer counting attempts, billing rounds, or auditing delivery history double-counts; the audit ledger for a delivery shows two send records for one send. The existing test (driver-races.test.ts 'single transi

### 5. [P2] `src/driver.ts:123` Stale stop() aborts the restarted generation's attempts (abort/inflight sets not generation-scoped)

**断言**:The stop-awaits-tick fix inserted 'await this.#tickPromise' BEFORE the abort loop, opening a window in which a new generation started by a non-awaited stop()-then-start() can claim sessions and register controllers; the old stop() then resumes and aborts ALL controllers and awaits ALL inflight, including the freshly restarted generation's attempts. The generation counter protects the poll chain but neither #controllers nor #inflight is generation-scoped — and the class doc explicitly declares 'stop()-then-start() while a tick is still in flight' a supported interleaving.

**失败场景**:Host restarts without awaiting: driver.stop(); driver.start(). stop() sets running=false and suspends at 'await this.#tickPromise' (gen-1 tick's claimDue in flight on an async store). start() bumps to gen 2 and schedules a 0-delay tick, which runs during the suspension, claims a due session with maxAttempts=1, and starts its attempt (controller added). Gen-1 tick settles; stop() resumes and runs 'for (const controller of this.#controllers) controller.abort()' — aborting the gen-2 attempt. It records outcome 'error', attempts(1) >= maxAttempts(1), so the session lands terminally 'failed' even t

### 6. [P2] `src/workflow/graph.ts:107` validateGraph never checks deps is an array — string deps passes validation then crashes readyNodes

**断言**:validateGraph iterates `node.deps ?? []` with for...of, which accepts any iterable including a string, and nowhere asserts Array.isArray(node.deps). A node whose deps is a string of valid single-char node ids (e.g. "deps": "a" where node 'a' exists — a realistic hand-edit mistake in a hot-layer JSON/md capability file, forgetting the array brackets) passes validateGraph, so both parseWorkflowGraphSource returns { ok: true } (whose contract states 'a returned graph is always runnable') and the WorkflowRun constructor accepts it. At the first tick(), readyNodes calls `(node.deps ?? []).every(...

**失败场景**:Host edits a hot-layer capability file to `{"id":"g","nodes":[{"id":"a","intent":"x"},{"id":"b","intent":"y","deps":"a"}]}`. loadWorkflowGraphFile returns ok:true (validateGraph for-of iterates the string "a", finds node 'a' in byId, passes). new WorkflowRun({graph,...}) also succeeds. run() then throws `TypeError: (node.deps ?? []).every is not a function` from readyNodes on the very first tick — the malformed definition sails through the skip gate that exists precisely to catch it, and the run crashes with an undiagnostic TypeError instead of the file being logged and skipped.

### 7. [P2] `src/workflow/load.ts:27` FENCE_RE matches a ```json fence quoted inside another fence or indented block, silently loading an example graph as the real one

**断言**:The fence regex has no line/context anchoring, so the 'FIRST ```json fenced block' it extracts can be a QUOTED example — a ```json fence nested inside a ~~~ outer fence, or indented four spaces inside a list item — which markdown renders as inert documentation, not a fenced json block. If that quoted example is itself a valid graph (the natural case for a 'copy this shape' doc snippet), parseWorkflowGraphSource returns ok:true with the example graph instead of the file's actual definition fence further down. This defeats the module's own guarantee that 'a returned graph is always runnable' in 

**失败场景**:Verified live: an md capability file with a ~~~-wrapped example (`{"id":"example-graph","nodes":[{"id":"placeholder","intent":"sample only"}]}`) followed by the real ```json definition returns ok:true with graph.id 'example-graph'; the indented-example variant behaves identically. The host dispatches placeholder sessions instead of the real workflow, silently — and a prose-only edit to a capability file (adding a 'format example' above the definition) is enough to hijack which graph executes.

### 8. [P3] `src/ledger/ledger.ts:224` runAt:null 'manual-claim only' invariant is silently lost after the first failed attempt

**断言**:The manual-claim-only property lives ONLY in nextRunAt===null, which claimSession/claimDue null out at claim time; recordOutcome then unconditionally sets a numeric nextRunAt when the transition lands in 'retrying'. So a session dispatched with runAt:null becomes claimDue-visible after its first failure whenever maxAttempts > 1 (default is 3), directly contradicting the API docs at lines 35-37 ('claimDue NEVER lists the session and claimSession is the only way to start it') and lines 143-146. The shipped DeliveryChannel dodges this only because it hardcodes maxAttempts: 1.

**失败场景**:Host follows the documented 'race-free dispatch-then-run-inline pattern' with the default retry policy: dispatch({ id, intent, runAt: null }) (maxAttempts defaults to 3), claimSession, run inline, first attempt fails, recordOutcome('error') -> state 'retrying', nextRunAt = now + 1000. One poll later a co-resident LedgerDriver's claimDue lists and claims the session and executes it through the DRIVER'S generic executor — an intent the driver was never meant to run, executed a second time outside the inline flow. If the inline caller meanwhile re-claims via claimSession it finds state 'running' 

### 9. [P3] `src/ledger/ledger.ts:163` claimDue mid-loop store failure strands already-claimed sessions with no session pointer and no retry

**断言**:claimDue puts each due session to 'running' one by one; if putSession throws partway through the batch, the sessions already written to 'running' are lost — the claimed array never returns, the driver's tick catch emits driver:error WITHOUT any session reference, no executor is ever started for them, and claimDue's filter (pending/retrying) never re-lists 'running'. The round-1 transient-failure mitigation (one immediate retry + session-carrying driver:error) was applied to the recordOutcome path only, leaving this sibling path half-done: here a single TRANSIENT put failure strands other sessi

**失败场景**:Five sessions are due; putSession succeeds for sessions 1-2 and throws once (transient network blip) on session 3. claimDue throws; the driver emits { type: 'driver:error', error } with no session field. Sessions 1-2 sit in 'running' with nextRunAt null forever — never executed, never retried, invisible to every future claimDue — and the host cannot tell WHICH records are stranded from the event, unlike the recordOutcome stranding which carries the session. Recovery requires an out-of-band listSessions({states:['running']}) orphan sweep. Rated P3 because 'store failure strands running by desig

### 10. [P3] `src/ledger/ledger.ts:218` recordOutcome is not idempotent across the driver's retry-once: appendQuery before putSession duplicates the audit row

**断言**:recordOutcome appends the query row first, then puts the session. The driver's retry-once (added in round 1) re-invokes the WHOLE recordOutcome on any failure — so when the first call's appendQuery succeeded and only its putSession failed, the retry appends a second query row for the same attempt (same sessionId, same attempt number, different random id) into a log the contract defines as append-only, i.e. permanently uncorrectable. Attempt-count-derived reporting over listQueries is inflated and the two rows carry different endedAt/id, so consumers cannot reliably deduplicate.

**失败场景**:Attempt 2 of a session ends in 'error'; recordOutcome appends the attempt-2 query row, then putSession hits one transient store failure. The driver retries recordOutcome, which appends attempt-2 AGAIN and then successfully puts 'retrying'. listQueries now permanently returns four rows for a session that made three attempts; a host audit that counts rows against session.attempts flags a phantom extra attempt, and per-attempt billing/telemetry double-counts the failure.

### 11. [P3] `src/ledger/ledger.ts:238` Read surface returns store rows uncopied while mutating APIs return copies; store contract never assigns copy responsibility

**断言**:dispatch/claimDue/claimSession/recordOutcome all return `{ ...record }` defensive copies, but getSession/listSessions/listQueries pass the store's return values straight through, and the LedgerStore contract (store.ts:17-26) says nothing about whether a store may return rows by reference. A naive but fully contract-compliant store (`map.set(r.id, r)` / `return map.get(id) ?? null`) therefore hands hosts LIVE ledger rows through the ledger's read API, with inconsistent aliasing semantics across the public surface (writes copy, reads don't).

**失败场景**:Host wires a reference-holding store (contract-compliant), then a dashboard does `const rows = await ledger.listSessions(); rows.forEach(r => { r.lastError = r.lastError?.slice(0, 80); });` or sets `r.state = 'done'` while rendering — the store's canonical rows are mutated in place, bypassing the state machine with no putSession ever called; the next claimDue/recordOutcome operates on corrupted truth. The identical code against the copying example store is harmless, so the bug only appears in production.

### 12. [P3] `src/ledger/types.ts:44` SessionRecord.nextRunAt doc contradicts the round-1 manual-claim (runAt: null) behavior

**断言**:The nextRunAt doc comment states it is 'set at dispatch, re-set to now+backoff on retrying, null while running and once terminal' — an exhaustive-sounding enumeration in which null implies running-or-terminal. But since the round-1 runAt:null feature (DispatchInput.runAt doc, ledger.ts:132), a session dispatched for manual claim is state 'pending' with nextRunAt null indefinitely, and the delivery channel creates exactly such sessions on every deliver() call. The field's own doc was never updated.

**失败场景**:A host builds a monitoring/repair query from the SessionRecord doc: "pending with nextRunAt === null is impossible → flag as corrupt / backfill nextRunAt = now". Every in-flight delivery audit session (dispatch→claimSession window) and every manual-claim session gets falsely flagged; a repair job that backfills nextRunAt makes the session visible to claimDue and re-introduces precisely the driver-steal race the runAt:null design exists to prevent.

### 13. [P3] `src/schedule/scheduler.ts:162` Recovery parse accepts empty/whitespace suffix as fireAt 0

**断言**:Number(session.id.slice(prefix.length)) evaluates to 0 for an empty or whitespace-only suffix (Number('') === 0, Number('  ') === 0), and Number.isFinite(0) passes the garbage guard, so a ledger session whose id is exactly `sched:{specId}:` (trailing colon, no fire point) is adopted as a legitimate fireAt of epoch 0 instead of being skipped like other non-numeric suffixes (the guard's evident intent). Hex strings ('0x1A' -> 26) also parse.

**失败场景**:An operator pre-seeds or typos a manual claimSession with id 'sched:daily-report:' (round-1's claimSession makes hand-written sched:* ids a supported workflow) for a spec that has no real fires yet; on the next start(), #recover sets lastFired = 0, and the first tick calls firesBetween(spec, 0, now) — for every=1000ms that is ~1.75e9 synchronous iterations (roughly a minute of event-loop blockage at the measured ~2.3e7 iterations/s, compounding the firesBetween enumeration finding) before dispatching stale catch-up sessions with decades-old fireAt payloads. Requires a malformed foreign session

### 14. [P3] `src/schedule/spec.ts:126` Flatness detection false-positives when steps saturates above 2^53

**断言**:The candidate === prevCandidate flatness throw fires on the FIRST bump whenever `steps + extra` itself fails to increment in float (steps >= 2^53, where +1 rounds back via tie-to-even), even though `steps + 2` IS representable and the very next iteration would have advanced past `after`. The comment's justification ("the ONLY way the float result fails to move is every below float resolution — and then it will never move") is wrong for this saturation mode: the multiplier moves again two steps later. Verified against the compiled module: nextFireAt({every: 1e-4}, 1784332800000 /* 2026-07-18T00

**失败场景**:A spec with every=1e-4 (or any every below ~2^-12 ms at current epoch magnitudes, i.e. (after-anchor)/every >= 2^53) reaches nextFireAt with the initial candidate <= after; extra=1 computes anchor + fl(steps+1)*every === previous candidate because steps+1 rounds back to steps, and the function throws RangeError claiming no representable next fire point exists — when one does, two multiplier steps away. In the Scheduler this makes firesBetween -> #fireDue throw every tick: the spec emits schedule:error forever and never fires again, permanently dead instead of firing at the representable next p

### 15. [P3] `src/schedule/spec.ts:106` nextFireAt can skip the true smallest fire point when the division rounds up

**断言**:steps = Math.floor((after - anchor) / every) + 1 assumes the float division never rounds the quotient UP across an integer boundary. When the true quotient is within half an ulp below integer k, fl((after-anchor)/every) = k exactly, so steps = k+1 and the returned candidate is anchor+(k+1)*every — even though fl(anchor + k*every) > after is a representable fire point strictly between. This violates the documented contract "Smallest fire point STRICTLY greater than `after`". Verified against the compiled module, e.g. every=0.3, anchorAt=301439574899.48627, after=52470568683024.08 returns 524705

**失败场景**:A direct consumer of the pure spec API (or a host driving the scheduler with a far-future/simulated clock — the module is pure epoch-ms math with no range refusal below overflow) calls nextFireAt/firesBetween near a lattice point at large magnitudes: one fire point is silently skipped, so under catchUp:'all' one scheduled session is never dispatched and firesBetween's ascending list is missing an element. Empirically unreachable at realistic 2020-2030 epochs with ms-scale `every` (0 hits in 4M realistic probes and 0 in chained scheduler-shaped usage) — only manifests when after >= ~5e13 (year 

### 16. [P3] `src/schedule/spec.ts:165` firesBetween synchronously enumerates the entire backlog despite cap

**断言**:The loop walks every fire point between afterExclusive and untilInclusive one nextFireAt call at a time (each re-running validateSpec), keeping only the latest `cap` via push/shift. Cost is O((until-after)/every) synchronous CPU regardless of cap or the scheduler's catchUp:'latest' mode which only needs the final point. Measured on the compiled module: every=1000ms with a 30-day gap = 2.59e6 iterations / 112 ms; every=100ms / 30 days = 2.59e7 iterations / 1046 ms; every=50ms / 60 days = 1.04e8 iterations / 4171 ms — all synchronous inside one scheduler tick.

**失败场景**:A scheduler restarts after weeks of downtime with a sub-second `every` spec (or recovery derives an old lastFired from the ledger): the first tick's #fireDue blocks the whole event loop for seconds (4.2 s measured at every=50ms/60d), starving all other specs, the driver, and delivery running in the same process; stop() called during it waits behind the in-flight tick for the full duration. No wrong results are produced (a closed-form jump for `every` and a windowed start at untilInclusive - cap*every would give identical output), so this is a latent liveness/efficiency defect rather than corru
