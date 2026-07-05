/**
 * L4 fault-injection differential runner (conformance suite M3, B1).
 *
 * Mirrors run-l2.mjs: a LOCAL arm driver instead of ./arm.mjs (L4 needs
 * per-scenario timeoutMs where the timeout can BE the injected fault,
 * captured file bytes, and assistant-text sentinel probes) - deliberate
 * duplication over a shared-file merge conflict, same as the L2 rationale.
 *
 * Usage:
 *   node tests/conformance/run-l4.mjs [--arm=both|bpt|official] [--out=path.json]
 *
 * Prereqs: dist/ built (bpt arm); official packages installed transiently
 * per tests/conformance/pins.json (`npm i --no-save`, never a repo dep).
 *
 * Divergence policy (M3): the arm-neutral invariants in scenarios-l4.mjs are
 * the hard deciders - a failure on the BPT arm is our regression (exit 1), a
 * failure on the official arm is a differential finding (reported). Stable
 * behavioral splits confirmed across 2 runs live in the KD_L4 table below
 * (same reported-never-hidden contract as KNOWN_DIVERGENCES); stream-token
 * splits live as SCOPED entries in normalize.mjs KNOWN_DIVERGENCES. Suspected
 * OUR-engine gaps (scenario.engineFindingIf) go to engineFindings - kept red,
 * never behind a KD. Anything unlisted lands in kdCandidates for triage.
 *
 * Exit semantics (same as run-l1/l2/l3): BPT-arm check failure exits 1,
 * divergence informational, content-blind self-audit closes the run.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmulator, assertContentBlind } from './emulator.mjs';
import { normalizeStream, compareStreams, KNOWN_DIVERGENCES } from './normalize.mjs';
import { extractToolResults } from './arm.mjs';
import { SCENARIOS_L4, streamHas } from './scenarios-l4.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DUMMY_KEY = 'sk-ant-api03-' + 'A'.repeat(95);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const armMode = args.arm ?? 'both';
const outPath = typeof args.out === 'string' ? args.out : join(HERE, '..', '..', 'conformance-l4.json');

/**
 * L4-specific behavioral known divergences - facet-level splits between the
 * arms under injected faults, each observed stable across 2 differential
 * runs (2026-07-05, agent-sdk 0.3.199 + claude-code 2.1.201). Same contract
 * as KNOWN_DIVERGENCES: every consumption is REPORTED in the row's kdHits,
 * never hidden; an entry scopes to specific scenarios and facet keys so it
 * can never excuse a drift elsewhere. `coversTokens: true` additionally
 * claims that scenario's stream-token divergence (the token tail differs
 * BECAUSE the terminal encoding differs - one root cause, one KD).
 */
export const KD_L4 = [
  {
    id: 'KD-L4-01',
    scenarios: ['l4-http400-non-retryable', 'l4-script-exhausted-400-terminal'],
    facets: ['resultSubtype', 'errorPresent'],
    coversTokens: true,
    note:
      'non-retryable 400 terminal ENCODING (identical at first-POST and mid-session position): ' +
      'this SDK wraps the transport APIStatusError(400) into a clean result/error_during_execution ' +
      '(no throw); the official arm surfaces "API Error: 400 ..." AS ASSISTANT TEXT, ends ' +
      'result/SUCCESS, and then its iterator throws the KD-10-shaped "Claude Code returned an ' +
      'error result: API Error: 400 ..." - a success-subtype result over a failed session (the ' +
      'spike-S4 quirk generalized to HTTP-level 400s). The no-retry invariant (POST count / ' +
      'unscriptedCalls) holds identically on both arms; the official arm\'s arm-neutral ' +
      '"non-success terminal" invariant miss is routed here via officialInvariantKd, with the ' +
      'failure text kept visible in its row.',
  },
  {
    id: 'KD-L4-02',
    scenarios: ['l4-sse-truncated-text-turn'],
    facets: ['errorPresent'],
    coversTokens: true,
    note:
      'TEXT-turn truncation (terminator missing after complete text blocks): NEITHER arm retries ' +
      '(1 POST both) and since E3 (2026-07-05) BOTH arms keep the partial text and end ' +
      'result/success - resultSubtype and sentinels converged, the former engineFinding is ' +
      'cleared. Residual split is the ERROR CHANNEL only: the official arm appends the ' +
      'connection error as a second assistant message and then throws "API Error: Connection ' +
      'closed mid-response" from the iterator (spike-S4 quirk); this SDK reports it as a ' +
      'non-fatal note in result.errors and ends cleanly (deliberate - no fabricated assistant ' +
      'message, no post-result throw).',
  },
  {
    id: 'KD-L4-03',
    scenarios: ['l4-hang-then-client-abort'],
    facets: [],
    coversTokens: false,
    note:
      'documentation-only (facet-inert): caller-abort on a hung stream is SYMMETRIC on every ' +
      'facet (1 POST, no result message, error thrown from the iterator on both arms) - only the ' +
      'error STRING differs by design: ours "The operation was aborted" (AbortError via ' +
      'mapStreamError callerSignal branch) vs official "Claude Code process aborted by user". ' +
      'Error strings are recorded per arm in the rows and deliberately not facet-compared.',
  },
  // KD-L4-04 RETIRED (2026-07-05, E3): both arms now treat a truncated turn's
  // COMPLETE tool_use blocks as actionable (execute, 2nd POST for the
  // tool_result, result/success) at either cut depth - every facet converged
  // in the dual-arm run, the engineFinding cleared. Id kept out of circulation.
];

