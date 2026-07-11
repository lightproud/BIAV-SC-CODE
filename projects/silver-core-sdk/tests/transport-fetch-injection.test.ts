/**
 * provider.fetch injection seam (BPT-EXTENSION, response-time work 2026-07-11).
 *
 * Both transports must route EVERY HTTP request through the injected fetch
 * (never the global one) and behave byte-identically otherwise — the seam
 * exists so a consumer can bind requests to a long-keep-alive undici Agent
 * (docs/PERFORMANCE.md) or an instrumented/proxied fetch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnthropicTransport } from '../src/transport/anthropic.js';
import { OpenAIChatTransport } from '../src/transport/openai.js';
import type { StreamRequest } from '../src/internal/contracts.js';
import type { RawMessageStreamEvent } from '../src/types.js';

const enc = new TextEncoder();

function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = events
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

const ANTHROPIC_EVENTS = [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test-1', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
  { type: 'message_stop' },
];

function openaiSseResponse(): Response {
  const chunks = [
    { id: 'chatcmpl-1', model: 'gpt-test', choices: [{ index: 0, delta: { role: 'assistant', content: 'hi' }, finish_reason: null }] },
    { id: 'chatcmpl-1', model: 'gpt-test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
  ];
  const body =
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function baseReq(): StreamRequest {
  return {
    model: 'claude-test-1',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hi' }],
  };
}

async function collect(gen: AsyncIterable<RawMessageStreamEvent>): Promise<RawMessageStreamEvent[]> {
  const out: RawMessageStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('provider.fetch injection', () => {
  it('AnthropicTransport routes the request through the injected fetch, not the global', async () => {
    const globalFetch = vi.fn(async () => {
      throw new Error('global fetch must not be called');
    });
    vi.stubGlobal('fetch', globalFetch);
    const injected = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      sseResponse(ANTHROPIC_EVENTS),
    );
    const transport = new AnthropicTransport({
      provider: { apiKey: 'k', fetch: injected },
      env: {},
      debug: () => undefined,
    });
    const events = await collect(transport.stream(baseReq()));
    expect(events.at(-1)?.type).toBe('message_stop');
    expect(injected).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
    const [url, init] = injected.mock.calls[0]!;
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    // The injected fetch receives the full RequestInit the global would have:
    // body, headers (credential included) and the per-attempt abort signal.
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body)).stream).toBe(true);
  });

  it('OpenAIChatTransport routes the request through the injected fetch, not the global', async () => {
    const globalFetch = vi.fn(async () => {
      throw new Error('global fetch must not be called');
    });
    vi.stubGlobal('fetch', globalFetch);
    const injected = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      openaiSseResponse(),
    );
    const transport = new OpenAIChatTransport({
      provider: { protocol: 'openai-chat', apiKey: 'k', fetch: injected },
      env: {},
      debug: () => undefined,
    });
    const events = await collect(transport.stream({ ...baseReq(), model: 'gpt-test' }));
    expect(events.at(-1)?.type).toBe('message_stop');
    expect(injected).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
    expect(String(injected.mock.calls[0]![0])).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
  });

  it('retries flow through the injected fetch as well (429 then success)', async () => {
    const responses: Array<() => Response> = [
      () =>
        new Response(
          JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }),
          { status: 429, headers: { 'retry-after': '0' } },
        ),
      () => sseResponse(ANTHROPIC_EVENTS),
    ];
    const injected = vi.fn(async () => responses.shift()!());
    const transport = new AnthropicTransport({
      provider: { apiKey: 'k', fetch: injected, maxRetries: 2 },
      env: {},
      debug: () => undefined,
    });
    const events = await collect(transport.stream(baseReq()));
    expect(events.at(-1)?.type).toBe('message_stop');
    expect(injected).toHaveBeenCalledTimes(2);
  });
});
