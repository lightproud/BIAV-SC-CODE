/**
 * Request-body wire differential (conformance INPUT axis, enabled by
 * decisions.md 2026-07-05 净室观测边界 r3 - clause ② content-blind LIFTED).
 *
 * Iterates WIRE_SCENARIOS: for each, points BOTH arms at a capturing emulator,
 * drives one scripted turn, captures each engine's first Messages API request
 * body, and compares STRUCTURAL fingerprints (system segmentation, cache
 * breakpoints, tool set, thinking config) plus PER-TOOL input_schema for the
 * shared tool set. L1-L5 observe outputs; this observes inputs - the half the
 * clean-room rule previously forbade. The official arm's fingerprints are the
 * REFERENCE TARGET (--update-reference writes wire-reference.json).
 *
 * Usage:
 *   node tests/conformance/run-wire.mjs [--arm=both|bpt] [--update-reference] [--out=path.json]
 *
 * Prereqs: dist/ built; official pkg installed transiently per pins.json
 * (`npm i --no-save`, never a repo dependency). Keyless - scripted reply.
 *
 * Exit: 0 always (report-only; the structural diffs are the finding).
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmulator, textReply, assertContentBlind } from './emulator.mjs';
import { fingerprintRequestBody, diffFingerprints, diffToolSchemas } from './wire-fingerprint.mjs';
import { WIRE_SCENARIOS } from './scenarios-wire.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DUMMY_KEY = 'sk-ant-api03-' + 'A'.repeat(95);
const REFERENCE_PATH = join(HERE, 'wire-reference.json');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const armMode = args.arm ?? 'both';
const updateReference = args['update-reference'] === true;
const outPath = typeof args.out === 'string' ? args.out : join(HERE, '..', '..', 'conformance-wire.json');

// Tool-set size/name gaps are EXPECTED-SURFACE: the CLI advertises its own
// product tools (Cron*/Task*/Workflow/Skills/...) the SDK deliberately omits.
const EXPECTED_SURFACE = new Set(['toolNames', 'toolCount']);

async function loadQuery(armKind) {
  const mod = armKind === 'bpt' ? await import('../../dist/index.js') : await import('@anthropic-ai/claude-agent-sdk');
  return mod.query;
}
async function loadSdk(armKind) {
  return armKind === 'bpt' ? import('../../dist/index.js') : import('@anthropic-ai/claude-agent-sdk');
}

function baseEnv(url) {
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_API_KEY: DUMMY_KEY,
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_MODEL: '',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
  };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_SSE_PORT;
  delete env.CLAUDECODE;
  return env;
}

/** Drive one arm through one scenario; fingerprint the first captured POST body. */
async function captureArm(armKind, scenario) {
  const query = await loadQuery(armKind);
  const sdk = await loadSdk(armKind);
  const cwd = mkdtempSync(join(tmpdir(), `conf-wire-${armKind}-`));
  const emulator = await startEmulator([{ kind: 'sse', events: textReply('WIRE OK') }], {
    captureBodies: true,
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  const extra = scenario.buildOptions ? scenario.buildOptions({ sdk }) : (scenario.options ?? {});
  try {
    const q = query({
      prompt: 'Say OK.',
      options: {
        abortController: ac,
        cwd,
        maxTurns: 2,
        env: baseEnv(emulator.url),
        ...(armKind === 'bpt'
          ? { sessionDir: join(cwd, '.sessions'), systemPrompt: { type: 'preset', preset: 'claude_code' } }
          : {}),
        ...extra,
      },
    });
    for await (const _m of q) void _m;
  } catch {
    // A driver error still leaves whatever body was captured before it.
  } finally {
    clearTimeout(timer);
    await emulator.close();
    rmSync(cwd, { recursive: true, force: true });
  }
  return fingerprintRequestBody(emulator.profile.requestBodies[0]);
}

const pins = JSON.parse(readFileSync(join(HERE, 'pins.json'), 'utf8'));
const report = {
  generated_for: 'bpt-agent-sdk conformance request-body wire differential (input axis, r3)',
  pins: { agentSdk: pins.agentSdk, claudeCode: pins.claudeCode },
  boundary:
    'content-blind clause LIFTED (decisions.md 2026-07-05 r3); request bodies read for the input differential. Fingerprints are STRUCTURAL (no prompt prose).',
  armMode,
  scenarios: [],
};
const referenceOut = {};

for (const scenario of WIRE_SCENARIOS) {
  const bpt = await captureArm('bpt', scenario);
  const row = { id: scenario.id, notes: scenario.notes, bpt };
  if (armMode !== 'bpt') {
    try {
      const official = await captureArm('official', scenario);
      row.official = official;
      referenceOut[scenario.id] = official;
      const facetDiff = diffFingerprints(official, bpt).map((d) => ({
        ...d,
        kind: EXPECTED_SURFACE.has(d.facet) ? 'expected-surface' : 'alignment-candidate',
      }));
      const schemaDiff = diffToolSchemas(official, bpt);
      row.facetDiff = facetDiff;
      row.toolSchemaDiff = schemaDiff;
      const candidates = facetDiff.filter((d) => d.kind === 'alignment-candidate');
      row.verdict =
        facetDiff.length === 0 && schemaDiff.length === 0
          ? 'WIRE_MATCH'
          : candidates.length === 0 && schemaDiff.length === 0
            ? 'WIRE_KNOWN_DIFF'
            : 'WIRE_DIFF';
      console.log(
        `[${scenario.id}] ${row.verdict} | facets:${facetDiff.length}(cand ${candidates.length}) toolSchema:${schemaDiff.length}` +
          (candidates.length ? ` | ${candidates.map((c) => c.facet).join(',')}` : ''),
      );
      for (const s of schemaDiff) console.log(`    tool ${s.tool}: ${JSON.stringify(s.diffs)}`);
    } catch (err) {
      row.official = { unavailable: String(err?.message ?? err).slice(0, 200) };
      row.verdict = 'OFFICIAL-ARM-UNAVAILABLE';
      console.log(`[${scenario.id}] official unavailable: ${row.official.unavailable}`);
    }
  } else {
    row.verdict = 'single-arm';
    console.log(`[${scenario.id}] single-arm (bpt) tools=${bpt.toolCount} thinking=${JSON.stringify(bpt.thinking)}`);
  }
  report.scenarios.push(row);
}

const serialized = JSON.stringify(report, null, 2);
assertContentBlind(serialized); // structural fingerprints carry no prompt prose
writeFileSync(outPath, serialized);
console.log(`\nreport: ${outPath}`);

if (updateReference && armMode !== 'bpt' && Object.keys(referenceOut).length > 0) {
  const ref = {
    generated_for: 'official-arm request-body wire reference targets (structural fingerprints)',
    pins: { agentSdk: pins.agentSdk, claudeCode: pins.claudeCode },
    note: 'The official engine wire shape our engine aims to match (minus expected-surface tool-set gaps). Refresh via `node run-wire.mjs --update-reference`.',
    scenarios: referenceOut,
  };
  writeFileSync(REFERENCE_PATH, JSON.stringify(ref, null, 2));
  console.log(`reference targets written: ${REFERENCE_PATH}`);
}
console.log('content-blind self-audit: PASS (structural fingerprints, no prompt prose)');
process.exit(0);
