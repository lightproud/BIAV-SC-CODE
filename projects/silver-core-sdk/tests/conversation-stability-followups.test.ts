/**
 * Follow-up stability fixes (2026-07-13, keeper "3 条极轻项也一起修复").
 *   T2 shared retry budget: empty-stream re-issues + request-phase retries draw
 *      from ONE budget, so a gateway that alternates errors and empty-200s can
 *      no longer amplify to ~maxRetries² POSTs.
 * (T3 was assessed WAI and left unchanged — pings are yielded live by design;
 *  the killAgent status-race guard is covered by the subagent suite + the
 *  status-guard reasoning.)
 */
// @ts-nocheck

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import { APIStatusError } from '../src/errors.js';

afterEach(() => vi.unstubAllGlobals());

function emptySse(): Response {
  // HTTP 200 with a body that carries no message_start (empty non-start).
  return new Response('event: ping\ndata: {"type":"ping"}\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}
function retryable429(): Response {
  return new Response('rate limited', { status: 429 });
}
async function drain(gen: AsyncIterable<unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of gen) { /* consume */ }
}
const baseReq = { model: 'claude-test', max_tokens: 8, messages: [{ role: 'user', content: 'q' }] };

describe('T2 — shared retry budget bounds total POSTs', () => {
  it('alternating 429/empty-200 stays within maxRetries+1 total POSTs', async () => {
    const maxRetries = 1;
    let calls = 0;
    // Alternate: 429, empty, 429, empty, … A pre-fix run would let each
    // empty-stream re-issue spend a FRESH maxRetries on the 429s (≈4 POSTs for
    // maxRetries=1); the shared budget caps it at maxRetries+1 = 2.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls % 2 === 1 ? retryable429() : emptySse();
      }),
    );
    const t = new AnthropicTransport({
      provider: { apiKey: 'k', maxRetries },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: () => undefined,
    });
    let err: unknown;
    try {
      await drain(t.stream(baseReq));
    } catch (e) {
      err = e;
    }
    // Terminal outcome is a surfaced error (the budget ran out), and the total
    // POST count never exceeded the single shared budget.
    expect(err).toBeDefined();
    expect(calls).toBeLessThanOrEqual(maxRetries + 1);
  }, 15_000);

  it('a persistent empty stream still exhausts into exactly maxRetries+1 POSTs', async () => {
    const maxRetries = 2;
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return emptySse();
      }),
    );
    const t = new AnthropicTransport({
      provider: { apiKey: 'k', maxRetries },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: () => undefined,
    });
    await expect(drain(t.stream(baseReq))).rejects.toBeInstanceOf(Error);
    // Initial POST + maxRetries empty-stream re-issues, no more.
    expect(calls).toBe(maxRetries + 1);
  }, 15_000);
});
