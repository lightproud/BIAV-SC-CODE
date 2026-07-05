/**
 * Scoreboard ratchet (conformance suite M3, B2): green only grows.
 *
 * Reads the runner-emitted matrix JSONs (conformance-l1.json through
 * conformance-l4.json) and compares
 * each scenario's verdict against the committed baseline
 * (tests/conformance/baseline.json). The baseline stores ONLY the stable
 * scoreboard triple per scenario - { verdict, kdIds sorted, engineFinding } -
 * never volatile fields (postCounts, texts, token arrays), so baseline diffs
 * stay readable and deliberate.
 *
 * Ratchet contract (exit 1 = regression, the M3 gate):
 *   - a scenario DISAPPEARS from its runner's matrix;
 *   - any verdict lands in the red class (DIVERGENT / CONTENT_DIVERGENT /
 *     FAILED) when the baseline was not already red - deliberately-red rows
 *     (triaged engine findings such as L2 s6/s12) stay red without failing,
 *     but MUST NOT spread;
 *   - a KD id shows up that the baseline lacks for that scenario (covers
 *     MATCH -> KNOWN_DIFF and KNOWN_DIFF gaining ids) - the KD table's
 *     reported-never-hidden contract means a new stable difference needs a
 *     triaged KNOWN_DIVERGENCES entry AND an explicit `--update` to pass;
 *   - a scenario acquires an engineFinding flag it did not have (a new
 *     suspected OUR-engine gap is a loss of green, same principle);
 *   - a gated verdict degrades to an ungated one (OFFICIAL-ARM-UNAVAILABLE /
 *     single-arm / DEMOTED-SINGLE-ARM): the ratchet cannot confirm green
 *     survived, so it fails loud instead of silently shrinking coverage.
 *
 * Improvements (new scenarios, newly-green verdicts, dropped KD ids, cleared
 * engine findings) pass with a nudge to lock them in via `--update`, which
 * rewrites baseline.json from the current matrices (sorted keys, stable
 * diff). Runners absent from the supplied matrices keep their existing
 * baseline entries on --update (partial re-runs never drop sibling runners).
 *
 * Usage:
 *   node tests/conformance/ratchet.mjs [--update] [--baseline=path] [matrix.json ...]
 *   (no matrix paths = the four standard ones at the package root)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertContentBlind } from './emulator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE = join(HERE, 'baseline.json');
const DEFAULT_MATRICES = [
  'conformance-l1.json',
  'conformance-l2.json',
  'conformance-l3.json',
  'conformance-l4.json',
].map((name) => join(HERE, '..', '..', name));

/**
 * Verdict classes drive the ratchet direction. Every verdict string any
 * runner emits today is listed; an UNKNOWN verdict deliberately classifies as
 * red - a runner inventing a new verdict must not slip past the gate.
 */
const VERDICT_CLASS = {
  MATCH: 'green',
  CONTENT_MATCH: 'green',
  LOCKED: 'green',
  FAULT_MATCH: 'green',
  MATCH_WITH_KNOWN_DIFFS: 'known',
  CONTENT_KNOWN_DIFF: 'known',
  FAULT_KNOWN_DIFF: 'known',
  DIVERGENT: 'red',
  CONTENT_DIVERGENT: 'red',
  FAULT_DIVERGENT: 'red',
  FAILED: 'red',
  'single-arm': 'ungated',
  'OFFICIAL-ARM-UNAVAILABLE': 'ungated',
  'DEMOTED-SINGLE-ARM': 'ungated',
};

export function classOf(verdict) {
  return VERDICT_CLASS[verdict] ?? 'red';
}

/** Map a matrix to its baseline runner key (l1/l2/l3/l4). */
export function runnerKeyOf(matrix) {
  const m = /conformance (L\d+)\b/i.exec(matrix?.generated_for ?? '');
  if (!m) {
    throw new Error(
      `cannot derive runner key from generated_for=${JSON.stringify(matrix?.generated_for)}`,
    );
  }
  return m[1].toLowerCase();
}

/**
 * Reduce one runner matrix to its scoreboard entries. Handles all four
 * emitted shapes: L1 (compare-only rows), L2 (compare rows + demotions +
 * report-level engineFindings / row-level engineFindingRef), L3 (row-level
 * verdict + kdHits + singleArmLocks), L4 (rows under `cases`, KD-L4 ids in
 * kdHits AND scoped/generic ids in compare.knownDiffs - the union is the
 * row's full KD set, matching the runner's printed table). Volatile fields
 * are dropped here by construction - only the triple survives.
 */
