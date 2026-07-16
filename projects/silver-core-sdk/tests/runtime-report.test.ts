/**
 * Run-signal ledger + daily runtime report (SCS-REQ-002 loop 1 / REQ-1.1):
 *  - record builder: facts only; the incognito boundary strips identity,
 *    scenario and error text but keeps transport/token statistics (§6.4);
 *  - query() wiring: a run with options.runLog leaves one JSONL record per
 *    consumer-facing result, written through the single choke point;
 *  - generateRuntimeReport(): four sections aggregate correctly, absent
 *    signals render an explicit 无数据 marker (never silently omitted),
 *    window filtering and unrecovered detection work.
 */
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { query } from '../src/query.js';
import {
  buildRunLogRecord,
  createRunLogSink,
  generateRuntimeReport,
  runLogFileName,
} from '../src/index.js';
import type { Options, SDKMessage, SDKResultMessage } from '../src/types.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';
import { textReplyEvents } from './helpers/mock-transport.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runlog-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function resultFixture(over: Partial<SDKResultMessage & { errorMessage: string }> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    uuid: 'u1',
    session_id: 'sess-1',
    is_error: false,
    num_turns: 2,
    duration_ms: 1200,
    duration_api_ms: 900,
    total_cost_usd: 0.01,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 400,
      cache_creation_input_tokens: 20,
    },
    metrics: {
      numTurns: 2,
      durationMs: 1200,
      durationApiMs: 900,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 400,
        cache_creation_input_tokens: 20,
      },
      totalCostUsd: 0.01,
      cacheHitRatio: 0.8,
      perTurn: [],
      perTool: [{ name: 'Read', calls: 3, totalMs: 30, errors: 1 }],
      modelUsage: { 'claude-test-1': {} },
      transportHealth: {
        networkRetries: 2,
        httpRetries: 0,
        emptyStreamRetries: 0,
        midStreamDrops: 1,
        idleStalls: 0,
        maxDurationAborts: 0,
        turnsSalvaged: 1,
        turnReplays: 0,
      },
    },
    ...over,
  } as unknown as SDKResultMessage;
}

describe('buildRunLogRecord', () => {
  it('captures facts: subtype, counters, usage, transport, tools, models', () => {
    const rec = buildRunLogRecord(resultFixture(), { incognito: false, scenario: 'coding' });
    expect(rec.v).toBe(1);
    expect(rec.session_id).toBe('sess-1');
    expect(rec.scenario).toBe('coding');
    expect(rec.usage.cache_read_input_tokens).toBe(400);
    expect(rec.cache_hit_ratio).toBe(0.8);
    expect(rec.transport_health?.networkRetries).toBe(2);
    expect(rec.per_tool).toEqual([{ name: 'Read', calls: 3, errors: 1 }]);
    expect(rec.models).toEqual(['claude-test-1']);
  });

  it('incognito strips identity, scenario and error text but keeps stats (§6.4)', () => {
    const rec = buildRunLogRecord(
      resultFixture({
        subtype: 'error_during_execution',
        is_error: true,
        errorMessage: 'boom\nsecond line',
      } as never),
      { incognito: true, scenario: 'coding' },
    );
    expect(rec.incognito).toBe(true);
    expect(rec.session_id).toBeUndefined();
    expect(rec.scenario).toBeUndefined();
    expect(rec.error).toBeUndefined();
    expect(rec.transport_health).toBeDefined();
    expect(rec.usage.output_tokens).toBe(50);
  });

  it('named error records keep only the first error line, capped', () => {
    const rec = buildRunLogRecord(
      resultFixture({
        subtype: 'error_during_execution',
        is_error: true,
        errorMessage: `${'x'.repeat(500)}\ntail`,
      } as never),
      { incognito: false },
    );
    expect(rec.error).toHaveLength(300);
    expect(rec.error).not.toContain('tail');
  });
});

