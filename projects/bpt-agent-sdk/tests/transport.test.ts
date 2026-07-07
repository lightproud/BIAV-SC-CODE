/**
 * Module A (transport) unit tests: parseSSE framing + AnthropicTransport
 * auth/base-url/header resolution, retry policy, SSE error mapping and
 * abort behavior. No network: global fetch is stubbed per test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseSSE, type SSEFrame } from '../src/transport/sse.js';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import {
  AbortError,
  APIConnectionError,
  APIStatusError,
  ConfigurationError,
} from '../src/errors.js';
import type { StreamRequest } from '../src/internal/contracts.js';
import type { ProviderConfig, RawMessageStreamEvent } from '../src/types.js';
import { textReplyEvents } from './helpers/mock-transport.js';

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function streamFromChunks(
  chunks: Array<string | Uint8Array>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? enc.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

/** Enqueue `head`, then keep the stream open forever (until cancelled). */
function hangingStream(
  head: string,
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (head) controller.enqueue(enc.encode(head));
    },
    cancel() {
      onCancel?.();
    },
  });
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of gen) out.push(value);
  return out;
}

async function collectWithError<T>(
  gen: AsyncGenerator<T, void>,
): Promise<{ events: T[]; error: unknown }> {
  const events: T[] = [];
  try {
    for await (const ev of gen) events.push(ev);
  } catch (err) {
    return { events, error: err };
  }
  return { events, error: undefined };
}

async function captureError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected promise to reject, but it resolved');
}

/** Serialize frames into SSE wire text (JSON-encoded data payloads). */
function sseBody(frames: Array<{ event?: string; data: unknown }>): string {
  return frames
    .map(
      (f) =>
        `${f.event !== undefined ? `event: ${f.event}\n` : ''}data: ${JSON.stringify(f.data)}\n\n`,
    )
    .join('');
}

function eventsToSse(events: RawMessageStreamEvent[]): string {
  return sseBody(events.map((e) => ({ event: e.type, data: e })));
}

