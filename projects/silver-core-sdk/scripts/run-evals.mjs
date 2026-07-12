#!/usr/bin/env node
/**
 * runEvals() — the two-layer evaluation runner (SCS-REQ-002 REQ-2.1).
 *
 * One command, both layers, structured report (JSON + Markdown summary):
 *   node scripts/run-evals.mjs [--baseline-only|--behavior-only] [--out <dir>]
 *
 * Layer 1 (baseline, "don't get worse"): the full deterministic vitest suite,
 * pass/fail. Layer 2 (behavior, "get better"): the maintainer-curated 20-
 * question set in evals/, executed per-question by its harness driver and
 * graded 1-5 by the PINNED judge (claude-sonnet-5, evals/judge-prompt.md —
 * keeper ruling 2026-07-11; judge-side budget cap $30/month, nightly runs
 * should move to the Batches API once scheduled — TODO Phase 2 wiring).
 *
 * Modes (no silent caps — everything not fully run is named in the report):
 *  - LIVE (ANTHROPIC_API_KEY set): 'prompt-session' questions execute against
 *    the real API via the built SDK (dist/), then get judged. 'manual'
 *    questions report PENDING_HARNESS (fault-injection harness lands in
 *    Phase 2) and are excluded from the score denominator.
 *  - STUB (no key): no API calls; the pipeline (loading, harness-spec
 *    validation, report shape) still runs end to end and every behavior
 *    question reports STUB with no score. Baseline layer runs either way.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const JUDGE_MODEL = 'claude-sonnet-5'; // PINNED — keeper ruling 2026-07-11.
const API_URL = 'https://api.anthropic.com/v1/messages';

const args = process.argv.slice(2);
const baselineOnly = args.includes('--baseline-only');
const behaviorOnly = args.includes('--behavior-only');
const outDir = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : join(root, 'evals-reports');
const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
const live = apiKey.length > 0;

/* ---------------------------------------------------------------- fixtures */

/** Expand "GENERATE:" fixture markers into deterministic content. */
function expandFixture(value) {
  if (!value.startsWith('GENERATE:')) return value;
  const spec = value.slice('GENERATE:'.length);
  if (spec.includes('500-line')) {
    return (
      '# Memory index (oversized fixture)\n' +
      Array.from({ length: 499 }, (_, i) => `- fact ${i + 1}: fixture line for cap testing`).join(
        '\n',
      ) +
      '\n'
    );
  }
  if (spec.includes('2000-word')) {
    const filler = Array.from({ length: 2000 }, (_, i) => `word${i + 1}`).join(' ');
    return `${filler}\nCONCLUSION: adopt plan B.\n`;
  }
  throw new Error(`unknown GENERATE fixture: ${spec}`);
}

/* ------------------------------------------------------------ layer 1 */

function runBaseline() {
  const started = Date.now();
  const tmpOut = join(mkdtempSync(join(tmpdir(), 'evals-baseline-')), 'vitest.json');
  const res = spawnSync(
    'npx',
    ['vitest', 'run', '--reporter=json', `--outputFile=${tmpOut}`],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000 },
  );
  let summary = null;
  try {
    const doc = JSON.parse(readFileSync(tmpOut, 'utf8'));
    summary = {
      total: doc.numTotalTests,
      passed: doc.numPassedTests,
      failed: doc.numFailedTests,
      pending: doc.numPendingTests,
      success: doc.success === true,
    };
  } catch {
    summary = { total: 0, passed: 0, failed: 0, pending: 0, success: false };
  }
  rmSync(dirname(tmpOut), { recursive: true, force: true });
  return {
    layer: 'baseline',
    pass: res.status === 0 && summary.success,
    ...summary,
    durationMs: Date.now() - started,
  };
}

/* ------------------------------------------------------------ layer 2 */

