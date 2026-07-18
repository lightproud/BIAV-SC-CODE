/**
 * Audit r4 (2026-07-17) — reporting cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - U7-1/U7-3: the cache-hit denominator includes cache_creation, matching
 *    the authoritative SDKRunMetrics.cacheHitRatio definition — no inflated
 *    rate, and a cold-cache day reads 0% (real spend), not 无数据.
 *  - U7-2: a transport-data-less side renders 无数据 / — in the per-cause
 *    table, never a forged "+N" that contradicts the summary row.
 *  - U7-4: a negative/garbage transport counter clamps to 0 and never drags
 *    `faults` <= 0 to suppress the unrecovered classification.
 *  - Rst-1/Rst-2: top-consumer and tool sorts carry deterministic tiebreaks.
 *  - Rdt-3: an invalid windowHours is rejected with a typed error, never an
 *    Invalid-Date RangeError or a false "no activity".
 *  - Sls-1: a NaN/Infinity cost cannot poison SessionAccounting.cost — the
 *    budget gate stays a live finite comparison.
 *  - Sls-2: a malformed result never throws out of RunLogSink.observe(); the
 *    sink keeps working ("a ledger fault never breaks the run").
 *  - Sls-3: NOT APPLIED (deliberate) — §6.4 keeps aggregate per_tool/models on
 *    an incognito record (name→count map, not identity); see the lock below.
 *  - R7s-10: the run-log error field truncation never splits a surrogate pair.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  aggregateDay,
  buildRunLogRecord,
  compareReports,
  createRunLogSink,
  generateRuntimeReport,
  runLogFileName,
} from '../src/index.js';
import { ConfigurationError } from '../src/errors.js';
import { SessionAccounting } from '../src/query-accounting.js';
import type { SDKResultMessage } from '../src/types.js';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const NOW = new Date('2026-07-11T12:00:00Z');

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'audit-r4-reporting-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** One raw ledger record (isRunLogRecord-valid by default). */
function rawRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    ts: '2026-07-11T11:00:00.000Z',
    session_id: 'sess-1',
    subtype: 'success',
    is_error: false,
    num_turns: 1,
    duration_ms: 100,
    duration_api_ms: 80,
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    ...over,
  };
}

async function seedDay(date: string, records: object[]): Promise<void> {
  await writeFile(
    join(dir, `runlog-${date}.jsonl`),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );
}

/** A consumer-facing result message for SessionAccounting / run-log tests. */
function result(over: Record<string, unknown> = {}): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    session_id: 'sess-1',
    is_error: false,
    num_turns: 1,
    duration_ms: 100,
    duration_api_ms: 80,
    total_cost_usd: 0,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      web_search_requests: 0,
    },
    modelUsage: {},
    ...over,
  } as unknown as SDKResultMessage;
}

/** A result carrying metrics.perTool / modelUsage / transportHealth. */
function metricResult(over: Record<string, unknown> = {}): SDKResultMessage {
  return result({
    metrics: {
      perTool: [{ name: 'Read', calls: 3, totalMs: 30, errors: 1 }],
      modelUsage: { 'claude-test-1': {} },
      transportHealth: {
        networkRetries: 1,
        httpRetries: 0,
        emptyStreamRetries: 0,
        midStreamDrops: 0,
        idleStalls: 0,
        maxDurationAborts: 0,
        turnsSalvaged: 0,
        turnReplays: 0,
      },
    },
    ...over,
  });
}

// ---------------------------------------------------------------------------
// U7-1 / U7-3: cache-hit denominator
// ---------------------------------------------------------------------------

describe('U7-1/U7-3: cacheHitRate denominator includes cache_creation', () => {
  it('runtime-report rate matches the authoritative cache_read/(in+read+creation)', async () => {
    await seedDay('2026-07-11', [
      rawRecord({
        usage: {
          input_tokens: 5,
          output_tokens: 5,
          cache_read_input_tokens: 495,
          cache_creation_input_tokens: 500,
        },
      }),
    ]);
    const report = await generateRuntimeReport({ logDir: dir, now: NOW, outDir: null });
    const t = report.summary.tokens!;
    // 495 / (5 + 495 + 500) = 0.495 — NOT the inflated 495/500 = 0.99.
    expect(t.cacheHitRate).toBeCloseTo(495 / 1000);
    expect(t.cacheHitRate!).toBeLessThan(0.5);
    // U7-3: the report's recompute is the authoritative definition, not a
    // second, silently-divergent one.
    expect(t.cacheHitRate!).toBeCloseTo(t.cacheRead / (t.input + t.cacheRead + t.cacheCreation));
  });

  it('cold-cache day (all creation, zero read/input) reads 0%, not 无数据', async () => {
    await seedDay('2026-07-11', [
      rawRecord({
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 1_000_000,
        },
      }),
    ]);
    const report = await generateRuntimeReport({ logDir: dir, now: NOW, outDir: null });
    expect(report.summary.tokens?.cacheHitRate).toBe(0);
    expect(report.markdown).toContain('缓存命中率: 0.0%');
    expect(report.markdown).not.toContain('无数据(零输入)');
  });

  it('aggregateDay uses the same corrected denominator', async () => {
    await seedDay('2026-07-10', [
      rawRecord({
        ts: '2026-07-10T10:00:00.000Z',
        usage: {
          input_tokens: 5,
          output_tokens: 5,
          cache_read_input_tokens: 495,
          cache_creation_input_tokens: 500,
        },
      }),
    ]);
    const agg = await aggregateDay(dir, '2026-07-10');
    expect(agg.tokens?.cacheHitRate).toBeCloseTo(495 / 1000);
  });
});

