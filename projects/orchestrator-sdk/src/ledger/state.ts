/**
 * Pure state-machine core of the task ledger (SCS-REQ orchestrator-sdk §4):
 * the closed transition graph and retry arithmetic, with no I/O, no clock and
 * no store — this file is the mutation-testing target, so every branch here
 * must be behaviorally pinned by tests.
 */

import type { SessionState } from './types.js';

/** The closed state set, in lifecycle order. */
export const SESSION_STATES: readonly SessionState[] = [
  'pending',
  'running',
  'retrying',
  'failed',
  'done',
];

/** States with no outgoing transitions. */
export const TERMINAL_STATES: readonly SessionState[] = ['failed', 'done'];

/**
 * Ledger events driving the session state machine:
 * - claim:            the driver takes a due session for an attempt
 * - attempt:ok:       the attempt succeeded
 * - attempt:error:    the attempt failed
 * - attempt:timeout:  the attempt hit the driver's per-attempt timeout
 *
 * Retries are not a distinct event: a failed/timed-out attempt lands in
 * `retrying` while attempts remain, and a due retry is claimed with the same
 * `claim` event that first started the session.
 */
export type SessionEvent = 'claim' | 'attempt:ok' | 'attempt:error' | 'attempt:timeout';

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
 */
export function transition(
  state: SessionState,
  event: SessionEvent,
  ctx: TransitionContext,
): SessionState {
  if (state === 'pending' || state === 'retrying') {
    if (event === 'claim') return 'running';
  } else if (state === 'running') {
    if (event === 'attempt:ok') return 'done';
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
 * blowup (factor overflow) lands on the cap, never on Infinity/NaN.
 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  if (!Number.isFinite(attempt) || attempt < 1) {
    throw new RangeError(`backoffDelayMs: attempt must be a finite number >= 1, got ${attempt}`);
  }
  const raw = policy.baseDelayMs * Math.pow(policy.factor, attempt - 1);
  const capped = Math.min(raw, policy.maxDelayMs);
  return Number.isFinite(capped) && capped >= 0 ? capped : policy.maxDelayMs;
}