/** Seed harness files. seedMemory paths are /memories/... under baseDir. */
function seedWorkspace(harness) {
  const cwd = mkdtempSync(join(tmpdir(), 'evals-ws-'));
  const memBase = join(cwd, '.eval-memory');
  for (const [rel, content] of Object.entries(harness.seedFiles ?? {})) {
    writeFileSync(join(cwd, rel), expandFixture(content));
  }
  for (const [vpath, content] of Object.entries(harness.seedMemory ?? {})) {
    const p = join(memBase, vpath.replace(/^\//, ''));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, expandFixture(content));
  }
  return { cwd, memBase };
}

/** Run one prompt-session phase via the built SDK; returns evidence. */
async function runPhase(sdk, phase, ws, defaults) {
  const options = { ...(defaults ?? {}), ...(phase.options ?? {}) };
  if (options.memory !== undefined && options.memory !== null) {
    options.memory = { ...options.memory, baseDir: ws.memBase };
  }
  const transcript = [];
  let resultMsg = null;
  const prompts = phase.turns ?? [phase.prompt];
  // Multi-turn: streaming-input mode (one user envelope per turn).
  async function* input() {
    for (const p of prompts) {
      yield { type: 'user', message: { role: 'user', content: p }, parent_tool_use_id: null };
    }
  }
  const q = sdk.query({
    prompt: prompts.length > 1 ? input() : prompts[0],
    options: { ...options, cwd: ws.cwd, sessionDir: join(ws.cwd, '.eval-sessions') },
  });
  for await (const msg of q) {
    transcript.push(msg);
    if (msg.type === 'result') resultMsg = msg;
  }
  return { transcript, result: resultMsg };
}

/** Dump the seeded memory tree after a run (evidence for the judge). */
function dumpMemory(ws) {
  const out = {};
  const walk = (dir, prefix) => {
    for (const entry of readdirSyncSafe(dir)) {
      const p = join(dir, entry.name);
      const v = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(p, v);
      else {
        try {
          out[v] = readFileSync(p, 'utf8').slice(0, 8192);
        } catch {
          out[v] = '<unreadable>';
        }
      }
    }
  };
  walk(join(ws.memBase, 'memories'), '/memories');
  return out;
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Grade one question with the pinned judge. */
async function judge(question, evidence, judgePrompt) {
  const prompt = judgePrompt
    .replace('{{QUESTION_JSON}}', JSON.stringify(question, null, 2))
    .replace('{{EVIDENCE_JSON}}', JSON.stringify(evidence, null, 2));
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
              verdict: { type: 'string' },
              rubric_findings: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    point: { type: 'string' },
                    met: { type: 'boolean' },
                    evidence: { type: 'string' },
                  },
                  required: ['point', 'met', 'evidence'],
                  additionalProperties: false,
                },
              },
            },
            required: ['score', 'verdict', 'rubric_findings'],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`judge HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const text = (body.content ?? []).find((b) => b.type === 'text')?.text ?? '{}';
  return { ...JSON.parse(text), judgeUsage: body.usage };
}

async function runBehavior() {
  const doc = JSON.parse(readFileSync(join(root, 'evals', 'behavior', 'questions.json'), 'utf8'));
  const judgePrompt = readFileSync(join(root, 'evals', 'judge-prompt.md'), 'utf8');
  const results = [];
  let sdk = null;
  if (live) {
    try {
      sdk = await import(pathToFileURL(join(root, 'dist', 'index.js')).href);
    } catch {
      throw new Error('live mode needs the built SDK: run `npm run build` first');
    }
  }
  for (const question of doc.questions) {
    const base = { id: question.id, dimension: question.dimension, status: question.status };
    if (question.harness.driver === 'manual') {
      results.push({ ...base, outcome: 'PENDING_HARNESS', note: question.harness.pending });
      continue;
    }
    if (!live) {
      results.push({ ...base, outcome: 'STUB', note: 'no ANTHROPIC_API_KEY; pipeline-only run' });
      continue;
    }
    const ws = seedWorkspace(question.harness);
    try {
      const phases = question.harness.phases ?? [question.harness];
      const evidence = { phases: [], harnessNotes: question.harness.envelope ?? null };
      for (const phase of phases) {
        // Headless run: no permission callback exists, so tool calls must not
        // stall on approval — the scenarios only touch seeded temp workspaces.
        const { transcript, result } = await runPhase(sdk, phase, ws, {
          permissionMode: 'bypassPermissions',
        });
        evidence.phases.push({
          transcript: transcript.slice(0, 200),
          result,
        });
      }
      evidence.memoryDump = dumpMemory(ws);
      const graded = await judge(question, evidence, judgePrompt);
      results.push({ ...base, outcome: 'SCORED', ...graded });
    } catch (err) {
      results.push({ ...base, outcome: 'ERROR', note: String(err).slice(0, 500) });
    } finally {
      rmSync(ws.cwd, { recursive: true, force: true });
    }
  }
  return results;
}

/* ------------------------------------------------------------ report */

function summarize(baseline, behavior) {
  const scored = behavior.filter((r) => r.outcome === 'SCORED');
  const byDim = {};
  for (const r of scored) {
    (byDim[r.dimension] ??= []).push(r.score);
  }
  const dimMeans = Object.fromEntries(
    Object.entries(byDim).map(([d, s]) => [d, +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2)]),
  );
  return {
    generator: 'run-evals.mjs (SCS-REQ-002 REQ-2.1)',
    mode: live ? 'LIVE' : 'STUB',
    judgeModel: JUDGE_MODEL,
    baseline,
    behavior: {
      scored: scored.length,
      pendingHarness: behavior.filter((r) => r.outcome === 'PENDING_HARNESS').length,
      stub: behavior.filter((r) => r.outcome === 'STUB').length,
      errors: behavior.filter((r) => r.outcome === 'ERROR').length,
      dimensionMeans: dimMeans,
      results: behavior,
    },
  };
}

function toMarkdown(report, stamp) {
  const b = report.baseline;
  const lines = [
    `# runEvals report — ${stamp} (${report.mode})`,
    '',
    '## Baseline layer',
    b
      ? `- ${b.pass ? 'PASS' : 'FAIL'}: ${b.passed}/${b.total} tests (${b.failed} failed) in ${(b.durationMs / 1000).toFixed(0)}s`
      : '- skipped (--behavior-only)',
    '',
    '## Behavior layer',
  ];
  if (report.behavior) {
    const bh = report.behavior;
    lines.push(
      `- scored ${bh.scored} / pending-harness ${bh.pendingHarness} / stub ${bh.stub} / errors ${bh.errors}`,
      `- dimension means: ${JSON.stringify(bh.dimensionMeans)}`,
      '',
      '| id | dim | outcome | score | note |',
      '|---|---|---|---|---|',
    );
    for (const r of bh.results) {
      lines.push(
        `| ${r.id} | ${r.dimension} | ${r.outcome} | ${r.score ?? '—'} | ${(r.verdict ?? r.note ?? '').slice(0, 90)} |`,
      );
    }
  } else {
    lines.push('- skipped (--baseline-only)');
  }
  return lines.join('\n') + '\n';
}

/* ------------------------------------------------------------ main */

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const baseline = behaviorOnly ? null : runBaseline();
const behavior = baselineOnly ? null : await runBehavior();
const report = summarize(baseline, behavior ?? []);
if (baselineOnly) report.behavior = null;

mkdirSync(outDir, { recursive: true });
const jsonPath = join(outDir, `evals-${stamp}.json`);
const mdPath = join(outDir, `evals-${stamp}.md`);
writeFileSync(jsonPath, JSON.stringify(report, null, 2));
const md = toMarkdown(report, stamp);
writeFileSync(mdPath, md);
console.log(md);
console.log(`report: ${jsonPath}`);

// Exit non-zero when the baseline layer fails — the behavior layer is
// advisory (REQ-2.2: score drops warn, humans arbitrate).
if (baseline && !baseline.pass) process.exit(1);
