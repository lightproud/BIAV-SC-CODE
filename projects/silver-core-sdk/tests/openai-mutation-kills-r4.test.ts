/**
 * Mutation-kill tests: OpenAI translating transport, batch 5 (final, T39
 * round-4 triage; 78.64% after batches 1-4). Micro-semantic edges of the
 * OpenAIStreamTranslator state machine: exact message_start shape, empty
 * deltas that must NOT open blocks, null-usage non-clobbering, choice-less
 * chunks, empty-string tool ids, and no-empty-argument-delta emission.
 */

import { describe, expect, it } from 'vitest';
import { OpenAIStreamTranslator } from '../src/transport/openai.js';
import type { RawMessageStreamEvent } from '../src/types.js';

type Chunk = Record<string, unknown>;
function fresh(): OpenAIStreamTranslator {
  return new OpenAIStreamTranslator('gpt-4o');
}
function feedAll(chunks: Chunk[]): RawMessageStreamEvent[] {
  const t = fresh();
  const out: RawMessageStreamEvent[] = [];
  for (const c of chunks) out.push(...t.feed(c as never));
  out.push(...t.finish());
  return out;
}

describe('OpenAIStreamTranslator micro-semantics (final batch)', () => {
  it('message_start carries the exact synthetic shape, exactly once', () => {
    const t = fresh();
    const first = t.feed({ id: 'c9', model: 'gpt-4o-mini', choices: [{ index: 0, delta: { role: 'assistant' } }] } as never);
    const starts = first.filter((e) => e.type === 'message_start');
    expect(starts).toHaveLength(1);
    expect((starts[0] as { message: unknown }).message).toEqual({
      id: 'c9',
      type: 'message',
      role: 'assistant',
      model: 'gpt-4o-mini',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const second = t.feed({ id: 'c9', choices: [{ index: 0, delta: { content: 'x' } }] } as never);
    expect(second.filter((e) => e.type === 'message_start')).toHaveLength(0);
  });

  it('an EMPTY content delta opens no text block and emits no delta', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]);
    expect(events.filter((e) => e.type === 'content_block_start')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'content_block_delta')).toHaveLength(0);
  });

  it('an EMPTY reasoning delta opens no thinking block', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '' } }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]);
    expect(events.filter((e) => e.type === 'content_block_start')).toHaveLength(0);
  });

  it('a chunk with NO choices and a chunk with a delta-less choice are inert (no throw, no blocks)', () => {
    const events = feedAll([
      { id: 'c1' }, // usage-only / keepalive shape: no choices at all
      { id: 'c1', choices: [{ index: 0, finish_reason: 'stop' }] }, // choice without delta
    ]);
    expect(events.filter((e) => e.type === 'content_block_start')).toHaveLength(0);
    const md = events.find((e) => e.type === 'message_delta') as { delta: { stop_reason: string } };
    expect(md.delta.stop_reason).toBe('end_turn');
  });

  it('usage:null and usage:undefined never clobber previously captured usage', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
      { id: 'c1', choices: [{ index: 0, delta: { content: 'y' } }], usage: null },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]);
    const md = events.find((e) => e.type === 'message_delta') as { usage: Record<string, number> };
    expect(md.usage.input_tokens).toBe(10);
    expect(md.usage.output_tokens).toBe(2);
  });

  it('an EMPTY-STRING tool id is not adopted: the call flushes with a synthetic id', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: '', function: { name: 'n', arguments: '{}' } }] } }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const start = events.find(
      (e): e is Extract<RawMessageStreamEvent, { type: 'content_block_start' }> =>
        e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    )!;
    expect((start.content_block as { id: string }).id).toMatch(/^call_/);
  });

  it('a tool block opened with NO pending args emits no empty input_json_delta', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_z', function: { name: 'z' } }] } }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const argDeltas = events.filter(
      (e) => e.type === 'content_block_delta' && e.delta.type === 'input_json_delta',
    );
    expect(argDeltas).toHaveLength(0);
    // the block itself still opened and closed
    expect(events.some((e) => e.type === 'content_block_start')).toBe(true);
  });

  it('finish_reason captured on an EARLIER chunk survives trailing delta-less chunks', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'x' }, finish_reason: 'length' }] },
      { id: 'c1', choices: [{ index: 0 }] }, // trailing keepalive without delta/finish
    ]);
    const md = events.find((e) => e.type === 'message_delta') as { delta: { stop_reason: string } };
    expect(md.delta.stop_reason).toBe('max_tokens');
  });

  it('text after reasoning lands in a SEPARATE block; both close at finish', () => {
    const events = feedAll([
      { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'think' } }] },
      { id: 'c1', choices: [{ index: 0, delta: { content: 'speak' } }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]);
    const starts = events.filter(
      (e): e is Extract<RawMessageStreamEvent, { type: 'content_block_start' }> => e.type === 'content_block_start',
    );
    expect(starts.map((s) => s.content_block.type)).toEqual(['thinking', 'text']);
    expect(new Set(starts.map((s) => s.index)).size).toBe(2);
    expect(events.filter((e) => e.type === 'content_block_stop')).toHaveLength(2);
  });
});
