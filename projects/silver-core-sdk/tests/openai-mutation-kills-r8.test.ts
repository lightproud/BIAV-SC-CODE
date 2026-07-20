/**
 * Mutation-kill tests: OpenAI translating transport, batch 9 (T63 batch 3,
 * keeper order 2026-07-20 "立即开打"). Targets the message-ENCODING helpers
 * reachable through encodeOpenAIRequest (pure, observable via the emitted
 * request body): encodeSystem (empty -> no message), encodeMessage
 * (content-null + no tool_calls -> dropped; assistant tool_calls), the
 * tool_result -> tool-message flatten, encodeToolChoice (auto/any/tool/none +
 * disable_parallel_tool_use), and cleanBase64 whitespace stripping /
 * validation on image blocks. Behaviour assertions only — the imageStats
 * push mutants (L214-250) are deliberately left: they feed the debug summary
 * only and `stats` is always defined here, so `stats?.` is equivalent
 * (over-fit to assert debug output).
 */

import { describe, expect, it } from 'vitest';
import { encodeOpenAIRequest } from '../src/transport/openai.js';
import type { StreamRequest } from '../src/internal/contracts.js';

type Body = Record<string, unknown>;
type Msg = { role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string };
function enc(messages: unknown[], over: Partial<Omit<StreamRequest, 'signal' | 'onRetry'>> = {}): Msg[] {
  const body = encodeOpenAIRequest({ model: 'gpt-4o', max_tokens: 64, messages, ...over } as never) as Body;
  return body['messages'] as Msg[];
}

// ---------------------------------------------------------------------------
// encodeSystem — empty vs present
// ---------------------------------------------------------------------------

describe('encodeSystem', () => {
  it('a non-empty system prompt becomes a leading system message', () => {
    const msgs = enc([{ role: 'user', content: 'hi' }], { system: 'be terse' } as never);
    expect(msgs[0]).toMatchObject({ role: 'system', content: 'be terse' });
  });

  it('an EMPTY system string emits NO system message (length > 0 guard)', () => {
    const msgs = enc([{ role: 'user', content: 'hi' }], { system: '' } as never);
    expect(msgs.some((m) => m.role === 'system')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// encodeMessage — content-null + no tool_calls is dropped
// ---------------------------------------------------------------------------

describe('encodeMessage — assistant turns', () => {
  it('an assistant turn with NO text and NO tool_calls is dropped entirely (returns [])', () => {
    // content: [] -> texts empty -> content null, no tool_calls -> skipped.
    const msgs = enc([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [] },
      { role: 'user', content: 'q2' },
    ]);
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(0);
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(2);
  });

  it('an assistant turn with ONLY tool_calls (null text) is KEPT', () => {
    const msgs = enc([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'fn', input: { a: 1 } }] },
    ]);
    const a = msgs.find((m) => m.role === 'assistant')!;
    expect(a).toBeDefined();
    expect(a.content).toBeNull();
    expect(a.tool_calls).toBeDefined();
  });

  it('an assistant turn with text is kept with joined content', () => {
    const msgs = enc([
      { role: 'assistant', content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] },
    ]);
    expect(msgs.find((m) => m.role === 'assistant')!.content).toBe('line1\nline2');
  });
});

// ---------------------------------------------------------------------------
// flattenToolResultContent — tool_result -> tool message
// ---------------------------------------------------------------------------

describe('tool_result flatten', () => {
  it('a tool_result with a text part becomes a tool message with that text', () => {
    const msgs = enc([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu9', content: [{ type: 'text', text: 'the result' }] }],
      },
    ]);
    const tool = msgs.find((m) => m.role === 'tool')!;
    expect(tool).toBeDefined();
    expect(tool.tool_call_id).toBe('tu9');
    expect(tool.content).toBe('the result');
  });

  it('a tool_result with a plain string content is passed through', () => {
    const msgs = enc([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu10', content: 'plain string result' }] },
    ]);
    expect(msgs.find((m) => m.role === 'tool')!.content).toBe('plain string result');
  });
});

// ---------------------------------------------------------------------------
// encodeToolChoice — every arm + disable_parallel_tool_use
// ---------------------------------------------------------------------------

function withChoice(choice: unknown): Body {
  return encodeOpenAIRequest({
    model: 'gpt-4o',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'fn', description: 'd', input_schema: { type: 'object' } }],
    tool_choice: choice,
  } as never) as Body;
}

describe('encodeToolChoice', () => {
  it("type 'auto' -> tool_choice 'auto'", () => {
    expect(withChoice({ type: 'auto' })['tool_choice']).toBe('auto');
  });
  it("type 'any' -> tool_choice 'required'", () => {
    expect(withChoice({ type: 'any' })['tool_choice']).toBe('required');
  });
  it("type 'tool' -> function tool_choice with the name", () => {
    expect(withChoice({ type: 'tool', name: 'my_fn' })['tool_choice']).toEqual({
      type: 'function',
      function: { name: 'my_fn' },
    });
  });
  it("type 'none' -> tool_choice 'none'", () => {
    expect(withChoice({ type: 'none' })['tool_choice']).toBe('none');
  });
  it('disable_parallel_tool_use:true adds parallel_tool_calls:false', () => {
    expect(withChoice({ type: 'auto', disable_parallel_tool_use: true })['parallel_tool_calls']).toBe(false);
  });
  it('disable_parallel_tool_use:false does NOT add parallel_tool_calls', () => {
    expect('parallel_tool_calls' in withChoice({ type: 'auto', disable_parallel_tool_use: false })).toBe(false);
  });
  it("type 'none' ignores disable_parallel_tool_use (no parallel key on none arm)", () => {
    expect('parallel_tool_calls' in withChoice({ type: 'none', disable_parallel_tool_use: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cleanBase64 — whitespace strip + validation on image blocks
// ---------------------------------------------------------------------------

describe('cleanBase64 via image blocks', () => {
  const b64 = 'aGVsbG8='; // "hello"
  it('strips embedded whitespace from base64 image data and builds a data URL', () => {
    const msgs = enc([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVs\n bG8=' } },
        ],
      },
    ]);
    const user = msgs.find((m) => m.role === 'user')!;
    const part = (user.content as Array<{ type: string; image_url?: { url: string } }>)[0]!;
    expect(part.type).toBe('image_url');
    // whitespace stripped -> clean base64 in the data URL
    expect(part.image_url!.url).toBe(`data:image/png;base64,${b64}`);
  });

  it('a url-source image passes the url through verbatim', () => {
    const msgs = enc([
      {
        role: 'user',
        content: [{ type: 'image', source: { type: 'url', url: 'https://img.test/x.png' } }],
      },
    ]);
    const user = msgs.find((m) => m.role === 'user')!;
    const part = (user.content as Array<{ image_url?: { url: string } }>)[0]!;
    expect(part.image_url!.url).toBe('https://img.test/x.png');
  });

  it('invalid (non-base64) image data throws a locatable error', () => {
    expect(() =>
      enc([
        {
          role: 'user',
          content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'not*valid*b64!!' } }],
        },
      ]),
    ).toThrow();
  });
});
