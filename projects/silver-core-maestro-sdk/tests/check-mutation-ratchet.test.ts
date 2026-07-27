/**
 * Mutation-ratchet guard: testable and scoped (twin of the agent SDK's test).
 *
 * Keeper ruling 2026-07-27: this package's copy of the guard is a lawful twin
 * (the dependency-direction contract forbids importing the agent package's
 * scripts), so it must stay FUNCTIONALLY equal — which means carrying the same
 * locks, not just the same code. It had fallen behind by the W3-1/W3-2 fix.
 *
 *  - W3-2: the score formula lives in an exported pure function so a flipped
 *    numerator/operator reds THIS test instead of shipping green.
 *  - W3-1: a report carrying files outside the target's `mutate` glob is scoped
 *    down to the target's own files before scoring — one module's floor can no
 *    longer be judged against another module's mutants.
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs guard script, no type declarations.
import { scoreReport, mutateGlobToRegExp } from '../scripts/check-mutation-ratchet.mjs';

const mutant = (status: string) => ({ status });
const fileWith = (...statuses: string[]) => ({ mutants: statuses.map(mutant) });

describe('W3-2: scoreReport pins the Stryker score formula', () => {
  it('computes (killed + timeout) / (killed + timeout + survived + noCoverage) * 100', () => {
    const report = {
      files: {
        'src/ledger/state.ts': fileWith(
          'Killed',
          'Killed',
          'Killed',
          'Timeout',
          'Survived',
          'NoCoverage',
        ),
      },
    };
    const r = scoreReport(report, { mutate: 'src/ledger/state.ts' });
    // 3 killed + 1 timeout = 4 over (4 + 1 survived + 1 noCoverage = 6) -> 66.67%.
    expect(r.killed).toBe(3);
    expect(r.timeout).toBe(1);
    expect(r.survived).toBe(1);
    expect(r.noCoverage).toBe(1);
    expect(r.valid).toBe(6);
    expect(r.score).toBeCloseTo((4 / 6) * 100, 6);
  });

  it('excludes compile/runtime-error mutants from the denominator', () => {
    const report = {
      files: { 'src/x.ts': fileWith('Killed', 'CompileError', 'RuntimeError') },
    };
    const r = scoreReport(report, {});
    expect(r.errors).toBe(2);
    expect(r.valid).toBe(1); // only the Killed mutant is valid
    expect(r.score).toBe(100);
  });

  it('reports score 0 (not NaN) when there are zero valid mutants', () => {
    const r = scoreReport({ files: {} }, {});
    expect(r.valid).toBe(0);
    expect(r.score).toBe(0);
  });
});

describe('W3-1: scoreReport scopes the report to the target mutate glob', () => {
  it('ignores files outside the target glob and counts them as scoped-out', () => {
    const report = {
      files: {
        'src/ledger/state.ts': fileWith('Killed', 'Killed'),
        // A stray module that a broader --mutate dragged into the same report:
        'src/workflow/graph.ts': fileWith('Survived', 'Survived', 'Survived'),
      },
    };
    const scoped = scoreReport(report, { mutate: 'src/ledger/state.ts' });
    expect(scoped.scopedOut).toBe(1);
    expect(scoped.survived).toBe(0); // the out-of-scope survivors do not count
    expect(scoped.score).toBe(100);

    // Without scoping (no glob), the survivors WOULD tank the score — proving
    // the scope actually changed the verdict.
    const unscoped = scoreReport(report, {});
    expect(unscoped.survived).toBe(3);
    expect(unscoped.score).toBeCloseTo((2 / 5) * 100, 6);
  });

  it('handles an absolute report path and a ** glob', () => {
    const report = {
      files: {
        '/home/runner/work/repo/repo/src/workflow/graph.ts': fileWith('Killed'),
        '/home/runner/work/repo/repo/src/ledger/state.ts': fileWith('Survived'),
      },
    };
    const r = scoreReport(report, { mutate: 'src/workflow/**/*.ts' });
    expect(r.killed).toBe(1);
    expect(r.scopedOut).toBe(1);
    expect(r.score).toBe(100);
  });
});

describe('mutateGlobToRegExp', () => {
  it('matches a single-file glob exactly', () => {
    const re = mutateGlobToRegExp('src/ledger/state.ts');
    expect(re.test('src/ledger/state.ts')).toBe(true);
    expect(re.test('src/schedule/spec.ts')).toBe(false);
    expect(re.test('src/ledger/state.ts.map')).toBe(false);
  });

  it('matches a ** recursive glob across segments', () => {
    const re = mutateGlobToRegExp('src/workflow/**/*.ts');
    expect(re.test('src/workflow/graph.ts')).toBe(true);
    expect(re.test('src/workflow/steps/run.ts')).toBe(true);
    expect(re.test('src/ledger/state.ts')).toBe(false);
  });
});
