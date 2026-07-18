/**
 * Pure schedule core (src/schedule/spec.ts) — exhaustive behavioral pinning.
 * This module is a mutation-testing target: every branch (validation rejects,
 * strict-greater arithmetic, anchor handling, UTC rollover, range boundaries,
 * cap-keeps-latest) is pinned by an exact-value assertion here.
 */
import { describe, it, expect } from 'vitest';
import {
  ScheduleSpecError,
  validateSpec,
  nextFireAt,
  firesBetween,
  type ScheduleSpec,
} from '../src/schedule/spec.js';

const everySpec = (over: Partial<ScheduleSpec> = {}): ScheduleSpec => ({
  id: 'job',
  intent: 'do-job',
  every: 10,
  ...over,
});
const dailySpec = (hour: number, minute: number, over: Partial<ScheduleSpec> = {}): ScheduleSpec => ({
  id: 'daily',
  intent: 'do-daily',
  dailyAt: { hour, minute },
  ...over,
});

describe('validateSpec', () => {
  it('accepts a minimal interval spec and a minimal daily spec', () => {
    expect(() => validateSpec(everySpec())).not.toThrow();
    expect(() => validateSpec(dailySpec(0, 0))).not.toThrow();
    expect(() => validateSpec(dailySpec(23, 59))).not.toThrow();
  });

  it('accepts all optional fields at valid values', () => {
    expect(() =>
      validateSpec(everySpec({ anchorAt: 5, catchUp: 'latest', maxAttempts: 1, payload: { a: 1 } })),
    ).not.toThrow();
    expect(() => validateSpec(everySpec({ catchUp: 'all', maxAttempts: 7 }))).not.toThrow();
    expect(() => validateSpec(everySpec({ anchorAt: -1000 }))).not.toThrow();
  });

  it('rejects empty/non-string id and intent', () => {
    expect(() => validateSpec(everySpec({ id: '' }))).toThrow(ScheduleSpecError);
    expect(() => validateSpec(everySpec({ id: '' }))).toThrow(/spec\.id/);
    expect(() => validateSpec(everySpec({ intent: '' }))).toThrow(ScheduleSpecError);
    expect(() => validateSpec(everySpec({ intent: '' }))).toThrow(/intent/);
    expect(() => validateSpec({ ...everySpec(), id: 42 as unknown as string })).toThrow(/spec\.id/);
    expect(() => validateSpec({ ...everySpec(), intent: 42 as unknown as string })).toThrow(/intent/);
  });

  it('rejects both every and dailyAt set', () => {
    expect(() => validateSpec(everySpec({ dailyAt: { hour: 1, minute: 0 } }))).toThrow(
      /exactly one of every \/ dailyAt/,
    );
  });

  it('rejects neither every nor dailyAt set', () => {
    expect(() => validateSpec({ id: 'x', intent: 'y' })).toThrow(ScheduleSpecError);
    expect(() => validateSpec({ id: 'x', intent: 'y' })).toThrow(/exactly one/);
  });

  it('rejects every <= 0 and non-finite every', () => {
    for (const every of [0, -1, -0.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      expect(() => validateSpec(everySpec({ every }))).toThrow(/every must be finite and > 0/);
    }
    expect(() => validateSpec(everySpec({ every: 0.5 }))).not.toThrow();
  });

  it('rejects out-of-range / non-integer dailyAt.hour', () => {
    for (const hour of [-1, 24, 1.5, Number.NaN]) {
      expect(() => validateSpec(dailySpec(hour, 0))).toThrow(/hour must be an integer 0-23/);
    }
  });

  it('rejects out-of-range / non-integer dailyAt.minute', () => {
    for (const minute of [-1, 60, 0.5, Number.NaN]) {
      expect(() => validateSpec(dailySpec(0, minute))).toThrow(/minute must be an integer 0-59/);
    }
  });

  it('rejects non-finite anchorAt', () => {
    for (const anchorAt of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => validateSpec(everySpec({ anchorAt }))).toThrow(/anchorAt must be finite/);
    }
  });

  it('rejects unknown catchUp values', () => {
    expect(() => validateSpec(everySpec({ catchUp: 'newest' as unknown as 'latest' }))).toThrow(
      /catchUp must be 'latest' or 'all'/,
    );
  });

  it('rejects maxAttempts < 1 and non-integers', () => {
    for (const maxAttempts of [0, -1, 1.5, Number.NaN]) {
      expect(() => validateSpec(everySpec({ maxAttempts }))).toThrow(/maxAttempts must be an integer >= 1/);
    }
  });

  it('ScheduleSpecError is an Error subclass with its own name', () => {
    const err = new ScheduleSpecError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ScheduleSpecError');
    expect(err.message).toBe('boom');
  });
});

