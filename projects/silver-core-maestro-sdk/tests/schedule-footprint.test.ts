/**
 * Fire-point footprint parsing (design round 3): the ONE parser shared by
 * Scheduler recovery and the RoutineManager reverse-lookup. Every rule here
 * was originally paid for by an audit round on the in-#recover copy
 * (r2 strict-numeric, r5 fractional, r4 Date-range bound), so each is
 * pinned again at the shared seam.
 */
import { describe, it, expect } from 'vitest';
import {
  MANUAL_FIRE_SEGMENT,
  MAX_FIRE_POINT_MS,
  SCHEDULE_FIRE_SEGMENT,
  latestFirePoint,
  parseFirePoint,
} from '../src/schedule/footprint.js';

describe('parseFirePoint', () => {
  it('parses a well-formed sched id and returns its fire point', () => {
    expect(parseFirePoint('sched:job:1000', 'job')).toBe(1000);
    expect(parseFirePoint('sched:job:1000', 'job', SCHEDULE_FIRE_SEGMENT)).toBe(1000);
  });

  it('parses the manual segment only when asked for it', () => {
    expect(parseFirePoint('manual:job:2500', 'job', MANUAL_FIRE_SEGMENT)).toBe(2500);
    expect(parseFirePoint('manual:job:2500', 'job')).toBeNull();
    expect(parseFirePoint('sched:job:2500', 'job', MANUAL_FIRE_SEGMENT)).toBeNull();
  });

  it('accepts a fractional fire point (r5: validateSpec allows fractional every)', () => {
    expect(parseFirePoint('sched:job:1000.5', 'job')).toBe(1000.5);
  });

  it('rejects empty / whitespace / non-numeric suffixes (r2: Number("") is 0)', () => {
    expect(parseFirePoint('sched:job:', 'job')).toBeNull();
    expect(parseFirePoint('sched:job:  ', 'job')).toBeNull();
    expect(parseFirePoint('sched:job:abc', 'job')).toBeNull();
    expect(parseFirePoint('sched:job:1e3', 'job')).toBeNull();
    expect(parseFirePoint('sched:job:-5', 'job')).toBeNull();
    expect(parseFirePoint('sched:job:1000:extra', 'job')).toBeNull();
  });

  it('rejects fire points beyond the JS Date range (r4: far-future poison row)', () => {
    expect(parseFirePoint(`sched:job:${MAX_FIRE_POINT_MS}`, 'job')).toBe(MAX_FIRE_POINT_MS);
    expect(parseFirePoint('sched:job:9999999999999999', 'job')).toBeNull();
  });

  it('does not cross spec-id prefixes (spec "a" never matches "ab" rows)', () => {
    expect(parseFirePoint('sched:ab:1000', 'a')).toBeNull();
    expect(parseFirePoint('sched:a:1000', 'ab')).toBeNull();
    expect(parseFirePoint('other:a:1000', 'a')).toBeNull();
    expect(parseFirePoint('a:1000', 'a')).toBeNull();
  });
});

describe('latestFirePoint', () => {
  const ids = [
    'sched:job:1000',
    'sched:job:3000',
    'sched:job:2000',
    'sched:job:bad',
    'sched:other:9000',
    'manual:job:5000',
    'patrol:steam:2026-07-18',
  ];

  it('returns the newest sched fire point by default (manual ids invisible)', () => {
    expect(latestFirePoint(ids, 'job')).toBe(3000);
  });

  it('scans extra segments when asked (RoutineManager display truth)', () => {
    expect(
      latestFirePoint(ids, 'job', { segments: [SCHEDULE_FIRE_SEGMENT, MANUAL_FIRE_SEGMENT] }),
    ).toBe(5000);
  });

  it('returns null when the spec has no footprint at all', () => {
    expect(latestFirePoint(ids, 'missing')).toBeNull();
    expect(latestFirePoint([], 'job')).toBeNull();
  });
});
