/**
 * Mutation-kill tests: OpenAI translating transport, batch 3 (T39 round-2
 * survivor triage; 69.01% after batches 1-2). Targets the remaining
 * NO-COVERAGE clusters: encoder leftovers (string assistant turns, document
 * parts in plain user content, title-less PDF labels), translator state
 * (hasStarted, id-less chunks, index-less+id-less tool calls), and the
 * transport request path (preconnect, concurrency semaphore, Claude-model
 * warning, null body, malformed SSE payload, hard cap, network retry).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIChatTransport, OpenAIStreamTranslator } from '../src/transport/openai.js';
import { APIConnectionError, AbortError } from '../src/errors.js';
import type { StreamRequest } from '../src/internal/contracts.js';
import type { RawMessageStreamEvent } from '../src/types.js';

const enc = new TextEncoder();
afterEach(() => {
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
function makeT(extra: Record<string, unknown> = {}, debug: (m: string) => void = () => undefined) {
  return new OpenAIChatTransport({
    provider: { protocol: 'openai-chat', apiKey: 'sk-test', maxRetries: 0, ...extra } as never,
    env: { BPT_HTTP_CLIENT: 'fetch' },
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
async function bodyOf(req: Partial<StreamRequest>): Promise<Record<string, unknown>> {
  const f = vi.fn(async () => sseOf(okLines()));
  vi.stubGlobal('fetch', f);
  await drainT(makeT().stream({ ...REQ, ...req } as StreamRequest));
  const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('encoder leftovers (round-2 NC)', () => {
  it('a string-content ASSISTANT turn encodes as a plain assistant message', async () => {
    const body = await bodyOf({
      messages: [
        { role: 'assistant', content: 'previous words' },
        { role: 'user', content: 'go' },
      ],
    });
    const msgs = body.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[0]).toEqual({ role: 'assistant', content: 'previous words' });
  });

  it('a document part in PLAIN user content flattens to its text fallback', async () => {
    const body = await bodyOf({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'see attached' },
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'aGk=' } },
          ],
        },
      ] as never,
    });
    const user = (body.messages as Array<{ role: string; content: unknown }>).find((m) => m.role === 'user')!;
    // all parts are text -> joined string; the title-less PDF gets the 'PDF' label
    expect(user.content).toBe('see attached\n[document "PDF" omitted: no Chat Completions equivalent]');
  });
});

describe('translator state leftovers (round-2 NC)', () => {
  it('hasStarted() flips once the first chunk is fed', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    expect(t.hasStarted()).toBe(false);
    t.feed({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' } }] } as never);
    expect(t.hasStarted()).toBe(true);
  });

  it('an id-less first chunk synthesizes the chatcmpl-unknown message id', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    const events = t.feed({ choices: [{ index: 0, delta: { role: 'assistant', content: 'x' } }] } as never);
    const start = events.find((e) => e.type === 'message_start') as { message: { id: string } };
    expect(start.message.id).toBe('chatcmpl-unknown');
  });

  it('a tool call with NEITHER index NOR id lands on the last-resort key and still flushes', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    const out: RawMessageStreamEvent[] = [];
    out.push(
      ...t.feed({
        id: 'c1',
        choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ function: { name: 'anon', arguments: '{"k":1}' } }] } }],
      } as never),
    );
    out.push(...t.finish());
    const start = out.find(
      (e): e is Extract<RawMessageStreamEvent, { type: 'content_block_start' }> =>
        e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    )!;
    expect((start.content_block as { name: string }).name).toBe('anon');
    expect((start.content_block as { id: string }).id).toMatch(/^call_/);
  });
});

describe('transport request-path leftovers (round-2 NC)', () => {
  it('preconnect: construction fires a HEAD at the endpoint through the injected fetch', async () => {
    const seen: Array<{ url: string; method?: string }> = [];
    const fetchFn = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      seen.push({ url: String(url), method: init?.method });
      return new Response(null, { status: 405 });
    };
    const lines: string[] = [];
    makeT({ preconnect: true, fetch: fetchFn }, (m) => lines.push(m));
    await vi.waitFor(() => {
      expect(seen.some((s) => s.method === 'HEAD' && s.url.endsWith('/chat/completions'))).toBe(true);
      expect(lines.join('\n')).toContain('preconnect completed (HTTP 405)');
    });
  });

  it('the concurrency semaphore serializes but completes concurrent streams', async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return sseOf(okLines());
      }),
    );
    const t = makeT({ maxConcurrentRequests: 1 });
    const [a, b] = await Promise.all([drainT(t.stream(REQ)), drainT(t.stream(REQ))]);
    expect(a.at(-1)?.type).toBe('message_stop');
    expect(b.at(-1)?.type).toBe('message_stop');
    expect(peak).toBe(1);
  });

  it('sending a Claude model id to an OpenAI endpoint logs the modelMap warning', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseOf(okLines())));
    const lines: string[] = [];
    await drainT(makeT({}, (m) => lines.push(m)).stream({ ...REQ, model: 'claude-sonnet-5' }));
    const joined = lines.join('\n');
    expect(joined).toContain('WARNING sending Claude model id "claude-sonnet-5"');
    expect(joined).toContain('provider.openai.modelMap');
  });

  it('an HTTP 200 with a NULL body raises the dedicated no-body error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    const err = await errOf(drainT(makeT().stream(REQ)));
    expect(err).toBeInstanceOf(APIConnectionError);
    expect((err as Error).message).toContain('Chat Completions response has no body');
  });

  it('a malformed SSE payload raises sse_malformed_frame with the offending prefix', async () => {
    const lines = [
      `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' } }] })}\n\n`,
      'data: {not json at all\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => sseOf(lines)));
    const err = await errOf(drainT(makeT().stream(REQ)));
    expect(err).toBeInstanceOf(APIConnectionError);
    expect((err as Error).message).toContain('Malformed Chat Completions SSE payload after 1 chunk(s)');
    expect((err as Error).message).toContain('{not json at all');
  });

  it('streamMaxDurationMs hard-caps a stream that never ends', async () => {
    const lines = [
      `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' } }] })}\n\n`,
    ];
    vi.stubGlobal('fetch', vi.fn(async () => sseOf(lines, { hang: true })));
    const err = await errOf(drainT(makeT({ streamMaxDurationMs: 60 }).stream(REQ)));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AbortError);
  }, 10_000);

  it('a request-phase network error retries and heals; a caller abort mid-throw wins', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error('ECONNRESET');
        return sseOf(okLines());
      }),
    );
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const retries: Array<{ kind?: string }> = [];
    const events = await drainT(
      makeT({ maxRetries: 1 }).stream({ ...REQ, onRetry: (i) => retries.push(i) } as StreamRequest),
    );
    expect(events.at(-1)?.type).toBe('message_stop');
    expect(calls).toBe(2);
    expect(retries[0]?.kind).toBe('network');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    const ac = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        ac.abort();
        throw new Error('socket hang up');
      }),
    );
    const err = await errOf(
      drainT(makeT({ maxRetries: 3 }).stream({ ...REQ, signal: ac.signal } as StreamRequest)),
    );
    expect((err as Error).name).toBe('AbortError');
  });
});