async function loadQuery(armKind) {
  if (armKind === 'bpt') {
    const mod = await import('../../dist/index.js');
    return mod.query;
  }
  const mod = await import('@anthropic-ai/claude-agent-sdk');
  return mod.query;
}

function baseEnv(emulatorUrl) {
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: emulatorUrl,
    ANTHROPIC_API_KEY: DUMMY_KEY,
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_MODEL: '',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
  };
  // Scrub inherited session identity (same adversarial-review rationale as
  // run-l2): the host process may itself run under Claude Code.
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_SSE_PORT;
  delete env.CLAUDECODE;
  return env;
}

/** Plain text of every assistant message on the PUBLIC stream, in order. */
function assistantTextsOf(messages) {
  const out = [];
  for (const m of messages) {
    if (m?.type !== 'assistant') continue;
    const content = Array.isArray(m.message?.content) ? m.message.content : [];
    for (const b of content) {
      if (b?.type === 'text' && typeof b.text === 'string') out.push(b.text);
    }
  }
  return out;
}

/**
 * Local single-query driver. Differences vs arm.mjs runScenario: scenario
 * timeoutMs drives the AbortController (in l4-hang-then-client-abort that
 * abort IS the fault under test), captureFiles bytes are read before
 * cleanup, and assistant texts are extracted for sentinel probes. Raw
 * messages stay in memory - only derived observables are serialized.
 */
async function runL4Scenario(armKind, scenario) {
  const query = await loadQuery(armKind);
  const cwd = mkdtempSync(join(tmpdir(), `conf-l4-${armKind}-`));
  for (const [name, content] of Object.entries(scenario.fixtureFiles ?? {})) {
    writeFileSync(join(cwd, name), content);
  }
  const emulator = await startEmulator(scenario.buildScripts(cwd));

  const messages = [];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), scenario.timeoutMs);
  let error;
  const files = {};
  try {
    const q = query({
      prompt: scenario.prompt,
      options: {
        abortController: ac,
        cwd,
        maxTurns: scenario.maxTurns ?? 4,
        env: baseEnv(emulator.url),
        ...(armKind === 'bpt' ? { sessionDir: join(cwd, '.sessions') } : {}),
        ...(scenario.options ?? {}),
      },
    });
    for await (const m of q) messages.push(m);
  } catch (err) {
    error = String(err?.message ?? err).slice(0, 300);
  } finally {
    clearTimeout(timer);
    await emulator.close();
    // Side-effect capture BEFORE cleanup, error or not - a half-run's file
    // state is still evidence (did a terminator-less turn execute its tool?).
    for (const rel of scenario.captureFiles ?? []) {
      try {
        files[rel] = readFileSync(join(cwd, rel), 'utf8');
      } catch {
        files[rel] = null;
      }
    }
    rmSync(cwd, { recursive: true, force: true });
  }

  const normalized = normalizeStream(messages);
  const resultMsg = messages.filter((m) => m?.type === 'result').pop();
  return {
    arm: armKind,
    scenario: scenario.id,
    error,
    ...normalized,
    // Non-fatal error notes on the terminal result (E3 truncation notes ride
    // here on the BPT arm). Recorded per arm, deliberately NOT facet-compared.
    resultErrors: Array.isArray(resultMsg?.errors) ? resultMsg.errors : null,
    toolResults: extractToolResults(messages),
    assistantTexts: assistantTextsOf(messages),
    files,
    postCount: emulator.profile.requests.filter((r) => r === 'POST /v1/messages').length,
    unscriptedCalls: emulator.profile.unscriptedCalls,
    emulatorProfile: {
      requests: emulator.profile.requests,
      otherEndpoints: emulator.profile.otherEndpoints,
      unscriptedCalls: emulator.profile.unscriptedCalls,
    },
  };
}

