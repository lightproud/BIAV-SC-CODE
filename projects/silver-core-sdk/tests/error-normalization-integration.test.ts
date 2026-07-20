/**
 * Integration tests for unified upstream-error normalization (BPT P1, keeper
 * ruling 2026-07-14). Drives the REAL transports over a scripted fetch and the
 * REAL runAgentLoop, asserting the host receives a stable NormalizedProviderError
 * (status / retryable / requestId / readable message) instead of a raw object
 * or a silent empty success.
 *
 * Response shapes exercised (both mandated by the acceptance criteria):
 *   - HTTP 500 application/json  {"error":{"message":...,"code":null,"status":500,"request_id":"test-500"}}
 *   - HTTP 500 text/plain        Internal server error
 *   - HTTP 200 SSE carrying a bare {error:{...}} data frame (the穿透 case)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnthropicTransport } from '../src/transport/anthropic.js';
import { OpenAIChatTransport } from '../src/transport/openai.js';
import { APIStatusError } from '../src/errors.js';
import { runAgentLoop } from '../src/engine/loop.js';
import type { StreamRequest, Transport, EngineConfig, EngineDeps } from '../src/internal/contracts.js';
import type { SDKMessage, SDKResultMessage } from '../src/types.js';
import { FakeMcp, FakeGate, FakeHookRunner } from './helpers/engine-fakes.js';

// ---------------------------------------------------------------------------
// Fetch stubs
// ---------------------------------------------------------------------------

/** A non-streaming error Response (status + body + optional headers). */
function errorResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, statusText: `HTTP ${status}`, headers });
}

/** A 200 Response whose SSE body is the exact `frames` string. */
function sseResponse(frames: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const JSON_500 =
  '{"error":{"message":"Internal server error","code":null,"status":500,"request_id":"test-500"}}';

// ---------------------------------------------------------------------------
// Transport-level extraction
// ---------------------------------------------------------------------------

describe('AnthropicTransport error extraction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function drain(t: Transport): Promise<void> {
    for await (const _ of t.stream({
      model: 'claude-x',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    } as StreamRequest)) {
      // no-op
    }
  }

  function transport(): AnthropicTransport {
    return new AnthropicTransport({
      provider: { apiKey: 'k', maxRetries: 0 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: () => {},
    });
  }

  it('HTTP 500 JSON { error: { message, status, request_id } } -> APIStatusError(500) with body request_id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(500, JSON_500)));
    const err = await drain(transport()).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(APIStatusError);
    expect((err as APIStatusError).status).toBe(500);
    expect((err as APIStatusError).message).toBe('Internal server error');
    expect((err as APIStatusError).requestId).toBe('test-500');
  });

  it('non-JSON text/plain HTTP 500 -> a readable message (never [object Object])', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(500, 'Internal server error', { 'content-type': 'text/plain' })),
    );
    const err = (await drain(transport()).catch((e) => e)) as APIStatusError;
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err.status).toBe(500);
    expect(err.message).toBe('Internal server error');
    expect(err.message).not.toContain('[object Object]');
  });

  it('prefers the x-request-id header over the body when present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(500, JSON_500, { 'request-id': 'hdr-500' })),
    );
    const err = (await drain(transport()).catch((e) => e)) as APIStatusError;
    expect(err.requestId).toBe('hdr-500');
  });

  it('the穿透 case: a bare {error:{...}} SSE data frame (no type:error) is caught as an error', async () => {
    // HTTP 200 whose SSE body carries a gateway error object with NO
    // `event: error` name and NO top-level `type:'error'` — the exact shape that
    // used to slip past detection and穿透 to the host.
    const frames = `data: ${JSON_500}\n\n`;
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames)));
    const err = (await drain(transport()).catch((e) => e)) as APIStatusError;
    expect(err).toBeInstanceOf(APIStatusError);
    // status comes from the body (an in-stream error carries no HTTP status).
    expect(err.status).toBe(500);
    expect(err.message).toBe('Internal server error');
    expect(err.requestId).toBe('test-500');
  });

  it('an SSE event:error frame keeps the error text and request id', async () => {
    const frames =
      `event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded","request_id":"rid-x"}}\n\n`;
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames)));
    const err = (await drain(transport()).catch((e) => e)) as APIStatusError;
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err.message).toBe('Overloaded');
    expect(err.requestId).toBe('rid-x');
    expect(err.errorType).toBe('overloaded_error');
  });
});

describe('OpenAIChatTransport error extraction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function transport(): OpenAIChatTransport {
    return new OpenAIChatTransport({
      provider: { protocol: 'openai-chat', apiKey: 'sk-test', maxRetries: 0 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: () => {},
    });
  }

  async function drain(t: Transport): Promise<void> {
    for await (const _ of t.stream({
      model: 'gpt-x',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    } as StreamRequest)) {
      // no-op
    }
  }

  it('HTTP 500 JSON error -> APIStatusError(500) with a readable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(500, JSON_500)));
    const err = (await drain(transport()).catch((e) => e)) as APIStatusError;
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err.status).toBe(500);
    expect(err.message).toBe('Internal server error');
    expect(err.requestId).toBe('test-500');
  });

  it('non-JSON text/plain HTTP 500 -> a readable message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(500, 'Internal server error', { 'content-type': 'text/plain' })),
    );
    const err = (await drain(transport()).catch((e) => e)) as APIStatusError;
    expect(err.status).toBe(500);
    expect(err.message).toBe('Internal server error');
    expect(err.message).not.toContain('[object Object]');
  });
});

