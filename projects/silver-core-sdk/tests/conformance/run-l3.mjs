/**
 * L3 tool-behavior differential runner (conformance suite M2).
 *
 * Replays every L3 scenario through BOTH arms against the content-blind
 * emulator: the model side scripts one tool_use per turn, each engine
 * executes the REAL tool in its own throwaway cwd, and the tool_result texts
 * extracted from each arm's PUBLIC SDKMessage stream are compared after L3
 * normalization (normalize-l3.mjs) under the KNOWN_TOOL_DIVERGENCES
 * contract: known diffs are reported (never hidden), unlisted diffs are
 * DIVERGENT. File side effects are asserted HARD - never KD-excusable -
 * except declared per-arm behavioral splits encoded in the case itself.
 *
 * Usage:
 *   node tests/conformance/run-l3.mjs [--arm=both|bpt] [--out=path.json]
 *
 * Prereqs: same as run-l1.mjs (npm run build; official packages installed
 * transiently per tests/conformance/pins.json, never into package.json).
 *
 * Exit semantics (mirrors run-l1): exit 1 only when the BPT arm fails its
 * own locks/side-effect expectations or a single-arm lock fails (a
 * regression in OUR engine regardless of the official arm). DIVERGENT
 * verdicts print loudly; the M3 ratchet will turn them into a gate.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { L3_SCENARIOS, L3_SINGLE_ARM, L3_SKIPPED } from './scenarios-l3.mjs';
import { runScenario } from './arm.mjs';
import {
  KNOWN_TOOL_DIVERGENCES,
  compareToolResultTexts,
  normalizeToolResult,
} from './normalize-l3.mjs';
import { assertContentBlind } from './emulator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const armMode = args.arm ?? 'both';
const outPath =
  typeof args.out === 'string' ? args.out : join(HERE, '..', '..', 'conformance-l3.json');

/** Per-arm normalization env from a runScenario result. */
function envOf(result) {
  return {
    cwd: result.pathInfo?.cwd,
    realCwd: result.pathInfo?.realCwd,
    outsideDir: result.pathInfo?.outsideDir,
    realOutsideDir: result.pathInfo?.realOutsideDir,
    shellId: result.state?.shellId,
  };
}

/** Expected is_error for one arm; undefined = not asserted. */
function expectedIsError(step, armKey) {
  if (typeof step.isError === 'boolean') return step.isError;
  if (step.isError && typeof step.isError === 'object') return step.isError[armKey];
  return undefined;
}

/**
 * Evaluate one arm's tool_results against the scenario's per-step
 * expectations (isError flags + semantic locks on the NORMALIZED text).
 * Returns { failures, normTexts } - failures on the BPT arm are engine
 * regressions; failures on the official arm are differential findings.
 */
function evaluateArm(scenario, result, armKey) {
  const failures = [];
  const normTexts = [];
  if (result.error) failures.push(`run error: ${result.error}`);
  const env = envOf(result);
  scenario.steps.forEach((step, i) => {
    const tr = result.toolResults[i];
    if (tr === undefined) {
      failures.push(`step ${i + 1} (${step.tool}): missing tool_result`);
      normTexts.push(null);
      return;
    }
    const norm = normalizeToolResult(tr.text, env, step.flags ?? {}).text;
    normTexts.push(norm);
    const wantError = expectedIsError(step, armKey);
    if (wantError !== undefined && tr.isError !== wantError) {
      failures.push(
        `step ${i + 1} (${step.tool}): is_error ${tr.isError} != ${wantError}`,
      );
    }
    const locks = [
      ...(step.locks ?? []),
      ...((armKey === 'ours' ? step.oursLocks : step.officialLocks) ?? []),
    ];
    for (const re of locks) {
      if (!re.test(norm)) {
        failures.push(`step ${i + 1} (${step.tool}): lock ${re} missed`);
      }
    }
    for (const re of step.notLocks ?? []) {
      if (re.test(norm)) {
        failures.push(`step ${i + 1} (${step.tool}): negative lock ${re} matched`);
      }
    }
    if (step.exact !== undefined && norm !== step.exact) {
      failures.push(
        `step ${i + 1} (${step.tool}): exact content mismatch (got ${JSON.stringify(norm).slice(0, 160)})`,
      );
    }
  });
  return { failures, normTexts };
}