function sseResponse(text: string, headers: Record<string, string> = {}): Response {
  return new Response(streamFromChunks([text]), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

/** Minimal successful stream body: ping + message_stop. */
function okSse(): string {
  return eventsToSse([{ type: 'ping' }, { type: 'message_stop' }]);
}

const OK_EVENTS: RawMessageStreamEvent[] = [
  { type: 'ping' },
  { type: 'message_stop' },
];

/**
 * Stub global fetch with a scripted sequence of response factories.
 * A factory may throw (network error) or return a Response.
 */
function stubFetch(factories: Array<() => Response | Promise<Response>>) {
  let i = 0;
  const fn = vi.fn((url: string | URL, init?: RequestInit): Promise<Response> => {
    void url;
    void init;
    const factory = factories[i];
    i += 1;
    if (!factory) {
      return Promise.reject(new Error('stubFetch: unexpected extra fetch call'));
    }
    return Promise.resolve().then(factory);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function makeTransport(cfg: {
  provider?: ProviderConfig;
  env?: Record<string, string | undefined>;
  betas?: string[];
} = {}): AnthropicTransport {
  return new AnthropicTransport({
    provider: cfg.provider,
    env: cfg.env ?? {},
    debug: () => undefined,
    betas: cfg.betas,
  });
}

function baseReq(extra: Partial<StreamRequest> = {}): StreamRequest {
  return {
    model: 'claude-test-1',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hi' }],
    ...extra,
  };
}

function callArgs(
  fetchMock: ReturnType<typeof stubFetch>,
  call = 0,
): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const args = fetchMock.mock.calls[call];
  if (!args) throw new Error(`fetch call #${call} not recorded`);
  return {
    url: String(args[0]),
    init: args[1] as RequestInit & { headers: Record<string, string> },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// parseSSE
// ---------------------------------------------------------------------------

describe('parseSSE', () => {
  it('parses a single frame with an event name', async () => {
    const frames = await collect(
      parseSSE(streamFromChunks(['event: message_start\ndata: {"a":1}\n\n'])),
    );
    expect(frames).toEqual([{ event: 'message_start', data: '{"a":1}' }]);
  });

  it('omits the event field when no event: line is present', async () => {
    const frames = await collect(parseSSE(streamFromChunks(['data: hello\n\n'])));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.data).toBe('hello');
    expect(frames[0]!.event).toBeUndefined();
  });

  it('joins multiple data: lines with \\n', async () => {
    const frames = await collect(
      parseSSE(streamFromChunks(['data: first\ndata: second\ndata: third\n\n'])),
    );
    expect(frames).toEqual([{ data: 'first\nsecond\nthird' }]);
  });

  it('tolerates CRLF line endings', async () => {
    const frames = await collect(
      parseSSE(streamFromChunks(['event: ping\r\ndata: {"type":"ping"}\r\n\r\n'])),
    );
    expect(frames).toEqual([{ event: 'ping', data: '{"type":"ping"}' }]);
  });

  it('ignores ":" comment lines; a comment-only frame is not dispatched', async () => {
    const frames = await collect(
      parseSSE(streamFromChunks([': heartbeat\n\n: again\ndata: x\n\n'])),
    );
    expect(frames).toEqual([{ data: 'x' }]);
  });

  it('does not dispatch a frame that has an event name but no data', async () => {
    const frames = await collect(
      parseSSE(streamFromChunks(['event: ping\n\nevent: real\ndata: y\n\n'])),
    );
    expect(frames).toEqual([{ event: 'real', data: 'y' }]);
  });

  it('handles frames split across arbitrary chunk boundaries', async () => {
    const frames = await collect(
      parseSSE(streamFromChunks(['da', 'ta: {"a', '":1}\n', '\n'])),
    );
    expect(frames).toEqual([{ data: '{"a":1}' }]);
  });

  it('handles a multi-byte UTF-8 character split across chunks', async () => {
    const bytes = enc.encode('data: 日本\n\n');
    // Split inside the 3-byte encoding of the first CJK character.
    const frames = await collect(
      parseSSE(streamFromChunks([bytes.slice(0, 7), bytes.slice(7)])),
    );
    expect(frames).toEqual([{ data: '日本' }]);
  });

  it('flushes a trailing frame whose lines are newline-terminated', async () => {
    const frames = await collect(
      parseSSE(streamFromChunks(['event: tail\ndata: last\n'])),
    );
    expect(frames).toEqual([{ event: 'tail', data: 'last' }]);
  });

  it('discards a trailing partial (unterminated) line at stream end', async () => {
    const frames = await collect(parseSSE(streamFromChunks(['data: incomplete'])));
    expect(frames).toEqual([]);
  });

  it('dispatches completed frames but drops the unterminated trailing line', async () => {
    const frames = await collect(
      parseSSE(streamFromChunks(['data: a\n\ndata: b'])),
    );
    expect(frames).toEqual([{ data: 'a' }]);
  });

  it('cancels the underlying reader when the consumer breaks early', async () => {
    let cancelled = false;
    const body = hangingStream('data: one\n\ndata: two\n\n', () => {
      cancelled = true;
    });
    const frames: SSEFrame[] = [];
    for await (const frame of parseSSE(body)) {
      frames.push(frame);
      break; // early exit must not hang and must release the stream
    }
    expect(frames).toEqual([{ data: 'one' }]);
    expect(cancelled).toBe(true);
  });

  it('rejects with AbortError when the signal fires mid-stream (no hang)', async () => {
    const ac = new AbortController();
    const gen = parseSSE(hangingStream('data: one\n\n'), ac.signal);
    const first = await gen.next();
    expect(first.done).toBe(false);
    expect((first.value as SSEFrame).data).toBe('one');
    const pending = gen.next();
    ac.abort();
    const err = await captureError(pending);
    expect(err).toBeInstanceOf(AbortError);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const err = await captureError(
      parseSSE(streamFromChunks(['data: x\n\n']), ac.signal).next(),
    );
    expect(err).toBeInstanceOf(AbortError);
  });
});

// ---------------------------------------------------------------------------
// AnthropicTransport - credential resolution
// ---------------------------------------------------------------------------

describe('AnthropicTransport credential resolution', () => {
  it('provider.apiKey -> x-api-key header, apiKeySource user', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({ provider: { apiKey: 'sk-prov' } });
    expect(t.apiKeySource()).toBe('user');
    await collect(t.stream(baseReq()));
    const { init } = callArgs(fetchMock);
    expect(init.headers['x-api-key']).toBe('sk-prov');
    expect(init.headers['authorization']).toBeUndefined();
  });

  it('env ANTHROPIC_API_KEY -> x-api-key header, apiKeySource project', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({ env: { ANTHROPIC_API_KEY: 'sk-env' } });
    expect(t.apiKeySource()).toBe('project');
    await collect(t.stream(baseReq()));
    const { init } = callArgs(fetchMock);
    expect(init.headers['x-api-key']).toBe('sk-env');
  });

  it('provider.authToken -> Authorization Bearer header, apiKeySource user', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({ provider: { authToken: 'tok-prov' } });
    expect(t.apiKeySource()).toBe('user');
    await collect(t.stream(baseReq()));
    const { init } = callArgs(fetchMock);
    expect(init.headers['authorization']).toBe('Bearer tok-prov');
    expect(init.headers['x-api-key']).toBeUndefined();
  });

  it('env ANTHROPIC_AUTH_TOKEN -> Bearer header, apiKeySource project', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({ env: { ANTHROPIC_AUTH_TOKEN: 'tok-env' } });
    expect(t.apiKeySource()).toBe('project');
    await collect(t.stream(baseReq()));
    const { init } = callArgs(fetchMock);
    expect(init.headers['authorization']).toBe('Bearer tok-env');
  });

  it('the api-key domain wins over authToken (provider.apiKey beats provider.authToken)', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({
      provider: { apiKey: 'sk-prov', authToken: 'tok-prov' },
    });
    await collect(t.stream(baseReq()));
    const { init } = callArgs(fetchMock);
    expect(init.headers['x-api-key']).toBe('sk-prov');
    expect(init.headers['authorization']).toBeUndefined();
  });

  it('env ANTHROPIC_API_KEY beats provider.authToken (domain order, not layer order)', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({
      provider: { authToken: 'tok-prov' },
      env: { ANTHROPIC_API_KEY: 'sk-env' },
    });
    expect(t.apiKeySource()).toBe('project');
    await collect(t.stream(baseReq()));
    const { init } = callArgs(fetchMock);
    expect(init.headers['x-api-key']).toBe('sk-env');
    expect(init.headers['authorization']).toBeUndefined();
  });

  it('no credential -> ConfigurationError at first stream() call, fetch never called', async () => {
    const fetchMock = stubFetch([]);
    const t = makeTransport({ env: {} });
    expect(t.apiKeySource()).toBe('none');
    const err = await captureError(t.stream(baseReq()).next());
    expect(err).toBeInstanceOf(ConfigurationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('empty-string credentials are treated as unset', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({
      provider: { apiKey: '' },
      env: { ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: 'tok-env' },
    });
    expect(t.apiKeySource()).toBe('project');
    await collect(t.stream(baseReq()));
    const { init } = callArgs(fetchMock);
    expect(init.headers['authorization']).toBe('Bearer tok-env');
    expect(init.headers['x-api-key']).toBeUndefined();

    const allEmpty = makeTransport({
      provider: { apiKey: '', authToken: '' },
      env: { ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' },
    });
    expect(allEmpty.apiKeySource()).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// AnthropicTransport - base URL, headers, body
// ---------------------------------------------------------------------------

describe('AnthropicTransport request construction', () => {
  it('POSTs to provider.baseUrl + /v1/messages when provider.baseUrl is set', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({
      provider: { apiKey: 'k', baseUrl: 'https://gw.example.com' },
      env: { ANTHROPIC_BASE_URL: 'https://ignored.example.com' },
    });
    await collect(t.stream(baseReq()));
    const { url, init } = callArgs(fetchMock);
    expect(url).toBe('https://gw.example.com/v1/messages');
    expect(init.method).toBe('POST');
  });

  it('falls back to env ANTHROPIC_BASE_URL', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({
      provider: { apiKey: 'k' },
      env: { ANTHROPIC_BASE_URL: 'https://env.example.com' },
    });
    await collect(t.stream(baseReq()));
    expect(callArgs(fetchMock).url).toBe('https://env.example.com/v1/messages');
  });

  it('defaults to https://api.anthropic.com (empty env base URL treated as unset)', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({
      provider: { apiKey: 'k' },
      env: { ANTHROPIC_BASE_URL: '' },
    });
    await collect(t.stream(baseReq()));
    expect(callArgs(fetchMock).url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('sends default headers: anthropic-version, content-type, user-agent', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    await collect(t.stream(baseReq()));
    const { init } = callArgs(fetchMock);
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['user-agent']).toBe('bpt-agent-sdk/0.1.0');
  });

  it('provider.apiVersion overrides the anthropic-version header', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({
      provider: { apiKey: 'k', apiVersion: '2024-10-22' },
    });
    await collect(t.stream(baseReq()));
    expect(callArgs(fetchMock).init.headers['anthropic-version']).toBe('2024-10-22');
  });

  it('merges betas into the anthropic-beta header (appending to defaultHeaders)', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({
      provider: {
        apiKey: 'k',
        defaultHeaders: { 'anthropic-beta': 'pre-existing' },
      },
      betas: ['beta-a', 'beta-b'],
    });
    await collect(t.stream(baseReq()));
    expect(callArgs(fetchMock).init.headers['anthropic-beta']).toBe(
      'pre-existing,beta-a,beta-b',
    );
  });

  it('sets anthropic-beta from betas alone when no defaultHeaders entry exists', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({ provider: { apiKey: 'k' }, betas: ['only-beta'] });
    await collect(t.stream(baseReq()));
    expect(callArgs(fetchMock).init.headers['anthropic-beta']).toBe('only-beta');
  });

  it('merges defaultHeaders but the resolved credential header is authoritative', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({
      provider: {
        apiKey: 'sk-real',
        defaultHeaders: { 'x-custom': 'yes', 'X-Api-Key': 'evil-override' },
      },
    });
    await collect(t.stream(baseReq()));
    const { init } = callArgs(fetchMock);
    expect(init.headers['x-custom']).toBe('yes');
    expect(init.headers['x-api-key']).toBe('sk-real');
  });

  it('body carries the request fields plus stream:true; signal and undefined fields omitted', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const ac = new AbortController();
    await collect(
      t.stream(
        baseReq({ temperature: 0.5, system: undefined, signal: ac.signal }),
      ),
    );
    const { init } = callArgs(fetchMock);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.model).toBe('claude-test-1');
    expect(body.max_tokens).toBe(64);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.temperature).toBe(0.5);
    expect('signal' in body).toBe(false);
    expect('system' in body).toBe(false);
    expect('tools' in body).toBe(false);
  });

  it('serializes tool_choice into the wire body verbatim (C10)', async () => {
    const fetchMock = stubFetch([() => sseResponse(okSse())]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    await collect(
      t.stream(
        baseReq({
          tools: [{ name: 'Read', input_schema: { type: 'object' } }],
          tool_choice: { type: 'tool', name: 'Read', disable_parallel_tool_use: true },
        }),
      ),
    );
    const { init } = callArgs(fetchMock);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.tool_choice).toEqual({
      type: 'tool',
      name: 'Read',
      disable_parallel_tool_use: true,
    });
  });
});