describe('nextFireAt: every (interval) arithmetic', () => {
  it('default anchor 0: exact next multiples', () => {
    expect(nextFireAt(everySpec(), 0)).toBe(10);
    expect(nextFireAt(everySpec(), 3)).toBe(10);
    expect(nextFireAt(everySpec(), 9)).toBe(10);
    expect(nextFireAt(everySpec(), 11)).toBe(20);
    expect(nextFireAt(everySpec(), 25)).toBe(30);
  });

  it('boundary: t == after is EXCLUDED (strictly greater)', () => {
    expect(nextFireAt(everySpec(), 10)).toBe(20);
    expect(nextFireAt(everySpec(), 30)).toBe(40);
    expect(nextFireAt(everySpec({ anchorAt: 7 }), 7)).toBe(17);
  });

  it('after before the anchor returns the anchor itself (k = 0)', () => {
    expect(nextFireAt(everySpec({ anchorAt: 7 }), 0)).toBe(7);
    expect(nextFireAt(everySpec({ anchorAt: 7 }), 6)).toBe(7);
    expect(nextFireAt(everySpec(), -25)).toBe(0);
    expect(nextFireAt(everySpec(), -1)).toBe(0);
  });

  it('anchored arithmetic: anchor + k*every strictly after', () => {
    expect(nextFireAt(everySpec({ anchorAt: 7 }), 8)).toBe(17);
    expect(nextFireAt(everySpec({ anchorAt: 7 }), 17)).toBe(27);
    expect(nextFireAt(everySpec({ anchorAt: 7 }), 100)).toBe(107);
  });

  it('large epoch-ms values stay exact', () => {
    const spec = everySpec({ every: 1_000 });
    expect(nextFireAt(spec, 1_000_000)).toBe(1_001_000);
    expect(nextFireAt(spec, 1_000_001)).toBe(1_001_000);
    expect(nextFireAt(spec, 1_000_999)).toBe(1_001_000);
  });

  it('throws RangeError on non-finite after', () => {
    for (const after of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => nextFireAt(everySpec(), after)).toThrow(RangeError);
      expect(() => nextFireAt(everySpec(), after)).toThrow(/after must be finite/);
    }
  });

  it('validates the spec before computing (invalid spec throws ScheduleSpecError)', () => {
    expect(() => nextFireAt({ id: 'x', intent: 'y' }, 0)).toThrow(ScheduleSpecError);
    expect(() => nextFireAt(everySpec({ every: -5 }), 0)).toThrow(ScheduleSpecError);
  });
});

describe('nextFireAt: dailyAt (UTC) arithmetic', () => {
  it('same-day fire when hh:mm is still ahead', () => {
    const after = Date.UTC(2026, 0, 15, 10, 0);
    expect(nextFireAt(dailySpec(12, 30), after)).toBe(Date.UTC(2026, 0, 15, 12, 30));
    // minute participates, not just the hour
    expect(nextFireAt(dailySpec(10, 1), after)).toBe(Date.UTC(2026, 0, 15, 10, 1));
  });

  it('exactly at hh:mm rolls to the NEXT day (strictly greater)', () => {
    const at = Date.UTC(2026, 0, 15, 12, 30);
    expect(nextFireAt(dailySpec(12, 30), at)).toBe(Date.UTC(2026, 0, 16, 12, 30));
  });

  it('past hh:mm rolls to the next day', () => {
    const after = Date.UTC(2026, 0, 15, 13, 0);
    expect(nextFireAt(dailySpec(12, 30), after)).toBe(Date.UTC(2026, 0, 16, 12, 30));
  });

  it('midnight spec fires at the next UTC midnight', () => {
    const after = Date.UTC(2026, 0, 15, 5, 0);
    expect(nextFireAt(dailySpec(0, 0), after)).toBe(Date.UTC(2026, 0, 16, 0, 0));
    // one millisecond past midnight already belongs to the next day
    expect(nextFireAt(dailySpec(0, 0), Date.UTC(2026, 0, 15, 0, 0) + 1)).toBe(Date.UTC(2026, 0, 16, 0, 0));
  });

  it('month boundary rollover (Jan 31 -> Feb 1; Feb 28 -> Mar 1 non-leap)', () => {
    expect(nextFireAt(dailySpec(1, 0), Date.UTC(2026, 0, 31, 23, 0))).toBe(Date.UTC(2026, 1, 1, 1, 0));
    expect(nextFireAt(dailySpec(0, 0), Date.UTC(2026, 1, 28, 12, 0))).toBe(Date.UTC(2026, 2, 1, 0, 0));
  });

  it('year boundary rollover (Dec 31 -> Jan 1)', () => {
    expect(nextFireAt(dailySpec(0, 0), Date.UTC(2026, 11, 31, 23, 59))).toBe(Date.UTC(2027, 0, 1, 0, 0));
  });
});

