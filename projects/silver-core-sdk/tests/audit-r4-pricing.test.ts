/**
 * Regression tests for audit r4 cluster "pricing":
 *  - U5-1: PRICE_TABLE was missing the original claude-3-sonnet- prefix.
 *  - U5-2: Claude 3 Haiku cache rates used the generic multiplier, not official.
 *  - U5-3: resolveModelAlias resolved a single pass, not transitively.
 */
import { describe, expect, it } from 'vitest';

import { estimateCostUsd, hasPriceFor } from '../src/engine/pricing.js';
import { resolveModelAlias } from '../src/internal/model-alias.js';
import type { NonNullableUsage } from '../src/types.js';

const MTOK = 1_000_000;

// ---------------------------------------------------------------------------
// U5-1 — the original Claude 3 Sonnet must be priced (not $0)
// ---------------------------------------------------------------------------

describe('audit r4 U5-1: claude-3-sonnet- is priced, not $0', () => {
  const usage: NonNullableUsage = {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  it('prices claude-3-sonnet-20240229 at the sonnet rate (3 in / 15 out)', () => {
    // Before: no prefix matched -> $0 -> maxBudgetUsd silently unenforced.
    expect(estimateCostUsd('claude-3-sonnet-20240229', usage)).toBe(18);
    expect(estimateCostUsd('claude-3-sonnet-20240229', usage)).toBeGreaterThan(0);
    expect(hasPriceFor('claude-3-sonnet-20240229')).toBe(true);
  });

  it('does not shadow the longer claude-3-5 / claude-3-7 sonnet prefixes', () => {
    // Longest prefix wins: these keep matching their own (identical-rate) entries.
    expect(estimateCostUsd('claude-3-5-sonnet-20241022', usage)).toBe(18);
    expect(estimateCostUsd('claude-3-7-sonnet-20250219', usage)).toBe(18);
    // And the generation-last sonnet is untouched.
    expect(estimateCostUsd('claude-sonnet-4-5', usage)).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// U5-2 — Claude 3 Haiku uses the official cache rates, not the generic multiplier
// ---------------------------------------------------------------------------

describe('audit r4 U5-2: claude-3-haiku- cache rates are official', () => {
  it('bills cache write at 0.30 and cache read at 0.03 per MTok (not 0.3125 / 0.025)', () => {
    const usage: NonNullableUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    };
    // Official: 0.30 + 0.03 = 0.33. Generic multiplier would give 0.3375.
    expect(estimateCostUsd('claude-3-haiku-20240307', usage, '5m')).toBeCloseTo(0.33, 10);
    expect(estimateCostUsd('claude-3-haiku-20240307', usage, '5m')).not.toBeCloseTo(
      0.3375,
      10,
    );
  });

  it('isolates the cache-read rate at the official 0.03', () => {
    const readOnly: NonNullableUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    };
    expect(estimateCostUsd('claude-3-haiku-20240307', readOnly, '5m')).toBeCloseTo(0.03, 10);
  });

  it('isolates the 5m cache-write rate at the official 0.30', () => {
    const writeOnly: NonNullableUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 0,
    };
    expect(estimateCostUsd('claude-3-haiku-20240307', writeOnly, '5m')).toBeCloseTo(0.3, 10);
    // The 1h TTL still derives from input x2, unaffected by the write-rate fix.
    expect(estimateCostUsd('claude-3-haiku-20240307', writeOnly, '1h')).toBeCloseTo(0.5, 10);
  });

  it('leaves base input/output rates unchanged (0.25 / 1.25)', () => {
    const tokensOnly: NonNullableUsage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    expect(estimateCostUsd('claude-3-haiku-20240307', tokensOnly)).toBeCloseTo(
      (1_000_000 * 0.25 + 1_000_000 * 1.25) / MTOK,
      10,
    );
  });
});

// ---------------------------------------------------------------------------
// U5-3 — resolveModelAlias resolves aliases transitively
// ---------------------------------------------------------------------------

describe('audit r4 U5-3: resolveModelAlias resolves aliases transitively', () => {
  it('chains a host override whose value is itself a built-in alias', () => {
    // Before: returned the literal 'opus' (still an alias) -> wire 400.
    expect(resolveModelAlias('sonnet', 'parent', { sonnet: 'opus' })).toBe('claude-opus-4-8');
    expect(resolveModelAlias('sonnet', 'parent', { sonnet: 'haiku' })).toBe('claude-haiku-4-5');
  });

  it('chains through multiple override hops to a concrete id', () => {
    expect(
      resolveModelAlias('sonnet', 'parent', { sonnet: 'mid', mid: 'gw-final-model' }),
    ).toBe('gw-final-model');
  });

  it('terminates on a cyclic config instead of looping forever', () => {
    const out = resolveModelAlias('a', 'parent', { a: 'b', b: 'a' });
    expect(typeof out).toBe('string');
    // Stops on the first repeated token rather than hanging.
    expect(out).toBe('a');
  });

  it('still returns a host override that resolves to a concrete id in one hop', () => {
    expect(resolveModelAlias('sonnet', 'parent', { sonnet: 'gw-sonnet' })).toBe('gw-sonnet');
  });

  it('still resolves built-in aliases and passes unknown ids / inherit through', () => {
    expect(resolveModelAlias('opus', 'parent')).toBe('claude-opus-4-8');
    expect(resolveModelAlias('vendor/custom-9', 'parent')).toBe('vendor/custom-9');
    expect(resolveModelAlias('inherit', 'parent-model')).toBe('parent-model');
    expect(resolveModelAlias(undefined, 'parent-model')).toBe('parent-model');
    // Prototype keys still pass through verbatim (own-property lookup preserved).
    expect(resolveModelAlias('toString', 'parent')).toBe('toString');
    expect(resolveModelAlias('__proto__', 'parent')).toBe('__proto__');
  });
});