/** Expected after-run file bytes for one arm (shared or per-arm table). */
function expectedFilesFor(scenario, armKey) {
  if (scenario.expectFilesPerArm) return scenario.expectFilesPerArm[armKey] ?? {};
  return scenario.expectFiles ?? {};
}

/** HARD side-effect check: byte-identical or fail (never KD-excusable). */
function checkFiles(scenario, result, armKey) {
  const failures = [];
  const expected = expectedFilesFor(scenario, armKey);
  for (const [rel, want] of Object.entries(expected)) {
    const got = result.files?.[rel] ?? null;
    if (got !== want) {
      failures.push(
        `file ${rel}: ${JSON.stringify(got)?.slice(0, 80)} != ${JSON.stringify(want)?.slice(0, 80)}`,
      );
    }
  }
  return failures;
}

const pins = JSON.parse(readFileSync(join(HERE, 'pins.json'), 'utf8'));
const matrix = {
  generated_for: 'silver-core-sdk conformance L3 (tool behavior differential)',
  pins: { agentSdk: pins.agentSdk, claudeCode: pins.claudeCode },
  armMode,
  scenarios: [],
  singleArmLocks: [],
  skipped: L3_SKIPPED,
  knownToolDivergenceTable: KNOWN_TOOL_DIVERGENCES.map(({ id, tool, note }) => ({
    id,
    tool,
    note,
  })),
};

let bptFailureCount = 0;
let divergentCount = 0;

for (const scenario of L3_SCENARIOS) {
  const row = { id: scenario.id, tool: scenario.tool };
  const bpt = await runScenario('bpt', scenario);
  const bptEval = evaluateArm(scenario, bpt, 'ours');
  const bptFileFailures = checkFiles(scenario, bpt, 'ours');
  row.bpt = {
    failures: [...bptEval.failures, ...bptFileFailures],
    error: bpt.error,
  };
  bptFailureCount += row.bpt.failures.length;

  let official;
  if (armMode === 'both') {
    try {
      official = await runScenario('official', scenario);
    } catch (err) {
      row.official = { unavailable: String(err?.message ?? err).slice(0, 200) };
    }
  }

  if (official !== undefined) {
    const offEval = evaluateArm(scenario, official, 'official');
    const offFileFailures = checkFiles(scenario, official, 'official');
    row.official = {
      failures: [...offEval.failures, ...offFileFailures],
      error: official.error,
    };

    const kdHits = new Set();
    const stepRows = [];
    let anyDivergent = false;

    scenario.steps.forEach((step, i) => {
      const oursTr = bpt.toolResults[i];
      const offTr = official.toolResults[i];
      const stepRow = { step: i + 1, tool: step.tool };
      if (oursTr === undefined || offTr === undefined) {
        stepRow.status = 'divergent';
        stepRow.reason = 'tool_result missing on one arm';
        anyDivergent = true;
        stepRows.push(stepRow);
        return;
      }
      if (step.crossCompare === false) {
        // Declared behavioral split: the per-arm expectations ARE the
        // assertion; when both sides meet them the split is recorded as its
        // KD, when either side misses the case surfaces the failure instead.
        const related = (msgs) => msgs.some((f) => f.startsWith(`step ${i + 1} `));
        if (!step.behavioralKd) {
          // Review finding: a declared cross-arm split without a KD id must
          // never be excused - the allowlist contract requires every skip to
          // carry a reported id.
          stepRow.status = 'divergent';
          stepRow.reason = 'crossCompare:false without behavioralKd (undocumented split)';
          anyDivergent = true;
        } else if (!related(bptEval.failures) && !related(offEval.failures)) {
          kdHits.add(step.behavioralKd);
          stepRow.status = 'known';
          stepRow.kdHits = [step.behavioralKd];
        } else {
          stepRow.status = 'divergent';
          stepRow.reason = 'per-arm behavioral expectation not met';
          anyDivergent = true;
        }
        stepRows.push(stepRow);
        return;
      }
      const cmp = compareToolResultTexts(
        offTr.text,
        oursTr.text,
        envOf(official),
        envOf(bpt),
        step.flags ?? {},
        step.kd ?? [],
      );
      stepRow.status = cmp.status;
      stepRow.kdHits = cmp.kdHits;
      stepRow.diff = cmp.diff;
      stepRow.official = cmp.officialText;
      stepRow.ours = cmp.oursText;
      for (const id of cmp.kdHits) kdHits.add(id);
      if (cmp.status === 'divergent') anyDivergent = true;
      stepRows.push(stepRow);
    });

    // KD-L3-13: official shell-id token shape differs from ours (values are
    // masked by N4 either way; the format delta is still reported).
    const offShellId = official.state?.shellId;
    if (typeof offShellId === 'string' && !/^bash_\d+$/.test(offShellId)) {
      kdHits.add('KD-L3-13');
    }

    // Official-arm expectation misses are differential findings: reported,
    // and the case cannot claim MATCH over them.
    if (row.official.failures.length > 0) anyDivergent = true;

    row.steps = stepRows;
    row.kdHits = [...kdHits].sort();
    row.verdict = anyDivergent
      ? 'CONTENT_DIVERGENT'
      : kdHits.size > 0
        ? 'CONTENT_KNOWN_DIFF'
        : 'CONTENT_MATCH';
    if (row.verdict === 'CONTENT_DIVERGENT') divergentCount += 1;
  } else if (armMode === 'both' && row.official?.unavailable) {
    row.verdict = 'OFFICIAL-ARM-UNAVAILABLE';
  } else {
    row.verdict = 'single-arm';
  }

  matrix.scenarios.push(row);
  const diffNote =
    row.steps
      ?.filter((s) => s.status === 'divergent')
      .map((s) =>
        (s.diff ?? [])
          .map((d) => `L${d.line} official=${JSON.stringify(d.official)} ours=${JSON.stringify(d.ours)}`)
          .join('; '),
      )
      .filter((s) => s && s.length > 0)
      .join(' | ') ?? '';
  console.log(
    `[${scenario.id}] ${row.verdict}${row.kdHits?.length ? ` | KD: ${row.kdHits.join(' ')}` : ''}` +
      `${row.bpt.failures.length ? ` | BPT FAIL: ${row.bpt.failures.join('; ')}` : ''}` +
      `${row.official?.failures?.length ? ` | OFFICIAL MISS: ${row.official.failures.join('; ')}` : ''}` +
      `${diffNote ? ` | diff: ${diffNote}` : ''}`,
  );
}