export function extractEntries(matrix) {
  const entries = {};
  const findingIds = new Set((matrix.engineFindings ?? []).map((f) => f.scenario));
  for (const row of matrix.scenarios ?? matrix.cases ?? []) {
    const verdict =
      row.verdict ??
      row.compare?.verdict ??
      (row.demoted
        ? 'DEMOTED-SINGLE-ARM'
        : row.official?.unavailable
          ? 'OFFICIAL-ARM-UNAVAILABLE'
          : 'single-arm');
    // Union, not first-wins: L4 splits its ids across the two fields, and a
    // KD id silently invisible to the ratchet would defeat the new-KD gate.
    const kdIds = [...new Set([...(row.kdHits ?? []), ...(row.compare?.knownDiffs ?? [])])].sort();
    entries[row.id] = {
      verdict,
      kdIds,
      engineFinding: findingIds.has(row.id) || Boolean(row.engineFindingRef),
    };
  }
  // L3 single-arm locks are scoreboard rows too: LOCKED is green, FAILED red.
  for (const row of matrix.singleArmLocks ?? []) {
    entries[row.id] = { verdict: row.verdict, kdIds: [], engineFinding: false };
  }
  return entries;
}

/**
 * Compare one runner's current entries against its baseline entries.
 * Returns { regressions, improvements } - each item { id, kind, detail }.
 * A row can contribute to both lists (e.g. swapped KD ids); any regression
 * anywhere fails the run, improvements alone only print the --update nudge.
 */
export function compareRunner(baselineEntries, currentEntries) {
  const regressions = [];
  const improvements = [];

  for (const id of Object.keys(baselineEntries ?? {})) {
    if (!(id in currentEntries)) {
      regressions.push({ id, kind: 'scenario-disappeared', detail: `baseline verdict was ${baselineEntries[id].verdict}` });
    }
  }

  for (const [id, cur] of Object.entries(currentEntries)) {
    const base = baselineEntries?.[id];
    if (!base) {
      improvements.push({ id, kind: 'new-scenario', detail: `verdict ${cur.verdict}` });
      continue;
    }
    const baseClass = classOf(base.verdict);
    const curClass = classOf(cur.verdict);
    const newKds = cur.kdIds.filter((k) => !base.kdIds.includes(k));
    const droppedKds = base.kdIds.filter((k) => !cur.kdIds.includes(k));

    if (curClass === 'red' && baseClass !== 'red') {
      regressions.push({ id, kind: 'verdict-regressed', detail: `${base.verdict} -> ${cur.verdict}` });
    } else if (curClass === 'ungated' && baseClass !== 'ungated') {
      regressions.push({ id, kind: 'coverage-lost', detail: `${base.verdict} -> ${cur.verdict} (gated verdict became ungated)` });
    }
    if (newKds.length > 0) {
      regressions.push({ id, kind: 'new-kd-ids', detail: `unlisted in baseline: ${newKds.join(' ')}` });
    }
    if (cur.engineFinding && !base.engineFinding) {
      regressions.push({ id, kind: 'new-engine-finding', detail: 'scenario acquired an engineFinding flag' });
    }

    if (curClass === 'green' && baseClass !== 'green') {
      improvements.push({ id, kind: 'verdict-improved', detail: `${base.verdict} -> ${cur.verdict}` });
    } else if (baseClass === 'red' && curClass === 'known') {
      improvements.push({ id, kind: 'verdict-improved', detail: `${base.verdict} -> ${cur.verdict}` });
    }
    if (droppedKds.length > 0 && newKds.length === 0) {
      improvements.push({ id, kind: 'kd-ids-dropped', detail: droppedKds.join(' ') });
    }
    if (base.engineFinding && !cur.engineFinding) {
      improvements.push({ id, kind: 'engine-finding-cleared', detail: '' });
    }
  }

  return { regressions, improvements };
}

/**
 * Build the runners map from parsed matrices, merged over a previous
 * baseline's runners so a partial re-run (say, l1 only) never drops l2/l3.
 */
export function buildRunners(matrices, previousRunners = {}) {
  const runners = { ...previousRunners };
  for (const matrix of matrices) {
    runners[runnerKeyOf(matrix)] = extractEntries(matrix);
  }
  return runners;
}

/**
 * Deterministic serialization: runner keys and scenario ids sorted, entry
 * fields in fixed order - reruns over identical results are byte-identical,
 * so every baseline diff in review is a real scoreboard change.
 */
