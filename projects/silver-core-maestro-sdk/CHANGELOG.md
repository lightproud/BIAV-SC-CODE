# Changelog — silver-core-maestro-sdk

Renamed from **@biav/orchestrator-sdk** as of 0.3.0 (keeper ruling 2026-07-18:
the family is two independent SDKs, Silver Core Agent SDK + Silver Core
Maestro SDK — the conductor direction). Entries below 0.3.0 keep the
historical name as shipped; this ledger is not rewritten retroactively.

Version clock: LOCKSTEP with silver-core-agent-sdk since 0.68.0 (keeper
ruling 2026-07-18 — the family bumps as one; overrides the §2
independent-clocks clause under which 0.1.0-0.4.0 shipped). Same ledger
discipline as the agent SDK: every merge that changes shipped runtime code
bumps BOTH versions and adds one line here (a lockstep-alignment line when
this package itself is untouched).

## 0.72.1 — 2026-07-18

Lockstep alignment only — no maestro code change. The agent SDK resolved WV2-4
(keeper ruling T60): the OpenAI transport suppresses a caller `temperature != 1`
only on a declared reasoning endpoint (`capabilities.thinking === true`), never
on an unknown or `thinking: false` gateway. See the agent SDK CHANGELOG 0.72.1.

## 0.72.0 — 2026-07-18

Audit round 2 of the 500-bug campaign (T56): 6 changed-lens finders
(fix-regression x3 / #743-new-code deep read / adversarial-store /
type-honesty) + adversarial verification confirmed **16 real defects**
(3 P1 + 4 P2 + 9 P3); all 16 fixed single-brained with fail-on-old locks
(21 new tests):

- **P1 memory-tidy data loss**: fragments were merged THROUGH store.view,
  silently truncating everything past the 16k view limit and then deleting
  the originals; merge now reads the host's own files in full. **P1 digest
  destruction**: each tidy pass overwrote the digest; it now extends it.
- **P1 claimDue partial failure**: one failing put mid-batch threw the whole
  claim away, stranding already-claimed sessions in 'running' with no
  executor; puts are now per-session isolated (failed one stays safely
  unclaimed, earlier claims are returned).
- recordOutcome is idempotent across the driver's retry-once (the
  append-then-put split no longer double-appends a query row for the same
  attempt). Stale stop() no longer aborts a restarted generation's attempts
  (controllers/inflight are generation-tagged). runAt:null manual-claim
  survives failed attempts via a persisted `manualClaim` marker (retrying
  keeps nextRunAt null; claimDue can never steal the inline retry).
- Schedule: division-rounds-up guard (nextFireAt could skip the true
  smallest fire point, e.g. every=0.016/after=0.576), step-index
  float-precision refusal at >= 2^53, firesBetween fast-forwards a huge
  backlog (a year at 1s cadence returns in O(cap), not 31M iterations);
  scheduler recovery accepts strict digit suffixes only (a malformed
  'sched:x:' id no longer recovers lastFired=0 into an epoch catch-up).
