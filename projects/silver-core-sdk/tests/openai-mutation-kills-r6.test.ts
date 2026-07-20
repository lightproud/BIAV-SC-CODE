/**
 * Mutation-kill tests: OpenAI translating transport, batch 7 (T63, keeper
 * order 2026-07-20 "立即开打"). The weekly ratchet dropped transport-openai to
 * 77.14% (floor 85.55%) after the 0.70.1/0.72.1 expansion added branches to
 * the decoder + encodeOpenAIRequest without matching kill tests. This batch
 * targets the two PURE clusters — the OpenAIStreamTranslator state machine
 * (usage merge, array-content flatten, reasoning-vs-reasoning_content
 * priority, refusal, tool_call field guards, finish() stop-reason decisions,
 * mapFinishReason table) and encodeOpenAIRequest (capability degradation:
 * reasoning_effort suppression, temperature guard, forceSerialTools,
 * max*_tokens param selection, tool encoding) — via direct assertions on the
 * exported surface, no fetch/SSE mocking (Transport-class survivors, many of
 * which the 2026-07-13 100%-question analysis marks as over-fit risk, are
 * left out).
 */

import { describe, expect, it } from 'vitest';
import { OpenAIStreamTranslator, encodeOpenAIRequest } from '../src/transport/openai.js';
import type { RawMessageStreamEvent } from '../src/types.js';
import type { StreamRequest } from '../src/internal/contracts.js';

// ---------------------------------------------------------------------------
// Decoder helpers
// ---------------------------------------------------------------------------

type Chunk = Record<string, unknown>;
function feed(chunks: Chunk[], model = 'gpt-4o'): RawMessageStreamEvent[] {
  const t = new OpenAIStreamTranslator(model);
  const out: RawMessageStreamEvent[] = [];
  for (const c of chunks) out.push(...t.feed(c as never));
  out.push(...t.finish());
  return out;
}
const messageDelta = (ev: RawMessageStreamEvent[]) =>
  ev.find((e): e is Extract<RawMessageStreamEvent, { type: 'message_delta' }> => e.type === 'message_delta')!;
const stopReasonOf = (ev: RawMessageStreamEvent[]) => messageDelta(ev).delta.stop_reason;
const usageOf = (ev: RawMessageStreamEvent[]) =>
  messageDelta(ev).usage as { output_tokens: number; input_tokens?: number; cache_read_input_tokens?: number };
const textOf = (ev: RawMessageStreamEvent[]) =>
  ev
    .filter(
      (e): e is Extract<RawMessageStreamEvent, { type: 'content_block_delta' }> =>
        e.type === 'content_block_delta' && e.delta.type === 'text_delta',
    )
    .map((e) => (e.delta as { text: string }).text)
    .join('');
const thinkingOf = (ev: RawMessageStreamEvent[]) =>
  ev
    .filter(
      (e): e is Extract<RawMessageStreamEvent, { type: 'content_block_delta' }> =>
        e.type === 'content_block_delta' && e.delta.type === 'thinking_delta',
    )
    .map((e) => (e.delta as { thinking: string }).thinking)
    .join('');
const toolBlocks = (ev: RawMessageStreamEvent[]) =>
  ev
    .filter(
      (e): e is Extract<RawMessageStreamEvent, { type: 'content_block_start' }> =>
        e.type === 'content_block_start',
    )
    .map((e) => e.content_block)
    .filter((b): b is { type: 'tool_use'; id: string; name: string; input: unknown } => b.type === 'tool_use');
const jsonFor = (ev: RawMessageStreamEvent[], index: number) =>
  ev
    .filter(
      (e): e is Extract<RawMessageStreamEvent, { type: 'content_block_delta' }> =>
        e.type === 'content_block_delta' && e.index === index && e.delta.type === 'input_json_delta',
    )
    .map((e) => (e.delta as { partial_json: string }).partial_json)
    .join('');

// ---------------------------------------------------------------------------
// finish(): usage split (cached tokens) + prompt_tokens_details shallow merge
// ---------------------------------------------------------------------------

