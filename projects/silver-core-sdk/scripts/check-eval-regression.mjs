#!/usr/bin/env node
/**
 * REQ-2.2 (SCS-REQ-002 loop 2) — behavior-score regression gate, advisory.
 *
 * Compares the newest runEvals report's per-dimension means against the
 * committed baseline (evals-baseline.json at the SDK root — deliberately
 * OUTSIDE the MANIFEST-protected evals/ directory). Any dimension that
 * dropped by more than 0.5 emits a GitHub `::warning::` annotation — the PR
 * shows red ink, the job stays green, the maintainer arbitrates (the spec
 * explicitly forbids a hard block here).
 *
 *   node scripts/check-eval-regression.mjs [--report <evals-*.json>]
 *                                          [--baseline <file>] [--strict]
 *   node scripts/check-eval-regression.mjs --write-baseline <evals-*.json>
 *
 * No baseline committed yet -> explicit SKIP (exit 0): the gate cannot
 * invent a baseline, and silence would read as "checked". Seed one from a
 * LIVE round with --write-baseline. --strict flips warnings into exit 1 for
 * consumers that do want a hard gate (not used by our CI).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REGRESSION_THRESHOLD = 0.5;

/** Pure comparison: baseline vs report dimension means. */
export function compareToBaseline(baseline, report) {
  const current = report?.behavior?.dimensionMeans ?? {};
  const warnings = [];
  const rows = [];
  for (const [dimension, base] of Object.entries(baseline.dimensionMeans ?? {})) {
    const cur = current[dimension];
    if (cur === undefined) {
      warnings.push(
        `dimension "${dimension}" has a baseline (${base}) but no score in this report ` +
          '(all its questions were PENDING/STUB/ERROR)',
      );
      rows.push({ dimension, baseline: base, current: null, delta: null, regressed: false });
      continue;
    }
    const delta = +(cur - base).toFixed(2);
    const regressed = delta < -REGRESSION_THRESHOLD;
    if (regressed) {
      warnings.push(
        `behavior regression: ${dimension} ${base} -> ${cur} (${delta}; threshold -${REGRESSION_THRESHOLD})`,
      );
    }
    rows.push({ dimension, baseline: base, current: cur, delta, regressed });
  }
  for (const dimension of Object.keys(current)) {
    if ((baseline.dimensionMeans ?? {})[dimension] === undefined) {
      rows.push({
        dimension,
        baseline: null,
        current: current[dimension],
        delta: null,
        regressed: false,
      });
    }
  }
  return { warnings, rows };
}

function newestReport(dir) {
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => /^evals-.*\.json$/.test(n));
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  return join(dir, names.sort().at(-1));
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? null) : null;
  };
  const baselinePath = flag('--baseline') ?? join(root, 'evals-baseline.json');

  if (args.includes('--write-baseline')) {
    const src = flag('--write-baseline');
    const report = JSON.parse(readFileSync(src, 'utf8'));
    const dm = report?.behavior?.dimensionMeans ?? {};
    if (Object.keys(dm).length === 0) {
      console.error('refusing to seed a baseline from a report with no scored dimensions');
      process.exit(1);
    }
    writeFileSync(
      baselinePath,
      `${JSON.stringify(
        {
          note: 'REQ-2.2 behavior baseline — regenerate only via check-eval-regression.mjs --write-baseline (a keeper-reviewed act; baseline resets require a decision record).',
          seededFrom: src.split('/').at(-1),
          mode: report.mode,
          judgeModel: report.judgeModel,
          scored: report.behavior?.scored ?? 0,
          dimensionMeans: dm,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    console.log(`baseline written: ${baselinePath} (${JSON.stringify(dm)})`);
    return;
  }

  const reportPath = flag('--report') ?? newestReport(join(root, 'evals-reports'));
  if (reportPath === null || !existsSync(reportPath)) {
    console.log('SKIP: no runEvals report found (run scripts/run-evals.mjs first)');
    return;
  }
  if (!existsSync(baselinePath)) {
    console.log(
      'SKIP: no committed baseline (evals-baseline.json) — seed one from a LIVE round with ' +
        '--write-baseline <report.json>. The gate does not invent baselines.',
    );
    return;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (report.mode !== 'LIVE') {
    console.log(`SKIP: report is ${report.mode}, regression gate only judges LIVE scores`);
    return;
  }
  const { warnings, rows } = compareToBaseline(baseline, report);
  console.log('| dimension | baseline | current | delta |');
  console.log('|---|---|---|---|');
  for (const r of rows) {
    console.log(
      `| ${r.dimension} | ${r.baseline ?? '—'} | ${r.current ?? '—'} | ${r.delta ?? '—'}${r.regressed ? ' (REGRESSED)' : ''} |`,
    );
  }
  for (const w of warnings) console.log(`::warning title=evals regression gate::${w}`);
  if (warnings.length === 0) console.log('regression gate: PASS (no dimension dropped > 0.5)');
  else if (args.includes('--strict')) process.exit(1);
}

// Import-safe: only run main() when executed directly (tests import
// compareToBaseline without side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
