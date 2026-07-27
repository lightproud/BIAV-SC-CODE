/**
 * Parser tests for `scripts/type-parity.mjs`.
 *
 * These are not decoration. Every case below is a shape that ALREADY produced a
 * false finding during the three hand-rolled sweeps of 2026-07-27 — the sweeps
 * whose repeated re-derivation is the reason that script exists. A comparator
 * that mis-parses does not fail loudly; it reports a confident, specific,
 * entirely fictional divergence, and someone then "fixes" a type that was never
 * wrong. So the parser gets pinned to the traps that actually sprang.
 */

import { describe, expect, it } from 'vitest';
import { flatten, typeBlocks } from '../scripts/type-parity.mjs';

describe('typeBlocks', () => {
  it('stops at the balanced close brace, not the first one', () => {
    const blocks = typeBlocks(`
      export interface A { a: { b: string }; c: string }
      export interface B { d: string }
    `);
    expect(Object.keys(blocks).sort()).toEqual(['A', 'B']);
    expect(blocks.A).toContain('c: string');
    expect(blocks.B).not.toContain('c: string');
  });

  it('does not let an empty single-line interface swallow the next block', () => {
    // The original trap: a lazy `[\s\S]*?\n\}` skipped past `{}` on one line and
    // closed on the NEXT type's brace, so every field of the next type was
    // reported as belonging to the empty one.
    const blocks = typeBlocks(`
      export interface Empty {}
      export interface Next { field: string }
    `);
    expect(flatten(blocks.Empty).size).toBe(0);
    expect([...flatten(blocks.Next)]).toEqual(['field']);
  });

  it('reads both `interface X {` and `type X = {` forms', () => {
    const blocks = typeBlocks(`
      export interface I { a: string }
      export type T = { b: string };
    `);
    expect([...flatten(blocks.I)]).toEqual(['a']);
    expect([...flatten(blocks.T)]).toEqual(['b']);
  });

  it('skips alias declarations that have no object body', () => {
    const blocks = typeBlocks(`
      export type Alias = SomethingElse;
      export type Obj = { a: string };
    `);
    expect(blocks.Alias).toBeUndefined();
    expect(blocks.Obj).toBeDefined();
  });
});

describe('flatten', () => {
  it('matches quoted keys, which is how dash-flags are spelled', () => {
    // Grep's `-i` / `-o` are only expressible as quoted keys. An unquoted-only
    // key regex silently reports every one of them as missing.
    expect([...flatten(`{ '-i'?: boolean; "-o"?: boolean; plain: string }`)].sort()).toEqual([
      '-i',
      '-o',
      'plain',
    ]);
  });

  it('nests with dotted paths', () => {
    expect([...flatten(`{ a: { b: { c: string } }; d: string }`)].sort()).toEqual([
      'a',
      'a.b',
      'a.b.c',
      'd',
    ]);
  });

  it('erases index signatures on both spellings', () => {
    // Official writes open dictionaries inline; this SDK writes Record<>. Left
    // un-erased, official grows a phantom field literally named after the index
    // variable (`metadata.k`, `answers.k`, `args.k` all showed up this way).
    expect([...flatten(`{ metadata?: { [k: string]: unknown } }`)].sort()).toEqual(['metadata']);
    expect([...flatten(`{ metadata?: Record<string, unknown> }`)].sort()).toEqual(['metadata']);
  });

  it('keeps tuple repetitions under the same parent', () => {
    // Official expands @minItems/@maxItems into literal tuples — one type
    // reaches 83KB that way. Element 2..N must land under the same parent as
    // element 1, not under element 1's last field and not at top level.
    const paths = flatten(`{
      questions: | [ { question: string; multiSelect?: boolean } ]
                 | [ { question: string; multiSelect?: boolean },
                     { question: string; multiSelect?: boolean } ];
    }`);
    expect([...paths].sort()).toEqual(['questions', 'questions.multiSelect', 'questions.question']);
  });

  it('ignores keys that appear inside doc comments', () => {
    const paths = flatten(`{
      /** Example: pass { mode: "fast" } to go faster. */
      real: string;
      // note: ignored
    }`);
    expect([...paths]).toEqual(['real']);
  });
});