describe('OpenAIStreamTranslator.finish — usage accounting', () => {
  it('splits OpenAI prompt_tokens (incl. cache) into input_tokens + cache_read_input_tokens', () => {
    const ev = feed([
      { id: 'c', choices: [{ index: 0, delta: { role: 'assistant', content: 'hi' } }],
        usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 30 } } },
      { id: 'c', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { completion_tokens: 20 } },
    ]);
    const u = usageOf(ev);
    // input_tokens = prompt(100) - cached(30) = 70; cache_read = 30; output = 20.
    expect(u.input_tokens).toBe(70);
    expect(u.cache_read_input_tokens).toBe(30);
    expect(u.output_tokens).toBe(20);
  });

  it('omits cache_read_input_tokens entirely when no cached tokens (cached === 0 branch)', () => {
    const ev = feed([
      { id: 'c', choices: [{ index: 0, delta: { content: 'x' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 40, completion_tokens: 5 } },
    ]);
    const u = usageOf(ev);
    expect(u.input_tokens).toBe(40);
    expect('cache_read_input_tokens' in u).toBe(false);
  });

  it('SHALLOW-MERGES usage across chunks incl. prompt_tokens_details sub-object', () => {
    // prompt_tokens arrives early; completion_tokens + cached_tokens in the
    // final summary. A replace-not-merge would lose prompt_tokens (input 0).
    const ev = feed([
      { id: 'c', choices: [{ index: 0, delta: { content: 'hi' } }],
        usage: { prompt_tokens: 200 } },
      { id: 'c', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { completion_tokens: 9, prompt_tokens_details: { cached_tokens: 50 } } },
    ]);
    const u = usageOf(ev);
    expect(u.input_tokens).toBe(150); // 200 - 50, proving prompt_tokens survived the merge
    expect(u.cache_read_input_tokens).toBe(50);
    expect(u.output_tokens).toBe(9);
  });

  it('clamps input_tokens at 0 when cached exceeds prompt (Math.max floor)', () => {
    const ev = feed([
      { id: 'c', choices: [{ index: 0, delta: { content: 'x' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens: 1 } },
    ]);
    expect(usageOf(ev).input_tokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// feed(): array-form content flatten (WV2-3) — was NoCoverage
// ---------------------------------------------------------------------------

describe('OpenAIStreamTranslator.feed — array-form content flatten', () => {
  it('flattens an array of text-ish parts (string | {text}) and drops non-text parts to empty', () => {
    const ev = feed([
      { id: 'c', choices: [{ index: 0, delta: { content: ['a', { text: 'b' }, { image: 1 }, 'c'] }, finish_reason: 'stop' }] },
    ]);
    // 'a' + 'b' + '' (non-text part) + 'c' = 'abc'
    expect(textOf(ev)).toBe('abc');
    expect(stopReasonOf(ev)).toBe('end_turn');
  });

  it('a bare-string content still decodes (non-array passthrough)', () => {
    const ev = feed([{ id: 'c', choices: [{ index: 0, delta: { content: 'plain' }, finish_reason: 'stop' }] }]);
    expect(textOf(ev)).toBe('plain');
  });

  it('an array content of only non-text parts contributes NO text (flatten -> empty)', () => {
    // flatten -> '' -> no text block opened; finish() itself does not throw
    // (the empty_message guard lives in the transport layer, not the translator).
    const ev = feed([{ id: 'c', choices: [{ index: 0, delta: { content: [{ image: 1 }] }, finish_reason: 'stop' }] }]);
    expect(textOf(ev)).toBe('');
    expect(stopReasonOf(ev)).toBe('end_turn');
  });
});

// ---------------------------------------------------------------------------
// feed(): reasoning_content vs reasoning priority
// ---------------------------------------------------------------------------

describe('OpenAIStreamTranslator.feed — reasoning field priority', () => {
  it('a populated reasoning_content is used verbatim as thinking', () => {
    const ev = feed([{ id: 'c', choices: [{ index: 0, delta: { reasoning_content: 'deep', content: 'ans' }, finish_reason: 'stop' }] }]);
    expect(thinkingOf(ev)).toBe('deep');
  });

  it('an EMPTY reasoning_content does not mask a populated reasoning (dual-field gateway)', () => {
    // reasoning_content:'' + reasoning:'fromR' -> must pick reasoning, not ''.
    const ev = feed([{ id: 'c', choices: [{ index: 0, delta: { reasoning_content: '', reasoning: 'fromR', content: 'ans' }, finish_reason: 'stop' }] }]);
    expect(thinkingOf(ev)).toBe('fromR');
  });

  it('reasoning array form flattens to joined thinking', () => {
    const ev = feed([{ id: 'c', choices: [{ index: 0, delta: { reasoning: [{ text: 'x' }, 'y'], content: 'a' }, finish_reason: 'stop' }] }]);
    expect(thinkingOf(ev)).toBe('xy');
  });
});

// ---------------------------------------------------------------------------
// feed(): refusal -> visible text + stop_reason refusal (Roa-1)
// ---------------------------------------------------------------------------

describe('OpenAIStreamTranslator — refusal handling', () => {
  it('surfaces delta.refusal as assistant text and maps stop_reason to refusal', () => {
    const ev = feed([{ id: 'c', choices: [{ index: 0, delta: { refusal: 'I cannot help with that' }, finish_reason: 'stop' }] }]);
    expect(textOf(ev)).toBe('I cannot help with that');
    expect(stopReasonOf(ev)).toBe('refusal');
  });

  it('an explicit content_filter finish still wins over the refusal->refusal path (both map refusal here)', () => {
    const ev = feed([{ id: 'c', choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: 'content_filter' }] }]);
    expect(stopReasonOf(ev)).toBe('refusal');
  });

  it('an empty refusal string does NOT flip refusalSeen (length > 0 guard)', () => {
    // refusal:'' with real content -> normal end_turn, no refusal.
    const ev = feed([{ id: 'c', choices: [{ index: 0, delta: { refusal: '', content: 'hi' }, finish_reason: 'stop' }] }]);
    expect(stopReasonOf(ev)).toBe('end_turn');
    expect(textOf(ev)).toBe('hi');
  });
});

// ---------------------------------------------------------------------------
// feed()/finish(): tool_call field guards + stop_reason inference
// ---------------------------------------------------------------------------

describe('OpenAIStreamTranslator — tool_calls', () => {
  it('assembles a single tool_call (id+name+args) into one tool_use block', () => {
    const ev = feed([
      { id: 'c', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"NYC"}' } }] } }] },
      { id: 'c', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const blocks = toolBlocks(ev);
    expect(blocks.map((b) => [b.id, b.name])).toEqual([['call_1', 'get_weather']]);
    expect(jsonFor(ev, (ev.find((e) => e.type === 'content_block_start') as { index: number }).index)).toBe('{"city":"NYC"}');
    expect(stopReasonOf(ev)).toBe('tool_use');
  });

  it('infers stop_reason tool_use when a real tool call arrives with NO finish_reason (M-5)', () => {
    const ev = feed([
      { id: 'c', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_x', function: { name: 'fn', arguments: '{}' } }] } }] },
      // No finish_reason anywhere (bare [DONE]) — must still be tool_use, not end_turn.
    ]);
    expect(stopReasonOf(ev)).toBe('tool_use');
    expect(toolBlocks(ev).map((b) => b.name)).toEqual(['fn']);
  });

  it('an EMPTY placeholder tool_call ({index:0} only) opens NO tool block and stays end_turn', () => {
    // A pure placeholder (no id/name/args) is skipped by both flush passes and
    // does not count toward hasRealTool — with an explicit 'stop' it maps end_turn.
    const ev = feed([{ id: 'c', choices: [{ index: 0, delta: { tool_calls: [{ index: 0 }] }, finish_reason: 'stop' }] }]);
    expect(toolBlocks(ev)).toHaveLength(0);
    expect(stopReasonOf(ev)).toBe('end_turn');
  });

  it('keys concurrent tool_calls by index — two ids stay distinct blocks', () => {
    const ev = feed([
      { id: 'c', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'fa', arguments: '{"p":1}' } }] } }] },
      { id: 'c', choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'fb', arguments: '{"q":2}' } }] } }] },
      { id: 'c', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    expect(toolBlocks(ev).map((b) => [b.id, b.name])).toEqual([['a', 'fa'], ['b', 'fb']]);
  });

  it('legacy singular function_call streams into a synthetic tool_use with function_call finish', () => {
    const ev = feed([
      { id: 'c', choices: [{ index: 0, delta: { function_call: { name: 'legacy_fn', arguments: '{"z":9}' } } }] },
      { id: 'c', choices: [{ index: 0, delta: {}, finish_reason: 'function_call' }] },
    ]);
    const blocks = toolBlocks(ev);
    expect(blocks.map((b) => b.name)).toEqual(['legacy_fn']);
    expect(stopReasonOf(ev)).toBe('tool_use');
  });
});

