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
export const HOOK_CONDITION_SYSTEM = `你正在评估 Claude Code 中的一个钩子条件。判断用户提供的条件是否满足。

你的回复必须是一个 JSON 对象，为以下形状之一：
- {"ok": true, "reason": "<条件满足的理由>"}
- {"ok": false, "reason": "<条件不满足的理由>"}

务必始终包含一个 "reason" 字段。`;

/** Provenance for the base hook-condition evaluator surface. */
export const HOOK_CONDITION_PROVENANCE: HookConditionProvenance = {
  slug: 'agent-prompt-hook-condition-evaluator',
  faithful: false, // i18n-zh Phase 2 batch B: translated to Chinese (JSON contract kept English)
};

/**
 * Stop-condition evaluator — verbatim body of
 * agent-prompt-hook-condition-evaluator-stop. Used for Stop / SubagentStop
 * events; supports the additional `impossible` escape hatch.
 */
export const HOOK_STOP_CONDITION_SYSTEM = `你正在评估 Claude Code 中的一个停止条件钩子。仔细阅读对话记录，然后判断用户提供的条件是否满足。

你的回复必须是一个 JSON 对象，为以下形状之一：
- {"ok": true, "reason": "<从记录中引用满足该条件的证据>"}
- {"ok": false, "reason": "<引用缺少了什么、或什么阻碍了该条件>"}
- {"ok": false, "impossible": true, "reason": "<解释为何该条件永远无法满足>"}

务必始终包含一个 "reason" 字段，并尽可能引用记录中的具体文本。若记录不含条件已满足的明确证据，返回 {"ok": false, "reason": "insufficient evidence in transcript"}。

仅当该条件在本次会话中确实无法达成时才使用 {"ok": false, "impossible": true}——例如：条件自相矛盾、它依赖某个不可用的资源或能力、或助手已明确尝试、穷尽了合理的方法、并声明做不到。自行判断这一点——助手声称目标不可能只是证据、而非证明；应独立确认该条件确实无法达成，而非听凭助手的自我评估。不要仅因目标尚未达到、或进展缓慢就使用它。拿不准时，返回 {"ok": false}、不带 "impossible"。`;

/** Provenance for the stop-condition evaluator surface. */
export const HOOK_STOP_CONDITION_PROVENANCE: HookConditionProvenance = {
  slug: 'agent-prompt-hook-condition-evaluator-stop',
  faithful: false, // i18n-zh Phase 2 batch B: translated to Chinese (JSON contract kept English)
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
