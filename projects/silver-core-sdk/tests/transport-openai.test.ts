/**
 * OpenAI-protocol transport unit tests (BPT-EXTENSION): request encoding
 * (Messages API shape -> Chat Completions body), stream translation
 * (chat.completion.chunk -> RawMessageStreamEvent), credential/base-URL
 * resolution, error mapping and retry policy. No network: global fetch is
 * stubbed per test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  encodeOpenAIRequest,
  OpenAIChatTransport,
  OpenAIStreamTranslator,
  parseRetryAfterMs,
} from '../src/transport/openai.js';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import { createProviderTransport } from '../src/transport/factory.js';
import { MessageAccumulator } from '../src/engine/accumulator.js';
import {
  AbortError,
  APIConnectionError,
  APIStatusError,
  ConfigurationError,
} from '../src/errors.js';
import type { RetryInfo, StreamRequest } from '../src/internal/contracts.js';
import type { RawMessageStreamEvent } from '../src/types.js';

const enc = new TextEncoder();
const noop = (): void => {};

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
      controller.close();
    },
  });
}

function sseBody(payloads: Array<Record<string, unknown> | '[DONE]'>): string {
  return payloads
    .map((p) => `data: ${p === '[DONE]' ? '[DONE]' : JSON.stringify(p)}\n\n`)
    .join('');
}

async function collect(
  gen: AsyncGenerator<RawMessageStreamEvent, void>,
): Promise<RawMessageStreamEvent[]> {
  const out: RawMessageStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

async function captureError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected promise to reject, but it resolved');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Request encoding
// ---------------------------------------------------------------------------

describe('encodeOpenAIRequest', () => {
  it('encodes system + user strings, max_tokens and stream flags', () => {
    const body = encodeOpenAIRequest({
      model: 'gpt-4o',
      max_tokens: 1024,
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body.model).toBe('gpt-4o');
    expect(body.max_tokens).toBe(1024);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'hi' },
    ]);
    expect(body).not.toHaveProperty('thinking');
  });

  it('joins system blocks with newline and strips cache_control everywhere', () => {
    const body = encodeOpenAIRequest({
      model: 'gpt-4o',
      max_tokens: 8,
      system: [
        { type: 'text', text: 'stable', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'cwd tail' },
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
          ],
        },
      ],
      tools: [
        {
          name: 'Read',
          description: 'read a file',
          input_schema: { type: 'object' },
          cache_control: { type: 'ephemeral' },
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('cache_control');
    expect((body.messages as unknown[])[0]).toEqual({
      role: 'system',
      content: 'stable\ncwd tail',
    });
  });

  it('translates assistant tool_use into tool_calls and drops thinking blocks', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hmm', signature: 'sig' },
            { type: 'text', text: 'Reading it.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a' } },
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: 'Reading it.',
        tool_calls: [
          {
            id: 'toolu_1',
            type: 'function',
            function: { name: 'Read', arguments: '{"file_path":"/a"}' },
          },
        ],
      },
    ]);
  });

  it('fans a user tool_result turn out into tool messages before user content', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file text' },
            {
              type: 'tool_result',
              tool_use_id: 'toolu_2',
              content: [
                { type: 'text', text: 'part' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA' } },
              ],
            },
            { type: 'text', text: 'background note' },
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      { role: 'tool', tool_call_id: 'toolu_1', content: 'file text' },
      {
        role: 'tool',
        tool_call_id: 'toolu_2',
        content:
          'part\n[image content omitted: not representable in an OpenAI tool result]',
      },
      { role: 'user', content: 'background note' },
    ]);
  });

  it('translates user image blocks to image_url data URLs', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
        ],
      },
    ]);
  });

  it('maps tools and tool_choice variants', () => {
    const base = {
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user' as const, content: 'x' }],
      tools: [{ name: 'Read', description: 'd', input_schema: { type: 'object' } }],
    };
    const body = encodeOpenAIRequest({
      ...base,
      tool_choice: { type: 'any', disable_parallel_tool_use: true },
    });
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'Read', description: 'd', parameters: { type: 'object' } },
      },
    ]);
    expect(body.tool_choice).toBe('required');
    expect(body.parallel_tool_calls).toBe(false);

    const named = encodeOpenAIRequest({
      ...base,
      tool_choice: { type: 'tool', name: 'Read' },
    });
    expect(named.tool_choice).toEqual({ type: 'function', function: { name: 'Read' } });
    expect(named).not.toHaveProperty('parallel_tool_calls');
  });

  it('maps output_config to response_format json_schema', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      output_config: {
        format: { type: 'json_schema', schema: { type: 'object', properties: {} } },
      },
    });
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'structured_output', schema: { type: 'object', properties: {} } },
    });
  });

  it('honors maxTokensParam, reasoningEffort and extraBody (translator keys win)', () => {
    const body = encodeOpenAIRequest(
      {
        model: 'o4-mini',
        max_tokens: 2048,
        messages: [{ role: 'user', content: 'x' }],
        temperature: 0,
      },
      {
        maxTokensParam: 'max_completion_tokens',
        reasoningEffort: 'high',
        extraBody: { enable_thinking: false, model: 'should-lose' },
      },
    );
    expect(body.max_completion_tokens).toBe(2048);
    expect(body).not.toHaveProperty('max_tokens');
    expect(body.reasoning_effort).toBe('high');
    expect(body.enable_thinking).toBe(false);
    expect(body.model).toBe('o4-mini');
    expect(body.temperature).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stream translation
// ---------------------------------------------------------------------------

describe('OpenAIStreamTranslator', () => {
  it('translates a text stream and splits cached prompt tokens from input', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    const events = [
      ...t.feed({
        id: 'chatcmpl-1',
        model: 'gpt-4o-2024',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' } }],
      }),
      ...t.feed({ choices: [{ index: 0, delta: { content: 'lo' } }] }),
      ...t.feed({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      ...t.feed({
        choices: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 5,
          prompt_tokens_details: { cached_tokens: 40 },
        },
      }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.id).toBe('chatcmpl-1');
    expect(msg.model).toBe('gpt-4o-2024');
    expect(msg.content).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(msg.stop_reason).toBe('end_turn');
    expect(msg.usage.output_tokens).toBe(5);
    expect(msg.usage.input_tokens).toBe(60);
    expect(msg.usage.cache_read_input_tokens).toBe(40);
  });

  it('translates tool_calls (two indices) into tool_use blocks with json deltas', () => {
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed({
        id: 'c',
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_a', function: { name: 'Read', arguments: '{"fi' } },
              ],
            },
          },
        ],
      }),
      ...t.feed({
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: 'le":"/a"}' } }] } },
        ],
      }),
      ...t.feed({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, id: 'call_b', function: { name: 'Glob', arguments: '{}' } },
              ],
            },
          },
        ],
      }),
      ...t.feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.stop_reason).toBe('tool_use');
    expect(msg.content).toEqual([
      { type: 'tool_use', id: 'call_a', name: 'Read', input: { file: '/a' } },
      { type: 'tool_use', id: 'call_b', name: 'Glob', input: {} },
    ]);
  });

  // A tool-call delta chunk built without deep inline nesting (the embedded
  // JSON braces in `arguments` make hand-counting the object literal error-prone).
  const toolChunk = (
    tc: { index?: number; id?: string; name?: string; arguments?: string },
    finish = false,
  ): OpenAIChunk => {
    const fn: { name?: string; arguments?: string } = {};
    if (tc.name !== undefined) fn.name = tc.name;
    if (tc.arguments !== undefined) fn.arguments = tc.arguments;
    const call: Record<string, unknown> = { function: fn };
    if (tc.index !== undefined) call.index = tc.index;
    if (tc.id !== undefined) call.id = tc.id;
    const choice: Record<string, unknown> = { delta: { tool_calls: [call] } };
    if (finish) choice.finish_reason = 'tool_calls';
    return { id: 'c', choices: [choice] } as OpenAIChunk;
  };

  it('accumulates a tool id that arrives in a LATER chunk than the block open', () => {
    // A fragmenting gateway opens the tool call with name+args but NO id, then
    // sends the real id in the next chunk. The real id must win — not a synthetic
    // one — or the server rejects the follow-up tool_call_id with a 400.
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed(toolChunk({ index: 0, name: 'Read', arguments: '{"a":' })),
      ...t.feed(toolChunk({ index: 0, id: 'call_REAL', arguments: '1}' })),
      ...t.feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.content).toEqual([
      { type: 'tool_use', id: 'call_REAL', name: 'Read', input: { a: 1 } },
    ]);
  });

  it('joins a tool name split across chunks that precede the id', () => {
    // Name fragments accumulate while the block is still pending (no id yet);
    // the block is emitted with the full name once the id-bearing chunk lands.
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed(toolChunk({ index: 0, name: 'get_' })),
      ...t.feed(toolChunk({ index: 0, id: 'call_x', name: 'weather', arguments: '{}' })),
      ...t.feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.content).toEqual([
      { type: 'tool_use', id: 'call_x', name: 'get_weather', input: {} },
    ]);
  });

  it('surfaces reasoning_content as a thinking block before the text block', () => {
    const t = new OpenAIStreamTranslator('deepseek-reasoner');
    const events = [
      ...t.feed({ id: 'c', choices: [{ delta: { reasoning_content: 'let me think' } }] }),
      ...t.feed({ choices: [{ delta: { content: 'Answer.' } }] }),
      ...t.feed({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.content).toEqual([
      { type: 'thinking', thinking: 'let me think', signature: '' },
      { type: 'text', text: 'Answer.' },
    ]);
  });

  it('maps length/content_filter finish reasons and is idempotent on finish', () => {
    const t = new OpenAIStreamTranslator('m');
    t.feed({ id: 'c', choices: [{ delta: { content: 'x' }, finish_reason: 'length' }] });
    const final = t.finish();
    const delta = final.find((e) => e.type === 'message_delta');
    expect(delta && delta.type === 'message_delta' ? delta.delta.stop_reason : null).toBe(
      'max_tokens',
    );
    expect(t.finish()).toEqual([]);

    const f = new OpenAIStreamTranslator('m');
    f.feed({ id: 'c', choices: [{ delta: {}, finish_reason: 'content_filter' }] });
    const d2 = f.finish().find((e) => e.type === 'message_delta');
    expect(d2 && d2.type === 'message_delta' ? d2.delta.stop_reason : null).toBe('refusal');
  });

  it('throws when the stream ends before any chunk', () => {
    const t = new OpenAIStreamTranslator('m');
    expect(() => t.finish()).toThrow(APIConnectionError);
  });

  it('keeps INTERLEAVED tool_calls intact across indices (P0-1 regression)', () => {
    const t = new OpenAIStreamTranslator('m');
    const events = [
      // idx 0 opens with a partial argument fragment...
      ...t.feed({
        id: 'c',
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_a', function: { name: 'Read', arguments: '{"file' } },
              ],
            },
          },
        ],
      }),
      // ...idx 1 opens BEFORE idx 0 finished (vLLM-style interleaving)...
      ...t.feed({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, id: 'call_b', function: { name: 'Grep', arguments: '{"pattern":"x"}' } },
              ],
            },
          },
        ],
      }),
      // ...then idx 0's remaining fragment arrives.
      ...t.feed({
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '_path":"/a"}' } }] } },
        ],
      }),
      ...t.feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.content).toEqual([
      { type: 'tool_use', id: 'call_a', name: 'Read', input: { file_path: '/a' } },
      { type: 'tool_use', id: 'call_b', name: 'Grep', input: { pattern: 'x' } },
    ]);
  });

  it('merges text deltas around a tool call into ONE text block (no ghost blocks)', () => {
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed({ id: 'c', choices: [{ delta: { content: 'Let me ' } }] }),
      ...t.feed({
        choices: [
          { delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'Read', arguments: '{}' } }] } },
        ],
      }),
      ...t.feed({ choices: [{ delta: { content: 'read it.' } }] }),
      ...t.feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.content).toEqual([
      { type: 'text', text: 'Let me read it.' },
      { type: 'tool_use', id: 'call_a', name: 'Read', input: {} },
    ]);
  });

  it("surfaces the `reasoning` gateway alias like `reasoning_content`", () => {
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed({ id: 'c', choices: [{ delta: { reasoning: 'pondering' } }] }),
      ...t.feed({ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    expect(acc.finalize().content).toEqual([
      { type: 'thinking', thinking: 'pondering', signature: '' },
      { type: 'text', text: 'Done.' },
    ]);
  });

  it('falls back to a synthetic call_N id when the provider omits tool_call id', () => {
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed({
        id: 'c',
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { name: 'Glob', arguments: '{}' } }] } },
        ],
      }),
      ...t.feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const block = acc.finalize().content[0];
    expect(block).toMatchObject({ type: 'tool_use', name: 'Glob' });
    expect((block as { id: string }).id).toMatch(/^call_\d+$/);
  });
});

describe('parseRetryAfterMs', () => {
  it('parses seconds and caps at the 60s backoff maximum', () => {
    expect(parseRetryAfterMs('0')).toBe(0);
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs('9999')).toBe(60_000);
    expect(parseRetryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Transport end-to-end (stubbed fetch)
// ---------------------------------------------------------------------------

const REQ: StreamRequest = {
  model: 'gpt-4o',
  max_tokens: 64,
  messages: [{ role: 'user', content: 'hi' }],
};

function okStream(payloads: Array<Record<string, unknown> | '[DONE]'>): Response {
  return new Response(streamFromChunks([sseBody(payloads)]), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const TEXT_CHUNKS: Array<Record<string, unknown> | '[DONE]'> = [
  { id: 'chatcmpl-9', model: 'gpt-4o', choices: [{ delta: { role: 'assistant', content: 'hey' } }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
  { choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } },
  '[DONE]',
];

describe('OpenAIChatTransport', () => {
  it('POSTs {base}/chat/completions with Bearer auth and translates the stream', async () => {
    const fetchMock = vi.fn(async () => okStream(TEXT_CHUNKS));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: { protocol: 'openai-chat', apiKey: 'sk-test' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    expect(transport.apiKeySource()).toBe('user');
    const events = await collect(transport.stream(REQ));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(headers).not.toHaveProperty('anthropic-version');
    expect(headers).not.toHaveProperty('x-api-key');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('gpt-4o');
    expect(body.stream).toBe(true);

    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.content).toEqual([{ type: 'text', text: 'hey' }]);
    expect(msg.stop_reason).toBe('end_turn');
    expect(events.at(-1)?.type).toBe('message_stop');
  });

  it('resolves OPENAI_API_KEY / OPENAI_BASE_URL from env (trailing slash stripped)', async () => {
    const fetchMock = vi.fn(async () => okStream(TEXT_CHUNKS));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: {},
      env: {
        BPT_HTTP_CLIENT: 'fetch',
        OPENAI_API_KEY: 'sk-env',
        OPENAI_BASE_URL: 'https://gateway.example.com/openai/v1/',
      },
      debug: noop,
    });
    expect(transport.apiKeySource()).toBe('project');
    await collect(transport.stream(REQ));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gateway.example.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-env');
  });

  it('finishes cleanly when the stream ends without [DONE]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okStream(TEXT_CHUNKS.slice(0, 3))),
    );
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const events = await collect(transport.stream(REQ));
    expect(events.at(-1)?.type).toBe('message_stop');
  });

  it('throws ConfigurationError when no credential resolves', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const transport = new OpenAIChatTransport({ provider: {}, env: { BPT_HTTP_CLIENT: 'fetch' }, debug: noop });
    expect(transport.apiKeySource()).toBe('none');
    const err = await captureError(collect(transport.stream(REQ)));
    expect(err).toBeInstanceOf(ConfigurationError);
  });

  it('maps a non-2xx body to APIStatusError with normalized type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { message: 'bad key', type: 'invalid_api_key' } }),
          { status: 401 },
        ),
      ),
    );
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIStatusError;
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err.status).toBe(401);
    expect(err.errorType).toBe('authentication_error');
    expect(err.message).toContain('bad key');
  });

  it('retries 429 with onRetry then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'slow down' } }), {
          status: 429,
          headers: { 'retry-after': '0' },
        }),
      )
      .mockResolvedValueOnce(okStream(TEXT_CHUNKS));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k', maxRetries: 2 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const retries: number[] = [];
    const events = await collect(
      transport.stream({ ...REQ, onRetry: (info) => retries.push(info.status ?? 0) }),
    );
    expect(retries).toEqual([429]);
    expect(events.at(-1)?.type).toBe('message_stop');
  });

  it('surfaces an in-stream error payload as APIStatusError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okStream([
          { id: 'c', choices: [{ delta: { content: 'par' } }] },
          { error: { message: 'stream exploded', type: 'server_error' } } as Record<
            string,
            unknown
          >,
        ]),
      ),
    );
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIStatusError;
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err.message).toContain('stream exploded');
  });
});

describe('OpenAIChatTransport stream-fault quadrant', () => {
  function bodyThatDropsAfter(head: string): ReadableStream<Uint8Array> {
    let sent = false;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(enc.encode(head));
        } else {
          controller.error(new Error('ECONNRESET: connection reset by peer'));
        }
      },
    });
  }

  function hangingBody(head: string): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(head));
        // never closes, never errors
      },
    });
  }

  const HEAD_CHUNK = sseBody([
    { id: 'c', choices: [{ delta: { role: 'assistant', content: 'par' } }] },
  ]);

  it('marks a mid-stream disconnect as midStreamTruncation (E3 salvage input)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bodyThatDropsAfter(HEAD_CHUNK), { status: 200 })),
    );
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.midStreamTruncation).toBe(true);
  });

  it('does NOT set midStreamTruncation when the connection drops before any chunk', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bodyThatDropsAfter(''), { status: 200 })),
    );
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k', maxRetries: 0 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.midStreamTruncation).toBeFalsy();
  });

  it('treats a clean end with neither [DONE] nor finish_reason as a truncated turn', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okStream([
        { id: 'c', choices: [{ delta: { role: 'assistant', content: 'half an ans' } }] },
      ])),
    );
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.midStreamTruncation).toBe(true);
    expect(err.message).toContain('without [DONE] or finish_reason');
  });

  it('aborts a silently stalled stream via the idle watchdog (stream_idle_timeout)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(hangingBody(HEAD_CHUNK), { status: 200 })),
    );
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k', streamIdleTimeoutMs: 25 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.code).toBe('stream_idle_timeout');
  });

  it('maps the whole-request timeout when the watchdog is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        // Respect the fetch signal so AbortSignal.timeout() actually cuts the body.
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(enc.encode(HEAD_CHUNK));
              init?.signal?.addEventListener('abort', () => {
                try {
                  controller.error(init.signal?.reason ?? new Error('aborted'));
                } catch {
                  /* already errored */
                }
              });
            },
          }),
          { status: 200 },
        );
      }),
    );
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k', timeoutMs: 30, streamIdleTimeoutMs: 0 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.message).toContain('timed out after 30ms');
  });

  it('surfaces a caller abort mid-stream as AbortError', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(hangingBody(HEAD_CHUNK), { status: 200 })),
    );
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const consume = (async () => {
      const out: RawMessageStreamEvent[] = [];
      for await (const ev of transport.stream({ ...REQ, signal: controller.signal })) {
        out.push(ev);
        controller.abort();
      }
      return out;
    })();
    const err = await captureError(consume);
    expect(err).toBeInstanceOf(AbortError);
  });

  it('carries x-request-id into APIStatusError on HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'nope' } }), {
          status: 400,
          headers: { 'x-request-id': 'req_openai_123' },
        }),
      ),
    );
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIStatusError;
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err.requestId).toBe('req_openai_123');
  });
});

