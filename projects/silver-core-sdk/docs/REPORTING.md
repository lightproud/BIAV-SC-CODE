# Runtime reporting (SCS-REQ-002 loop 1)

The signal side of the self-improvement loop: runs leave a facts-only ledger,
and one call folds the last 24 hours into an agent-readable daily report —
the replacement for a human trawling dashboards. Spec: REQ-1.1 in
`memory/active/self-improvement-requirements.md` (repo root).

## Run-signal ledger (`options.runLog`)

```ts
const q = query({
  prompt,
  options: {
    runLog: { dir: '/var/bpt/runlog', scenario: 'coding' }, // or 'non-coding'
  },
});
```

Every consumer-facing result message is mirrored as ONE JSONL line in
`{dir}/runlog-{YYYY-MM-DD}.jsonl` (UTC day files): termination subtype,
turn/duration counters, token usage + cache ratio, cost, the
transport-health disconnect ledger, per-tool call/error counters, model ids.
**No conversation content.** Writes are fire-and-forget appends — a ledger
fault never breaks the run.

**Incognito boundary (spec §6.4):** an incognito session still contributes
transport/token statistics, but its record carries no session id, no
scenario tag and no error text, and never appears in the report's
failed-sessions section.

The record contract is `RunLogRecord` (`src/reporting/run-log.ts`, `v: 1`).
BPT-side producers that write their own ledger lines must follow it —
otherwise the report's tool-call section reads their runs as "无数据"
(spec §6.1).

## Daily report (`generateRuntimeReport`)

```ts
import { generateRuntimeReport } from 'silver-core-sdk';

const { path, markdown, summary } = await generateRuntimeReport({
  logDir: '/var/bpt/runlog',          // where the day files live
  // outDir: default {logDir}/../reports; null = don't write, return only
  // windowHours: default 24; topN: default 5
});
```

Writes `reports/runtime-report-{YYYY-MM-DD}.md` with four sections:

1. **传输健康** — ledger totals by cause + the unrecovered-sessions list
   (runs that still ended in error despite recorded transport faults);
2. **token 消耗** — input/output totals, cache hit rate, cost, top consumers
   split by `scenario` tag;
3. **工具调用** — tool × calls × failure rate;
4. **失败会话** — non-success terminations, facts only.

Acceptance properties (tested in `tests/runtime-report.test.ts`): a missing
signal renders an explicit **无数据** marker (never a silently absent
section); lists are capped with the cap stated inline (~8K-token target);
a missing log directory degrades to an all-无数据 report, not a throw; zero
new runtime dependencies.

## Trend comparison (`compareReports`, REQ-1.2)

```ts
import { compareReports } from 'silver-core-sdk';

const { a, b, deltas, markdown } = await compareReports(
  '2026-07-10', '2026-07-11',            // UTC days; B is the "after" side
  { logDir: '/var/bpt/runlog' },
);
```

Re-aggregates the ledger per UTC day (same day files, no second storage
format) and returns `b - a` deltas for the key metrics: records/sessions,
transport fault total + per-cause table, unrecovered sessions, failures,
input/output tokens, cache hit rate (percentage points), cost, tool calls
and tool failure rate. A day without data reads as explicit `null` /
无数据 — never zeros in disguise — and its deltas are `null`.
`aggregateDay(logDir, date)` is exported for single-day consumption.

## Rolling retention (REQ-1.2)

`generateRuntimeReport` prunes `runtime-report-*.md` files older than
`retentionDays` (default **30**; `0` disables) after each write. The raw
`runlog-*.jsonl` ledger is **never pruned by default** — it is the signal
source of record; opt in with `ledgerRetentionDays` when the consumer wants
the ledger bounded too. Pruning is best-effort and can never throw.
