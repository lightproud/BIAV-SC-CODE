/**
 * Audit r4 (2026-07-17) - "misc" cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - Y6-3  [media.ts]            normalizeImageMediaType now strips RFC-6838
 *          parameters (";charset=..."), so a parameterized-but-decodable image
 *          is no longer downgraded to "unsupported".
 *  - U6-2  [structured-output]   minLength/maxLength count Unicode CODE POINTS,
 *          not UTF-16 code units, so an astral char (emoji) no longer
 *          double-counts into a false schema violation.
 *  - Rdt-2 [ledger.ts]           record()/deserialize() reject a finite-but-
 *          out-of-Date-range `at` (±8.64e15) up front, instead of throwing a
 *          RangeError deep inside digest()/toPrelude() (the latter mid-compaction).
 *  - R7c-1 [index.ts]            SessionMutationOptions (+ GetSessionMessagesOptions)
 *          is re-exported from the package barrel, so a consumer can name the
 *          options bag of the seven session-mutation functions (TS2305 before).
 */

import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../src/errors.js';
import { normalizeImageMediaType } from '../src/internal/media.js';
import { evaluateStructuredOutput } from '../src/internal/structured-output.js';
import { ReportLedger } from '../src/loop-support/ledger.js';
import type { JSONSchema } from '../src/types.js';
// Type-only import exercises the R7c-1 barrel re-export: if the export were
// missing this file would fail `tsc --noEmit` with TS2305.
import type { SessionMutationOptions, GetSessionMessagesOptions } from '../src/index.js';

// ---------------------------------------------------------------------------
// Y6-3: normalizeImageMediaType strips RFC-6838 parameters
// ---------------------------------------------------------------------------

describe('Y6-3 normalizeImageMediaType parameter stripping', () => {
  it('strips a trailing ";charset=..." parameter and matches the base type', () => {
    expect(normalizeImageMediaType('image/png; charset=binary')).toBe('image/png');
  });

  it('handles whitespace around the parameter separator', () => {
    expect(normalizeImageMediaType('image/jpeg ; foo=bar')).toBe('image/jpeg');
    expect(normalizeImageMediaType('IMAGE/WEBP;q=1')).toBe('image/webp');
  });

  it('still returns undefined for an unsupported base type carrying parameters', () => {
    expect(normalizeImageMediaType('image/bmp; charset=binary')).toBeUndefined();
  });

  it('leaves an unparameterized supported type untouched (no regression)', () => {
    expect(normalizeImageMediaType('image/gif')).toBe('image/gif');
    expect(normalizeImageMediaType('  Image/PNG  ')).toBe('image/png');
  });
});

// ---------------------------------------------------------------------------
// U6-2: minLength/maxLength count code points, not UTF-16 code units
// ---------------------------------------------------------------------------

describe('U6-2 structured-output string length in code points', () => {
  // A single astral char is 1 code point but 2 UTF-16 units. text passed to
  // evaluateStructuredOutput is the model's final reply; a top-level JSON
  // string is the quoted form.
  it('accepts a one-emoji string under maxLength:1 (was a false violation)', () => {
    const schema = { type: 'string', maxLength: 1 } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('"\u{1F600}"', schema).status).toBe('valid');
  });

  it('rejects a one-emoji string under minLength:2 (code-point count is 1)', () => {
    const schema = { type: 'string', minLength: 2 } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('"\u{1F600}"', schema).status).toBe('invalid');
  });

  it('accepts a two-emoji string under maxLength:2', () => {
    const schema = { type: 'string', maxLength: 2 } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('"\u{1F600}\u{1F601}"', schema).status).toBe('valid');
  });

  it('keeps ASCII length checks unchanged (no regression)', () => {
    const tooLong = { type: 'string', maxLength: 2 } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('"abc"', tooLong).status).toBe('invalid');
    const ok = { type: 'string', minLength: 3 } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('"abc"', ok).status).toBe('valid');
  });
});

// ---------------------------------------------------------------------------
// Rdt-2: ledger rejects finite-but-unrepresentable Date timestamps
// ---------------------------------------------------------------------------

describe('Rdt-2 ledger timestamp Date-range guard', () => {
  const MAX = 8_640_000_000_000_000;

  it('record() throws on a finite `at` beyond ±8.64e15 (would RangeError in digest)', () => {
    const ledger = new ReportLedger();
    expect(() => ledger.record('k', { at: 1e18 })).toThrow(ConfigurationError);
    expect(() => ledger.record('k', { at: -1e18 })).toThrow(ConfigurationError);
    // The pre-existing non-finite guard still holds.
    expect(() => ledger.record('k', { at: Number.NaN })).toThrow(ConfigurationError);
  });

  it('accepts the exact Date boundary and digests it without throwing', () => {
    const ledger = new ReportLedger();
    expect(ledger.record('edge', { at: MAX })).toBe(true);
    // Was the actual crash site: toISOString inside digest().
    expect(() => ledger.toPrelude()).not.toThrow();
    expect(() => ledger.record('over', { at: MAX + 1 })).toThrow(ConfigurationError);
  });

  it('deserialize() rejects a hand-crafted payload with an out-of-range `at`', () => {
    const payload = JSON.stringify({ v: 1, config: {}, entries: [{ key: 'k', at: 1e18 }] });
    expect(() => ReportLedger.deserialize(payload)).toThrow(ConfigurationError);
  });

  it('round-trips an in-range ledger unchanged (no regression)', () => {
    const ledger = new ReportLedger();
    ledger.record('a', { at: 1_700_000_000_000, summary: 's' });
    const revived = ReportLedger.deserialize(ledger.serialize());
    expect(revived.has('a')).toBe(true);
    expect(revived.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// R7c-1: SessionMutationOptions re-exported from the barrel
// ---------------------------------------------------------------------------

describe('R7c-1 SessionMutationOptions barrel re-export', () => {
  it('lets a consumer name the shared options bag from the package entry point', () => {
    const opts: SessionMutationOptions = { sessionDir: '/tmp/s', cwd: '/tmp' };
    const withLimit: GetSessionMessagesOptions = { ...opts, limit: 10 };
    expect(opts.sessionDir).toBe('/tmp/s');
    expect(withLimit.limit).toBe(10);
  });
});
