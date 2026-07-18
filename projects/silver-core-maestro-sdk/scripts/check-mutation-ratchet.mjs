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
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
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
let killed = 0;
let timeout = 0;
let survived = 0;
let noCoverage = 0;
let errors = 0;
for (const file of Object.values(report.files ?? {})) {
  for (const m of file.mutants ?? []) {
    if (m.status === 'Killed') killed += 1;
    else if (m.status === 'Timeout') timeout += 1;
    else if (m.status === 'Survived') survived += 1;
    else if (m.status === 'NoCoverage') noCoverage += 1;
    else errors += 1;
  }
}
const valid = killed + timeout + survived + noCoverage;
if (valid === 0) {
  console.error('ratchet: report contains zero valid mutants - wrong --mutate target?');
  process.exit(2);
}
const score = ((killed + timeout) / valid) * 100;
const tolerance = Number(baseline._meta?.tolerance_pp ?? 0.75);
const floorWithGrace = target.floor - tolerance;

console.log(
  `ratchet[${NAME}]: score ${score.toFixed(2)}% ` +
    `(killed ${killed} + timeout ${timeout} / survived ${survived} / no-coverage ${noCoverage} / errors ${errors}) ` +
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
