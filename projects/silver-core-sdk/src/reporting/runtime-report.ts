/**
 * Daily runtime report (self-improvement spec SCS-REQ-002 loop 1 / REQ-1.1).
 *
 * generateRuntimeReport() aggregates the run-signal ledger (run-log.ts JSONL
 * day files) over a rolling window (default 24h) into ONE agent-readable
 * Markdown file — the replacement for a human trawling dashboards. Four
 * signal sections, each explicitly marked "无数据" when its signal is absent
 * (REQ-1.1 acceptance: no silent omissions):
 *
 *  1. 传输健康 — transport-health ledger totals by cause, plus the sessions
 *     whose faults exceeded the recoverable layers (unrecovered list);
 *  2. token 消耗 — input/output totals, cache hit rate, top consumers split
 *     by scenario tag;
 *  3. 工具调用 — tool name × call count × failure rate;
 *  4. 失败会话 — non-success terminations, facts only (subtype + first error
 *     line; incognito records are excluded from this section by
 *     construction — their ledger lines carry no identity or error text).
 *
 * Zero runtime dependencies; pure node:fs. The report targets <= 8K tokens:
 * lists are capped (top N), and the caps are stated inline when they bite.
 */

import { readdir, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigurationError } from '../errors.js';
import type { RunLogRecord } from './run-log.js';

export type RuntimeReportOptions = {
  /** Directory holding runlog-*.jsonl day files (RunLogOptions.dir). */
  logDir: string;
  /** Output directory; default `{logDir}/../reports`. Set null to skip writing. */
  outDir?: string | null;
  /** Window end; default now. */
  now?: Date;
  /** Rolling window size; default 24h. */
  windowHours?: number;
  /** Cap for every list section; default 5. */
  topN?: number;
  /** Rolling window for written report files (REQ-1.2): reports older than
   *  this many days are pruned after each write. Default 30; 0 disables. */
  retentionDays?: number;
  /** Optional rolling window for the raw runlog-*.jsonl day files. Default
   *  undefined = never prune the ledger (it is the signal source of record;
   *  deleting it is the consumer's explicit call, not ours). */
  ledgerRetentionDays?: number;
};

export type RuntimeReportResult = {
  /** Absolute path of the written file, or null when outDir is null. */
  path: string | null;
  markdown: string;
  /** Machine-readable aggregation (what the Markdown renders). */
  summary: {
    window: { from: string; to: string };
    records: number;
    sessions: number;
    incognitoRecords: number;
    transport: Record<string, number> | null;
    unrecovered: Array<{ session_id: string; detail: string }>;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
      cacheHitRate: number | null;
      costUsd: number;
    } | null;
    tools: Array<{ name: string; calls: number; errors: number }> | null;
    failures: Array<{ session_id: string; subtype: string; error?: string }> | null;
  };
};

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** Deterministic code-unit string order — a stable secondary sort key so
 *  equal-primary-key rows keep one fixed relative order across runs instead of
 *  reshuffling at a slice() cutoff (audit r4 Rst-1/Rst-2). */
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Shape guard for one parsed ledger line (audit 2026-07-14 M-12): a
 * well-formed-JSON-but-wrong-shape line (external producer, schema drift)
 * must land in the bad-line counter, not throw out of the aggregation —
 * "bad lines are counted, not fatal". Checks exactly the fields the
 * aggregations dereference (in this file AND in compare-reports.ts, which
 * consumes the same guarded readWindow): `ts` string; `usage` object with
 * the four numeric token counters; `total_cost_usd` number;
 * `transport_health`, when present, an object (Object.entries target);
 * `per_tool`, when present, an array of objects with numeric calls/errors.
 * Unknown record types / extra fields pass through untouched — they cannot
 * crash the aggregation.
 */
function isRunLogRecord(x: unknown): x is RunLogRecord {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  if (typeof r['ts'] !== 'string') return false;
  const usage = r['usage'];
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return false;
  const u = usage as Record<string, unknown>;
  for (const k of [
    'input_tokens',
    'output_tokens',
    'cache_read_input_tokens',
    'cache_creation_input_tokens',
  ]) {
    if (typeof u[k] !== 'number') return false;
  }
  if (typeof r['total_cost_usd'] !== 'number') return false;
  const th = r['transport_health'];
  if (th !== undefined && (typeof th !== 'object' || th === null)) return false;
  const pt = r['per_tool'];
  if (pt !== undefined) {
    if (!Array.isArray(pt)) return false;
    for (const t of pt) {
      if (typeof t !== 'object' || t === null) return false;
      const tool = t as Record<string, unknown>;
      if (typeof tool['calls'] !== 'number' || typeof tool['errors'] !== 'number') return false;
    }
  }
  return true;
}

