/**
 * Judge-verdict parsing and scoring aggregation for runEvals (loop 2).
 *
 * Extracted from run-evals.mjs (self-improve #2) after the first branch LIVE
 * round poisoned two dimension means: the judge occasionally returns a
 * verdict without a valid `score` (truncated/empty JSON), and treating it as
 * SCORED fed `undefined` into the mean — the whole dimension collapsed to
 * null and the REQ-2.2 gate fired -4.86 / -4.0 FALSE regressions. Discipline:
 * a verdict without a valid integer score 1-5 is an ERROR outcome, never a
 * score; means are computed over valid scores only and stay honest about how
 * many results they exclude.
 *
 * Import-only module (no side effects) so vitest can pin these rules.
 */

/** Parse one judge response body (Messages API message shape). */
export function parseJudgeMessage(body) {
  const text = (body.content ?? []).find((b) => b.type === 'text')?.text ?? '{}';
  return { ...JSON.parse(text), judgeUsage: body.usage };
}

/** A verdict counts only with an integer score in 1..5. */
export function isValidVerdict(graded) {
  return (
    graded !== null &&
    typeof graded === 'object' &&
    Number.isInteger(graded.score) &&
    graded.score >= 1 &&
    graded.score <= 5
  );
}

/**
 * Per-dimension means over SCORED results with valid scores. Invalid scores
 * never reach this point when the runner enforces isValidVerdict, but the
 * filter here is deliberate defense in depth — one bad record must never
 * null out a whole dimension again.
 */
export function computeDimensionMeans(results) {
  const byDim = {};
  for (const r of results) {
    if (r.outcome !== 'SCORED') continue;
    if (!Number.isInteger(r.score) || r.score < 1 || r.score > 5) continue;
    (byDim[r.dimension] ??= []).push(r.score);
  }
  return Object.fromEntries(
    Object.entries(byDim).map(([d, s]) => [
      d,
      +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2),
    ]),
  );
}
