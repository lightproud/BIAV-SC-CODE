/**
 * Mutation-kill tests: AnthropicTransport survivors (transport round 1).
 * Focus: the resilience arms the campaign prioritizes - Retry-After
 * HTTP-date parsing (was NO COVERAGE on this arm; the 0.48.3 tests
 * exercised the numeric form), the no-body response guard, retryable
 * status classification, credential-resolution messaging, and mid-stream
 * error-frame payload fallbacks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import { APIConnectionError, APIStatusError, ConfigurationError } from '../src/errors.js';
import type { RetryInfo, StreamRequest } from '../src/internal/contracts.js';
import type { ProviderConfig, RawMessageStreamEvent } from '../src/types.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// --- helpers (mirroring tests/transport.test.ts) ------------------------------

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}
function sseBody(frames: Array<{ event: string; data: unknown }>): string {
  return frames.map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`).join('');
}
function sseResponse(text: string, headers: Record<string, string> = {}): Response {
  return new Response(streamFromChunks([text]), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}
function okSse(): string {
  return sseBody([
    { event: 'ping', data: { type: 'ping' } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]);
}
const OK_EVENTS: RawMessageStreamEvent[] = [{ type: 'ping' }, { type: 'message_stop' }];

function stubFetch(factories: Array<() => Response | Promise<Response>>) {
  let i = 0;
  const fn = vi.fn((_url: string | URL, _init?: RequestInit): Promise<Response> => {
    const factory = factories[i];
    i += 1;
    if (!factory) return Promise.reject(new Error('stubFetch: unexpected extra fetch call'));
    return Promise.resolve().then(factory);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
function makeTransport(cfg: { provider?: ProviderConfig; env?: Record<string, string | undefined> } = {}) {
  return new AnthropicTransport({
    provider: cfg.provider,
    env: { BPT_HTTP_CLIENT: 'fetch', ...cfg.env },
    debug: () => undefined,
  });
}
function baseReq(extra: Partial<StreamRequest> = {}): StreamRequest {
  return { model: 'claude-test-1', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }], ...extra };
}
async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
async function captureError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return err;
  }
}
function rateLimited(headers: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }),
    { status: 429, headers },
  );
}

// --- Retry-After HTTP-date arm (was NO COVERAGE) --------------------------------

describe('Retry-After HTTP-date parsing (anthropic.ts:790-794)', () => {
  it('a PAST http-date means retry immediately (retryAfterMs 0 on the RetryInfo, fast wall clock)', async () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    const fetchMock = stubFetch([() => rateLimited({ 'retry-after': past }), () => sseResponse(okSse())]);
    const retries: RetryInfo[] = [];
    const started = Date.now();
    const events = await collect(
      makeTransport({ provider: { apiKey: 'k' } }).stream(
        baseReq({ onRetry: (i) => retries.push(i) }),
      ),
    );
    expect(events).toEqual(OK_EVENTS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retries[0]).toMatchObject({ kind: 'http_status', retryAfterMs: 0 });
    expect(Date.now() - started).toBeLessThan(450);
  });

  it('a FUTURE http-date is honored as delta-from-now (not clamped to the 60s exponential cap)', async () => {
    const future = new Date(Date.now() + 90_000).toUTCString();
    stubFetch([() => rateLimited({ 'retry-after': future })]);
    const ac = new AbortController();
    const retries: RetryInfo[] = [];
    const err = await captureError(
      collect(
        makeTransport({ provider: { apiKey: 'k' } }).stream(
          baseReq({
            signal: ac.signal,
            onRetry: (i) => {
              retries.push(i);
              ac.abort(); // never actually wait the 90s
            },
          }),
        ),
      ),
    );
    expect((err as Error).name).toBe('AbortError');
    expect(retries).toHaveLength(1);
    const ms = retries[0]!.retryAfterMs!;
    expect(ms).toBeGreaterThan(60_000); // beyond the exponential cap - honored, not clamped down
    expect(ms).toBeLessThanOrEqual(120_000); // bounded by the Retry-After ceiling
  });

  it('a pathological far-future http-date is bounded by the 120s ceiling', async () => {
    const far = new Date(Date.now() + 3_600_000).toUTCString();
    stubFetch([() => rateLimited({ 'retry-after': far })]);
    const ac = new AbortController();
    const retries: RetryInfo[] = [];
    await captureError(
      collect(
        makeTransport({ provider: { apiKey: 'k' } }).stream(
          baseReq({
            signal: ac.signal,
            onRetry: (i) => {
              retries.push(i);
              ac.abort();
            },
          }),
        ),
      ),
    );
    expect(retries[0]!.retryAfterMs).toBe(120_000);
  });

  it('an unparsable Retry-After falls back to exponential backoff (no retryAfterMs on the info)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    stubFetch([() => rateLimited({ 'retry-after': 'soonish' }), () => sseResponse(okSse())]);
    const retries: RetryInfo[] = [];
    const events = await collect(
      makeTransport({ provider: { apiKey: 'k' } }).stream(
        baseReq({ onRetry: (i) => retries.push(i) }),
      ),
    );
    expect(events).toEqual(OK_EVENTS);
    expect(retries[0]!.retryAfterMs).toBeUndefined();
  });
});

// --- retryable-status classification (anthropic.ts:485) --------------------------

describe('retryable status classification', () => {
  it('500 and 408 are retried; 404 is terminal on the first call', async () => {
    const err500 = () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }), {
        status: 500,
        headers: { 'retry-after': '0' },
      });
    const fetch1 = stubFetch([err500, () => sseResponse(okSse())]);
    const t1 = makeTransport({ provider: { apiKey: 'k' } });
    expect(await collect(t1.stream(baseReq()))).toEqual(OK_EVENTS);
    expect(fetch1).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();

    const err408 = () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'timeout_error', message: 'slow' } }), {
        status: 408,
        headers: { 'retry-after': '0' },
      });
    const fetch2 = stubFetch([err408, () => sseResponse(okSse())]);
    const t2 = makeTransport({ provider: { apiKey: 'k' } });
    expect(await collect(t2.stream(baseReq()))).toEqual(OK_EVENTS);
    expect(fetch2).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();

    const err404 = () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'nope' } }), {
        status: 404,
      });
    const fetch3 = stubFetch([err404]);
    const t3 = makeTransport({ provider: { apiKey: 'k' } });
    const err = await captureError(collect(t3.stream(baseReq())));
    expect(err).toBeInstanceOf(APIStatusError);
    expect((err as APIStatusError).status).toBe(404);
    expect(fetch3).toHaveBeenCalledTimes(1);
  });
});

// --- response-body guard + error-frame payload fallbacks ---------------------------

describe('response and error-frame edge guards', () => {
  it('an HTTP 200 with a NULL body raises the dedicated no-body connection error', async () => {
    stubFetch([() => new Response(null, { status: 200 })]);
    const t = makeTransport({ provider: { apiKey: 'k', maxRetries: 0 } });
    const err = await captureError(collect(t.stream(baseReq())));
    expect(err).toBeInstanceOf(APIConnectionError);
    expect((err as Error).message).toContain('Messages API response has no body');
  });

  it('a mid-stream error frame WITHOUT an error member falls back to api_error with the raw data', async () => {
    const body = `event: error\ndata: {"weird":1}\n\n`;
    stubFetch([() => sseResponse(body)]);
    const t = makeTransport({ provider: { apiKey: 'k', maxRetries: 0 } });
    const err = await captureError(collect(t.stream(baseReq())));
    expect(err).toBeInstanceOf(APIStatusError);
    expect((err as APIStatusError).errorType).toBe('api_error');
    expect((err as Error).message).toContain('weird');
  });

  it('a mid-stream error frame with a NON-STRING error.type normalizes to api_error', async () => {
    const body = `event: error\ndata: {"type":"error","error":{"type":123,"message":"odd"}}\n\n`;
    stubFetch([() => sseResponse(body)]);
    const t = makeTransport({ provider: { apiKey: 'k', maxRetries: 0 } });
    const err = await captureError(collect(t.stream(baseReq())));
    expect(err).toBeInstanceOf(APIStatusError);
    expect((err as APIStatusError).errorType).toBe('api_error');
    expect((err as Error).message).toBe('odd');
  });
});

// --- credential-resolution message (anthropic.ts:158-160) ---------------------------

describe('credential resolution', () => {
  it('a credential-less transport names every credential source in its error', async () => {
    let thrown: unknown;
    try {
      const t = makeTransport({ provider: {}, env: { BPT_HTTP_CLIENT: 'fetch' } });
      await collect(t.stream(baseReq()));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConfigurationError);
    const msg = (thrown as Error).message;
    expect(msg).toContain('No Anthropic credential found');
    expect(msg).toContain('options.provider.apiKey');
    expect(msg).toContain('ANTHROPIC_API_KEY');
    expect(msg).toContain('ANTHROPIC_AUTH_TOKEN');
  });
});
