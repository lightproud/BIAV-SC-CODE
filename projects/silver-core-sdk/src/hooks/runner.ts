/**
 * DefaultHookRunner - executes user-registered hook callbacks.
 *
 * For one event, every callback of every matcher whose pattern matches the
 * event's filter value runs in parallel. Each callback gets its own timeout
 * (matcher.timeout ?? 60 seconds) combined with the caller's AbortSignal.
 * Rejected or timed-out callbacks are logged via the debug callback and
 * otherwise ignored (failureMode 'open', the default) or converted into a
 * deny (failureMode 'closed' — see HookRunnerConfig.failureMode; a matcher's
 * own HookCallbackMatcher.failureMode overrides the global setting for that
 * matcher's callbacks, audit 2026-07-14 M-1); a callback can never crash the
 * agent loop. A failure resolved 'open' emits a loud debug line stating the
 * hook's outcome was DISCARDED fail-open.
 *
 * Aggregation rules (across the outputs, in REGISTRATION order — parallel
 * execution, deterministic fold):
 *   - permission decision: deny > defer > ask > allow. The legacy `decision`
 *     field maps onto this: 'block' -> deny (with its `reason`), 'approve' ->
 *     allow (only when the same output carries no explicit permissionDecision).
 *     'defer' (v0.2) ends the turn with a deferred_tool_use. Any OTHER
 *     unrecognized permissionDecision value fails closed as a DENY, never a
 *     silent allow.
 *   - continue:false wins; the FIRST non-empty stopReason is kept
 *   - systemMessage / additionalContext collected in registration order
 *   - updatedInput: from the LAST output carrying an 'allow' OR 'ask' decision
 *     (types.ts documents updatedInput as valid with allow and ask)
 *   - updatedToolOutput: last-wins
 *   - `void` / `{}` outputs are neutral; `async: true` outputs are detached
 *     (fire-and-forget) and treated as neutral
 */

import { randomUUID } from 'node:crypto';

import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  Options,
  SDKHookResponseMessage,
  SDKHookStartedMessage,
} from '../types.js';
import { AbortError } from '../errors.js';
import type { AggregatedHookResult, HookRunner } from '../internal/contracts.js';
import type { UtilityCallOptions } from '../generators/runtime.js';
import { evaluateHookCondition } from './condition.js';
import { readFileTail } from './goal.js';
import { matcherMatches } from './matcher.js';

const DEFAULT_TIMEOUT_SECONDS = 60;

/** Bounded transcript tail appended to a Stop-condition's context (M12) —
 *  same default the structured-goal gate uses for its evaluator. */
const CONDITION_TRANSCRIPT_TAIL_BYTES = 32_768;

/** hook_response.output carries a bounded JSON preview of the callback output. */
const HOOK_RESULT_PREVIEW_CHARS = 500;

export type HookRunnerConfig = {
  hooks: Options['hooks'];
  debug: (msg: string) => void;
  /** v0.4: hook-lifecycle sink (options.includeHookEvents). When set, every
   *  callback invocation emits a system/hook_started + system/hook_response
   *  pair (official `system`+subtype encoding since v0.7, correlated by
   *  hook_id) into the SDKMessage stream via the shared observability queue. */
  onLifecycleEvent?: (msg: SDKHookStartedMessage | SDKHookResponseMessage) => void;
  /** v0.6: credentials/transport for `condition`-gated matchers (provider /
   *  betas threaded from query options; tests inject a mock transport).
   *  Absent AND a matcher carries a condition -> the evaluation fails closed
   *  (no credential -> condition not met -> callbacks skipped). */
  conditionOptions?: UtilityCallOptions;
  /**
   * Failure policy for a callback that throws or times out (audit 2026-07-10
   * P1-5). 'open' (default, historical behavior): the failure is logged and
   * the output treated as neutral — a security hook that WOULD have denied is
   * silently bypassed. 'closed': the failure contributes a DENY decision to
   * the aggregate, so hook-enforced policy fails safe at the cost of blocking
   * tool calls while a policy hook is broken. Outer-signal cancellation is
   * never converted to a deny (the whole run is being cancelled).
   * Per-matcher override: HookCallbackMatcher.failureMode wins over this
   * global setting for that matcher's callbacks (audit 2026-07-14 M-1), so a
   * single security-critical matcher can fail closed while the global default
   * keeps official drop-in parity ('open').
   */
  failureMode?: 'open' | 'closed';
};

