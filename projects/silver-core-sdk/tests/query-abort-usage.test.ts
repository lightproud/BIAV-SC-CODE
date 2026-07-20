/**
 * audit 2026-07-14 L-6 — a turn-level interrupt() must not lose the aborted
 * turn's already-billed usage.
 *
 * A message_start reports the request's input tokens the moment the stream
 * opens: that spend is real even when the user interrupts the turn a moment
 * later. Before the fix the engine loop threw a bare AbortError (no result
 * message is emitted on abort), so those tokens never reached the query's
 * SessionAccounting and the session budget/summary under-counted. The loop now
 * folds the partial sink on abort and attaches the run's partial accounting to
 * the AbortError; the query layer folds it in its abort path — observable on
 * the interrupt terminal result's session-cumulative fields.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { query } from '../src/index.js';
import { SessionAccounting } from '../src/query-accounting.js';
import { HANG_STREAM, makeSSEFetch } from './helpers/sse-fetch.js';
import type { Options, SDKMessage, SDKResultMessage } from '../src/types.js';

let sessionDir: string;
let cwd: string;

beforeEach(async () => {
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-abort-usage-sess-'));
  cwd = await mkdtemp(join(tmpdir(), 'bpt-abort-usage-cwd-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(sessionDir, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

const MODEL = 'claude-sonnet-4-5';

function options(extra: Partial<Options> = {}): Options {
  return {
    provider: {
      apiKey: 'test-key',
      promptCaching: false,
      maxRetries: 0,
      // Deterministic figures: 100 USD/MTok -> 25 input tokens = $0.0025.
      pricing: { [MODEL]: { input: 100, output: 100 } },
    },
    sessionDir,
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BPT_HTTP_CLIENT: 'fetch' },
    model: MODEL,
    includePartialMessages: true,
    ...extra,
  };
}

/** message_start already carrying the billed input tokens, then a hang: the
 *  turn never completes — it is interrupted while streaming. */
const MESSAGE_START = {
  type: 'message_start',
  message: {
    id: 'msg_abort_usage',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 25, output_tokens: 0 },
  },
};

describe('interrupted turn usage accounting (audit 2026-07-14 L-6)', () => {
  it('a turn-level interrupt() folds the aborted turn message_start tokens into session accounting', async () => {
    const fetchStub = makeSSEFetch([[MESSAGE_START, HANG_STREAM]]);
    vi.stubGlobal('fetch', fetchStub);

    const q = query({ prompt: 'do a thing', options: options() });
    const messages: SDKMessage[] = [];
    for await (const m of q) {
      messages.push(m);
      if (
        m.type === 'stream_event' &&
        (m as { event?: { type?: string } }).event?.type === 'message_start'
      ) {
        // The input tokens are billed at this point; cancel the turn NOW.
        void q.interrupt();
      }
      if (m.type === 'result') break; // string mode: interrupt yields a terminal result
    }

    const last = messages[messages.length - 1] as SDKResultMessage;
    expect(last.type).toBe('result');
    expect(last.subtype).toBe('error_during_execution');
    expect(last.errorMessage).toBe('The turn was interrupted');

    // KEY (L-6): the terminal result's session-cumulative fields carry the
    // aborted turn's already-billed spend instead of reporting zero.
    expect(last.total_cost_usd).toBeCloseTo(0.0025, 9);
    const mu = last.modelUsage[MODEL];
    expect(mu).toBeDefined();
    expect(mu!.inputTokens).toBe(25);
    expect(mu!.costUSD).toBeCloseTo(0.0025, 9);
  });

  it('SessionAccounting.accumulateAborted adds counters and merges modelUsage', () => {
    const acct = new SessionAccounting();
    acct.accumulateAborted({
      usage: {
        input_tokens: 25,
        output_tokens: 3,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      totalCostUsd: 0.0028,
      durationApiMs: 120,
      numTurns: 1,
      modelUsage: {
        [MODEL]: {
          inputTokens: 25,
          outputTokens: 3,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0.0028,
          contextWindow: 200_000,
        },
      },
    });
    expect(acct.turns).toBe(1);
    expect(acct.cost).toBeCloseTo(0.0028, 9);
    expect(acct.apiMs).toBe(120);
    expect(acct.usage.input_tokens).toBe(25);
    expect(acct.usage.output_tokens).toBe(3);
    expect(acct.modelUsage[MODEL]!.inputTokens).toBe(25);
    // A second fold ADDS (additive counters, not latest-wins).
    acct.accumulateAborted({
      usage: {
        input_tokens: 10,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      totalCostUsd: 0.001,
      durationApiMs: 30,
      numTurns: 0,
      modelUsage: {},
    });
    expect(acct.cost).toBeCloseTo(0.0038, 9);
    expect(acct.usage.input_tokens).toBe(35);
  });
});