// ---------------------------------------------------------------------------
// U7-2: per-cause transport table agrees with the summary
// ---------------------------------------------------------------------------

describe('U7-2: a data-less transport side is 无数据, not a forged +N delta', () => {
  it('per-cause table matches the summary — no "0" masquerading for "no data"', async () => {
    // Day A: records but NO transport signal. Day B: a real transport fault.
    await seedDay('2026-07-10', [rawRecord({ ts: '2026-07-10T10:00:00.000Z' })]);
    await seedDay('2026-07-11', [
      rawRecord({ ts: '2026-07-11T10:00:00.000Z', transport_health: { midStreamDrops: 5 } }),
    ]);
    const cmp = await compareReports('2026-07-10', '2026-07-11', { logDir: dir });
    // Summary row already treats A as 无数据 / —.
    expect(cmp.markdown).toContain('| transport_faults | 无数据 | 5 | — |');
    // Per-cause table must AGREE — the old code forged "| midStreamDrops | 0 | 5 | +5 |".
    expect(cmp.markdown).toContain('| midStreamDrops | 无数据 | 5 | — |');
    expect(cmp.markdown).not.toContain('| midStreamDrops | 0 | 5 | +5 |');
  });
});

// ---------------------------------------------------------------------------
// U7-4: negative transport counters clamp and do not suppress unrecovered
// ---------------------------------------------------------------------------

describe('U7-4: negative transport counters clamp to 0', () => {
  it('a -1 counter does not drag faults to 0 and suppress the unrecovered column', async () => {
    await seedDay('2026-07-10', [
      rawRecord({
        ts: '2026-07-10T10:00:00.000Z',
        is_error: true,
        subtype: 'error_during_execution',
        transport_health: { midStreamDrops: 1, networkRetries: -1 },
      }),
    ]);
    const agg = await aggregateDay(dir, '2026-07-10');
    // Unclamped: faults = 1 + (-1) = 0 -> unrecovered stays 0, total reads 0.
    expect(agg.transportFaultTotal).toBe(1);
    expect(agg.unrecovered).toBe(1);
    expect(agg.transport).toEqual({ midStreamDrops: 1, networkRetries: 0 });
  });
});

// ---------------------------------------------------------------------------
// Rst-1 / Rst-2: deterministic sort tiebreaks
// ---------------------------------------------------------------------------