/** A promise that rejects when the signal aborts (used to bound callbacks
 *  that ignore their AbortSignal). Never resolves. */
/** Bounded JSON preview of a hook output for hook_response.output. */
function previewJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? 'null';
  } catch {
    text = '[non-serializable hook output]';
  }
  return text.length > HOOK_RESULT_PREVIEW_CHARS
    ? `${text.slice(0, HOOK_RESULT_PREVIEW_CHARS)}...`
    : text;
}

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
  private readonly onLifecycleEvent?: (
    msg: SDKHookStartedMessage | SDKHookResponseMessage,
  ) => void;
  private readonly conditionOptions?: UtilityCallOptions;
  private readonly failureMode: 'open' | 'closed';

  constructor(cfg: HookRunnerConfig) {
    this.hooks = cfg.hooks ?? {};
    this.debug = cfg.debug;
    this.onLifecycleEvent = cfg.onLifecycleEvent;
    this.conditionOptions = cfg.conditionOptions;
    this.failureMode = cfg.failureMode ?? 'open';
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

    // Pattern-match first, then admit through the (optional) condition gate.
    const matched = (this.hooks[event] ?? []).filter((m) =>
      matcherMatches(m.matcher, matchValue, this.debug),
    );
    const admitted = await this.filterByCondition(event, matched, input, signal);

    // Collect every callback of every admitted matcher.
    const tasks: Array<{
      cb: HookCallback;
      timeoutMs: number;
      failureMode: 'open' | 'closed';
    }> = [];
    for (const matcher of admitted) {
      const seconds =
        typeof matcher.timeout === 'number' &&
        Number.isFinite(matcher.timeout) &&
        matcher.timeout > 0
          ? matcher.timeout
          : DEFAULT_TIMEOUT_SECONDS;
      // Per-matcher failure policy wins over the runner-wide setting (audit
      // 2026-07-14 M-1): a security-critical matcher can fail closed while
      // the global default keeps official drop-in parity ('open').
      const failureMode = matcher.failureMode ?? this.failureMode;
      for (const cb of matcher.hooks) {
        tasks.push({ cb, timeoutMs: seconds * 1000, failureMode });
      }
    }

    // Run all callbacks in parallel but aggregate in REGISTRATION order
    // (Promise.all preserves positions), so last-wins fields (updatedInput /
    // updatedToolOutput) are deterministic run-to-run instead of racing on
    // completion order (audit 2026-07-10 L4). runOne never rejects.
    const settled = await Promise.all(
      tasks.map((task) =>
        this.runOne(
          event,
          task.cb,
          task.timeoutMs,
          task.failureMode,
          input,
          toolUseID,
          signal,
        ),
      ),
    );
    const outputs = settled.filter((out): out is HookJSONOutput => out !== undefined);

    // Cancellation is never swallowed as a "hook failure".
    if (signal.aborted) throw new AbortError();

    return this.aggregate(outputs);
  }

  /**
   * v0.6 condition gate: matchers carrying a natural-language `condition` are
   * admitted only when the reproduced hook-condition evaluator affirms it (the
   * stop variant for Stop / SubagentStop events). Evaluations run in parallel,
   * one bounded model call per conditioned matcher. FAILS CLOSED: a garbled or
   * errored evaluation (including no credential) counts as not met and the
   * matcher's callbacks are SKIPPED, with a debug line naming the reason.
   * Matchers without a condition pass straight through — when NO matcher has a
   * condition this returns synchronously with zero model calls, keeping
   * existing configurations byte-identical in behavior.
   */
  private async filterByCondition(
    event: HookEvent,
    matched: HookCallbackMatcher[],
    input: HookInput,
    signal: AbortSignal,
  ): Promise<HookCallbackMatcher[]> {
    if (!matched.some((m) => typeof m.condition === 'string' && m.condition.length > 0)) {
      return matched; // deterministic fast path: zero model calls
    }
    const stop = event === 'Stop' || event === 'SubagentStop';
    let context = JSON.stringify(input);
    // M12 (audit 2026-07-17): a Stop condition's judging material is the
    // TRANSCRIPT, but the hook input carries only transcript_path — the
    // evaluator saw a path string, could never find evidence, and (failing
    // closed) skipped the callbacks on every stop. Append a bounded tail of
    // the transcript so content conditions are actually decidable.
    if (stop) {
      const tp = (input as { transcript_path?: unknown }).transcript_path;
      if (typeof tp === 'string' && tp !== '') {
        const tail = readFileTail(tp, CONDITION_TRANSCRIPT_TAIL_BYTES);
        if (tail !== '') context += `\n\nTranscript tail:\n${tail}`;
      }
    }
    // M13 (audit 2026-07-17): "could not evaluate" is NOT a verdict. Under
    // the matcher's effective failureMode 'closed' an evaluation failure
    // ADMITS the matcher (a conditioned deny hook still denies); only a clean
    // negative verdict skips. 'open' (the drop-in default) keeps the old
    // skip-on-failure behavior.
    const failedAdmits = (m: HookCallbackMatcher): boolean =>
      (m.failureMode ?? this.failureMode) === 'closed';
    const verdicts = await Promise.all(
      matched.map(async (m) => {
        if (typeof m.condition !== 'string' || m.condition.length === 0) return true;
        try {
          const r = await evaluateHookCondition(
            { condition: m.condition, context, stop },
            { ...this.conditionOptions, signal },
          );
          if (r.evaluationFailed === true) {
            const admit = failedAdmits(m);
            this.debug(
              `hooks(${event}): condition evaluation failed (${r.reason}); ` +
                (admit
                  ? "failureMode 'closed': callbacks admitted"
                  : 'callbacks skipped'),
            );
            return admit;
          }
          if (!r.ok) {
            this.debug(
              `hooks(${event}): condition not met, callbacks skipped ` +
                `(${r.impossible === true ? 'impossible; ' : ''}${r.reason})`,
            );
          }
          return r.ok;
        } catch (err) {
          // Abort propagates as cancellation of the whole run; any other
          // failure is routed by the matcher's failureMode exactly like the
          // in-band evaluationFailed path above.
          if (signal.aborted) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          const admit = failedAdmits(m);
          this.debug(
            `hooks(${event}): condition evaluation failed (${msg}); ` +
              (admit ? "failureMode 'closed': callbacks admitted" : 'callbacks skipped'),
          );
          return admit;
        }
      }),
    );
    return matched.filter((_m, i) => verdicts[i] === true);
  }

  /** Run one callback with its own timeout; failures become debug warnings
   *  (or a deny under the effective failureMode 'closed'). */
  private async runOne(
    event: HookEvent,
    cb: HookCallback,
    timeoutMs: number,
    failureMode: 'open' | 'closed',
    input: HookInput,
    toolUseID: string | undefined,
    signal: AbortSignal,
  ): Promise<HookJSONOutput | undefined> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    // v0.4 lifecycle emission (includeHookEvents; official system+subtype
    // encoding since v0.7): one started/response pair per callback invocation,
    // correlated by a fresh hook_id. Every hook input carries session_id
    // (baseHookFields), read defensively anyway. hook_name is the callback
    // function's name — in-process callbacks have no command name.
    const hookId = this.onLifecycleEvent !== undefined ? randomUUID() : '';
    const hookName = cb.name !== '' ? cb.name : 'callback';
    const sessionId =
      typeof (input as { session_id?: unknown }).session_id === 'string'
        ? (input as { session_id: string }).session_id
        : '';
    this.onLifecycleEvent?.({
      type: 'system',
      subtype: 'hook_started',
      uuid: randomUUID(),
      session_id: sessionId,
      hook_id: hookId,
      hook_name: hookName,
      hook_event: event,
    });
    // Official hook_response payload: `output` carries the (bounded JSON)
    // callback output, a failure lands on `stderr` with outcome 'error' /
    // 'cancelled'. stdout is always '' and exit_code absent — in-process
    // callbacks have no stdio or exit code.
    const respond = (fields: {
      output: string;
      stderr?: string;
      outcome: 'success' | 'error' | 'cancelled';
    }): void => {
      this.onLifecycleEvent?.({
        type: 'system',
        subtype: 'hook_response',
        uuid: randomUUID(),
        session_id: sessionId,
        hook_id: hookId,
        hook_name: hookName,
        hook_event: event,
        output: fields.output,
        stdout: '',
        stderr: fields.stderr ?? '',
        outcome: fields.outcome,
      });
    };
    try {
      // The race bounds callbacks that ignore their signal: when the combined
      // signal fires, the callback's eventual result is discarded (detached).
      const result = await Promise.race([
        (async () => cb(input, toolUseID, { signal: combined }))(),
        abortRejection(combined),
      ]);
      respond({ output: result ? previewJson(result) : '', outcome: 'success' });
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
      // Outer-signal cancellation is 'cancelled'; a callback failure or its
      // own timeout is 'error'.
      respond({
        output: '',
        stderr: msg,
        outcome: signal.aborted ? 'cancelled' : 'error',
      });
      // failureMode 'closed' (audit 2026-07-10 P1-5; per-matcher override
      // audit 2026-07-14 M-1): a broken/timed-out hook must not silently wave
      // the call through — contribute a deny (legacy 'block' maps onto deny
      // in aggregate()). Cancellation of the whole run is never a deny;
      // run() rethrows AbortError right after.
      if (failureMode === 'closed' && !signal.aborted) {
        this.debug(
          `hooks(${event}): callback failed or timed out; failureMode 'closed' denies (${msg})`,
        );
        return {
          decision: 'block',
          reason: `hook "${hookName}" failed or timed out (${msg}); denied by failureMode 'closed'`,
        };
      }
      // Loud fail-open notice (audit 2026-07-14 M-1): the hook DID fail and
      // whatever it would have decided is being DISCARDED — the tool call
      // proceeds as if the hook had no opinion. A quiet one-liner here let a
      // crashed PreToolUse security hook be bypassed invisibly.
      this.debug(
        `hooks(${event}): WARNING hook "${hookName}" failed or timed out and its ` +
          `outcome was DISCARDED fail-open (failureMode 'open'): the tool call ` +
          `proceeds as if the hook had no opinion. Set failureMode 'closed' on ` +
          `the matcher (or Options.hookFailureMode) to fail safe. (${msg})`,
      );
      return undefined;
    }
  }

  /** Fold the collected outputs (in registration order). */
  private aggregate(outputs: HookJSONOutput[]): AggregatedHookResult {
    const agg: AggregatedHookResult = {
      continue: true,
      systemMessages: [],
      additionalContext: [],
    };
    let denyReason: string | undefined;
    let deferReason: string | undefined;
    let askReason: string | undefined;
    let allowReason: string | undefined;
    let sawDeny = false;
    let sawDefer = false;
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
      // suppressOutput:true hides this output's systemMessage from the
      // conversation surface (official semantics); decisions still apply.
      if (
        typeof out.systemMessage === 'string' &&
        out.systemMessage.length > 0 &&
        out.suppressOutput !== true
      ) {
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
      } else if (decision === 'defer') {
        // v0.2: a hook may defer a tool call for later approval. It ends the
        // current turn (deferred_tool_use on the result). Priority sits below
        // deny but above ask/allow so a co-occurring deny still wins.
        if (!sawDefer) {
          sawDefer = true;
          deferReason = reason;
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
        // Any other unrecognized permissionDecision: fail closed as a DENY,
        // never a silent allow.
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
    } else if (sawDefer) {
      agg.decision = 'defer';
      if (deferReason !== undefined) agg.decisionReason = deferReason;
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
