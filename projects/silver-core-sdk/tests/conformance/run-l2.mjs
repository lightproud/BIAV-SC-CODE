/**
 * L2 options-semantics differential runner (conformance suite M2).
 *
 * Mirrors run-l1.mjs, but with a LOCAL arm driver instead of ./arm.mjs:
 * L2 scenarios need per-scenario Options (runScenario does not take them),
 * filesystem probes BEFORE cwd cleanup, host-side callback recorders
 * (canUseTool / hooks), a message-receipt interrupt driver, and a custom
 * two-query resume flow. Copying the small driver here keeps arm.mjs (owned
 * by the L3 workstream) untouched - deliberate duplication over a shared-
 * file merge conflict.
 *
 * Usage:
 *   node tests/conformance/run-l2.mjs [--arm=both|bpt|official] [--out=path.json]
 *
 * Prereqs: dist/ built (bpt arm); official packages installed transiently
 * per tests/conformance/pins.json (`npm i --no-save`, never a repo dep).
 *
 * Divergence policy (M2, post-triage): triaged stable differences live in
 * KNOWN_DIVERGENCES (normalize.mjs) as KD-06..KD-11 and are consumed +
 * reported by the comparator (KD-07/KD-09 scenario-scoped, KD-10 recorded
 * as terminalShape below). Novel differences are never allowlisted here -
 * they surface as DIVERGENT verdicts and are collected under `kdCandidates`
 * for the next triage. Two rows stay deliberately red as ENGINE FINDINGS,
 * not KDs (never papered over): s6 (this SDK enforces the
 * allowDangerouslySkipPermissions interlock, official 0.3.199/2.1.201 does
 * not) and s12 (this SDK executes the in-flight turn's tool before tripping
 * maxBudgetUsd, official trips before executing). Droppable scenarios
 * (mapping-agent risk notes) whose OFFICIAL arm misbehaves demote to a
 * single-arm lock with the measured evidence kept.
 *
 * Exit semantics (same as run-l1): a check failure on the BPT arm is a
 * regression in OUR engine -> exit 1; divergences stay informational until
 * the M3 ratchet.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmulator, assertContentBlind } from './emulator.mjs';
import { normalizeStream, compareStreams, KNOWN_DIVERGENCES } from './normalize.mjs';
import { SCENARIOS_L2, initOf, resultOf } from './scenarios-l2.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DUMMY_KEY = 'sk-ant-api03-' + 'A'.repeat(95);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const armMode = args.arm ?? 'both';
const outPath = typeof args.out === 'string' ? args.out : join(HERE, '..', '..', 'conformance-l2.json');

async function loadQuery(armKind) {
  if (armKind === 'bpt') {
    const mod = await import('../../dist/index.js');
    return mod.query;
  }
  const mod = await import('@anthropic-ai/claude-agent-sdk');
  return mod.query;
}

function baseEnv(emulatorUrl, overrides = {}) {
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
  // The host process may itself be running under Claude Code; an inherited
  // session identity would let the official CLI adopt it and turn the
  // s14-resume continuity decider into a false positive (adversarial-review
  // finding, 2026-07-05). Scrub every session-identity var before overrides.
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_SSE_PORT;
  delete env.CLAUDECODE;
  return { ...env, ...overrides };
}

function countPosts(profile) {
  return profile.requests.filter((r) => r === 'POST /v1/messages').length;
}

/** Snapshot probe files (content or null) BEFORE the cwd is removed. */
function probeFs(cwd, names) {
  const fs = {};
  for (const name of names ?? []) {
    const p = join(cwd, name);
    fs[name] = existsSync(p) ? readFileSync(p, 'utf8') : null;
  }
  return fs;
}

/**
 * Local single-query driver. Differences vs arm.mjs runScenario:
 * scenario options merged into the query, fs probed pre-cleanup, host
 * recorder threaded into callbacks, optional interrupt-on-first-assistant
 * consumer behavior.
 */
