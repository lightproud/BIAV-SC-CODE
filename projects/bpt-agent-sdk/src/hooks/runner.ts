/**
 * DefaultHookRunner - executes user-registered hook callbacks.
 *
 * For one event, every callback of every matcher whose pattern matches the
 * event's filter value runs in parallel. Each callback gets its own timeout
 * (matcher.timeout ?? 60 seconds) combined with the caller's AbortSignal.
 * Rejected or timed-out callbacks are logged via the debug callback and
 * otherwise ignored; a callback can never crash the agent loop.
 *
 * Aggregation rules (across the outputs, in completion order):
 *   - permission decision: deny > ask > allow. The legacy `decision` field
 *     maps onto this: 'block' -> deny (with its `reason`), 'approve' -> allow
 *     (only when the same output carries no explicit permissionDecision). An
 *     unrecognized permissionDecision value (e.g. a migrated 'defer') is
 *     treated as a DENY, never a silent allow.
 *   - continue:false wins; the FIRST non-empty stopReason is kept
 *   - systemMessage / additionalContext collected in completion order
 *   - updatedInput: from the LAST output carrying an 'allow' OR 'ask' decision
 *     (types.ts documents updatedInput as valid with allow and ask)
 *   - updatedToolOutput: last-wins
 *   - `void` / `{}` outputs are neutral; `async: true` outputs are detached
 *     (fire-and-forget) and treated as neutral
 */

import type {
  HookCallback,
  HookEvent,
  HookInput,
  HookJSONOutput,
  Options,
} from '../types.js';
import { AbortError } from '../errors.js';
import type { AggregatedHookResult, HookRunner } from '../internal/contracts.js';
import { matcherMatches } from './matcher.js';

const DEFAULT_TIMEOUT_SECONDS = 60;

export type HookRunnerConfig = {
  hooks: Options['hooks'];
  debug: (msg: string) => void;
};

/** A promise that rejects when the signal aborts (used to bound callbacks
 *  that ignore their AbortSignal). Never resolves. */
function abortRejection(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new AbortError());
      return;
    }
    signal.addEventListener(
      'abort',
      () => reject(signal.reason instanceof Error ? signal.reason : new AbortError()),
      { once: true },
    );
  });
}

export class DefaultHookRunner implements HookRunner {
  private readonly hooks: NonNullable<Options['hooks']>;
  private readonly debug: (msg: string) => void;

  constructor(cfg: HookRunnerConfig) {
    this.hooks = cfg.hooks ?? {};
    this.debug = cfg.debug;
  }

  hasHooks(event: HookEvent): boolean {
    const matchers = this.hooks[event];
    return matchers !== undefined && matchers.some((m) => m.hooks.length > 0);
  }

  async run(
    event: HookEvent,
    input: HookInput,
    toolUseID: string | undefined,
    matchValue: string | undefined,
    signal: AbortSignal,
  ): Promise<AggregatedHookResult> {
    if (signal.aborted) throw new AbortError();

    // Collect every callback whose matcher pattern accepts the filter value.
    const tasks: Array<{ cb: HookCallback; timeoutMs: number }> = [];
    for (const matcher of this.hooks[event] ?? []) {
      if (!matcherMatches(matcher.matcher, matchValue, this.debug)) continue;
      const seconds =
        typeof matcher.timeout === 'number' &&
        Number.isFinite(matcher.timeout) &&
        matcher.timeout > 0
          ? matcher.timeout
          : DEFAULT_TIMEOUT_SECONDS;
      for (const cb of matcher.hooks) {
        tasks.push({ cb, timeoutMs: seconds * 1000 });
      }
    }

    // Run all callbacks in parallel; push outputs as they complete so the
    // aggregation below sees completion order.
    const outputs: HookJSONOutput[] = [];
    await Promise.allSettled(
      tasks.map(async (task) => {
        const out = await this.runOne(event, task.cb, task.timeoutMs, input, toolUseID, signal);
        if (out !== undefined) outputs.push(out);
      }),
    );

    // Cancellation is never swallowed as a "hook failure".
    if (signal.aborted) throw new AbortError();

    return this.aggregate(outputs);
  }

