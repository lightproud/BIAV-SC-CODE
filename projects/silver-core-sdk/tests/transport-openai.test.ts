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
          'part\n[image #1: attached in the user message after the tool results]',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'background note' },
          { type: 'text', text: '[image #1 from tool call toolu_2]' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } },
        ],
      },
    ]);
  });

  it('marks an is_error tool_result so the model sees the failure (no OpenAI is_error field)', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'boom: exit 1', is_error: true },
            { type: 'tool_result', tool_use_id: 't2', content: 'ok result' },
            { type: 'tool_result', tool_use_id: 't3', content: '', is_error: true },
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      { role: 'tool', tool_call_id: 't1', content: '[tool error] boom: exit 1' },
      { role: 'tool', tool_call_id: 't2', content: 'ok result' }, // success unchanged
      { role: 'tool', tool_call_id: 't3', content: '[tool error]' },
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

  it('keeps a pure-text message free of any image structures', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'plain' }] }],
    });
    expect(body.messages).toEqual([{ role: 'user', content: 'plain' }]);
    expect(JSON.stringify(body)).not.toContain('image_url');
  });

  it.each([
    ['image/jpeg', 'ZmFrZQ=='],
    ['image/png', 'QUJD'],
    ['image/gif', 'R0lG'],
    ['image/webp', 'V0VCUA=='],
  ])('translates a single %s image to a correctly prefixed data URL', (mediaType, data) => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } },
        ],
      },
    ]);
    // No Anthropic-shaped image block may survive into the wire body.
    expect(JSON.stringify(body)).not.toContain('"type":"image"');
    expect(JSON.stringify(body)).not.toContain('"source"');
  });

  it('preserves block order for text/image/text mixes and multiple images', () => {
    const img = (data: string, mediaType = 'image/png') =>
      ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } }) as const;
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'before' },
            img('QQ=='),
            { type: 'text', text: 'between' },
            img('Qg==', 'image/jpeg'),
            img('Qw==', 'image/webp'),
            { type: 'text', text: 'after' },
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'before' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QQ==' } },
          { type: 'text', text: 'between' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,Qg==' } },
          { type: 'image_url', image_url: { url: 'data:image/webp;base64,Qw==' } },
          { type: 'text', text: 'after' },
        ],
      },
    ]);
  });

  it('normalizes media_type case and strips line-wrapped base64 whitespace', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: ' IMAGE/PNG ', data: 'QUJ\nDRA\r\n==' },
            },
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJDRA==' } },
        ],
      },
    ]);
  });

  it('passes a url image source through verbatim', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
        ],
      },
    ]);
  });

  it('rejects an unsupported image media_type with a locatable error', () => {
    const attempt = (): unknown =>
      encodeOpenAIRequest({
        model: 'm',
        max_tokens: 8,
        messages: [
          { role: 'user', content: 'first' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'x' },
              { type: 'image', source: { type: 'base64', media_type: 'image/bmp', data: 'QUJD' } },
            ],
          },
        ],
      });
    expect(attempt).toThrow(ConfigurationError);
    expect(attempt).toThrow(/unsupported image media_type "image\/bmp"/);
    expect(attempt).toThrow(/messages\[1\]\.content\[1\]/);
    expect(attempt).toThrow(/image\/jpeg, image\/png, image\/gif, image\/webp/);
  });

  it('rejects empty base64 image data instead of sending a malformed data URL', () => {
    const attempt = (): unknown =>
      encodeOpenAIRequest({
        model: 'm',
        max_tokens: 8,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '  \n ' } },
            ],
          },
        ],
      });
    expect(attempt).toThrow(ConfigurationError);
    expect(attempt).toThrow(/empty base64 image data at messages\[0\]\.content\[0\]/);
  });

  it('rejects source.data that already carries a data: URL prefix (double-prefix guard)', () => {
    const attempt = (): unknown =>
      encodeOpenAIRequest({
        model: 'm',
        max_tokens: 8,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'data:image/png;base64,QUJD',
                },
              },
            ],
          },
        ],
      });
    expect(attempt).toThrow(ConfigurationError);
    expect(attempt).toThrow(/already carries a "data:" URL prefix/);
  });

  it('rejects non-base64 image data with a byte-free error', () => {
    const attempt = (): unknown =>
      encodeOpenAIRequest({
        model: 'm',
        max_tokens: 8,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/gif', data: '@@not-b64@@' } },
            ],
          },
        ],
      });
    expect(attempt).toThrow(ConfigurationError);
    expect(attempt).toThrow(/is not valid base64/);
    let message = '';
    try {
      attempt();
    } catch (err) {
      message = (err as Error).message;
    }
    // Log/error hygiene: the payload itself must never appear.
    expect(message).not.toContain('@@not-b64@@');
  });

  it('debug summary logs count/MIME/lengths but never the base64 payload', () => {
    const lines: string[] = [];
    encodeOpenAIRequest(
      {
        model: 'm',
        max_tokens: 8,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'two images' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJDRA==' } },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'ZmFrZQ==' } },
            ],
          },
        ],
      },
      {},
      (m) => lines.push(m),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('protocol=openai-chat');
    expect(lines[0]).toContain('images=2');
    expect(lines[0]).toContain('image/png');
    expect(lines[0]).toContain('image/jpeg');
    expect(lines[0]).toContain('data_chars=[8, 8]');
    expect(lines[0]).toContain('(ok)');
    expect(lines[0]).not.toContain('QUJDRA');
    expect(lines[0]).not.toContain('ZmFrZQ');
  });

  it('emits no image debug line for a request without images', () => {
    const lines: string[] = [];
    encodeOpenAIRequest(
      { model: 'm', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] },
      {},
      (m) => lines.push(m),
    );
    expect(lines).toHaveLength(0);
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

  it('defaults stream_options on, but lets extraBody suppress it for old gateways', () => {
    const on = encodeOpenAIRequest({ model: 'm', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] });
    expect(on.stream_options).toEqual({ include_usage: true });
    // A gateway that 400s on stream_options can disable it via extraBody; the
    // hardcoded default previously always won (spread first).
    const off = encodeOpenAIRequest(
      { model: 'm', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] },
      { extraBody: { stream_options: null } },
    );
    expect(off.stream_options).toBeNull();
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

  it('bug-fix (待裁④): an args-only orphan fragment merges into its sibling, not a ghost block', () => {
    // A non-conforming gateway splits ONE call: fragment 1 carries id+name but
    // no index; fragment 2 carries index+args but no id. finish() must merge the
    // orphan args into the emitted block, yielding ONE complete tool_use — not a
    // real block with empty input plus a nameless ghost.
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed({ id: 'c', choices: [{ delta: { tool_calls: [{ id: 'call_A', function: { name: 'foo' } }] } }] }),
      ...t.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"x":1}' } }] } }] }),
      ...t.feed({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    const toolUses = msg.content.filter((b) => b.type === 'tool_use');
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0]).toMatchObject({ name: 'foo', input: { x: 1 } });
  });

  it('bug-fix: an empty tool_call placeholder emits no bogus tool_use block', () => {
    // `{index:1}` with no id/name/args is a placeholder (contentSeen ignores it);
    // finish() must NOT flush it as a tool_use block with an empty name.
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed({ id: 'c', choices: [{ delta: { content: 'hi' } }] }),
      ...t.feed({ choices: [{ delta: { tool_calls: [{ index: 1 }] } }] }),
      ...t.feed({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.content.some((b) => b.type === 'tool_use')).toBe(false);
    expect(msg.stop_reason).toBe('end_turn');
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

  // Missing-finish_reason inference (audit 2026-07-14 M-5): a gateway that
  // ends a tool-call stream with a bare [DONE] / EOF and never sends
  // finish_reason must still yield stop_reason 'tool_use' — mapping it to
  // 'end_turn' makes the engine treat the turn as final and silently drop
  // the model's tool calls.
  it('infers stop_reason tool_use when the stream ends without finish_reason after tool_call deltas', () => {
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed({
        id: 'c',
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_a', function: { name: 'Read', arguments: '{}' } },
              ],
            },
          },
        ],
      }),
      // Bare [DONE] / EOF: the transport calls finish() with no finish_reason seen.
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.stop_reason).toBe('tool_use');
    expect(msg.content).toEqual([{ type: 'tool_use', id: 'call_a', name: 'Read', input: {} }]);
  });

  it('keeps stop_reason end_turn for a text-only stream that ends without finish_reason', () => {
    // The M-5 inference must be scoped to tool calls: a text stream ending in
    // a bare [DONE] is still a plain final turn.
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed({ id: 'c', choices: [{ delta: { content: 'Hello' } }] }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.stop_reason).toBe('end_turn');
    expect(msg.content).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('never overrides an EXPLICIT finish_reason, even when tool calls were emitted', () => {
    // A stream that DID carry finish_reason must behave exactly as before
    // M-5: 'stop' maps to 'end_turn' regardless of open tool_use blocks.
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed({
        id: 'c',
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_a', function: { name: 'Read', arguments: '{}' } },
              ],
            },
          },
        ],
      }),
      ...t.feed({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      ...t.finish(),
    ];
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    expect(acc.finalize().stop_reason).toBe('end_turn');
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
  it('parses delta-seconds and honors up to the 120s ceiling', () => {
    expect(parseRetryAfterMs('0')).toBe(0);
    expect(parseRetryAfterMs('2')).toBe(2000);
    // An explicit "wait 90s" is now honored fully (was clamped to 60s and
    // retried early into the same limit).
    expect(parseRetryAfterMs('90')).toBe(90_000);
    // A pathological value is bounded by the honor-ceiling.
    expect(parseRetryAfterMs('9999')).toBe(120_000);
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('not-a-date')).toBeUndefined();
  });

  it('parses the HTTP-date form (RFC 7231) instead of dropping it', () => {
    // A far-future date is bounded by the ceiling; a past date retries now.
    const future = new Date(Date.now() + 3600_000).toUTCString();
    expect(parseRetryAfterMs(future)).toBe(120_000);
    const past = new Date(Date.now() - 5000).toUTCString();
    expect(parseRetryAfterMs(past)).toBe(0);
    // A near-future date yields a small positive wait (allow scheduling slop).
    const soon = new Date(Date.now() + 3000).toUTCString();
    const ms = parseRetryAfterMs(soon)!;
    expect(ms).toBeGreaterThan(1000);
    expect(ms).toBeLessThanOrEqual(3000);
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

  it('classifies an in-stream rate-limit error as 429 (not a hardcoded 500)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okStream([
          { id: 'c', choices: [{ delta: { content: 'p' } }] },
          { error: { message: 'slow down', type: 'rate_limit_exceeded' } } as Record<string, unknown>,
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
    expect(err.status).toBe(429); // was hardcoded 500 before
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

describe('OpenAIChatTransport empty-message guard (idealab "turn stop / hasAssistantMessage:false")', () => {
  // A stream that DELIVERS chunks (so it is NOT the zero-chunk empty_stream
  // case) but only role-only / usage-only metadata, then closes with a bare
  // `[DONE]`: no content, no reasoning, no tool_calls, no finish_reason. The
  // old `chunkCount > 0 && doneSeen` success gate finalized this as an empty
  // stop_reason:null message; it must now throw a diagnosable empty_message.
  function metaOnlyDone(payloads: Array<Record<string, unknown> | '[DONE]'>): Response {
    return new Response(streamFromChunks([sseBody(payloads)]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  it('role-only chunk + [DONE] (no content, no finish_reason) throws empty_message, never a success', async () => {
    const fetchMock = vi.fn(async () =>
      metaOnlyDone([
        { id: 'chatcmpl-x', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' } }] },
        '[DONE]',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k', maxRetries: 2 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.code).toBe('empty_message');
    expect(err.message).toContain('OpenAI');
    expect(err.message).toContain('[DONE]');
    expect(err.message).toMatch(/no valid assistant content/i);
    expect(err.message).toMatch(/no finish_reason/i);
    // A started stream is NOT replay-safe: it is thrown, not retried.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Must NOT carry the replay/salvage flags (would let the engine mask it).
    expect(err.turnReplaySafe).not.toBe(true);
    expect(err.midStreamTruncation).not.toBe(true);
  });

  it('usage-only chunk + [DONE] (no content, no finish_reason) throws empty_message', async () => {
    const fetchMock = vi.fn(async () =>
      metaOnlyDone([
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 0 } },
        '[DONE]',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k', maxRetries: 2 },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.code).toBe('empty_message');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('empty first delta then real text + finish_reason still completes normally', async () => {
    const fetchMock = vi.fn(async () =>
      okStream([
        { id: 'chatcmpl-y', model: 'gpt-4o', choices: [{ delta: { role: 'assistant', content: '' } }] },
        { choices: [{ delta: { content: 'hello' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } },
        '[DONE]',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const events = await collect(transport.stream(REQ));
    expect(events.at(-1)?.type).toBe('message_stop');
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(msg.stop_reason).toBe('end_turn');
  });

  it('text but no [DONE]/finish_reason stays a truncated turn, NOT empty_message', async () => {
    // Content arrived but the connection dropped before any terminator: this is
    // a mid-stream truncation (salvageable), which must not be reclassified as
    // the empty-finish shape.
    const fetchMock = vi.fn(async () =>
      okStream([
        { id: 'chatcmpl-z', model: 'gpt-4o', choices: [{ delta: { role: 'assistant', content: 'partial' } }] },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const err = (await captureError(collect(transport.stream(REQ)))) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.code).not.toBe('empty_message');
    expect(err.midStreamTruncation).toBe(true);
    expect(err.message).toMatch(/truncated turn/i);
  });

  it('explicit finish_reason:stop with EMPTY text completes per protocol (not empty_message)', async () => {
    // A legitimate — if unusual — completed message: the model finished with no
    // text. finish_reason is the authoritative terminal marker, so this keeps
    // its protocol semantics and must NOT be reclassified as an empty finish.
    const fetchMock = vi.fn(async () =>
      okStream([
        { id: 'chatcmpl-e', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 4, completion_tokens: 0 } },
        '[DONE]',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const events = await collect(transport.stream(REQ));
    expect(events.at(-1)?.type).toBe('message_stop');
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.content).toEqual([]);
    expect(msg.stop_reason).toBe('end_turn');
  });

  it('tool_call fragment + [DONE] (no text, no finish_reason) is valid content, completes normally', async () => {
    // A tool_call bearing an id/name IS assistant content even without a
    // finish_reason: [DONE] + valid content is the normal completion path.
    const fetchMock = vi.fn(async () =>
      okStream([
        {
          id: 'chatcmpl-t',
          model: 'gpt-4o',
          choices: [
            {
              delta: {
                role: 'assistant',
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{}' } },
                ],
              },
            },
          ],
        },
        '[DONE]',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const transport = new OpenAIChatTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: noop,
    });
    const events = await collect(transport.stream(REQ));
    expect(events.at(-1)?.type).toBe('message_stop');
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.content.some((b) => b.type === 'tool_use')).toBe(true);
  });
});

describe('OpenAIStreamTranslator content tracking', () => {
  it('sawContent() stays false for role-only and usage-only chunks', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    t.feed({ id: 'c', choices: [{ delta: { role: 'assistant' } }] });
    t.feed({ choices: [], usage: { prompt_tokens: 5 } });
    expect(t.sawContent()).toBe(false);
    expect(t.sawFinishReason()).toBe(false);
  });

  it('sawContent() flips on non-empty text / reasoning / tool_call fragments', () => {
    const text = new OpenAIStreamTranslator('gpt-4o');
    text.feed({ choices: [{ delta: { content: 'x' } }] });
    expect(text.sawContent()).toBe(true);

    const reason = new OpenAIStreamTranslator('gpt-4o');
    reason.feed({ choices: [{ delta: { reasoning_content: 'thinking' } }] });
    expect(reason.sawContent()).toBe(true);

    const tool = new OpenAIStreamTranslator('gpt-4o');
    tool.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] } }] });
    expect(tool.sawContent()).toBe(true);
  });

  it('empty content string does not flip sawContent(); an empty finish_reason is not a terminal marker', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    t.feed({ choices: [{ delta: { content: '' }, finish_reason: '' }] });
    expect(t.sawContent()).toBe(false);
    expect(t.sawFinishReason()).toBe(false);
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

// ---------------------------------------------------------------------------
// Wire-boundary tool schema filter (BPT 2026-07-13): a tools[] entry whose
// input_schema is missing or not a plain object 400s the whole request at the
// gateway (`tools.N.custom.input_schema: Field required`). The encoder is the
// last line of defense and must drop such entries while keeping valid tools'
// translation byte-identical.
// ---------------------------------------------------------------------------

describe('encodeOpenAIRequest tool schema filter', () => {
  const base = {
    model: 'gpt-4o',
    max_tokens: 8,
    messages: [{ role: 'user' as const, content: 'hi' }],
  };

  function toolsOf(body: Record<string, unknown>): unknown[] | undefined {
    return body.tools as unknown[] | undefined;
  }

  it('drops a schema-less custom entry ({type:"custom",name}) from the wire body', () => {
    const body = encodeOpenAIRequest({
      ...base,
      tools: [{ type: 'custom', name: 'some_tool' } as never],
    });
    expect(toolsOf(body)).toBeUndefined();
  });

  it('drops tools whose input_schema is null, an array or a string', () => {
    const body = encodeOpenAIRequest({
      ...base,
      tools: [
        { name: 'nullish', input_schema: null } as never,
        { name: 'arrayish', input_schema: [] } as never,
        { name: 'stringish', input_schema: 'nope' } as never,
        { name: 'fine', description: 'ok', input_schema: { type: 'object' } },
      ],
    });
    expect(toolsOf(body)).toEqual([
      {
        type: 'function',
        function: { name: 'fine', description: 'ok', parameters: { type: 'object' } },
      },
    ]);
  });

  it('omits tools (and tool_choice) entirely when every entry is invalid', () => {
    const body = encodeOpenAIRequest({
      ...base,
      tools: [{ name: 'nullish', input_schema: null } as never],
      tool_choice: { type: 'auto' },
    });
    expect(toolsOf(body)).toBeUndefined();
    expect(body).not.toHaveProperty('tool_choice');
  });

  it('still drops server-declared typed entries (memory_20250818) honestly', () => {
    const body = encodeOpenAIRequest({
      ...base,
      tools: [
        { type: 'memory_20250818', name: 'memory' },
        { name: 'fine', input_schema: { type: 'object', properties: {} } },
      ],
    });
    expect(toolsOf(body)).toEqual([
      {
        type: 'function',
        function: { name: 'fine', parameters: { type: 'object', properties: {} } },
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end wire fixtures: image structure on the final request body
// ---------------------------------------------------------------------------

describe('image wire format (transport fixtures)', () => {
  const IMAGE_MESSAGES: StreamRequest['messages'] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
      ],
    },
  ];

  function openaiSse(): Response {
    const chunks = [
      {
        id: 'chatcmpl-1',
        model: 'gpt-test',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'a cat' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-1',
        model: 'gpt-test',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
    ];
    const body =
      chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(streamFromChunks([body]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  function anthropicSse(): Response {
    const events = [
      { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test-1', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a cat' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ];
    const body = events
      .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join('');
    return new Response(streamFromChunks([body]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  it('OpenAIChatTransport sends image_url parts (and no Anthropic image block) on the wire', async () => {
    const injected = vi.fn(async () => openaiSse());
    const debugLines: string[] = [];
    const transport = new OpenAIChatTransport({
      provider: { protocol: 'openai-chat', apiKey: 'k', fetch: injected },
      env: {},
      debug: (m) => debugLines.push(m),
    });
    const events = await collect(
      transport.stream({ model: 'gpt-test', max_tokens: 64, messages: IMAGE_MESSAGES }),
    );
    expect(events.at(-1)?.type).toBe('message_stop');
    const wire = JSON.parse(String(injected.mock.calls[0]![1]!.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(wire.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
        ],
      },
    ]);
    expect(JSON.stringify(wire)).not.toContain('"type":"image"');
    // Debug hygiene at the transport level: summary present, payload absent.
    const summary = debugLines.find((l) => l.includes('images='));
    expect(summary).toContain('images=1');
    expect(summary).toContain('image/png');
    expect(debugLines.join('\n')).not.toContain('QUJD');
  });

  it('AnthropicTransport keeps the original Anthropic image structure untouched', async () => {
    const injected = vi.fn(async () => anthropicSse());
    const transport = new AnthropicTransport({
      provider: { apiKey: 'k', fetch: injected },
      env: {},
      debug: noop,
    });
    const events = await collect(
      transport.stream({ model: 'claude-test-1', max_tokens: 64, messages: IMAGE_MESSAGES }),
    );
    expect(events.at(-1)?.type).toBe('message_stop');
    const wire = JSON.parse(String(injected.mock.calls[0]![1]!.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(wire.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
        ],
      },
    ]);
    expect(JSON.stringify(wire)).not.toContain('image_url');
  });

  it('OpenAIChatTransport surfaces an encode error before any network call', async () => {
    const injected = vi.fn(async () => openaiSse());
    const debugLines: string[] = [];
    const transport = new OpenAIChatTransport({
      provider: { protocol: 'openai-chat', apiKey: 'k', fetch: injected },
      env: {},
      debug: (m) => debugLines.push(m),
    });
    const err = await captureError(
      collect(
        transport.stream({
          model: 'gpt-test',
          max_tokens: 64,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/tiff', data: 'QUJD' } },
              ],
            },
          ],
        }),
      ),
    );
    expect(err).toBeInstanceOf(ConfigurationError);
    expect((err as Error).message).toContain('image/tiff');
    expect(injected).not.toHaveBeenCalled();
    expect(debugLines.some((l) => l.includes('request encoding failed'))).toBe(true);
    expect(debugLines.join('\n')).not.toContain('QUJD');
  });
});

// ---------------------------------------------------------------------------
// tool_result attachment fan-out + document -> file parts (v0.56.0)
// ---------------------------------------------------------------------------

describe('tool_result attachment fan-out', () => {
  it('carries a tool_result image into a labeled user message when no other user content exists', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_shot',
              content: [
                { type: 'text', text: 'screenshot taken' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
              ],
            },
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      {
        role: 'tool',
        tool_call_id: 'toolu_shot',
        content:
          'screenshot taken\n[image #1: attached in the user message after the tool results]',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: '[image #1 from tool call toolu_shot]' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
        ],
      },
    ]);
  });

  it('labels attachments from multiple tool_results by their own tool_call_id, in order', () => {
    const img = (data: string) =>
      ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }) as const;
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: [img('QQ==')] },
            { type: 'tool_result', tool_use_id: 't2', content: [img('Qg=='), img('Qw==')] },
          ],
        },
      ],
    });
    const msgs = body.messages as Array<{ role: string; content: unknown }>;
    expect(msgs.map((m) => m.role)).toEqual(['tool', 'tool', 'user']);
    expect(msgs[2]!.content).toEqual([
      { type: 'text', text: '[image #1 from tool call t1]' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QQ==' } },
      { type: 'text', text: '[image #1 from tool call t2]' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,Qg==' } },
      { type: 'text', text: '[image #2 from tool call t2]' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,Qw==' } },
    ]);
  });

  it('degrades an invalid tool_result image to an explicit omission marker instead of throwing', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tbad',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/bmp', data: 'QUJD' } },
              ],
            },
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      {
        role: 'tool',
        tool_call_id: 'tbad',
        content: expect.stringMatching(
          /^\[image #1 omitted: .*unsupported image media_type "image\/bmp".*\]$/,
        ),
      },
    ]);
    // Nothing carried, no image parts anywhere.
    expect(JSON.stringify(body)).not.toContain('image_url');
  });
});

describe('document -> file part translation', () => {
  it('translates a user-turn base64 PDF into an official file part (title as filename)', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'read this' },
            {
              type: 'document',
              title: 'report.pdf',
              source: { type: 'base64', media_type: 'application/pdf', data: 'UERG' },
            } as never,
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'read this' },
          {
            type: 'file',
            file: { filename: 'report.pdf', file_data: 'data:application/pdf;base64,UERG' },
          },
        ],
      },
    ]);
  });

  it('carries a tool_result base64 PDF into the follow-up user message with a default filename', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tpdf',
              content: [
                {
                  type: 'document',
                  source: { type: 'base64', media_type: 'application/pdf', data: 'UERG' },
                } as never,
              ],
            },
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      {
        role: 'tool',
        tool_call_id: 'tpdf',
        content:
          '[document #1 ("document.pdf"): attached in the user message after the tool results]',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: '[document #1 ("document.pdf") from tool call tpdf]' },
          {
            type: 'file',
            file: { filename: 'document.pdf', file_data: 'data:application/pdf;base64,UERG' },
          },
        ],
      },
    ]);
  });

  it('inlines text-source documents and keeps an honest placeholder for URL documents', () => {
    const body = encodeOpenAIRequest({
      model: 'm',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'text', media_type: 'text/plain', data: 'inline body' },
            } as never,
            {
              type: 'document',
              source: { type: 'url', url: 'https://example.com/x.pdf' },
            } as never,
          ],
        },
      ],
    });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content:
          'inline body\n[document "https://example.com/x.pdf" omitted: URL documents have no Chat Completions equivalent]',
      },
    ]);
  });

  it('rejects empty base64 document data in a USER turn with a locatable error', () => {
    const attempt = (): unknown =>
      encodeOpenAIRequest({
        model: 'm',
        max_tokens: 8,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: ' ' },
              } as never,
            ],
          },
        ],
      });
    expect(attempt).toThrow(ConfigurationError);
    expect(attempt).toThrow(/empty base64 document data at messages\[0\]\.content\[0\]/);
  });

  it('debug summary counts images and files separately, still byte-free', () => {
    const lines: string[] = [];
    encodeOpenAIRequest(
      {
        model: 'm',
        max_tokens: 8,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: 'UERG' },
              } as never,
            ],
          },
        ],
      },
      {},
      (m) => lines.push(m),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('images=1');
    expect(lines[0]).toContain('files=1');
    expect(lines[0]).toContain('application/pdf');
    expect(lines[0]).not.toContain('QUJD');
    expect(lines[0]).not.toContain('UERG');
  });
});
