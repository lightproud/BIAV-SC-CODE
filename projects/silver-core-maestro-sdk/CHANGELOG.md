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

## 1.5.0 — 2026-07-29

Lockstep alignment only — **锁步对齐**，无本包运行时改动。agent SDK 1.5.0 是审计
第十九、二十波（工具 / 会话 / 子代理 / 传输 / 权限 / 钩子 / MCP 配置十余处真实缺陷），
见 silver-core-sdk CHANGELOG。家族版本钟锁步（守密人 2026-07-18 裁定），故本包同步升位。

## 1.4.0 — 2026-07-28

Audit wave 17 reached this package directly — two defects that only a test
double's permissiveness had been hiding.

- `ledger/ledger.ts` — `claimDue` applied `opts.limit`, the batch bound behind
  `LedgerDriver.maxConcurrent`, to whatever order the store happened to return.
  Every test double is `Map`-backed, so listing order coincidentally equals
  dispatch order and therefore due order; the real `LedgerStore` contract fixes
  no order at all, and the shipped contract suite deliberately sorts ids before
  comparing. Against a contract-compliant store listing newest-first with
  `maxConcurrent: 1` and three always-due sessions, one session took the slot on
  all 30 ticks and the other two never ran. Even in-memory, three sessions due
  at 5000/1000/100 ms claimed the *least* overdue. Candidates are now ordered by
  `nextRunAt` then `createdAt`, exact ties keeping the store's order.
- `clock.ts` — `systemClock.setTimeout` handed the delay straight to the global
  timer. Beyond 2^31-1 ms Node does not sleep longer, it overflows to 1 ms, so
  every millisecond knob inverts at the top of its range: a 30-day
  `queryTimeoutMs` passed the driver's finite/positive validation and then
  aborted each attempt before the executor's first `await` resumed, settling it
  `retrying` with `lastError: 'timeout'` so no attempt could ever complete. The
  same inversion turns a deliberately rare `pollIntervalMs` — driver and
  scheduler alike — into a 1 ms hammer on the host's store. Capped at the
  ceiling on the way to the global only; injected clocks and NaN/Infinity are
  untouched.

## 1.3.0 — 2026-07-28

Audit waves 15 and 16 reached this package directly.

- `driver.ts` — `LedgerDriver` dereferenced the host executor's result outside
  its try/catch. An executor with a missing `return` rejected the attempt whose
  tracked promise has no handler until `stop()`, so the Node host died with
  `ERR_UNHANDLED_REJECTION` and the session was stranded in `running` — against
  the documented "the driver never crashes on executor failure". Now booked as
  a failed attempt; the session settles to `retrying`.
- `goal/chaser.ts` — the verdict an evaluator returns was never validated,
  while the agent SDK validates the same 0.83.0-unified shape. An evaluator
  still speaking the pre-unification `{achieved, feedback}` shape is caught
  loudly on the agent side but fell through here as "not achieved": a chase
  whose evaluator reported success on round 1 ran five real driver-executed
  rounds and settled `exhausted`.
- `workflow/load.ts` — the markdown fence scanner tracked "inside a fence" as a
  boolean and ignored backtick-run length. Since markdown's own way to quote a
  fenced example is a longer fence, a three-backtick line inside a
  four-backtick block was read as closing it: a documentation example could be
  loaded and dispatched **instead of** the real graph, and the ordinary
  wrapped-example form was rejected as having no graph at all. Now follows
  CommonMark: a closing fence carries no info string and is at least as long as
  the opener.
- `workflow/load.ts` — a UTF-8 BOM was treated as insignificant by the format
  sniffer (`trimStart` removes it, so the file routed to the JSON path) and
  then as significant by `JSON.parse`. A byte-for-byte valid graph saved by
  Notepad or PowerShell was silently skipped.
- `schedule/spec.ts` — `nextFireAt`'s `dailyAt` branch corrupted the fire point
  for first-century timestamps. `Date.UTC(year, …)` remaps years 0–99 to
  `1900+year` while `getUTCFullYear()` reports the true year, so the round trip
  landed ~1900 years away and `firesBetween` silently returned none of the due
  fires. Rebuilt without the remap and proven bit-identical to `Date.UTC` over
  700,000 randomized tuples outside that window. Not reachable from a live
  consumer; recorded because it is a demonstrable wrong output plus silent
  loss, at the same standard of edge the module already refuses elsewhere.

Ledger corrections (no runtime change): the breaking `GoalVerdict` unification
was filed under 0.85.0 while 0.83.0 — the version it actually shipped in — was
labelled "lockstep alignment only". A consumer reading that would take 0.83.0
as a free re-pin and find their `{achieved, feedback}` evaluator never settling
on success. The 0.90.0 entry had been truncated to an orphan fragment, and
three no-op entries were written in wording the substantive-version tool cannot
recognize. All restored to what git says shipped.

