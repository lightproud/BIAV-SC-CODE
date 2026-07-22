import { describe, it, expect } from 'vitest';
import {
  SESSION_STATES,
  TERMINAL_STATES,
  InvalidTransitionError,
  transition,
  backoffDelayMs,
  DEFAULT_RETRY_POLICY,
  type SessionEvent,
  type RetryPolicy,
} from '../src/ledger/state.js';
import type { SessionState } from '../src/ledger/types.js';

const ALL_EVENTS: SessionEvent[] = ['claim', 'attempt:ok', 'attempt:error', 'attempt:timeout', 'cancel'];
const CTX = { attempts: 1, maxAttempts: 3 };

describe('state sets', () => {
  it('pins the closed state set, in lifecycle order (cancelled appended LAST, 0.76.0)', () => {
    expect(SESSION_STATES).toEqual(['pending', 'running', 'retrying', 'failed', 'done', 'cancelled']);
  });
  it('pins the terminal states', () => {
    expect(TERMINAL_STATES).toEqual(['failed', 'done', 'cancelled']);
  });
});

describe('transition — the full matrix', () => {
  // Every (state, event) pair is either exactly the documented next state or
  // an InvalidTransitionError; this table IS the closed graph.
  const legal: Array<[SessionState, SessionEvent, SessionState]> = [
    ['pending', 'claim', 'running'],
    ['retrying', 'claim', 'running'],
    ['running', 'attempt:ok', 'done'],
    ['running', 'attempt:error', 'retrying'], // attempts 1 < maxAttempts 3
    ['running', 'attempt:timeout', 'retrying'],
    ['pending', 'cancel', 'cancelled'], // 0.76.0: cancel from every non-terminal
    ['running', 'cancel', 'cancelled'],
    ['retrying', 'cancel', 'cancelled'],
  ];

  it.each(legal)('%s --%s--> %s', (state, event, next) => {
    expect(transition(state, event, CTX)).toBe(next);
  });

  it('rejects every other (state, event) pair', () => {
    const legalKeys = new Set(legal.map(([s, e]) => `${s}|${e}`));
    for (const state of SESSION_STATES) {
      for (const event of ALL_EVENTS) {
        if (legalKeys.has(`${state}|${event}`)) continue;
        expect(() => transition(state, event, CTX)).toThrowError(InvalidTransitionError);
      }
    }
  });

  it('carries state and event on the error', () => {
    try {
      transition('done', 'claim', CTX);
      expect.unreachable('must throw');
    } catch (e) {
      const err = e as InvalidTransitionError;
      expect(err.name).toBe('InvalidTransitionError');
      expect(err.state).toBe('done');
      expect(err.event).toBe('claim');
      expect(err.message).toContain("event 'claim'");
      expect(err.message).toContain("state 'done'");
    }
  });
});

describe('transition — retry counting', () => {
  it('retries while attempts < maxAttempts', () => {
    expect(transition('running', 'attempt:error', { attempts: 2, maxAttempts: 3 })).toBe('retrying');
  });
  it('fails exactly at attempts == maxAttempts (exhaustion boundary)', () => {
    expect(transition('running', 'attempt:error', { attempts: 3, maxAttempts: 3 })).toBe('failed');
  });
  it('fails past the boundary too', () => {
    expect(transition('running', 'attempt:timeout', { attempts: 4, maxAttempts: 3 })).toBe('failed');
  });
  it('a single-attempt session fails on its first error', () => {
    expect(transition('running', 'attempt:error', { attempts: 1, maxAttempts: 1 })).toBe('failed');
  });
  it('timeout counts against the same ceiling as error', () => {
    expect(transition('running', 'attempt:timeout', { attempts: 3, maxAttempts: 3 })).toBe('failed');
    expect(transition('running', 'attempt:timeout', { attempts: 2, maxAttempts: 3 })).toBe('retrying');
  });
  it('rejects non-finite attempt counters instead of retrying forever', () => {
    expect(() => transition('running', 'attempt:error', { attempts: NaN, maxAttempts: 3 })).toThrowError(
      InvalidTransitionError,
    );
    expect(() => transition('running', 'attempt:error', { attempts: 1, maxAttempts: NaN })).toThrowError(
      InvalidTransitionError,
    );
    expect(() =>
      transition('running', 'attempt:timeout', { attempts: Infinity, maxAttempts: 3 }),
    ).toThrowError(InvalidTransitionError);
  });
  it('ok is unaffected by attempt counters (no exhaustion check)', () => {
    expect(transition('running', 'attempt:ok', { attempts: 99, maxAttempts: 1 })).toBe('done');
  });
  it('cancel is unaffected by attempt counters — never lands in failed (0.76.0)', () => {
    expect(transition('running', 'cancel', { attempts: 99, maxAttempts: 1 })).toBe('cancelled');
    expect(transition('pending', 'cancel', { attempts: 0, maxAttempts: 1 })).toBe('cancelled');
    expect(transition('retrying', 'cancel', { attempts: NaN, maxAttempts: NaN })).toBe('cancelled');
  });
  it('the non-finite guard names the counters in its message', () => {
    try {
      transition('running', 'attempt:error', { attempts: NaN, maxAttempts: 3 });
      expect.unreachable('must throw');
    } catch (e) {
      expect((e as Error).message).toBe(
        "invalid session transition: event 'attempt:error' in state 'running' " +
          '(non-finite attempt counters: attempts=NaN maxAttempts=3)',
      );
    }
  });
  it('errors without detail carry no trailing parenthetical', () => {
    try {
      transition('done', 'claim', CTX);
      expect.unreachable('must throw');
    } catch (e) {
      expect((e as Error).message).toBe("invalid session transition: event 'claim' in state 'done'");
    }
  });
});

