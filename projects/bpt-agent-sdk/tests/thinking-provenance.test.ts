/**
 * Cross-model thinking-block hygiene (BPT request 2026-07-07) — unit coverage
 * of the strip logic. Engine-level end-to-end (fallback switch / resume replay /
 * the mid-tool-loop edge) lives in engine.test.ts where the loop harness is.
 *
 * §6 test plan mapping: (2) same model not over-stripped; (1) cross-model
 * stripped, text/tool_use intact; resume (no stamp) stripped; (3) in-flight
 * tool-loop turn protected; redacted_thinking covered.
 */

import { describe, expect, it } from 'vitest';

import {
  protectedTurnIndex,
  signingModelOf,
  stampSigningModel,
  stripStaleThinking,
} from '../src/engine/thinking-provenance.js';
import type { APIMessageParam, ContentBlockParam } from '../src/types.js';

function thinking(text = 'draft', signature = 'sig'): ContentBlockParam {
  return { type: 'thinking', thinking: text, signature } as ContentBlockParam;
}
function redacted(data = 'xxx'): ContentBlockParam {
  return { type: 'redacted_thinking', data } as ContentBlockParam;
}
function text(t: string): ContentBlockParam {
  return { type: 'text', text: t } as ContentBlockParam;
}
function toolUse(id: string): ContentBlockParam {
  return { type: 'tool_use', id, name: 'Read', input: {} } as ContentBlockParam;
}
function toolResult(id: string): ContentBlockParam {
  return { type: 'tool_result', tool_use_id: id, content: 'ok' } as ContentBlockParam;
}
function assistant(content: ContentBlockParam[], model?: string): APIMessageParam {
  const m: APIMessageParam = { role: 'assistant', content };
  if (model) stampSigningModel(m, model);
  return m;
}
function user(content: string | ContentBlockParam[]): APIMessageParam {
  return { role: 'user', content };
}
function types(m: APIMessageParam): string[] {
  return Array.isArray(m.content) ? m.content.map((b) => b.type) : ['<string>'];
}

describe('signing-model stamp', () => {
  it('round-trips a non-enumerable stamp that never serializes to JSON', () => {
    const m = assistant([thinking(), text('hi')], 'A');
    expect(signingModelOf(m)).toBe('A');
    // the symbol stamp must not leak onto the wire
    expect(JSON.parse(JSON.stringify(m))).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'draft', signature: 'sig' },
        { type: 'text', text: 'hi' },
      ],
    });
  });
  it('is undefined on an unstamped (e.g. resumed) turn', () => {
    expect(signingModelOf(user('hi'))).toBeUndefined();
  });
});

describe('protectedTurnIndex', () => {
  it('protects the last assistant when the request is a tool-loop continuation', () => {
    const msgs = [user('go'), assistant([thinking(), toolUse('t1')], 'A'), user([toolResult('t1')])];
    expect(protectedTurnIndex(msgs)).toBe(1);
  });
  it('protects nothing when the last message is a fresh user prompt', () => {
    const msgs = [user('go'), assistant([thinking(), text('done')], 'A'), user('again')];
    expect(protectedTurnIndex(msgs)).toBe(-1);
  });
});

describe('stripStaleThinking', () => {
  it('(§6.1) strips thinking from a cross-model CLOSED turn; text/tool_use survive', () => {
    const msgs = [
      user('go'),
      assistant([thinking(), text('answer'), toolUse('t1')], 'A'),
      user([toolResult('t1')]),
      assistant([text('more')], 'A'),
      user('next'),
    ];
    const out = stripStaleThinking(msgs, 'B');
    // the first assistant (closed, model A, target B) loses thinking, keeps rest
    expect(types(out[1]!)).toEqual(['text', 'tool_use']);
    expect(out).not.toBe(msgs); // a change happened -> new array
  });

  it('(§6.2) leaves same-model thinking intact and returns the SAME array (cache-safe)', () => {
    const msgs = [user('go'), assistant([thinking(), text('answer')], 'B'), user('next')];
    const out = stripStaleThinking(msgs, 'B');
    expect(types(out[1]!)).toEqual(['thinking', 'text']);
    expect(out).toBe(msgs); // identity -> no request-byte churn
  });

  it('strips an UNSTAMPED closed turn (resume path — provenance unknown = stale)', () => {
    const stale = assistant([thinking(), text('a')]); // no stamp
    const msgs = [user('go'), stale, user('next')];
    const out = stripStaleThinking(msgs, 'B');
    expect(types(out[1]!)).toEqual(['text']);
  });

  it('(§6.3) NEVER strips the in-flight tool-loop turn, even cross-model', () => {
    const msgs = [user('go'), assistant([thinking(), toolUse('t1')], 'A'), user([toolResult('t1')])];
    const out = stripStaleThinking(msgs, 'B');
    // protected turn keeps its thinking (API requires it before the tool_use)
    expect(types(out[1]!)).toEqual(['thinking', 'tool_use']);
    expect(out).toBe(msgs);
  });

  it('covers redacted_thinking the same as thinking', () => {
    const msgs = [user('go'), assistant([redacted(), text('a')], 'A'), user('next')];
    const out = stripStaleThinking(msgs, 'B');
    expect(types(out[1]!)).toEqual(['text']);
  });

  it('strips EARLIER cross-model turns while protecting the in-flight one', () => {
    const msgs = [
      user('go'),
      assistant([thinking(), text('turn1')], 'A'), // closed, cross-model -> strip
      user('again'),
      assistant([thinking(), toolUse('t2')], 'A'), // in-flight -> keep
      user([toolResult('t2')]),
    ];
    const out = stripStaleThinking(msgs, 'B');
    expect(types(out[1]!)).toEqual(['text']); // stripped
    expect(types(out[3]!)).toEqual(['thinking', 'tool_use']); // protected
  });
});
