/**
 * /goal session-goal primitive. BPT-EXTENSION — the surface companion to the
 * engine's Stop-hook block semantics (v0.39): in Claude Code, `/goal
 * <condition>` arms a session-scoped Stop hook that BLOCKS stopping until
 * the condition holds (judged by the stop-variant condition evaluator over
 * the transcript) and auto-clears once met. The engine side of that loop
 * already exists here — engine/loop.ts honors a Stop-hook 'block' decision
 * by feeding the reason back as a user turn (root loop only, maxTurns /
 * maxBudgetUsd still cap it), and hooks/condition.ts ships the faithful
 * stop-variant evaluator prompt. What was missing is the /goal surface
 * itself; without it the invocation falls through as a one-shot plain
 * prompt exactly like the /loop gap (same 2026-07-14 report).
 *
 * Grammar (single source of truth — hosts must not re-implement it):
 *   /goal <condition>   arm (replaces any previous goal)
 *   /goal clear         disarm early
 *
 * FAILURE DIRECTION (deliberately INVERTED from hooks/condition.ts): there
 * the dangerous act is FIRING a hook, so an unverified condition fails
 * closed to "not met / don't fire". Here the dangerous act is BLOCKING the
 * stop — an evaluator outage that kept blocking would trap the agent in a
 * forced loop with no working judge. So an errored/unparseable evaluation
 * ALLOWS the stop (the goal stays armed and the host is told via
 * systemMessage); only an affirmative "not met" verdict blocks. The
 * evaluator's `impossible` escape hatch likewise allows the stop and
 * disarms the goal — same runaway protection, judged, not assumed.
 *
 * NOT registered in BUILTIN_SLASH_COMMANDS for the same honesty red line as
 * /loop: arming a goal is a host routing concern (the command arrives as a
 * user message), and the engine must not advertise a command it would
 * swallow as plain text. `GOAL_SLASH_COMMAND` is menu metadata for hosts
 * that wire the bridge.
 */

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

import { ConfigurationError } from '../errors.js';
import { HOOK_STOP_CONDITION_SYSTEM } from './condition.js';
import { parseHookCondition } from './condition.js';
import {
  extractJsonObject,
  runUtilityCall,
  type UtilityCallOptions,
} from '../generators/runtime.js';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  SlashCommand,
  StopHookInput,
} from '../types.js';

/** Menu metadata for hosts that wire the bridge (see module header). */
export const GOAL_SLASH_COMMAND: SlashCommand = {
  name: 'goal',
  description:
    'Set a session goal that blocks stopping until the condition holds (auto-clears when met); /goal clear disarms',
  argumentHint: '<condition> | clear',
};

export type GoalCommandAction =
  | { kind: 'set'; condition: string }
  | { kind: 'clear' };

export type GoalCommandParse =
  | { ok: true; action: GoalCommandAction }
  | { ok: false; error: string };

const GOAL_INVOCATION_RE = /^\/goal(?:\s+([\s\S]+))?$/;

/**
 * Parse a `/goal` invocation. Returns null when the input is not a /goal
 * command at all (route it as usual); `{ ok: false }` when it IS /goal but
 * unusable — hosts must surface that error instead of passing the text
 * through as a plain prompt.
 */
export function parseGoalCommand(input: string): GoalCommandParse | null {
  const m = GOAL_INVOCATION_RE.exec(input.trim());
  if (!m) return null;
  const args = m[1]?.trim() ?? '';
  if (!args) {
    return { ok: false, error: '/goal requires a goal condition (or "clear")' };
  }
  if (args === 'clear') return { ok: true, action: { kind: 'clear' } };
  return { ok: true, action: { kind: 'set', condition: args } };
}

/** Host-observable lifecycle notifications (UI badges, logs). */
export type SessionGoalEvent =
  | { kind: 'set'; condition: string }
  | { kind: 'cleared'; condition: string }
  | { kind: 'met'; condition: string; reason: string }
  | { kind: 'impossible'; condition: string; reason: string }
  | { kind: 'blocked'; condition: string; reason: string; blocks: number }
  | { kind: 'evaluator_error'; condition: string; reason: string }
  | { kind: 'block_limit'; condition: string; blocks: number };