// Single-arm locks: BPT-only exact/semantic pins (see scenarios-l3.mjs for
// the no-shared-observable rationale per entry).
for (const scenario of L3_SINGLE_ARM) {
  const result = await runScenario('bpt', scenario);
  const evald = evaluateArm(scenario, result, 'ours');
  const fileFailures = checkFiles(scenario, result, 'ours');
  const afterFailures =
    typeof scenario.checkAfterQuery === 'function'
      ? scenario.checkAfterQuery(result.afterQuery)
      : [];
  const failures = [...evald.failures, ...fileFailures, ...afterFailures];
  bptFailureCount += failures.length;
  const row = {
    id: scenario.id,
    tool: scenario.tool,
    reason: scenario.reason,
    verdict: failures.length === 0 ? 'LOCKED' : 'FAILED',
    failures,
  };
  matrix.singleArmLocks.push(row);
  console.log(
    `[${scenario.id}] ${row.verdict}${failures.length ? ` | ${failures.join('; ')}` : ''}`,
  );
}

// Mandatory self-audit before the artifact leaves the process (standing
// decision clause 2): no request-body-derived content in the matrix.
const serialized = JSON.stringify(matrix, null, 2);
assertContentBlind(serialized);
writeFileSync(outPath, serialized);

console.log('\n| case | verdict | known diffs |');
console.log('|---|---|---|');
for (const row of matrix.scenarios) {
  console.log(`| ${row.id} | ${row.verdict} | ${row.kdHits?.join(' ') ?? ''} |`);
}
for (const row of matrix.singleArmLocks) {
  console.log(`| ${row.id} | ${row.verdict} | (single-arm lock) |`);
}
console.log(`\nmatrix: ${outPath}`);
console.log('content-blind self-audit: PASS');

if (bptFailureCount > 0) {
  console.error(
    `\nFAIL: ${bptFailureCount} failure(s) on the BPT arm (engine regression independent of the official arm)`,
  );
  process.exit(1);
}
if (divergentCount > 0) {
  console.error(
    `\nINFO (M2, not gating): ${divergentCount} CONTENT_DIVERGENT case(s) - inspect the matrix; the M3 ratchet will gate these`,
  );
}
process.exit(0);
