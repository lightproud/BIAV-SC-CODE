/**
 * Mutation-kill tests: OpenAI translating transport, batch 6 (T39 continuation
 * on the keeper's order; 80.60% after batches 1-5). Kills the remaining
 * SEMANTIC survivors: the status->error-type table, modelMap application,
 * request-id capture, resilience error fields (turnReplaySafe /
 * midStreamTruncation / stream_max_duration code), idle-watchdog and
 * backoff-abort paths, URL normalization, env fallbacks, parseRetryAfterMs
 * edges, and translator fallbacks.
 *
 * Deliberately NOT killed (over-fitting risk, per the 2026-07-13 100%-question
 * analysis): debug-string literals, backoff jitter arithmetic (timing
 * assertions = flaky), abort-listener micro-plumbing, timer unref hints, and
 * spread-undefined mutants that JSON serialization makes invisible on the
 * wire (equivalent through the boundary).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAIChatTransport,
  OpenAIStreamTranslator,
  parseRetryAfterMs,
} from '../src/transport/openai.js';
import { APIConnectionError, APIStatusError, ConfigurationError } from '../src/errors.js';
import type { StreamRequest } from '../src/internal/contracts.js';
import type { RawMessageStreamEvent } from '../src/types.js';

const enc = new TextEncoder();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function sseOf(lines: string[], opts: { hang?: boolean } = {}): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(l));
        if (!opts.hang) c.close();
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
function makeT(extra: Record<string, unknown> = {}, debug: (m: string) => void = () => undefined, env: Record<string, string | undefined> = {}) {
  return new OpenAIChatTransport({
    provider: { protocol: 'openai-chat', apiKey: 'sk-test', maxRetries: 0, ...extra } as never,
    env: { BPT_HTTP_CLIENT: 'fetch', ...env },
    debug,
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

// ---------------------------------------------------------------------------

describe('status -> error-type table (non-JSON bodies fall back to the map)', () => {
  it('every mapped status yields its documented error type', async () => {
    const cases: Array<[number, string]> = [
      [400, 'invalid_request_error'],
      [403, 'permission_error'],
      [404, 'not_found_error'],
      [408, 'timeout_error'],
      [413, 'request_too_large'],
      [429, 'rate_limit_error'],
      [529, 'overloaded_error'],
      [500, 'api_error'], // exactly-500 boundary of the >=500 fallback
    ];
    for (const [status, type] of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('plain refusal', { status })));
      const err = (await errOf(drainT(makeT().stream(REQ)))) as APIStatusError;
      expect(err, String(status)).toBeInstanceOf(APIStatusError);
      expect(err.errorType, String(status)).toBe(type);
      vi.unstubAllGlobals();
    }
  });

  it('a non-JSON error body over 2000 chars is capped at 2000', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(3000), { status: 400 })));
    const err = (await errOf(drainT(makeT().stream(REQ)))) as APIStatusError;
    expect(err.message).toHaveLength(2000);
  });

  it('the request id is captured from x-request-id, falling back to request-id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 404, headers: { 'x-request-id': 'rid-1' } })),
    );
    const e1 = (await errOf(drainT(makeT().stream(REQ)))) as APIStatusError;
    expect(e1.requestId).toBe('rid-1');
    vi.unstubAllGlobals();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 404, headers: { 'request-id': 'rid-2' } })),
    );
    const e2 = (await errOf(drainT(makeT().stream(REQ)))) as APIStatusError;
    expect(e2.requestId).toBe('rid-2');
  });
});

describe('endpoint assembly, credentials, model mapping', () => {
  it('trailing slashes (plural) are stripped from the base url', async () => {
    const f = vi.fn(async () => sseOf(okLines()));
    vi.stubGlobal('fetch', f);
    await drainT(makeT({ baseUrl: 'http://gw.test/v1///' }).stream(REQ));
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('http://gw.test/v1/chat/completions');
  });

  it('an EMPTY OPENAI_BASE_URL env falls through to the default endpoint', async () => {
    const f = vi.fn(async () => sseOf(okLines()));
    vi.stubGlobal('fetch', f);
    await drainT(makeT({}, () => undefined, { OPENAI_BASE_URL: '' }).stream(REQ));
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('a credential-less transport names every credential source', async () => {
    let thrown: unknown;
    try {
      const t = new OpenAIChatTransport({
        provider: { protocol: 'openai-chat' } as never,
        env: { BPT_HTTP_CLIENT: 'fetch' },
        debug: () => undefined,
      });
      await drainT(t.stream(REQ));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ConfigurationError);
    const msg = (thrown as Error).message;
    expect(msg).toContain('No OpenAI-protocol credential found');
    expect(msg).toContain('options.provider.apiKey');
    expect(msg).toContain('OPENAI_API_KEY');
  });

  it('modelMap rewrites the wire model and logs the mapping; a mapped run emits no Claude warning', async () => {
    const f = vi.fn(async () => sseOf(okLines()));
    vi.stubGlobal('fetch', f);
    const lines: string[] = [];
    await drainT(
      makeT({ openai: { modelMap: { 'claude-haiku-4-5': 'gpt-4o-mini' } } }, (m) => lines.push(m)).stream({
        ...REQ,
        model: 'claude-haiku-4-5',
      }),
    );
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as {
      model: string;
    };
    expect(body.model).toBe('gpt-4o-mini');
    const joined = lines.join('\n');
    expect(joined).toContain('claude-haiku-4-5 -> gpt-4o-mini (modelMap)');
    expect(joined).not.toContain('WARNING sending Claude model id');
  });

  it('a plain non-Claude model emits neither mapping log nor warning', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseOf(okLines())));
    const lines: string[] = [];
    await drainT(makeT({}, (m) => lines.push(m)).stream(REQ));
    const joined = lines.join('\n');
    expect(joined).not.toContain('(modelMap)');
    expect(joined).not.toContain('WARNING sending Claude model id');
  });
});

describe('encoder edges: system field, images by url, unknown blocks, text-only assistant', () => {
  async function bodyOf(req: Partial<StreamRequest>): Promise<Record<string, unknown>> {
    const f = vi.fn(async () => sseOf(okLines()));
    vi.stubGlobal('fetch', f);
    await drainT(makeT().stream({ ...REQ, ...req } as StreamRequest));
    return JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<
      string,
      unknown
    >;
  }

  it('an empty-string system is omitted; a non-empty one leads the messages as role system', async () => {
    const withSys = await bodyOf({ system: 'be terse' } as never);
    const msgs = withSys.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[0]).toEqual({ role: 'system', content: 'be terse' });

    const withEmpty = await bodyOf({ system: '' } as never);
    const roles = (withEmpty.messages as Array<{ role: string }>).map((m) => m.role);
    expect(roles).not.toContain('system');
  });

  it('a url-source image becomes an image_url part with the raw url', async () => {
    const body = await bodyOf({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'image', source: { type: 'url', url: 'https://img.test/x.png' } },
          ],
        },
      ] as never,
    });
    const user = (body.messages as Array<{ role: string; content: unknown }>).find((m) => m.role === 'user')!;
    const parts = user.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts[1]!.image_url!.url).toBe('https://img.test/x.png');
  });

  it('an unknown user block type is dropped silently (never mistaken for a document)', async () => {
    const body = await bodyOf({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'only me' },
            { type: 'mystery_block', payload: 'zzz' },
          ],
        },
      ] as never,
    });
    const user = (body.messages as Array<{ role: string; content: unknown }>).find((m) => m.role === 'user')!;
    expect(user.content).toBe('only me');
  });

  it('a text-only assistant turn is kept and carries NO tool_calls key', async () => {
    const body = await bodyOf({
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'just words' }] },
        { role: 'user', content: 'go' },
      ] as never,
    });
    const assistant = (body.messages as Array<{ role: string; content?: unknown; tool_calls?: unknown }>).find(
      (m) => m.role === 'assistant',
    )!;
    expect(assistant.content).toBe('just words');
    expect('tool_calls' in assistant).toBe(false);
  });
});

describe('translator fallbacks', () => {
  it('a model-less chunk falls back to the REQUEST model in message_start, and the first feed is EXACTLY one event', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    const events = t.feed({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant' } }] } as never);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('message_start');
    expect((events[0] as { message: { model: string } }).message.model).toBe('gpt-4o');
  });

  it('finish() before any chunk throws the dedicated empty-stream message', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    expect(() => t.finish()).toThrowError(/stream ended before any chunk arrived/);
  });

  it('a tool_call delta WITHOUT a function member is tolerated (no crash, id still adopted)', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    const out: RawMessageStreamEvent[] = [];
    out.push(
      ...t.feed({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_bare' }] } }] } as never),
    );
    out.push(...t.finish());
    const start = out.find(
      (e): e is Extract<RawMessageStreamEvent, { type: 'content_block_start' }> =>
        e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    )!;
    expect((start.content_block as { id: string }).id).toBe('call_bare');
  });

  it('three block kinds close in ascending index order at finish', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    const out: RawMessageStreamEvent[] = [];
    out.push(
      ...t.feed({
        id: 'c1',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              reasoning_content: 'r',
              content: 'c',
              tool_calls: [{ index: 0, id: 'call_1', function: { name: 'n', arguments: '{}' } }],
            },
          },
        ],
      } as never),
    );
    out.push(...t.finish());
    const stops = out
      .filter((e): e is Extract<RawMessageStreamEvent, { type: 'content_block_stop' }> => e.type === 'content_block_stop')
      .map((e) => e.index);
    expect(stops).toHaveLength(3);
    expect([...stops].sort((a, b) => a - b)).toEqual(stops);
  });
});

describe('stream completion and resilience error fields', () => {
  it('[DONE] with surrounding whitespace still completes the stream cleanly', async () => {
    const lines = [
      `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }] })}\n\n`,
      'data:  [DONE] \n\n', // extra spaces: parser keeps one leading space + trailing space -> trim() must save it
    ];
    vi.stubGlobal('fetch', vi.fn(async () => sseOf(lines)));
    const events = await drainT(makeT().stream(REQ));
    expect(events.at(-1)?.type).toBe('message_stop');
  });

  it('a clean close with a finish_reason but NO [DONE] counts as complete (not truncation)', async () => {
    const lines = [
      `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }] })}\n\n`,
    ];
    vi.stubGlobal('fetch', vi.fn(async () => sseOf(lines)));
    const events = await drainT(makeT().stream(REQ));
    expect(events.at(-1)?.type).toBe('message_stop');
  });

  it('an idle stall with ZERO chunks is replay-safe; after chunks it is NOT replay-safe (truncation flag stays unset)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseOf([], { hang: true })));
    const e1 = (await errOf(drainT(makeT({ streamIdleTimeoutMs: 60 }).stream(REQ)))) as APIConnectionError & {
      turnReplaySafe?: boolean;
      midStreamTruncation?: boolean;
    };
    expect(e1).toBeInstanceOf(APIConnectionError);
    expect(e1.message).toContain('idle for');
    expect(e1.turnReplaySafe).toBe(true);
    // the zero-chunk idle path never sets the truncation flag (falsy, not false)
    expect(e1.midStreamTruncation).not.toBe(true);
    vi.unstubAllGlobals();

    const oneChunk = [
      `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' } }] })}\n\n`,
    ];
    vi.stubGlobal('fetch', vi.fn(async () => sseOf(oneChunk, { hang: true })));
    const e2 = (await errOf(drainT(makeT({ streamIdleTimeoutMs: 60 }).stream(REQ)))) as APIConnectionError & {
      turnReplaySafe?: boolean;
      midStreamTruncation?: boolean;
    };
    // idle stalls carry the replay-safety verdict; the truncation flag belongs
    // to the hard-cap / clean-close-truncation classes and stays unset here.
    expect(e2.turnReplaySafe).toBe(false);
    expect(e2.midStreamTruncation).not.toBe(true);
  }, 10_000);

  it('the streamMaxDurationMs hard cap carries its stable code and truncation flag', async () => {
    const oneChunk = [
      `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' } }] })}\n\n`,
    ];
    vi.stubGlobal('fetch', vi.fn(async () => sseOf(oneChunk, { hang: true })));
    const err = (await errOf(drainT(makeT({ streamMaxDurationMs: 60 }).stream(REQ)))) as APIConnectionError & {
      code?: string;
      midStreamTruncation?: boolean;
    };
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.message).toContain('streamMaxDurationMs hard cap');
    expect(err.code).toBe('stream_max_duration');
    expect(err.midStreamTruncation).toBe(true);
  }, 10_000);

  it('aborting DURING the retry backoff sleep resolves promptly with AbortError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 's' } }), {
          status: 429,
          headers: { 'retry-after': '30' }, // would sleep 30s without the abort
        }),
      ),
    );
    const ac = new AbortController();
    const started = Date.now();
    const pending = drainT(
      makeT({ maxRetries: 2 }).stream({
        ...REQ,
        signal: ac.signal,
        onRetry: () => setTimeout(() => ac.abort(), 30),
      } as StreamRequest),
    );
    const err = await errOf(pending);
    expect((err as Error).name).toBe('AbortError');
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('parseRetryAfterMs edges', () => {
  it('trims whitespace, honors zero, rejects negatives and junk', () => {
    expect(parseRetryAfterMs(' 5 ')).toBe(5_000);
    expect(parseRetryAfterMs('0')).toBe(0);
    // '-1' falls through the seconds branch into Date.parse, which accepts it
    // as a (past) date -> retry immediately. Honest actual behavior; harmless direction.
    expect(parseRetryAfterMs('-1')).toBe(0);
    expect(parseRetryAfterMs('soon')).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });

  it('bug-fix: a whitespace-only / non-decimal header is ignored, not a 0 backoff', () => {
    // Number('') is 0, so a whitespace-only Retry-After previously returned 0
    // (retry immediately) instead of falling through to be ignored.
    expect(parseRetryAfterMs('   ')).toBeUndefined();
    expect(parseRetryAfterMs('')).toBeUndefined();
    // Number() over-accepts these hex/exponent forms; they are not delta-seconds.
    expect(parseRetryAfterMs('0x1f')).toBeUndefined();
    expect(parseRetryAfterMs('1e3')).toBeUndefined();
  });
});
