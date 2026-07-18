/**
 * Acceptance 1 (construction cover §3.1): example 1 — the minimal loop — RUNS
 * on the ledger, consuming the agent SDK's real R2 budget event stream. The
 * agent stack here is the real one (real HTTP, real engine loop); only the
 * model is scripted, by a ~40-line local Messages-API emulator written from
 * the public wire shape (no agent-SDK internals imported — the emulator is an
 * HTTP peer, not a library consumer).
 *
 * Script: call 1 answers cheaply (end_turn); call 2 answers with a tool_use
 * turn whose usage costs far beyond the remaining budget, so the engine
 * records the cost, refuses the tool call at the budget gate, fires
 * `budget:threshold` + `budget:exhausted` (R2) and stops — and the loop winds
 * down on the closeout report.
 */
import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { LedgerStore, QueryRecord } from 'silver-core-maestro-sdk';
import { runMinimalLoop, memoryLedgerStore } from '../examples/minimal-loop.js';

function sse(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function msgStart(res: http.ServerResponse, model: string, inputTokens: number): void {
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: `msg_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  });
}
/** Cheap plain-text turn: ~$0.0006 at claude-sonnet pricing. */
function streamCheapText(res: http.ServerResponse, model: string, text: string): void {
  msgStart(res, model, 100);
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}
/** A tool_use turn whose recorded usage (2M input tokens ~= $6) busts any small cap. */
function streamBudgetBuster(res: http.ServerResponse, model: string): void {
  msgStart(res, model, 2_000_000);
  sse(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id: 'toolu_bust_1', name: 'Bash', input: {} },
  });
  sse(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: '{"command":"echo hi"}' },
  });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 15 } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  let call = 0;
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { model } = JSON.parse(body) as { model: string };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      call += 1;
      if (call === 1) streamCheapText(res, model, 'tick one, all quiet');
      else streamBudgetBuster(res, model);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr !== null ? addr.port : 0}`;
      resolve();
    });
  });
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('example 1: minimal loop over the real agent stack', () => {
  it('polls periodically, hits the cap, consumes R2 events and winds down on the closeout', async () => {
    // Interval wide enough that tick 1 settles before tick 2 dispatches: the
    // budget reservation (G2) deliberately refuses to arm a second query
    // while the first holds the full remaining budget, and this scenario
    // needs tick 2 to actually reach the emulator's budget-buster call.
    const result = await runMinimalLoop({
      intervalMs: 500,
      pollIntervalMs: 25,
      totalBudgetUsd: 0.05,
      maxTicks: 2,
      prompt: 'patrol the shop',
      queryOptions: {
        model: 'claude-sonnet-4-5',
        provider: { apiKey: 'test-key', baseUrl },
        persistSession: false,
      },
    });

    // Wind-down came from the R2 exhaustion event, not the tick limit.
    expect(result.windDownReason).toBe('budget:exhausted');

    // The R2 stream was genuinely consumed: threshold crossed, closeout handed over.
    expect(result.thresholdSeen).toBe(true);
    expect(result.closeout).not.toBeNull();
    expect(result.closeout!.cumulative_cost_usd).toBeGreaterThan(0.05);
    expect(result.closeout!.max_budget_usd).toBeGreaterThan(0);
    expect(result.closeout!.num_turns).toBeGreaterThanOrEqual(1);

    // The loop ran ON the ledger: tick 1 done, tick 2 failed at the cap.
    const byIntent = new Map(result.sessions.map((s) => [s.intent, s]));
    expect(byIntent.get('minimal-loop tick 1')?.state).toBe('done');
    expect(byIntent.get('minimal-loop tick 2')?.state).toBe('failed');
    expect(byIntent.get('minimal-loop tick 2')?.lastError).toBe('error_max_budget_usd');

    // Cost accounting accrued across ticks (cheap tick + busted tick).
    expect(result.spentUsd).toBeGreaterThan(0.05);
  }, 20_000);

  it('caller-supplied budget hooks fire alongside the loop own hooks (G3: merged, not overwritten)', async () => {
    let callerThreshold = 0;
    let callerExhausted = 0;
    // Wide interval for the same reason as the test above: tick 2 must run.
    const result = await runMinimalLoop({
      intervalMs: 500,
      pollIntervalMs: 25,
      totalBudgetUsd: 0.05,
      maxTicks: 2,
      prompt: 'patrol the shop',
      queryOptions: {
        model: 'claude-sonnet-4-5',
        provider: { apiKey: 'test-key', baseUrl },
        persistSession: false,
        hooks: {
          'budget:threshold': [
            {
              hooks: [
                async () => {
                  callerThreshold += 1;
                  return {};
                },
              ],
            },
          ],
          'budget:exhausted': [
            {
              hooks: [
                async () => {
                  callerExhausted += 1;
                  return {};
                },
              ],
            },
          ],
        },
      },
    });
    // Old code overwrote these two hook keys with the loop's own matchers,
    // silently discarding the caller's; merged arrays fire both.
    expect(callerThreshold).toBeGreaterThanOrEqual(1);
    expect(callerExhausted).toBeGreaterThanOrEqual(1);
    expect(result.thresholdSeen).toBe(true);
    expect(result.closeout).not.toBeNull();
  }, 20_000);
});