async function runL2Scenario(armKind, scenario, { timeoutMs = 120_000 } = {}) {
  const query = await loadQuery(armKind);
  const cwd = mkdtempSync(join(tmpdir(), `conf-l2-${armKind}-`));
  for (const [name, content] of Object.entries(scenario.fixtureFiles ?? {})) {
    writeFileSync(join(cwd, name), content);
  }
  const scripts = scenario.buildScripts(cwd, armKind);
  const emulator = await startEmulator(scripts);

  const host = { canUseTool: [], hookCalls: [] };
  const options = {
    cwd,
    maxTurns: 4,
    env: baseEnv(emulator.url, scenario.env ?? {}),
    ...(armKind === 'bpt' ? { sessionDir: join(cwd, '.sessions') } : {}),
    ...(scenario.options ?? {}),
    ...(scenario.makeOptions ? scenario.makeOptions({ cwd, host }) : {}),
  };

  const messages = [];
  const ac = new AbortController();
  options.abortController = ac;
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let error;
  let interrupted = false;
  try {
    const q = query({ prompt: scenario.prompt, options });
    for await (const m of q) {
      messages.push(m);
      if (scenario.driver === 'interrupt-on-first-assistant' && m.type === 'assistant' && !interrupted) {
        interrupted = true;
        // Fire-and-forget: awaiting inside the consumer loop could deadlock
        // an engine that resolves the control response via this stream.
        Promise.resolve()
          .then(() => q.interrupt())
          .catch(() => ac.abort());
      }
    }
  } catch (err) {
    error = String(err?.message ?? err).slice(0, 300);
  } finally {
    clearTimeout(timer);
    await emulator.close();
  }

  const fs = probeFs(cwd, scenario.fsProbe);
  rmSync(cwd, { recursive: true, force: true });

  const normalized = normalizeStream(messages);
  return {
    arm: armKind,
    scenario: scenario.id,
    error,
    messages,
    host,
    fs,
    postCount: countPosts(emulator.profile),
    ...normalized,
    emulatorProfile: {
      requests: emulator.profile.requests,
      otherEndpoints: emulator.profile.otherEndpoints,
      unscriptedCalls: emulator.profile.unscriptedCalls,
    },
  };
}

/**
 * Custom two-query resume driver (S14). One emulator serves both queries in
 * arrival order; the official arm gets HOME=mkdtemp so the CLI session
 * store stays inside the sandbox. Continuity is judged purely on the public
 * stream (session_id fields) plus the wire POST count.
 */
async function runResumeScenario(armKind, scenario, { timeoutMs = 120_000 } = {}) {
  const query = await loadQuery(armKind);
  const cwd = mkdtempSync(join(tmpdir(), `conf-l2-${armKind}-`));
  const home = armKind === 'official' ? mkdtempSync(join(tmpdir(), 'conf-l2-home-')) : null;
  const emulator = await startEmulator(scenario.buildScripts(cwd, armKind));
  const env = baseEnv(emulator.url, { ...(scenario.env ?? {}), ...(home ? { HOME: home } : {}) });

  const runOne = async (prompt, extra) => {
    const messages = [];
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let error;
    try {
      const q = query({
        prompt,
        options: {
          abortController: ac,
          cwd,
          maxTurns: 4,
          env,
          ...(armKind === 'bpt' ? { sessionDir: join(cwd, '.sessions') } : {}),
          ...extra,
        },
      });
      for await (const m of q) messages.push(m);
    } catch (err) {
      error = String(err?.message ?? err).slice(0, 300);
    } finally {
      clearTimeout(timer);
    }
    return { messages, error };
  };

  let q1;
  let q2;
  try {
    q1 = await runOne(scenario.prompts[0], {});
    const resumedId = initOf(q1.messages)?.session_id ?? resultOf(q1.messages)?.session_id ?? null;
    q2 = await runOne(scenario.prompts[1], resumedId ? { resume: resumedId } : {});
    const normalized = normalizeStream(q2.messages);
    // Storage-level continuity proof for the BPT arm (adversarial-review
    // finding: our engine adopts a requested session id even when nothing is
    // loaded, so `q2SessionId === resumedId` alone cannot fail). Resuming
    // appends Q2 into the SAME `{sessionId}.jsonl` transcript, so after Q2
    // the resumed file must carry BOTH turns' content. null on the official
    // arm (its store is not ours to read - stream-level decider only).
    let transcriptBoth = null;
    if (armKind === 'bpt' && resumedId) {
      try {
        const text = readFileSync(join(cwd, '.sessions', `${resumedId}.jsonl`), 'utf8');
        transcriptBoth = text.includes('FIRST') && text.includes('SECOND');
      } catch {
        transcriptBoth = false;
      }
    }
    const resume = {
      resumedId,
      q1Text: typeof resultOf(q1.messages)?.result === 'string' ? resultOf(q1.messages).result : null,
      q2Text: normalized.checks.resultText,
      q2SessionId: initOf(q2.messages)?.session_id ?? resultOf(q2.messages)?.session_id ?? null,
      postCount: countPosts(emulator.profile),
      transcriptBoth,
    };
    return {
      arm: armKind,
      scenario: scenario.id,
      error: q1.error ?? q2.error,
      messages: q2.messages,
      host: { canUseTool: [], hookCalls: [] },
      fs: {},
      postCount: resume.postCount,
      resume,
      ...normalized,
    };
  } finally {
    await emulator.close();
    rmSync(cwd, { recursive: true, force: true });
    if (home) rmSync(home, { recursive: true, force: true });
  }
}