## 1.2.0 — 2026-07-28

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 1.2.0 (audit wave 14: a bounded-drain leak that
prevents process exit, `parent_agent_id` never written by any code path,
per-read subagent identity churn, and two new cross-cutting lenses —
idempotency and resource limits).

## 1.1.0 — 2026-07-28

Audit wave 13 — the store contract suite could certify a broken store, which
is the worst possible defect in a deliverable a HOST runs to validate its own
implementation:

- the `dueBefore` check names `<= dueBefore` but only ever tested
  `500 <= 1000`, so a store filtering with a strict `<` passes 13/13 while
  withholding every session due on the exact poll instant — a skipped tick on
  a wall clock, a permanent stall on a frozen one.
- "create-or-replace **by id**" never asserted one row per id, so a
  row-appending store with newest-match-wins `getSession` passes while
  `listSessions` keeps handing callers the previous generations of the row.
- `assertDeepEq` compared `JSON.stringify` output, making object **key order**
  part of the contract, so a store that round-trips every field correctly but
  rebuilds rows from columns fails. Keys are now canonicalized recursively;
  array order stays significant.

Also: `goal/chaser.ts` — an abort landing while the host's evaluator was
deciding still bought one more round; the loop dispatched round N+1 and the
driver executed it before `#awaitTerminal` rejected. `WorkflowRun.run()`
already had the symmetric pre-tick guard.

## 1.0.0 — 2026-07-28

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 1.0.0 (audit wave 12: two tool-definition defects that
made the API reject every request of a session, a tip-reception prompt
injection, a discarded price override, and eight misdirecting error messages).

## 0.99.0 — 2026-07-28

Audit wave 10. This package's share:

- `docs/ONBOARDING.md` claimed a 16-check `LedgerStore` contract suite; the
  base set is 13 with 2 optional seam checks, so a host asserting
  `report.total === 16` concludes three checks silently failed to run.
- Guard-scope gap (fixed in the testbed, recorded here because the rule is
  this package's): `tests/terminal-vocabulary.test.ts` forbids the literal
  `done || failed` spelling but declares scope "src/ only" — the testbed's
  baseline exporter and soak drill both repeated it, so `cancelled` sessions
  never reached a terminal bucket.

## 0.98.0 — 2026-07-28

Audit wave 9. This package's share, all in never-audited surfaces:

- `scripts/check-mutation-ratchet.mjs`: the same two silent-exit-0 defects as
  the agent-side twin (space-in-path main-module no-op; NaN floor passing
  every score), kept functionally equal per the 2026-07-27 ruling.
- `examples/store-patrol.mjs` (runs daily in CI): a corrupt committed
  `ledger.json` killed the patrol at construction forever (now quarantined and
  re-dispatched); a truncated `latest.json` baseline threw on every future
  attempt for that storefront; snapshots were written non-atomically, so a
  kill mid-write publishes a half-file the workflow commits anyway; a
  `cancelled` session read as in-flight, burning the full 120 s drain timeout
  and discarding healthy work; and the failure filter checked `'failed'` only,
  so a never-patrolled target printed "all targets patrolled" and exited 0.
- `examples/memory-tidy.mjs`: `readdirSync` fed directory entries to
  `readFileSync`, so one nested dir under `fragments/` threw EISDIR on every
  retry and consolidation never ran again.
- `examples/{memory-tidy,schedule-loop,store-patrol}.mjs`: the literal
  `done || failed` terminal spelling that `tests/terminal-vocabulary.test.ts`
  forbids in `src/` — its scope note says "src only", and all three shipped
  examples repeated it.

## 0.97.0 — 2026-07-28

Lockstep alignment only — **锁步对齐**,无本包运行时改动。agent SDK 0.97.0 从包入口导出权威 token 估算器
(`estimateTextTokens` / `estimateMessagesTokens` / `estimateToolDefsTokens`)与内建
工具输出上限(`MAX_READ_OUTPUT_CHARS` + frozen `TOOL_OUTPUT_CAPS` 集合),黑池可删
手工镜像——见 silver-core-sdk CHANGELOG。家族版本钟锁步(守密人 2026-07-18 裁定),
故本包同步升位。

## 0.96.0 — 2026-07-28

Audit wave 8: `LedgerDriver` could run **2x** `maxConcurrent`. A non-awaited
`stop()` then `start()` — the stale-start pattern the generation machinery
explicitly supports — leaves an old- and new-generation tick body running
concurrently; both compute `limit = maxConcurrent - inflight.size` from the
same pre-claim size (claims land in `#inflight` only after the awaited
`claimDue`), so each claims a full cap. A synchronous `#reserved` counter,
incremented before the await and released in `finally`, closes the window.
Unbounded and single-chain steady-state behavior are byte-unchanged.

## 0.95.0 — 2026-07-28

Defect audit fixes in the task ledger (family-wide audit wave):

- `reopenSession`: a concurrent CAS loss on the provenance link write abandoned
  `reopenOf`/`attemptRound` permanently, leaving the reopen chain unwalkable.
  Now retries the state-independent provenance re-apply (mirrors
  `cancelSession`).
- `recordOutcome`: the backfill-repair path appended an off-vocabulary
  `outcome` string verbatim into the append-only audit row; now validated
  against `{ok,error,timeout}` at entry.

## 0.94.0 — 2026-07-28

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.94.0 (BREAKING: no built-in default model ids —
missing `model` now throws instead of silently substituting a baked-in id;
`DEFAULT_UTILITY_MODEL` / `VERIFIER_DEFAULT_MODEL` removed).

## 0.93.0 — 2026-07-28

Lockstep alignment only — **锁步对齐**,无本包运行时改动。agent SDK 0.93.0 修复 recap 截断丢最新进度
(BPT P1 活锁事故根因,`buildRecap` 改头尾双保留)并把截断纪律注册表扩到全 `src/`——
见 silver-core-sdk CHANGELOG。家族版本钟锁步(守密人 2026-07-18 裁定),故本包同步升位。

## 0.92.1 — 2026-07-28

Lockstep alignment only — **锁步对齐**，无本包运行时改动。agent SDK 0.92.1 修复了自动续跑时「被拒绝的
控制面覆写仍被留存并重放」——见 silver-core-sdk CHANGELOG。家族版本钟锁步
（守密人 2026-07-18 裁定），故本包同步升位。

## 0.92.0 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.92.0 (Workflow launches asynchronously; behaviour
change for callers of that tool).

