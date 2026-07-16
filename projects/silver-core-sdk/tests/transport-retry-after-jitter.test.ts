/**
 * audit 2026-07-14 L-2 — bounded jitter on the explicit Retry-After path.
 *
 * Before the fix an explicit Retry-After was honored AS GIVEN, so a concurrent
 * fan-out (subagent fleets) that all received the same "Retry-After: N" woke
 * and retried at the SAME instant. The fix multiplies the server delay by
 * [1.0, 1.0 + RETRY_AFTER_JITTER]: the server's ask is a FLOOR (never retry
 * earlier), and the jittered total is re-capped at RETRY_AFTER_MAX_MS.
 *
 * Deterministic via a Math.random stub; the delay is observed through the
 * transport's own "backing off Nms" debug line (logged before the sleep).
 * Twin discipline: the same behavior is asserted on both transports.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnthropicTransport } from '../src/transport/anthropic.js';
import { OpenAIChatTransport } from '../src/transport/openai.js';
import { AbortError } from '../src/errors.js';
import type { StreamRequest } from '../src/internal/contracts.js';
import type { RawMessageStreamEvent } from '../src/types.js';

const enc = new TextEncoder();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function baseReq(extra: Partial<StreamRequest> = {}): StreamRequest {
  return {
    model: 'claude-test-1',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'hi' }],
    ...extra,
  };
}

async function collect(
  gen: AsyncGenerator<RawMessageStreamEvent, void>,
): Promise<RawMessageStreamEvent[]> {
  const out: RawMessageStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

/** HTTP 429 carrying the given retry-after header. */
function rateLimited(retryAfter: string): Response {
  return new Response(
    JSON.stringify({
      type: 'error',
      error: { type: 'rate_limit_error', message: 'slow down' },
    }),
    { status: 429, headers: { 'retry-after': retryAfter } },
  );
}

/** Minimal complete Messages API SSE body. */
function anthropicOkSse(): Response {
  const body =
    `event: message_start\ndata: ${JSON.stringify({
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
    })}\n\n` +
    `event: message_delta\ndata: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 },
    })}\n\n` +
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
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

/** Minimal complete Chat Completions SSE body. */
function openaiOkSse(): Response {
  const chunks = [
    { choices: [{ index: 0, delta: { role: 'assistant', content: 'hi' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
  const body =
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
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

function makeAnthropic(debug: (m: string) => void): AnthropicTransport {
  return new AnthropicTransport({
    provider: { apiKey: 'k', maxRetries: 1 },
    env: { BPT_HTTP_CLIENT: 'fetch' },
    debug,
  });
}

function makeOpenAI(debug: (m: string) => void): OpenAIChatTransport {
  return new OpenAIChatTransport({
    provider: { protocol: 'openai-chat', apiKey: 'sk-test', maxRetries: 1 },
    env: { BPT_HTTP_CLIENT: 'fetch' },
    debug,
  });
}

describe('Retry-After jitter (audit 2026-07-14 L-2) — Anthropic arm', () => {
  it('jitters an explicit Retry-After UP by the random draw (worst case 1.25x)', async () => {
    // retry-after 0.02s = 20ms; Math.random()=1 -> 20 * (1 + 0.25) = 25ms.
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const lines: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (lines.some((l) => l.includes('backing off')) ? anthropicOkSse() : rateLimited('0.02'))),
    );
    await collect(makeAnthropic((m) => lines.push(m)).stream(baseReq()));
    expect(lines).toContain('transport: backing off 25ms');
  });

  it('never retries EARLIER than the server asked (random=0 -> exactly the header value)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const lines: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (lines.some((l) => l.includes('backing off')) ? anthropicOkSse() : rateLimited('0.02'))),
    );
    await collect(makeAnthropic((m) => lines.push(m)).stream(baseReq()));
    // The floor is the server's own ask: 20ms, jitter adds nothing at random=0.
    expect(lines).toContain('transport: backing off 20ms');
  });

  it('re-caps the jittered delay at RETRY_AFTER_MAX_MS (120s)', async () => {
    // Header 3600s is parser-capped to 120000ms; the 1.25x jitter would push it
    // to 150000ms — the backoff re-caps it at 120000ms. The sleep is not
    // awaited for real: the debug line is logged BEFORE sleeping, then the
    // caller aborts out of the 120s wait.
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const lines: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => rateLimited('3600')));
    const ac = new AbortController();
    const done = collect(
      makeAnthropic((m) => lines.push(m)).stream(baseReq({ signal: ac.signal })),
    );
    await vi.waitFor(() => {
      expect(lines).toContain('transport: backing off 120000ms');
    });
    ac.abort();
    await expect(done).rejects.toBeInstanceOf(AbortError);
  });
});

describe('Retry-After jitter (audit 2026-07-14 L-2) — OpenAI twin', () => {
  it('applies the identical [1.0, 1.25]x bounded jitter', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const lines: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (lines.some((l) => l.includes('backing off')) ? openaiOkSse() : rateLimited('0.02'))),
    );
    await collect(makeOpenAI((m) => lines.push(m)).stream(baseReq()));
    expect(lines).toContain('openai transport: backing off 25ms');
  });

  it('honors the server floor at random=0', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const lines: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (lines.some((l) => l.includes('backing off')) ? openaiOkSse() : rateLimited('0.02'))),
    );
    await collect(makeOpenAI((m) => lines.push(m)).stream(baseReq()));
    expect(lines).toContain('openai transport: backing off 20ms');
  });
});
