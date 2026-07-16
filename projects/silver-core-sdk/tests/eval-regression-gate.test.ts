/**
 * REQ-2.2 regression gate (scripts/check-eval-regression.mjs):
 *  - a dimension dropping by more than 0.5 versus the baseline warns;
 *  - drops within the threshold, gains, and baseline-less dimensions do not;
 *  - a baselined dimension with no current score warns (silence would read
 *    as "checked");
 *  - CLI behavior: no baseline file -> explicit SKIP exit 0 (advisory gate
 *    never blocks by default); --strict turns regressions into exit 1.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line import/no-relative-packages -- eval-side tooling under test
import { compareToBaseline, REGRESSION_THRESHOLD } from '../scripts/check-eval-regression.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-eval-regression.mjs');

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eval-gate-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function report(dimensionMeans: Record<string, number>, mode = 'LIVE') {
  return { mode, behavior: { dimensionMeans, scored: 12 } };
}

describe('compareToBaseline', () => {
  it('warns only on drops beyond the threshold', () => {
    const baseline = { dimensionMeans: { memory_recall: 4.0, token_efficiency: 3.0 } };
    const { warnings, rows } = compareToBaseline(
      baseline,
      report({ memory_recall: 3.4, token_efficiency: 2.6 }),
    );
    expect(REGRESSION_THRESHOLD).toBe(0.5);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('memory_recall 4 -> 3.4');
    const mem = rows.find((r: { dimension: string }) => r.dimension === 'memory_recall');
    expect(mem).toMatchObject({ regressed: true, delta: -0.6 });
    const tok = rows.find((r: { dimension: string }) => r.dimension === 'token_efficiency');
    expect(tok).toMatchObject({ regressed: false, delta: -0.4 });
  });

  it('warns when a baselined dimension vanished from the report', () => {
    const baseline = { dimensionMeans: { disconnect_recovery: 4.2 } };
    const { warnings } = compareToBaseline(baseline, report({ memory_recall: 4.5 }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no score in this report');
  });

  it('a new dimension without baseline is listed, never warned', () => {
    const baseline = { dimensionMeans: {} };
    const { warnings, rows } = compareToBaseline(baseline, report({ memory_recall: 2.0 }));
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dimension: 'memory_recall', baseline: null });
  });
});

describe('CLI behavior', () => {
  it('SKIPs (exit 0) without a baseline, and on non-LIVE reports', async () => {
    const rep = join(dir, 'evals-x.json');
    await writeFile(rep, JSON.stringify(report({ memory_recall: 1.0 })), 'utf8');
    const noBaseline = spawnSync(
      'node',
      [script, '--report', rep, '--baseline', join(dir, 'absent.json')],
      { encoding: 'utf8' },
    );
    expect(noBaseline.status).toBe(0);
    expect(noBaseline.stdout).toContain('SKIP: no committed baseline');

    const stubRep = join(dir, 'evals-stub.json');
    await writeFile(stubRep, JSON.stringify(report({ memory_recall: 1.0 }, 'STUB')), 'utf8');
    const baseline = join(dir, 'baseline.json');
    await writeFile(baseline, JSON.stringify({ dimensionMeans: { memory_recall: 4 } }), 'utf8');
    const stub = spawnSync('node', [script, '--report', stubRep, '--baseline', baseline], {
      encoding: 'utf8',
    });
    expect(stub.status).toBe(0);
    expect(stub.stdout).toContain('SKIP: report is STUB');
  });

  it('emits ::warning:: annotations on regression, exit 0 unless --strict', async () => {
    const rep = join(dir, 'evals-y.json');
    await writeFile(rep, JSON.stringify(report({ memory_recall: 3.0 })), 'utf8');
    const baseline = join(dir, 'baseline.json');
    await writeFile(baseline, JSON.stringify({ dimensionMeans: { memory_recall: 4.0 } }), 'utf8');

    const soft = spawnSync('node', [script, '--report', rep, '--baseline', baseline], {
      encoding: 'utf8',
    });
    expect(soft.status).toBe(0);
    expect(soft.stdout).toContain('::warning title=evals regression gate::');

    const strict = spawnSync(
      'node',
      [script, '--report', rep, '--baseline', baseline, '--strict'],
      { encoding: 'utf8' },
    );
    expect(strict.status).toBe(1);
  });

  it('--write-baseline seeds from a scored report and refuses an empty one', async () => {
    const rep = join(dir, 'evals-z.json');
    await writeFile(
      rep,
      JSON.stringify({ ...report({ memory_recall: 4.1 }), judgeModel: 'claude-sonnet-5' }),
      'utf8',
    );
    const baseline = join(dir, 'baseline.json');
    const ok = spawnSync(
      'node',
      [script, '--write-baseline', rep, '--baseline', baseline],
      { encoding: 'utf8' },
    );
    expect(ok.status).toBe(0);
    const written = JSON.parse(await readFile(baseline, 'utf8'));
    expect(written.dimensionMeans).toEqual({ memory_recall: 4.1 });
    expect(written.judgeModel).toBe('claude-sonnet-5');

    const empty = join(dir, 'evals-empty.json');
    await writeFile(empty, JSON.stringify(report({})), 'utf8');
    const refused = spawnSync(
      'node',
      [script, '--write-baseline', empty, '--baseline', join(dir, 'b2.json')],
      { encoding: 'utf8' },
    );
    expect(refused.status).toBe(1);
  });
});
