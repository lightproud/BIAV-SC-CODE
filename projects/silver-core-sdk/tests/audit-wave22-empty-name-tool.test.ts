/**
 * Keeper ruling 2026-07-29 (待裁①) — the OpenAI translator must not mint a
 * tool_use block the engine cannot dispatch.
 *
 * finish()'s pass-1 gate was "id OR name", so a buffer that collected an id but
 * never a NAME opened with `name: ''` — exactly the shape pass 2, one function
 * apart, refused to mint. The measured trigger is a gateway splitting ONE call
 * across an index-LESS id fragment and an index-only name/args fragment: the
 * output was TWO blocks, `{id:'call_abc', name:''}` plus
 * `{id:'call_0', name:'get_weather'}`. The first costs a round trip on
 * `No such tool: ` and forces stop_reason 'tool_use' for a call that does not
 * exist.
 */

import { describe, expect, it } from 'vitest';

import { OpenAIStreamTranslator } from '../src/transport/openai.js';
import type { RawMessageStreamEvent } from '../src/types.js';

type Start = Extract<RawMessageStreamEvent, { type: 'content_block_start' }>;

function toolStarts(events: RawMessageStreamEvent[]): Start[] {
  return events.filter(
    (e): e is Start => e.type === 'content_block_start' && e.content_block.type === 'tool_use',
  );
}

function stopReason(events: RawMessageStreamEvent[]): string | null | undefined {
  const d = events.find(
    (e): e is Extract<RawMessageStreamEvent, { type: 'message_delta' }> =>
      e.type === 'message_delta',
  );
  return d?.delta.stop_reason;
}

describe('wave22: no undispatchable empty-name tool_use block', () => {
  it('the split-call gateway shape yields ONE named block, not a nameless twin', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    const out: RawMessageStreamEvent[] = [];
    // Fragment A: an index-LESS id.
    out.push(
      ...t.feed({
        id: 'c1',
        choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ id: 'call_abc' }] } }],
      } as never),
    );
    // Fragment B: index-only name + args, no id.
    out.push(
      ...t.feed({
        id: 'c1',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, function: { name: 'get_weather', arguments: '{"city":"SF"}' } },
              ],
            },
          },
        ],
      } as never),
    );
    out.push(...t.finish());

    const starts = toolStarts(out);
    expect(starts).toHaveLength(1);
    expect((starts[0]!.content_block as { name: string }).name).toBe('get_weather');
    // Before the ruling this array also carried {id:'call_abc', name:''}.
    expect(starts.map((s) => (s.content_block as { name: string }).name)).not.toContain('');
  });

  it('a lone nameless id opens no block and fabricates no tool_use stop_reason', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    const out: RawMessageStreamEvent[] = [];
    out.push(
      ...t.feed({
        id: 'c1',
        choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'x' }] } }],
      } as never),
    );
    out.push(...t.finish());
    expect(toolStarts(out)).toHaveLength(0);
    expect(stopReason(out)).not.toBe('tool_use');
  });

  it('id + args but never a name mints nothing mid-stream either', () => {
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
              tool_calls: [{ index: 0, id: 'y', function: { arguments: '{"a":1}' } }],
            },
          },
        ],
      } as never),
    );
    out.push(...t.finish());
    expect(toolStarts(out)).toHaveLength(0);
  });

  // --- negative controls: real calls are untouched ---------------------------

  it('a conforming single-chunk tool call still emits with its name and args', () => {
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
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'Read', arguments: '{"p":1}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      } as never),
    );
    out.push(...t.finish());
    const starts = toolStarts(out);
    expect(starts).toHaveLength(1);
    expect((starts[0]!.content_block as { id: string; name: string })).toMatchObject({
      id: 'call_1',
      name: 'Read',
    });
    expect(stopReason(out)).toBe('tool_use');
  });

  it('a name split across chunks still emits once, complete', () => {
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
              tool_calls: [{ index: 0, id: 'call_2', function: { name: 'get_' } }],
            },
          },
        ],
      } as never),
    );
    out.push(
      ...t.feed({
        id: 'c1',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { name: 'weather', arguments: '{}' } }],
            },
          },
        ],
      } as never),
    );
    out.push(...t.finish());
    const starts = toolStarts(out);
    expect(starts).toHaveLength(1);
    expect((starts[0]!.content_block as { name: string }).name).toBe('get_weather');
  });

  it('an argument-less named call is still flushed by finish()', () => {
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
              tool_calls: [{ index: 0, id: 'call_3', function: { name: 'TodoWrite' } }],
            },
          },
        ],
      } as never),
    );
    out.push(...t.finish());
    const starts = toolStarts(out);
    expect(starts).toHaveLength(1);
    expect((starts[0]!.content_block as { name: string }).name).toBe('TodoWrite');
    expect(stopReason(out)).toBe('tool_use');
  });
});
