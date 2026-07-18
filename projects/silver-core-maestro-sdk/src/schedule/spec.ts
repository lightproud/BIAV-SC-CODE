/**
 * Schedule spec — pure core (SCS-REQ orchestrator-sdk §3 loop scaffold; §6.2
 * fixed-point firing). Pure math over epoch-ms numbers: no I/O, no clock —
 * the Scheduler component injects time and asks this module only "when".
 * Every branch here is behaviorally pinned by tests/schedule.test.ts
 * (mutation-testing target).
 */

/**
 * One recurring schedule. Exactly one of `every` / `dailyAt` must be set:
 * - every:   fire points are anchor + k*every (k >= 0), anchor = anchorAt ?? 0;
 * - dailyAt: fire points are every UTC day at hh:mm (anchorAt is ignored).
 */
export interface ScheduleSpec {
  id: string;
  /** Business intent stamped on every dispatched session. */
  intent: string;
  /** Opaque host payload, carried under payload.data of each fire session. */
  payload?: unknown;
  /** Interval in ms (finite, > 0). Mutually exclusive with dailyAt. */
  every?: number;
  /** Daily UTC fire point (hour 0-23, minute 0-59). Mutually exclusive with every. */
  dailyAt?: { hour: number; minute: number };
  /** Epoch-ms anchor for `every` fire points (default 0). */
  anchorAt?: number;
  /** Missed-fire compensation: dispatch only the newest due fire (default) or all. */
  catchUp?: 'latest' | 'all';
  /** Retry ceiling forwarded to each dispatched session. */
  maxAttempts?: number;
}

/** Thrown by validateSpec (and everything that validates through it). */
export class ScheduleSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleSpecError';
  }
}

/** Structural validation; throws ScheduleSpecError on the first violation. */
export function validateSpec(spec: ScheduleSpec): void {
  if (typeof spec.id !== 'string' || spec.id.length === 0) {
    throw new ScheduleSpecError('spec.id must be a non-empty string');
  }
  // ':' is the session-id segment separator (sched:{id}:{fireAt}); a colon in
  // the spec id breaks lastFired recovery parsing and collides distinct specs
  // onto one fire record (review finding 2026-07-18, same rule as workflow).
  if (spec.id.includes(':')) {
    throw new ScheduleSpecError(`spec.id must not contain ':' (got '${spec.id}')`);
  }
  if (typeof spec.intent !== 'string' || spec.intent.length === 0) {
    throw new ScheduleSpecError(`spec '${spec.id}': intent must be a non-empty string`);
  }
  if ((spec.every !== undefined) === (spec.dailyAt !== undefined)) {
    throw new ScheduleSpecError(`spec '${spec.id}': exactly one of every / dailyAt must be set`);
  }
  if (spec.every !== undefined && (!Number.isFinite(spec.every) || spec.every <= 0)) {
    throw new ScheduleSpecError(`spec '${spec.id}': every must be finite and > 0, got ${spec.every}`);
  }
  if (spec.dailyAt !== undefined) {
    const { hour, minute } = spec.dailyAt;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new ScheduleSpecError(`spec '${spec.id}': dailyAt.hour must be an integer 0-23, got ${hour}`);
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      throw new ScheduleSpecError(`spec '${spec.id}': dailyAt.minute must be an integer 0-59, got ${minute}`);
    }
  }
  if (spec.anchorAt !== undefined && !Number.isFinite(spec.anchorAt)) {
    throw new ScheduleSpecError(`spec '${spec.id}': anchorAt must be finite, got ${spec.anchorAt}`);
  }
  if (spec.catchUp !== undefined && spec.catchUp !== 'latest' && spec.catchUp !== 'all') {
    throw new ScheduleSpecError(`spec '${spec.id}': catchUp must be 'latest' or 'all'`);
  }
  if (spec.maxAttempts !== undefined && (!Number.isInteger(spec.maxAttempts) || spec.maxAttempts < 1)) {
    throw new ScheduleSpecError(`spec '${spec.id}': maxAttempts must be an integer >= 1, got ${spec.maxAttempts}`);
  }
}

