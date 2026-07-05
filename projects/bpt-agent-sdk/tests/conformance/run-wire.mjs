/**
 * Request-body wire differential (conformance input-axis, enabled by
 * decisions.md 2026-07-05 净室观测边界 r3 - clause ② content-blind LIFTED).
 *
 * Points BOTH arms at a capturing emulator, drives one scripted turn each,
 * captures what each engine puts ON THE WIRE (the Messages API request body),
 * and compares the STRUCTURAL fingerprint (system segmentation, cache
 * breakpoints, tool set, thinking config). L1-L5 observe outputs; this
 * observes inputs - the other half of the differential the clean-room rule
 * previously forbade.
 *
 * Usage:
 *   node tests/conformance/run-wire.mjs [--arm=both|bpt] [--out=path.json]
 *
 * Prereqs: dist/ built; official pkg installed transiently per pins.json
 * (`npm i --no-save`, never a repo dependency). Keyless - the emulator
 * scripts a fixed reply, so no real API is hit.
 *
 * Exit: 0 always (report-only, like the pre-ratchet M2/M3 runners); the
 * structural differences are the finding, triaged into the report.
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmulator, textReply, assertContentBlind } from './emulator.mjs';
import { fingerprintRequestBody, diffFingerprints } from './wire-fingerprint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DUMMY_KEY = 'sk-ant-api03-' + 'A'.repeat(95);
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const armMode = args.arm ?? 'both';
const outPath = typeof args.out === 'string' ? args.out : join(HERE, '..', '..', 'conformance-wire.json');

async function loadQuery(armKind) {
  const mod = armKind === 'bpt' ? await import('../../dist/index.js') : await import('@anthropic-ai/claude-agent-sdk');
  return mod.query;
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

/** Drive one arm one scripted turn against a capturing emulator; fingerprint the first POST body. */
async function captureArm(armKind) {
  const query = await loadQuery(armKind);
  const cwd = mkdtempSync(join(tmpdir(), `conf-wire-${armKind}-`));
  const emulator = await startEmulator([{ kind: 'sse', events: textReply('WIRE OK') }], {
    captureBodies: true,
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  try {
    const q = query({
      prompt: 'Say OK.',
      options: {
        abortController: ac,
        cwd,
        maxTurns: 2,
        env: baseEnv(emulator.url),
        ...(armKind === 'bpt' ? { sessionDir: join(cwd, '.sessions'), systemPrompt: { type: 'preset', preset: 'claude_code' } } : {}),
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
  const body = emulator.profile.requestBodies[0];
  return { arm: armKind, fingerprint: fingerprintRequestBody(body), posts: emulator.profile.requestBodies.length };
}

const pins = JSON.parse(readFileSync(join(HERE, 'pins.json'), 'utf8'));
const report = {
  generated_for: 'bpt-agent-sdk conformance request-body wire differential (input axis, r3)',
  pins: { agentSdk: pins.agentSdk, claudeCode: pins.claudeCode },
  boundary:
    'content-blind clause LIFTED (decisions.md 2026-07-05 r3); request bodies read for the input differential. Fingerprints are STRUCTURAL (no prompt prose dumped).',
  armMode,
};

const bpt = await captureArm('bpt');
report.bpt = bpt;
console.log(`[bpt] tools=${bpt.fingerprint.toolCount} systemKind=${bpt.fingerprint.systemKind} sysCache=${bpt.fingerprint.systemCacheBreakpoints} thinking=${JSON.stringify(bpt.fingerprint.thinking)}`);

if (armMode !== 'bpt') {
  try {
    const official = await captureArm('official');
    report.official = official;
    console.log(`[official] tools=${official.fingerprint.toolCount} systemKind=${official.fingerprint.systemKind} sysCache=${official.fingerprint.systemCacheBreakpoints} thinking=${JSON.stringify(official.fingerprint.thinking)}`);
    const diff = diffFingerprints(official.fingerprint, bpt.fingerprint);
    // Triage: the CLI advertises its own PRODUCT tool surface (Cron*, Task*,
    // Workflow, Skills, Plugins, ...) that the SDK deliberately does not ship,
    // so tool-set size/name gaps are EXPECTED-SURFACE, not alignment defects.
    // Everything else (thinking config, cache-breakpoint strategy, system
    // segmentation) is an ALIGNMENT-CANDIDATE the engine can act on - now
    // observable because clause ② was lifted.
    const EXPECTED_SURFACE = new Set(['toolNames', 'toolCount']);
    for (const d of diff) d.kind = EXPECTED_SURFACE.has(d.facet) ? 'expected-surface' : 'alignment-candidate';
    report.diff = diff;
    const candidates = diff.filter((d) => d.kind === 'alignment-candidate');
    report.alignmentCandidates = candidates.map((d) => d.facet);
    report.verdict = diff.length === 0 ? 'WIRE_MATCH' : candidates.length === 0 ? 'WIRE_KNOWN_DIFF' : 'WIRE_DIFF';
    console.log(`\nwire diff (official vs bpt): ${diff.length} facet(s), ${candidates.length} alignment-candidate(s)`);
    for (const d of diff) console.log(`   [${d.kind}]`, JSON.stringify(d));
  } catch (err) {
    report.official = { unavailable: String(err?.message ?? err).slice(0, 200) };
    report.verdict = 'OFFICIAL-ARM-UNAVAILABLE';
    console.log(`[official] unavailable: ${report.official.unavailable}`);
  }
} else {
  report.verdict = 'single-arm';
}

const serialized = JSON.stringify(report, null, 2);
assertContentBlind(serialized); // fingerprints are structural, so this still passes
writeFileSync(outPath, serialized);
console.log(`\nreport: ${outPath}`);
console.log('content-blind self-audit: PASS (structural fingerprints carry no prompt prose)');
process.exit(0);
