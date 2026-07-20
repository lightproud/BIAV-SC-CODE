/**
 * Audit r3 batch O (T51) — mutation-ratchet guard is now testable and scoped.
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
        'src/transport/openai.ts': fileWith(
          'Killed',
          'Killed',
          'Killed',
          'Timeout',
          'Survived',
          'NoCoverage',
        ),
      },
    };
    const r = scoreReport(report, { mutate: 'src/transport/openai.ts' });
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
        'src/transport/openai.ts': fileWith('Killed', 'Killed'),
        // A stray module that a broader --mutate dragged into the same report:
        'src/sessions/store.ts': fileWith('Survived', 'Survived', 'Survived'),
      },
    };
    const scoped = scoreReport(report, { mutate: 'src/transport/openai.ts' });
    expect(scoped.scopedOut).toBe(1);
    expect(scoped.survived).toBe(0); // the sessions survivors do not count
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
        '/home/runner/work/repo/repo/src/sessions/file-store.ts': fileWith('Killed'),
        '/home/runner/work/repo/repo/src/transport/openai.ts': fileWith('Survived'),
      },
    };
    const r = scoreReport(report, { mutate: 'src/sessions/**/*.ts' });
    expect(r.killed).toBe(1);
    expect(r.scopedOut).toBe(1);
    expect(r.score).toBe(100);
  });
});

describe('mutateGlobToRegExp', () => {
  it('matches a single-file glob exactly', () => {
    const re = mutateGlobToRegExp('src/transport/openai.ts');
    expect(re.test('src/transport/openai.ts')).toBe(true);
    expect(re.test('src/transport/anthropic.ts')).toBe(false);
    expect(re.test('src/transport/openai.ts.map')).toBe(false);
  });

  it('matches a ** recursive glob across segments', () => {
    const re = mutateGlobToRegExp('src/sessions/**/*.ts');
    expect(re.test('src/sessions/store.ts')).toBe(true);
    expect(re.test('src/sessions/adapters/file.ts')).toBe(true);
    expect(re.test('src/transport/openai.ts')).toBe(false);
  });
});
