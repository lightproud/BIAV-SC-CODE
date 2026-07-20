/**
 * Audit r4 (2026-07-17) — anthropic.ts transport cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - U2-1: the empty-stream retry gate ALSO requires !sawContentBlock, so an
 *    out-of-order stream that already yielded content before/without
 *    message_start is NOT replayed (it falls through to midStreamTruncation).
 *    Guard: a ping-only non-start still retries.
 *  - R7j-3: a caller-built circular content block surfaces a typed
 *    ConfigurationError, not a raw serializer TypeError.
 *  - R7s-7: the error-body message truncation never splits a surrogate pair.
 *  - Rdt-1: the idle watchdog uses a monotonic clock, so a frozen/rolled-back
 *    wall clock still lets a stalled stream abort.
 *
 * (U2-2, U2-3, U2-4, U2-5, R7env-1, R7env-2 were skipped — see the returned
 * summary for per-item reasoning; no tests are added for skipped items.)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnthropicTransport } from '../src/transport/anthropic.js';
import {
  APIConnectionError,
  APIStatusError,
  ConfigurationError,
} from '../src/errors.js';
import type { ProviderConfig, RawMessageStreamEvent } from '../src/types.js';
import type { StreamRequest } from '../src/internal/contracts.js';

const enc = new TextEncoder();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers (transport-retry-after-jitter.test.ts conventions)
// ---------------------------------------------------------------------------

function baseReq(extra: Partial<StreamRequest> = {}): StreamRequest {
  return {
    model: 'claude-test-1',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'hi' }],
    ...extra,
  };
}

function makeAnthropic(
  debug: (m: string) => void,
  provider: Partial<ProviderConfig> = {},
): AnthropicTransport {
  return new AnthropicTransport({
    provider: { apiKey: 'k', ...provider },
    env: { BPT_HTTP_CLIENT: 'fetch' },
    debug,
  });
}

/** A closed HTTP 200 SSE body carrying the given raw stream-event payloads. */
function sseResponse(events: readonly object[]): Response {
  const body = events
    .map((e) => `event: ${(e as { type?: string }).type ?? 'message'}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        if (body) c.enqueue(enc.encode(body));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

/** An HTTP 200 SSE body that never closes (used to exercise the idle watchdog). */
function hangingResponse(initial: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        if (initial) c.enqueue(enc.encode(initial));
        // never closes
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

/** A minimal complete Messages API event sequence (message_start..message_stop). */
function okEvents(): object[] {
  return [
    {
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
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
}

async function collect(
  gen: AsyncGenerator<RawMessageStreamEvent, void>,
): Promise<RawMessageStreamEvent[]> {
  const out: RawMessageStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

async function collectWithError(
  gen: AsyncGenerator<RawMessageStreamEvent, void>,
): Promise<{ events: RawMessageStreamEvent[]; error: unknown }> {
  const events: RawMessageStreamEvent[] = [];
  let error: unknown;
  try {
    for await (const ev of gen) events.push(ev);
  } catch (e) {
    error = e;
  }
  return { events, error };
}

async function captureError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e;
  }
}

// ---------------------------------------------------------------------------
// U2-1 — empty-stream retry must not replay a partially consumed turn
// ---------------------------------------------------------------------------

describe('U2-1: empty-stream retry gate keys on content, not just message_start', () => {
  it('does NOT replay an out-of-order stream that yielded content before message_start', async () => {
    // content_block_start + content_block_delta, then close — WITHOUT a
    // message_start. The old gate (`!sawMessageStart`) would re-issue the whole
    // POST, replaying content already delivered to the consumer. The fix
    // (`!sawMessageStart && !sawContentBlock`) recognizes the content was
    // consumed and routes to the midStreamTruncation salvage instead.
    const cbStart = { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
    const cbDelta = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } };
    const fetchMock = vi.fn(async () => sseResponse([cbStart, cbDelta]));
    vi.stubGlobal('fetch', fetchMock);

    const { events, error } = await collectWithError(
      makeAnthropic(() => {}, { maxRetries: 5 }).stream(baseReq()),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1); // NOT retried
    expect(events).toHaveLength(2); // the content WAS delivered (consumed)
    expect(error).toBeInstanceOf(APIConnectionError);
    expect((error as APIConnectionError).midStreamTruncation).toBe(true);
  });

  it('guard: a ping-only non-start (no content_block) is still an empty non-start and retries', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        return call === 1 ? sseResponse([{ type: 'ping' }]) : sseResponse(okEvents());
      }),
    );
    const events = await collect(makeAnthropic(() => {}).stream(baseReq()));
    // Healed on the 2nd fetch; the discarded attempt's ping is surfaced first.
    expect(call).toBe(2);
    expect(events).toEqual([{ type: 'ping' }, ...okEvents()]);
  });
});

// ---------------------------------------------------------------------------
// R7j-3 — the wire stringify must not throw a raw circular TypeError
// ---------------------------------------------------------------------------

describe('R7j-3: unserializable request body', () => {
  it('surfaces a typed ConfigurationError for a circular content block, before any fetch', async () => {
    const circular: Record<string, unknown> = { type: 'text', text: 'hi' };
    circular.self = circular; // self-reference -> JSON.stringify throws
    const fetchMock = vi.fn(async () => sseResponse(okEvents()));
    vi.stubGlobal('fetch', fetchMock);

    const err = await captureError(
      collect(
        makeAnthropic(() => {}).stream(
          baseReq({ messages: [{ role: 'user', content: [circular as never] }] }),
        ),
      ),
    );

    expect(err).toBeInstanceOf(ConfigurationError);
    expect((err as Error).message).toMatch(/not serializable/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R7s-7 — error-body truncation must be surrogate-safe
// ---------------------------------------------------------------------------

describe('R7s-7: surrogate-safe error-body truncation', () => {
  it('never leaves a lone surrogate at the 2000-char cut', async () => {
    // U+1F600 (😀) straddles indices 1999/2000: a bare slice(0,2000)
    // keeps the lone high surrogate; the surrogate-safe slice drops it.
    const body = 'a'.repeat(1999) + '\u{1F600}';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 400, headers: { 'content-type': 'text/plain' } })),
    );
    const err = await captureError(collect(makeAnthropic(() => {}).stream(baseReq())));
    expect(err).toBeInstanceOf(APIStatusError);
    const msg = (err as APIStatusError).message;
    expect(msg).toBe('a'.repeat(1999)); // the trailing high surrogate is dropped
    // No unpaired surrogate anywhere in the surfaced message.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(msg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rdt-1 — the idle watchdog must use a monotonic clock
// ---------------------------------------------------------------------------

describe('Rdt-1: idle watchdog is monotonic-clock based', () => {
  it('still aborts a stalled stream when the wall clock (Date.now) is frozen', async () => {
    // Freeze Date.now: the old Date.now()-based watchdog computes elapsed as 0
    // forever and re-arms without ever aborting. A monotonic clock advances
    // regardless, so the stall still fires stream_idle_timeout.
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    vi.stubGlobal('fetch', vi.fn(async () => hangingResponse('')));
    const t = makeAnthropic(() => {}, { streamIdleTimeoutMs: 50, timeoutMs: 5_000 });
    const { error } = await collectWithError(t.stream(baseReq()));
    expect(error).toBeInstanceOf(APIConnectionError);
    expect((error as APIConnectionError).code).toBe('stream_idle_timeout');
  });
});
