/**
 * Mutation-kill tests: OpenAI translating transport, batch 8 (T63 batch 2,
 * keeper order 2026-07-20 "立即开打"). Targets the ERROR-CLASSIFICATION cluster
 * that batch 1 could not reach without a transport: extractOpenAIError,
 * statusForOpenAIErrorType, meta, and readOpenAIErrorInfo. Two observation
 * paths:
 *   - IN-STREAM error chunk (HTTP 200 SSE `data: {error:{...}}`, openai.ts
 *     L1389-1403): APIStatusError is built from info.type / info.status /
 *     info.message / info.code / info.requestId DIRECTLY, so every
 *     extractOpenAIError output field is observable here (the non-2xx path
 *     overrides type/status with the status-line normalization, hiding them);
 *   - NON-2xx HTTP body (L1665-1708 -> readOpenAIErrorInfo): JSON envelope vs
 *     bare object vs empty vs non-JSON, driving message / providerErrorCode /
 *     requestId derivation.
 * Behaviour assertions only — no debug-string / backoff-timing mutants (the
 * 2026-07-13 100%-question analysis marks those over-fit).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIChatTransport } from '../src/transport/openai.js';
import { APIStatusError } from '../src/errors.js';
import type { RawMessageStreamEvent } from '../src/types.js';
import type { StreamRequest } from '../src/internal/contracts.js';

const enc = new TextEncoder();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sseOf(lines: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(l));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}
/** A single in-stream error frame (HTTP 200 SSE carrying `{ error }`). */
function errorFrame(error: unknown): Response {
  return sseOf([`data: ${JSON.stringify({ error })}\n\n`]);
}
function makeT(extra: Record<string, unknown> = {}) {
  return new OpenAIChatTransport({
    provider: { protocol: 'openai-chat', apiKey: 'sk-test', maxRetries: 0, ...extra } as never,
    env: { BPT_HTTP_CLIENT: 'fetch' },
    debug: () => undefined,
  });
}
const REQ: StreamRequest = { model: 'gpt-4o', max_tokens: 32, messages: [{ role: 'user', content: 'hi' }] };
async function drainT(gen: AsyncIterable<RawMessageStreamEvent>): Promise<RawMessageStreamEvent[]> {
  const out: RawMessageStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
async function errOf(p: Promise<unknown>): Promise<APIStatusError> {
  try {
    await p;
    throw new Error('expected the stream to throw');
  } catch (e) {
    return e as APIStatusError;
  }
}
const streamErr = async (resp: () => Response): Promise<APIStatusError> => {
  vi.stubGlobal('fetch', vi.fn(async () => resp()));
  return errOf(drainT(makeT().stream(REQ)));
};

// ---------------------------------------------------------------------------
// extractOpenAIError — full field extraction (via the in-stream error path)
// ---------------------------------------------------------------------------

describe('in-stream error: extractOpenAIError field extraction', () => {
  it('lifts type / message / code / requestId from a rich error object', async () => {
    const err = await streamErr(() =>
      errorFrame({ type: 'rate_limit_error', message: 'slow down', code: 'rl_hit', request_id: 'req_42' }),
    );
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err.errorType).toBe('rate_limit_error');
    expect(err.message).toBe('slow down');
    expect(err.providerErrorCode).toBe('rl_hit'); // info.code -> providerErrorCode
    expect(err.requestId).toBe('req_42');
    // No body status -> derived from type via statusForOpenAIErrorType.
    expect(err.status).toBe(429);
  });

  it('a body-provided status WINS over the type-derived one', async () => {
    const err = await streamErr(() => errorFrame({ type: 'invalid_request_error', message: 'm', status: 418 }));
    expect(err.status).toBe(418); // info.status ?? derive -> 418, not 400
  });

  it('a NON-STRING type falls back to api_error (default status 500)', async () => {
    const err = await streamErr(() => errorFrame({ type: 123, message: 'weird' }));
    expect(err.errorType).toBe('api_error');
    expect(err.status).toBe(500);
    expect(err.message).toBe('weird');
  });

  it('a NON-STRING message is JSON-stringified, not dropped', async () => {
    const err = await streamErr(() => errorFrame({ type: 'invalid_request_error', message: { nested: 'x' } }));
    // message = JSON.stringify(error object)
    expect(err.message).toContain('nested');
    expect(err.errorType).toBe('invalid_request_error');
  });

  it('a bare STRING error (parsed.error is a string) -> api_error with String(error) message', async () => {
    const err = await streamErr(() => errorFrame('literal failure text'));
    expect(err.errorType).toBe('api_error');
    expect(err.message).toBe('literal failure text');
    expect(err.status).toBe(500);
  });

  it('an error object WITHOUT a request_id leaves requestId undefined', async () => {
    const err = await streamErr(() => errorFrame({ type: 'not_found_error', message: 'gone' }));
    expect(err.requestId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// statusForOpenAIErrorType — reverse table (type -> status), via in-stream err
// with no body status, so info.status is undefined and the derive path runs.
// ---------------------------------------------------------------------------

describe('statusForOpenAIErrorType reverse table (in-stream, no body status)', () => {
  const cases: Array<[string, number]> = [
    ['rate_limit_error', 429],
    ['rate_limit_exceeded', 429],
    ['insufficient_quota', 429],
    ['requests', 429],
    ['tokens', 429],
    ['invalid_request_error', 400],
    ['invalid_prompt', 400],
    ['authentication_error', 401],
    ['invalid_api_key', 401],
    ['permission_error', 403],
    ['insufficient_permissions', 403],
    ['not_found_error', 404],
    ['overloaded_error', 529],
    ['server_overloaded', 529],
    ['some_unmapped_type', 500],
  ];
  for (const [type, status] of cases) {
    it(`'${type}' -> ${status}`, async () => {
      const err = await streamErr(() => errorFrame({ type, message: 'x' }));
      expect(err.status, type).toBe(status);
    });
  }
});

// ---------------------------------------------------------------------------
// readOpenAIErrorInfo — non-2xx body forms (message / code / requestId / fallback)
// ---------------------------------------------------------------------------

function httpBody(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('non-2xx body: readOpenAIErrorInfo derivation', () => {
  it('JSON { error: {...} } envelope lifts message + providerErrorCode; type normalizes by status', async () => {
    const err = await streamErr(() =>
      httpBody(JSON.stringify({ error: { type: 'ignored_body_type', message: 'body message', code: 'body_code' } }), 400),
    );
    expect(err.status).toBe(400);
    expect(err.errorType).toBe('invalid_request_error'); // normalized by status 400, NOT the body type
    expect(err.message).toBe('body message');
    expect(err.providerErrorCode).toBe('body_code');
  });

  it('an empty body falls back to the "HTTP <status> <statusText>" status line', async () => {
    const err = await streamErr(() => httpBody('', 503));
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/^HTTP 503/);
  });

  it('a non-JSON text body becomes the message verbatim (bounded)', async () => {
    const err = await streamErr(() => httpBody('upstream is on fire', 500));
    expect(err.message).toBe('upstream is on fire');
    expect(err.errorType).toBe('api_error'); // status >= 500 -> api_error
  });

  it('a JSON body WITHOUT an error envelope but with a bare message is surfaced', async () => {
    const err = await streamErr(() => httpBody(JSON.stringify({ message: 'bare top-level', code: 'bare_code' }), 429));
    expect(err.status).toBe(429);
    expect(err.errorType).toBe('rate_limit_error');
    expect(err.message).toBe('bare top-level');
  });

  it('a null error member is not treated as an envelope (falls to bare/text handling)', async () => {
    const err = await streamErr(() => httpBody(JSON.stringify({ error: null, message: 'still surfaced' }), 400));
    // parsed.error === null -> skip envelope; bare { message } path surfaces it.
    expect(err.message).toBe('still surfaced');
  });

  it('reads request-id from the header on a non-2xx (body has none)', async () => {
    const err = await streamErr(() => httpBody(JSON.stringify({ error: { message: 'm' } }), 404, { 'x-request-id': 'hdr_req' }));
    expect(err.requestId).toBe('hdr_req');
  });
});
