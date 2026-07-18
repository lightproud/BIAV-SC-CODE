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

/**
 * Classify a non-2xx judge HTTP response (self-improve #7). The 2026-07-12
 * confirm round returned twenty identical HTTP 400s whose body was
 * "Your credit balance is too low" — a billing outage, not a code fault.
 * Two things went wrong in how the runner handled it: (1) judge() retried
 * each one once, a guaranteed-doomed second call that burned the last of a
 * depleted balance; (2) the report's 90-char note cell showed only the JSON
 * envelope prefix (…{"type":"error","error":{"type":"invalid_request_error",
 * "message":"), so the real cause was invisible without digging into raw CI
 * logs. This classifier fixes both: `retryable` tells judge() not to re-fire
 * terminal request errors, and `note` front-loads a human `kind` + the API's
 * own message text so the truncated table cell is legible.
 *
 * Terminal (retryable:false): billing, auth, permission, and any other 4xx —
 * an identical re-POST cannot change the verdict. Transient (retryable:true):
 * 408/425/429 and 5xx/529 — backoff may help.
 */
export function classifyJudgeError(status, bodyText) {
  let apiType;
  let apiMessage;
  try {
    const parsed = JSON.parse(bodyText);
    apiType = parsed?.error?.type ?? undefined;
    apiMessage = parsed?.error?.message ?? undefined;
  } catch {
    // Non-JSON body (gateway HTML, empty) — keep the raw head as the message.
  }
  const msg = String(apiMessage ?? bodyText ?? '').trim();
  const lower = msg.toLowerCase();
  let kind;
  let retryable;
  if (status === 429 || status === 408 || status === 425) {
    kind = 'rate_limit';
    retryable = true;
  } else if (status >= 500) {
    kind = 'server';
    retryable = true;
  } else if (status === 401) {
    kind = 'auth';
    retryable = false;
  } else if (status === 403) {
    kind = 'permission';
    retryable = false;
  } else if (status === 400 && (lower.includes('credit balance') || lower.includes('billing'))) {
    kind = 'billing';
    retryable = false;
  } else if (status === 400) {
    kind = 'invalid_request';
    retryable = false;
  } else {
    // Any other non-2xx (odd 4xx / 3xx): do not retry an identical re-POST.
    kind = apiType ?? 'http';
    retryable = false;
  }
  return {
    status,
    kind,
    retryable,
    apiType: apiType ?? null,
    note: `judge HTTP ${status} [${kind}]: ${msg.slice(0, 160)}`,
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

/**
 * Per-dimension SAMPLE COUNTS alongside the mean (audit r4 V7-1). The mean
 * alone hides its denominator: a dimension where 15 of 20 questions ERRORED
 * still reports a healthy mean over the 5 survivors, and a gate that compares
 * means only cannot see that three-quarters of the dimension collapsed — an
 * ERROR-shaped regression moves no mean, and a fully-collapsed dimension just
 * vanishes from computeDimensionMeans' map. This returns, for every dimension
 * PRESENT in `results`, the honest denominator:
 *   scored  - records with a valid integer score 1..5 (the ones fed the mean)
 *   invalid - SCORED outcome but no valid score (the 2026-07-12 poisoned kind)
 *   errored - ERROR outcome
 *   total   - all records tagged with the dimension (any outcome)
 *   mean    - mean over `scored`, or null when scored === 0 (a fully collapsed
 *             dimension stays VISIBLE here instead of disappearing).
 * computeDimensionMeans keeps its numeric-only contract for existing consumers
 * (the regression gate + baseline file); a gate that ALSO reads these counts
 * can flag a scored-count drop the mean would mask. See sharedFileChangesNeeded
 * for the run-evals / check-eval-regression wiring that activates it.
 */
export function computeDimensionStats(results) {
  const byDim = {};
  for (const r of results) {
    if (r === null || typeof r !== 'object' || typeof r.dimension !== 'string') continue;
    const c = (byDim[r.dimension] ??= { scored: 0, invalid: 0, errored: 0, total: 0, sum: 0 });
    c.total += 1;
    if (r.outcome === 'ERROR') {
      c.errored += 1;
    } else if (r.outcome === 'SCORED') {
      if (Number.isInteger(r.score) && r.score >= 1 && r.score <= 5) {
        c.scored += 1;
        c.sum += r.score;
      } else {
        c.invalid += 1;
      }
    }
  }
  return Object.fromEntries(
    Object.entries(byDim).map(([d, c]) => [
      d,
      {
        mean: c.scored > 0 ? +(c.sum / c.scored).toFixed(2) : null,
        scored: c.scored,
        invalid: c.invalid,
        errored: c.errored,
        total: c.total,
      },
    ]),
  );
}
