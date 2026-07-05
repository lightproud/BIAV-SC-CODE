/**
 * Faithful OPEN reproductions of Claude Code's /code-review VERIFICATION-phase
 * prompts — the three-state verdict primitive (CONFIRMED / PLAUSIBLE / REFUTED)
 * and the recall-biased verification guidance. These are the adversarial-verify
 * building blocks the SDK ships as `adversarialVerify()` (index.ts): a consumer
 * building a review flow classifies each candidate finding and drops REFUTED
 * ones, mirroring the skill's "keep CONFIRMED or PLAUSIBLE" orchestration rule.
 *
 * Provenance model mirrors src/generators/prompts.ts: each verbatim fragment
 * cites its archive slug under
 * Public-Info-Pool/Reference/Claude-Code-System-Prompts/system-prompts/ and a
 * corpus-sync guard (tests/verifier.test.ts) holds it to that source, so
 * upstream drift turns the build red. The task-framing + JSON output-contract
 * glue is adapted (not claimed faithful) and carries no archive provenance.
 */

/** Where a reproduced verifier fragment came from, and whether it is verbatim. */
export interface VerifierProvenance {
  slug: string;
  faithful: boolean;
}

/**
 * The three-state verdict DEFINITIONS — verbatim body of
 * agent-prompt-code-review-part-4-three-state-verification-phase.
 */
export const THREE_STATE_VERDICT_DEFINITIONS = `- **CONFIRMED** — can name the inputs/state that trigger it and the wrong
  output or crash. Quote the line.
- **PLAUSIBLE** — mechanism is real, trigger is uncertain (timing, env,
  config). State what would confirm it.
- **REFUTED** — factually wrong (code doesn't say that) or guarded elsewhere.
  Quote the line that proves it.`;

/**
 * Recall-biased verification guidance — verbatim body of
 * agent-prompt-code-review-part-5-recall-biased-verification-phase. Treats
 * realistic uncertain findings as PLAUSIBLE unless the code refutes them.
 */
export const RECALL_BIAS_GUIDANCE = `**PLAUSIBLE by default** — do not refute a candidate for being "speculative" or
"depends on runtime state" when the state is realistic: concurrency races,
nil/undefined on a rare-but-reachable path (error handler, cold cache, missing
optional field), falsy-zero treated as missing, off-by-one on a boundary the
code does not exclude, retry storms / partial failures, regex/allowlist that
lost an anchor. These are PLAUSIBLE.

**REFUTED** only when constructible from the code: factually wrong (quote the
actual line); provably impossible (type/constant/invariant — show it); already
handled in this diff (cite the guard); or pure style with no observable effect.`;

/**
 * The keep rule — verbatim sentence from skill-code-review-phase-2-verify-3-state.
 * Reproduced as the shipped `keep` flag on VerificationResult (verdict !==
 * 'REFUTED'), so this constant is the corpus-sync anchor for that behaviour.
 */
export const VERIFY_KEEP_RULE = 'Keep candidates where the vote is CONFIRMED or PLAUSIBLE.';

/**
 * Assembled verifier system prompt: adapted task-framing glue + the two faithful
 * archive fragments + an adapted JSON output contract. Only the two fragments
 * claim archive provenance (VERDICT_DEFINITIONS / RECALL_BIAS); the glue does not.
 */
export const VERIFY_VERDICT_SYSTEM = [
  'You are one adversarial verifier in a code-review flow. You are given a diff, the relevant file(s), and ONE candidate finding. Classify the candidate as exactly one of CONFIRMED, PLAUSIBLE, or REFUTED using these definitions:',
  THREE_STATE_VERDICT_DEFINITIONS,
  RECALL_BIAS_GUIDANCE,
  'Respond with ONLY this JSON, no code fences:\n{"verdict":"<CONFIRMED|PLAUSIBLE|REFUTED>","quote":"<the code line you quoted>","rationale":"<one line>","confirms":"<PLAUSIBLE only: what would confirm it; omit otherwise>"}',
].join('\n\n');

/** Provenance for the three-state verdict definitions fragment. */
export const VERDICT_DEFINITIONS_PROVENANCE: VerifierProvenance = {
  slug: 'agent-prompt-code-review-part-4-three-state-verification-phase',
  faithful: true,
};

/** Provenance for the recall-biased verification guidance fragment. */
export const RECALL_BIAS_PROVENANCE: VerifierProvenance = {
  slug: 'agent-prompt-code-review-part-5-recall-biased-verification-phase',
  faithful: true,
};

/** Provenance for the keep-rule anchor. */
export const VERIFY_PHASE_PROVENANCE: VerifierProvenance = {
  slug: 'skill-code-review-phase-2-verify-3-state',
  faithful: true,
};

/** Every reproduced verifier fragment, keyed by a stable id. */
export const VERIFIER_PROVENANCE: Record<string, VerifierProvenance> = {
  verdictDefinitions: VERDICT_DEFINITIONS_PROVENANCE,
  recallBias: RECALL_BIAS_PROVENANCE,
  verifyPhase: VERIFY_PHASE_PROVENANCE,
};
