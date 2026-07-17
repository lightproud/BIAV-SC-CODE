/**
 * Audit 2026-07-17 (T49) batch A — query-level regressions for the 0.63.0
 * new-code defects:
 *
 *  - M18: `budget:threshold` must judge the SESSION cumulative cost against
 *    the ORIGINAL maxBudgetUsd (the per-turn re-arm hands the engine only the
 *    remaining budget, which drifted the threshold), and stay one-shot across
 *    the whole session, not per turn.
 *  - L57: the session-end memory round must run on the REAL remaining budget
 *    (and be skipped outright when the cap is spent) instead of reusing the
 *    last turn's stale re-arm.
 *  - L58: an interrupted turn's already-billed partial spend must reach the
 *    persisted accounting records so getSessionAccounting stays whole.
 *  - L59: observability events queued during an interrupted turn's teardown
 *    and during end-of-run settleAll must still reach the consumer.
 *  - L60: a malformed `options.prelude` block (missing content) must fail at
 *    construction instead of injecting the literal text "undefined".
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getSessionAccounting, query } from '../src/query.js';
import { ConfigurationError } from '../src/errors.js';
import type {
  BudgetThresholdHookInput,
  HookInput,
  Options,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from '../src/types.js';
import { pricedReplyEvents, textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';
import { HANG_STREAM, makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';

let sessionDir: string;
let cwd: string;

beforeEach(async () => {
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-t49a-sess-'));
  cwd = await mkdtemp(join(tmpdir(), 'bpt-t49a-cwd-'));
});

afterEach(async () => {
  await rm(sessionDir, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

const MODEL = 'claude-sonnet-4-5';

function opts(stub: SSEFetchStub, extra: Partial<Options> = {}): Options {
  return {
    provider: {
      apiKey: 'test-key',
      promptCaching: false,
      maxRetries: 0,
      fetch: stub,
      // Deterministic figures: 100 USD/MTok. pricedReplyEvents' 30-input /
      // 7-output turn costs exactly $0.0037.
      pricing: { [MODEL]: { input: 100, output: 100 } },
    },
    sessionDir,
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: MODEL,
    settingSources: [],
    ...extra,
  };
}

const userMsg = (content: string): SDKUserMessage => ({
  type: 'user',
  session_id: '',
  message: { role: 'user', content },
  parent_tool_use_id: null,
});

async function collect(q: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

// ---------------------------------------------------------------------------
// M18 — threshold anchored to the session cap across a multi-turn session
// ---------------------------------------------------------------------------

describe('M18: budget:threshold across a multi-turn streaming session', () => {
  it('fires once, at the SESSION cumulative crossing, with session figures', async () => {
    // Three turns of $0.0037 each; cap $0.02, ratio 0.5 -> threshold $0.01.
    // Session cumulative crosses on turn 3 ($0.0111). The pre-fix per-run
    // judgment (turn cost vs re-armed remainder * ratio) NEVER fired here:
    // t1 0.0037<0.01, t2 0.0037<0.00815, t3 0.0037<0.0063.
    const events: HookInput[] = [];
    const stub = makeSSEFetch([
      pricedReplyEvents('one', { inputTokens: 30, model: MODEL }),
      pricedReplyEvents('two', { inputTokens: 30, model: MODEL }),
      pricedReplyEvents('three', { inputTokens: 30, model: MODEL }),
    ]);
    async function* inputs(): AsyncGenerator<SDKUserMessage> {
      yield userMsg('t1');
      yield userMsg('t2');
      yield userMsg('t3');
    }
    await collect(
      query({
        prompt: inputs(),
        options: opts(stub, {
          maxBudgetUsd: 0.02,
          budgetThresholdRatio: 0.5,
          hooks: {
            'budget:threshold': [
              {
                hooks: [
                  async (input) => {
                    events.push(input);
                    return {};
                  },
                ],
              },
            ],
          },
        }),
      }),
    );
    expect(events).toHaveLength(1);
    const input = events[0] as BudgetThresholdHookInput;
    // Session figures, not this-run figures.
    expect(input.max_budget_usd).toBeCloseTo(0.02, 12);
    expect(input.cumulative_cost_usd).toBeCloseTo(0.0111, 6);
    expect(input.threshold_ratio).toBe(0.5);
  });

  it('stays one-shot per SESSION even when every turn crosses the threshold', async () => {
    const events: HookInput[] = [];
    const stub = makeSSEFetch([
      pricedReplyEvents('one', { inputTokens: 30, model: MODEL }),
      pricedReplyEvents('two', { inputTokens: 30, model: MODEL }),
    ]);
    async function* inputs(): AsyncGenerator<SDKUserMessage> {
      yield userMsg('t1');
      yield userMsg('t2');
    }
    await collect(
      query({
        prompt: inputs(),
        options: opts(stub, {
          maxBudgetUsd: 1.0,
          budgetThresholdRatio: 0.001,
          hooks: {
            'budget:threshold': [
              {
                hooks: [
                  async (input) => {
                    events.push(input);
                    return {};
                  },
                ],
              },
            ],
          },
        }),
      }),
    );
    expect(events).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// L57 — the session-end memory round respects the real remaining budget
// ---------------------------------------------------------------------------

describe('L57: session-end memory round vs the session budget cap', () => {
  it('skips the round when the cap is already spent (never overspends)', async () => {
    // Task turn costs $0.0107 (>cap $0.005): the single-turn reply itself
    // completes (the engine only stops before ANOTHER call), but the
    // session-end round must not run — pre-fix it ran on the stale re-arm.
    const stub = makeSSEFetch([
      pricedReplyEvents('the answer', { inputTokens: 100, model: MODEL }),
      textReplyEvents('never requested'),
    ]);
    const messages = await collect(
      query({
        prompt: 'do the task',
        options: opts(stub, { memory: {}, maxBudgetUsd: 0.005 }),
      }),
    );
    expect(stub.requests).toHaveLength(1); // no session-end request
    const results = messages.filter((m): m is SDKResultMessage => m.type === 'result');
    expect(results[0]!.subtype).toBe('success');
  });

  it('still runs the round when budget remains', async () => {
    const stub = makeSSEFetch([
      pricedReplyEvents('the answer', { inputTokens: 100, model: MODEL }),
      pricedReplyEvents('progress saved', { inputTokens: 30, model: MODEL }),
    ]);
    await collect(
      query({
        prompt: 'do the task',
        options: opts(stub, { memory: {}, maxBudgetUsd: 1.0 }),
      }),
    );
    expect(stub.requests).toHaveLength(2); // task + session-end round
  });
});

// ---------------------------------------------------------------------------
// L58 — an interrupted turn's spend reaches the persisted accounting
// ---------------------------------------------------------------------------

describe('L58: interrupted-turn spend lands in the accounting records', () => {
  it('getSessionAccounting reports the aborted turn cost after interrupt()', async () => {
    // message_start bills 25 input tokens ($0.0025 at 100 USD/MTok), then the
    // stream hangs; the turn is interrupted mid-stream. Pre-fix the fold went
    // only into the in-memory accumulators — no accounting record — so
    // getSessionAccounting read back 0 for the session.
    const messageStart = {
      type: 'message_start',
      message: {
        id: 'msg_t49a_l58',
        type: 'message',
        role: 'assistant',
        model: MODEL,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 25, output_tokens: 0 },
      },
    };
    const stub = makeSSEFetch([[messageStart, HANG_STREAM]]);
    const q = query({
      prompt: 'do a thing',
      options: opts(stub, { includePartialMessages: true }),
    });
    const messages: SDKMessage[] = [];
    for await (const m of q) {
      messages.push(m);
      if (
        m.type === 'stream_event' &&
        (m as { event?: { type?: string } }).event?.type === 'message_start'
      ) {
        void q.interrupt();
      }
      if (m.type === 'result') break;
    }
    const init = messages[0] as SDKSystemMessage;
    expect(init.subtype).toBe('init');

    const acct = await getSessionAccounting(init.session_id, { sessionDir });
    expect(acct.resultCount).toBe(1); // the interrupt delta record
    expect(acct.cumulativeCostUsd).toBeCloseTo(0.0025, 9);
  });
});

// ---------------------------------------------------------------------------
// L59 — teardown observability events reach the consumer
// ---------------------------------------------------------------------------

describe('L59: teardown-queued observability events are drained', () => {
  it('SessionEnd hook lifecycle events surface on a normal completion', async () => {
    // fireSessionEnd runs inside the generator finally, AFTER the last
    // in-turn drain: its hook_started/hook_response events queued forever
    // pre-fix. They must now ride the end-of-teardown drain.
    const stub = makeSSEFetch([textReplyEvents('done')]);
    const messages = await collect(
      query({
        prompt: 'go',
        options: opts(stub, {
          includeHookEvents: true,
          hooks: { SessionEnd: [{ hooks: [async () => ({})] }] },
        }),
      }),
    );
    const hookEvents = messages.filter(
      (m) =>
        m.type === 'system' &&
        ((m as { subtype?: string }).subtype === 'hook_started' ||
          (m as { subtype?: string }).subtype === 'hook_response') &&
        (m as { hook_event?: string }).hook_event === 'SessionEnd',
    );
    expect(hookEvents.length).toBeGreaterThanOrEqual(2); // started + response
  });

  it('an interrupted turn delivers its queued hook events BEFORE the terminal result', async () => {
    // The PreToolUse hook interrupts the turn: its lifecycle events were
    // queued after the assistant-boundary drain, and pre-fix the abort path
    // never drained them. The in-catch drain must surface them before the
    // interrupt terminal result (string mode).
    const stub = makeSSEFetch([
      toolUseReplyEvents('Read', { file_path: join(cwd, 'nope.txt') }),
      [HANG_STREAM],
    ]);
    const q = query({
      prompt: 'go',
      options: opts(stub, {
        includeHookEvents: true,
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async () => {
                  void q.interrupt();
                  return {};
                },
              ],
            },
          ],
        },
      }),
    });
    const messages = await collect(q);
    const last = messages[messages.length - 1] as SDKResultMessage;
    expect(last.type).toBe('result');
    expect(last.subtype).toBe('error_during_execution');
    expect(last.errorMessage).toBe('The turn was interrupted');

    const kinds = messages.map((m) =>
      m.type === 'system' ? `${m.type}:${(m as { subtype?: string }).subtype}` : m.type,
    );
    const startedIdx = kinds.indexOf('system:hook_started');
    const resultIdx = kinds.indexOf('result');
    expect(startedIdx).toBeGreaterThanOrEqual(0);
    expect(startedIdx).toBeLessThan(resultIdx);
  });
});

// ---------------------------------------------------------------------------
// L60 — malformed prelude blocks fail at construction
// ---------------------------------------------------------------------------

describe('L60: options.prelude runtime validation', () => {
  it('rejects a block with missing/non-string content or non-string title', () => {
    const stub = makeSSEFetch([]);
    for (const bad of [
      [{ title: 'only a title' }],
      [{ content: 42 }],
      [{ title: 7, content: 'ok' }],
      [null],
    ]) {
      expect(() =>
        query({
          prompt: 'hi',
          options: opts(stub, { prelude: bad as Options['prelude'] }),
        }),
      ).toThrow(ConfigurationError);
    }
  });

  it('accepts well-formed blocks (title optional)', () => {
    const stub = makeSSEFetch([textReplyEvents('ok')]);
    expect(() =>
      query({
        prompt: 'hi',
        options: opts(stub, {
          prelude: [{ content: 'no title' }, { title: 't', content: 'c' }],
        }),
      }),
    ).not.toThrow();
  });
});