export type SessionGoalOptions = {
  /** Credentials / model / transport for the evaluator call (test seam). */
  utility?: UtilityCallOptions;
  /**
   * Optional cap on consecutive stop-blocks per armed goal; exceeding it
   * allows the stop (goal stays armed, `block_limit` event fires). Default
   * unbounded — the ENGINE already caps the forced loop via maxTurns /
   * maxBudgetUsd, so this is an extra host-policy knob, not the safety net.
   */
  maxBlocks?: number;
  /**
   * Evaluator context override. Default: the tail of the Stop hook input's
   * `transcript_path` file (bounded by `transcriptTailBytes`). When NO
   * context can be assembled the evaluator is not called blind — the stop is
   * allowed with an `evaluator_error` event (judging "insufficient evidence"
   * over an empty transcript would block forever).
   */
  context?: (input: StopHookInput) => string | Promise<string>;
  /** Bounded transcript-tail read for the default context (default 32 KiB). */
  transcriptTailBytes?: number;
  onEvent?: (event: SessionGoalEvent) => void;
};

export type GoalCommandOutcome =
  | { handled: false }
  | { handled: true; ok: false; error: string }
  | { handled: true; ok: true; action: GoalCommandAction; message: string };

export type SessionGoal = {
  /** Arm (or replace) the goal; resets the block counter. */
  set(condition: string): void;
  /** Disarm early (the /goal clear path). No-op when nothing is armed. */
  clear(): void;
  readonly condition: string | null;
  /** Consecutive stop-blocks for the currently armed goal. */
  readonly blocks: number;
  /**
   * One-call host bridge: route any user input through this before
   * submitting it as a prompt. `{handled:false}` means "not /goal — submit
   * as usual"; an ok:false outcome must be surfaced, never passed through.
   */
  handleCommand(input: string): GoalCommandOutcome;
  /** Merge into `options.hooks` (spread-friendly: `{...goal.hooks()}`). */
  hooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>>;
};

