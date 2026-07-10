/**
 * Hook-condition evaluator — faithful OPEN reproductions of Claude Code's two
 * hook-condition prompts (base + stop variant), shipped WITH their consuming
 * feature: a `condition` field on HookCallbackMatcher (types.ts). When a
 * matcher carries a natural-language condition, the runner evaluates it with a
 * bounded single-shot utility call BEFORE firing that matcher's callbacks and
 * SKIPS them when the condition is not met.
 *
 * FAIL-CLOSED direction: a garbled/unparseable/errored evaluation counts as
 * NOT met — a hook must never fire on an unverified condition. A matcher with
 * no condition takes the existing fully-deterministic path (zero model calls),
 * so existing configurations are byte-identical in behavior.
 *
 * Provenance mirrors src/generators/prompts.ts; corpus-sync guards in
 * tests/hooks-condition.test.ts hold both prompts to their archived sources.
 */

import {
  extractJsonObject,
  runUtilityCall,
  type UtilityCallOptions,
} from '../generators/runtime.js';

/** Where a reproduced condition prompt came from, and whether it is verbatim. */
export interface HookConditionProvenance {
  slug: string;
  faithful: boolean;
}

/**
 * Base hook-condition evaluator — verbatim body of
 * agent-prompt-hook-condition-evaluator.
 */
export const HOOK_CONDITION_SYSTEM = `You are evaluating a hook condition in Claude Code. Judge whether the user-provided condition is met.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<reason the condition is met>"}
- {"ok": false, "reason": "<reason the condition is not met>"}

Always include a "reason" field.`;

/** Provenance for the base hook-condition evaluator surface. */
export const HOOK_CONDITION_PROVENANCE: HookConditionProvenance = {
  slug: 'agent-prompt-hook-condition-evaluator',
  faithful: true,
};

/**
 * Stop-condition evaluator — verbatim body of
 * agent-prompt-hook-condition-evaluator-stop. Used for Stop / SubagentStop
 * events; supports the additional `impossible` escape hatch.
 */
export const HOOK_STOP_CONDITION_SYSTEM = `You are evaluating a stop-condition hook in Claude Code. Read the conversation transcript carefully, then judge whether the user-provided condition is satisfied.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<quote evidence from the transcript that satisfies the condition>"}
- {"ok": false, "reason": "<quote what is missing or what blocks the condition>"}
- {"ok": false, "impossible": true, "reason": "<explain why the condition can never be satisfied>"}

Always include a "reason" field, quoting specific text from the transcript whenever possible. If the transcript does not contain clear evidence that the condition is satisfied, return {"ok": false, "reason": "insufficient evidence in transcript"}.

Only use {"ok": false, "impossible": true} when the condition is genuinely unachievable in this session — for example: the condition is self-contradictory, it depends on a resource or capability that is unavailable, or the assistant has explicitly tried, exhausted reasonable approaches, and stated it cannot be done. Apply your own judgment when deciding this — the assistant claiming the goal is impossible is evidence, not proof; independently confirm the condition is genuinely unachievable rather than deferring to the assistant's self-assessment. Do not use it just because the goal has not been reached yet or because progress is slow. When in doubt, return {"ok": false} without "impossible".`;

/** Provenance for the stop-condition evaluator surface. */
export const HOOK_STOP_CONDITION_PROVENANCE: HookConditionProvenance = {
  slug: 'agent-prompt-hook-condition-evaluator-stop',
  faithful: true,
};

/** Every reproduced condition-evaluator surface, keyed by a stable id. */
export const HOOK_CONDITION_PROVENANCE_TABLE: Record<string, HookConditionProvenance> = {
  base: HOOK_CONDITION_PROVENANCE,
  stop: HOOK_STOP_CONDITION_PROVENANCE,
};

/** The evaluator's verdict on one condition. */
export interface HookConditionResult {
  /** true ONLY when the evaluator affirmed the condition (strict boolean). */
  ok: boolean;
  reason: string;
  /** Stop variant only: the condition can never be satisfied this session. */
  impossible?: boolean;
}

/** Input for one condition evaluation. */
export interface HookConditionInput {
  /** The user-provided natural-language condition from the matcher. */
  condition: string;
  /** Event context handed to the evaluator (hook input JSON / transcript). */
  context: string;
  /** Use the stop-condition variant (Stop / SubagentStop events). */
  stop?: boolean;
}

/**
 * Evaluate one hook condition with a bounded single-shot utility call. Never
 * throws on evaluator trouble: any call error fails CLOSED to
 * `{ ok: false, reason: <error> }` so a hook cannot fire on an unverified
 * condition. (Cancellation via opts.signal still rejects — an abort is not a
 * verdict.)
 */
export async function evaluateHookCondition(
  input: HookConditionInput,
  opts: UtilityCallOptions = {},
): Promise<HookConditionResult> {
  const system = input.stop === true ? HOOK_STOP_CONDITION_SYSTEM : HOOK_CONDITION_SYSTEM;
  const user = `Condition:\n${input.condition}\n\nContext:\n${input.context}`;
  let raw: string;
  try {
    raw = await runUtilityCall(system, user, opts, 256);
  } catch (err) {
    if (opts.signal?.aborted) throw err; // abort propagates, never a verdict
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `condition evaluator unavailable: ${msg}` };
  }
  return parseHookCondition(raw);
}

/** Pure parser for the evaluator reply (unit-testable, no I/O). FAILS CLOSED. */
export function parseHookCondition(raw: string): HookConditionResult {
  const obj = extractJsonObject(raw);
  if (obj === null || typeof obj !== 'object') {
    return { ok: false, reason: 'unparseable condition-evaluator reply' };
  }
  const rec = obj as Record<string, unknown>;
  // STRICT boolean true: "true"/1 or an absent ok field must not fire a hook.
  const ok = rec.ok === true;
  const reason =
    typeof rec.reason === 'string' && rec.reason.length > 0
      ? rec.reason
      : ok
        ? 'condition met (no reason given)'
        : 'condition not met (no reason given)';
  const result: HookConditionResult = { ok, reason };
  // `impossible` is only meaningful on a NOT-met verdict (per the stop prompt).
  if (!ok && rec.impossible === true) result.impossible = true;
  return result;
}