describe('backoffDelayMs', () => {
  const policy: RetryPolicy = { maxAttempts: 5, baseDelayMs: 100, factor: 2, maxDelayMs: 1_000 };

  it('is baseDelayMs after the first failed attempt', () => {
    expect(backoffDelayMs(1, policy)).toBe(100);
  });
  it('grows by exactly factor per failed attempt', () => {
    expect(backoffDelayMs(2, policy)).toBe(200);
    expect(backoffDelayMs(3, policy)).toBe(400);
    expect(backoffDelayMs(4, policy)).toBe(800);
  });
  it('caps at maxDelayMs, exactly at the crossing point', () => {
    expect(backoffDelayMs(5, policy)).toBe(1_000); // raw 1600 -> cap
    expect(backoffDelayMs(50, policy)).toBe(1_000);
  });
  it('a non-finite blowup of the COMPUTED value lands on the cap, never Infinity/NaN', () => {
    const explosive: RetryPolicy = { maxAttempts: 9, baseDelayMs: 1, factor: Number.MAX_VALUE, maxDelayMs: 7 };
    expect(backoffDelayMs(3, explosive)).toBe(7);
    // 0 * Infinity overflow = NaN raw from valid inputs — still the cap.
    const zeroTimesInf: RetryPolicy = { maxAttempts: 9, baseDelayMs: 0, factor: Number.MAX_VALUE, maxDelayMs: 7 };
    expect(backoffDelayMs(3, zeroTimesInf)).toBe(7);
  });
  it('a zero base delay is a legal immediate retry (returns 0, not the cap)', () => {
    const zero: RetryPolicy = { maxAttempts: 3, baseDelayMs: 0, factor: 2, maxDelayMs: 50 };
    expect(backoffDelayMs(1, zero)).toBe(0);
    expect(backoffDelayMs(4, zero)).toBe(0);
  });
  it('rejects attempt < 1 and non-finite attempt', () => {
    expect(() => backoffDelayMs(0, policy)).toThrowError(RangeError);
    expect(() => backoffDelayMs(-1, policy)).toThrowError(RangeError);
    expect(() => backoffDelayMs(NaN, policy)).toThrowError(RangeError);
    expect(() => backoffDelayMs(Infinity, policy)).toThrowError(RangeError);
    expect(() => backoffDelayMs(0, policy)).toThrowError(/attempt must be a finite number >= 1/);
  });
  // A1 (audit 2026-07-18): a poisoned policy previously flowed straight
  // through — Math.min(raw, NaN/undefined) = NaN, and the fallback returned
  // the poisoned cap verbatim -> nextRunAt NaN -> permanent 'retrying' wedge.
  it('throws RangeError on a non-finite maxDelayMs instead of returning it verbatim (A1)', () => {
    const nanCap: RetryPolicy = { maxAttempts: 3, baseDelayMs: 100, factor: 2, maxDelayMs: NaN };
    expect(() => backoffDelayMs(1, nanCap)).toThrowError(RangeError);
    const undefCap = { maxAttempts: 3, baseDelayMs: 100, factor: 2, maxDelayMs: undefined } as unknown as RetryPolicy;
    expect(() => backoffDelayMs(1, undefCap)).toThrowError(RangeError);
    const infCap: RetryPolicy = { maxAttempts: 3, baseDelayMs: 100, factor: 2, maxDelayMs: Infinity };
    expect(() => backoffDelayMs(1, infCap)).toThrowError(RangeError);
  });
  it('throws RangeError on non-finite baseDelayMs / factor (A1)', () => {
    expect(() => backoffDelayMs(2, { maxAttempts: 3, baseDelayMs: NaN, factor: 2, maxDelayMs: 7 })).toThrowError(
      RangeError,
    );
    expect(() => backoffDelayMs(2, { maxAttempts: 3, baseDelayMs: 1, factor: NaN, maxDelayMs: 7 })).toThrowError(
      RangeError,
    );
    expect(() =>
      backoffDelayMs(2, { maxAttempts: 3, baseDelayMs: Infinity, factor: 2, maxDelayMs: 7 }),
    ).toThrowError(RangeError);
  });
  it('throws RangeError on negative policy numbers (A1)', () => {
    expect(() => backoffDelayMs(1, { maxAttempts: 3, baseDelayMs: -100, factor: 2, maxDelayMs: 50 })).toThrowError(
      RangeError,
    );
    expect(() => backoffDelayMs(1, { maxAttempts: 3, baseDelayMs: 100, factor: -2, maxDelayMs: 50 })).toThrowError(
      RangeError,
    );
    expect(() => backoffDelayMs(1, { maxAttempts: 3, baseDelayMs: 100, factor: 2, maxDelayMs: -1 })).toThrowError(
      RangeError,
    );
  });
  it('names the offending policy field in the error message (A1)', () => {
    expect(() => backoffDelayMs(1, { maxAttempts: 3, baseDelayMs: 100, factor: 2, maxDelayMs: NaN })).toThrow(
      /policy\.maxDelayMs must be a finite number >= 0, got NaN/,
    );
  });
  it('defaults to DEFAULT_RETRY_POLICY', () => {
    expect(backoffDelayMs(1)).toBe(DEFAULT_RETRY_POLICY.baseDelayMs);
    expect(backoffDelayMs(2)).toBe(DEFAULT_RETRY_POLICY.baseDelayMs * DEFAULT_RETRY_POLICY.factor);
  });
  it('pins the default policy values', () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({
      maxAttempts: 3,
      baseDelayMs: 1_000,
      factor: 2,
      maxDelayMs: 60_000,
    });
  });
});