/** Bounded tail read; any I/O trouble degrades to ''. */
function readFileTail(path: string, maxBytes: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const want = Math.min(size, maxBytes);
    if (want === 0) return '';
    const buf = Buffer.alloc(want);
    readSync(fd, buf, 0, want, size - want);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const DEFAULT_TRANSCRIPT_TAIL_BYTES = 32_768;

export function createSessionGoal(options: SessionGoalOptions = {}): SessionGoal {
  const {
    utility = {},
    maxBlocks,
    context,
    transcriptTailBytes = DEFAULT_TRANSCRIPT_TAIL_BYTES,
    onEvent,
  } = options;
  if (maxBlocks !== undefined && (!Number.isInteger(maxBlocks) || maxBlocks < 1)) {
    throw new ConfigurationError('createSessionGoal: maxBlocks must be a positive integer');
  }
  if (!Number.isInteger(transcriptTailBytes) || transcriptTailBytes < 1) {
    throw new ConfigurationError(
      'createSessionGoal: transcriptTailBytes must be a positive integer',
    );
  }

  let condition: string | null = null;
  let blocks = 0;
  const emit = (event: SessionGoalEvent) => onEvent?.(event);

  async function contextFor(input: StopHookInput): Promise<string> {
    if (context !== undefined) return await context(input);
    const parts: string[] = [];
    if (typeof input.last_assistant_message === 'string' && input.last_assistant_message !== '') {
      parts.push(`Last assistant message:\n${input.last_assistant_message}`);
    }
    if (typeof input.transcript_path === 'string' && input.transcript_path !== '') {
      const tail = readFileTail(input.transcript_path, transcriptTailBytes);
      if (tail !== '') parts.push(`Transcript tail:\n${tail}`);
    }
    return parts.join('\n\n');
  }

  async function onStop(
    input: HookInput,
    _toolUseId: string | undefined,
    callbackOptions: { signal: AbortSignal },
  ): Promise<HookJSONOutput> {
    if (condition === null || input.hook_event_name !== 'Stop') return {};
    const goal = condition;

    let ctx: string;
    try {
      ctx = await contextFor(input);
    } catch {
      ctx = '';
    }
    if (ctx === '') {
      // Never judge blind: an empty transcript reads as "insufficient
      // evidence" and would block every stop forever.
      const reason = 'no transcript context available for goal evaluation';
      emit({ kind: 'evaluator_error', condition: goal, reason });
      return { systemMessage: `Session goal "${goal}" could not be verified (${reason}); allowing stop, goal stays armed` };
    }

    let raw: string;
    try {
      raw = await runUtilityCall(
        HOOK_STOP_CONDITION_SYSTEM,
        `Condition:\n${goal}\n\nContext:\n${ctx}`,
        { ...utility, signal: callbackOptions.signal },
        256,
      );
    } catch (err) {
      if (callbackOptions.signal.aborted) throw err; // an abort is not a verdict
      const reason = err instanceof Error ? err.message : String(err);
      emit({ kind: 'evaluator_error', condition: goal, reason });
      return { systemMessage: `Session goal "${goal}" could not be verified (${reason}); allowing stop, goal stays armed` };
    }
    if (extractJsonObject(raw) === null) {
      // Unparseable is NOT a "not met" verdict here (inverted failure
      // direction, see module header): allow the stop, keep the goal armed.
      const reason = 'unparseable condition-evaluator reply';
      emit({ kind: 'evaluator_error', condition: goal, reason });
      return { systemMessage: `Session goal "${goal}" could not be verified (${reason}); allowing stop, goal stays armed` };
    }

    const verdict = parseHookCondition(raw);
    if (verdict.ok) {
      condition = null;
      blocks = 0;
      emit({ kind: 'met', condition: goal, reason: verdict.reason });
      return { systemMessage: `Session goal met (${verdict.reason}); goal cleared` };
    }
    if (verdict.impossible === true) {
      condition = null;
      blocks = 0;
      emit({ kind: 'impossible', condition: goal, reason: verdict.reason });
      return {
        systemMessage: `Session goal "${goal}" judged impossible (${verdict.reason}); goal cleared`,
      };
    }
    if (maxBlocks !== undefined && blocks >= maxBlocks) {
      emit({ kind: 'block_limit', condition: goal, blocks });
      return {
        systemMessage: `Session goal "${goal}" still unmet after ${blocks} blocked stops (maxBlocks); allowing stop, goal stays armed`,
      };
    }
    blocks += 1;
    emit({ kind: 'blocked', condition: goal, reason: verdict.reason, blocks });
    return {
      decision: 'block',
      reason:
        `Session goal not yet met: "${goal}". Evaluator: ${verdict.reason}. ` +
        'Continue working toward the goal; it auto-clears once the condition holds.',
    };
  }

  return {
    set(next: string): void {
      if (typeof next !== 'string' || next.trim() === '') {
        throw new ConfigurationError('SessionGoal.set: condition must be a non-empty string');
      }
      condition = next.trim();
      blocks = 0;
      emit({ kind: 'set', condition });
    },
    clear(): void {
      if (condition === null) return;
      const previous = condition;
      condition = null;
      blocks = 0;
      emit({ kind: 'cleared', condition: previous });
    },
    get condition(): string | null {
      return condition;
    },
    get blocks(): number {
      return blocks;
    },
    handleCommand(input: string): GoalCommandOutcome {
      const parsed = parseGoalCommand(input);
      if (parsed === null) return { handled: false };
      if (!parsed.ok) return { handled: true, ok: false, error: parsed.error };
      if (parsed.action.kind === 'clear') {
        const hadGoal = condition !== null;
        this.clear();
        return {
          handled: true,
          ok: true,
          action: parsed.action,
          message: hadGoal ? 'Goal cleared' : 'No active goal to clear',
        };
      }
      this.set(parsed.action.condition);
      return {
        handled: true,
        ok: true,
        action: parsed.action,
        message: `Goal set: ${parsed.action.condition}`,
      };
    },
    hooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
      return { Stop: [{ hooks: [onStop] }] };
    },
  };
}
