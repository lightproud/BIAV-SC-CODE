# Changelog — @biav/orchestrator-sdk

Own semver clock, decoupled from @biav/agent-sdk by requirement (SCS-REQ
orchestrator-sdk §2): the two packages never bump in lockstep. Same ledger
discipline as the agent SDK: every merge that changes shipped runtime code
bumps the version and adds one line here.

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
