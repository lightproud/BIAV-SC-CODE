/**
 * audit 2026-07-14 L-4 — utility calls memoize their default transport.
 *
 * Every runUtilityCall used to build a FRESH provider transport, so the
 * maxConcurrentRequests semaphore (per-transport) was void across calls and
 * BPT_PRECONNECT fired one probe per call. The default transport is now cached
 * per provider-config identity (betas as secondary key); injected transports
 * keep priority.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  resolveUtilityTransport,
  runUtilityCall,
  type UtilityCallOptions,
} from '../src/generators/runtime.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';
import type { ProviderConfig } from '../src/types.js';

const enc = new TextEncoder();

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function okSseResponse(text: string): Response {
  const body =
    frame('message_start', {
      type: 'message_start',
      message: {
        id: 'm1',
        type: 'message',
        role: 'assistant',
        model: 'claude-test-1',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    }) +
    frame('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }) +
    frame('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    }) +
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }) +
    frame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 2 },
    }) +
    frame('message_stop', { type: 'message_stop' });
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(body));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('utility transport memoization (audit 2026-07-14 L-4)', () => {
  it('the same provider-config reference resolves to the SAME transport instance', () => {
    const provider: ProviderConfig = { apiKey: 'k' };
    const opts: UtilityCallOptions = { provider, env: { BPT_HTTP_CLIENT: 'fetch' } };
    const t1 = resolveUtilityTransport(opts);
    const t2 = resolveUtilityTransport(opts);
    expect(t2).toBe(t1);
    // A second options object sharing the provider REFERENCE also hits the cache.
    const t3 = resolveUtilityTransport({ provider, env: { BPT_HTTP_CLIENT: 'fetch' } });
    expect(t3).toBe(t1);
  });

  it('a different provider reference or different betas builds a distinct transport', () => {
    const providerA: ProviderConfig = { apiKey: 'k' };
    const providerB: ProviderConfig = { apiKey: 'k' };
    const base = resolveUtilityTransport({ provider: providerA });
    expect(resolveUtilityTransport({ provider: providerB })).not.toBe(base);
    // betas change the wire headers -> separate cache slot under the same provider.
    expect(resolveUtilityTransport({ provider: providerA, betas: ['x'] })).not.toBe(base);
    expect(resolveUtilityTransport({ provider: providerA, betas: ['x'] })).toBe(
      resolveUtilityTransport({ provider: providerA, betas: ['x'] }),
    );
  });

  it('an injected transport keeps priority and is never cached', () => {
    const provider: ProviderConfig = { apiKey: 'k' };
    const injected = new MockTransport([textReplyEvents('hi')]);
    expect(resolveUtilityTransport({ provider, transport: injected })).toBe(injected);
    // The injection did not poison the provider's cache slot.
    expect(resolveUtilityTransport({ provider })).not.toBe(injected);
  });

  it('two runUtilityCall calls reuse ONE transport: BPT_PRECONNECT probes once, not per call', async () => {
    let probes = 0;
    let posts = 0;
    const countingFetch = async (
      _input: string | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (init?.method === 'HEAD') {
        probes += 1;
        return new Response(null, { status: 405 });
      }
      posts += 1;
      return okSseResponse(`reply ${posts}`);
    };
    // preconnect: true fires the warm-up probe in the transport CONSTRUCTOR —
    // before the fix each utility call constructed its own transport, so two
    // calls meant two probes.
    const provider: ProviderConfig = { apiKey: 'k', preconnect: true, fetch: countingFetch };
    const opts: UtilityCallOptions = { provider, env: { BPT_HTTP_CLIENT: 'fetch' } };

    const first = await runUtilityCall('system', 'user one', opts, 64);
    const second = await runUtilityCall('system', 'user two', opts, 64);

    expect(first).toBe('reply 1');
    expect(second).toBe('reply 2');
    expect(posts).toBe(2); // both calls really hit the wire
    expect(probes).toBe(1); // KEY: one transport construction across both calls
  });
});