## 0.91.0 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.91.0 (Write / Edit / TodoWrite / EnterWorktree
produce structured results; the zero-producer set gets a census guard).

## 0.90.0 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.90.0 (checkpoint blob cap, T74 option 甲).

## 0.89.0 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.89.0 (`type-parity.mjs`: the three ad-hoc
divergence sweeps become one command that reports only new drift; four
shipped-but-undeclared type gaps closed).

## 0.88.0 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.88.0 (prescription cards + sessions health scan).

## 0.87.1 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.87.1 (nested-path sweep: `timedOutAfterMs` moved to
the base BashOutput type where official carries it).

## 0.87.0 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.87.0 (truncation discipline family-wide + cards
mode index exemption).
## 0.86.0 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.86.0 (main-loop prompt regains its opening sentence;
output-type sweep 续 adds ReadMcpResource error + WebSearch structured results).

## 0.85.0 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.85.0 (tools populate structured results, surfaced as
`toolUseResult`; MCP accept list widened to the oldest official revision).

## 0.84.0 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.84.0 (memory index discipline + consolidation
protocol).

## 0.83.0 — 2026-07-27

**BREAKING (experimental goal family): `GoalVerdict` unified with the agent
SDK's shape** (keeper ruling 2026-07-27, "改进方向换成统一判词类型").

