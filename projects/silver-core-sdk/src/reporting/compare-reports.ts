/**
 * Report trend comparison (self-improvement spec SCS-REQ-002 loop 1 /
 * REQ-1.2).
 *
 * compareReports(dateA, dateB) re-aggregates the run-signal ledger for two
 * UTC days and returns the key-metric deltas loop 3's agent uses to judge
 * whether a change moved the numbers in the right direction. It reads the
 * same runlog-{date}.jsonl day files generateRuntimeReport() consumes — no
 * second storage format, so the comparison can never drift from what the
 * daily report said.
 *
 * A day with no ledger data aggregates to explicit nulls and the Markdown
 * marks it 无数据 — absence is a fact, not an omission (REQ-1.1 discipline
 * carried over). Zero runtime dependencies; pure node:fs via readWindow.
 */

import { ConfigurationError } from '../errors.js';
import { readWindow } from './runtime-report.js';

export type DayAggregate = {
  date: string;
  records: number;
  sessions: number;
  incognitoRecords: number;
  /** Fault counters summed by cause; null when no record carried the ledger. */
  transport: Record<string, number> | null;
  transportFaultTotal: number | null;
  unrecovered: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    cacheHitRate: number | null;
    costUsd: number;
  } | null;
  tools: { calls: number; errors: number; failureRate: number | null } | null;
  failures: number;
};

export type MetricDelta = {
  metric: string;
  a: number | null;
  b: number | null;
  /** b - a; null when either side has no data. */
  delta: number | null;
};

export type CompareReportsOptions = {
  /** Directory holding runlog-*.jsonl day files (same as RuntimeReportOptions.logDir). */
  logDir: string;
};