/** Parse every ledger line in the window (bad lines are counted, not fatal).
 *  Internal contract shared with compare-reports.ts — not part of the
 *  public package surface. */
export async function readWindow(
  logDir: string,
  from: Date,
  to: Date,
): Promise<{ records: RunLogRecord[]; badLines: number }> {
  let names: string[] = [];
  try {
    names = (await readdir(logDir)).filter((n) => /^runlog-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n));
  } catch {
    return { records: [], badLines: 0 };
  }
  // Day files: only days intersecting the window need reading.
  const fromDay = from.toISOString().slice(0, 10);
  const toDay = to.toISOString().slice(0, 10);
  const records: RunLogRecord[] = [];
  let badLines = 0;
  for (const name of names.sort()) {
    const day = name.slice('runlog-'.length, -'.jsonl'.length);
    if (day < fromDay || day > toDay) continue;
    // A day file can vanish between readdir and this read (concurrent
    // pruneDayFiles / external cleanup); observability reads never throw
    // (audit 2026-07-17 L42) — skip the missing file.
    let text: string;
    try {
      text = await readFile(join(logDir, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        const rec: unknown = JSON.parse(line);
        // Shape guard (audit 2026-07-14 M-12): wrong-shape lines join the
        // torn/non-JSON lines in the bad-line counter instead of throwing
        // later when the aggregation dereferences rec.usage.* etc.
        if (!isRunLogRecord(rec)) {
          badLines += 1;
          continue;
        }
        const t = new Date(rec.ts).getTime();
        // An unparseable timestamp ("2026-13-99") produced NaN and fell out
        // of the window silently — it is a BAD line, count it (audit
        // 2026-07-17 L43).
        if (Number.isNaN(t)) {
          badLines += 1;
          continue;
        }
        if (t >= from.getTime() && t <= to.getTime()) records.push(rec);
      } catch {
        badLines += 1;
      }
    }
  }
  return { records, badLines };
}

/** Delete day-stamped files older than the retention window (best-effort). */
async function pruneDayFiles(
  dir: string,
  pattern: RegExp,
  now: Date,
  retentionDays: number,
): Promise<void> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString().slice(0, 10);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const m = pattern.exec(name);
    if (m === null || m[1]! >= cutoff) continue;
    try {
      await rm(join(dir, name), { force: true });
    } catch {
      /* best-effort: a locked file must not break report generation */
    }
  }
}