describe('OpenAIChatTransport empty-stream retry (idealab throttle self-heal)', () => {
  // A CLEAN HTTP 200 whose SSE body carries zero chunks (no [DONE], no
  // finish_reason) — the replay-safe non-start the 断流继续臂 heals. Distinct
  // from the quadrant's ECONNRESET-before-any-chunk case (a stream ERROR, which
  // stays terminal). Mirrors AnthropicTransport's empty-stream retry.
  function emptyStream(): Response {
    return new Response(streamFromChunks([]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  it('retries an empty stream (HTTP 200, zero SSE chunks) then completes on the healed retry', async () => {
    // Pin backoff jitter so the single retry waits a deterministic ~500ms.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyStream()) // 200, empty body -> replay-safe non-start
      .mockResolvedValueOnce(okStream(TEXT_CHUNKS)); // healed: a real stream
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({ provider: { apiKey: 'k' }, env: { BPT_HTTP_CLIENT: 'fetch' }, debug: noop });
    const events = await collect(transport.stream(REQ));
    expect(events.at(-1)?.type).toBe('message_stop');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a bare [DONE] with ZERO chunks as an empty stream (heals on retry, not a raw crash)', async () => {
    // A gateway that accepts the request then closes the SSE body with only
    // `data: [DONE]` (no content chunks). The translator never started, so the
    // old code called finish() -> raw "ended before any chunk" throw with no
    // replay-safe marker. It must instead route through the empty-stream retry,
    // exactly like the no-terminator empty stream, and heal on the next attempt.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const doneOnly = (): Response =>
      new Response(streamFromChunks(['[DONE]']), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(doneOnly()) // 200, only [DONE] -> replay-safe non-start
      .mockResolvedValueOnce(okStream(TEXT_CHUNKS)); // healed
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({ provider: { apiKey: 'k' }, env: { BPT_HTTP_CLIENT: 'fetch' }, debug: noop });
    const events = await collect(transport.stream(REQ));
    expect(events.at(-1)?.type).toBe('message_stop');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a persistent bare-[DONE] empty stream exhausts into a diagnosable empty_stream error', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const doneOnly = (): Response =>
      new Response(streamFromChunks(['[DONE]']), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    const fetchMock = vi.fn().mockResolvedValueOnce(doneOnly()).mockResolvedValueOnce(doneOnly());
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k', maxRetries: 1 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.code).toBe('empty_stream');
  });

  it('never returns normally on an empty stream: persistent empties exhaust the budget into an empty_stream APIConnectionError', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyStream())
      .mockResolvedValueOnce(emptyStream());
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k', maxRetries: 1 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.code).toBe('empty_stream');
    expect(err.message).toMatch(/empty stream/i);
    expect(err.message).toMatch(/after 2 attempt\(s\)/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it('with maxRetries 0 an empty stream is not retried but STILL becomes a diagnosable empty_stream', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(emptyStream());
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k', maxRetries: 0 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.code).toBe('empty_stream');
    expect(err.message).toMatch(/after 1 attempt\(s\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an empty-stream retry fires onRetry with a network-level shape (no HTTP status), like a dropped socket', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyStream())
      .mockResolvedValueOnce(okStream(TEXT_CHUNKS));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({ provider: { apiKey: 'k' }, env: { BPT_HTTP_CLIENT: 'fetch' }, debug: noop });
    const retries: RetryInfo[] = [];
    const events = await collect(
      transport.stream({ ...REQ, onRetry: (info) => retries.push(info) }),
    );
    expect(events.at(-1)?.type).toBe('message_stop');
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ attempt: 1 });
    expect(retries[0]!.status).toBeUndefined();
  });

  it('a caller abort during the empty-stream backoff wins over the retry', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyStream())
      .mockResolvedValueOnce(okStream(TEXT_CHUNKS));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({ provider: { apiKey: 'k' }, env: { BPT_HTTP_CLIENT: 'fetch' }, debug: noop });
    const ac = new AbortController();
    // Abort while the transport is backing off before the retry fetch.
    const onRetry = (): void => ac.abort();
    const err = await captureError(
      collect(transport.stream({ ...REQ, signal: ac.signal, onRetry })),
    );
    expect(err).toBeInstanceOf(AbortError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never reached the retry fetch
  });
});

describe('OpenAIChatTransport gateway knobs (audit P1-4)', () => {
  it('applies provider.openai.modelMap at the wire boundary', async () => {
    const fetchMock = vi.fn(async () => okStream(TEXT_CHUNKS));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: {
        apiKey: 'k',
        openai: { modelMap: { 'claude-haiku-4-5': 'gpt-4o-mini' } },
      },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    await collect(transport.stream({ ...REQ, model: 'claude-haiku-4-5' }));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((JSON.parse(init.body as string) as { model: string }).model).toBe('gpt-4o-mini');
  });

  it('supports Azure-style api-key header and extraQueryParams', async () => {
    const fetchMock = vi.fn(async () => okStream(TEXT_CHUNKS));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: {
        apiKey: 'azure-key',
        baseUrl: 'https://myres.openai.azure.com/openai/deployments/gpt4o',
        openai: {
          authHeaderName: 'api-key',
          extraQueryParams: { 'api-version': '2024-06-01' },
        },
      },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    await collect(transport.stream(REQ));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://myres.openai.azure.com/openai/deployments/gpt4o/chat/completions?api-version=2024-06-01',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('azure-key');
    expect(headers).not.toHaveProperty('authorization');
  });
});

describe('createProviderTransport', () => {
  it("returns the OpenAI transport for protocol 'openai-chat', Anthropic otherwise", () => {
    const openai = createProviderTransport({
      provider: { protocol: 'openai-chat', apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    expect(openai).toBeInstanceOf(OpenAIChatTransport);
    const anthropic = createProviderTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    expect(anthropic).toBeInstanceOf(AnthropicTransport);
  });
});