/** Standard expectations - each key optional (undefined = not asserted). */
function checksVerdict(expected, checks) {
  const failures = [];
  if (!expected) return failures;
  if (expected.resultSubtype !== undefined && checks.resultSubtype !== expected.resultSubtype) {
    failures.push(`resultSubtype ${checks.resultSubtype} != ${expected.resultSubtype}`);
  }
  if (expected.resultText !== undefined && (checks.resultText === null || !checks.resultText.includes(expected.resultText))) {
    failures.push(`resultText missing "${expected.resultText}"`);
  }
  if (expected.toolResults !== undefined && checks.toolResults !== expected.toolResults) {
    failures.push(`toolResults ${checks.toolResults} != ${expected.toolResults}`);
  }
  return failures;
}

function evaluate(scenario, run, armKind) {
  const failures = [...checksVerdict(scenario.expect, run.checks)];
  if (scenario.check) failures.push(...scenario.check(run));
  if (scenario.checkResume && run.resume) failures.push(...scenario.checkResume(run.resume));
  // Arm-driver errors: on the BPT arm any throw during an expected-complete
  // run is our regression (this SDK ends every run with a result message).
  // The official SDK is KNOWN to throw AFTER yielding an error-subtype
  // result ("Claude Code returned an error result: ...", observed live on
  // s1/s12) - when its checks all pass, that throw is the KD-10 terminal
  // shape, recorded by the caller as terminalShape (reported, never hidden,
  // never a gate). S6/S10 (no `expect`) legitimately terminate via throw.
  if (run.error && scenario.expect && armKind === 'bpt') failures.push(`arm error: ${run.error}`);
  return failures;
}

/** Report row per arm - raw messages stay in memory, never serialized. */
function armRow(run, failures) {
  return {
    tokens: run.tokens,
    checks: run.checks,
    postCount: run.postCount,
    fsProbe: run.fs,
    host: { canUseTool: run.host.canUseTool, hookCalls: run.host.hookCalls.length },
    ...(run.resume ? { resume: run.resume } : {}),
    error: run.error,
    checkFailures: failures,
  };
}

const pins = JSON.parse(readFileSync(join(HERE, 'pins.json'), 'utf8'));
const report = {
  generated_for: 'silver-core-sdk conformance L2 (options semantics)',
  pins: { agentSdk: pins.agentSdk, claudeCode: pins.claudeCode },
  armMode,
  scenarios: [],
  kdCandidates: [],
  engineFindings: [],
  scenarioNotes: [],
  demotions: [],
  knownDivergenceTable: KNOWN_DIVERGENCES,
};

let bptCheckFailures = 0;
let divergent = 0;