  /** Run one callback with its own timeout; failures become debug warnings. */
  private async runOne(
    event: HookEvent,
    cb: HookCallback,
    timeoutMs: number,
    input: HookInput,
    toolUseID: string | undefined,
    signal: AbortSignal,
  ): Promise<HookJSONOutput | undefined> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    try {
      // The race bounds callbacks that ignore their signal: when the combined
      // signal fires, the callback's eventual result is discarded (detached).
      const result = await Promise.race([
        (async () => cb(input, toolUseID, { signal: combined }))(),
        abortRejection(combined),
      ]);
      if (!result) return undefined; // void (or any falsy) output -> neutral
      if (result.async === true) {
        // Fire-and-forget output: already settled, but by contract it
        // contributes nothing to the aggregate.
        this.debug(`hooks(${event}): async hook output detached (neutral)`);
        return undefined;
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.debug(`hooks(${event}): callback failed or timed out, ignored (${msg})`);
      return undefined;
    }
  }

  /** Fold the collected outputs (already in completion order). */
  private aggregate(outputs: HookJSONOutput[]): AggregatedHookResult {
    const agg: AggregatedHookResult = {
      continue: true,
      systemMessages: [],
      additionalContext: [],
    };
    let denyReason: string | undefined;
    let askReason: string | undefined;
    let allowReason: string | undefined;
    let sawDeny = false;
    let sawAsk = false;
    let sawAllow = false;

    for (const out of outputs) {
      // continue:false wins; keep the FIRST non-empty stopReason so an
      // actionable reason from a later continue:false output is not lost to a
      // fast, reason-less one (#26).
      if (out.continue === false) {
        agg.continue = false;
        if (
          agg.stopReason === undefined &&
          typeof out.stopReason === 'string' &&
          out.stopReason.length > 0
        ) {
          agg.stopReason = out.stopReason;
        }
      }
      if (typeof out.systemMessage === 'string' && out.systemMessage.length > 0) {
        agg.systemMessages.push(out.systemMessage);
      }

      const hso = out.hookSpecificOutput;

      // Per-output permission decision. The newer hookSpecificOutput.
      // permissionDecision is the primary signal; the legacy `decision` field
      // maps onto it. Widened to `string` so an unrecognized runtime value
      // (e.g. a migrated 'defer') can be caught below rather than silently
      // ignored.
      let decision: string | undefined = hso?.permissionDecision;
      let reason = hso?.permissionDecisionReason ?? out.reason;
      if (out.decision === 'block') {
        // Legacy block -> deny; pair the recorded reason with the DENY source,
        // not any allow rationale the same output also carried (#25).
        decision = 'deny';
        reason = out.reason ?? hso?.permissionDecisionReason;
      } else if (out.decision === 'approve' && decision === undefined) {
        // Legacy approve -> allow, symmetric to block. Only when the output
        // carries no explicit (more specific) permissionDecision (#15).
        decision = 'allow';
        reason = out.reason ?? reason;
      }

      if (decision === 'deny') {
        if (!sawDeny) {
          sawDeny = true;
          denyReason = reason;
        }
      } else if (decision === 'ask') {
        if (!sawAsk) {
          sawAsk = true;
          askReason = reason;
        }
      } else if (decision === 'allow') {
        if (!sawAllow) {
          sawAllow = true;
          allowReason = reason;
        }
      } else if (decision !== undefined) {
        // Unrecognized permissionDecision (e.g. a migrated/typo 'defer'):
        // the documented v0.1 behavior is to treat it as a DENY, never a
        // silent allow (fail closed).
        this.debug(
          `hooks: unrecognized permissionDecision "${decision}" treated as deny`,
        );
        if (!sawDeny) {
          sawDeny = true;
          denyReason =
            reason ?? `unrecognized permissionDecision "${decision}" (treated as deny)`;
        }
      }

      // updatedInput is valid with an 'allow' OR 'ask' decision (types.ts:466);
      // the last such output wins. Capturing it under 'ask' too ensures a hook
      // that rewrites the input and asks for confirmation has its rewrite
      // survive the canUseTool round-trip (#21).
      if (
        (decision === 'allow' || decision === 'ask') &&
        hso?.updatedInput !== undefined
      ) {
        agg.updatedInput = hso.updatedInput;
      }

      if (hso?.additionalContext !== undefined && hso.additionalContext.length > 0) {
        agg.additionalContext.push(hso.additionalContext);
      }
      // updatedToolOutput: last-wins across all outputs that set it.
      if (hso !== undefined && hso.updatedToolOutput !== undefined) {
        agg.updatedToolOutput = hso.updatedToolOutput;
      }
    }

    if (sawDeny) {
      agg.decision = 'deny';
      if (denyReason !== undefined) agg.decisionReason = denyReason;
    } else if (sawAsk) {
      agg.decision = 'ask';
      if (askReason !== undefined) agg.decisionReason = askReason;
    } else if (sawAllow) {
      agg.decision = 'allow';
      if (allowReason !== undefined) agg.decisionReason = allowReason;
    }
    return agg;
  }
}
