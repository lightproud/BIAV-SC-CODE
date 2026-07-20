/**
 * L5 multi-result aggregation self-test (gap 4 of the completeness push,
 * 2026-07-05): the runner's metric rule previously had no test of its own -
 * the multi-result sum path was first executed inside a paid real round.
 *
 * The multi-result fixture below is the REAL official-arm result sequence
 * from run 28736460533 longconv-02 r1 (L6 public-stream trace retention):
 * three streamed user turns -> three result messages, num_turns/usage
 * per-result, total_cost_usd and duration_api_ms session-cumulative.
 */

import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain-JS conformance module without type declarations
import { aggregateRunMetrics } from './conformance/l5-aggregate.mjs';

/** Real sequence: run 28736460533, official arm, longconv-02 repeat 1. */
const OFFICIAL_LONGCONV_R1 = [
  {
    type: 'result',
    subtype: 'success',
    num_turns: 1,
    total_cost_usd: 0.0067209999999999995,
    duration_api_ms: 3576,
    usage: { input_tokens: 4, output_tokens: 259, cache_creation_input_tokens: 253, cache_read_input_tokens: 5000 },
  },
  {
    type: 'result',
    subtype: 'success',
    num_turns: 1,
    total_cost_usd: 0.00989985,
    duration_api_ms: 7090,
    usage: { input_tokens: 3, output_tokens: 211, cache_creation_input_tokens: 0, cache_read_input_tokens: 6000 },
  },
  {
    type: 'result',
    subtype: 'success',
    num_turns: 1,
    total_cost_usd: 0.0137899,
    duration_api_ms: 10479,
    usage: { input_tokens: 3, output_tokens: 356, cache_creation_input_tokens: 0, cache_read_input_tokens: 6838 },
  },
];

describe('aggregateRunMetrics', () => {
  it('multi-result (real official longconv trace): turns/usage summed, cost/apiMs last-cumulative', () => {
    const m = aggregateRunMetrics(OFFICIAL_LONGCONV_R1);
    expect(m.results).toBe(3);
    expect(m.turns).toBe(3); // 1+1+1, NOT the lastResult-only 1 that misread as early termination
    expect(m.costUsd).toBeCloseTo(0.0137899, 10); // cumulative -> last, never summed
    expect(m.apiMs).toBe(10479); // cumulative -> last
    expect(m.outputTokens).toBe(259 + 211 + 356); // per-result -> summed
    expect(m.inputTokens).toBe(4 + 3 + 3);
    expect(m.cacheCreationTokens).toBe(253);
    expect(m.cacheReadTokens).toBe(5000 + 6000 + 6838);
    expect(m.subtype).toBe('success');
  });

  it('W3-4: cacheCreationTokens is SUMMED, not first-only (sum != first fixture)', () => {
    // The real longconv trace has cache_creation 253/0/0, where sum == first ==
    // 253 — that assertion cannot tell a summing aggregator from a first-only
    // one. This synthetic fixture puts non-zero cache_creation in later results
    // so the two hypotheses diverge (sum 180 vs first 100).
    const results = [100, 50, 30].map((cc, i) => ({
      type: 'result' as const,
      subtype: 'success' as const,
      num_turns: 1,
      total_cost_usd: 0.001 * (i + 1),
      duration_api_ms: 1000 * (i + 1),
      usage: {
        input_tokens: 1,
        output_tokens: 10,
        cache_creation_input_tokens: cc,
        cache_read_input_tokens: 0,
      },
    }));
    const m = aggregateRunMetrics(results);
    expect(m.cacheCreationTokens).toBe(180); // 100 + 50 + 30, NOT 100
  });

  it('single-result run is unchanged by construction (sum-of-one == last-of-one)', () => {
    const only = OFFICIAL_LONGCONV_R1[2];
    const m = aggregateRunMetrics([only]);
    expect(m.results).toBe(1);
    expect(m.turns).toBe(1);
    expect(m.costUsd).toBeCloseTo(0.0137899, 10);
    expect(m.outputTokens).toBe(356);
    expect(m.apiMs).toBe(10479);
  });

  it('no result messages (harness abort / dead run): zeroed metrics, subtype no-result', () => {
    const m = aggregateRunMetrics([]);
    expect(m).toEqual({
      subtype: 'no-result',
      turns: 0,
      results: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      apiMs: 0,
    });
  });

  it('missing usage/num_turns fields default to 0 instead of NaN-poisoning the report', () => {
    const m = aggregateRunMetrics([
      { type: 'result', subtype: 'error_during_execution', total_cost_usd: 0.01 },
      { type: 'result', subtype: 'success', num_turns: 2, usage: { output_tokens: 5 }, total_cost_usd: 0.02, duration_api_ms: 100 },
    ]);
    expect(m.turns).toBe(2);
    expect(m.outputTokens).toBe(5);
    expect(m.costUsd).toBeCloseTo(0.02, 10);
    expect(Number.isNaN(m.inputTokens)).toBe(false);
    expect(m.subtype).toBe('success');
  });
});