export async function generateRuntimeReport(
  options: RuntimeReportOptions,
): Promise<RuntimeReportResult> {
  const now = options.now ?? new Date();
  // audit r4 Rdt-3: an unvalidated windowHours poisoned the window — NaN /
  // Infinity produced an Invalid Date whose toISOString() later threw a
  // RangeError, and a negative value silently reported "no activity" from a
  // backwards window. Reject non-finite / non-positive windows with the same
  // typed error the sibling aggregateDay() uses for bad dates.
  const windowHours = options.windowHours ?? 24;
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    throw new ConfigurationError(
      `generateRuntimeReport: windowHours must be a positive finite number, got ${String(windowHours)}`,
    );
  }
  const windowMs = windowHours * 3_600_000;
  const from = new Date(now.getTime() - windowMs);
  const topN = options.topN ?? 5;
  const { records, badLines } = await readWindow(options.logDir, from, now);

  const named = records.filter((r) => r.incognito !== true);
  const sessions = new Set(named.map((r) => r.session_id));

  // 1. transport health
  const transportRecords = records.filter((r) => r.transport_health !== undefined);
  let transport: Record<string, number> | null = null;
  const unrecovered: Array<{ session_id: string; detail: string }> = [];
  if (transportRecords.length > 0) {
    transport = {};
    for (const r of transportRecords) {
      for (const [k, v] of Object.entries(r.transport_health!)) {
        transport[k] = (transport[k] ?? 0) + (typeof v === 'number' ? v : 0);
      }
      // "Unrecovered" = the run still ended as an error while its ledger shows
      // transport faults: the recoverable layers were not enough.
      const faults = Object.values(r.transport_health!).reduce(
        (a, b) => a + (typeof b === 'number' ? b : 0),
        0,
      );
      if (r.is_error && faults > 0 && r.incognito !== true) {
        unrecovered.push({
          session_id: r.session_id ?? '(unknown)',
          detail: `${r.subtype}; faults=${faults}${r.error !== undefined ? `; ${r.error}` : ''}`,
        });
      }
    }
  }

  // 2. tokens
  let tokens: RuntimeReportResult['summary']['tokens'] = null;
  if (records.length > 0) {
    const input = records.reduce((a, r) => a + r.usage.input_tokens, 0);
    const output = records.reduce((a, r) => a + r.usage.output_tokens, 0);
    const cacheRead = records.reduce((a, r) => a + r.usage.cache_read_input_tokens, 0);
    const cacheCreation = records.reduce((a, r) => a + r.usage.cache_creation_input_tokens, 0);
    // audit r4 U7-1/U7-3: the cache-hit denominator must include
    // cache_creation — cache_read / (input + cache_read + cache_creation) —
    // matching the authoritative SDKRunMetrics.cacheHitRatio definition.
    // Omitting it inflated the rate (98% vs true 49.5%) and, on a cold-cache
    // day (all cache_creation, zero read/input), collapsed the denom to 0 →
    // rendered 无数据 despite real input-side spend.
    const denom = input + cacheRead + cacheCreation;
    tokens = {
      input,
      output,
      cacheRead,
      cacheCreation,
      cacheHitRate: denom > 0 ? cacheRead / denom : null,
      costUsd: records.reduce((a, r) => a + r.total_cost_usd, 0),
    };
  }
  const byScenario = new Map<string, RunLogRecord[]>();
  for (const r of named) {
    const key = r.scenario ?? '(untagged)';
    const arr = byScenario.get(key) ?? [];
    arr.push(r);
    byScenario.set(key, arr);
  }

  // 3. tools
  const toolAgg = new Map<string, { calls: number; errors: number }>();
  for (const r of records) {
    for (const t of r.per_tool ?? []) {
      const cur = toolAgg.get(t.name) ?? { calls: 0, errors: 0 };
      cur.calls += t.calls;
      cur.errors += t.errors;
      toolAgg.set(t.name, cur);
    }
  }
  const tools =
    toolAgg.size > 0
      ? [...toolAgg.entries()]
          .map(([name, v]) => ({ name, ...v }))
          // audit r4 Rst-2: tiebreak by name so equal-calls rows at the
          // slice() cutoff are deterministic across runs.
          .sort((a, b) => b.calls - a.calls || cmpStr(a.name, b.name))
      : null;

  // 4. failures (named records only — incognito is excluded by construction)
  const failureRecords = named.filter((r) => r.is_error);
  const failures =
    failureRecords.length > 0
      ? failureRecords.map((r) => ({
          session_id: r.session_id ?? '(unknown)',
          subtype: r.subtype,
          ...(r.error !== undefined ? { error: r.error } : {}),
        }))
      : null;

  // ---- render -------------------------------------------------------------
  const date = now.toISOString().slice(0, 10);
  const lines: string[] = [
    `# Runtime report — ${date}`,
    '',
    `- window: ${from.toISOString()} → ${now.toISOString()} (${windowHours}h)`,
    `- records: ${records.length} (${sessions.size} sessions, ${records.length - named.length} incognito${badLines > 0 ? `, ${badLines} unparseable lines skipped` : ''})`,
    '',
    '## 1. 传输健康 (transportHealth)',
  ];
  if (transport === null) {
    lines.push('无数据(窗口内无携带 transport_health 的记录)。');
  } else {
    const entries = Object.entries(transport).filter(([, v]) => v > 0);
    lines.push(
      entries.length === 0
        ? '- 全零(窗口内所有运行网络干净)。'
        : entries.map(([k, v]) => `- ${k}: ${v}`).join('\n'),
    );
    lines.push('', '### 未恢复会话');
    if (unrecovered.length === 0) lines.push('无(所有传输故障均被恢复层吸收)。');
    else {
      for (const u of unrecovered.slice(0, topN)) lines.push(`- ${u.session_id}: ${u.detail}`);
      if (unrecovered.length > topN) lines.push(`- …共 ${unrecovered.length} 条(截断至前 ${topN})`);
    }
  }
  lines.push('', '## 2. token 消耗');
  if (tokens === null) {
    lines.push('无数据(窗口内无记录)。');
  } else {
    lines.push(
      `- input ${tokens.input} / output ${tokens.output} / cache_read ${tokens.cacheRead} / cache_creation ${tokens.cacheCreation}`,
      `- 缓存命中率: ${tokens.cacheHitRate === null ? '无数据(零输入)' : fmtPct(tokens.cacheHitRate)}`,
      `- 成本合计: $${tokens.costUsd.toFixed(4)}`,
      '',
      '### 按场景 top 消耗',
    );
    if (byScenario.size === 0) lines.push('无数据(窗口内无具名记录)。');
    for (const [scenario, rs] of byScenario) {
      const top = [...rs]
        // audit r4 Rst-1: tiebreak by session_id so equal-output sessions at
        // the topN cutoff appear deterministically across runs.
        .sort(
          (a, b) =>
            b.usage.output_tokens - a.usage.output_tokens ||
            cmpStr(a.session_id ?? '', b.session_id ?? ''),
        )
        .slice(0, topN);
      lines.push(`- **${scenario}**(${rs.length} 条):`);
      for (const r of top) {
        lines.push(
          `  - ${r.session_id}: out ${r.usage.output_tokens}, in ${r.usage.input_tokens}, $${r.total_cost_usd.toFixed(4)}`,
        );
      }
    }
  }
  lines.push('', '## 3. 工具调用');
  if (tools === null) {
    lines.push('无数据(窗口内无携带 per_tool 的记录)。');
  } else {
    lines.push('| tool | calls | errors | failure rate |', '|---|---|---|---|');
    for (const t of tools.slice(0, Math.max(topN * 2, 10))) {
      lines.push(
        `| ${t.name} | ${t.calls} | ${t.errors} | ${t.calls > 0 ? fmtPct(t.errors / t.calls) : '无数据'} |`,
      );
    }
    if (tools.length > Math.max(topN * 2, 10)) {
      lines.push('', `…共 ${tools.length} 个工具(截断)。`);
    }
  }
  lines.push('', '## 4. 失败会话(仅事实)');
  if (failures === null) {
    lines.push('无数据(窗口内无失败的具名会话)。');
  } else {
    for (const f of failures.slice(0, topN * 2)) {
      lines.push(`- ${f.session_id}: ${f.subtype}${f.error !== undefined ? ` — ${f.error}` : ''}`);
    }
    if (failures.length > topN * 2) lines.push(`- …共 ${failures.length} 条(截断)。`);
  }
  lines.push('');
  const markdown = lines.join('\n');

  let path: string | null = null;
  if (options.outDir !== null) {
    const outDir = options.outDir ?? join(options.logDir, '..', 'reports');
    await mkdir(outDir, { recursive: true });
    path = join(outDir, `runtime-report-${date}.md`);
    await writeFile(path, markdown, 'utf8');
    // REQ-1.2 rolling window: prune old reports (default 30 days), and the
    // raw ledger only when the consumer explicitly opted in. Pruning is
    // best-effort — observability must never throw.
    const retentionDays = options.retentionDays ?? 30;
    if (retentionDays > 0) {
      await pruneDayFiles(outDir, /^runtime-report-(\d{4}-\d{2}-\d{2})\.md$/, now, retentionDays);
    }
    if (options.ledgerRetentionDays !== undefined && options.ledgerRetentionDays > 0) {
      await pruneDayFiles(
        options.logDir,
        /^runlog-(\d{4}-\d{2}-\d{2})\.jsonl$/,
        now,
        options.ledgerRetentionDays,
      );
    }
  }

  return {
    path,
    markdown,
    summary: {
      window: { from: from.toISOString(), to: now.toISOString() },
      records: records.length,
      sessions: sessions.size,
      incognitoRecords: records.length - named.length,
      transport,
      unrecovered,
      tokens,
      tools,
      failures,
    },
  };
}