export type CompareReportsResult = {
  a: DayAggregate;
  b: DayAggregate;
  deltas: MetricDelta[];
  markdown: string;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Aggregate one UTC day of ledger lines into the comparison shape. */
export async function aggregateDay(logDir: string, date: string): Promise<DayAggregate> {
  if (!DAY_RE.test(date)) {
    throw new ConfigurationError(`compareReports: date must be YYYY-MM-DD, got "${date}"`);
  }
  const from = new Date(`${date}T00:00:00.000Z`);
  const to = new Date(`${date}T23:59:59.999Z`);
  // Shape safety (audit 2026-07-14 M-12): this aggregation duplicates
  // runtime-report.ts's (L-7) and dereferences the same nested fields
  // (r.usage.*, r.total_cost_usd, r.transport_health, r.per_tool). Both
  // consumers are guarded at the shared readWindow choke point — its
  // isRunLogRecord() validator diverts wrong-shape lines into the bad-line
  // counter, so every record that reaches this loop is safe to dereference.
  const { records } = await readWindow(logDir, from, to);

  const named = records.filter((r) => r.incognito !== true);
  const sessions = new Set(named.map((r) => r.session_id));

  const transportRecords = records.filter((r) => r.transport_health !== undefined);
  let transport: Record<string, number> | null = null;
  let unrecovered = 0;
  if (transportRecords.length > 0) {
    transport = {};
    for (const r of transportRecords) {
      let faults = 0;
      for (const [k, v] of Object.entries(r.transport_health!)) {
        const n = typeof v === 'number' ? v : 0;
        transport[k] = (transport[k] ?? 0) + n;
        faults += n;
      }
      if (r.is_error && faults > 0 && r.incognito !== true) unrecovered += 1;
    }
  }
  const transportFaultTotal =
    transport === null ? null : Object.values(transport).reduce((a, b) => a + b, 0);

  let tokens: DayAggregate['tokens'] = null;
  if (records.length > 0) {
    const input = records.reduce((a, r) => a + r.usage.input_tokens, 0);
    const output = records.reduce((a, r) => a + r.usage.output_tokens, 0);
    const cacheRead = records.reduce((a, r) => a + r.usage.cache_read_input_tokens, 0);
    const cacheCreation = records.reduce((a, r) => a + r.usage.cache_creation_input_tokens, 0);
    const denom = input + cacheRead;
    tokens = {
      input,
      output,
      cacheRead,
      cacheCreation,
      cacheHitRate: denom > 0 ? cacheRead / denom : null,
      costUsd: records.reduce((a, r) => a + r.total_cost_usd, 0),
    };
  }

  let tools: DayAggregate['tools'] = null;
  let calls = 0;
  let errors = 0;
  let sawToolData = false;
  for (const r of records) {
    for (const t of r.per_tool ?? []) {
      sawToolData = true;
      calls += t.calls;
      errors += t.errors;
    }
  }
  if (sawToolData) {
    tools = { calls, errors, failureRate: calls > 0 ? errors / calls : null };
  }

  return {
    date,
    records: records.length,
    sessions: sessions.size,
    incognitoRecords: records.length - named.length,
    transport,
    transportFaultTotal,
    unrecovered,
    tokens,
    tools,
    failures: named.filter((r) => r.is_error).length,
  };
}

function delta(metric: string, a: number | null, b: number | null): MetricDelta {
  return { metric, a, b, delta: a === null || b === null ? null : b - a };
}

function fmt(x: number | null, digits = 0): string {
  if (x === null) return '无数据';
  return digits > 0 ? x.toFixed(digits) : String(x);
}

function fmtDelta(d: number | null, digits = 0): string {
  if (d === null) return '—';
  const s = digits > 0 ? d.toFixed(digits) : String(d);
  return d > 0 ? `+${s}` : s;
}

/**
 * Compare two UTC days of run signals; dateB is the "after" side, so every
 * delta reads b - a. Rates are compared in percentage points.
 */
export async function compareReports(
  dateA: string,
  dateB: string,
  options: CompareReportsOptions,
): Promise<CompareReportsResult> {
  const [a, b] = await Promise.all([
    aggregateDay(options.logDir, dateA),
    aggregateDay(options.logDir, dateB),
  ]);

  const pct = (x: number | null): number | null => (x === null ? null : x * 100);
  const deltas: MetricDelta[] = [
    delta('records', a.records, b.records),
    delta('sessions', a.sessions, b.sessions),
    delta('transport_faults', a.transportFaultTotal, b.transportFaultTotal),
    delta('unrecovered_sessions', a.unrecovered, b.unrecovered),
    delta('failures', a.failures, b.failures),
    delta('input_tokens', a.tokens?.input ?? null, b.tokens?.input ?? null),
    delta('output_tokens', a.tokens?.output ?? null, b.tokens?.output ?? null),
    delta('cache_hit_rate_pct', pct(a.tokens?.cacheHitRate ?? null), pct(b.tokens?.cacheHitRate ?? null)),
    delta('cost_usd', a.tokens?.costUsd ?? null, b.tokens?.costUsd ?? null),
    delta('tool_calls', a.tools?.calls ?? null, b.tools?.calls ?? null),
    delta('tool_failure_rate_pct', pct(a.tools?.failureRate ?? null), pct(b.tools?.failureRate ?? null)),
  ];

  const digitsFor = (metric: string): number =>
    metric === 'cost_usd' ? 4 : metric.endsWith('_pct') ? 1 : 0;
  const lines: string[] = [
    `# compareReports — ${dateA} → ${dateB}`,
    '',
    `- A: ${dateA} — ${a.records} records (${a.sessions} sessions${a.records === 0 ? ', 无数据' : ''})`,
    `- B: ${dateB} — ${b.records} records (${b.sessions} sessions${b.records === 0 ? ', 无数据' : ''})`,
    '',
    '| metric | A | B | delta (B-A) |',
    '|---|---|---|---|',
  ];
  for (const d of deltas) {
    const digits = digitsFor(d.metric);
    lines.push(
      `| ${d.metric} | ${fmt(d.a, digits)} | ${fmt(d.b, digits)} | ${fmtDelta(d.delta, digits)} |`,
    );
  }

  // Per-cause transport movement, only for causes present on either side.
  const causes = new Set([
    ...Object.keys(a.transport ?? {}),
    ...Object.keys(b.transport ?? {}),
  ]);
  if (causes.size > 0) {
    lines.push('', '## 传输故障按因差值', '', '| cause | A | B | delta |', '|---|---|---|---|');
    for (const cause of [...causes].sort()) {
      const av = a.transport?.[cause] ?? 0;
      const bv = b.transport?.[cause] ?? 0;
      if (av === 0 && bv === 0) continue;
      lines.push(`| ${cause} | ${av} | ${bv} | ${fmtDelta(bv - av)} |`);
    }
  }
  lines.push('');

  return { a, b, deltas, markdown: lines.join('\n') };
}