// ---------------------------------------------------------------------------
// AnthropicTransport - retry policy
// ---------------------------------------------------------------------------

describe('AnthropicTransport retries', () => {
  it('retries a 429 honoring retry-after: 0, then succeeds with exactly 2 fetch calls', async () => {
    const fetchMock = stubFetch([
      () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'rate_limit_error', message: 'slow down' },
          }),
          { status: 429, headers: { 'retry-after': '0' } },
        ),
      () => sseResponse(okSse()),
    ]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const started = Date.now();
    const events = await collect(t.stream(baseReq()));
    const elapsed = Date.now() - started;
    expect(events).toEqual(OK_EVENTS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // retry-after: 0 must win over the ~500-1000ms default backoff.
    expect(elapsed).toBeLessThan(450);
  });

  it('400 -> APIStatusError immediately with exactly 1 fetch call', async () => {
    const fetchMock = stubFetch([
      () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'bad request' },
          }),
          { status: 400 },
        ),
    ]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const err = await captureError(collect(t.stream(baseReq())));
    expect(err).toBeInstanceOf(APIStatusError);
    const statusErr = err as APIStatusError;
    expect(statusErr.status).toBe(400);
    expect(statusErr.errorType).toBe('invalid_request_error');
    expect(statusErr.message).toBe('bad request');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries after a network TypeError and then succeeds', async () => {
    // Pin jitter so the single backoff is a deterministic 500ms.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = stubFetch([
      () => {
        throw new TypeError('fetch failed');
      },
      () => sseResponse(okSse()),
    ]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const events = await collect(t.stream(baseReq()));
    expect(events).toEqual(OK_EVENTS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('with maxRetries 0 a 429 becomes an immediate APIStatusError', async () => {
    const fetchMock = stubFetch([
      () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'rate_limit_error', message: 'nope' },
          }),
          { status: 429 },
        ),
    ]);
    const t = makeTransport({ provider: { apiKey: 'k', maxRetries: 0 } });
    const err = await captureError(collect(t.stream(baseReq())));
    expect(err).toBeInstanceOf(APIStatusError);
    expect((err as APIStatusError).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('with maxRetries 0 a network error becomes APIConnectionError', async () => {
    const fetchMock = stubFetch([
      () => {
        throw new TypeError('fetch failed');
      },
    ]);
    const t = makeTransport({ provider: { apiKey: 'k', maxRetries: 0 } });
    const err = await captureError(collect(t.stream(baseReq())));
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AnthropicTransport - streaming phase
// ---------------------------------------------------------------------------

describe('AnthropicTransport streaming', () => {
  it('yields events in order, typed, matching the wire payloads', async () => {
    const events = textReplyEvents('Hello world');
    stubFetch([() => sseResponse(eventsToSse(events))]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const received = await collect(t.stream(baseReq()));
    expect(received).toEqual(events);
    expect(received.map((e) => e.type)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
  });

  it('SSE error event mid-stream -> APIStatusError 529 for overloaded_error; prior events yielded; no retry', async () => {
    const good = textReplyEvents('partial').slice(0, 3);
    const body =
      eventsToSse(good) +
      sseBody([
        {
          event: 'error',
          data: {
            type: 'error',
            error: { type: 'overloaded_error', message: 'Overloaded' },
          },
        },
      ]);
    const fetchMock = stubFetch([() => sseResponse(body)]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const { events, error } = await collectWithError(t.stream(baseReq()));
    expect(events).toEqual(good);
    expect(error).toBeInstanceOf(APIStatusError);
    const statusErr = error as APIStatusError;
    expect(statusErr.status).toBe(529);
    expect(statusErr.errorType).toBe('overloaded_error');
    expect(statusErr.message).toBe('Overloaded');
    // Mid-stream failures must never be retried.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an {type:"error"} payload without an SSE event name also maps to APIStatusError', async () => {
    const body = sseBody([
      {
        data: {
          type: 'error',
          error: { type: 'rate_limit_error', message: 'slow down' },
        },
      },
    ]);
    const fetchMock = stubFetch([() => sseResponse(body)]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const { events, error } = await collectWithError(t.stream(baseReq()));
    expect(events).toEqual([]);
    expect(error).toBeInstanceOf(APIStatusError);
    expect((error as APIStatusError).status).toBe(429);
    expect((error as APIStatusError).errorType).toBe('rate_limit_error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('malformed (non-JSON) SSE data -> APIConnectionError', async () => {
    stubFetch([() => sseResponse('event: ping\ndata: {not json\n\n')]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const err = await captureError(collect(t.stream(baseReq())));
    expect(err).toBeInstanceOf(APIConnectionError);
  });

  it('malformed frame WITH an event name carries the evidence: event, frame count, data snippet', async () => {
    // E6b diagnosability: the error must distinguish gateway-format noise
    // from a genuinely corrupted Anthropic frame at a glance.
    const good = eventsToSse([{ type: 'ping' }]);
    stubFetch([() => sseResponse(good + 'event: message_delta\ndata: {broken-json\n\n')]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const err = await captureError(collect(t.stream(baseReq())));
    expect(err).toBeInstanceOf(APIConnectionError);
    expect((err as Error).message).toMatch(/event "message_delta"/);
    expect((err as Error).message).toMatch(/after 1 event\(s\)/);
    expect((err as Error).message).toContain('{broken-json');
  });

  // Gateway-dialect tolerance (2026-07-05 BPT production incident): a
  // translating gateway's /api/anthropic endpoint appends an OpenAI-style
  // `data: [DONE]` terminator after the Anthropic event stream. The official
  // client never trips on it (it stops consuming at message_stop); ours must
  // not either.
  it('trailing `data: [DONE]` after message_stop -> stream completes cleanly (the incident regression)', async () => {
    const events = textReplyEvents('Hello world');
    stubFetch([() => sseResponse(eventsToSse(events) + 'data: [DONE]\n\n')]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const received = await collect(t.stream(baseReq()));
    expect(received).toEqual(events);
  });

  it('anything after message_stop is never parsed: even a corrupt NAMED frame cannot fail the run', async () => {
    // Official-client lifecycle: message_stop is the terminal event of the
    // single streamed message; consumption stops there.
    const events = textReplyEvents('done');
    stubFetch([
      () => sseResponse(eventsToSse(events) + 'event: message_delta\ndata: {broken\n\n'),
    ]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const received = await collect(t.stream(baseReq()));
    expect(received).toEqual(events);
  });

  it('an event-less non-JSON frame BEFORE message_stop is skipped; the stream continues', async () => {
    const events = textReplyEvents('resume');
    const head = eventsToSse(events.slice(0, 2));
    const tail = eventsToSse(events.slice(2));
    stubFetch([() => sseResponse(head + 'data: [DONE]\n\n' + tail)]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const received = await collect(t.stream(baseReq()));
    expect(received).toEqual(events);
  });

  it('per-request timeout during the stream -> APIConnectionError (not AbortError)', async () => {
    stubFetch([
      () =>
        new Response(hangingStream(eventsToSse([{ type: 'ping' }])), {
          status: 200,
        }),
    ]);
    const t = makeTransport({ provider: { apiKey: 'k', timeoutMs: 40 } });
    const { events, error } = await collectWithError(t.stream(baseReq()));
    expect(events).toEqual([{ type: 'ping' }]);
    expect(error).toBeInstanceOf(APIConnectionError);
    expect((error as Error).message).toMatch(/timed out after 40ms/);
  });

  it('idle watchdog: a stalled stream aborts after streamIdleTimeoutMs (before the request timeout)', async () => {
    stubFetch([
      () =>
        new Response(hangingStream(eventsToSse([{ type: 'ping' }])), {
          status: 200,
        }),
    ]);
    // Large whole-request timeout, small idle timeout -> idle fires first.
    const t = makeTransport({
      provider: { apiKey: 'k', timeoutMs: 5_000, streamIdleTimeoutMs: 30 },
    });
    const { events, error } = await collectWithError(t.stream(baseReq()));
    expect(events).toEqual([{ type: 'ping' }]); // the one event before the stall
    expect(error).toBeInstanceOf(APIConnectionError);
    expect((error as Error).message).toMatch(/idle for 30ms/);
  });

  it('streamIdleTimeoutMs: 0 disables the idle watchdog (only the request timeout fires)', async () => {
    stubFetch([
      () =>
        new Response(hangingStream(eventsToSse([{ type: 'ping' }])), {
          status: 200,
        }),
    ]);
    const t = makeTransport({
      provider: { apiKey: 'k', timeoutMs: 40, streamIdleTimeoutMs: 0 },
    });
    const { error } = await collectWithError(t.stream(baseReq()));
    expect(error).toBeInstanceOf(APIConnectionError);
    // idle disabled -> the whole-request timeout is the terminal cause.
    expect((error as Error).message).toMatch(/timed out after 40ms/);
  });
});

// ---------------------------------------------------------------------------
// AnthropicTransport - abort
// ---------------------------------------------------------------------------

describe('AnthropicTransport abort', () => {
  it('an already-aborted caller signal -> AbortError before any fetch', async () => {
    const fetchMock = stubFetch([]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const ac = new AbortController();
    ac.abort();
    const err = await captureError(
      t.stream(baseReq({ signal: ac.signal })).next(),
    );
    expect(err).toBeInstanceOf(AbortError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caller abort mid-stream -> AbortError (no hang)', async () => {
    stubFetch([
      () =>
        new Response(hangingStream(eventsToSse([{ type: 'ping' }])), {
          status: 200,
        }),
    ]);
    const t = makeTransport({ provider: { apiKey: 'k' } });
    const ac = new AbortController();
    const gen = t.stream(baseReq({ signal: ac.signal }));
    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ type: 'ping' });
    const pending = gen.next();
    ac.abort();
    const err = await captureError(pending);
    expect(err).toBeInstanceOf(AbortError);
  });
});
