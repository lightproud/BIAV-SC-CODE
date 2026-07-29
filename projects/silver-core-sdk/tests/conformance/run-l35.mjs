/**
 * L3.5 subagent / hook lifecycle differential (conformance, B3).
 *
 * Drives BOTH arms through a foreground subagent spawn against the
 * content-blind emulator and compares the OBSERVABLE lifecycle event
 * VOCABULARY (the set of system/task_* and hook_* subtypes each engine emits
 * on the public SDKMessage stream) - NOT exact POST counts. The probe
 * (2026-07-05) showed the arms make a DIFFERENT number of POSTs on a subagent
 * spawn (ours 3, official 4+ then a script-exhaustion throw) and emit a
 * DIFFERENT lifecycle vocabulary, so a count-based hard gate would be flaky
 * and version-sensitive. This runner is therefore REPORT-ONLY (like the
 * pre-ratchet M2/M3 runners): the vocabulary differential is the finding,
 * triaged as KD-L35-*, never a red gate.
 *
 * A generous benign-text script queue keeps EITHER arm from exhausting the
 * queue (the official arm's extra POSTs would otherwise 400 and truncate its
 * observed vocabulary). Our-arm lifecycle vocabulary is separately locked
 * keyless in tests/conformance-l35.test.ts.
 *
 * Usage: node tests/conformance/run-l35.mjs [--arm=both|bpt] [--out=path.json]
 * Prereqs: dist/ built; official pkg installed transiently per pins.json.
 * Exit: 0 always (report-only).
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmulator, textReply, toolUseReply, assertContentBlind } from './emulator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DUMMY_KEY = 'sk-ant-api03-' + 'A'.repeat(95);
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const armMode = args.arm ?? 'both';
const outPath = typeof args.out === 'string' ? args.out : join(HERE, '..', '..', 'conformance-l35.json');

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

/** Drive one arm through a foreground Agent spawn; return the lifecycle vocabulary. */
async function captureArm(armKind) {
  const query = await loadQuery(armKind);
  const cwd = mkdtempSync(join(tmpdir(), `conf-l35-${armKind}-`));
  // Turn 1 spawns a subagent; the rest are benign text so NEITHER arm
  // exhausts the queue regardless of how many nested POSTs it makes.
  const scripts = [
    { kind: 'sse', events: toolUseReply([{ name: 'Agent', input: { subagent_type: 'general-purpose', description: 'demo', prompt: 'do work' } }], { id: 'm1' }) },
    ...Array.from({ length: 10 }, (_, i) => ({ kind: 'sse', events: textReply(`turn ${i + 2} done`, { id: `t${i + 2}` }) })),
  ];
  const emulator = await startEmulator(scripts, { captureBodies: false });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  const vocab = new Set();
  const encoding = {};
  const allTypes = [];
  let error;
  try {
    const q = query({
      prompt: 'Delegate this to a subagent.',
      options: {
        abortController: ac,
        cwd,
        maxTurns: 8,
        allowedTools: ['Agent'],
        env: baseEnv(emulator.url),
        // 0.94.0: the engine ships no built-in default model, and baseEnv
        // deliberately blanks ANTHROPIC_MODEL — without this pin EVERY bpt-arm
        // spawn dies in query() construction with "model is required", the
        // catch below swallowed the throw, and the run reported an EMPTY
        // lifecycle vocabulary as if it had been measured (two dead arms even
        // produced "L35_VOCAB_MATCH"). Same id the other runners pin.
        model: 'claude-sonnet-4-5',
        agents: { 'general-purpose': { description: 'general purpose worker', prompt: 'You are a worker.' } },
        ...(armKind === 'bpt' ? { sessionDir: join(cwd, '.sessions') } : {}),
      },
    });
    for await (const m of q) {
      const tag = m.type === 'system' && m.subtype ? `system/${m.subtype}` : m.type;
      allTypes.push(tag);
      // Lifecycle events may arrive as a TOP-LEVEL type (ours:
      // {type:'task_started'}) OR a system-message SUBTYPE (official:
      // {type:'system', subtype:'task_started'}) - collect the NAME from
      // wherever it lands, and separately record the ENCODING per name so the
      // type-vs-subtype divergence itself is a reported facet.
      for (const candidate of [m.type, m.subtype]) {
        if (typeof candidate === 'string' && /^(task_|hook_)/.test(candidate)) {
          vocab.add(candidate);
          encoding[candidate] = m.type === 'system' ? 'system-subtype' : 'top-level-type';
        }
      }
    }
  } catch (err) {
    // official may throw on its own iterator quirk after the result; the
    // vocabulary observed up to that point is still the finding. RECORD the
    // throw either way: a swallowed error made "arm produced no lifecycle
    // events" indistinguishable from "arm never started".
    error = String(err?.message ?? err).slice(0, 300);
  } finally {
    clearTimeout(timer);
    await emulator.close();
    rmSync(cwd, { recursive: true, force: true });
  }
  return {
    arm: armKind,
    lifecycleVocab: [...vocab].sort(),
    encoding,
    sawResult: allTypes.includes('result'),
    error: error ?? null,
  };
}