describe('firesBetween', () => {
  it('enumerates (afterExclusive, untilInclusive] ascending', () => {
    expect(firesBetween(everySpec(), 0, 30)).toEqual([10, 20, 30]);
    expect(firesBetween(everySpec(), 0, 29)).toEqual([10, 20]);
    expect(firesBetween(everySpec(), 10, 30)).toEqual([20, 30]); // lower bound exclusive
    expect(firesBetween(everySpec(), 9, 10)).toEqual([10]); // upper bound inclusive
  });

  it('empty when no fire lands in the window', () => {
    expect(firesBetween(everySpec(), 30, 30)).toEqual([]);
    expect(firesBetween(everySpec(), 30, 20)).toEqual([]);
    expect(firesBetween(everySpec(), 10, 19)).toEqual([]);
  });

  it('anchored fire points enumerate from the anchor', () => {
    expect(firesBetween(everySpec({ anchorAt: 5 }), 0, 30)).toEqual([5, 15, 25]);
    expect(firesBetween(everySpec({ anchorAt: 50 }), 0, 60)).toEqual([50, 60]);
  });

  it('dailyAt specs enumerate consecutive UTC days', () => {
    const from = Date.UTC(2026, 6, 1, 0, 0);
    const to = Date.UTC(2026, 6, 3, 23, 59);
    expect(firesBetween(dailySpec(6, 0), from, to)).toEqual([
      Date.UTC(2026, 6, 1, 6, 0),
      Date.UTC(2026, 6, 2, 6, 0),
      Date.UTC(2026, 6, 3, 6, 0),
    ]);
  });

  it('cap keeps the LATEST fires, ascending', () => {
    expect(firesBetween(everySpec({ every: 1 }), 0, 10, 3)).toEqual([8, 9, 10]);
    // exactly cap fires: nothing dropped
    expect(firesBetween(everySpec(), 0, 30, 3)).toEqual([10, 20, 30]);
    // one over cap: oldest dropped
    expect(firesBetween(everySpec(), 0, 40, 3)).toEqual([20, 30, 40]);
  });

  it('default cap is 100, keeping the latest 100', () => {
    const fires = firesBetween(everySpec({ every: 1 }), 0, 150);
    expect(fires).toHaveLength(100);
    expect(fires[0]).toBe(51);
    expect(fires[99]).toBe(150);
  });

  it('throws RangeError on non-finite bounds', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => firesBetween(everySpec(), bad, 10)).toThrow(/afterExclusive must be finite/);
      expect(() => firesBetween(everySpec(), 0, bad)).toThrow(/untilInclusive must be finite/);
    }
  });

  it('throws RangeError on cap < 1 or non-integer cap', () => {
    for (const cap of [0, -1, 1.5, Number.NaN]) {
      expect(() => firesBetween(everySpec(), 0, 30, cap)).toThrow(/cap must be an integer >= 1/);
    }
  });

  it('validates the spec (invalid spec throws ScheduleSpecError)', () => {
    expect(() => firesBetween({ id: 'x', intent: 'y' }, 0, 10)).toThrow(ScheduleSpecError);
  });
});

describe("id hygiene (review hardening 2026-07-18): ':' banned in spec.id", () => {
  it('rejects a colon in spec.id (session-key separator)', () => {
    expect(() =>
      validateSpec({ id: 'a:b', intent: 'x', every: 1_000 }),
    ).toThrowError(ScheduleSpecError);
    expect(() => validateSpec({ id: 'a:b', intent: 'x', every: 1_000 })).toThrow(/must not contain ':'/);
  });
});

describe('mutation kill round (2026-07-18)', () => {
  it('an empty id is rejected by ITS OWN guard, with an otherwise-valid spec', () => {
    expect(() => validateSpec({ id: '', intent: 'x', every: 1_000 })).toThrow(
      'spec.id must be a non-empty string',
    );
    expect(() =>
      validateSpec({ id: 42 as unknown as string, intent: 'x', every: 1_000 }),
    ).toThrow('spec.id must be a non-empty string');
  });
  it('cap = 1 is legal and keeps exactly the latest fire', () => {
    const spec = { id: 's', intent: 'x', every: 100, anchorAt: 0 };
    expect(firesBetween(spec, 0, 350, 1)).toEqual([300]);
  });
});
