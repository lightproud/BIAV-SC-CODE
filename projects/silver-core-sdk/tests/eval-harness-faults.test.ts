/**
 * Phase 2 eval harness fault machinery (scripts/eval-harnesses.mjs), proven
 * keyless against the local Messages-API emulator pattern:
 *  - makeFaultFetch 'fail' actions surface as request-phase network retries
 *    (transportHealth.networkRetries) and the run still succeeds;
 *  - a permanent fault exhausts bounded retries into an honest error result;
 *  - a cutAfterEvents action drops the stream mid-body (midStreamDrops) and
 *    the bounded turn replay recovers the run;
 *  - the runner registry covers exactly the 8 `driver: "manual"` questions
 *    and never touches the protected evals/ directory.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { query } from '../src/query.js';
import type { SDKMessage, SDKResultMessage } from '../src/types.js';
// eslint-disable-next-line import/no-relative-packages -- eval-side tooling under test
import { HARNESS_IDS, getHarnessRunner, makeFaultFetch } from '../scripts/eval-harnesses.mjs';

function sse(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Stream a plain text reply as several SSE events (so a cut can land mid-body). */
function streamText(res: http.ServerResponse, model: string, text: string): void {
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0 },
    },
  });
  sse(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });
  for (const piece of text.match(/.{1,8}/g) ?? []) {
    sse(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: piece },
    });
  }
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 20 },
  });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

let server: http.Server;
let baseUrl: string;
let sandbox: string;

function startServer(): Promise<void> {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { model } = JSON.parse(body) as { model: string };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      streamText(res, model, 'All twenty words of the expected reply arrive here, then DONE.');
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr !== null ? addr.port : 0}`;
      resolve();
    }),
  );
}

async function run(fetchWrap: typeof fetch, extraProvider: Record<string, unknown> = {}) {
  const messages: SDKMessage[] = [];
  let result: SDKResultMessage | null = null;
  const q = query({
    prompt: 'Say the reply.',
    options: {
      provider: { apiKey: 'test-key', baseUrl, fetch: fetchWrap, ...extraProvider },
      cwd: sandbox,
      sessionDir: path.join(sandbox, '.sessions'),
      sandbox: false,
    },
  });
  for await (const msg of q) {
    messages.push(msg);
    if (msg.type === 'result') result = msg;
  }
  return { messages, result };
}

beforeEach(async () => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-fault-'));
  await startServer();
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('makeFaultFetch against the emulator (keyless)', () => {
  it('request-phase failures are absorbed as networkRetries and the run succeeds', async () => {
    const fetchWrap = makeFaultFetch((i: number) => (i <= 2 ? 'fail' : 'pass'));
    const { result } = await run(fetchWrap);
    expect(result?.is_error).toBe(false);
    expect(result?.metrics?.transportHealth?.networkRetries).toBe(2);
    expect(fetchWrap.ledger).toHaveLength(2);
  });

  it('a permanent fault exhausts bounded retries into an honest error result', async () => {
    const fetchWrap = makeFaultFetch(() => 'fail');
    const { result } = await run(fetchWrap, { maxRetries: 1 });
    expect(result?.is_error).toBe(true);
    expect(result?.subtype).toMatch(/error/);
    expect(result?.metrics?.transportHealth?.networkRetries).toBeGreaterThanOrEqual(1);
  });

  it('a mid-stream cut is recovered by the bounded turn replay', async () => {
    const fetchWrap = makeFaultFetch((i: number) => (i === 1 ? { cutAfterEvents: 2 } : 'pass'));
    const { messages, result } = await run(fetchWrap);
    expect(result?.is_error).toBe(false);
    const health = result?.metrics?.transportHealth;
    expect((health?.midStreamDrops ?? 0) + (health?.emptyStreamRetries ?? 0)).toBeGreaterThanOrEqual(1);
    // Exactly one final assistant text — no duplicated output from the replay.
    const finalTexts = messages.filter(
      (m) =>
        m.type === 'assistant' &&
        (m as { message: { content: Array<{ type: string; text?: string }> } }).message.content.some(
          (b) => b.type === 'text' && (b.text ?? '').includes('DONE'),
        ),
    );
    expect(finalTexts.length).toBe(1);
  });
});

describe('cutAfterTextDeltas (self-improve #3: deterministic mid-text cut)', () => {
  it('cuts mid-text even when the whole reply arrives as one batched chunk', async () => {
    // The emulator writes the full SSE body at once — exactly the batching
    // shape that let raw-event-count cuts silently never fire (dc-03 drift).
    const fetchWrap = makeFaultFetch((i: number) =>
      i === 1 ? { cutAfterTextDeltas: 2 } : 'pass',
    );
    const { messages, result } = await run(fetchWrap);
    expect(fetchWrap.ledger).toEqual([{ call: 1, action: 'cut-after-2-text-deltas' }]);
    expect(result?.is_error).toBe(false);
    const health = result?.metrics?.transportHealth;
    expect(
      (health?.midStreamDrops ?? 0) +
        (health?.turnsSalvaged ?? 0) +
        (health?.turnReplays ?? 0) +
        (health?.emptyStreamRetries ?? 0),
    ).toBeGreaterThanOrEqual(1);
    // Recovery may salvage the flowed prefix as the answer (E3) or replay to
    // a full reply — either way exactly ONE assistant text message survives,
    // with no duplicated prefix.
    const texts = messages
      .filter((m) => m.type === 'assistant')
      .flatMap((m) =>
        (m as { message: { content: Array<{ type: string; text?: string }> } }).message.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? ''),
      )
      .filter((t) => t.length > 0);
    expect(texts.length).toBe(1);
    const occurrences = texts[0]!.split('All twenty').length - 1;
    expect(occurrences).toBe(1);
  });

  it('a reply with fewer text_deltas than the threshold passes through un-cut', async () => {
    // Guard the other direction: threshold beyond the reply must not corrupt
    // or truncate a healthy stream.
    const fetchWrap = makeFaultFetch((i: number) =>
      i === 1 ? { cutAfterTextDeltas: 99 } : 'pass',
    );
    const { result } = await run(fetchWrap);
    expect(result?.is_error).toBe(false);
    expect(result?.metrics?.transportHealth?.midStreamDrops ?? 0).toBe(0);
  });
});

describe('harness registry governance boundary', () => {
  it('registers a runner for every manual question and only those', () => {
    const doc = JSON.parse(
      readFileSync(path.join(__dirname, '..', 'evals', 'behavior', 'questions.json'), 'utf8'),
    ) as { questions: Array<{ id: string; harness: { driver: string } }> };
    const manualIds = doc.questions.filter((q) => q.harness.driver === 'manual').map((q) => q.id);
    expect([...HARNESS_IDS].sort()).toEqual([...manualIds].sort());
    for (const id of manualIds) expect(getHarnessRunner(id)).toBeTypeOf('function');
    expect(getHarnessRunner('mem-01')).toBeNull();
    expect(getHarnessRunner('nonexistent')).toBeNull();
  });
});