describe('createRunLogSink', () => {
  it('mirrors result messages only, one line each; non-results are ignored', async () => {
    const logDir = join(dir, 'sink');
    const sink = createRunLogSink({
      runLog: { dir: logDir, scenario: 's' },
      incognito: false,
      debug: () => {},
    });
    sink.observe({ type: 'system', subtype: 'init' } as never);
    sink.observe(resultFixture() as never);
    sink.observe(resultFixture({ session_id: 'sess-9' } as never) as never);
    // flush() (v0.51.2) resolves once all observed records are appended —
    // appends are serialized, so line order IS arrival order (the old 50ms
    // sleep raced two independent append chains and flaked in CI).
    await sink.flush();
    const lines = (await readFile(join(logDir, runLogFileName(new Date())), 'utf8'))
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).session_id).toBe('sess-1');
    expect(JSON.parse(lines[1]!).session_id).toBe('sess-9');
  });

  // audit 2026-07-14 L-16: the day file is derived from the RECORD'S ts (set at
  // observe time), not the flush-time clock. A record observed at 23:59:59 and
  // flushed after midnight must still land in the earlier day's file.
  it('writes to the record ts day file, not the flush-time clock (L-16)', async () => {
    vi.useFakeTimers();
    try {
      const logDir = join(dir, 'sink-l16');
      const sink = createRunLogSink({
        runLog: { dir: logDir },
        incognito: false,
        debug: () => {},
      });
      // Observe just before midnight on day A -> record.ts is day A.
      vi.setSystemTime(new Date('2026-07-14T23:59:59.000Z'));
      sink.observe(resultFixture() as never);
      // The append lands "later" — the wall clock is now day B.
      vi.setSystemTime(new Date('2026-07-15T00:00:01.000Z'));
      await sink.flush();
      const files = await readdir(logDir);
      // Belongs to day A (its observe-time ts), NOT day B (the flush clock).
      expect(files).toEqual(['runlog-2026-07-14.jsonl']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('query() runLog wiring', () => {
  it('writes one ledger record per consumer-facing result', async () => {
    const stub: SSEFetchStub = makeSSEFetch([textReplyEvents('ok')]);
    const logDir = join(dir, 'runlog');
    const options: Options = {
      cwd: dir,
      sessionDir: join(dir, 'sessions'),
      provider: { apiKey: 'k', promptCaching: false, fetch: stub },
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      model: 'claude-sonnet-4-5',
      settingSources: [],
      runLog: { dir: logDir, scenario: 'eval-fixture' },
    };
    const messages: SDKMessage[] = [];
    for await (const m of query({ prompt: 'hi', options })) messages.push(m);
    // fire-and-forget append: give the microtask queue one tick
    await new Promise((r) => setTimeout(r, 50));

    const files = await readdir(logDir);
    expect(files).toEqual([runLogFileName(new Date())]);
    const lines = (await readFile(join(logDir, files[0]!), 'utf8')).trim().split('\n');
    const results = messages.filter((m) => m.type === 'result');
    expect(lines).toHaveLength(results.length);
    const rec = JSON.parse(lines[0]!);
    expect(rec.subtype).toBe('success');
    expect(rec.scenario).toBe('eval-fixture');
    expect(typeof rec.session_id).toBe('string');
  });
});

describe('generateRuntimeReport', () => {
  const T0 = new Date('2026-07-11T12:00:00Z');

  async function seedLedger(records: object[], day = '2026-07-11') {
    const logDir = join(dir, 'ledger');
    await mkdir(logDir, { recursive: true });
    await writeFile(
      join(logDir, `runlog-${day}.jsonl`),
      records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    return logDir;
  }

  it('aggregates the four sections and writes runtime-report-{date}.md', async () => {
    const base = buildRunLogRecord(resultFixture(), { incognito: false, scenario: 'coding' });
    const fail = buildRunLogRecord(
      resultFixture({
        session_id: 'sess-2',
        subtype: 'error_during_execution',
        is_error: true,
        errorMessage: 'transport gave up',
      } as never),
      { incognito: false, scenario: 'non-coding' },
    );
    const ghost = buildRunLogRecord(resultFixture(), { incognito: true });
    const logDir = await seedLedger(
      [base, fail, ghost].map((r) => ({ ...r, ts: '2026-07-11T11:00:00Z' })),
    );

    const report = await generateRuntimeReport({ logDir, now: T0 });
    expect(report.path).not.toBeNull();
    expect(report.path).toContain('runtime-report-2026-07-11.md');
    const md = report.markdown;
    // 1. transport totals summed across records (3 records x fixture ledger)
    expect(md).toContain('networkRetries: 6');
    // unrecovered: the failed named record had faults AND ended as an error
    expect(md).toContain('sess-2');
    // 2. tokens + scenario split
    expect(report.summary.tokens?.input).toBe(300);
    expect(md).toContain('缓存命中率');
    expect(md).toContain('**coding**');
    expect(md).toContain('**non-coding**');
    // 3. tools table with failure rate
    expect(md).toContain('| Read | 9 | 3 | 33.3% |');
    // 4. failures: named only — the incognito record contributes stats, not rows
    expect(report.summary.failures).toHaveLength(1);
    expect(report.summary.incognitoRecords).toBe(1);
    expect(md).toContain('transport gave up');
  });

  it('absent signals render explicit 无数据 markers, never silent omission', async () => {
    const logDir = await seedLedger([]);
    const report = await generateRuntimeReport({ logDir, now: T0, outDir: null });
    expect(report.path).toBeNull();
    for (const section of ['## 1. 传输健康', '## 2. token 消耗', '## 3. 工具调用', '## 4. 失败会话']) {
      expect(report.markdown).toContain(section);
    }
    expect(report.markdown.match(/无数据/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it('bug-fix: a tool with calls=0 renders 无数据, never NaN%/Infinity%', async () => {
    // isRunLogRecord accepts calls:0 (external producers emit it), and the
    // failure-rate cell divided errors/calls with no zero guard — unlike the
    // guarded sibling in compare-reports.ts.
    const logDir = await seedLedger([
      {
        ts: '2026-07-11T11:00:00Z',
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        total_cost_usd: 0,
        per_tool: [
          { name: 'NeverCalled', calls: 0, errors: 0 },
          { name: 'ZeroWithErr', calls: 0, errors: 2 },
        ],
      },
    ]);
    const report = await generateRuntimeReport({ logDir, now: T0, outDir: null });
    expect(report.markdown).not.toContain('NaN');
    expect(report.markdown).not.toContain('Infinity');
    expect(report.markdown).toContain('| NeverCalled | 0 | 0 | 无数据 |');
    expect(report.markdown).toContain('| ZeroWithErr | 0 | 2 | 无数据 |');
  });

  it('window filtering drops records outside the rolling window', async () => {
    const inWin = { ...buildRunLogRecord(resultFixture(), { incognito: false }), ts: '2026-07-11T11:30:00Z' };
    const outWin = { ...buildRunLogRecord(resultFixture(), { incognito: false }), ts: '2026-07-09T11:30:00Z' };
    const logDir = await seedLedger([inWin]);
    await writeFile(
      join(logDir, 'runlog-2026-07-09.jsonl'),
      JSON.stringify(outWin) + '\n',
    );
    const report = await generateRuntimeReport({ logDir, now: T0, outDir: null });
    expect(report.summary.records).toBe(1);
  });

  it('wrong-shape JSON lines count as bad lines, never kill the report (audit 2026-07-14 M-12)', async () => {
    const good = {
      ...buildRunLogRecord(resultFixture(), { incognito: false, scenario: 'coding' }),
      ts: '2026-07-11T11:00:00Z',
    };
    const logDir = join(dir, 'ledger');
    await mkdir(logDir, { recursive: true });
    await writeFile(
      join(logDir, 'runlog-2026-07-11.jsonl'),
      `${JSON.stringify(good)}\n` +
        // well-formed JSON, wrong shape: no usage object at all
        '{"ts":"2026-07-11T11:00:00Z"}\n' +
        // well-formed JSON, wrong-typed usage
        `${JSON.stringify({ ...good, usage: 'nonsense' })}\n`,
    );

    const report = await generateRuntimeReport({ logDir, now: T0, outDir: null });
    // Succeeds; aggregates ONLY the valid record and counts the 2 bad lines.
    expect(report.summary.records).toBe(1);
    expect(report.summary.tokens?.input).toBe(100);
    expect(report.markdown).toContain('2 unparseable lines skipped');
  });

  it('missing log directory degrades to an all-无数据 report, not a throw', async () => {
    const report = await generateRuntimeReport({
      logDir: join(dir, 'does-not-exist'),
      now: T0,
      outDir: null,
    });
    expect(report.summary.records).toBe(0);
    expect(report.markdown).toContain('无数据');
  });
});
