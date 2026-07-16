/**
 * Mutation-kill tests: OpenAI translating transport, batch 2 (T39) - the
 * DECODER side. Drives the exported OpenAIStreamTranslator state machine
 * (pure, no I/O) plus the in-stream error classification and
 * stream_options suppression seams the idealab gateway path leans on.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIStreamTranslator, OpenAIChatTransport } from '../src/transport/openai.js';
import { APIStatusError } from '../src/errors.js';
import type { RawMessageStreamEvent } from '../src/types.js';
import type { StreamRequest } from '../src/internal/contracts.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

type Chunk = Record<string, unknown>;
function feedAll(chunks: Chunk[]): RawMessageStreamEvent[] {
  const t = new OpenAIStreamTranslator('gpt-4o');
  const out: RawMessageStreamEvent[] = [];
  for (const c of chunks) out.push(...t.feed(c as never));
  out.push(...t.finish());
  return out;
}
const toolUses = (events: RawMessageStreamEvent[]) =>
  events
    .filter((e): e is Extract<RawMessageStreamEvent, { type: 'content_block_start' }> => e.type === 'content_block_start')
    .map((e) => e.content_block)
    .filter((b): b is { type: 'tool_use'; id: string; name: string; input: unknown } => b.type === 'tool_use');
const argsFor = (events: RawMessageStreamEvent[], index: number) =>
  events
    .filter(
      (e): e is Extract<RawMessageStreamEvent, { type: 'content_block_delta' }> =>
        e.type === 'content_block_delta' && e.index === index && e.delta.type === 'input_json_delta',
    )
    .map((e) => (e.delta as { partial_json: string }).partial_json)
    .join('');

describe('OpenAIStreamTranslator: tool_calls assembly', () => {
  it('INTERLEAVED tool_calls by index build two distinct complete blocks', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_a', function: { name: 'alpha', arguments: '{"x"' } }] } }] },
      { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'beta', arguments: '{"y"' } }] } }] },
      { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }] },
      { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: ':2}' } }] } }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const tools = toolUses(events);
    expect(tools.map((t) => [t.id, t.name])).toEqual([
      ['call_a', 'alpha'],
      ['call_b', 'beta'],
    ]);
    const starts = events.filter((e) => e.type === 'content_block_start');
    const idxA = (starts[0] as { index: number }).index;
    const idxB = (starts[1] as { index: number }).index;
    expect(argsFor(events, idxA)).toBe('{"x":1}');
    expect(argsFor(events, idxB)).toBe('{"y":2}');
  });

  it('argument deltas arriving BEFORE the id are buffered and flushed once the id lands', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, function: { name: 'late', arguments: '{"a":' } }] } }] },
      { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_late', function: { arguments: '1}' } }] } }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const tools = toolUses(events);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.id).toBe('call_late');
    expect(tools[0]!.name).toBe('late');
    const idx = (events.find((e) => e.type === 'content_block_start') as { index: number }).index;
    expect(argsFor(events, idx)).toBe('{"a":1}');
  });

  it('a tool call whose id NEVER arrives is flushed at finish with a synthetic id (not dropped)', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, function: { name: 'ghost', arguments: '{"g":1}' } }] } }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const tools = toolUses(events);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('ghost');
    expect(tools[0]!.id).toMatch(/^call_/);
    const idx = (events.find((e) => e.type === 'content_block_start') as { index: number }).index;
    expect(argsFor(events, idx)).toBe('{"g":1}');
  });

  it('index-less calls keyed by id do not collide; every open block closes before message_delta', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ id: 'call_x', function: { name: 'x', arguments: '{}' } }, { id: 'call_y', function: { name: 'y', arguments: '{}' } }] } }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    expect(toolUses(events).map((t) => t.id)).toEqual(['call_x', 'call_y']);
    const stops = events.filter((e) => e.type === 'content_block_stop').length;
    const startsN = events.filter((e) => e.type === 'content_block_start').length;
    expect(stops).toBe(startsN);
    const deltaIdx = events.findIndex((e) => e.type === 'message_delta');
    const lastStop = events.map((e) => e.type).lastIndexOf('content_block_stop');
    expect(lastStop).toBeLessThan(deltaIdx);
  });
});

describe('OpenAIStreamTranslator: reasoning, finish reasons, usage split', () => {
  it('reasoning_content (and the bare reasoning alias) synthesize thinking blocks', () => {
    for (const field of ['reasoning_content', 'reasoning'] as const) {
      const events = feedAll([
        { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', [field]: 'pondering...' } }] },
        { id: 'c1', choices: [{ index: 0, delta: { content: 'answer' } }] },
        { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ]);
      const start = events.find(
        (e): e is Extract<RawMessageStreamEvent, { type: 'content_block_start' }> =>
          e.type === 'content_block_start' && e.content_block.type === 'thinking',
      );
      expect(start, field).toBeDefined();
      const think = events.find(
        (e) => e.type === 'content_block_delta' && e.delta.type === 'thinking_delta',
      ) as { delta: { thinking: string } } | undefined;
      expect(think?.delta.thinking, field).toBe('pondering...');
    }
  });

  it('finish_reason maps: length->max_tokens, tool_calls->tool_use, content_filter->refusal, stop/null->end_turn', () => {
    const stopReasonFor = (finish: string | null) => {
      const events = feedAll([
        { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' } }] },
        { id: 'c1', choices: [{ index: 0, delta: {}, ...(finish !== null ? { finish_reason: finish } : {}) }] },
      ]);
      const md = events.find((e) => e.type === 'message_delta') as { delta: { stop_reason: string } };
      return md.delta.stop_reason;
    };
    expect(stopReasonFor('length')).toBe('max_tokens');
    expect(stopReasonFor('tool_calls')).toBe('tool_use');
    expect(stopReasonFor('function_call')).toBe('tool_use');
    expect(stopReasonFor('content_filter')).toBe('refusal');
    expect(stopReasonFor('stop')).toBe('end_turn');
    expect(stopReasonFor(null)).toBe('end_turn');
  });

  it('usage split: cached tokens are SUBTRACTED from input and surfaced as cache_read', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' } }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 30 } } },
    ]);
    const md = events.find((e) => e.type === 'message_delta') as { usage: Record<string, number> };
    expect(md.usage.input_tokens).toBe(70);
    expect(md.usage.cache_read_input_tokens).toBe(30);
    expect(md.usage.output_tokens).toBe(7);
  });

  it('zero cached tokens omit the cache_read key entirely', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' } }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } },
    ]);
    const md = events.find((e) => e.type === 'message_delta') as { usage: Record<string, number> };
    expect(md.usage.input_tokens).toBe(12);
    expect('cache_read_input_tokens' in md.usage).toBe(false);
  });
});

// --- wire-level seams (through the transport) --------------------------------------

const enc = new TextEncoder();
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

describe('wire seams: stream_options suppression + in-stream error classification', () => {
  it('stream_options defaults to include_usage and is suppressible via extraBody null (0.48.4)', async () => {
    const f1 = vi.fn(async () => sseOf(okLines()));
    vi.stubGlobal('fetch', f1);
    await drainT(makeT().stream(REQ));
    const b1 = JSON.parse((f1.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(b1.stream_options).toEqual({ include_usage: true });
    vi.unstubAllGlobals();

    const f2 = vi.fn(async () => sseOf(okLines()));
    vi.stubGlobal('fetch', f2);
    await drainT(makeT({ openai: { extraBody: { stream_options: null } } }).stream(REQ));
    const b2 = JSON.parse((f2.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(b2.stream_options).toBeNull();
  });

  it('a MID-STREAM error chunk is classified by type, not hardcoded 500 (0.48.4)', async () => {
    const cases: Array<[string, number]> = [
      ['insufficient_quota', 429],
      ['invalid_api_key', 401],
      ['insufficient_permissions', 403],
      ['server_overloaded', 529],
      ['invalid_prompt', 400],
      ['mystery_error', 500],
    ];
    for (const [type, status] of cases) {
      const lines = [
        `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'par' } }] })}\n\n`,
        `data: ${JSON.stringify({ error: { type, message: 'nope' } })}\n\n`,
      ];
      vi.stubGlobal('fetch', vi.fn(async () => sseOf(lines)));
      const err = await errOf(drainT(makeT().stream(REQ)));
      expect(err, type).toBeInstanceOf(APIStatusError);
      expect((err as APIStatusError).status, type).toBe(status);
      vi.unstubAllGlobals();
    }
  });
});
