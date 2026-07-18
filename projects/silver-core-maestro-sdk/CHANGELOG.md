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

## 0.69.0 — 2026-07-18

Testbed gap adoption (keeper ruling 2026-07-18, option 甲: all four gaps from
projects/silver-core-testbed/GAPS.md accepted; G1-G3 land here, G4 on the
agent side):

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