export function serializeBaseline(runners) {
  const out = {
    generated_for: 'bpt-agent-sdk conformance ratchet baseline (M3: green only grows)',
    note: 'Per-runner per-scenario scoreboard: verdict + sorted KD ids + engineFinding flag only - no volatile fields. Rewrite via: node tests/conformance/ratchet.mjs --update',
    runners: {},
  };
  for (const key of Object.keys(runners).sort()) {
    const entries = {};
    for (const id of Object.keys(runners[key]).sort()) {
      const e = runners[key][id];
      entries[id] = {
        verdict: e.verdict,
        kdIds: [...e.kdIds].sort(),
        engineFinding: Boolean(e.engineFinding),
      };
    }
    out.runners[key] = entries;
  }
  return JSON.stringify(out, null, 2) + '\n';
}

function loadJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function main(argv) {
  const flags = {};
  const paths = [];
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] ?? true;
    else paths.push(a);
  }
  const baselinePath = typeof flags.baseline === 'string' ? flags.baseline : DEFAULT_BASELINE;
  const matrixPaths = paths.length > 0 ? paths : DEFAULT_MATRICES;

  const matrices = matrixPaths.map((p) => loadJson(p, 'matrix'));

  // Review finding: a supplied matrix that reduces to ZERO entries is
  // coverage loss (crashed runner -> empty artifact), never a pass.
  for (let i = 0; i < matrices.length; i++) {
    if (Object.keys(extractEntries(matrices[i])).length === 0) {
      console.error(`ratchet: matrix ${matrixPaths[i]} yields ZERO scoreboard entries - refusing (crashed/empty runner artifact?)`);
      return 1;
    }
  }

  if (flags.update) {
    const previous = existsSync(baselinePath) ? loadJson(baselinePath, 'baseline').runners ?? {} : {};
    // Review finding: --update must never lock a regression in SILENTLY.
    // Compare first and shout about every red being baselined; the write
    // still happens (updating is an explicit human act) but the record is loud.
    if (existsSync(baselinePath)) {
      const prevBaseline = loadJson(baselinePath, 'baseline');
      for (const matrix of matrices) {
        const key = runnerKeyOf(matrix);
        const { regressions } = compareRunner(prevBaseline.runners?.[key] ?? {}, extractEntries(matrix));
        for (const r of regressions) {
          console.warn(`ratchet: RED-LOCK WARNING [${key}] baselining a regression: ${JSON.stringify(r)}`);
        }
      }
    }
    const serialized = serializeBaseline(buildRunners(matrices, previous));
    // Same standing-decision self-audit as the runners: the baseline is a
    // committed artifact and must never carry request-body-derived content.
    assertContentBlind(serialized);
    writeFileSync(baselinePath, serialized);
    console.log(`ratchet: baseline rewritten from ${matrices.length} matrix file(s) -> ${baselinePath}`);
    console.log('content-blind self-audit: PASS');
    return 0;
  }

  if (!existsSync(baselinePath)) {
    console.error(`ratchet: no baseline at ${baselinePath} - generate one with --update after a full runner pass`);
    return 1;
  }
  const baseline = loadJson(baselinePath, 'baseline');

  const allRegressions = [];
  const allImprovements = [];
  const seenRunners = new Set();
  for (const matrix of matrices) {
    const key = runnerKeyOf(matrix);
    seenRunners.add(key);
    const { regressions, improvements } = compareRunner(baseline.runners?.[key] ?? {}, extractEntries(matrix));
    for (const r of regressions) allRegressions.push({ runner: key, ...r });
    for (const i of improvements) allImprovements.push({ runner: key, ...i });
  }
  for (const key of Object.keys(baseline.runners ?? {})) {
    if (!seenRunners.has(key)) {
      console.log(`ratchet: runner ${key} not supplied this run - baseline entries retained, not checked`);
    }
  }

  console.log('\n| runner | change | scenario | detail |');
  console.log('|---|---|---|---|');
  for (const r of allRegressions) console.log(`| ${r.runner} | REGRESSION ${r.kind} | ${r.id} | ${r.detail} |`);
  for (const i of allImprovements) console.log(`| ${i.runner} | improvement ${i.kind} | ${i.id} | ${i.detail} |`);
  if (allRegressions.length === 0 && allImprovements.length === 0) {
    console.log('| - | none | - | scoreboard identical to baseline |');
  }

  if (allRegressions.length > 0) {
    console.error(`\nratchet: FAIL - ${allRegressions.length} regression(s) against ${baselinePath} (green only grows)`);
    return 1;
  }
  if (allImprovements.length > 0) {
    console.log(`\nratchet: improvements - run with --update to lock them in`);
  }
  console.log('ratchet: PASS');
  return 0;
}

// CLI entry - guarded so the vitest lock can import the pure functions.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let code = 1;
  try {
    code = main(process.argv.slice(2));
  } catch (err) {
    console.error(`ratchet: ${err?.message ?? err}`);
  }
  process.exit(code);
}
