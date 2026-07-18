/**
 * Goal-chase decision core (campaign 5, SCS-REQ orchestrator-sdk §3
 * "跨会话目标循环"). Pure and synchronous — the single place that decides
 * what a chase does after a round's verdict, so it can be mutation-tested
 * exhaustively. No clock, no ledger, no I/O.
 */

/**
 * Host evaluator's judgment of one round. `impossible` may only accompany a
 * non-achieved verdict: it marks the goal as unreachable regardless of
 * remaining rounds.
 */
export type GoalVerdict =
  | { achieved: true }
  | { achieved: false; feedback: string; impossible?: boolean };

/**
 * What the chase does next:
 * - done:       goal achieved, stop
 * - continue:   not achieved, rounds remain, re-initiate with feedback
 * - impossible: evaluator declared the goal unreachable, stop
 * - exhausted:  round budget spent without attainment, stop
 */
export type GoalAction = 'done' | 'continue' | 'impossible' | 'exhausted';

/**
 * Precedence (fixed): achieved beats everything; impossible beats
 * exhaustion (an unreachable goal on its last round settles as
 * 'impossible', not 'exhausted'); exhaustion at round >= maxRounds beats
 * continue. Non-finite round/maxRounds throw RangeError — NaN compares
 * false against any bound and would otherwise 'continue' forever.
 */
export function nextGoalAction(input: {
  round: number;
  maxRounds: number;
  verdict: GoalVerdict;
}): GoalAction {
  const { round, maxRounds, verdict } = input;
  if (!Number.isFinite(round) || !Number.isFinite(maxRounds)) {
    throw new RangeError(
      `nextGoalAction: round and maxRounds must be finite, got round=${round}, maxRounds=${maxRounds}`,
    );
  }
  if (verdict.achieved) return 'done';
  if (verdict.impossible === true) return 'impossible';
  if (round >= maxRounds) return 'exhausted';
  return 'continue';
}
