#!/usr/bin/env node
/**
 * Mutation-score ratchet guard (keeper order 2026-07-13).
 *
 * Compares a fresh Stryker JSON report against the committed floor for one
 * ratchet target (mutation-ratchet.json). The floor only ever RISES: a run
 * below floor - tolerance fails (test quality regressed - new code brought
 * blind spots the suite does not pin); a run meaningfully above the floor
 * prints a notice suggesting the baseline bump.
 *
 * Usage (after `npx stryker run --mutate <target.mutate>`):
 *   node scripts/check-mutation-ratchet.mjs --name transport-openai \
 *     [--report reports/mutation/mutation.json] [--baseline mutation-ratchet.json]
 *
 * W3-1/W3-2 (audit r3): the score computation is a pure, EXPORTED function
 * (`scoreReport`) guarded behind an `import.meta` main-check so a unit test can
 * pin the formula (flipping the numerator/operator must red a test, not ship
 * green). `scoreReport` also honours the target's `mutate` glob: a report that
 * carries files OUTSIDE the target's own source set (a broader `--mutate` was
 * run, or two modules' files landed in one report) is scoped down to the
 * target's files before scoring, so one module's floor is never judged against
 * another module's mutants.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Turn a Stryker `mutate` glob (e.g. `src/transport/openai.ts`,
 * `src/sessions/**​/*.ts`) into an anchored RegExp against a POSIX-style path.
 * Only the `**`, `*`, and `?` wildcards used by the baseline are supported.
 */
export function mutateGlobToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**` (optionally followed by `/`) spans any number of path segments.
        i += 1;
        if (glob[i + 1] === '/') i += 1;
        re += '(?:.*/)?';
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** Normalise a report file key to a repo-relative POSIX path for glob matching. */
function normalizeReportPath(key) {
  let p = key.replace(/\\/g, '/');
  const idx = p.indexOf('/src/');
  if (idx !== -1) p = p.slice(idx + 1); // strip an absolute prefix -> `src/...`
  else if (p.startsWith('./')) p = p.slice(2);
  return p;
}

/**
 * Compute the mutation score for one target from a Stryker report.
 * Returns the tallies and score, and — when the target declares a `mutate`
 * glob — the count of files that were scoped out for being outside it.
 */
export function scoreReport(report, target) {
  const glob = target?.mutate;
  const matcher = typeof glob === 'string' ? mutateGlobToRegExp(glob) : null;
  let killed = 0;
  let timeout = 0;
  let survived = 0;
  let noCoverage = 0;
  let errors = 0;
  let scopedOut = 0;
  for (const [key, file] of Object.entries(report.files ?? {})) {
    if (matcher && !matcher.test(normalizeReportPath(key))) {
      scopedOut += 1;
      continue;
    }
    for (const m of file.mutants ?? []) {
      if (m.status === 'Killed') killed += 1;
      else if (m.status === 'Timeout') timeout += 1;
      else if (m.status === 'Survived') survived += 1;
      else if (m.status === 'NoCoverage') noCoverage += 1;
      else errors += 1;
    }
  }
  const valid = killed + timeout + survived + noCoverage;
  const score = valid === 0 ? 0 : ((killed + timeout) / valid) * 100;
  return { killed, timeout, survived, noCoverage, errors, valid, score, scopedOut };
}

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const ROOT = path.join(HERE, '..');
  const NAME = arg('name', '');
  const REPORT = path.resolve(ROOT, arg('report', 'reports/mutation/mutation.json'));
  const BASELINE = path.resolve(ROOT, arg('baseline', 'mutation-ratchet.json'));

  if (!NAME) {
    console.error('ratchet: pass --name <target name from mutation-ratchet.json>');
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const target = (baseline.targets ?? []).find((t) => t.name === NAME);
  if (!target) {
    console.error(
      `ratchet: unknown target "${NAME}" - the workflow matrix and mutation-ratchet.json drifted apart. ` +
        `Known: ${(baseline.targets ?? []).map((t) => t.name).join(', ')}`,
    );
    process.exit(2);
  }
  if (!fs.existsSync(REPORT)) {
    console.error(`ratchet: report not found at ${REPORT} - did the stryker run complete?`);
    process.exit(2);
  }

  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const { killed, timeout, survived, noCoverage, errors, valid, score, scopedOut } = scoreReport(
    report,
    target,
  );
  if (valid === 0) {
    console.error(
      'ratchet: report contains zero valid mutants for this target - wrong --mutate target ' +
        `(scoped out ${scopedOut} file(s) outside "${target.mutate}")?`,
    );
    process.exit(2);
  }
  const tolerance = Number(baseline._meta?.tolerance_pp ?? 0.75);
  const floorWithGrace = target.floor - tolerance;

  console.log(
    `ratchet[${NAME}]: score ${score.toFixed(2)}% ` +
      `(killed ${killed} + timeout ${timeout} / survived ${survived} / no-coverage ${noCoverage} / errors ${errors}` +
      `${scopedOut > 0 ? ` / scoped-out ${scopedOut}` : ''}) ` +
      `vs floor ${target.floor}% (tolerance ${tolerance}pp)`,
  );

  if (score < floorWithGrace) {
    console.error(
      `ratchet[${NAME}] FAILED: ${score.toFixed(2)}% < floor ${target.floor}% - ${tolerance}pp. ` +
        'Test quality regressed on this module: recent changes introduced mutants the suite does not kill. ' +
        'Fix by adding kill tests (see the campaign report for the playbook), NOT by lowering the floor - ' +
        'floors only move down by keeper ruling.',
    );
    process.exit(1);
  }
  if (score >= target.floor + 1) {
    console.log(
      `::notice::ratchet[${NAME}]: measured ${score.toFixed(2)}% is >=1pp above the floor ${target.floor}% - ` +
        'raise the floor in mutation-ratchet.json to lock the gain (only-up discipline).',
    );
  }
  console.log(`ratchet[${NAME}] OK.`);
}

// Run only when invoked directly; importing for tests must not execute main().
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