The trap this ends: both packages exported a type NAMED `GoalVerdict` with
incompatible shapes — this package's `{achieved: boolean, feedback,
impossible?}` vs the agent SDK's `{status: 'achieved' | 'not_achieved' |
'impossible', reason?}`. A consumer wiring one evaluator into the other seam
(the exact first-consumer path: BPT armed `options.goal` while also holding
this package) produced verdicts the engine judges MALFORMED, and the engine's
deliberate fail-open direction turns every malformed verdict into an ALLOWED
stop — the goal silently never bites, the model "just stops". Diagnosed from
the keeper's live BPT symptom report.

- `GoalVerdict` is now `{status: 'achieved' | 'not_achieved' | 'impossible';
  reason?: string}` — byte-identical to `silver-core-agent-sdk`'s, so ONE
  host evaluator serves both seams via structural typing. Deliberately
  declared here, not imported: this package still declares no dependency on
  the agent SDK (hard property §1.2).
- Migration: `{achieved: true}` → `{status: 'achieved'}`; `{achieved: false,
  feedback: F}` → `{status: 'not_achieved', reason: F}`; `{achieved: false,
  feedback: F, impossible: true}` → `{status: 'impossible', reason: F}`.
- `nextGoalAction` decides on `status`; precedence and the four actions are
  unchanged. `GoalRoundPayload.feedback` keeps its name (persisted payload
  schema) and now carries the verdict's `reason`.
- Breaking on an experimental surface: the goal family is annotated
  "experimental, zero production consumers" in README §status, whose whole
  point is that the first real consumer may reshape signatures — this is
  that adjustment, made BEFORE GoalChaser's first wiring instead of after.

## 0.82.0 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.82.0 (Read refuses whole-file reads past 256KB, per
official parity found in a divergence sweep of the 2.1.220 binary).

## 0.81.0 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.81.0 (Read's truncation footer no longer states a
computed next offset, and the large-file Grep hint fires on size alone).

## 0.80.2 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.80.2 (prompt-basis realignment against the 2.1.216
snapshot: a third dangling provenance slug fixed, the existence guard widened to
adapted entries, and a coverage ruler added).

## 0.80.1 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.80.1 (two prompt-provenance slugs re-pointed after
the upstream snapshot renamed one source file and folded another away).

## 0.80.0 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.80.0 (tool-output limits realigned with Claude Code
2.1.141: WebFetch cap 100_000 → Read's 50_000, Grep `head_limit` default 250 in
every output mode, Bash stream cap keeps the tail instead of the head).

## 0.79.1 — 2026-07-27

Lockstep alignment only — no changes to this package. The family clock advanced
for silver-core-agent-sdk 0.79.1 (transport / MCP internal dedup).

## 0.79.0 — 2026-07-26

Reopen semantics (T67 / design review F5 — keeper ruling 2026-07-26, option 甲:
a NEW session that links back, not a `failed -> pending` edge), plus the
follow-ups the keeper approved from the product review.

**`TaskLedger.reopenSession(id, opts?)` / `reopenChain(id)`.** The closed state
machine is deliberately UNTOUCHED. Terminal immutability is what the CAS fence,
idempotent dispatch and "a restart never resurrects a settled session" all rest
on; a reopen edge would make `done`/`failed` mean "settled for now" and put
every invariant that treats a terminal as final back up for audit. What was
missing was never an edge — it was the LINK: hosts already reopened by minting
ids of their own (`examples/store-patrol.mjs` appended `:r2`, `:r3` in a loop)
and paid three costs for it — one logical job scattered across rows nothing tied
together, an audit that had to be reassembled by id prefix, and every host
inventing its own convention. The SDK now owns the convention.

- `reopenSession` requires a TERMINAL predecessor (RangeError otherwise —
  reopening live work would run the same job twice) and refuses a `cancelled`
  one unless `{ force: true }`: a cancel means "stop this, forever", so a
  routine retry loop must not silently undo it. `done` is reopenable too —
  this is rerun, not only repair.
- The successor id defaults to `{root}#r{round}`, derived from the chain ROOT
  rather than the predecessor. Appending to the predecessor accumulates
  (`job#r2#r3#r4`); flat ids keep the whole chain greppable by one prefix,
  which is what the hand-rolled conventions were reaching for. This method's
  own regression lock caught the accumulating version on first run. `#` rather
  than `:` because `:` is the session-key segment separator four id builders
  are forbidden from containing.
- `intent` / `payload` / `maxAttempts` inherit from the predecessor so the
  common case is a one-argument call; each is overridable. **Overriding
  payload matters**: the store-patrol e2e caught the example inheriting a stale
  target and re-hitting the endpoint it was supposed to be moving off.
- New `SessionRecord` fields `reopenOf` / `attemptRound` (pure additive, absent
  on every pre-0.79.0 row). `reopenChain` returns the whole chain oldest-first
  from ANY member — an auditor holding one row should not need to know whether
  it is the first or the last — and is cycle-safe against a hand-edited store.
- `store-patrol.mjs` drops its hand-rolled `:rN` loop for the real API, which
  is the point of option 甲.

**`docs/CONCURRENCY.md`** (T68): the package's second doc and the one the
product review called its largest gap. per-session mutex vs CAS fence (and why
neither substitutes for the other), claim leases, settle-then-append and what a
crash in the commit window costs, the three terminals' differing semantics, why
the concurrency cap must live at the claim and not in the executor, driver
generation semantics, a store checklist, and the known boundaries stated rather
than omitted.

**Ratchet cadence** (T69): `mutation-ratchet.json` targets may carry
`"cadence": "monthly"`. The three maestro targets sitting on module families
with zero real call sites move there — half the weekly budget was guarding code
nobody calls. They keep their floors and tests; monthly rounds fire on the first
scheduled Monday, any manual dispatch runs everything, and skipped names are
PRINTED because a silent cap reads as "we covered everything" when it did not.
Three new governance assertions guard the cadence itself (T64's disease in
milder form: a floor measured once a month is still a floor nobody watches if
the filter breaks).

**Lockstep wording** (T70): no-op entries are pinned to the machine-readable
`Lockstep alignment only` opening, and `scripts/sdk_substantive_versions.py`
turns that into a per-package "versions that actually changed something for
you" list — the thing a consumer pinning tarballs by version needs. The guard
caught two real drifts on its first run (agent 0.72.0 / 0.70.0 said "Lockstep
alignment **with** … No agent-side changes", which the parser scored as
substantive); both corrected.

Tests 404 -> 421.

## 0.78.1 — 2026-07-26

Product-review remediation (`Public-Info-Pool/Resource/repo-engineering/
maestro-sdk-product-review-20260726.md`; keeper ruled P1/P2/P3/P5 the same
day). A second review of the same package from a different angle: the design
review asked whether the code is correct, this one asked whether it works as a
PRODUCT — who consumes it, whether each surface earns its place, what it saves
consumers and what it demands of them.