describe('G2: concurrent ticks share one budget reservation pool', () => {
  it('overlapping ticks cannot arm more than the loop cap in total', async () => {
    // Local emulator that HOLDS the first call open until a second call
    // arrives (or a release timer fires), forcing genuine query overlap.
    const pending: { res: http.ServerResponse; model: string }[] = [];
    let calls = 0;
    let release: ReturnType<typeof setTimeout> | null = null;
    const flush = (): void => {
      for (const p of pending.splice(0)) streamCheapText(p.res, p.model, 'overlap answer');
    };
    const holdServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { model } = JSON.parse(body) as { model: string };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        calls += 1;
        pending.push({ res, model });
        if (calls >= 2) flush();
        else release = setTimeout(flush, 2_000);
      });
    });
    const holdBase = await new Promise<string>((resolve) => {
      holdServer.listen(0, '127.0.0.1', () => {
        const addr = holdServer.address();
        resolve(`http://127.0.0.1:${typeof addr === 'object' && addr !== null ? addr.port : 0}`);
      });
    });
    try {
      // Each cheap emulator call costs ~$0.0006; the cap fits ONE, not two.
      const totalBudgetUsd = 0.001;
      const result = await runMinimalLoop({
        intervalMs: 40,
        pollIntervalMs: 25,
        totalBudgetUsd,
        maxTicks: 2,
        prompt: 'patrol the shop',
        queryOptions: {
          model: 'claude-sonnet-4-5',
          provider: { apiKey: 'test-key', baseUrl: holdBase },
          persistSession: false,
        },
      });
      // Old code armed BOTH overlapping queries with the full remaining cap
      // (total arms ~2x the cap, spend ~$0.0012); the reservation pool keeps
      // total spend within the cap because the second tick finds nothing
      // left to arm and winds the loop down instead of querying.
      expect(result.spentUsd).toBeLessThanOrEqual(totalBudgetUsd);
      expect(result.spentUsd).toBeGreaterThan(0);
      expect(result.windDownReason).toBe('budget:spent');
    } finally {
      if (release !== null) clearTimeout(release);
      flush();
      await new Promise<void>((r) => holdServer.close(() => r()));
    }
  }, 20_000);
});

describe('G4: summary truncation is surrogate-safe', () => {
  it('slices the summary on code points, never splitting a surrogate pair', async () => {
    // 'x' + 150 astral chars (U+1D11E, 2 UTF-16 units each) = 301 units but
    // only 151 code points: the old slice(0, 200) cut unit 199 mid-pair and
    // persisted a lone high surrogate into the ledger.
    const astral = '\u{1D11E}';
    const text = 'x' + astral.repeat(150);
    const g4server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { model } = JSON.parse(body) as { model: string };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        streamCheapText(res, model, text);
      });
    });
    const g4base = await new Promise<string>((resolve) => {
      g4server.listen(0, '127.0.0.1', () => {
        const addr = g4server.address();
        resolve(`http://127.0.0.1:${typeof addr === 'object' && addr !== null ? addr.port : 0}`);
      });
    });
    try {
      const summaries: (string | undefined)[] = [];
      const inner = memoryLedgerStore() as LedgerStore;
      const store: LedgerStore = {
        ...inner,
        appendQuery: async (r: QueryRecord) => {
          summaries.push(r.summary);
          await inner.appendQuery(r);
        },
      };
      const result = await runMinimalLoop({
        intervalMs: 50,
        pollIntervalMs: 25,
        totalBudgetUsd: 1,
        maxTicks: 1,
        prompt: 'patrol the shop',
        store,
        queryOptions: {
          model: 'claude-sonnet-4-5',
          provider: { apiKey: 'test-key', baseUrl: g4base },
          persistSession: false,
        },
      });
      expect(result.windDownReason).toBe('max-ticks');
      expect(summaries).toHaveLength(1);
      const summary = summaries[0]!;
      // 151 code points is under the 200-code-point cap: nothing truncated.
      expect(summary).toBe(text);
      // No lone surrogate anywhere (for-of yields a bare surrogate as a
      // single code unit in the D800-DFFF range only when the pair is split).
      const hasLoneSurrogate = [...summary].some((ch) => {
        const c = ch.codePointAt(0)!;
        return c >= 0xd800 && c <= 0xdfff;
      });
      expect(hasLoneSurrogate).toBe(false);
    } finally {
      await new Promise<void>((r) => g4server.close(() => r()));
    }
  }, 20_000);
});
