/**
 * R1 turn injection (SCS-REQ-REPOS-01 §3 R1).
 *
 * The injection API IS query({ prompt, options: { resume } }) — no second
 * session abstraction. What this file pins is the two seams the loop pattern
 * needs around it: the structured prelude on the injected turn (rendered as
 * <system-reminder> blocks ahead of the prompt, invisible to the
 * UserPromptSubmit hook's raw view), and the pre-injection accounting read
 * (getSessionAccounting: cumulative cost/turns from persisted per-result
 * accounting records + a context estimate over the persisted transcript).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSessionAccounting, query } from '../src/query.js';
import { ReportLedger } from '../src/loop-support/ledger.js';
import type { Options, SDKMessage, SDKSystemMessage } from '../src/types.js';
import { textReplyEvents } from './helpers/mock-transport.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';

let sessionDir: string;
beforeAll(async () => {
  sessionDir = await mkdtemp(join(tmpdir(), 'sdk-turn-injection-'));
});
afterAll(async () => {
  await rm(sessionDir, { recursive: true, force: true });
});

const PRICED = { model: 'claude-sonnet-4-5', usage: { input_tokens: 1000 } };

function opts(extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    ...extra,
  };
}

async function collect(q: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

function sessionIdOf(messages: SDKMessage[]): string {
  const init = messages[0] as SDKSystemMessage;
  expect(init.subtype).toBe('init');
  return init.session_id;
}

describe('R1 structured prelude', () => {
  it('rides the injected turn as <system-reminder> blocks; hooks see the raw prompt', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok', PRICED)]);
    const hookPrompts: string[] = [];
    const ledger = new ReportLedger();
    ledger.record('incident-7', { at: Date.UTC(2026, 6, 17), summary: 'disk full' });
    const q = query({
      prompt: 'scan the fleet',
      options: opts({
        provider: { apiKey: 'test-key', fetch: fetchStub, promptCaching: false },
        prelude: [ledger.toPrelude(), { content: 'untitled block' }],
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                async (input) => {
                  hookPrompts.push((input as { prompt: string }).prompt);
                  return {};
                },
              ],
            },
          ],
        },
      }),
    });
    const messages = await collect(q);
    expect(messages[messages.length - 1]?.type).toBe('result');

    // The wire request carries prelude blocks BEFORE the prompt text.
    const req = fetchStub.requests[0];
    expect(req).toBeDefined();
    const body = JSON.parse(String(req?.init?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const first = body.messages[0];
    expect(first?.role).toBe('user');
    const text =
      typeof first?.content === 'string'
        ? first.content
        : (first?.content as Array<{ type: string; text?: string }>)
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n');
    expect(text.indexOf('<system-reminder>')).toBe(0);
    expect(text).toContain('Previously reported events');
    expect(text).toContain('incident-7');
    expect(text).toContain('untitled block');
    // Prelude precedes the prompt; the prompt text is intact.
    expect(text.indexOf('incident-7')).toBeLessThan(text.indexOf('scan the fleet'));
    // Hook saw the RAW typed prompt, not the composed text.
    expect(hookPrompts).toEqual(['scan the fleet']);
  });
});

describe('R1 pre-injection accounting', () => {
  it('sums cost/turns across queries and estimates the persisted context', async () => {
    // Round 1: create the session.
    const q1 = query({
      prompt: 'round one',
      options: opts({
        provider: {
          apiKey: 'test-key',
          fetch: makeSSEFetch([textReplyEvents('first answer', PRICED)]),
          promptCaching: false,
        },
      }),
    });
    const m1 = await collect(q1);
    const sessionId = sessionIdOf(m1);

    const afterOne = await getSessionAccounting(sessionId, { sessionDir });
    expect(afterOne.resultCount).toBe(1);
    expect(afterOne.cumulativeTurns).toBe(1);
    // 1000 in * $3/MTok (+ output) — the engine.test.ts-pinned figure.
    expect(afterOne.cumulativeCostUsd).toBeCloseTo(0.003105, 9);
    expect(afterOne.messageCount).toBe(2);
    expect(afterOne.estimatedContextTokens).toBeGreaterThan(0);

    // Round 2: INJECT a new turn into the SAME session (resume).
    const q2 = query({
      prompt: 'round two',
      options: opts({
        provider: {
          apiKey: 'test-key',
          fetch: makeSSEFetch([textReplyEvents('second answer', PRICED)]),
          promptCaching: false,
        },
        resume: sessionId,
      }),
    });
    const m2 = await collect(q2);
    expect(sessionIdOf(m2)).toBe(sessionId);

    const afterTwo = await getSessionAccounting(sessionId, { sessionDir });
    expect(afterTwo.resultCount).toBe(2);
    expect(afterTwo.cumulativeTurns).toBe(2);
    // TRUE cross-query cumulative — the delta records make the sum right even
    // though each query's own total_cost_usd restarts from zero.
    expect(afterTwo.cumulativeCostUsd).toBeCloseTo(2 * 0.003105, 9);
    expect(afterTwo.messageCount).toBe(4);
    expect(afterTwo.estimatedContextTokens).toBeGreaterThan(
      afterOne.estimatedContextTokens,
    );
  });

  it('reports zeros for an unknown session (pure read, no mutation)', async () => {
    const snap = await getSessionAccounting('no-such-session', { sessionDir });
    expect(snap).toEqual({
      cumulativeCostUsd: 0,
      cumulativeTurns: 0,
      estimatedContextTokens: 0,
      messageCount: 0,
      resultCount: 0,
    });
  });
});
