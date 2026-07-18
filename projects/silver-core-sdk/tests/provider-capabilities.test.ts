/**
 * Provider capability declaration + automation-continuation fragment (keeper
 * memo 2026-07-18 §3).
 *
 * (a) `provider.capabilities` — the host's structured declaration of what an
 *     endpoint truly supports; the engine degrades per declaration at the
 *     wire boundary, never silently assumes full capability, and an omitted
 *     declaration keeps today's bytes exactly.
 * (b) the continuation fragment — protocol-gated (openai-chat on, anthropic
 *     off, `options.continuationPrompt` overrides), verified end-to-end
 *     against fake endpoints: the SAME task produces a system prompt with the
 *     fragment on one protocol and without it on the other.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { query } from '../src/index.js';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import { degradeAnthropicRequestBody } from '../src/transport/capabilities.js';
import { encodeOpenAIRequest } from '../src/transport/openai.js';
import { CONTINUATION_FRAGMENT } from '../src/engine/prompt-fragments.js';
import { assembleMainLoop } from '../src/engine/prompt-assembler.js';
import type { StreamRequest } from '../src/internal/contracts.js';

const enc = new TextEncoder();
const FRAGMENT_MARK = 'automated loop with no interactive user';

function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

const ANTHROPIC_EVENTS = [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test-1', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
  { type: 'message_stop' },
];

function openaiSseResponse(): Response {
  const chunks = [
    { id: 'chatcmpl-1', model: 'gpt-test', choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: null }] },
    { id: 'chatcmpl-1', model: 'gpt-test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
  ];
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function baseBody(): Omit<StreamRequest, 'signal' | 'onRetry'> {
  return {
    model: 'claude-test-1',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hi' }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('degradeAnthropicRequestBody (capability declaration, anthropic wire)', () => {
  it('no declaration / empty declaration: the SAME body object (byte-identical fast path)', () => {
    const body = { ...baseBody(), thinking: { type: 'adaptive' as const } };
    expect(degradeAnthropicRequestBody(body, undefined)).toBe(body);
    expect(degradeAnthropicRequestBody(body, {})).toBe(body);
  });

  it('thinking: false strips the thinking field and reports it', () => {
    const debug = vi.fn();
    const body = { ...baseBody(), thinking: { type: 'adaptive' as const } };
    const out = degradeAnthropicRequestBody(body, { thinking: false }, debug);
    expect('thinking' in out).toBe(false);
    expect(out.messages).toBe(body.messages);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('capabilities.thinking: false'));
    // No thinking on the body -> nothing to strip, same object back.
    const plain = baseBody();
    expect(degradeAnthropicRequestBody(plain, { thinking: false })).toBe(plain);
  });

  it("promptCaching 'automatic'/'none' strips every cache_control marker", () => {
    const debug = vi.fn();
    const body: Omit<StreamRequest, 'signal' | 'onRetry'> = {
      ...baseBody(),
      system: [
        { type: 'text', text: 'stable', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'tail' },
      ],
      tools: [
        {
          name: 'T',
          input_schema: { type: 'object' },
          cache_control: { type: 'ephemeral' },
        } as never,
      ],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }],
        },
      ],
    };
    const out = degradeAnthropicRequestBody(body, { promptCaching: 'automatic' }, debug);
    expect(JSON.stringify(out)).not.toContain('cache_control');
    expect(JSON.stringify(out)).toContain('stable');
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("promptCaching: 'automatic'"));
    // 'explicit' (the default semantics) strips nothing.
    expect(degradeAnthropicRequestBody(body, { promptCaching: 'explicit' })).toBe(body);
    // A marker-free body is returned as the same object even under 'none'.
    const clean = baseBody();
    expect(degradeAnthropicRequestBody(clean, { promptCaching: 'none' })).toBe(clean);
  });

  it('parallelToolCalls: false forces disable_parallel_tool_use when tools are present', () => {
    const withTools: Omit<StreamRequest, 'signal' | 'onRetry'> = {
      ...baseBody(),
      tools: [{ name: 'T', input_schema: { type: 'object' } } as never],
    };
    const forced = degradeAnthropicRequestBody(withTools, { parallelToolCalls: false });
    expect(forced.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    const withChoice = {
      ...withTools,
      tool_choice: { type: 'auto' as const },
    };
    const forced2 = degradeAnthropicRequestBody(withChoice, { parallelToolCalls: false });
    expect(forced2.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    // No tools -> nothing to force (tool_choice without tools 400s the API).
    const noTools = baseBody();
    expect(degradeAnthropicRequestBody(noTools, { parallelToolCalls: false })).toBe(noTools);
  });

  it('the anthropic transport applies the declaration on the real wire body', async () => {
    const injected = vi.fn(async () => sseResponse(ANTHROPIC_EVENTS));
    const transport = new AnthropicTransport({
      provider: {
        apiKey: 'k',
        fetch: injected,
        capabilities: { thinking: false, promptCaching: 'automatic' },
      },
      env: {},
      debug: () => undefined,
    });
    const req: StreamRequest = {
      ...baseBody(),
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: 's', cache_control: { type: 'ephemeral' } }],
    };
    for await (const _e of transport.stream(req)) {
      // drain
    }
    const wire = JSON.parse(String(injected.mock.calls[0]![1]?.body));
    expect(wire.thinking).toBeUndefined();
    expect(JSON.stringify(wire)).not.toContain('cache_control');
  });
});

describe('encodeOpenAIRequest (capability declaration, openai wire)', () => {
  it('thinking: false suppresses reasoning_effort (and its max_completion_tokens side effect)', () => {
    const body = encodeOpenAIRequest(
      { ...baseBody(), model: 'gpt-test' },
      { reasoningEffort: 'high' },
      undefined,
      { thinking: false },
    );
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).toHaveProperty('max_tokens', 64);
    expect(body).not.toHaveProperty('max_completion_tokens');
    // Without the declaration the knob passes through unchanged.
    const undeclared = encodeOpenAIRequest(
      { ...baseBody(), model: 'gpt-test' },
      { reasoningEffort: 'high' },
    );
    expect(undeclared).toHaveProperty('reasoning_effort', 'high');
    expect(undeclared).toHaveProperty('max_completion_tokens', 64);
  });

  it('parallelToolCalls: false forces parallel_tool_calls: false when tools are present', () => {
    const withTools = encodeOpenAIRequest(
      {
        ...baseBody(),
        model: 'gpt-test',
        tools: [{ name: 'T', input_schema: { type: 'object' } } as never],
      },
      {},
      undefined,
      { parallelToolCalls: false },
    );
    expect(withTools).toHaveProperty('parallel_tool_calls', false);
    const noTools = encodeOpenAIRequest(
      { ...baseBody(), model: 'gpt-test' },
      {},
      undefined,
      { parallelToolCalls: false },
    );
    expect(noTools).not.toHaveProperty('parallel_tool_calls');
  });
});

describe('automation-continuation fragment (protocol-gated, e2e against fake endpoints)', () => {
  it('assembler: armed context appends the fragment LAST; unarmed bytes unchanged', () => {
    const base = assembleMainLoop({ toolNames: [] });
    const armed = assembleMainLoop({ toolNames: [], continuation: true });
    expect(base).not.toContain(FRAGMENT_MARK);
    expect(armed).toBe(`${base}\n\n${CONTINUATION_FRAGMENT.text}`);
  });

  async function runTask(options: Record<string, unknown>): Promise<void> {
    const q = query({ prompt: 'do the task', options: options as never });
    for await (const _m of q) {
      // drain to completion
    }
  }

  it('openai-chat default: the SAME task carries the fragment in the system message', async () => {
    const injected = vi.fn(async () => openaiSseResponse());
    await runTask({
      model: 'gpt-test',
      maxTurns: 1,
      provider: { protocol: 'openai-chat', apiKey: 'k', fetch: injected },
    });
    const wire = JSON.parse(String(injected.mock.calls[0]![1]?.body));
    const system = wire.messages.find((m: { role: string }) => m.role === 'system');
    expect(JSON.stringify(system?.content ?? '')).toContain(FRAGMENT_MARK);
  });

  it('anthropic default: the SAME task does NOT carry the fragment', async () => {
    const injected = vi.fn(async () => sseResponse(ANTHROPIC_EVENTS));
    await runTask({
      model: 'claude-test-1',
      maxTurns: 1,
      provider: { apiKey: 'k', fetch: injected },
    });
    const wire = JSON.parse(String(injected.mock.calls[0]![1]?.body));
    expect(JSON.stringify(wire.system ?? '')).not.toContain(FRAGMENT_MARK);
  });

  it('continuationPrompt: true arms it on anthropic; false disarms it on openai-chat', async () => {
    const anthropicFetch = vi.fn(async () => sseResponse(ANTHROPIC_EVENTS));
    await runTask({
      model: 'claude-test-1',
      maxTurns: 1,
      continuationPrompt: true,
      provider: { apiKey: 'k', fetch: anthropicFetch },
    });
    const anthropicWire = JSON.parse(String(anthropicFetch.mock.calls[0]![1]?.body));
    expect(JSON.stringify(anthropicWire.system)).toContain(FRAGMENT_MARK);

    const openaiFetch = vi.fn(async () => openaiSseResponse());
    await runTask({
      model: 'gpt-test',
      maxTurns: 1,
      continuationPrompt: false,
      provider: { protocol: 'openai-chat', apiKey: 'k', fetch: openaiFetch },
    });
    const openaiWire = JSON.parse(String(openaiFetch.mock.calls[0]![1]?.body));
    expect(JSON.stringify(openaiWire.messages)).not.toContain(FRAGMENT_MARK);
  });
});