- Workflow: deps must be a string array (a string dep passed validation then
  crashed readyNodes); md graph fences parsed by a top-level line scanner
  (a ```json fence QUOTED inside another fence or indented block no longer
  silently loads the wrong definition).
- Ledger read surface returns shallow copies (a host can no longer mutate
  ledger state through a read); SessionRecord.nextRunAt docs aligned.
- Tests 261 -> 279 against the merged 0.71.x base (leases + testbed
  contract suite coexist with all round-2 fixes; full suite green).
- Mutation after re-measure: state / decision / delivery-channel 100,
  graph 97.14 -> 98.04; spec measures 97.77 and workflow-load 98.04 against
  their 100 floors — remaining survivors are analyzed equivalence classes
  (correction-loop-absorbed estimates, performance-only fast-forward,
  regex-$). Floor adjustment awaits a keeper ruling (ratchet discipline);
  until ruled the weekly ratchet run may red on these two targets.

## 0.71.3 — 2026-07-18

Packaging fix + lockstep alignment. This package carried the same batch-Q
build defects the agent SDK fixed and gets the identical treatment: `files`
now ships `src` so the emitted declaration/source maps resolve their
`../src/*` references in the tarball (W4-1); `prepublishOnly: npm run build`
guarantees a fresh `dist` on publish (W4-2); `exports` gains a `./package.json`
subpath (W4-3). The rest of T51 batches O + Q is agent-SDK-side (governance /
CI / conformance guards); see the agent SDK CHANGELOG 0.71.3 for the itemized
list.

## 0.71.2 — 2026-07-18

Lockstep alignment only — no maestro code change. The agent SDK landed T51
audit r3 batches R + S + T (deep-read source): 19 STILL-LIVE findings across
the openai transport (usage merge, array-delta flattening), structured-output
(exported `valueMatchesSchema`, circular-schema guard, elicitation fail-close),
thinking policy (right-bounded pre-adaptive minors + dated-4.0 re-anchor), tool
dispatch / MCP registry, sessions, subagents (foreground-failure isolation),
and tools (surrogate-safe slicing, bash timeout guard). Two findings were
adjudicated rather than shipped blind (WV2-4 deferred to keeper; WV2-1 a false
positive). See the agent SDK CHANGELOG 0.71.2 for the itemized list.

## 0.71.1 — 2026-07-18

Lockstep alignment only — no maestro code change. The agent SDK landed T51
audit r3 batches N (docs contract) + P (high-severity source: a session-id
path-traversal into hook file reads, a compaction 400 mis-calibration, an
auto-resume control-plane revert, WebFetch capability claims, a Glob
hidden-dir miss, unbounded MCP buffers); the family clock bumps as one.

## 0.71.0 — 2026-07-18

Testbed gap adoption (keeper ruling 2026-07-18, option 甲: all four gaps from
projects/silver-core-testbed/GAPS.md accepted; G1-G3 land here, G4 on the
agent side). Version note: authored as 0.69.0, renumbered to 0.71.0 at merge
time — 0.69.0/0.70.0 were taken on main by a parallel session (#743/#744),
same let-the-number-go discipline as agent 0.53.2:

- **G1 — deliverable LedgerStore contract suite**: new public
  `runLedgerStoreContractSuite(makeStore)` + `ledgerStoreContractCheckNames()`
  (12 checks derived from the seam's documented contract notes; fresh store
  per check, failures land in the report, never thrown) — the counterpart of
  the agent SDK's memory contract suite, so a second consumer no longer
  re-derives the contract from doc comments.
- **G2 — claim leases**: `TaskLedgerOptions.claimLeaseMs` stamps
  `SessionRecord.leaseUntil` on every claim; new
  `TaskLedger.sweepExpiredLeases()` settles expired `running` claims (dead or
  overrunning driver) back into the normal retry path — multi-driver safe,
  because only EXPIRED leases are touched. The LedgerDriver sweeps each poll
  tick. Lease-less ledgers and legacy records: byte-for-byte prior behavior.
- **G3 — short-lived-host scheduling**: new `SchedulerOptions.seedFirstRun`
  (a footprint-less spec starts one cadence back instead of `now`, so its
  single most recent due point fires on the first tick — fixes the day-zero
  deadlock where a boots-after-the-fire-point, exits-seconds-later host never
  builds a footprint at all) + public `scheduleSessionId(specId, fireAt)`
  (the `sched:{id}:{fireAt}` format was a doc-comment-only contract;
  workflow's workflowSessionId had a public constructor all along).

## 0.70.1 — 2026-07-18

Lockstep alignment only — no maestro code change. The agent SDK closed a
permission deny-bypass (audit r3 batch M / T51: subshell + brace-group
grouping bypassed a `Bash(rm:*)` deny); the family clock bumps as one.

## 0.70.0 — 2026-07-18

Audit round 1 of the keeper's 500-bug campaign (T56): 17 finder agents +
adversarial verification confirmed **29 real defects** (1 P1 + 11 P2 + 17 P3)
across src, examples, tests, CI and docs — all 29 fixed or explicitly
documented, each with a regression test that fails on the old code.
Highlights:

- **P1** schedule: fractional `every` float rounding could make `nextFireAt`
  return t == after, spinning `firesBetween` forever; fixed with a bounded
  advance re-derived deterministically (flatness detection — an `every` below
  float resolution at the target magnitude now refuses loudly).
- Ledger: `runAt` is now `number | null` — non-finite throws; `null` =
  manual-claim-only (invisible to claimDue; the race-free
  dispatch-then-claimSession inline pattern, used by the delivery channel);
  retry-policy merge drops explicit-undefined overrides; `backoffDelayMs`
  validates policy numbers (a poisoned cap previously wedged sessions in
  'retrying' with nextRunAt NaN).
- Driver + Scheduler: generation counters + stop() awaiting the in-flight
  tick kill two stop/start races (claims landing after stop resolved;
  stop-then-start forking two poll chains). Driver recordOutcome failure now
  retries once, then emits `driver:error` WITH the stranded session.
- Workflow: Map-backed lookups ('__proto__'/'toString' node ids now safe),
  GraphError consistency + empty-id/node-field validation at construction,
  drainTimeoutMs validated.
- Goal: concurrent chase() of one goal id adopts the existing round instead
  of crashing; resume scan finds the true latest round past maxRounds.
- Examples: store-patrol sweeps crash-orphaned 'running' sessions at start;
  minimal-loop budget reservations stop overlapping queries from each arming
  the full remaining budget, caller-supplied budget hooks are merged, and
  summary truncation is surrogate-safe.
- CI: store-patrol.yml commits partial results before failing the job;
  sdk-mutation-ratchet.yml single-target dispatch actually skips other
  targets now.
- **Integration suites** (the campaign's third deliverable):
  `tests/integration-full-stack.test.ts` (scheduler + driver + workflow +
  goal + delivery co-resident on ONE store, stop-safety, fake timers) and
  `tests/integration-restart.test.ts` (file-store crash/restart:
  exactly-once fires, workflow resume, goal resume, atomic ledger writes).
- Tests 171 -> 231 (18 files); mutation floors hold (state 100 / spec 99.49
  within tolerance, 1 documented equivalence survivor / graph 97.84 up from
  97.14 / decision 100).

## 0.69.0 — 2026-07-18

Keeper todo batch 2026-07-18 (SDK-side items 4–5): maestro fill-ins +
quality-direction switch.

- **Declarative workflow-graph loading** (hot-layer gate): new module
  `src/workflow/load.ts` — `parseWorkflowGraphSource` (json, or md carrying
  the graph in its first ```json fence; format sniffed or forced by
  extension) + `loadWorkflowGraphFile`. NEVER throws: every malformed /
  unreadable definition degrades to `{ ok: false, error }` for the host to
  log and skip; an ok result is always an already-validated, runnable graph.
- **Example 4 "综合整理任务"** (`examples/memory-tidy.mjs` + fake-timer e2e):
  the consolidation ("dream") routine — scheduled dispatch → read the memory
  health surface (`assessMemoryStoreHealth`, agent SDK 0.69.0) → merge
  fragments into a digest card → delete the merged fragments → ledger
  closeout; imports ONLY the two packages' public surfaces. The deterministic
  executor seat is where the black pool puts an agent `query()`.
- **Schedule missed-compensation check** (todo item 4c): verified ALREADY
  implemented and tested — `catchUp: 'latest'/'all'` (`scheduler.ts` +
  `spec.ts` cap semantics), cross-restart recovery, down-gap compensation
  covered at both the component level (`scheduler.test.ts`, fake timers) and
  the e2e level (`schedule-loop.e2e.test.ts`). No change needed.
- **Mutation ratchet — every module family targeted**: new targets
  `delivery-channel` (100.00 after a message-pin kill round; delivery was the
  only family with zero mutation coverage) and `workflow-load` (100.00 after
  a kill round: guard-message pins, format-forcing asymmetry, fence regex
  pin, dead `?? ''` fallback removed). CI matrix extended to six maestro
  targets.
- **E2E clock discipline — zero real clocks**: all four real-timer e2e
  suites (minimal-loop / schedule-loop / store-patrol / workflow-fanout)
  converted to FAKE timers with a bounded drive loop (real HTTP/fs I/O flows
  between advances); triple-run verified stable, wall-clock per suite drops
  from seconds to milliseconds. The whole maestro test suite now runs on
  fake timers only.

Tests: 171 -> 180 passing (workflow-load 7, memory-tidy e2e 2).

## 0.68.0 — 2026-07-18

Lockstep versioning begins (keeper ruling 2026-07-18): version jumps
0.4.0 -> 0.68.0 to align with silver-core-agent-sdk; the two clocks are one
from here on, CI-enforced (check-dep-direction section D). peerDependency
floor moves to >=0.68.0. No code changes.

## 0.4.0 — 2026-07-18

Campaigns 3-6 in one release (keeper order: implement the remaining campaigns
via dynamic multi-agent orchestration — four file-disjoint implementation
agents + two adversarial reviewers, then single-brain integration):

- **Schedule** (campaign 3, §3/§6.2): pure core `validateSpec` / `nextFireAt`
  / `firesBetween` (UTC dailyAt + anchored intervals; capped missed-fire
  windows keep the LATEST fires) + dispatch-only `Scheduler` — fire
  bookkeeping lives IN the ledger (`sched:{id}:{fireAt}` idempotent keys), so
  restart recovery scans the store; catch-up policy `latest` (default) /
  `all`. Example 2 `examples/schedule-loop.mjs` proves 定点触发 + 错过补偿 +
  跨重启恢复 end to end.
- **Workflow graph executor** (campaign 4, §3/§6.3): graph definition is DATA
  — pure core `validateGraph` (duplicates / unknown deps / self-deps / cycles
  with exact cycle-path reporting) / `readyNodes` / `graphStatus` (fail-fast)
  + `WorkflowRun` (nodes are ledger sessions `wf:{graph}:{run}:{node}`;
  idempotent dispatch IS resume; join nodes receive upstream ok-summaries in
  their payload). Example 3 `examples/workflow-fanout.mjs`: fan-out workers
  converging into a merge node.
- **Goal chaser** (campaign 5, §3): cross-query re-initiation — rounds are
  ledger sessions `goal:{id}:round-{n}`, the host-injected evaluator judges
  each round, feedback re-enters the next round's payload; engine-side goal
  (agent SDK) keeps within-one-query attainment; goal semantics stay in
  payload, the ledger schema is untouched. `nextGoalAction` pure core
  (done / continue / impossible / exhausted).
- **Delivery contract** (campaign 6, §5): `DeliverySink` host-injected seam +
  `createDeliveryChannel` — every deliver() rides the normal session
  lifecycle as its audit record (audit-before-send: a store failure aborts
  before the sink is called; sink failure lands in the receipt AND the
  ledger, never thrown).
- **Ledger hardening from the adversarial review** (4 major + 1 minor, all
  fixed and pinned): typed `DuplicateSessionError` (idempotent dispatchers
  swallow exactly it — a message match also swallowed coincidental EEXIST
  store errors and dropped fires permanently); new `TaskLedger.claimSession`
  (surgical claim-one; the delivery channel no longer steals co-resident due
  sessions via claimDue and concurrent delivers are safe); ':' banned in
  schedule spec ids / graph + node ids / runId / goal ids (colon is the
  session-key separator — embedded colons collided distinct runs onto one
  record); `GoalChaser` drain timeout escape hatch (a stopped driver no
  longer hangs chase() forever).
- Mutation ratchet: three new pure-core targets seeded — schedule-spec
  **100.00**, workflow-graph **97.14** (3 documented equivalence-class
  survivors), goal-decision **100.00**; weekly CI matrix extended.
- Tests 50 -> 171 (15 files); typecheck clean.

## 0.3.0 — 2026-07-18

Family naming finalized (keeper ruling, conductor direction -> maestro): npm
package renamed **@biav/orchestrator-sdk -> `silver-core-maestro-sdk`**, brand
name **Silver Core Maestro SDK**, directory moved `projects/orchestrator-sdk/`
-> `projects/silver-core-maestro-sdk/` (directory mirrors the npm name). The
peer/agent package is renamed `silver-core-agent-sdk` (>=0.67.0) in the same
ruling; the public version constant follows the brand
(`ORCHESTRATOR_SDK_VERSION` -> `MAESTRO_SDK_VERSION` — pre-consumer, no
deprecation alias). No behavior changes.

## 0.2.0 — 2026-07-18

Campaign 1 (requirement §4): the task ledger + driver — the common foundation
the other parts grow on.

- **Closed state machine** (finalized, inscribed back into requirement §4):
  session states `pending | running | retrying | failed | done`, events
  `claim | attempt:ok | attempt:error | attempt:timeout` (retries reuse
  `claim`); query-level round results `ok | error | timeout`. Pure core in
  `src/ledger/state.ts` — transition graph, retry exhaustion at
  `attempts >= maxAttempts`, exponential backoff with cap, non-finite counter
  rejection. **Mutation score 100%** (83/83 killed; ratchet floor seeded at
  100 in `mutation-ratchet.json`, weekly re-measured by CI).
- **Storage seam** `LedgerStore` (5 methods): interface only, host-injected —
  the SDK ships no storage battery (§7 non-goals).
- **TaskLedger**: dispatch (pending, due-at), claimDue (attempts count on
  claim), recordOutcome (query row appended, backoff scheduling via
  `nextRunAt` — persisted, so schedules survive host restarts), plus the
  uniform query surface (getSession / listSessions / listQueries).
- **LedgerDriver**: the live component — host starts/stops it; it holds the
  clock (injectable `Clock` seam; the default reads globals at call time so
  fake timers work uninjected), polls for due sessions, times attempts out
  via AbortSignal, and surfaces everything as data through `onEvent`
  (rendering is host-side). `stop()` aborts in-flight attempts into the
  normal retry path, so a restarted driver resumes them.
- **Example 1** `examples/minimal-loop.ts` (requirement §6.1): periodic
  dispatch + budget cap + wind-down on cap, consuming the agent SDK's R2
  budget event stream (`budget:threshold` / `budget:exhausted` + closeout
  report). Imports ONLY the two packages' public surfaces; its e2e test runs
  the real agent stack against a local Messages-API emulator and asserts both
  R2 events, the closeout, and the ledger rows.
- Tests: 45 (state matrix + ledger unit + public-surface assembly with fake
  timers covering the retrying path, the driver-timeout path and host-stop
  resume + the example e2e).

## 0.1.0 — 2026-07-18

Phase 0 (monorepo migration): package created empty. Public surface is the
version constant only; capability modules (task ledger, driver, loop
scaffold, schedule, workflow graph) land in their own campaigns.
