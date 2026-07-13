/**
 * Mutation-kill tests: OpenAI translating transport, batch 1 (T39 dedicated
 * round; the file scored 62.81% with 251 survivors + 109 no-coverage).
 * This batch takes the ENCODER blind spots - the request-side translation
 * whose fidelity the black-pool idealab gateway depends on: tool_result
 * flattening (is_error marker, image/document fallbacks), tool_choice
 * forms, assistant/user turn fan-out, and body assembly precedence.
 * All assertions read the REAL wire body captured from the injected fetch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIChatTransport } from '../src/transport/openai.js';
import type { StreamRequest } from '../src/internal/contracts.js';
import type { RawMessageStreamEvent } from '../src/types.js';

const enc = new TextEncoder();
const noop = (): void => {};

function okStream(): Response {
  const chunks = [
    `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' } }] })}\n\n`,
    `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

async function drain(gen: AsyncIterable<RawMessageStreamEvent>): Promise<void> {
  for await (const _ of gen) {
    // drain
  }
}

type Captured = { url: string; body: Record<string, unknown> };

async function encode(
  req: Partial<StreamRequest>,
  providerExtra: Record<string, unknown> = {},
): Promise<Captured> {
  const fetchMock = vi.fn(async () => okStream());
  vi.stubGlobal('fetch', fetchMock);
  const t = new OpenAIChatTransport({
    provider: { protocol: 'openai-chat', apiKey: 'sk-test', ...providerExtra } as never,
    env: { BPT_HTTP_CLIENT: 'fetch' },
    debug: noop,
  });
  await drain(
    t.stream({
      model: 'gpt-4o',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hi' }],
      ...req,
    } as StreamRequest),
  );
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const TOOLS = [
  { name: 'do_it', description: 'does it', input_schema: { type: 'object' as const, properties: {} } },
];

describe('tool_result flattening (is_error marker + media fallbacks)', () => {
  async function toolMessages(content: unknown, isError?: boolean) {
    const { body } = await encode({
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'do_it', input: {} }] },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu1',
              ...(content !== undefined ? { content } : {}),
              ...(isError !== undefined ? { is_error: isError } : {}),
            },
          ],
        },
      ] as never,
    });
    return (body.messages as Array<{ role: string; content?: unknown; tool_call_id?: string }>).filter(
      (m) => m.role === 'tool',
    );
  }

  it('a failed tool_result carries the [tool error] marker before its body', async () => {
    const tool = await toolMessages('exit 1: boom', true);
    expect(tool).toHaveLength(1);
    expect(tool[0]!.content).toBe('[tool error] exit 1: boom');
    expect(tool[0]!.tool_call_id).toBe('tu1');
  });

  it('a failed tool_result with EMPTY content is still marked (bare [tool error])', async () => {
    const tool = await toolMessages('', true);
    expect(tool[0]!.content).toBe('[tool error]');
  });

  it('a successful tool_result is passed through unmarked; undefined content reads empty', async () => {
    expect((await toolMessages('all good', false))[0]!.content).toBe('all good');
    expect((await toolMessages(undefined))[0]!.content).toBe('');
  });

  it('image blocks inside a tool_result flatten to the omission placeholder', async () => {
    const tool = await toolMessages([
      { type: 'text', text: 'before' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } },
      { type: 'text', text: 'after' },
    ]);
    expect(tool[0]!.content).toBe(
      'before\n[image content omitted: not representable in an OpenAI tool result]\nafter',
    );
  });

  it('document blocks flatten: text source passes its data; url/pdf sources name the label', async () => {
    const tool = await toolMessages([
      { type: 'document', title: 'notes', source: { type: 'text', media_type: 'text/plain', data: 'doc body' } },
      { type: 'document', title: 'spec.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'aGk=' } },
      { type: 'document', source: { type: 'url', url: 'https://x.test/a.pdf' } },
    ]);
    const text = tool[0]!.content as string;
    expect(text).toContain('doc body');
    expect(text).toContain('[document "spec.pdf" omitted: no Chat Completions equivalent]');
    expect(text).toContain('[document "https://x.test/a.pdf" omitted: no Chat Completions equivalent]');
  });
});

describe('tool_choice encoding (all four forms + parallel gating)', () => {
  it('auto / any / tool / none translate to their Chat Completions forms', async () => {
    const auto = await encode({ tools: TOOLS, tool_choice: { type: 'auto' } } as never);
    expect(auto.body.tool_choice).toBe('auto');
    const any = await encode({ tools: TOOLS, tool_choice: { type: 'any' } } as never);
    expect(any.body.tool_choice).toBe('required');
    const tool = await encode({ tools: TOOLS, tool_choice: { type: 'tool', name: 'do_it' } } as never);
    expect(tool.body.tool_choice).toEqual({ type: 'function', function: { name: 'do_it' } });
    const none = await encode({ tools: TOOLS, tool_choice: { type: 'none' } } as never);
    expect(none.body.tool_choice).toBe('none');
  });

  it('disable_parallel_tool_use maps to parallel_tool_calls:false and is absent otherwise', async () => {
    const on = await encode({
      tools: TOOLS,
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    } as never);
    expect(on.body.parallel_tool_calls).toBe(false);
    const off = await encode({ tools: TOOLS, tool_choice: { type: 'auto' } } as never);
    expect('parallel_tool_calls' in off.body).toBe(false);
  });

  it('tool_choice WITHOUT tools is dropped entirely (a gateway 400 trap)', async () => {
    const { body } = await encode({ tool_choice: { type: 'auto' } } as never);
    expect('tool_choice' in body).toBe(false);
  });
});

describe('turn fan-out and body assembly', () => {
  it('an assistant turn with text + tool_use encodes joined content plus tool_calls', async () => {
    const { body } = await encode({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'first' },
            { type: 'text', text: 'second' },
            { type: 'tool_use', id: 'tu9', name: 'do_it', input: { a: 1 } },
            { type: 'thinking', thinking: 'secret', signature: 's' },
          ],
        },
        { role: 'user', content: 'go on' },
      ] as never,
    });
    const assistant = (body.messages as Array<{ role: string; content?: unknown; tool_calls?: unknown[] }>).find(
      (m) => m.role === 'assistant',
    )!;
    expect(assistant.content).toBe('first\nsecond');
    expect(assistant.tool_calls).toEqual([
      { id: 'tu9', type: 'function', function: { name: 'do_it', arguments: '{"a":1}' } },
    ]);
    // thinking never reaches the OpenAI wire
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('an assistant turn that is ONLY thinking encodes to no message at all', async () => {
    const { body } = await encode({
      messages: [
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'x', signature: 's' }] },
        { role: 'user', content: 'next' },
      ] as never,
    });
    const roles = (body.messages as Array<{ role: string }>).map((m) => m.role);
    expect(roles.filter((r) => r === 'assistant')).toHaveLength(0);
  });

  it('tool messages precede the remaining user text (protocol adjacency) and mixed media builds parts', async () => {
    const { body } = await encode({
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'do_it', input: {} }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look at this' },
            { type: 'tool_result', tool_use_id: 'tu1', content: 'done' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } },
          ],
        },
      ] as never,
    });
    const msgs = body.messages as Array<{ role: string; content: unknown }>;
    const toolIdx = msgs.findIndex((m) => m.role === 'tool');
    const userIdx = msgs.findIndex((m, i) => m.role === 'user' && i > toolIdx);
    expect(toolIdx).toBeGreaterThan(-1);
    expect(userIdx).toBeGreaterThan(toolIdx);
    const parts = msgs[userIdx]!.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(Array.isArray(parts)).toBe(true);
    expect(parts.map((p) => p.type)).toEqual(['text', 'image_url']);
    expect(parts[1]!.image_url!.url).toBe('data:image/png;base64,aGk=');
  });

  it('an all-text user block turn collapses to one joined string (no parts array)', async () => {
    const { body } = await encode({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
      ] as never,
    });
    const user = (body.messages as Array<{ role: string; content: unknown }>).find((m) => m.role === 'user')!;
    expect(user.content).toBe('a\nb');
  });

  it('body assembly: translator-owned keys beat extraBody on conflict; maxTokensParam renames the cap', async () => {
    const { body } = await encode(
      { messages: [{ role: 'user', content: 'hi' }], temperature: 0.5 } as never,
      { openai: { extraBody: { model: 'evil-override', custom_flag: 1 }, maxTokensParam: 'max_completion_tokens' } },
    );
    expect(body.model).toBe('gpt-4o'); // translator wins
    expect(body.custom_flag).toBe(1); // extras pass through
    expect(body.max_completion_tokens).toBe(64);
    expect('max_tokens' in body).toBe(false);
    expect(body.temperature).toBe(0.5);
  });

  it('custom tools translate to function declarations (description optional)', async () => {
    const { body } = await encode({
      tools: [
        { name: 'with_desc', description: 'd', input_schema: { type: 'object', properties: {} } },
        { name: 'no_desc', input_schema: { type: 'object', properties: {} } },
      ],
    } as never);
    const tools = body.tools as Array<{ type: string; function: { name: string; description?: string; parameters: unknown } }>;
    expect(tools.map((t) => t.function.name)).toEqual(['with_desc', 'no_desc']);
    expect(tools[0]!.function.description).toBe('d');
    expect('description' in tools[1]!.function).toBe(false);
    expect(tools[0]!.type).toBe('function');
  });
});
