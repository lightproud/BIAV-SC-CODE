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
 * down on the closeout report. FAKE timers throughout (clock discipline audit
 * 2026-07-18): the test drives time, engine/HTTP I/O flows between advances.
 */
import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runMinimalLoop } from '../examples/minimal-loop.js';

/** Drive fake time until the run settles (clock discipline audit 2026-07-18:
 *  no real clock — the test advances time; the real HTTP/engine I/O flows
 *  between advances). Bounded — a hang fails the test. */
async function drive<T>(run: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = run.then(
    (v) => {
      settled = true;
      return v;
    },
    (e) => {
      settled = true;
      throw e;
    },
  );
  for (let i = 0; i < 4000 && !settled; i += 1) {
    await vi.advanceTimersByTimeAsync(25);
  }
  expect(settled, 'run did not settle within the driven fake-time budget').toBe(true);
  return tracked;
}

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
  vi.useFakeTimers();
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
  vi.useRealTimers();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('example 1: minimal loop over the real agent stack', () => {
  it('polls periodically, hits the cap, consumes R2 events and winds down on the closeout', async () => {
    const result = await drive(runMinimalLoop({
      intervalMs: 50,
      pollIntervalMs: 25,
      totalBudgetUsd: 0.05,
      maxTicks: 2,
      prompt: 'patrol the shop',
      queryOptions: {
        model: 'claude-sonnet-4-5',
        provider: { apiKey: 'test-key', baseUrl },
        persistSession: false,
      },
    }));

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
});