**P1 — the peerDependency on `silver-core-agent-sdk` is REMOVED** (keeper
ruling: delete it). It had no code behind it: `src/` imports the agent SDK zero
times (the two matches were prose in comments). npm 7+ auto-installs peers, so
declaring one forced every consumer to install a package this library never
uses — in direct conflict with hard property #1 ("every part can be taken
alone, combined freely, or skipped entirely"). The `store-patrol` example says
so itself: "the agent SDK is not needed here … agent-agnostic by design". The
charter justified the peer dep as consuming the agent side's R6 version
surface; it consumed nothing, and that clause is now struck with an override
note. The information the declaration carried is supplied by the lockstep
discipline instead — the two packages always share a version, so "which agent
version goes with this?" needs no package metadata to answer. Hosts whose
executor calls the agent SDK install it themselves at the same version.
`devDependencies` keeps it (tests and two examples genuinely import it).

**P2 — maturity is now stated per module family, two levels** (keeper ruling:
annotate frozen + add the standard). Measured: `GoalChaser`,
`createDeliveryChannel` and the declarative workflow loader have ZERO real call
sites anywhere in the repo outside their own tests; `WorkflowRun` has exactly
one, its own demo. `TaskLedger` / `LedgerDriver` / `Scheduler` have two
unrelated real consumers (the production store patrol and the testbed daemon).
The charter's acceptance standard ("if the example cannot be written, the API
has a hole") tests FEASIBILITY, so a module serving only its own example always
passes it. Added as the second level, charter §6: **verified** requires at
least one consumer that was NOT written to demonstrate it. README now labels
the three unproven families "实验面, 无生产消费方" — signatures and semantics may
change with their first real consumer. Nothing is deprecated: code, tests and
mutation floors all stay.

**P3 — `docs/ONBOARDING.md`, the package's first doc** (keeper ruling: ship a
documented sample, not code — §7's "no built-in storage implementation" stands).
It answers the one question the package left unanswered: what your LedgerStore
should look like. Both real consumers had hand-written a file-backed store, 43
and 38 effective lines, 86% line-identical, and the package's only help was a
16-check contract suite to verify your copy — the suite's existence concedes the
job is easy to get wrong — without shipping the thing to copy. The doc carries a
memory store, a single-file JSON store with its ceiling stated plainly, the four
traps each mapped to the check that catches it, and the three host decisions
with their defaults.

`tests/onboarding-sample.test.ts` EXTRACTS the sample from the markdown, writes
it to a temp .ts file, imports it and runs it through the contract suite — a
sample consumers paste into production is load-bearing code, and shipping it
unverified would be worse than shipping nothing. Negative-controlled: removing
one line from the doc's sample reds the suite with "2 orphan query row(s)
survived deleteSession".

**P5 — the charter's placement discriminant gains its missing third dimension**
(keeper ruling: keep delivery, fix the discriminant). `createDeliveryChannel`
satisfied neither original criterion — `clock.now()` four times, all for
timestamps, `setTimeout` zero times, and its own comment says it "executes
inline by spec" — yet §3 had always assigned it to orchestration on the grounds
of 触发权 (initiation rights). The rule was missing a dimension §3 was already
using; delivery was not misplaced. Charter §1 now states it, with the boundary:
initiation and audit belong to orchestration, presentation stays host-side.

No runtime behavior changes in either package. Tests 400 -> 404.

## 0.78.0 — 2026-07-26

Design-review remediation (`Public-Info-Pool/Resource/repo-engineering/
maestro-sdk-design-review-20260726.md`; keeper ruled all four findings the same
day, each taking the recommended option). None of the four was a
miscomputation — every one was a convention whose radius had not reached every
reader, which is the class of defect that produces no test signal. Five audit
rounds (67 defects), three property suites and six mutation targets at floors
97-100 all missed them.

**F1 — the `cancelled` terminal now reaches the scenario layer.** 0.76.0 added
the sixth state and revised the ledger and driver thoroughly; three
scenario-layer readers still spelled their terminal test as
`state === 'done' || state === 'failed'`, kept compiling, kept passing, and
silently treated a cancelled session as still in flight. With `drainTimeoutMs`
unset — the default — a user cancel wedged the orchestrator permanently, so the
feature's motivating scenario was its failure scenario.

- `graphStatus` fails the run on a cancelled node (keeper ruling: fail-fast,
  same treatment as `failed`). Justification: readiness requires deps to be
  `'done'`, so nothing downstream of a cancelled node can ever become ready —
  continuing cannot finish the run. Hosts distinguishing "failed" from
  "cancelled" read it off the node session in the returned `states` map;
  `WorkflowStatus` deliberately stays a three-value verdict.
- `GoalChaser` awaits ANY terminal and settles a cancelled round as the new
  `GoalAction` member `'cancelled'` — WITHOUT consulting the evaluator (asking
  the judge to rule on a round the host itself cancelled is meaningless) and
  without emitting `goal:round`, whose contract requires a verdict.
  `nextGoalAction` never returns it, so the pure decision core is unchanged.