/** Smallest fire point STRICTLY greater than `after` (epoch ms). */
export function nextFireAt(spec: ScheduleSpec, after: number): number {
  validateSpec(spec);
  if (!Number.isFinite(after)) {
    throw new RangeError(`nextFireAt: after must be finite, got ${after}`);
  }
  if (spec.dailyAt !== undefined) {
    const { hour, minute } = spec.dailyAt;
    const d = new Date(after);
    const sameDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute);
    // Date.UTC normalizes day overflow, so month/year rollover is exact.
    const fire =
      sameDay > after
        ? sameDay
        : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, hour, minute);
    // Beyond the JS Date range (|after| > 8.64e15) the calendar math above is
    // NaN; NaN would silently poison every downstream comparison, so refuse.
    if (!Number.isFinite(fire)) {
      throw new RangeError(`nextFireAt: fire time is outside the JS Date range for after=${after}`);
    }
    return fire;
  }
  // validateSpec pinned exactly-one-of, so reaching here means `every` is set.
  const every = spec.every as number;
  const anchor = spec.anchorAt ?? 0;
  if (after < anchor) return anchor;
  let steps = Math.floor((after - anchor) / every) + 1;
  // Division can round UP in float (exact 2.999... -> 3.0), overstepping the
  // true smallest lattice point; step back while the previous point is still
  // strictly greater than `after` (audit r2 — bounded: at most a couple).
  while (steps > 0 && anchor + (steps - 1) * every > after) {
    steps -= 1;
  }
  let candidate = anchor + steps * every;
  // Fractional `every` float guard: the division and the multiplication round
  // independently, so the candidate can land EXACTLY on `after` (e.g. every
  // 0.1, anchorAt 1, after 1.2 -> floor(0.19999.../0.1)=1 -> 1 + 2*0.1 ===
  // 1.2). Returning t == after violates the strictly-greater contract and
  // stalls firesBetween / the scheduler's lastFired forever. Advance whole
  // steps until strictly greater; each step adds ~every, so one or two
  // iterations suffice — unless `every` is below the float resolution at
  // `after`'s magnitude, in which case no fire point is representable and we
  // must refuse rather than spin.
  // Step indices beyond 2^53 are not exactly representable: steps + extra
  // silently equals steps and the advance loop cannot make progress for a
  // reason UNRELATED to `every`'s resolution — refuse precisely (audit r2).
  if (steps >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      `nextFireAt: spec '${spec.id}': fire step index exceeds float precision (steps=${steps})`,
    );
  }
  // Bounded advance for the rounding-flat case (candidate === after, C1):
  // the saturation guard above proves every >= ulp/2 at this magnitude, so
  // each exact step adds at least half an ulp and the float product must
  // strictly pass `after` within a couple of iterations — no unbounded spin
  // is possible and no separate flatness detector is needed (a sub-ulp
  // `every` ALWAYS saturates the step index first, for every magnitude:
  // x/ulp(x) is in [2^52, 2^53), so x/every >= 2*x/ulp(x) >= 2^53).
  let extra = 0;
  while (candidate <= after) {
    extra += 1;
    candidate = anchor + (steps + extra) * every;
  }
  if (!Number.isFinite(candidate)) {
    throw new RangeError(`nextFireAt: fire time overflowed for after=${after}`);
  }
  return candidate;
}

/**
 * All fire points t with afterExclusive < t <= untilInclusive, ascending,
 * capped at `cap` (default 100). When capped, the LATEST cap fires are kept:
 * old missed fires matter less than recent ones.
 */
export function firesBetween(
  spec: ScheduleSpec,
  afterExclusive: number,
  untilInclusive: number,
  cap: number = 100,
): number[] {
  if (!Number.isFinite(afterExclusive)) {
    throw new RangeError(`firesBetween: afterExclusive must be finite, got ${afterExclusive}`);
  }
  if (!Number.isFinite(untilInclusive)) {
    throw new RangeError(`firesBetween: untilInclusive must be finite, got ${untilInclusive}`);
  }
  if (!Number.isInteger(cap) || cap < 1) {
    throw new RangeError(`firesBetween: cap must be an integer >= 1, got ${cap}`);
  }
  const fires: number[] = [];
  // Fast-forward (audit r2): only the LATEST `cap` fires are kept, so a huge
  // backlog (months of downtime at a 1s cadence) must not be enumerated
  // point by point. Jump the start of the walk to at most cap+1 periods
  // before the window end; the loop then visits O(cap) points.
  let walkFrom = afterExclusive;
  const periodMs = spec.every !== undefined ? spec.every : 24 * 60 * 60 * 1_000;
  const jumpTo = untilInclusive - (cap + 1) * periodMs;
  if (jumpTo > walkFrom) walkFrom = jumpTo;
  // Loop safety rests on nextFireAt's own contract: it returns STRICTLY
  // greater than its input or throws (flatness detection) — pinned by its
  // tests — so no separate non-advance guard is needed (an in-loop guard
  // would be unreachable dead code).
  let t = nextFireAt(spec, walkFrom);
  while (t <= untilInclusive) {
    fires.push(t);
    // Ring behavior keeps memory bounded at cap while retaining the latest.
    if (fires.length > cap) fires.shift();
    t = nextFireAt(spec, t);
  }
  return fires;
}