/** Arm-neutral facet snapshot - the cross-compared observables. */
function facetsOf(scenario, run) {
  return {
    postCount: run.postCount,
    unscriptedCalls: run.unscriptedCalls,
    resultSubtype: run.checks.resultSubtype,
    toolResults: run.toolResults.length,
    errorPresent: run.error != null,
    files: run.files,
    sentinels: Object.fromEntries((scenario.sentinels ?? []).map((s) => [s, streamHas(run, s)])),
  };
}

/** Facet keys whose values differ between the arms (files/sentinels flattened). */
function diffFacets(a, b) {
  const keys = ['postCount', 'unscriptedCalls', 'resultSubtype', 'toolResults', 'errorPresent'];
  const out = keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  for (const sub of ['files', 'sentinels']) {
    const names = new Set([...Object.keys(a[sub]), ...Object.keys(b[sub])]);
    for (const n of names) {
      if (JSON.stringify(a[sub][n]) !== JSON.stringify(b[sub][n])) out.push(sub);
    }
  }
  return [...new Set(out)];
}

/** KD_L4 entry covering (scenario, facet key), if any. */
function kdL4For(scenarioId, facetKey) {
  return KD_L4.find((d) => d.scenarios.includes(scenarioId) && d.facets.includes(facetKey));
}

/** Report row per arm - raw messages/assistant texts stay in memory. */
function armRow(run, failures) {
  return {
    tokens: run.tokens,
    checks: run.checks,
    postCount: run.postCount,
    unscriptedCalls: run.unscriptedCalls,
    toolResults: run.toolResults.length,
    files: run.files,
    error: run.error,
    checkFailures: failures,
  };
}

const pins = JSON.parse(readFileSync(join(HERE, 'pins.json'), 'utf8'));
const report = {
  generated_for: 'bpt-agent-sdk conformance L4 (fault-injection differential)',
  pins: { agentSdk: pins.agentSdk, claudeCode: pins.claudeCode },
  armMode,
  cases: [],
  kdCandidates: [],
  engineFindings: [],
  kdL4Table: KD_L4,
  knownDivergenceTable: KNOWN_DIVERGENCES,
};

let bptCheckFailures = 0;
let divergent = 0;

