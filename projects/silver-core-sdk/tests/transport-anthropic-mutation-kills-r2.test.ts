/**
 * Mutation-kill tests: AnthropicTransport batch 2 (keeper "1 3 推进" order;
 * measurement round scored 77.42% - 120 survived + 6 no-coverage). The twin
 * discipline makes the openai batch-6 playbook port almost verbatim: endpoint
 * normalization, request-id capture on both error paths, beta headers, env
 * resolution knobs, error-payload shapes, empty-stream gating on
 * message_start, malformed-frame classification, resilience error fields,
 * Retry-After seconds scaling, concurrency semaphore, and abort mapping.
 *
 * Deliberately NOT killed (same overfitting guard as the openai round):
 * debug strings, backoff jitter arithmetic, listener micro-plumbing, unref
 * hints, AbortSignal.any single-part wrapping (behaviorally identical).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import { APIConnectionError, APIStatusError } from '../src/errors.js';
import type { RetryInfo, StreamRequest } from '../src/internal/contracts.js';
import type { ProviderConfig, RawMessageStreamEvent } from '../src/types.js';

const enc = new TextEncoder();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function sseResponse(text: string, headers: Record<string, string> = {}, opts: { hang?: boolean } = {}): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(text));
        if (!opts.hang) c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } },
  );
}
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
function okSse(): string {
  return frame('ping', { type: 'ping' }) + frame('message_stop', { type: 'message_stop' });
}
function startOnlySse(): string {
  return frame('message_start', {
    type: 'message_start',
    message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-test-1', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } },
  });
}
function makeT(provider: ProviderConfig = {}, env: Record<string, string | undefined> = {}, betas?: string[]) {
  return new AnthropicTransport({
    provider: { apiKey: 'k', maxRetries: 0, ...provider },
    env: { BPT_HTTP_CLIENT: 'fetch', ...env },
    debug: () => undefined,
    betas,
  });
}
function baseReq(extra: Partial<StreamRequest> = {}): StreamRequest {
  return { model: 'claude-test-1', max_tokens: 32, messages: [{ role: 'user', content: 'hi' }], ...extra };
}
async function collect(gen: AsyncIterable<RawMessageStreamEvent>): Promise<RawMessageStreamEvent[]> {
  const out: RawMessageStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
async function errOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e;
  }
}

describe('endpoint, headers, env knobs', () => {
  it('plural trailing slashes are stripped from the base url', async () => {
    const f = vi.fn(async () => sseResponse(okSse()));
    vi.stubGlobal('fetch', f);
    await collect(makeT({ baseUrl: 'http://gw.test///' }).stream(baseReq()));
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('http://gw.test/v1/messages');
  });

  it('betas join into ONE anthropic-beta header; an empty list sends none', async () => {
    const f1 = vi.fn(async () => sseResponse(okSse()));
    vi.stubGlobal('fetch', f1);
    await collect(makeT({}, {}, ['beta-a', 'beta-b']).stream(baseReq()));
    const h1 = (f1.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(h1['anthropic-beta']).toBe('beta-a,beta-b');
    vi.unstubAllGlobals();

    const f2 = vi.fn(async () => sseResponse(okSse()));
    vi.stubGlobal('fetch', f2);
    await collect(makeT({}, {}, []).stream(baseReq()));
    const h2 = (f2.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect('anthropic-beta' in h2).toBe(false);
  });

  it('CLAUDE_CODE_MAX_RETRIES=0 is honored (exactly one attempt); blank falls back to the default', async () => {
    const err500 = () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'x' } }), {
        status: 500,
        headers: { 'retry-after': '0' },
      });
    let calls1 = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls1 += 1; return err500(); }));
    const t1 = new AnthropicTransport({ provider: { apiKey: 'k' }, env: { BPT_HTTP_CLIENT: 'fetch', CLAUDE_CODE_MAX_RETRIES: '0' }, debug: () => undefined });
    await errOf(collect(t1.stream(baseReq())));
    expect(calls1).toBe(1);
    vi.unstubAllGlobals();

    let calls2 = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls2 += 1; return calls2 === 1 ? err500() : sseResponse(okSse()); }));
    const t2 = new AnthropicTransport({ provider: { apiKey: 'k' }, env: { BPT_HTTP_CLIENT: 'fetch', CLAUDE_CODE_MAX_RETRIES: '   ' }, debug: () => undefined });
    await collect(t2.stream(baseReq()));
    expect(calls2).toBe(2); // blank -> default budget (10), so the 500 healed
  });

  it('the concurrency semaphore serializes but completes concurrent streams (provider and env forms)', async () => {
    let inFlight = 0;
    let peak = 0;
    const gated = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return sseResponse(okSse());
    });
    vi.stubGlobal('fetch', gated);
    const t = makeT({ maxConcurrentRequests: 1 });
    await Promise.all([collect(t.stream(baseReq())), collect(t.stream(baseReq()))]);
    expect(peak).toBe(1);
    vi.unstubAllGlobals();

    inFlight = 0;
    peak = 0;
    vi.stubGlobal('fetch', gated);
    const tEnv = new AnthropicTransport({ provider: { apiKey: 'k' }, env: { BPT_HTTP_CLIENT: 'fetch', BPT_MAX_CONCURRENT_REQUESTS: '1' }, debug: () => undefined });
    await Promise.all([collect(tEnv.stream(baseReq())), collect(tEnv.stream(baseReq()))]);
    expect(peak).toBe(1);
  });

  it('BPT_STREAM_MAX_DURATION_MS env arms the hard cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(startOnlySse(), {}, { hang: true })));
    const t = new AnthropicTransport({ provider: { apiKey: 'k', maxRetries: 0 }, env: { BPT_HTTP_CLIENT: 'fetch', BPT_STREAM_MAX_DURATION_MS: '60' }, debug: () => undefined });
    const err = (await errOf(collect(t.stream(baseReq())))) as APIConnectionError & { code?: string; midStreamTruncation?: boolean };
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.code).toBe('stream_max_duration');
    expect(err.midStreamTruncation).toBe(true); // one event (message_start) was delivered
  }, 10_000);
});

describe('error payloads and request ids (both error paths)', () => {
  it('an HTTP error carries the request-id header onto the APIStatusError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404, headers: { 'request-id': 'req_9' } })));
    const err = (await errOf(collect(makeT().stream(baseReq())))) as APIStatusError;
    expect(err.requestId).toBe('req_9');
  });

  it('a MID-STREAM error frame carries the 200-response request-id', async () => {
    const body =
      startOnlySse() +
      frame('error', { type: 'error', error: { type: 'api_error', message: 'mid boom' } });
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(body, { 'request-id': 'req_mid' })));
    const err = (await errOf(collect(makeT().stream(baseReq())))) as APIStatusError;
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err.message).toBe('mid boom');
    expect(err.requestId).toBe('req_mid');
  });

  it('HTTP error-body shapes: non-JSON raw, empty -> status line, 2000-char cap, string error member', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway melted', { status: 400 })));
    const e1 = (await errOf(collect(makeT().stream(baseReq())))) as APIStatusError;
    expect(e1.message).toBe('gateway melted');
    vi.unstubAllGlobals();

    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404, statusText: 'Not Found' })));
    const e2 = (await errOf(collect(makeT().stream(baseReq())))) as APIStatusError;
    expect(e2.message).toBe('HTTP 404 Not Found');
    expect(e2.errorType).toBe('api_error');
    vi.unstubAllGlobals();

    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(3000), { status: 400 })));
    const e3 = (await errOf(collect(makeT().stream(baseReq())))) as APIStatusError;
    expect(e3.message).toHaveLength(2000);
    vi.unstubAllGlobals();

    // Twin nuance vs the openai arm: a non-object `error` member is NOT
    // unwrapped here (extractErrorPayload requires an object) - the raw JSON
    // body flows through as the message.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'plain words' }), { status: 400 })));
    const e4 = (await errOf(collect(makeT().stream(baseReq())))) as APIStatusError;
    expect(e4.message).toBe('{"error":"plain words"}');
  });

  it('a mid-stream error frame with a non-string message stringifies the error object', async () => {
    const body =
      startOnlySse() + frame('error', { type: 'error', error: { type: 123, message: 42 } });
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(body)));
    const err = (await errOf(collect(makeT().stream(baseReq())))) as APIStatusError;
    expect(err.errorType).toBe('api_error');
    expect(err.message).toBe(JSON.stringify({ type: 123, message: 42 }));
  });
});

describe('stream gating: message_start, malformed frames', () => {
  it('a stream that DID start but closed without message_stop completes in ONE attempt (no phantom empty-retry)', async () => {
    const f = vi.fn(async () => sseResponse(startOnlySse()));
    vi.stubGlobal('fetch', f);
    const events = await collect(makeT({ maxRetries: 2 }).stream(baseReq()));
    expect(events.map((e) => e.type)).toEqual(['message_start']);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('an event-less non-JSON frame is SKIPPED; an event-ful garbage frame is sse_malformed_frame', async () => {
    // keepalive noise between real frames: data-only frame with non-JSON body
    const noisy = `data: keepalive-not-json\n\n` + okSse();
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(noisy)));
    const events = await collect(makeT().stream(baseReq()));
    expect(events.map((e) => e.type)).toEqual(['ping', 'message_stop']);
    vi.unstubAllGlobals();

    const garbage = startOnlySse() + `event: content_block_delta\ndata: {broken${'y'.repeat(200)}\n\n`;
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(garbage)));
    const err = (await errOf(collect(makeT().stream(baseReq())))) as APIConnectionError & { code?: string };
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.code).toBe('sse_malformed_frame');
    // the offending payload is embedded, truncated to 120 chars
    expect(err.message).toContain('{broken');
    expect(err.message.length).toBeLessThan(400);
  });
});

describe('resilience error fields (twin of the openai batch)', () => {
  it('an idle stall with ZERO events is replay-safe; after an event it is not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse('', {}, { hang: true })));
    const e1 = (await errOf(
      collect(makeT({ streamIdleTimeoutMs: 60 }).stream(baseReq())),
    )) as APIConnectionError & { turnReplaySafe?: boolean; midStreamTruncation?: boolean };
    expect(e1.code).toBe('stream_idle_timeout');
    expect(e1.turnReplaySafe).toBe(true);
    expect(e1.midStreamTruncation).not.toBe(true);
    vi.unstubAllGlobals();

    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(startOnlySse(), {}, { hang: true })));
    const e2 = (await errOf(
      collect(makeT({ streamIdleTimeoutMs: 60 }).stream(baseReq())),
    )) as APIConnectionError & { turnReplaySafe?: boolean };
    expect(e2.turnReplaySafe).toBe(false);
  }, 10_000);

  it('a caller abort mid-stream maps to AbortError, never a truncation error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(startOnlySse(), {}, { hang: true })));
    const ac = new AbortController();
    const pending = collect(makeT().stream(baseReq({ signal: ac.signal })));
    setTimeout(() => ac.abort(), 40);
    const err = await errOf(pending);
    expect((err as Error).name).toBe('AbortError');
  });
});

describe('Retry-After seconds scaling', () => {
  it("retry-after '2' surfaces retryAfterMs 2000 on the RetryInfo", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 's' } }), {
          status: 429,
          headers: { 'retry-after': '2' },
        }),
      ),
    );
    const ac = new AbortController();
    const retries: RetryInfo[] = [];
    await errOf(
      collect(
        makeT({ maxRetries: 1 }).stream(
          baseReq({
            signal: ac.signal,
            onRetry: (i) => {
              retries.push(i);
              ac.abort(); // never actually wait the 2s
            },
          }),
        ),
      ),
    );
    expect(retries[0]!.retryAfterMs).toBe(2000);
  });
});
