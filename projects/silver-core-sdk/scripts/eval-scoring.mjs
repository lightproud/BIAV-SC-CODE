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

/**
 * Diagnostic probe for a judge response that failed to yield a valid score
 * (mem-03 / dc-05 stubborn scoreless pair — keeper "深挖一单" 2026-07-12).
 * Captures the API-level shape WITHOUT guessing the cause: was the output
 * truncated (`stop_reason: 'max_tokens'`)? Was there no text block at all
 * (structured-output landed elsewhere / refusal)? Is the text present but
 * missing `score`? One LIVE round with this attached tells us which — then
 * the fix is targeted, not speculative.
 */
export function diagnoseJudgeMessage(body) {
  const blocks = Array.isArray(body?.content) ? body.content : [];
  const textBlock = blocks.find((b) => b.type === 'text');
  return {
    stop_reason: body?.stop_reason ?? null,
    block_types: blocks.map((b) => b.type),
    has_text_block: textBlock !== undefined,
    text_len: textBlock?.text?.length ?? 0,
    text_head: (textBlock?.text ?? '').slice(0, 400),
    output_tokens: body?.usage?.output_tokens ?? null,
  };
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
 * Deep-trim judge evidence (self-improve #6): dc-05's verdict came back
 * scoreless TWICE even at the 4096 output budget — its two-phase transcript
 * evidence is enormous (seeded fixtures + full message contents), and an
 * over-stuffed judge input degrades output reliability and burns budget.
 * Any string longer than `cap` chars anywhere in the evidence tree is cut
 * with an explicit marker; structure, keys and short values (metrics,
 * ledgers, notes) pass through untouched, so rubric-relevant signals stay.
 */
export function trimEvidence(value, cap = 3000) {
  if (typeof value === 'string') {
    return value.length > cap
      ? `${value.slice(0, cap)}…[trimmed ${value.length - cap} chars]`
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => trimEvidence(v, cap));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimEvidence(v, cap)]));
  }
  return value;
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
