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

describe('audit C1 (2026-07-18): fractional every float guard', () => {
  it('nextFireAt is strictly greater than after even when float rounding lands on it (every 0.1, anchor 1, after 1.2)', () => {
    // Old code: floor((1.2-1)/0.1) = floor(1.9999999999999996) = 1 -> steps 2
    // -> 1 + 2*0.1 === 1.2 exactly, returning t == after (contract violation).
    const spec = everySpec({ every: 0.1, anchorAt: 1 });
    const next = nextFireAt(spec, 1.2);
    expect(next).toBeGreaterThan(1.2);
    expect(next).toBeCloseTo(1.3, 9);
  });

  it('walking fractional fire points always makes strict progress (no stall)', () => {
    const spec = everySpec({ every: 0.1, anchorAt: 0 });
    // Old code stalls at t = 4.3 (iteration 43): nextFireAt(4.3) === 4.3.
    let t = 0;
    for (let i = 0; i < 200; i++) {
      const n = nextFireAt(spec, t);
      expect(n).toBeGreaterThan(t);
      t = n;
    }
  });

  it('firesBetween terminates, ascending and in range, over a window that stalled before', () => {
    // Old code: infinite loop at the 1.2 fire point (lastFired never advances).
    const spec = everySpec({ every: 0.1, anchorAt: 1 });
    const fires = firesBetween(spec, 1, 2);
    expect(fires.length).toBeGreaterThanOrEqual(9);
    expect(fires.length).toBeLessThanOrEqual(11);
    for (let i = 1; i < fires.length; i++) {
      expect(fires[i]!).toBeGreaterThan(fires[i - 1]!);
    }
    for (const f of fires) {
      expect(f).toBeGreaterThan(1);
      expect(f).toBeLessThanOrEqual(2);
    }
  });

  it('every below float resolution at huge t throws RangeError instead of spinning', () => {
    // ulp(1e15) = 0.125 > 0.001: no representable strictly-greater fire point.
    const spec = everySpec({ every: 0.001, anchorAt: 0 });
    expect(() => nextFireAt(spec, 1e15)).toThrow(RangeError);
    expect(() => nextFireAt(spec, 1e15)).toThrow(/exceeds float precision/);
  });
});

describe('audit C2 (2026-07-18): dailyAt beyond the JS Date range', () => {
  it('throws RangeError instead of returning NaN for |after| beyond 8.64e15', () => {
    // Old code: new Date(8.65e15) is invalid -> Date.UTC(NaN, ...) -> NaN out.
    expect(() => nextFireAt(dailySpec(12, 0), 8.65e15)).toThrow(RangeError);
    expect(() => nextFireAt(dailySpec(12, 0), 8.65e15)).toThrow(/JS Date range/);
    expect(() => nextFireAt(dailySpec(0, 0), -8.65e15)).toThrow(RangeError);
  });

  it('still computes finite fire points just inside the Date range', () => {
    const nearMax = 8.64e15 - 2 * 86_400_000;
    const fire = nextFireAt(dailySpec(0, 0), nearMax);
    expect(Number.isFinite(fire)).toBe(true);
    expect(fire).toBeGreaterThan(nearMax);
  });
});

describe('float-resolution refusal + overflow (integration kill round 2026-07-18)', () => {
  it('refuses when every is below float resolution at the target magnitude', () => {
    // At |t| = 2^53 the float ULP is 2; every = 0.5 can never advance the
    // candidate, so the flatness detector must refuse instead of spinning.
    const spec = { id: 's', intent: 'x', every: 0.5, anchorAt: 0 };
    expect(() => nextFireAt(spec, 2 ** 53)).toThrow(/exceeds float precision/);
  });
  it('refuses when the computed fire time overflows to Infinity', () => {
    const spec = { id: 's', intent: 'x', every: 1e308, anchorAt: 0 };
    expect(() => nextFireAt(spec, 1e308)).toThrow(/overflowed/);
  });
  it('normal fractional bumping still lands on the exact next lattice point', () => {
    // The C1 reproduction: candidate first computes EXACTLY equal to after.
    const spec = { id: 's', intent: 'x', every: 0.1, anchorAt: 1 };
    const next = nextFireAt(spec, 1.2);
    expect(next).toBeGreaterThan(1.2);
    expect(next).toBeCloseTo(1.3, 10);
  });
});

describe('r2 kill round: rounding-up division + step-index boundary + fast-forward purity', () => {
  it('steps DOWN when float division rounds up past the true smallest point (every=0.016)', () => {
    // after/every = exactly 36.0 in float while the exact value is just
    // below 36: floor+1 = 37 would skip the true smallest point 36*0.016.
    const spec = { id: 's', intent: 'x', every: 0.016, anchorAt: 0 };
    const next = nextFireAt(spec, 0.576);
    expect(next).toBe(36 * 0.016); // 0.5760000000000001, NOT 0.592
    expect(next).toBeGreaterThan(0.576);
  });
  it('refuses at the exact MAX_SAFE_INTEGER step-index boundary', () => {
    // steps = floor((2^53-2)/1)+1 = 2^53-1 = MAX_SAFE_INTEGER exactly.
    const spec = { id: 's', intent: 'x', every: 1, anchorAt: 0 };
    expect(() => nextFireAt(spec, 2 ** 53 - 2)).toThrow(/exceeds float precision/);
  });
  it('fast-forward never leaks fires at or before the window start', () => {
    // cap*period reaches far before afterExclusive: a jump that ignored the
    // window start would collect pre-window points into the ring.
    const spec = { id: 's', intent: 'x', every: 100, anchorAt: 0 };
    const fires = firesBetween(spec, 1_000, 1_500, 100);
    expect(fires).toEqual([1_100, 1_200, 1_300, 1_400, 1_500]);
  });
  it('fast-forward respects the dailyAt period too', () => {
    const day = 24 * 60 * 60 * 1_000;
    const spec = { id: 's', intent: 'x', dailyAt: { hour: 3, minute: 0 } };
    const until = 400 * day; // > cap+1 days of backlog
    const fires = firesBetween(spec, 0, until, 5);
    expect(fires).toHaveLength(5);
    for (const t of fires) expect(new Date(t).getUTCHours()).toBe(3);
    expect(fires[4]).toBeLessThanOrEqual(until);
    expect(fires[0]).toBeGreaterThan(until - 6 * day);
  });
});