describe('Rst-1/Rst-2: equal-key rows sort deterministically', () => {
  it('Rst-1: equal-output sessions order by session_id regardless of input order', async () => {
    // Seeded worst-case: sess-b BEFORE sess-a, both output 100.
    await seedDay('2026-07-11', [
      rawRecord({
        session_id: 'sess-b',
        scenario: 'coding',
        usage: {
          input_tokens: 1,
          output_tokens: 100,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
      rawRecord({
        session_id: 'sess-a',
        scenario: 'coding',
        usage: {
          input_tokens: 1,
          output_tokens: 100,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    ]);
    const report = await generateRuntimeReport({ logDir: dir, now: NOW, outDir: null });
    const md = report.markdown;
    expect(md).toContain('sess-a: out 100');
    expect(md).toContain('sess-b: out 100');
    expect(md.indexOf('sess-a: out 100')).toBeLessThan(md.indexOf('sess-b: out 100'));
  });

  it('Rst-2: equal-calls tools order by name regardless of first-seen order', async () => {
    await seedDay('2026-07-11', [
      rawRecord({
        per_tool: [
          { name: 'Zebra', calls: 5, errors: 0 },
          { name: 'Apple', calls: 5, errors: 0 },
        ],
      }),
    ]);
    const report = await generateRuntimeReport({ logDir: dir, now: NOW, outDir: null });
    const md = report.markdown;
    expect(md.indexOf('| Apple |')).toBeGreaterThan(-1);
    expect(md.indexOf('| Apple |')).toBeLessThan(md.indexOf('| Zebra |'));
  });
});

// ---------------------------------------------------------------------------
// Rdt-3: windowHours validation
// ---------------------------------------------------------------------------

describe('Rdt-3: invalid windowHours is rejected with a typed error', () => {
  it('NaN / Infinity / negative windowHours throw ConfigurationError', async () => {
    for (const bad of [NaN, Infinity, -1, 0]) {
      await expect(
        generateRuntimeReport({ logDir: dir, windowHours: bad, now: NOW, outDir: null }),
      ).rejects.toThrow(ConfigurationError);
    }
  });

  it('a valid windowHours still produces a report', async () => {
    await seedDay('2026-07-11', [rawRecord()]);
    const report = await generateRuntimeReport({ logDir: dir, windowHours: 6, now: NOW, outDir: null });
    expect(report.summary.records).toBe(1);
    expect(report.markdown).toContain('(6h)');
  });
});

// ---------------------------------------------------------------------------
// Sls-1: NaN cost cannot poison SessionAccounting
// ---------------------------------------------------------------------------

describe('Sls-1: SessionAccounting guards non-finite counters', () => {
  it('a NaN total_cost_usd does not permanently poison acct.cost', () => {
    const acct = new SessionAccounting();
    acct.accumulateResult(result({ total_cost_usd: 0.5 }));
    acct.accumulateResult(result({ total_cost_usd: NaN }));
    expect(Number.isFinite(acct.cost)).toBe(true);
    expect(acct.cost).toBeCloseTo(0.5);
    // The budget gate is a live finite comparison again (NaN >= x is false).
    expect(acct.cost >= 0.4).toBe(true);
  });

  it('an aborted run with an Infinity cost also stays finite', () => {
    const acct = new SessionAccounting();
    acct.accumulateResult(result({ total_cost_usd: 0.5 }));
    acct.accumulateAborted({
      numTurns: 1,
      totalCostUsd: Infinity,
      durationApiMs: 5,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        web_search_requests: 0,
      },
      modelUsage: {},
    });
    expect(Number.isFinite(acct.cost)).toBe(true);
    expect(acct.cost).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// Sls-2: a malformed result never breaks the run-log sink
// ---------------------------------------------------------------------------

describe('Sls-2: RunLogSink.observe() swallows synchronous build faults', () => {
  it('a result missing usage does not throw out of observe(); the sink survives', async () => {
    const logDir = join(dir, 'sink');
    const sink = createRunLogSink({ runLog: { dir: logDir }, incognito: false, debug: () => {} });
    // No `usage` -> buildRunLogRecord dereferences undefined.input_tokens.
    expect(() => sink.observe({ type: 'result', subtype: 'success', is_error: false } as never)).not.toThrow();
    // A subsequent valid result must still be recorded (chain not wedged).
    sink.observe(result() as never);
    await sink.flush();
    const lines = (await readFile(join(logDir, runLogFileName(new Date())), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).session_id).toBe('sess-1');
  });
});

// ---------------------------------------------------------------------------
// Sls-3 NOT APPLIED (deliberate, test-locked): §6.4 deliberately KEEPS
// aggregate transport/token/tool stats on an incognito record (per_tool is a
// name->count map, not session-identifying); runtime-report.test.ts locks the
// incognito record contributing to the aggregate tools table. The audit's
// "strip per_tool/models" premise conflicts with that established contract, so
// it is not applied — this lock documents the KEEP behavior.
// ---------------------------------------------------------------------------

describe('Sls-3 (not applied): incognito keeps aggregate per_tool / models per §6.4', () => {
  it('an incognito record drops identity but KEEPS aggregate stats', () => {
    const ghost = buildRunLogRecord(metricResult(), { incognito: true });
    expect(ghost.incognito).toBe(true);
    // §6.4: identity goes, aggregate transport/token/tool stats stay.
    expect(ghost.session_id).toBeUndefined();
    expect(ghost.per_tool).toEqual([{ name: 'Read', calls: 3, errors: 1 }]);
    expect(ghost.models).toEqual(['claude-test-1']);
    expect(ghost.transport_health).toBeDefined();
    expect(ghost.usage.output_tokens).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// R7s-10: surrogate-safe error truncation
// ---------------------------------------------------------------------------

describe('R7s-10: run-log error truncation never splits a surrogate pair', () => {
  it('a surrogate pair straddling the 300-char cut is not left half in the field', () => {
    // 299 filler chars, then an astral codepoint whose high surrogate sits at
    // index 299 — a bare slice(0,300) would keep the lone high surrogate.
    const errorMessage = 'a'.repeat(299) + String.fromCodePoint(0x1d11e);
    const rec = buildRunLogRecord(
      result({ is_error: true, subtype: 'error_during_execution', errorMessage } as never),
      { incognito: false },
    );
    expect(rec.error).toBeDefined();
    expect(LONE_SURROGATE.test(rec.error!)).toBe(false);
    // The unsafe half-pair unit is dropped -> length 299, not 300.
    expect(rec.error).toHaveLength(299);
  });
});