// ---------------------------------------------------------------------------
// mapFinishReason table (via finish stop_reason)
// ---------------------------------------------------------------------------

describe('mapFinishReason table', () => {
  const cases: Array<[string, string]> = [
    ['length', 'max_tokens'],
    ['stop', 'end_turn'],
    ['content_filter', 'refusal'],
  ];
  for (const [reason, expected] of cases) {
    it(`finish_reason '${reason}' -> ${expected}`, () => {
      const ev = feed([{ id: 'c', choices: [{ index: 0, delta: { content: 'body' }, finish_reason: reason }] }]);
      expect(stopReasonOf(ev)).toBe(expected);
    });
  }

  it("an UNRECOGNIZED finish_reason throws a truncated-turn error, not a clean map", () => {
    expect(() =>
      feed([{ id: 'c', choices: [{ index: 0, delta: { content: 'body' }, finish_reason: 'insufficient_system_resource' }] }]),
    ).toThrow(/unrecognized finish_reason|truncated/i);
  });
});

// ---------------------------------------------------------------------------
// encodeOpenAIRequest — capability degradation + param selection
// ---------------------------------------------------------------------------

function baseReq(over: Partial<Omit<StreamRequest, 'signal' | 'onRetry'>> = {}): Omit<StreamRequest, 'signal' | 'onRetry'> {
  return { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], max_tokens: 256, ...over } as Omit<StreamRequest, 'signal' | 'onRetry'>;
}

