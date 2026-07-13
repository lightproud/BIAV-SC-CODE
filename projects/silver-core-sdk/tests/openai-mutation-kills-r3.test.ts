/**
 * Mutation-kill tests: OpenAI translating transport, batch 4 (T39 round-3
 * survivor triage; 74.10% after batches 1-3). Targets the HTTP error-path
 * cluster: the full status-classification table, readOpenAIErrorInfo body
 * shapes, extractOpenAIError fallbacks, retry-exhaustion semantics, and the
 * retryable-status mirror of the Anthropic arm.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIChatTransport } from '../src/transport/openai.js';
import { APIConnectionError, APIStatusError } from '../src/errors.js';
import type { StreamRequest } from '../src/internal/contracts.js';
import type { RawMessageStreamEvent } from '../src/types.js';

const enc = new TextEncoder();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
function okLines(): string[] {
  return [
    `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' } }] })}\n\n`,
    `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
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
async function errOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e;
  }
}

describe('in-stream error classification: the remaining case labels', () => {
  it('every mapped error type lands on its documented status', async () => {
    const cases: Array<[string, number]> = [
      ['rate_limit_error', 429],
      ['rate_limit_exceeded', 429],
      ['requests', 429],
      ['tokens', 429],
      ['invalid_request_error', 400],
      ['authentication_error', 401],
      ['permission_error', 403],
      ['not_found_error', 404],
      ['overloaded_error', 529],
    ];
    for (const [type, status] of cases) {
      const lines = [
        `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' } }] })}\n\n`,
        `data: ${JSON.stringify({ error: { type, message: 'm' } })}\n\n`,
      ];
      vi.stubGlobal('fetch', vi.fn(async () => sseOf(lines)));
      const err = await errOf(drainT(makeT().stream(REQ)));
      expect(err, type).toBeInstanceOf(APIStatusError);
      expect((err as APIStatusError).status, type).toBe(status);
      vi.unstubAllGlobals();
    }
  });
});

describe('HTTP error-body reading (readOpenAIErrorInfo shapes)', () => {
  function httpError(status: number, body: string | null, statusText = 'Nope'): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        body === null
          ? new Response(null, { status, statusText })
          : new Response(body, { status, statusText, headers: { 'content-type': 'application/json' } }),
      ),
    );
  }

  it('an unmapped sub-500 status normalizes to invalid_request_error; 5xx to api_error', async () => {
    httpError(418, JSON.stringify({ error: { type: 'weird', message: 'teapot' } }));
    const e1 = (await errOf(drainT(makeT().stream(REQ)))) as APIStatusError;
    expect(e1.errorType).toBe('invalid_request_error');
    expect(e1.message).toBe('teapot');
    vi.unstubAllGlobals();

    httpError(503, JSON.stringify({ error: { type: 'weird', message: 'down' } }));
    const e2 = (await errOf(drainT(makeT().stream(REQ)))) as APIStatusError;
    expect(e2.errorType).toBe('api_error');
    expect(e2.message).toBe('down');
  });

  it('a STRING error member falls back to String(error) as the message', async () => {
    httpError(400, JSON.stringify({ error: 'plain words' }));
    const e = (await errOf(drainT(makeT().stream(REQ)))) as APIStatusError;
    expect(e.message).toBe('plain words');
  });

  it('an error object with non-string message stringifies the object', async () => {
    httpError(400, JSON.stringify({ error: { type: 1, message: 2 } }));
    const e = (await errOf(drainT(makeT().stream(REQ)))) as APIStatusError;
    expect(e.message).toBe(JSON.stringify({ type: 1, message: 2 }));
  });

  it('a non-JSON body is passed through raw; an empty body names the HTTP status line', async () => {
    httpError(400, 'gateway melted');
    const e1 = (await errOf(drainT(makeT().stream(REQ)))) as APIStatusError;
    expect(e1.message).toBe('gateway melted');
    vi.unstubAllGlobals();

    httpError(404, null, 'Not Found');
    const e2 = (await errOf(drainT(makeT().stream(REQ)))) as APIStatusError;
    expect(e2.status).toBe(404);
    expect(e2.message).toBe('HTTP 404 Not Found');
  });
});

describe('retry arithmetic and retryable statuses (twin of the Anthropic arm)', () => {
  it('exhausted network retries throw Failed-to-reach after exactly maxRetries+1 attempts', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        throw new Error('ECONNRESET');
      }),
    );
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const err = await errOf(drainT(makeT({ maxRetries: 1 }).stream(REQ)));
    expect(err).toBeInstanceOf(APIConnectionError);
    expect((err as Error).message).toContain('Failed to reach');
    expect(calls).toBe(2); // one original + exactly one retry, then exhaustion
  });

  it('HTTP 500 and 408 are retried; 404 is terminal on the first call', async () => {
    const errResp = (status: number) =>
      new Response(JSON.stringify({ error: { type: 'x', message: 'm' } }), {
        status,
        headers: { 'retry-after': '0' },
      });
    for (const status of [500, 408]) {
      let calls = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          calls += 1;
          return calls === 1 ? errResp(status) : sseOf(okLines());
        }),
      );
      const events = await drainT(makeT({ maxRetries: 1 }).stream(REQ));
      expect(events.at(-1)?.type, String(status)).toBe('message_stop');
      expect(calls, String(status)).toBe(2);
      vi.unstubAllGlobals();
    }
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return errResp(404);
      }),
    );
    const err = (await errOf(drainT(makeT({ maxRetries: 2 }).stream(REQ)))) as APIStatusError;
    expect(err.status).toBe(404);
    expect(calls).toBe(1);
  });
});
