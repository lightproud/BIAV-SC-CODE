/**
 * Pure state-machine core of the task ledger (SCS-REQ orchestrator-sdk §4):
 * the closed transition graph and retry arithmetic, with no I/O, no clock and
 * no store — this file is the mutation-testing target, so every branch here
 * must be behaviorally pinned by tests.
 */

import type { SessionState } from './types.js';

/** The closed state set, in lifecycle order (terminals last; `cancelled`
 *  appended at the END in 0.76.0 so downstreams relying on index order of
 *  the first five entries are undisturbed). */
export const SESSION_STATES: readonly SessionState[] = [
  'pending',
  'running',
  'retrying',
  'failed',
  'done',
  'cancelled',
];

/** States with no outgoing transitions. */
export const TERMINAL_STATES: readonly SessionState[] = ['failed', 'done', 'cancelled'];

/**
 * Ledger events driving the session state machine:
 * - claim:            the driver takes a due session for an attempt
 * - attempt:ok:       the attempt succeeded
 * - attempt:error:    the attempt failed
 * - attempt:timeout:  the attempt hit the driver's per-attempt timeout
 * - cancel:           the host cancels the session (0.76.0, BPT P0-D1) —
 *                     legal from every NON-terminal state, lands in the
 *                     terminal `cancelled` and never re-enters the retry path
 *
 * Retries are not a distinct event: a failed/timed-out attempt lands in
 * `retrying` while attempts remain, and a due retry is claimed with the same
 * `claim` event that first started the session.
 */
export type SessionEvent = 'claim' | 'attempt:ok' | 'attempt:error' | 'attempt:timeout' | 'cancel';

export class InvalidTransitionError extends Error {
  readonly state: SessionState;
  readonly event: SessionEvent;
  constructor(state: SessionState, event: SessionEvent, detail?: string) {
    super(
      `invalid session transition: event '${event}' in state '${state}'` +
        (detail ? ` (${detail})` : ''),
    );
    this.name = 'InvalidTransitionError';
    this.state = state;
    this.event = event;
  }
}

/** Context the transition function needs for retry-exhaustion decisions. */
export interface TransitionContext {
  /** Attempts made so far, INCLUDING the attempt whose outcome is being applied. */
  attempts: number;
  maxAttempts: number;
}

/**
 * The closed transition function. Returns the next state or throws
 * InvalidTransitionError — there is no third possibility, and terminal
 * states accept no event.
 *
 *   pending  --claim-->            running
 *   retrying --claim-->            running
 *   running  --attempt:ok-->       done
 *   running  --attempt:error-->    retrying | failed  (attempts vs maxAttempts)
 *   running  --attempt:timeout-->  retrying | failed  (attempts vs maxAttempts)
 *   pending  --cancel-->           cancelled          (0.76.0)
 *   running  --cancel-->           cancelled          (0.76.0)
 *   retrying --cancel-->           cancelled          (0.76.0)
 */
export function transition(
  state: SessionState,
  event: SessionEvent,
  ctx: TransitionContext,
): SessionState {
  if (state === 'pending' || state === 'retrying') {
    if (event === 'claim') return 'running';
    if (event === 'cancel') return 'cancelled';
  } else if (state === 'running') {
    if (event === 'attempt:ok') return 'done';
    if (event === 'cancel') return 'cancelled';
    if (event === 'attempt:error' || event === 'attempt:timeout') {
      // NaN / non-finite counters poison a >= comparison into a permanent
      // 'retrying' — reject them loudly instead of retrying forever.
      if (!Number.isFinite(ctx.attempts) || !Number.isFinite(ctx.maxAttempts)) {
        throw new InvalidTransitionError(
          state,
          event,
          `non-finite attempt counters: attempts=${ctx.attempts} maxAttempts=${ctx.maxAttempts}`,
        );
      }
      return ctx.attempts >= ctx.maxAttempts ? 'failed' : 'retrying';
    }
  }
  throw new InvalidTransitionError(state, event);
}

/** Exponential-backoff retry policy. */
export interface RetryPolicy {
  /** Attempt ceiling per session (>= 1). */
  maxAttempts: number;
  /** Delay before retry 1 (after the first failed attempt), in ms. */
  baseDelayMs: number;
  /** Multiplier per additional failed attempt. */
  factor: number;
  /** Hard cap on any single delay, in ms. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  factor: 2,
  maxDelayMs: 60_000,
};

/**
 * Delay before the NEXT attempt, given that `attempt` attempts have already
 * failed: baseDelayMs * factor^(attempt-1), capped at maxDelayMs. A non-finite
 * blowup of the COMPUTED value (factor overflow) lands on the cap, never on
 * Infinity/NaN — but the policy numbers themselves must be finite and >= 0:
 * a non-finite cap (e.g. `{ maxDelayMs: undefined }` smuggled through a
 * Partial merge) poisons Math.min AND the fallback, so the poisoned cap would
 * be returned verbatim, making nextRunAt NaN and wedging the session in
 * 'retrying' permanently. Rejected loudly where the numbers enter.
 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  if (!Number.isFinite(attempt) || attempt < 1) {
    throw new RangeError(`backoffDelayMs: attempt must be a finite number >= 1, got ${attempt}`);
  }
  for (const key of ['baseDelayMs', 'factor', 'maxDelayMs'] as const) {
    const value = policy[key];
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`backoffDelayMs: policy.${key} must be a finite number >= 0, got ${value}`);
    }
  }
  const raw = policy.baseDelayMs * Math.pow(policy.factor, attempt - 1);
  const capped = Math.min(raw, policy.maxDelayMs);
  // With validated inputs, raw can still be NaN (0 * Infinity when factor
  // overflows with a zero base) — that lands on the finite cap.
  return Number.isFinite(capped) ? capped : policy.maxDelayMs;
}