describe('encodeOpenAIRequest — capability degradation', () => {
  it('caps.thinking:false SUPPRESSES reasoning_effort even when opts request it', () => {
    const out = encodeOpenAIRequest(baseReq(), { reasoningEffort: 'high' }, undefined, { thinking: false } as never);
    expect('reasoning_effort' in out).toBe(false);
  });

  it('caps.thinking:true (or undefined) PASSES reasoning_effort through', () => {
    const out = encodeOpenAIRequest(baseReq(), { reasoningEffort: 'high' }, undefined, { thinking: true } as never);
    expect(out['reasoning_effort']).toBe('high');
    const outUnknown = encodeOpenAIRequest(baseReq(), { reasoningEffort: 'low' });
    expect(outUnknown['reasoning_effort']).toBe('low');
  });

  it('reasoning active -> max_completion_tokens; no reasoning -> max_tokens (param selection)', () => {
    const reasoning = encodeOpenAIRequest(baseReq(), { reasoningEffort: 'medium' }, undefined, { thinking: true } as never);
    expect(reasoning['max_completion_tokens']).toBe(256);
    expect('max_tokens' in reasoning).toBe(false);
    const plain = encodeOpenAIRequest(baseReq());
    expect(plain['max_tokens']).toBe(256);
    expect('max_completion_tokens' in plain).toBe(false);
  });

  it('explicit opts.maxTokensParam wins over the reasoning default', () => {
    const out = encodeOpenAIRequest(baseReq(), { reasoningEffort: 'high', maxTokensParam: 'max_tokens' }, undefined, { thinking: true } as never);
    expect(out['max_tokens']).toBe(256);
  });

  it('forceSerialTools: caps.parallelToolCalls:false + tools -> parallel_tool_calls:false', () => {
    const req = baseReq({ tools: [{ name: 'fn', description: 'd', input_schema: { type: 'object' } }] as never });
    const out = encodeOpenAIRequest(req, {}, undefined, { parallelToolCalls: false } as never);
    expect(out['parallel_tool_calls']).toBe(false);
  });

  it('NO parallel_tool_calls key when caps allow parallel (or no tools)', () => {
    const req = baseReq({ tools: [{ name: 'fn', description: 'd', input_schema: { type: 'object' } }] as never });
    const withParallel = encodeOpenAIRequest(req, {}, undefined, { parallelToolCalls: true } as never);
    expect('parallel_tool_calls' in withParallel).toBe(false);
    const noTools = encodeOpenAIRequest(baseReq(), {}, undefined, { parallelToolCalls: false } as never);
    expect('parallel_tool_calls' in noTools).toBe(false);
  });
});

