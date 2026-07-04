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
 *   - permission decision: deny > defer > ask > allow. The legacy `decision`
 *     field maps onto this: 'block' -> deny (with its `reason`), 'approve' ->
 *     allow (only when the same output carries no explicit permissionDecision).
 *     'defer' (v0.2) ends the turn with a deferred_tool_use. Any OTHER
 *     unrecognized permissionDecision value fails closed as a DENY, never a
 *     silent allow.
 *   - continue:false wins; the FIRST non-empty stopReason is kept
 *   - systemMessage / additionalContext collected in completion order
 *   - updatedInput: from the LAST output carrying an 'allow' OR 'ask' decision
 *     (types.ts documents updatedInput as valid with allow and ask)
 *   - updatedToolOutput: last-wins
 *   - `void` / `{}` outputs are neutral; `async: true` outputs are detached
 *     (fire-and-forget) and treated as neutral
 */

import { randomUUID } from 'node:crypto';

import type {
  HookCallback,
  HookEvent,
  HookInput,
  HookJSONOutput,
  Options,
  SDKHookResponseMessage,
  SDKHookStartedMessage,
} from '../types.js';
import { AbortError } from '../errors.js';
import type { AggregatedHookResult, HookRunner } from '../internal/contracts.js';
import { matcherMatches } from './matcher.js';

const DEFAULT_TIMEOUT_SECONDS = 60;

/** hook_response.result carries a bounded JSON preview of the output. */
const HOOK_RESULT_PREVIEW_CHARS = 500;

export type HookRunnerConfig = {
  hooks: Options['hooks'];
  debug: (msg: string) => void;
  /** v0.4: hook-lifecycle sink (options.includeHookEvents). When set, every
   *  callback invocation emits a hook_started / hook_response pair (correlated
   *  by hook_id) into the SDKMessage stream via the shared observability queue. */
  onLifecycleEvent?: (msg: SDKHookStartedMessage | SDKHookResponseMessage) => void;
};

/** A promise that rejects when the signal aborts (used to bound callbacks
 *  that ignore their AbortSignal). Never resolves. */
/** Bounded JSON preview of a hook output for hook_response.result. */
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

  constructor(cfg: HookRunnerConfig) {
    this.hooks = cfg.hooks ?? {};
    this.debug = cfg.debug;
    this.onLifecycleEvent = cfg.onLifecycleEvent;
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
    // v0.4 lifecycle emission (includeHookEvents): one started/response pair
    // per callback invocation, correlated by a fresh hook_id. Every hook input
    // carries session_id (baseHookFields), read defensively anyway.
    const hookId = this.onLifecycleEvent !== undefined ? randomUUID() : '';
    const sessionId =
      typeof (input as { session_id?: unknown }).session_id === 'string'
        ? (input as { session_id: string }).session_id
        : '';
    this.onLifecycleEvent?.({
      type: 'hook_started',
      uuid: randomUUID(),
      session_id: sessionId,
      hook_id: hookId,
      hook_event: event,
    });
    const respond = (fields: { result?: string; error?: string }): void => {
      this.onLifecycleEvent?.({
        type: 'hook_response',
        uuid: randomUUID(),
        session_id: sessionId,
        hook_id: hookId,
        hook_event: event,
        ...fields,
      });
    };
    try {
      // The race bounds callbacks that ignore their signal: when the combined
      // signal fires, the callback's eventual result is discarded (detached).
      const result = await Promise.race([
        (async () => cb(input, toolUseID, { signal: combined }))(),
        abortRejection(combined),
      ]);
      respond(result ? { result: previewJson(result) } : {});
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
      respond({ error: msg });
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
