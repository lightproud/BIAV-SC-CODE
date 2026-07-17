/**
 * R4 ledger primitive (SCS-REQ-REPOS-01 §3 R4): pure dedup-ledger logic.
 *
 * The ledger records already-reported events (key + timestamp + summary),
 * answers "was this reported?", evicts by capacity and by age, round-trips
 * through serialize/deserialize (the HOST picks the storage medium), and
 * adapts onto the R1 structured-prelude and R3 retained-region shapes in one
 * line. No clock lives inside: every time-dependent operation accepts an
 * explicit `at`/`now` and only falls back to Date.now() as a reading, never a
 * schedule.
 */

import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../src/errors.js';
import { ReportLedger } from '../src/loop-support/ledger.js';

describe('ReportLedger — record/has', () => {
  it('records a new key and reports it as seen', () => {
    const ledger = new ReportLedger();
    expect(ledger.has('incident-42')).toBe(false);
    expect(ledger.record('incident-42', { at: 1000 })).toBe(true);
    expect(ledger.has('incident-42')).toBe(true);
    expect(ledger.size).toBe(1);
  });

  it('returns false on a duplicate key and keeps the FIRST record', () => {
    const ledger = new ReportLedger();
    ledger.record('a', { at: 1000, summary: 'first' });
    expect(ledger.record('a', { at: 2000, summary: 'second' })).toBe(false);
    expect(ledger.size).toBe(1);
    expect(ledger.entries()[0]).toEqual({ key: 'a', at: 1000, summary: 'first' });
  });

  it('rejects an empty key', () => {
    const ledger = new ReportLedger();
    expect(() => ledger.record('', { at: 1 })).toThrow(ConfigurationError);
    expect(() => ledger.record('', { at: 1 })).toThrow(/non-empty/);
  });

  it('entries() orders by timestamp then key (deterministic tie-break)', () => {
    const ledger = new ReportLedger();
    ledger.record('zeta', { at: 5 });
    ledger.record('alpha', { at: 5 });
    ledger.record('later', { at: 9 });
    expect(ledger.entries().map((e) => e.key)).toEqual(['alpha', 'zeta', 'later']);
    // Reverse insertion order exercises the other comparator branch.
    const rev = new ReportLedger();
    rev.record('alpha', { at: 5 });
    rev.record('zeta', { at: 5 });
    rev.record('mid', { at: 5 });
    expect(rev.entries().map((e) => e.key)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('defaults the timestamp to the current time when `at` is omitted', () => {
    const before = Date.now();
    const ledger = new ReportLedger();
    ledger.record('k');
    const at = ledger.entries()[0]?.at ?? 0;
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});

describe('ReportLedger — eviction', () => {
  it('evicts the OLDEST entries beyond maxEntries', () => {
    const ledger = new ReportLedger({ maxEntries: 2 });
    ledger.record('old', { at: 1 });
    ledger.record('mid', { at: 2 });
    ledger.record('new', { at: 3 });
    expect(ledger.size).toBe(2);
    expect(ledger.has('old')).toBe(false);
    expect(ledger.has('mid')).toBe(true);
    expect(ledger.has('new')).toBe(true);
  });

  it('evicts by timestamp, NOT by insertion order', () => {
    const ledger = new ReportLedger({ maxEntries: 2 });
    ledger.record('new', { at: 3 });
    ledger.record('old', { at: 1 });
    ledger.record('mid', { at: 2 });
    expect(ledger.has('old')).toBe(false);
    expect(ledger.has('new')).toBe(true);
    expect(ledger.has('mid')).toBe(true);
  });

  it('prune(now) drops entries older than maxAgeMs and returns the count', () => {
    const ledger = new ReportLedger({ maxAgeMs: 100 });
    ledger.record('stale', { at: 1000 });
    ledger.record('fresh', { at: 1050 }); // both inside the window at insert time
    expect(ledger.prune(1140)).toBe(1); // cutoff 1040: stale out, fresh in
    expect(ledger.has('stale')).toBe(false);
    expect(ledger.has('fresh')).toBe(true);
  });

  it('prune is a no-op without maxAgeMs', () => {
    const ledger = new ReportLedger();
    ledger.record('a', { at: 1 });
    expect(ledger.prune(999_999)).toBe(0);
    expect(ledger.has('a')).toBe(true);
  });

  it('record() itself applies age eviction relative to the new entry', () => {
    const ledger = new ReportLedger({ maxAgeMs: 50 });
    ledger.record('stale', { at: 100 });
    ledger.record('fresh', { at: 500 });
    expect(ledger.has('stale')).toBe(false);
  });

  it('rejects non-positive maxEntries / maxAgeMs', () => {
    expect(() => new ReportLedger({ maxEntries: 0 })).toThrow(ConfigurationError);
    expect(() => new ReportLedger({ maxEntries: 0 })).toThrow(/maxEntries/);
    expect(() => new ReportLedger({ maxAgeMs: -1 })).toThrow(ConfigurationError);
    expect(() => new ReportLedger({ maxAgeMs: 0 })).toThrow(/maxAgeMs/);
  });

  it('an entry exactly AT the age cutoff survives prune (strict <)', () => {
    const ledger = new ReportLedger({ maxAgeMs: 100 });
    ledger.record('edge', { at: 1040 });
    expect(ledger.prune(1140)).toBe(0); // cutoff 1040: strict less-than keeps it
    expect(ledger.has('edge')).toBe(true);
  });

  it('capacity eviction tie-breaks equal timestamps by key (smaller evicted)', () => {
    const ledger = new ReportLedger({ maxEntries: 1 });
    ledger.record('bbb', { at: 5 });
    ledger.record('aaa', { at: 5 });
    expect(ledger.has('aaa')).toBe(false);
    expect(ledger.has('bbb')).toBe(true);
    // Same tie, reverse insertion order: strictly-older wins over iteration order.
    const rev = new ReportLedger({ maxEntries: 1 });
    rev.record('aaa', { at: 5 });
    rev.record('bbb', { at: 5 });
    expect(rev.has('aaa')).toBe(false);
    expect(rev.has('bbb')).toBe(true);
  });
});

describe('ReportLedger — serialize/deserialize', () => {
  it('round-trips entries and config', () => {
    const ledger = new ReportLedger({ maxEntries: 10, maxAgeMs: 5000 });
    ledger.record('a', { at: 1, summary: 'sa' });
    ledger.record('b', { at: 2 });
    const revived = ReportLedger.deserialize(ledger.serialize());
    expect(revived.entries()).toStrictEqual(ledger.entries());
    expect(revived.has('a')).toBe(true);
    // Config survives: capacity still enforced after revival.
    const capped = new ReportLedger({ maxEntries: 1 });
    capped.record('x', { at: 1 });
    const revivedCapped = ReportLedger.deserialize(capped.serialize());
    revivedCapped.record('y', { at: 2 });
    expect(revivedCapped.size).toBe(1);
    expect(revivedCapped.has('y')).toBe(true);
    // maxAgeMs survives revival too: age eviction still enforced.
    const aged = new ReportLedger({ maxAgeMs: 100 });
    aged.record('a', { at: 1000 });
    const revivedAged = ReportLedger.deserialize(aged.serialize());
    revivedAged.record('b', { at: 5000 });
    expect(revivedAged.has('a')).toBe(false);
  });

  it('rejects malformed payloads with ConfigurationError', () => {
    expect(() => ReportLedger.deserialize('not json')).toThrow(ConfigurationError);
    // Distinct diagnostics: parse failure vs shape failure vs entry failure.
    expect(() => ReportLedger.deserialize('not json')).toThrow(/not valid JSON/);
    expect(() => ReportLedger.deserialize('null')).toThrow(/unrecognized shape/);
    expect(() => ReportLedger.deserialize('"str"')).toThrow(/unrecognized shape/);
    expect(() => ReportLedger.deserialize('{"v":99}')).toThrow(/unrecognized shape/);
    expect(() => ReportLedger.deserialize('{"v":1}')).toThrow(/unrecognized shape/);
    expect(() => ReportLedger.deserialize('{"v":1,"entries":"nope"}')).toThrow(
      /unrecognized shape/,
    );
    for (const badEntry of [
      'null',
      '"s"',
      '{"key":1,"at":2}',
      '{"key":"","at":2}',
      '{"key":"k","at":"x"}',
      '{"key":"k"}',
      '{"key":"k","at":2,"summary":5}',
    ]) {
      expect(() =>
        ReportLedger.deserialize(`{"v":1,"entries":[${badEntry}]}`),
      ).toThrow(/malformed entry/);
    }
  });
});

describe('ReportLedger — R1/R3 adapters', () => {
  it('toPrelude() renders a structured prelude block listing every entry', () => {
    const ledger = new ReportLedger();
    ledger.record('disk-full', { at: Date.UTC(2026, 6, 17), summary: 'host-3 disk' });
    ledger.record('oom', { at: Date.UTC(2026, 6, 16) });
    const prelude = ledger.toPrelude();
    expect(prelude.title).toBe('Previously reported events');
    // Ordered oldest-first, deterministic; keys and summaries present.
    const lines = prelude.content.split('\n');
    expect(lines[0]).toContain('do not re-report');
    expect(prelude.content.indexOf('oom')).toBeLessThan(
      prelude.content.indexOf('disk-full'),
    );
    expect(prelude.content).toContain('host-3 disk');
    expect(prelude.content).toContain('2026-07-17');
  });

  it('toPrelude() on an empty ledger says so instead of listing nothing', () => {
    expect(new ReportLedger().toPrelude().content).toBe(
      'Events reported so far (do not re-report): none.',
    );
  });

  it('digest lines are byte-exact (header + entry with/without summary)', () => {
    const ledger = new ReportLedger();
    ledger.record('plain', { at: 0 });
    ledger.record('rich', { at: 1000, summary: 'sum' });
    expect(ledger.toPrelude().content).toBe(
      [
        'Events reported so far (do not re-report):',
        '- plain (1970-01-01T00:00:00.000Z)',
        '- rich (1970-01-01T00:00:01.000Z) — sum',
      ].join('\n'),
    );
  });

  it('toRetainedRegion() wraps the same digest in the R3 region shape', () => {
    const ledger = new ReportLedger();
    ledger.record('k1', { at: 5 });
    const region = ledger.toRetainedRegion();
    expect(region.id).toBe('reported-events-ledger');
    expect(region.content).toContain('k1');
    const custom = ledger.toRetainedRegion({ id: 'my-ledger', title: 'T' });
    expect(custom.id).toBe('my-ledger');
    expect(custom.title).toBe('T');
  });
});