for (const scenario of SCENARIOS_L4) {
  const row = { id: scenario.id, fault: scenario.fault };
  if (scenario.notes) row.notes = scenario.notes;

  let bpt;
  if (armMode !== 'official') {
    bpt = await runL4Scenario('bpt', scenario);
    const failures = [
      ...scenario.invariants(bpt),
      ...(scenario.bptOnly ? scenario.bptOnly(bpt) : []),
    ];
    row.bpt = armRow(bpt, failures);
    bptCheckFailures += failures.length;
  }

  let official;
  if (armMode !== 'bpt') {
    try {
      official = await runL4Scenario('official', scenario);
      // Arm-neutral invariants only - bptOnly locks are OUR transport
      // contract, never applied to the official engine.
      const failures = scenario.invariants(official);
      row.official = armRow(official, failures);
      if (failures.length > 0) {
        // A scenario may pre-triage a STABLE official-arm invariant miss
        // into a KD_L4 id (e.g. the success-subtype-after-400 quirk). The
        // failure text stays visible in row.official.checkFailures and the
        // KD lands in kdHits - reported, never hidden; anything not
        // pre-triaged remains an untriaged kdCandidate.
        const kd = scenario.officialInvariantKd
          ? KD_L4.find((d) => d.id === scenario.officialInvariantKd && d.scenarios.includes(scenario.id))
          : undefined;
        if (kd) {
          row.officialInvariantKd = kd.id;
        } else {
          report.kdCandidates.push({
            scenario: scenario.id,
            kind: 'official-invariant',
            note: 'official arm fails an arm-neutral fault invariant - differential finding, triage into a KD or an official-engine bug report',
            failures,
          });
        }
      }
    } catch (err) {
      row.official = { unavailable: String(err?.message ?? err).slice(0, 200) };
      official = undefined;
    }
  }

  if (bpt && official) {
    const bptFacets = facetsOf(scenario, bpt);
    const offFacets = facetsOf(scenario, official);
    row.facets = { bpt: bptFacets, official: offFacets };

    const kdHits = new Set();
    if (row.officialInvariantKd) kdHits.add(row.officialInvariantKd);
    const unlisted = [];

    // Directional triage first: an our-arm degradation official survives is
    // an engine finding (red, reported) regardless of any KD coverage.
    const finding = scenario.engineFindingIf?.(bptFacets, offFacets) ?? null;
    if (finding) {
      report.engineFindings.push({ scenario: scenario.id, kind: 'fault-degradation', note: finding });
      row.engineFinding = finding;
    }

    for (const key of diffFacets(bptFacets, offFacets)) {
      const kd = kdL4For(scenario.id, key);
      if (kd) kdHits.add(kd.id);
      else unlisted.push(key);
    }
    if (unlisted.length > 0) {
      report.kdCandidates.push({
        scenario: scenario.id,
        kind: 'facet-divergence',
        facets: unlisted,
        note: 'unlisted fault-behavior facet difference (never hidden) - triage into KD_L4 after 2-run stability',
        bpt: Object.fromEntries(unlisted.map((k) => [k, bptFacets[k]])),
        official: Object.fromEntries(unlisted.map((k) => [k, offFacets[k]])),
      });
    }

    // Stream-token comparison under the shared allowlist (retry-notification
    // splits are scoped KNOWN_DIVERGENCES entries). A DIVERGENT tail caused
    // by a documented terminal-encoding KD (coversTokens) is claimed by that
    // KD - divergence detail stays visible in the row either way.
    row.compare = compareStreams(official.tokens, bpt.tokens, { scenario: scenario.id });
    if (row.compare.verdict === 'DIVERGENT') {
      const tokenKd = KD_L4.find((d) => d.scenarios.includes(scenario.id) && d.coversTokens);
      if (tokenKd) {
        kdHits.add(tokenKd.id);
        row.compare.claimedBy = tokenKd.id;
      } else {
        report.kdCandidates.push({
          scenario: scenario.id,
          kind: 'stream-divergence',
          divergences: row.compare.divergences,
          officialTokens: official.tokens,
          bptTokens: bpt.tokens,
          note: 'unlisted token difference under fault (never hidden) - triage into scoped KNOWN_DIVERGENCES or KD_L4',
        });
      }
    }

    row.kdHits = [...kdHits].sort();
    const unclaimedTokens = row.compare.verdict === 'DIVERGENT' && !row.compare.claimedBy;
    row.verdict =
      unlisted.length > 0 || unclaimedTokens
        ? 'FAULT_DIVERGENT'
        : kdHits.size > 0 || row.compare.verdict === 'MATCH_WITH_KNOWN_DIFFS'
          ? 'FAULT_KNOWN_DIFF'
          : 'FAULT_MATCH';
    if (row.verdict === 'FAULT_DIVERGENT') divergent += 1;
  } else {
    row.verdict = row.official?.unavailable ? 'OFFICIAL-ARM-UNAVAILABLE' : 'single-arm';
  }

  report.cases.push(row);
  console.log(
    `[${scenario.id}] ${row.verdict}` +
      (row.kdHits?.length ? ` | KD: ${row.kdHits.join(' ')}` : '') +
      (row.engineFinding ? ' | ENGINE FINDING' : '') +
      (row.bpt?.checkFailures?.length ? ` | BPT CHECK FAIL: ${row.bpt.checkFailures.join('; ')}` : '') +
      (row.official?.checkFailures?.length ? ` | official invariant: ${row.official.checkFailures.join('; ')}` : ''),
  );
}

// Mandatory self-audit before the artifact leaves the process (standing
// decision clause 2): no request-body-derived content in the report.
const serialized = JSON.stringify(report, null, 2);
assertContentBlind(serialized);
writeFileSync(outPath, serialized);

console.log('\n| case | verdict | known diffs | bpt fails | official fails |');
console.log('|---|---|---|---|---|');
for (const row of report.cases) {
  console.log(
    `| ${row.id} | ${row.verdict} | ${[...(row.kdHits ?? []), ...(row.compare?.knownDiffs ?? [])].join(' ')} | ${row.bpt?.checkFailures?.length ?? ''} | ${row.official?.checkFailures?.length ?? ''} |`,
  );
}
console.log(
  `\nkdCandidates: ${report.kdCandidates.length} (untriaged), engineFindings: ${report.engineFindings.length} (kept red, not KDs)`,
);
console.log(`report: ${outPath}`);
console.log('content-blind self-audit: PASS');

if (bptCheckFailures > 0) {
  console.error(`\nFAIL: ${bptCheckFailures} check failure(s) on the BPT arm (engine regression independent of the official arm)`);
  process.exit(1);
}
if (divergent > 0) {
  console.error(`\nINFO (M3 pre-ratchet, not gating): ${divergent} FAULT_DIVERGENT case(s) - see kdCandidates/engineFindings in the report`);
}
process.exit(0);
