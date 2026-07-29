/**
 * Audit wave 21 — the public token estimator threw on host-built drafts.
 *
 * engine/tokens.ts has already been hardened twice against crashes that
 * "escaped out of the compaction trigger AND out of the public
 * estimateMessagesTokens" (a `for...of null`, an `undefined` return turning the
 * total into NaN). A THROWING JSON.stringify was the same escape by a different
 * door — and the one shape a HOST-BUILT draft actually hits, since
 * estimateMessagesTokens has been public since 0.97.0 precisely so a host can
 * measure material it has NOT sent yet: objects assembled in JS, never
 * round-tripped through JSON, where a BigInt field or a back-reference is
 * ordinary rather than exotic.
 */

import { describe, expect, it } from 'vitest';

import { estimateMessagesTokens } from '../src/index.js';
import type { APIMessageParam } from '../src/types.js';

function circular(): Record<string, unknown> {
  const o: Record<string, unknown> = { a: 1, note: 'some text' };
  o.self = o;
  return o;
}

describe('wave21: estimateMessagesTokens degrades instead of throwing', () => {
  it('a circular tool_use input is estimated, not thrown on', () => {
    const msgs = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'X', input: circular() }] },
    ] as unknown as APIMessageParam[];
    let n = 0;
    expect(() => {
      n = estimateMessagesTokens(msgs);
    }).not.toThrow();
    expect(n).toBeGreaterThan(0);
  });

  it('a BigInt in a tool_use input is estimated, not thrown on', () => {
    const msgs = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'X', input: { id: 10n } }] },
    ] as unknown as APIMessageParam[];
    expect(() => estimateMessagesTokens(msgs)).not.toThrow();
  });

  it('an unmodeled block type with a cycle is estimated, not thrown on', () => {
    // The default branch serializes the whole block; a cycle anywhere in it
    // used to take the entire history estimate down.
    const msgs = [
      { role: 'assistant', content: [{ type: 'server_tool_use', payload: circular() }] },
    ] as unknown as APIMessageParam[];
    expect(() => estimateMessagesTokens(msgs)).not.toThrow();
  });

  it('a block whose accessor throws is absorbed (both the estimate and its cache probe)', () => {
    const block = Object.defineProperty({ type: 'text' }, 'text', {
      get() {
        throw new Error('lazily-materialized block failed');
      },
    });
    const msgs = [{ role: 'user', content: [block] }] as unknown as APIMessageParam[];
    expect(() => estimateMessagesTokens(msgs)).not.toThrow();
    // Called twice: the second call goes through the cache-validation path,
    // which reads the same accessor.
    expect(() => estimateMessagesTokens(msgs)).not.toThrow();
  });

  // --- negative controls: ordinary estimates are unchanged ------------------

  it('an ordinary tool_use input still costs what it did', () => {
    const msgs = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't', name: 'Read', input: { file_path: '/a/b.ts' } }],
      },
    ] as unknown as APIMessageParam[];
    // 8 (message) + 3 (block) + ceil(4/4) name + ceil(24/4) input == 18
    expect(estimateMessagesTokens(msgs)).toBe(18);
  });

  it('plain text and CJK text are unchanged', () => {
    const latin = [{ role: 'user', content: 'abcdefgh' }] as unknown as APIMessageParam[];
    expect(estimateMessagesTokens(latin)).toBe(8 + 2);
    const cjk = [{ role: 'user', content: '你好世界' }] as unknown as APIMessageParam[];
    expect(estimateMessagesTokens(cjk)).toBe(8 + 4);
  });

  it('a degraded payload still charges for the text it contains', () => {
    // The replacer keeps the readable fields, so the estimate tracks real size
    // rather than collapsing to the block overhead.
    const big = { note: 'x'.repeat(400) } as Record<string, unknown>;
    big.self = big;
    const msgs = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'X', input: big }] },
    ] as unknown as APIMessageParam[];
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(100);
  });
});
