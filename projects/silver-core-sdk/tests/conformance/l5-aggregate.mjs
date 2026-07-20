/**
 * L5 multi-result metric aggregation - extracted from run-l5.mjs runOne so
 * the rule is unit-testable against REAL result sequences (the runner logic
 * itself previously had no self-test: the official-arm sum path was first
 * executed in a paid real round - a test tool without a test).
 *
 * Semantics (M1 metric-artifact fix + E2 alignment, both 2026-07-05): BOTH
 * engines emit one `result` message per streamed user turn and share the
 * official per-result field semantics -
 *   num_turns / usage        PER-RESULT      -> summed across results
 *   total_cost_usd           session-cumulative -> last result's value
 *   duration_api_ms          session-cumulative -> last result's value
 * Single-result runs are unchanged by construction (sum-of-one == last).
 * Verified against run 28736460533 L6 official traces (longconv-02: turns
 * 1,1,2; costs strictly increasing with exact per-run deltas).
 */

/**
 * Aggregate a run's result-message sequence into report metrics.
 * resultMsgs: SDKResultMessage[] in stream order (possibly empty).
 */
export function aggregateRunMetrics(resultMsgs) {
  const lastResult = resultMsgs.length > 0 ? resultMsgs[resultMsgs.length - 1] : undefined;
  const sumOf = (get) => resultMsgs.reduce((s, r) => s + (get(r) ?? 0), 0);
  const lastOf = (get) => (lastResult ? (get(lastResult) ?? 0) : 0);
  const usageOf = (k) => sumOf((r) => r.usage?.[k]);
  return {
    subtype: lastResult?.subtype ?? 'no-result',
    turns: sumOf((r) => r.num_turns),
    results: resultMsgs.length,
    costUsd: lastOf((r) => r.total_cost_usd),
    inputTokens: usageOf('input_tokens'),
    outputTokens: usageOf('output_tokens'),
    cacheCreationTokens: usageOf('cache_creation_input_tokens'),
    cacheReadTokens: usageOf('cache_read_input_tokens'),
    apiMs: lastOf((r) => r.duration_api_ms),
  };
}
