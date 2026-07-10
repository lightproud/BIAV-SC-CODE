/**
 * L1 stream-grammar differential runner (conformance suite M1).
 *
 * Replays every scenario through BOTH arms against the content-blind
 * emulator, compares normalized streams under the known-divergence
 * allowlist, and emits the conformance matrix (JSON + markdown summary).
 *
 * Usage:
 *   node tests/conformance/run-l1.mjs [--arm=both|bpt|official] [--out=path.json]
 *
 * Prereqs: `npm run build` (bpt arm); for the official arm, install the
 * PINNED packages transiently first (never into package.json):
 *   node -e "const p=require('./tests/conformance/pins.json'); \
 *     console.log(\`@anthropic-ai/claude-agent-sdk@\${p.agentSdk} @anthropic-ai/claude-code@\${p.claudeCode}\`)" \
 *     | xargs npm i --no-save
 *
 * M1 exit semantics: informational - exit 0 unless the runner itself broke
 * or a scenario check failed on the BPT arm (that is a regression in OUR
 * engine regardless of the official arm). DIVERGENT verdicts print loudly;
 * the M3 ratchet will turn them into a gate.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';
import { runScenario } from './arm.mjs';
import { compareStreams, KNOWN_DIVERGENCES } from './normalize.mjs';
import { assertContentBlind } from './emulator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const armMode = args.arm ?? 'both';
const outPath = typeof args.out === 'string' ? args.out : join(HERE, '..', '..', 'conformance-l1.json');

function checksVerdict(expected, checks) {
  const failures = [];
  if (checks.resultSubtype !== expected.resultSubtype) failures.push(`resultSubtype ${checks.resultSubtype} != ${expected.resultSubtype}`);
  if (expected.resultText !== undefined && checks.resultText !== null && !checks.resultText.includes(expected.resultText)) {
    failures.push(`resultText missing "${expected.resultText}"`);
  }
  if (checks.toolResults !== expected.toolResults) failures.push(`toolResults ${checks.toolResults} != ${expected.toolResults}`);
  return failures;
}

const pins = JSON.parse(readFileSync(join(HERE, 'pins.json'), 'utf8'));
const matrix = {
  generated_for: 'silver-core-sdk conformance L1 (stream grammar)',
  pins: { agentSdk: pins.agentSdk, claudeCode: pins.claudeCode },
  armMode,
  scenarios: [],
  knownDivergenceTable: KNOWN_DIVERGENCES,
};

let bptCheckFailures = 0;
let divergent = 0;

for (const scenario of SCENARIOS) {
  const row = { id: scenario.id };
  if (armMode !== 'official') {
    const r = await runScenario('bpt', scenario);
    row.bpt = { tokens: r.tokens, checks: r.checks, error: r.error, checkFailures: checksVerdict(scenario.expect, r.checks) };
    bptCheckFailures += row.bpt.checkFailures.length + (r.error ? 1 : 0);
  }
  if (armMode !== 'bpt') {
    try {
      const r = await runScenario('official', scenario);
      row.official = { tokens: r.tokens, checks: r.checks, error: r.error, checkFailures: checksVerdict(scenario.expect, r.checks) };
    } catch (err) {
      row.official = { unavailable: String(err?.message ?? err).slice(0, 200) };
    }
  }
  if (row.bpt && row.official && !row.official.unavailable) {
    row.compare = compareStreams(row.official.tokens, row.bpt.tokens);
    if (row.compare.verdict === 'DIVERGENT') divergent += 1;
  }
  matrix.scenarios.push(row);
  console.log(`[${scenario.id}] ${row.compare ? row.compare.verdict : 'single-arm'}${row.bpt?.checkFailures?.length ? ` | BPT CHECK FAIL: ${row.bpt.checkFailures.join('; ')}` : ''}`);
}

// Mandatory self-audit before the artifact leaves the process (standing
// decision clause 2): no request-body-derived content in the matrix.
const serialized = JSON.stringify(matrix, null, 2);
assertContentBlind(serialized);
writeFileSync(outPath, serialized);

console.log('\n| scenario | verdict | known diffs | divergences |');
console.log('|---|---|---|---|');
for (const row of matrix.scenarios) {
  console.log(`| ${row.id} | ${row.compare?.verdict ?? (row.official?.unavailable ? 'OFFICIAL-ARM-UNAVAILABLE' : 'single-arm')} | ${row.compare?.knownDiffs?.join(' ') ?? ''} | ${row.compare?.divergences?.length ?? ''} |`);
}
console.log(`\nmatrix: ${outPath}`);
console.log(`content-blind self-audit: PASS`);

if (bptCheckFailures > 0) {
  console.error(`\nFAIL: ${bptCheckFailures} check failure(s) on the BPT arm (engine regression independent of the official arm)`);
  process.exit(1);
}
if (divergent > 0) {
  console.error(`\nINFO (M1, not gating): ${divergent} DIVERGENT scenario(s) - inspect the matrix; the M3 ratchet will gate these`);
}
process.exit(0);
