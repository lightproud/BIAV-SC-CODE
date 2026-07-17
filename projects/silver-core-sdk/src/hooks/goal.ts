/**
 * Structured session goal (SCS-REQ-REPOS-01 §4.3) — a stricter stopping
 * condition for the agent loop, configured as `options.goal`. The STRUCTURED
 * config is the goal's ONLY entrance: the engine recognizes no goal text
 * convention of any kind.
 *
 * Mechanism (all inside one query lifetime — no wall clock):
 *   - The goal arms a Stop gate over the engine's Stop-hook block semantics.
 *   - The HOST-INJECTED evaluator judges each natural stop: a deterministic
 *     pure function (run tests / assertions — preferred) or the host's own
 *     judge-model call (fresh context, host-chosen model and budget; the
 *     engine hardcodes no model choice).
 *   - `not_achieved` BLOCKS the stop and feeds the evaluator's reason back
 *     into the loop as a user turn (the engine re-drives; maxTurns /
 *     maxBudgetUsd still cap it).
 *   - `achieved` allows the stop and disarms.
 *   - `impossible` is the judged escape hatch: allows the stop and disarms.
 *
 * FAILURE DIRECTION (deliberate, inherited from the goal gate's first
 * incarnation): the dangerous act here is BLOCKING a stop — a broken
 * evaluator that kept blocking would trap the agent in a forced loop with no
 * working judge. So an evaluator throw or a malformed verdict ALLOWS the
 * stop (goal stays armed, host notified via systemMessage + onEvent); only
 * an affirmative `not_achieved` verdict blocks.
 */

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

import { ConfigurationError } from '../errors.js';
import type {
  GoalConfig,
  GoalEvent,
  GoalVerdict,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  StopHookInput,
} from '../types.js';

const DEFAULT_TRANSCRIPT_TAIL_BYTES = 32_768;

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

function isVerdict(v: unknown): v is GoalVerdict {
  return (
    typeof v === 'object' &&
    v !== null &&
    ((v as { status?: unknown }).status === 'achieved' ||
      (v as { status?: unknown }).status === 'not_achieved' ||
      (v as { status?: unknown }).status === 'impossible')
  );
}

/**
 * Build the Stop-hook matchers for a structured goal. Query assembly merges
 * these into the effective hook set when `options.goal` is present.
 */
export function createGoalStopHooks(
  config: GoalConfig,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  if (typeof config.goal !== 'string' || config.goal.trim() === '') {
    throw new ConfigurationError('options.goal.goal must be a non-empty string');
  }
  if (typeof config.evaluator !== 'function') {
    throw new ConfigurationError('options.goal.evaluator must be a function');
  }
  if (
    config.maxBlocks !== undefined &&
    (!Number.isInteger(config.maxBlocks) || config.maxBlocks < 1)
  ) {
    throw new ConfigurationError('options.goal.maxBlocks must be a positive integer');
  }
  const tailBytes = config.transcriptTailBytes ?? DEFAULT_TRANSCRIPT_TAIL_BYTES;
  if (!Number.isInteger(tailBytes) || tailBytes < 1) {
    throw new ConfigurationError(
      'options.goal.transcriptTailBytes must be a positive integer',
    );
  }

  const goal = config.goal.trim();
  let armed = true;
  let blocks = 0;
  const emit = (event: GoalEvent) => config.onEvent?.(event);

  function contextOf(input: StopHookInput): string {
    const parts: string[] = [];
    if (
      typeof input.last_assistant_message === 'string' &&
      input.last_assistant_message !== ''
    ) {
      parts.push(`Last assistant message:\n${input.last_assistant_message}`);
    }
    if (typeof input.transcript_path === 'string' && input.transcript_path !== '') {
      const tail = readFileTail(input.transcript_path, tailBytes);
      if (tail !== '') parts.push(`Transcript tail:\n${tail}`);
    }
    return parts.join('\n\n');
  }

  async function onStop(
    input: HookInput,
    _toolUseId: string | undefined,
    callbackOptions: { signal: AbortSignal },
  ): Promise<HookJSONOutput> {
    if (!armed || input.hook_event_name !== 'Stop') return {};

    let verdict: GoalVerdict;
    try {
      const v = await config.evaluator({
        goal,
        context: contextOf(input),
        blocks,
        signal: callbackOptions.signal,
      });
      if (callbackOptions.signal.aborted) return {};
      if (!isVerdict(v)) {
        const reason = 'evaluator returned a malformed verdict';
        emit({ kind: 'evaluator_error', goal, reason });
        return {
          systemMessage: `Goal "${goal}" could not be verified (${reason}); allowing stop, goal stays armed`,
        };
      }
      verdict = v;
    } catch (err) {
      if (callbackOptions.signal.aborted) throw err; // an abort is not a verdict
      const reason = err instanceof Error ? err.message : String(err);
      emit({ kind: 'evaluator_error', goal, reason });
      return {
        systemMessage: `Goal "${goal}" could not be verified (${reason}); allowing stop, goal stays armed`,
      };
    }

    if (verdict.status === 'achieved') {
      armed = false;
      emit({ kind: 'achieved', goal, reason: verdict.reason ?? '' });
      return {
        systemMessage: `Goal achieved${verdict.reason ? ` (${verdict.reason})` : ''}; goal disarmed`,
      };
    }
    if (verdict.status === 'impossible') {
      armed = false;
      emit({ kind: 'impossible', goal, reason: verdict.reason ?? '' });
      return {
        systemMessage: `Goal "${goal}" judged impossible${verdict.reason ? ` (${verdict.reason})` : ''}; goal disarmed`,
      };
    }
    // not_achieved
    if (config.maxBlocks !== undefined && blocks >= config.maxBlocks) {
      emit({ kind: 'block_limit', goal, blocks });
      return {
        systemMessage: `Goal "${goal}" still unmet after ${blocks} blocked stops (maxBlocks); allowing stop, goal stays armed`,
      };
    }
    blocks += 1;
    const reason = verdict.reason ?? 'the evaluator gave no reason';
    emit({ kind: 'blocked', goal, reason, blocks });
    return {
      decision: 'block',
      reason:
        `Goal not yet achieved: "${goal}". Evaluator: ${reason}. ` +
        'Continue working toward the goal.',
    };
  }

  return { Stop: [{ hooks: [onStop] }] };
}