- New vocabulary: `UNSUCCESSFUL_TERMINAL_STATES` (`failed | cancelled`) plus
  the `isTerminal` / `isUnsuccessfulTerminal` predicates, all exported.
  `TERMINAL_STATES` already held the right value and had ZERO src consumers.
- Enforcement, because the fix alone does not stop a seventh state repeating
  it: `tests/terminal-vocabulary.test.ts` forbids spelling a terminal test as a
  literal PAIR anywhere in src, with an in-code `terminal-literal-ok:` opt-out
  for the one site that legitimately needs one (recordOutcome's
  "settled by an attempt" branch, which must NOT widen to include cancelled).
  The guard states its own scope limit: it would not have caught the
  `graphStatus` half, whose two literals sat in separate statements.

**F2 — `LedgerDriver.maxConcurrent`.** A tick claimed every due session and
started them all, so peak concurrency equalled the backlog: measured at 200
concurrent attempts for 200 due sessions, with no bound anywhere in the chain.
Three ordinary paths produce a backlog (scheduler catch-up, wide fan-out,
restart over a full store), and where an attempt is a paid API call that is a
cost event. A host could not fix it downstream: queueing inside the executor
burns the claim lease of work that has already been counted as an attempt.

- `maxConcurrent` (integer >= 1; unset = unbounded, prior behavior
  byte-for-byte) makes the driver claim only as many as it has free slots,
  counted across all generations. The rest stay untouched in the store — still
  due, no attempts increment, no lease — for a later tick.
- Backing it, `claimDue(now, { limit })` stops after that many SUCCESSFUL
  claims (counted in claims, not in listed candidates). `limit: 0` short-circuits
  before the store, so a saturated tick performs no reads — but the lease sweep
  still runs, since a saturated driver is exactly when a dead peer's expired
  claims need reclaiming.

**F3 — retention.** The ledger was append-only forever: no `delete`, no
`prune`, nothing. The store-patrol production loop accretes two sessions and
two query rows per day with nothing reclaiming them, and every `deliver()`
writes an audit session never revisited. A host reclaiming space behind the SDK
would also bypass the per-session mutex and the CAS fence.

- New OPTIONAL store seam `deleteSession?(id)`, in the same shape as
  `putSessionIf`: implement it and you get retention, skip it and nothing
  changes. It must remove the session's QUERY ROWS too — removing the row alone
  leaves exactly the accretion the seam exists to bound.
- `TaskLedger.purgeSession(id)` is the gate: holds the session mutex, refuses
  non-terminal sessions (purging live work strands its attempt; cancel first),
  returns false on an unknown id so a sweep is idempotent, and throws naming
  the seam when the store lacks it — a retention sweep that quietly reclaims
  nothing is worse than one that fails, because the growth continues while the
  host believes it does not.
- Contract suite grows four optional checks (run only for stores implementing
  the seam), including the one that catches an implementation orphaning query
  rows. The `store-patrol` example store implements it.
- Documented HAZARD, not fixable here: for sessions whose id IS bookkeeping,
  deleting the row deletes the bookkeeping — purging `sched:{spec}:{fireAt}`
  makes Scheduler recovery re-anchor, purging `wf:{graph}:{run}:{node}` makes a
  run re-dispatch that node. Both are the resume contract working as
  documented.