for (const scenario of SCENARIOS_L2) {
  const row = { id: scenario.id, option: scenario.option };
  if (scenario.notes) row.notes = scenario.notes;
  const drive = scenario.kind === 'resume' ? runResumeScenario : runL2Scenario;

  if (armMode !== 'official') {
    const r = await drive('bpt', scenario);
    const failures = evaluate(scenario, r, 'bpt');
    row.bpt = armRow(r, failures);
    bptCheckFailures += failures.length;
  }
  if (armMode !== 'bpt') {
    try {
      const r = await drive('official', scenario);
      const failures = evaluate(scenario, r, 'official');
      row.official = armRow(r, failures);
      if (failures.length === 0 && r.error && scenario.expect) {
        // KD-10 terminal shape: the official iterator throws after yielding
        // the error-subtype result. Attribution requires the throw to MATCH
        // the documented KD-10 pattern (adversarial-review finding: a novel
        // official-arm throw must not ride the allowlist) - anything else
        // falls through to kdCandidates. If the table ever loses the entry
        // this also falls back to a kdCandidate.
        const terminalKd = KNOWN_DIVERGENCES.find((d) => d.terminal === true);
        if (terminalKd && /returned an error result/i.test(r.error)) {
          row.official.terminalShape = { kd: terminalKd.id, error: r.error };
        } else {
          report.kdCandidates.push({
            scenario: scenario.id,
            kind: 'terminal-shape',
            note: 'official SDK throws after yielding an error-subtype result; this SDK ends the stream cleanly - candidate KD-id',
            error: r.error,
          });
        }
      }
      if (failures.length > 0) {
        if (scenario.droppable) {
          row.demoted = `official arm failed a droppable scenario -> single-arm lock (evidence kept): ${failures.join('; ')}`;
          report.demotions.push({ scenario: scenario.id, reason: row.demoted });
        } else if (scenario.engineFinding) {
          report.engineFindings.push({
            scenario: scenario.id,
            kind: 'official-check',
            note: scenario.engineFinding,
            failures,
          });
        } else {
          report.kdCandidates.push({
            scenario: scenario.id,
            kind: 'official-check',
            note: 'official arm fails the shared semantic checks - engine difference, triage into a KD-id or a conformance bug',
            failures,
          });
        }
      }
    } catch (err) {
      row.official = { unavailable: String(err?.message ?? err).slice(0, 200) };
    }
  }

  if (row.bpt && row.official && !row.official.unavailable && !row.demoted) {
    row.compare = compareStreams(row.official.tokens, row.bpt.tokens, { scenario: scenario.id });
    if (row.compare.verdict === 'DIVERGENT') {
      divergent += 1;
      const payload = {
        scenario: scenario.id,
        kind: 'stream-divergence',
        divergences: row.compare.divergences,
        officialTokens: row.official.tokens,
        bptTokens: row.bpt.tokens,
      };
      if (scenario.engineFinding) {
        // Triaged as a suspected OUR-engine behavior gap, deliberately NOT a
        // KD (never papered over): stays DIVERGENT + reported here. One entry
        // per scenario per run - the official-check branch may already have
        // recorded the same root cause (review finding: no double counting).
        if (report.engineFindings.some((f) => f.scenario === scenario.id)) {
          row.engineFindingRef = scenario.id;
        } else {
          report.engineFindings.push({ ...payload, note: scenario.engineFinding });
        }
      } else {
        report.kdCandidates.push({
          ...payload,
          note: 'unlisted token difference (never hidden) - integrator triages into KNOWN_DIVERGENCES KD-ids',
        });
      }
    }
  }
  // Standing scenario notes (already-triaged splits, e.g. KD-11 Task/Agent
  // naming) are surfaced every run but no longer sit in kdCandidates - that
  // bucket is reserved for genuinely untriaged differences.
  if (scenario.kdNote && row.bpt && row.official && !row.official.unavailable) {
    report.scenarioNotes.push({ scenario: scenario.id, note: scenario.kdNote });
  }

  report.scenarios.push(row);
  const verdict = row.compare?.verdict ?? (row.demoted ? 'DEMOTED-SINGLE-ARM' : row.official?.unavailable ? 'OFFICIAL-ARM-UNAVAILABLE' : 'single-arm');
  console.log(
    `[${scenario.id}] ${verdict}` +
      (row.bpt?.checkFailures?.length ? ` | BPT CHECK FAIL: ${row.bpt.checkFailures.join('; ')}` : '') +
      (row.official?.checkFailures?.length ? ` | official check: ${row.official.checkFailures.join('; ')}` : ''),
  );
}

// Mandatory self-audit before the artifact leaves the process (standing
// decision clause 2): no request-body-derived content in the report.
const serialized = JSON.stringify(report, null, 2);
assertContentBlind(serialized);
writeFileSync(outPath, serialized);

console.log('\n| scenario | verdict | known diffs | divergences | bpt fails | official fails |');
console.log('|---|---|---|---|---|---|');
for (const row of report.scenarios) {
  const verdict = row.compare?.verdict ?? (row.demoted ? 'DEMOTED-SINGLE-ARM' : row.official?.unavailable ? 'OFFICIAL-ARM-UNAVAILABLE' : 'single-arm');
  console.log(
    `| ${row.id} | ${verdict} | ${row.compare?.knownDiffs?.join(' ') ?? ''} | ${row.compare?.divergences?.length ?? ''} | ${row.bpt?.checkFailures?.length ?? ''} | ${row.official?.checkFailures?.length ?? ''} |`,
  );
}
console.log(
  `\nkdCandidates: ${report.kdCandidates.length} (untriaged), engineFindings: ${report.engineFindings.length} (kept red, not KDs), demotions: ${report.demotions.length}`,
);
console.log(`report: ${outPath}`);
console.log('content-blind self-audit: PASS');

if (bptCheckFailures > 0) {
  console.error(`\nFAIL: ${bptCheckFailures} check failure(s) on the BPT arm (engine regression independent of the official arm)`);
  process.exit(1);
}
if (divergent > 0) {
  console.error(`\nINFO (M2, not gating): ${divergent} DIVERGENT scenario(s) - see kdCandidates (untriaged) / engineFindings (triaged, deliberately red) in the report`);
}
process.exit(0);
