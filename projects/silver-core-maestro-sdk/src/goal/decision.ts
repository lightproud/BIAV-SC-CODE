/**
 * Goal-chase decision core (campaign 5, SCS-REQ orchestrator-sdk §3
 * "跨会话目标循环"). Pure and synchronous — the single place that decides
 * what a chase does after a round's verdict, so it can be mutation-tested
 * exhaustively. No clock, no ledger, no I/O.
 */

/**
 * Host evaluator's judgment of one round.
 *
 * UNIFIED SHAPE (0.83.0, keeper ruling 2026-07-27): this is byte-for-byte
 * the agent SDK's `GoalVerdict` (silver-core-agent-sdk `options.goal`
 * evaluator verdict). The two packages previously exported same-NAME
 * different-SHAPE verdicts ({achieved, feedback} here vs {status, reason}
 * there); a consumer wiring one evaluator into the other seam produced a
 * "malformed verdict" that the engine fail-opens into an allowed stop — the
 * goal silently never bites. One shape ends that trap: a single evaluator
 * now serves both seams via structural typing. Deliberately DECLARED here
 * rather than imported — this package declares no dependency on the agent
 * SDK (hard property §1.2, no privileged channel); identity is structural.
 */
export type GoalVerdict = {
  status: 'achieved' | 'not_achieved' | 'impossible';
  reason?: string;
};

/**
 * What the chase does next:
 * - done:       goal achieved, stop
 * - continue:   not achieved, rounds remain, re-initiate with feedback
 * - impossible: evaluator declared the goal unreachable, stop
 * - exhausted:  round budget spent without attainment, stop
 * - cancelled:  the host cancelled a round's session, stop (0.78.0)
 *
 * `cancelled` is NEVER returned by nextGoalAction: it is not a verdict about
 * the goal, it is the host having said "stop, forever" about one round's
 * session. GoalChaser settles on it WITHOUT consulting the evaluator (asking
 * the judge to rule on a round the host itself cancelled is meaningless), so
 * this pure core keeps its four-verdict decision table unchanged.
 */
export type GoalAction = 'done' | 'continue' | 'impossible' | 'exhausted' | 'cancelled';

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
  if (verdict.status === 'achieved') return 'done';
  if (verdict.status === 'impossible') return 'impossible';
  if (round >= maxRounds) return 'exhausted';
  return 'continue';
}