describe('encodeOpenAIRequest — temperature guard (WV2-4, T60)', () => {
  it('DROPS a caller temperature != 1 ONLY on a declared thinking endpoint with reasoning active', () => {
    const out = encodeOpenAIRequest(baseReq({ temperature: 0.5 }), { reasoningEffort: 'high' }, undefined, { thinking: true } as never);
    expect('temperature' in out).toBe(false);
  });

  it('PASSES temperature != 1 on an UNKNOWN gateway (caps undefined) — never rewrite intent', () => {
    const out = encodeOpenAIRequest(baseReq({ temperature: 0.5 }), { reasoningEffort: 'high' });
    expect(out['temperature']).toBe(0.5);
  });

  it('PASSES temperature != 1 on a declared thinking:false endpoint (vLLM/Qwen)', () => {
    const out = encodeOpenAIRequest(baseReq({ temperature: 0.5 }), { reasoningEffort: 'high' }, undefined, { thinking: false } as never);
    expect(out['temperature']).toBe(0.5);
  });

  it('PASSES temperature === 1 through even on a thinking endpoint (always safe)', () => {
    const out = encodeOpenAIRequest(baseReq({ temperature: 1 }), { reasoningEffort: 'high' }, undefined, { thinking: true } as never);
    expect(out['temperature']).toBe(1);
  });

  it('does NOT drop temperature when reasoning is inactive, even on a thinking endpoint', () => {
    const out = encodeOpenAIRequest(baseReq({ temperature: 0.5 }), {}, undefined, { thinking: true } as never);
    expect(out['temperature']).toBe(0.5);
  });
});

describe('encodeOpenAIRequest — tools encoding', () => {
  it('encodes a custom tool with name/description/parameters and a tools key', () => {
    const req = baseReq({ tools: [{ name: 'get_x', description: 'gets x', input_schema: { type: 'object', properties: {} } }] as never });
    const out = encodeOpenAIRequest(req);
    const tools = out['tools'] as Array<{ type: string; function: { name: string; description?: string; parameters: unknown } }>;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.type).toBe('function');
    expect(tools[0]!.function.name).toBe('get_x');
    expect(tools[0]!.function.description).toBe('gets x');
    expect(tools[0]!.function.parameters).toEqual({ type: 'object', properties: {} });
  });

  it('omits description key when the tool has none', () => {
    const req = baseReq({ tools: [{ name: 'no_desc', input_schema: { type: 'object' } }] as never });
    const out = encodeOpenAIRequest(req);
    const tools = out['tools'] as Array<{ function: Record<string, unknown> }>;
    expect('description' in tools[0]!.function).toBe(false);
  });

  it('drops a tool whose input_schema is not a plain object (null/array/primitive) — no tools key', () => {
    const req = baseReq({ tools: [{ name: 'bad', input_schema: null }, { name: 'bad2', input_schema: [1] }] as never });
    const out = encodeOpenAIRequest(req);
    expect('tools' in out).toBe(false);
  });

  it('no tool_choice key emitted when there are no tools', () => {
    const out = encodeOpenAIRequest(baseReq({ tool_choice: { type: 'auto' } as never }));
    expect('tool_choice' in out).toBe(false);
  });
});
