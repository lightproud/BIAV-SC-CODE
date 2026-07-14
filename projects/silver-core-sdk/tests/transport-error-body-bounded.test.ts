/**
 * Audit 2026-07-14 H-1 regression: a non-2xx response whose BODY stalls must
 * not hang the retry loop. Before the fix, requestWithRetries released the
 * caller/timeout abort listeners BEFORE draining the error body, and the
 * default 'node' http client has no body timeout — a gateway that sent error
 * headers and then went silent hung the conversation forever, uninterruptibly.
 *
 * The fix (both twins, token-locked by transport-twin-drift.test.ts):
 *   1. keep the abort listeners attached while the error body is drained, so
 *      a caller abort still cancels the read;
 *   2. cap the drain at ERROR_BODY_TIMEOUT_MS and fall back to the status
 *      line when it expires.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProviderTransport } from '../src/transport/factory.js';
import { AbortError, APIStatusError } from '../src/errors.js';
import type { StreamRequest, Transport } from '../src/internal/contracts.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** A 500 whose body stream never produces a byte and never closes. */
function stalledErrorResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start() {
      /* never enqueues, never closes */
    },
  });
  return new Response(stream, {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });
}

function baseReq(signal?: AbortSignal): StreamRequest {
  return {
    model: 'claude-test-1',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hi' }],
    ...(signal !== undefined ? { signal } : {}),
  };
}

function makeAnthropic(): Transport {
  return createProviderTransport({
    provider: { apiKey: 'k', maxRetries: 0 },
    env: { BPT_HTTP_CLIENT: 'fetch' },
    debug: () => undefined,
  });
}

function makeOpenAI(): Transport {
  return createProviderTransport({
    provider: {
      protocol: 'openai-chat',
      apiKey: 'k',
      baseUrl: 'https://gateway.test/v1',
      maxRetries: 0,
    },
    env: { BPT_HTTP_CLIENT: 'fetch' },
    debug: () => undefined,
  });
}

async function drive(t: Transport, signal?: AbortSignal): Promise<void> {
  for await (const ev of t.stream(baseReq(signal))) void ev;
}

describe('error-body drain cap (ERROR_BODY_TIMEOUT_MS)', () => {
  it('anthropic: a stalled 500 body resolves to the status-line fallback at the cap', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stalledErrorResponse()),
    );
    const p = drive(makeAnthropic());
    const settled = expect(p).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(APIStatusError);
      expect((err as APIStatusError).status).toBe(500);
      return true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
  });

  it('openai: the twin has the same cap', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stalledErrorResponse()),
    );
    const p = drive(makeOpenAI());
    const settled = expect(p).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(APIStatusError);
      expect((err as APIStatusError).status).toBe(500);
      return true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
  });
});

describe('error-body drain stays abortable', () => {
  it('anthropic: a caller abort during the stalled drain surfaces AbortError promptly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stalledErrorResponse()),
    );
    const ac = new AbortController();
    const p = drive(makeAnthropic(), ac.signal);
    const settled = expect(p).rejects.toBeInstanceOf(AbortError);
    setTimeout(() => ac.abort(), 20);
    await settled;
  });

  it('openai: the twin stays abortable too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stalledErrorResponse()),
    );
    const ac = new AbortController();
    const p = drive(makeOpenAI(), ac.signal);
    const settled = expect(p).rejects.toBeInstanceOf(AbortError);
    setTimeout(() => ac.abort(), 20);
    await settled;
  });
});
