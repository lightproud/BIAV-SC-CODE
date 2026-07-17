/**
 * Three-state adversarial verifier — a shipped public SDK function that
 * classifies ONE candidate code-review finding as CONFIRMED / PLAUSIBLE /
 * REFUTED and encodes the skill's keep rule ("keep CONFIRMED or PLAUSIBLE") as
 * a `keep` flag. A consumer building a review flow calls adversarialVerify per
 * candidate and drops the REFUTED ones — the capability ships WITH its prompt,
 * so reproducing the /code-review verification prompts is not an
 * unshipped-capability red-line violation (same footing as the v0.6 generators).
 *
 * A single-shot utility call over the shipped v0.6 runtime (runUtilityCall /
 * extractJsonObject) — no new transport. The parser FAILS CLOSED: a garbled,
 * ambiguous, or empty reply collapses to REFUTED (keep:false), so an unverified
 * finding is never returned as kept. This mirrors "不测不宣胜负": an unproven
 * finding must not survive on the benefit of the doubt.
 */

import {
  extractJsonObject,
  runUtilityCall,
  type UtilityCallOptions,
} from '../generators/runtime.js';
import { neutralizeClosingTag } from '../internal/inert-text.js';
import { VERIFY_VERDICT_SYSTEM } from './prompts.js';

/** The three possible verdicts for a candidate finding. */
export type Verdict = 'CONFIRMED' | 'PLAUSIBLE' | 'REFUTED';

const VERDICTS: ReadonlySet<string> = new Set(['CONFIRMED', 'PLAUSIBLE', 'REFUTED']);

/**
 * Default model for verification. Matches the shipped utility-runtime default
 * (Haiku): verification is a bounded single-turn classification, and defaulting
 * to a costlier model would be an untested "verifies better" bet. Overridable
 * via opts.model when a consumer wants heavier adversarial reasoning.
 */
export const VERIFIER_DEFAULT_MODEL = 'claude-haiku-4-5';

/** The verdict a garbled/ambiguous reply collapses to (fail-closed target). */
export const SAFE_VERDICT: Verdict = 'REFUTED';

/** A candidate finding to verify (ReportFindings-shaped, all context optional). */
export interface Finding {
  summary: string;
  failureScenario?: string;
  file?: string;
  line?: number;
  category?: string;
  /** The diff + relevant file text handed to the verifier as evidence. */
  context?: string;
}

/** The typed verdict for a candidate. */
export interface VerificationResult {
  verdict: Verdict;
  /** verdict !== 'REFUTED' — encodes VERIFY_KEEP_RULE. */
  keep: boolean;
  /** The code line the verifier quoted, when present. */
  quote?: string;
  rationale: string;
  /** PLAUSIBLE only: what would confirm it. */
  confirms?: string;
  /** True when this REFUTED did NOT come from the model's judgement but from
   *  a garbled/unparseable reply collapsing to the fail-closed verdict. The
   *  keep rule is unchanged (still dropped), but a caller can now tell a
   *  transient bad reply from a real refute and choose to retry/log instead
   *  of silently discarding a valid finding (audit 2026-07-17 L46). */
  parseFailed?: boolean;
}

/** Assemble the user turn for one candidate finding (omits absent fields). */
export function buildVerifierUserTurn(f: Finding): string {
  const parts: string[] = [];
  if (f.context !== undefined && f.context.length > 0) {
    // N1 (audit 2026-07-17): the code under review is ADVERSARIAL input — a
    // literal `</context>` inside it would close the fence and let the code
    // dictate its own verdict. Neutralize the terminator; the system prompt's
    // inert-data rule covers instruction-like text that stays inside.
    const inert = neutralizeClosingTag(f.context, 'context');
    parts.push(`Diff / relevant code:\n<context>\n${inert}\n</context>`);
  }
  const location =
    f.file !== undefined
      ? f.line !== undefined
        ? `${f.file}:${f.line}`
        : f.file
      : undefined;
  const finding: string[] = [`- summary: ${f.summary}`];
  if (f.failureScenario !== undefined) finding.push(`- failure scenario: ${f.failureScenario}`);
  if (location !== undefined) finding.push(`- location: ${location}`);
  if (f.category !== undefined) finding.push(`- category: ${f.category}`);
  parts.push('Candidate finding:\n' + finding.join('\n'));
  return parts.join('\n\n');
}

