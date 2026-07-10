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
} from '../src/transport/openai.js';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import { createProviderTransport } from '../src/transport/factory.js';
import { MessageAccumulator } from '../src/engine/accumulator.js';
import { APIConnectionError, APIStatusError, ConfigurationError } from '../src/errors.js';
import type { StreamRequest } from '../src/internal/contracts.js';
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
      env: {},
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
      env: {},
      debug: noop,
    });
    const events = await collect(transport.stream(REQ));
    expect(events.at(-1)?.type).toBe('message_stop');
  });

  it('throws ConfigurationError when no credential resolves', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const transport = new OpenAIChatTransport({ provider: {}, env: {}, debug: noop });
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
      env: {},
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
      env: {},
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
      env: {},
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIStatusError;
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err.message).toContain('stream exploded');
  });
});

describe('createProviderTransport', () => {
  it("returns the OpenAI transport for protocol 'openai-chat', Anthropic otherwise", () => {
    const openai = createProviderTransport({
      provider: { protocol: 'openai-chat', apiKey: 'k' },
      env: {},
      debug: noop,
    });
    expect(openai).toBeInstanceOf(OpenAIChatTransport);
    const anthropic = createProviderTransport({
      provider: { apiKey: 'k' },
      env: {},
      debug: noop,
    });
    expect(anthropic).toBeInstanceOf(AnthropicTransport);
  });
});
