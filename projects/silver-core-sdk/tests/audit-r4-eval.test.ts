/**
 * Audit r4 — "eval" cluster regressions (V7-1, V7-2, V7-3).
 *
 * Each block pins one confirmed defect from silver-core-sdk-bug-audit-r4:
 *  - V7-1 computeDimensionStats surfaces the sample-count denominator a bare
 *    mean hides (a 15/20-errored dimension must not read as healthy; a fully
 *    collapsed dimension must not vanish).
 *  - V7-2 dc-04 removes seed.txt before the resume so a file-re-reading (non
 *    resuming) engine can no longer answer vacuously.
 *  - V7-3 normalize-l3 N2 per-line rstrip is opt-out so a trailing-whitespace
 *    fidelity divergence is observable instead of masked on both arms.
 *
 * V7-4 (l5-aggregate apiMs) is intentionally NOT fixed — see the structured
 * summary's `skipped`: the last-cumulative apiMs / summed num_turns split is
 * the correct reflection of the real SDK field semantics (query.ts:985-988,
 * pinned by the run-28736460533 official trace) and summing apiMs would
 * triple-count and break conformance-l5-aggregate.test.ts.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line import/no-relative-packages -- eval-side tooling under test
import { computeDimensionMeans, computeDimensionStats } from '../scripts/eval-scoring.mjs';
// eslint-disable-next-line import/no-relative-packages -- eval-side tooling under test
import { getHarnessRunner } from '../scripts/eval-harnesses.mjs';
// @ts-expect-error - plain-JS conformance module without type declarations
import { compareToolResultTexts, normalizeToolResult } from './conformance/normalize-l3.mjs';

describe('V7-1 computeDimensionStats surfaces the sample-count denominator', () => {
  it('a 15/20-errored dimension keeps a healthy mean but exposes the collapse', () => {
    const results = [
      ...Array.from({ length: 5 }, () => ({ outcome: 'SCORED', dimension: 'recall', score: 5 })),
      ...Array.from({ length: 15 }, () => ({ outcome: 'ERROR', dimension: 'recall' })),
    ];
    // The bare mean alone reads as perfect and hides the 75% error rate...
    expect(computeDimensionMeans(results)).toEqual({ recall: 5 });
    // ...while the stats carry the honest denominator that a gate can flag.
    expect(computeDimensionStats(results)).toEqual({
      recall: { mean: 5, scored: 5, invalid: 0, errored: 15, total: 20 },
    });
  });

  it('a fully collapsed dimension stays visible with mean:null (never vanishes)', () => {
    const stats = computeDimensionStats([
      { outcome: 'ERROR', dimension: 'disconnect_recovery' },
      { outcome: 'SCORED', dimension: 'disconnect_recovery', score: undefined },
    ]);
    // computeDimensionMeans drops it entirely; stats keeps it present.
    expect(computeDimensionMeans([{ outcome: 'ERROR', dimension: 'disconnect_recovery' }])).toEqual(
      {},
    );
    expect('disconnect_recovery' in stats).toBe(true);
    expect(stats.disconnect_recovery).toEqual({
      mean: null,
      scored: 0,
      invalid: 1,
      errored: 1,
      total: 2,
    });
  });

  it('invalid (scoreless SCORED) records are counted apart and stay out of the mean', () => {
    const stats = computeDimensionStats([
      { outcome: 'SCORED', dimension: 'd', score: 4 },
      { outcome: 'SCORED', dimension: 'd', score: 2 },
      { outcome: 'SCORED', dimension: 'd', score: 'x' }, // poisoned: not integer
      { outcome: 'PENDING_HARNESS', dimension: 'd' },
    ]);
    // mean over the two valid scores only; agrees with computeDimensionMeans.
    expect(stats.d).toEqual({ mean: 3, scored: 2, invalid: 1, errored: 0, total: 4 });
    expect(stats.d.mean).toBe(computeDimensionMeans([
      { outcome: 'SCORED', dimension: 'd', score: 4 },
      { outcome: 'SCORED', dimension: 'd', score: 2 },
    ]).d);
  });
});

describe('V7-2 dc-04 removes the seed.txt crutch before the resume', () => {
  it('phase 1 sees seed.txt; phase 2 (resume) does not — a re-read cannot answer', async () => {
    const seen: Array<{ seedExists: boolean }> = [];
    // Fake SDK: records whether seed.txt exists at each query() call and yields
    // a session id so sessionIdOf() is non-null and phase 2 runs.
    const sdk = {
      query({ options }: { options: { cwd: string } }) {
        seen.push({ seedExists: existsSync(join(options.cwd, 'seed.txt')) });
        async function* gen() {
          yield { type: 'assistant', session_id: 'sess-v72', message: { content: [] } };
          yield { type: 'result', session_id: 'sess-v72', subtype: 'success', is_error: false };
        }
        return gen();
      },
    };
    const runner = getHarnessRunner('dc-04');
    expect(runner).toBeTypeOf('function');
    const out = await runner({ sdk });
    try {
      expect(seen).toHaveLength(2);
      expect(seen[0]!.seedExists).toBe(true); // phase 1: model could Read it
      expect(seen[1]!.seedExists).toBe(false); // phase 2: only a real resume knows the code
      // Evidence records the removed crutch honestly.
      expect(out.evidence.files['seed.txt']).toBe('<absent>');
      expect(out.evidence.resumedSessionId).toBe('sess-v72');
    } finally {
      rmSync(out.ws.cwd, { recursive: true, force: true });
    }
  });
});

describe('V7-3 normalize-l3 N2 per-line rstrip is opt-out for fidelity', () => {
  it('default strips trailing whitespace (unchanged); the opt-in preserves it', () => {
    expect(normalizeToolResult('third line   \n', {}, {}).text).toBe('third line');
    expect(normalizeToolResult('third line   \n', {}, { preserveTrailingSpace: true }).text).toBe(
      'third line   ',
    );
  });

  it('a trailing-whitespace divergence is masked by default but observable when preserved', () => {
    // Same fixture shape as L3-READ-01: one arm keeps the trailing spaces, one
    // strips them. Default N2 rstrip hides it; the opt-in surfaces it.
    const masked = compareToolResultTexts(
      'first line\nthird line   \n',
      'first line\nthird line\n',
      {},
      {},
      {},
      [],
    );
    expect(masked.status).toBe('match');
    const surfaced = compareToolResultTexts(
      'first line\nthird line   \n',
      'first line\nthird line\n',
      {},
      {},
      { preserveTrailingSpace: true },
      [],
    );
    expect(surfaced.status).toBe('divergent');
  });
});