/**
 * Run the single-shot verification call and return a typed verdict. Defaults to
 * VERIFIER_DEFAULT_MODEL (overridable via opts.model).
 */
export async function runVerification(
  finding: Finding,
  opts: UtilityCallOptions = {},
): Promise<VerificationResult> {
  const raw = await runUtilityCall(
    VERIFY_VERDICT_SYSTEM,
    buildVerifierUserTurn(finding),
    { ...opts, model: opts.model ?? VERIFIER_DEFAULT_MODEL },
    512,
  );
  return parseVerdict(raw);
}

/**
 * The shipped public entry point a review flow calls per candidate. Identity
 * over runVerification today; named as the stable consumer contract (parallels
 * detectCommandPrefix / classifyBackgroundState).
 */
export async function adversarialVerify(
  finding: Finding,
  opts: UtilityCallOptions = {},
): Promise<VerificationResult> {
  return runVerification(finding, opts);
}

/** Pure parser for the verdict reply (unit-testable, no I/O). FAILS CLOSED. */
export function parseVerdict(raw: string): VerificationResult {
  const obj = extractJsonObject(raw);
  if (obj !== null && typeof obj === 'object') {
    // A JSON reply is AUTHORITATIVE: the verdict is only what the `verdict`
    // field says. An absent/invalid verdict fails CLOSED to REFUTED — we must
    // NOT scavenge a verdict word out of the rationale prose (a rationale that
    // merely mentions "CONFIRMED" must never forge a kept finding).
    const rec = obj as Record<string, unknown>;
    const v = typeof rec.verdict === 'string' ? rec.verdict.trim().toUpperCase() : '';
    const verdict: Verdict = VERDICTS.has(v) ? (v as Verdict) : SAFE_VERDICT;
    const quote = typeof rec.quote === 'string' ? rec.quote : undefined;
    const rationale = typeof rec.rationale === 'string' ? rec.rationale : '';
    const confirms =
      typeof rec.confirms === 'string' && rec.confirms.length > 0 ? rec.confirms : undefined;
    return buildResult(verdict, quote, rationale, confirms);
  }
  // extractJsonObject found nothing parseable. If the reply ATTEMPTED JSON (it
  // contains a brace), a parse failure — e.g. a reply truncated at max_tokens
  // right after a valid token — fails CLOSED rather than scavenging a word out
  // of the broken JSON. Only a reply with no brace at all is treated as a
  // genuine bare-word verdict.
  if (raw.includes('{')) {
    return { ...buildResult(SAFE_VERDICT, undefined, '', undefined), parseFailed: true };
  }
  const bare = parseBareVerdict(raw);
  if (bare === undefined) {
    return { ...buildResult(SAFE_VERDICT, undefined, '', undefined), parseFailed: true };
  }
  return buildResult(bare, undefined, '', undefined);
}

/** Assemble a VerificationResult, encoding the keep rule + PLAUSIBLE-only confirms. */
function buildResult(
  verdict: Verdict,
  quote: string | undefined,
  rationale: string,
  confirms: string | undefined,
): VerificationResult {
  const result: VerificationResult = { verdict, keep: verdict !== 'REFUTED', rationale };
  if (quote !== undefined) result.quote = quote;
  if (confirms !== undefined && verdict === 'PLAUSIBLE') result.confirms = confirms;
  return result;
}

/**
 * Recover a verdict from a bare (non-JSON) reply. Returns a verdict ONLY when
 * EXACTLY ONE distinct verdict word appears as a whole word — zero matches or
 * an ambiguous reply naming two different verdicts returns undefined so the
 * caller fails closed to REFUTED. (A finding must never be kept on an
 * ambiguous verification.)
 */
function parseBareVerdict(raw: string): Verdict | undefined {
  const upper = raw.toUpperCase();
  const present: Verdict[] = [];
  for (const v of ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] as const) {
    if (new RegExp(`\\b${v}\\b`).test(upper)) present.push(v);
  }
  return present.length === 1 ? present[0] : undefined;
}
