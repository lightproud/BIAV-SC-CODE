/**
 * audit 2026-07-14 L-3 — the idle watchdog must measure SERVER progress, not
 * consumer progress.
 *
 * Before the fix the idle clock was only reset when the generator loop
 * PROCESSED a frame, so a consumer paused at a yield for longer than
 * streamIdleTimeoutMs got a perfectly healthy stream killed as
 * stream_idle_timeout. The fix marks the consumer-hold window around the
 * yield: while the consumer holds an event the watchdog re-arms instead of
 * aborting, and the idle clock restarts when the consumer resumes. A genuine
 * server stall still aborts — detection during a long consumer pause is
 * deferred until the consumer resumes.
 *
 * Twin discipline: both transports are covered.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnthropicTransport } from '../src/transport/anthropic.js';
import { OpenAIChatTransport } from '../src/transport/openai.js';
import { APIConnectionError } from '../src/errors.js';
import type { StreamRequest } from '../src/internal/contracts.js';
import type { RawMessageStreamEvent } from '../src/types.js';

const enc = new TextEncoder();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function baseReq(): StreamRequest {
  return { model: 'claude-test-1', max_tokens: 32, messages: [{ role: 'user', content: 'hi' }] };
}

function anthropicFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const A_START = anthropicFrame('message_start', {
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
});
const A_DELTA = anthropicFrame('message_delta', {
  type: 'message_delta',
  delta: { stop_reason: 'end_turn', stop_sequence: null },
  usage: { output_tokens: 1 },
});
const A_STOP = anthropicFrame('message_stop', { type: 'message_stop' });

/** 200 SSE whose first chunk arrives at once and the rest after `tailAfterMs`
 *  (steady server); `hang` leaves the stream open instead of sending a tail. */
function pacedResponse(head: string, tail: string | 'hang', tailAfterMs: number): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(head));
        if (tail === 'hang') return; // genuine stall: never closes
        setTimeout(() => {
          c.enqueue(enc.encode(tail));
          c.close();
        }, tailAfterMs);
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function makeAnthropic(idleMs: number): AnthropicTransport {
  return new AnthropicTransport({
    provider: { apiKey: 'k', maxRetries: 0, streamIdleTimeoutMs: idleMs },
    env: { BPT_HTTP_CLIENT: 'fetch' },
    debug: () => undefined,
  });
}

function makeOpenAI(idleMs: number): OpenAIChatTransport {
  return new OpenAIChatTransport({
    provider: {
      protocol: 'openai-chat',
      apiKey: 'sk-test',
      maxRetries: 0,
      streamIdleTimeoutMs: idleMs,
    },
    env: { BPT_HTTP_CLIENT: 'fetch' },
    debug: () => undefined,
  });
}

describe('idle watchdog vs slow consumer (audit 2026-07-14 L-3) — Anthropic arm', () => {
  it('a consumer paused past streamIdleTimeoutMs does NOT kill a healthy stream', async () => {
    // Server: message_start at once, the rest 150ms later (steady, healthy).
    // Consumer: takes the first event, then pauses 250ms — over 3x the 70ms
    // idle window. Before the fix this surfaced stream_idle_timeout.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => pacedResponse(A_START, A_DELTA + A_STOP, 150)),
    );
    const gen = makeAnthropic(70).stream(baseReq());
    const first = await gen.next();
    expect((first.value as RawMessageStreamEvent).type).toBe('message_start');

    await sleep(250); // consumer-side pause at the yield

    const rest: RawMessageStreamEvent[] = [];
    for (let r = await gen.next(); r.done !== true; r = await gen.next()) {
      rest.push(r.value as RawMessageStreamEvent);
    }
    expect(rest.map((e) => e.type)).toEqual(['message_delta', 'message_stop']);
  });

  it('a genuine server stall STILL aborts after the consumer resumes (watchdog not disabled)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pacedResponse(A_START, 'hang', 0)));
    const gen = makeAnthropic(70).stream(baseReq());
    const first = await gen.next();
    expect((first.value as RawMessageStreamEvent).type).toBe('message_start');

    await sleep(200); // consumer pause: no abort while the consumer holds

    let error: unknown;
    try {
      await gen.next(); // resume against a dead server -> idle abort applies
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(APIConnectionError);
    expect((error as APIConnectionError).code).toBe('stream_idle_timeout');
  });
});

describe('idle watchdog vs slow consumer (audit 2026-07-14 L-3) — OpenAI twin', () => {
  const O_HEAD = `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { role: 'assistant', content: 'hi' }, finish_reason: null }],
  })}\n\n`;
  const O_TAIL =
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n` +
    'data: [DONE]\n\n';

  it('a consumer paused past streamIdleTimeoutMs does NOT kill a healthy stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pacedResponse(O_HEAD, O_TAIL, 150)));
    const gen = makeOpenAI(70).stream(baseReq());
    const first = await gen.next();
    expect((first.value as RawMessageStreamEvent).type).toBe('message_start');

    await sleep(250); // consumer-side pause at the yield

    const rest: RawMessageStreamEvent[] = [];
    for (let r = await gen.next(); r.done !== true; r = await gen.next()) {
      rest.push(r.value as RawMessageStreamEvent);
    }
    expect(rest.map((e) => e.type)).toContain('message_stop');
  });

  it('a genuine server stall STILL aborts after the consumer resumes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pacedResponse(O_HEAD, 'hang', 0)));
    const gen = makeOpenAI(70).stream(baseReq());
    const first = await gen.next();
    expect((first.value as RawMessageStreamEvent).type).toBe('message_start');

    await sleep(200);

    let error: unknown;
    try {
      for (;;) {
        const r = await gen.next();
        if (r.done === true) break;
      }
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(APIConnectionError);
    expect((error as APIConnectionError).code).toBe('stream_idle_timeout');
  });
});
