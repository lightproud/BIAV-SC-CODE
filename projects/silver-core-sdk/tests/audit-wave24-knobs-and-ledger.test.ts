/**
 * Audit wave 24 — two knobs whose own file already states the rule they break.
 *
 *  1. buildCompactionConfig guards contextWindowTokens against NaN and names
 *     the sibling knobs that do the same — but the two RATIOS did not, and a
 *     NaN ratio kills auto-compaction for the whole session in silence.
 *  2. ReportLedger.record() type-checks the timestamp precisely because a bad
 *     one throws deep in a fold, and deserialize() type-checks key/summary —
 *     record() checked neither, so the same throw arrived mid-compaction.
 */

import { describe, expect, it } from 'vitest';

import {
  buildCompactionConfig,
  partitionForCompaction,
  shouldAutoCompact,
} from '../src/engine/compaction.js';
import { ReportLedger } from '../src/loop-support/ledger.js';
import { ConfigurationError } from '../src/errors.js';

// A history large enough that compaction genuinely fires with default knobs;
// without that baseline a "does not fire" assertion proves nothing.
const BIG = Array.from({ length: 4000 }, (_, i) => ({
  role: (i % 2 ? 'assistant' : 'user') as 'assistant' | 'user',
  content: 'x'.repeat(2000),
}));
const WINDOW = 200_000;
const RESERVED = 8_192;

const fires = (opt: Parameters<typeof buildCompactionConfig>[0]): boolean =>
  shouldAutoCompact(BIG, 0, WINDOW, RESERVED, buildCompactionConfig(opt), undefined) !== null;

describe('compaction ratio knobs survive a misread value', () => {
  it('baseline: the default configuration does fire on this history', () => {
    expect(fires(undefined)).toBe(true);
    expect(fires({})).toBe(true);
  });

  it('a NaN autoThresholdRatio does not silently disable auto-compaction', () => {
    // Number(process.env.UNSET) is NaN — the ordinary shape of a misread knob,
    // and the exact hazard this file guards contextWindowTokens against. `??`
    // does not catch NaN: triggerAt became NaN, `preTokens >= NaN` was false,
    // and nothing ever folded again for the rest of the session, unwarned.
    expect(fires({ autoThresholdRatio: Number(undefined) })).toBe(true);
    expect(buildCompactionConfig({ autoThresholdRatio: Number(undefined) }).autoThresholdRatio)
      .toBe(0.85);
  });

  it('rejects the two out-of-range shapes for the reason each breaks', () => {
    // Above 1 the trigger can never be reached (silently dead); at or below 0
    // it is reached always (fold churn). Both fall back to the default.
    for (const bad of [1.5, 0, -0.5, Infinity]) {
      expect(buildCompactionConfig({ autoThresholdRatio: bad }).autoThresholdRatio).toBe(0.85);
      expect(buildCompactionConfig({ keepRatio: bad }).keepRatio).toBe(0.3);
    }
  });

  it('keeps every legitimate value untouched', () => {
    expect(buildCompactionConfig({ autoThresholdRatio: 0.5 }).autoThresholdRatio).toBe(0.5);
    expect(buildCompactionConfig({ autoThresholdRatio: 1 }).autoThresholdRatio).toBe(1);
    expect(buildCompactionConfig({ keepRatio: 0.9 }).keepRatio).toBe(0.9);
    expect(buildCompactionConfig({ minRecentTurns: 0 }).minRecentTurns).toBe(0);
    expect(buildCompactionConfig({ minRecentTurns: 7 }).minRecentTurns).toBe(7);
  });

  it('a NaN keepRatio / minRecentTurns falls back instead of poisoning the partition', () => {
    const cfg = buildCompactionConfig({
      keepRatio: Number(undefined),
      minRecentTurns: Number(undefined),
    });
    expect(cfg.keepRatio).toBe(0.3);
    expect(cfg.minRecentTurns).toBe(2);
    expect(partitionForCompaction(BIG, WINDOW - RESERVED, cfg, undefined)).not.toBeNull();
  });
});

describe('ReportLedger.record: fail at the write, not mid-compaction', () => {
  it('rejects a non-string summary the way deserialize already does', () => {
    const l = new ReportLedger();
    // Pre-fix this was accepted and returned true; the throw arrived later,
    // inside toRetainedRegion() — i.e. during a fold — as a bare TypeError
    // ("text.replace is not a function"), not a ConfigurationError.
    expect(() => l.record('k', { at: 1, summary: 123 as unknown as string })).toThrow(
      ConfigurationError,
    );
    expect(l.size).toBe(0);
  });

  it('rejects a non-string key, which the empty-check could not catch', () => {
    // `key.length === 0` on a number is `undefined === 0` — false. It sailed
    // through and died in digest() for the same reason.
    const l = new ReportLedger();
    expect(() => l.record(123 as unknown as string)).toThrow(ConfigurationError);
    expect(() => l.record('')).toThrow(ConfigurationError);
  });

  it('a well-formed entry still records and renders', () => {
    const l = new ReportLedger();
    expect(l.record('evt-1', { at: 1, summary: 'ok' })).toBe(true);
    expect(l.toRetainedRegion().content).toContain('evt-1');
    expect(() => l.toRetainedRegion()).not.toThrow();
  });
});
