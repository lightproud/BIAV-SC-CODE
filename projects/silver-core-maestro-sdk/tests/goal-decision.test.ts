/**
 * Exhaustive spec of the pure goal-chase decision core (mutation target):
 * all four actions, the fixed precedence order, the round == maxRounds
 * boundary, and the non-finite guards. Verdict literals use the UNIFIED
 * {status, reason?} shape (0.83.0) shared verbatim with the agent SDK.
 */
import { describe, it, expect } from 'vitest';
import { nextGoalAction } from '../src/goal/decision.js';
import type { GoalVerdict } from '../src/goal/decision.js';

const achieved: GoalVerdict = { status: 'achieved' };
const notYet: GoalVerdict = { status: 'not_achieved', reason: 'more' };
const impossible: GoalVerdict = { status: 'impossible', reason: 'wall' };

describe('nextGoalAction: the four actions', () => {
  it('achieved => done', () => {
    expect(nextGoalAction({ round: 1, maxRounds: 5, verdict: achieved })).toBe('done');
  });

  it('not achieved with rounds remaining => continue', () => {
    expect(nextGoalAction({ round: 1, maxRounds: 5, verdict: notYet })).toBe('continue');
    expect(nextGoalAction({ round: 4, maxRounds: 5, verdict: notYet })).toBe('continue');
  });

  it('impossible => impossible', () => {
    expect(nextGoalAction({ round: 1, maxRounds: 5, verdict: impossible })).toBe('impossible');
  });

  it('not achieved at round >= maxRounds => exhausted', () => {
    expect(nextGoalAction({ round: 5, maxRounds: 5, verdict: notYet })).toBe('exhausted');
    expect(nextGoalAction({ round: 6, maxRounds: 5, verdict: notYet })).toBe('exhausted');
  });
});

describe('nextGoalAction: precedence', () => {
  it('achieved beats exhaustion (round >= maxRounds)', () => {
    expect(nextGoalAction({ round: 5, maxRounds: 5, verdict: achieved })).toBe('done');
    expect(nextGoalAction({ round: 9, maxRounds: 5, verdict: achieved })).toBe('done');
  });

  it('impossible beats exhaustion at round >= maxRounds', () => {
    expect(nextGoalAction({ round: 5, maxRounds: 5, verdict: impossible })).toBe('impossible');
    expect(nextGoalAction({ round: 7, maxRounds: 5, verdict: impossible })).toBe('impossible');
  });

  it('a reason on any status never changes the action (reason is commentary)', () => {
    expect(
      nextGoalAction({ round: 1, maxRounds: 5, verdict: { status: 'achieved', reason: 'r' } }),
    ).toBe('done');
    const bare: GoalVerdict = { status: 'not_achieved' };
    expect(nextGoalAction({ round: 1, maxRounds: 5, verdict: bare })).toBe('continue');
    expect(nextGoalAction({ round: 5, maxRounds: 5, verdict: bare })).toBe('exhausted');
  });
});

describe('nextGoalAction: boundary', () => {
  it('round == maxRounds is the exhaustion edge; one before is not', () => {
    expect(nextGoalAction({ round: 3, maxRounds: 3, verdict: notYet })).toBe('exhausted');
    expect(nextGoalAction({ round: 2, maxRounds: 3, verdict: notYet })).toBe('continue');
  });

  it('maxRounds 1 exhausts on the first unachieved round', () => {
    expect(nextGoalAction({ round: 1, maxRounds: 1, verdict: notYet })).toBe('exhausted');
    expect(nextGoalAction({ round: 1, maxRounds: 1, verdict: achieved })).toBe('done');
  });
});

describe('nextGoalAction: non-finite guards', () => {
  const bads = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it('non-finite round throws RangeError', () => {
    for (const bad of bads) {
      expect(() => nextGoalAction({ round: bad, maxRounds: 5, verdict: notYet })).toThrow(
        RangeError,
      );
    }
  });

  it('non-finite maxRounds throws RangeError', () => {
    for (const bad of bads) {
      expect(() => nextGoalAction({ round: 1, maxRounds: bad, verdict: notYet })).toThrow(
        RangeError,
      );
    }
  });

  it('guards fire even when the verdict alone would decide (achieved / impossible)', () => {
    expect(() => nextGoalAction({ round: Number.NaN, maxRounds: 5, verdict: achieved })).toThrow(
      RangeError,
    );
    expect(() => nextGoalAction({ round: 1, maxRounds: Number.NaN, verdict: impossible })).toThrow(
      RangeError,
    );
  });
});

describe('mutation kill round (2026-07-18)', () => {
  it('the non-finite guard message names both counters', () => {
    expect(() =>
      nextGoalAction({ round: NaN, maxRounds: 3, verdict: { status: 'achieved' } }),
    ).toThrow('nextGoalAction: round and maxRounds must be finite, got round=NaN, maxRounds=3');
  });
});

describe('unified verdict shape (0.83.0): status literals are the discriminant', () => {
  // Kills string-literal mutants on the two status comparisons: a verdict
  // whose status is any OTHER member must not take that branch.
  it("only status 'achieved' yields done; only 'impossible' yields impossible", () => {
    const statuses: GoalVerdict['status'][] = ['achieved', 'not_achieved', 'impossible'];
    const actions = statuses.map((status) =>
      nextGoalAction({ round: 1, maxRounds: 5, verdict: { status } }),
    );
    expect(actions).toEqual(['done', 'continue', 'impossible']);
  });
});