// ---------------------------------------------------------------------------
// End-to-end: the host receives a NormalizedProviderError, not a raw object
// ---------------------------------------------------------------------------

function makeDeps(transport: Transport): EngineDeps {
  return {
    transport,
    builtinTools: new Map(),
    mcp: new FakeMcp(),
    permissions: new FakeGate(),
    hooks: new FakeHookRunner(),
    toolContext: {
      cwd: '/tmp/err-test',
      additionalDirectories: [],
      env: { BPT_HTTP_CLIENT: 'fetch' },
      signal: new AbortController().signal,
      debug: () => {},
    },
    debug: () => {},
  };
}

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-x',
    providerLabel: 'anthropic',
    maxOutputTokens: 1024,
    systemPrompt: 'You are a test agent.',
    includePartialMessages: false,
    sessionId: 'sess-err',
    cwd: '/tmp/err-test',
    ...overrides,
  };
}

async function collect(gen: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of gen) out.push(m);
  return out;
}

describe('runAgentLoop surfaces a NormalizedProviderError for HTTP 500', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function transport(): AnthropicTransport {
    return new AnthropicTransport({
      provider: { apiKey: 'k', maxRetries: 0 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: () => {},
    });
  }

  it('JSON 500 -> error result with providerError {status:500, retryable, requestId, readable}', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(500, JSON_500)));
    const messages = await collect(
      runAgentLoop([{ role: 'user', content: 'hi' }], makeDeps(transport()), makeConfig()),
    );
    const result = messages[messages.length - 1] as SDKResultMessage;
    expect(result.type).toBe('result');
    expect(result.subtype).toBe('error_during_execution');
    expect(result.is_error).toBe(true);
    // The run is NOT a silent empty success.
    expect(messages.some((m) => m.type === 'result' && m.subtype === 'success')).toBe(false);
    expect(result.api_error_status).toBe(500);
    const pe = result.providerError;
    expect(pe).toBeDefined();
    expect(pe!.status).toBe(500);
    expect(pe!.retryable).toBe(true);
    expect(pe!.requestId).toBe('test-500');
    expect(pe!.message).toBe('Internal server error');
    expect(pe!.provider).toBe('anthropic');
    expect(pe!.model).toBe('claude-x');
    expect(pe!.message).not.toContain('[object Object]');
  });

  it('non-JSON text/plain 500 -> error result with a readable providerError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(500, 'Internal server error', { 'content-type': 'text/plain' })),
    );
    const messages = await collect(
      runAgentLoop([{ role: 'user', content: 'hi' }], makeDeps(transport()), makeConfig()),
    );
    const result = messages[messages.length - 1] as SDKResultMessage;
    expect(result.subtype).toBe('error_during_execution');
    const pe = result.providerError;
    expect(pe!.status).toBe(500);
    expect(pe!.retryable).toBe(true);
    expect(pe!.message).toBe('Internal server error');
  });

  it('the穿透 case end-to-end: a bare {error} SSE frame does not become an empty success', async () => {
    const frames = `data: ${JSON_500}\n\n`;
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames)));
    const messages = await collect(
      runAgentLoop([{ role: 'user', content: 'hi' }], makeDeps(transport()), makeConfig()),
    );
    const result = messages[messages.length - 1] as SDKResultMessage;
    expect(result.subtype).toBe('error_during_execution');
    expect(messages.some((m) => m.type === 'result' && m.subtype === 'success')).toBe(false);
    expect(result.providerError!.status).toBe(500);
    expect(result.providerError!.message).toBe('Internal server error');
  });

  it('a retried 503 emits an api_retry carrying a retryable providerError', async () => {
    // maxRetries 1: first 503 retries, second attempt succeeds via a normal SSE.
    const okFrames =
      `event: message_start\ndata: {"type":"message_start","message":{"id":"m","type":"message","role":"assistant","model":"claude-x","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n` +
      `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n` +
      `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n` +
      `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n` +
      `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\n` +
      `event: message_stop\ndata: {"type":"message_stop"}\n\n`;
    let call = 0;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchFn = vi.fn(async () => {
      call += 1;
      return call === 1
        ? errorResponse(503, '{"error":{"message":"Service Unavailable","code":"overloaded","status":503}}')
        : sseResponse(okFrames);
    });
    vi.stubGlobal('fetch', fetchFn);
    const t = new AnthropicTransport({
      provider: { apiKey: 'k', maxRetries: 1 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: () => {},
    });
    const messages = await collect(
      runAgentLoop([{ role: 'user', content: 'hi' }], makeDeps(t), makeConfig()),
    );
    const result = messages[messages.length - 1] as SDKResultMessage;
    expect(result.subtype).toBe('success');
    const retry = messages.find((m) => m.type === 'api_retry');
    expect(retry).toBeDefined();
    const r = retry as Extract<SDKMessage, { type: 'api_retry' }>;
    expect(r.retryable).toBe(true);
    expect(r.status).toBe(503);
    expect(r.providerError).toBeDefined();
    expect(r.providerError!.retryable).toBe(true);
    expect(r.providerError!.status).toBe(503);
    expect(r.providerError!.code).toBe('overloaded');
  });
});