- NOT addressed (out of the keeper's ruling): `Scheduler` recovery still does
  an unfiltered full-table `listSessions()` on every start.

**F4 — an abort seam on the two long-running components.** `WorkflowRun.run()`
and `GoalChaser.chase()` had no `stop()`, took no signal, and never cleared
their sleep timer; their only exit was the default-unset `drainTimeoutMs`. The
driver had spoken AbortSignal all along.

- `run({ signal })` and `chase(config, { signal })` check the signal before
  every tick/poll and interrupt the inter-tick sleep, rejecting with the
  signal's reason. Ledger records survive, so a later run/chase resumes from
  them.
- The shared `waitOrAbort` helper ALWAYS clears its timer, so an abandoned loop
  leaves nothing pending on the clock.

Tests 362 -> 400 (31 files): `tests/design-review-20260726.test.ts` (27 cases,
the probes that demonstrated the four defects promoted into locks, plus the
negative controls they lacked — "unset maxConcurrent still measures 200" is
kept deliberately, as the documented default) and
`tests/terminal-vocabulary.test.ts` (11). `tests/property-cores.test.ts`'s
graphStatus law was REWRITTEN, not relaxed: it held the old
"`failed` dominates" rule and is what caught the semantic change. All three
mechanisms negative-controlled by reverting each fix in turn (6 failures) and
restoring.

## 0.77.0 — 2026-07-26

Lockstep alignment only — no maestro-SDK code change. The agent SDK landed the
Windows correctness sweep from the first non-Linux CI run this family has ever
had: path-scoped permission rules that failed open (and, the other way, over-
matched) on Windows, the Bash tool vanishing under a curated host env, and
Glob/Grep emitting a different path dialect from every other surface. See the
agent CHANGELOG 0.77.0.

Worth recording on this side: **maestro passed the Windows probe 362/362 with
no changes at all**, on the same run that failed 15 of the agent SDK's test
files. The orchestration layer carries no host-path or shell assumptions.

## 0.76.0 — 2026-07-22

The `cancelled` closed terminal (BPT requirement P0-D1, 2026-07-22: a
user-initiated cancel is a first-class terminal outcome — ledger-
distinguishable from `failed`, and NEVER auto-rerun). Prior to this the
only ways a host could fake a cancel were both wrong: recording an 'error'
re-runs the session on the backoff schedule against the user's intent, and
forcing attempts to the ceiling mis-books a cancel as a failure in every
audit. Delivered surface:

- `SessionState` gains the terminal `cancelled` (no outgoing edges;
  `TERMINAL_STATES` includes it; `SESSION_STATES` appends it LAST so index
  order of the first five entries is undisturbed). `SessionEvent` gains
  `cancel`, legal from every non-terminal state:
  pending/running/retrying --cancel--> cancelled.
- `TaskLedger.cancelSession(sessionId, { reason?, cancelledAt? })`:
  idempotent on an already-cancelled session (returns the stored record,
  keeps the FIRST cancel's stamps, appends nothing); throws
  InvalidTransitionError on done/failed; per-session mutex + putSessionIf
  CAS like every mutating path, with a bounded re-read-re-apply loop on CAS
  loss (cancel is legal from every non-terminal state, so it lands over an
  interleaved claim/settle; a rival reaching done/failed first throws).
  nextRunAt and leaseUntil are cleared unconditionally — a cancelled
  session is never due, never listed by claimDue, and can never look like
  an expired claim to sweepExpiredLeases (which lists `running` alone).
- Query-level audit: `QueryOutcome` gains `'cancelled'` (BPT P0-D1 §4.4,
  option A — the query history distinguishes "cut short" from "failed"
  without session-level special-casing). Cancelling from `running` appends
  one row for the in-flight attempt (outcome 'cancelled', error =
  opts.reason, startedAt = the claim's stamp); cancelling from
  pending/retrying appends NOTHING (no attempt was in flight — fabricating
  a row would pollute the per-attempt history). recordOutcome REJECTS
  outcome 'cancelled' (RangeError): cancellation is a session-level
  command, not an executor-reportable result.
- Session-level audit: `SessionRecord` gains optional `cancelledAt` /
  `cancelReason` (pure additive; absent on every pre-0.76.0 row).
  `lastError` is NOT repurposed — its "latest error/timeout summary"
  meaning stays unpolluted.
- Cancel-vs-in-flight-attempt race, both directions pinned: cancel lands
  first -> the aborted executor's late recordOutcome throws
  InvalidTransitionError (the ledger stays strict; no backfill into a
  cancelled session) and the DRIVER now drops exactly that rejection
  silently — a user cancel must not read as a driver malfunction (no
  driver:error event; every other stranding signal is unchanged). Attempt
  settles first -> cancelSession on the resulting done/failed throws; on
  retrying it cancels normally. cancelSession does NOT abort the host's
  in-flight executor (the ledger holds no executors) — the host aborts its
  own runtime, in either order.
- Contract suite: one new base check — a store must round-trip the
  cancelled terminal byte-for-byte (state/cancelledAt/cancelReason, the
  states filter on 'cancelled', and the 'cancelled' query outcome), so a
  host restart reloads a cancelled session as cancelled instead of
  resurrecting it. Existing checks untouched.

## 0.75.0 — 2026-07-20

Lockstep alignment only — no maestro-SDK code change. The agent SDK added R7
session-end write-back observability (`SDKMemoryHealth.sessionEndUpdate` +
`Query.memoryHealthSnapshot()`), giving ledger-driven hosts the signal to
detect a session that ended without updating its progress card. See the
agent CHANGELOG 0.75.0.

## 0.74.0 — 2026-07-18

Audit round 5 of the 500-bug campaign (T56): three lenses over the NEW r4
concurrency code (adversarial line-review / upper-layer concurrency /
store-variant model-based sweep — the last ran 1,200 op sequences over six
store configs and falsified nothing) confirmed **6 real defects**
(3 P2 + 3 P3), all fixed with fail-on-old locks; the store-variant property
sweep is adopted as a permanent test. Battle report
(`.../silver-core-maestro-sdk-bug-audit-r5-20260718.md`) is the detail
authority.

Backfill-branch hardening (the r4 settle-then-append repair path was new
code and all three new-code findings landed in it):

- A rival host's backfill inside the settle winner's put->append gap could
  append a DIVERGENT row with no CAS to stop it (two contradictory rows for
  one attempt, canonical row contradicting lastError). Backfill now requires
  the failure payload's error text to equal the session's recorded lastError
  — the true crashed winner's retry heals, a divergent rival is rejected.
  listQueries canonicalization flips to LAST-row-wins (the pick consistent
  with the settled record in the reproduced race; r4's first-wins was
  arbitrary in the legacy race it served).
- A crash in the put->append window of a RETRYING settle had no repair path
  (the documented consistent-retry backfill only covered terminal states):
  the retry detonated on transition('retrying', attempt:*) and the audit row
  was lost for good. Retrying-state backfill added, same consistency gate.
- An attempt-OMITTED consistent retry couldn't backfill either (the guard
  demanded an explicit matching attempt, contradicting the "omitted = current
  attempt assumed" doc). Omitted now assumes the current attempt.

Upper-layer fixes:

- Same-instance reads (getSession / listQueries) now take the per-session
  mutex: the settle-then-append window briefly exposed 'done' with zero
  rows, and WorkflowRun persisted a null dep summary / GoalChaser judged a
  verdict on missing data from exactly that read. (A reader on a DIFFERENT
  process can still land in another host's gap — documented.)
- Delivery channel: a co-resident driver's lease sweep settling the audit
  session mid-send made deliver() REJECT with InvalidTransitionError — the
  receipt was lost and a delivered message was audited as failed. Post-claim
  bookkeeping is now best-effort: lease-race rejections
  (InvalidTransitionError / ClaimConflictError) are absorbed into the
  receipt; genuine store failures still rethrow. A claimSession CAS loss
  returns a failed receipt instead of throwing.
- Driver: the driver:error "stranded session, repair me" signal fired for
  healthy self-healing sessions (late fenced outcome after a lease sweep)
  and carried a stale 'running' snapshot. The driver now re-reads the store:
  the event carries the CURRENT record only when it still reads 'running';
  otherwise it emits without a session.
- Scheduler recovery accepts fractional fireAt suffixes (validateSpec allows
  fractional `every`, so such footprints legally exist; the digits-only
  parse silently re-anchored a restarted scheduler).

## 0.73.0 — 2026-07-18

Audit round 4 of the 500-bug campaign (T56): 4 fault-injection lenses
(chaos store / dual-host races / ambiguous failure / hostile input) with
adversarial verification confirmed **11 real defects** (3 P1 + 4 P2 + 4 P3),
all fixed with fail-on-old locks. The battle report
(`Public-Info-Pool/Resource/repo-engineering/silver-core-maestro-sdk-bug-audit-r4-20260718.md`)
is the detail authority.

Ledger concurrency overhaul (the P1 cluster shared one root cause — no
attempt fencing and no write atomicity):

- **Attempt fencing** (R4-A/C4/AF1): `OutcomeInput.attempt?` — when given,
  a stale writer (an attempt that outran its lease, was swept, and whose
  session was re-claimed) throws `InvalidTransitionError` instead of
  stealing the live attempt's query row or terminally settling the session
  with an outdated result. The SDK's own callers (driver, delivery channel,
  lease sweep) always pass it; the claimLeaseMs doc promise is now real.
- **Per-session in-process mutex** (R4-C1/C2/C3 same-instance): every
  mutating ledger path is serialized per session, so one TaskLedger instance
  never races itself between read and write.
- **Optional store CAS seam** (R4-C1/C3 cross-host): `LedgerStore.putSessionIf?`
  + `SessionRecord.revision` — when the store implements it, every session
  write is a compare-and-swap and dual-host claims/settles are fenced
  (pre-fix: 295/300 seeded interleavings double-claimed inside an unexpired
  lease). Without it, cross-process exclusivity remains the host's problem
  (documented). `ClaimConflictError` (new export) surfaces a lost CAS.
  The contract suite grows conditional putSessionIf checks (base checks and
  a plain store's report are unchanged).
- **Settle-then-append + reconciliation** (R4-B/C2): the session write is
  now the commit point; the query row is appended after, so a settle race
  cannot leave two contradictory rows for one attempt, and a session's state
  can no longer contradict its own committed row (a committed row for the
  current attempt is adopted as the truth; a crash between settle and append
  is repaired by a consistent-retry backfill). `TaskLedger.listQueries`
  canonicalizes to one row per attempt. NOTE: this reorders the r2-era
  append-first behavior — on a put failure nothing is committed (previously
  the row was).
- **Sweep hardening**: per-session isolation (one settle failure no longer
  aborts the batch) and the expired-attempt fence.

Hostile-input hardening (R4-HI-1..4 + leads): retry policy validated at the
TaskLedger constructor (was detonating inside recordOutcome after the append,
wedging the session); `now` must be finite in claimDue / claimSession /
sweepExpiredLeases (NaN/Infinity leases used to falsely burn attempts or
permanently defeat the sweep); recordOutcome rejects non-finite
startedAt/endedAt; scheduler recovery ignores digits-only fire suffixes
beyond the Date range (one poisoned row used to starve the spec forever);
dispatch rejects non-string ids; goal chaser normalizes a missing evaluator
feedback to null.

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
