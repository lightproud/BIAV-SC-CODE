/**
 * REQ-1.2 (SCS-REQ-002 loop 1): report trend comparison + rolling retention.
 *  - compareReports(dateA, dateB): re-aggregates the ledger per UTC day and
 *    returns b-a deltas for the key metrics; a day without data reads as
 *    explicit nulls / 无数据, never as zeros in disguise;
 *  - generateRuntimeReport retention: report files older than the window are
 *    pruned after each write; the raw ledger is only pruned on explicit
 *    opt-in (ledgerRetentionDays) — never by default.
 */
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compareReports, aggregateDay, generateRuntimeReport } from '../src/index.js';
import { ConfigurationError } from '../src/errors.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'compare-reports-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function line(over: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    v: 1,
    ts: '2026-07-10T10:00:00.000Z',
    session_id: 'sess-a',
    subtype: 'success',
    is_error: false,
    num_turns: 2,
    duration_ms: 1000,
    duration_api_ms: 800,
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 400,
      cache_creation_input_tokens: 0,
    },
    ...over,
  })}\n`;
}

async function seedDay(date: string, lines: string[]): Promise<void> {
  await writeFile(join(dir, `runlog-${date}.jsonl`), lines.join(''), 'utf8');
}

describe('aggregateDay', () => {
  it('aggregates one UTC day and rejects malformed dates', async () => {
    await seedDay('2026-07-10', [
      line(),
      line({
        ts: '2026-07-10T12:00:00.000Z',
        session_id: 'sess-b',
        is_error: true,
        subtype: 'error_during_execution',
        error: 'boom',
        transport_health: { requestPhaseRetries: 2, midStreamCuts: 1 },
        per_tool: [{ name: 'Read', calls: 4, errors: 1 }],
      }),
    ]);
    const agg = await aggregateDay(dir, '2026-07-10');
    expect(agg.records).toBe(2);
    expect(agg.sessions).toBe(2);
    expect(agg.transportFaultTotal).toBe(3);
    expect(agg.transport).toEqual({ requestPhaseRetries: 2, midStreamCuts: 1 });
    expect(agg.unrecovered).toBe(1);
    expect(agg.failures).toBe(1);
    expect(agg.tokens?.input).toBe(200);
    expect(agg.tokens?.cacheHitRate).toBeCloseTo(800 / 1000);
    expect(agg.tools).toEqual({ calls: 4, errors: 1, failureRate: 0.25 });

    await expect(aggregateDay(dir, '2026-7-10')).rejects.toThrow(ConfigurationError);
  });

  it('reads an empty day as explicit absence, not zeros-with-data', async () => {
    const agg = await aggregateDay(dir, '2026-07-09');
    expect(agg.records).toBe(0);
    expect(agg.transport).toBeNull();
    expect(agg.transportFaultTotal).toBeNull();
    expect(agg.tokens).toBeNull();
    expect(agg.tools).toBeNull();
  });
});

describe('compareReports', () => {
  it('returns b-a deltas for the key metrics with rates in percentage points', async () => {
    await seedDay('2026-07-10', [
      line({ transport_health: { midStreamCuts: 2 }, per_tool: [{ name: 'Read', calls: 10, errors: 2 }] }),
    ]);
    await seedDay('2026-07-11', [
      line({
        ts: '2026-07-11T10:00:00.000Z',
        total_cost_usd: 0.03,
        usage: {
          input_tokens: 300,
          output_tokens: 60,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
        },
        transport_health: { midStreamCuts: 0 },
        per_tool: [{ name: 'Read', calls: 10, errors: 0 }],
      }),
    ]);
    const cmp = await compareReports('2026-07-10', '2026-07-11', { logDir: dir });
    const byMetric = Object.fromEntries(cmp.deltas.map((d) => [d.metric, d]));
    expect(byMetric['transport_faults']).toMatchObject({ a: 2, b: 0, delta: -2 });
    expect(byMetric['cost_usd']?.delta).toBeCloseTo(0.02);
    expect(byMetric['cache_hit_rate_pct']?.a).toBeCloseTo(80);
    expect(byMetric['cache_hit_rate_pct']?.b).toBeCloseTo(25);
    expect(byMetric['tool_failure_rate_pct']?.delta).toBeCloseTo(-20);
    expect(cmp.markdown).toContain('| transport_faults | 2 | 0 | -2 |');
    expect(cmp.markdown).toContain('## 传输故障按因差值');
    expect(cmp.markdown).toContain('| midStreamCuts | 2 | 0 | -2 |');
  });

  it('marks a data-less side 无数据 and nulls its deltas', async () => {
    await seedDay('2026-07-11', [line({ ts: '2026-07-11T10:00:00.000Z' })]);
    const cmp = await compareReports('2026-07-01', '2026-07-11', { logDir: dir });
    const cost = cmp.deltas.find((d) => d.metric === 'cost_usd');
    expect(cost).toMatchObject({ a: null, delta: null });
    expect(cmp.markdown).toContain('无数据');
    expect(cmp.markdown).toContain('| cost_usd | 无数据 | 0.0100 | — |');
  });
});

describe('runtime report retention (REQ-1.2)', () => {
  it('prunes report files older than the window, keeps the ledger by default', async () => {
    const now = new Date('2026-07-12T12:00:00.000Z');
    const outDir = join(dir, 'reports');
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'runtime-report-2026-05-01.md'), 'old', 'utf8');
    await writeFile(join(outDir, 'runtime-report-2026-07-01.md'), 'recent', 'utf8');
    await writeFile(join(outDir, 'unrelated.md'), 'keep', 'utf8');
    await seedDay('2026-05-01', [line({ ts: '2026-05-01T10:00:00.000Z' })]);

    await generateRuntimeReport({ logDir: dir, outDir, now });

    const reports = (await readdir(outDir)).sort();
    expect(reports).toEqual([
      'runtime-report-2026-07-01.md',
      'runtime-report-2026-07-12.md',
      'unrelated.md',
    ]);
    // Ledger untouched without the explicit opt-in.
    expect(await readdir(dir)).toContain('runlog-2026-05-01.jsonl');
  });

  it('prunes the ledger only on explicit ledgerRetentionDays opt-in', async () => {
    const now = new Date('2026-07-12T12:00:00.000Z');
    await seedDay('2026-05-01', [line({ ts: '2026-05-01T10:00:00.000Z' })]);
    await seedDay('2026-07-11', [line({ ts: '2026-07-11T10:00:00.000Z' })]);

    await generateRuntimeReport({ logDir: dir, outDir: join(dir, 'reports'), now, ledgerRetentionDays: 30 });

    const names = await readdir(dir);
    expect(names).not.toContain('runlog-2026-05-01.jsonl');
    expect(names).toContain('runlog-2026-07-11.jsonl');
  });

  it('retentionDays: 0 disables report pruning', async () => {
    const now = new Date('2026-07-12T12:00:00.000Z');
    const outDir = join(dir, 'reports');
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'runtime-report-2020-01-01.md'), 'ancient', 'utf8');

    await generateRuntimeReport({ logDir: dir, outDir, now, retentionDays: 0 });

    expect(await readdir(outDir)).toContain('runtime-report-2020-01-01.md');
  });
});