/**
 * An arm that emitted NO lifecycle event measured nothing: comparing two such
 * arms yields an empty vocab diff, which the verdict used to call a MATCH.
 */
function armMeasured(arm) {
  return arm.lifecycleVocab.length > 0;
}

const pins = JSON.parse(readFileSync(join(HERE, 'pins.json'), 'utf8'));
const report = {
  generated_for: 'silver-core-sdk conformance L3.5 (subagent/hook lifecycle vocabulary differential)',
  pins: { agentSdk: pins.agentSdk, claudeCode: pins.claudeCode },
  policy: 'REPORT-ONLY: arms make different POST counts on a spawn; vocabulary (not counts) is compared, triaged as KD-L35-*, never a hard gate.',
  armMode,
};

const bpt = await captureArm('bpt');
report.bpt = bpt;
console.log(
  `[bpt] lifecycle vocab: ${bpt.lifecycleVocab.join(', ') || '(none)'} | sawResult=${bpt.sawResult}` +
    (bpt.error ? ` | ARM ERROR: ${bpt.error}` : ''),
);

if (armMode !== 'bpt') {
  try {
    const official = await captureArm('official');
    report.official = official;
    console.log(
      `[official] lifecycle vocab: ${official.lifecycleVocab.join(', ') || '(none)'} | sawResult=${official.sawResult}` +
        (official.error ? ` | ARM ERROR: ${official.error}` : ''),
    );
    const onlyBpt = bpt.lifecycleVocab.filter((v) => !official.lifecycleVocab.includes(v));
    const onlyOfficial = official.lifecycleVocab.filter((v) => !bpt.lifecycleVocab.includes(v));
    // Encoding divergence: for names BOTH emit, does the wire encoding match?
    const shared = bpt.lifecycleVocab.filter((v) => official.lifecycleVocab.includes(v));
    const encodingDiff = shared.filter((v) => bpt.encoding[v] !== official.encoding[v]);
    report.vocabDiff = { onlyBpt, onlyOfficial };
    report.encodingDiff = encodingDiff.map((v) => ({ name: v, bpt: bpt.encoding[v], official: official.encoding[v] }));
    // An empty-vs-empty vocabulary is zero comparisons, not agreement: only
    // call it a MATCH when BOTH arms actually emitted lifecycle events.
    report.verdict = !armMeasured(bpt) || !armMeasured(official)
      ? 'L35-INCONCLUSIVE-NO-LIFECYCLE'
      : onlyBpt.length === 0 && onlyOfficial.length === 0 && encodingDiff.length === 0
        ? 'L35_VOCAB_MATCH'
        : 'L35_VOCAB_DIFF';
    console.log(`\nlifecycle vocab diff: onlyBpt=${JSON.stringify(onlyBpt)} onlyOfficial=${JSON.stringify(onlyOfficial)} => ${report.verdict}`);
    if (encodingDiff.length) console.log(`encoding diff (shared names): ${JSON.stringify(report.encodingDiff)}`);
  } catch (err) {
    report.official = { unavailable: String(err?.message ?? err).slice(0, 200) };
    report.verdict = 'OFFICIAL-ARM-UNAVAILABLE';
    console.log(`[official] unavailable: ${report.official.unavailable}`);
  }
} else {
  report.verdict = 'single-arm';
}

const serialized = JSON.stringify(report, null, 2);
assertContentBlind(serialized);
writeFileSync(outPath, serialized);
console.log(`\nreport: ${outPath}`);
console.log('content-blind self-audit: PASS');

// Report-only applies to the DIFFERENTIAL (arms legitimately disagree on
// vocabulary). It never applied to our own arm failing to run: a bpt arm that
// threw, or that emitted not one lifecycle event on a foreground spawn, has
// measured nothing - the same "BPT-arm failure is our regression" rule the
// other runners exit 1 on. Printing "(none)" and exiting 0 is how this runner
// sat dead from 0.94.0 onward without a single red.
if (bpt.error || !armMeasured(bpt)) {
  console.error(
    `\nFAIL: the BPT arm measured NO lifecycle vocabulary` +
      (bpt.error ? ` (arm error: ${bpt.error})` : ' (no task_*/hook_* event on a foreground Agent spawn)') +
      ' - this runner compared nothing on our side.',
  );
  process.exit(1);
}
process.exit(0);
