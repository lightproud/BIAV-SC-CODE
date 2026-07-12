#!/usr/bin/env node
/**
 * runEvals() — the two-layer evaluation runner (SCS-REQ-002 REQ-2.1).
 *
 * One command, both layers, structured report (JSON + Markdown summary):
 *   node scripts/run-evals.mjs [--baseline-only|--behavior-only] [--out <dir>]
 *                              [--judge-batches]
 *
 * Layer 1 (baseline, "don't get worse"): the full deterministic vitest suite,
 * pass/fail. Layer 2 (behavior, "get better"): the maintainer-curated 20-
 * question set in evals/, executed per-question by its harness driver and
 * graded 1-5 by the PINNED judge (claude-sonnet-5, evals/judge-prompt.md —
 * keeper ruling 2026-07-11; judge-side budget cap $30/month). With
 * --judge-batches the judging stage rides the Message Batches API (the 50%
 * nightly-rate lane from the keeper's budget ruling) instead of inline
 * requests — same pinned model/prompt, same scores, half the judge bill.
 *
 * Harness drivers (no silent caps — everything not fully run is named):
 *  - 'prompt-session' questions execute against the real API via the built
 *    SDK (dist/), then get judged.
 *  - 'manual' questions run through the Phase 2 harness registry
 *    (scripts/eval-harnesses.mjs: fault-injection at the provider.fetch seam,
 *    process-kill + resume, compaction pressure). A manual question WITHOUT a
 *    registered runner still reports PENDING_HARNESS and stays out of the
 *    score denominator.
 *  - STUB mode (no ANTHROPIC_API_KEY): no API calls; the pipeline (loading,
 *    harness-spec validation, report shape) still runs end to end and every
 *    behavior question reports STUB with no score. Baseline runs either way.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { dumpMemory, getHarnessRunner, seedWorkspace } from './eval-harnesses.mjs';
import {
  computeDimensionMeans,
  diagnoseJudgeMessage,
  isValidVerdict,
  parseJudgeMessage,
  trimEvidence,
} from './eval-scoring.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const JUDGE_MODEL = 'claude-sonnet-5'; // PINNED — keeper ruling 2026-07-11.
const API_URL = 'https://api.anthropic.com/v1/messages';

const args = process.argv.slice(2);
const baselineOnly = args.includes('--baseline-only');
const behaviorOnly = args.includes('--behavior-only');
const judgeBatches = args.includes('--judge-batches');
const outDir = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : join(root, 'evals-reports');
const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
const live = apiKey.length > 0;

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

/** Messages API params for one judge call — shared by the inline and
 *  Batches lanes so the two can never grade differently. */
function judgeParams(question, evidence, judgePrompt) {
  const prompt = judgePrompt
    .replace('{{QUESTION_JSON}}', JSON.stringify(question, null, 2))
    .replace('{{EVIDENCE_JSON}}', JSON.stringify(evidence, null, 2));
  return {
    model: JUDGE_MODEL,
    // 4096 since self-improve #4: at 2048 evidence-heavy questions hit the
    // cap mid-JSON (5/20 scoreless verdicts in the 2026-07-12 branch round —
    // truncated rubric_findings evidence strings). Output budget is runner
    // plumbing; the PINNED judge model + prompt are untouched.
    max_tokens: 4096,
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
  };
}

const API_HEADERS = () => ({
  'content-type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
});

/** Grade one question with the pinned judge (inline lane). */
async function judgeOnce(question, evidence, judgePrompt) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: API_HEADERS(),
    body: JSON.stringify(judgeParams(question, evidence, judgePrompt)),
  });
  if (!res.ok) throw new Error(`judge HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const verdict = parseJudgeMessage(body);
  // 深挖一单 (keeper 2026-07-12): when the verdict has no valid score, carry
  // the API-level diagnostic so one LIVE round reveals WHY (truncation vs
  // no-text-block vs missing field) instead of another blind retry.
  if (!isValidVerdict(verdict)) verdict._diag = diagnoseJudgeMessage(body);
  return verdict;
}

/** Judge with ONE retry on an invalid/unparseable verdict (self-improve #4):
 *  scoreless or truncated judge replies are transient — a single fresh call
 *  usually yields a valid verdict; a second failure surfaces as ERROR. */
async function judge(question, evidence, judgePrompt) {
  let first;
  try {
    first = await judgeOnce(question, evidence, judgePrompt);
    if (isValidVerdict(first)) return first;
  } catch (err) {
    console.log(`judge retry for ${question.id}: first attempt threw (${String(err).slice(0, 120)})`);
    return judgeOnce(question, evidence, judgePrompt);
  }
  console.log(
    `judge retry for ${question.id}: first verdict invalid (score=${JSON.stringify(first.score)})`,
  );
  return judgeOnce(question, evidence, judgePrompt);
}

/** Grade every pending question in ONE Message Batch (50% nightly lane).
 *  Returns Map<question id, graded | {error}>. */
async function judgeViaBatches(items, judgePrompt) {
  const BATCHES_URL = 'https://api.anthropic.com/v1/messages/batches';
  const requests = items.map(({ question, evidence }) => ({
    custom_id: question.id,
    params: judgeParams(question, evidence, judgePrompt),
  }));
  const create = await fetch(BATCHES_URL, {
    method: 'POST',
    headers: API_HEADERS(),
    body: JSON.stringify({ requests }),
  });
  if (!create.ok) {
    throw new Error(`batch create HTTP ${create.status}: ${(await create.text()).slice(0, 300)}`);
  }
  let batch = await create.json();
  console.log(`judge batch ${batch.id} submitted (${requests.length} requests); polling…`);
  const deadline = Date.now() + 55 * 60_000;
  while (batch.processing_status !== 'ended') {
    if (Date.now() > deadline) {
      throw new Error(
        `judge batch ${batch.id} still ${batch.processing_status} after 55min — ` +
          'fetch its results later via the API and re-run scoring',
      );
    }
    await new Promise((r) => setTimeout(r, 20_000));
    const poll = await fetch(`${BATCHES_URL}/${batch.id}`, { headers: API_HEADERS() });
    if (!poll.ok) throw new Error(`batch poll HTTP ${poll.status}`);
    batch = await poll.json();
  }
  const res = await fetch(batch.results_url, { headers: API_HEADERS() });
  if (!res.ok) throw new Error(`batch results HTTP ${res.status}`);
  const graded = new Map();
  for (const line of (await res.text()).split('\n')) {
    if (line.trim().length === 0) continue;
    const entry = JSON.parse(line);
    if (entry.result?.type === 'succeeded') {
      try {
        graded.set(entry.custom_id, parseJudgeMessage(entry.result.message));
      } catch (err) {
        graded.set(entry.custom_id, { error: `judge parse: ${String(err).slice(0, 200)}` });
      }
    } else {
      graded.set(entry.custom_id, {
        error: `batch result ${entry.result?.type ?? 'missing'}`,
      });
    }
  }
  return graded;
}

/** ERROR result for a scoreless verdict, with the 深挖一单 diagnostic folded
 *  into the note (so it shows in the CI log, not only the JSON artifact). */
function invalidVerdictResult(base, verdict) {
  const d = verdict._diag;
  const diagStr =
    d !== undefined
      ? ` [diag: stop=${d.stop_reason}, blocks=${d.block_types.join('+') || 'none'}, text_len=${d.text_len}, out_tok=${d.output_tokens}]`
      : '';
  return {
    ...base,
    outcome: 'ERROR',
    note: `judge verdict missing/invalid score (got ${JSON.stringify(verdict.score)})${diagStr}`,
    ...(d !== undefined ? { judgeDiag: d } : {}),
  };
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
  // ---- execution stage: gather evidence per question -----------------------
  const toJudge = []; // { question, base, evidence } awaiting the judge
  for (const question of doc.questions) {
    const base = { id: question.id, dimension: question.dimension, status: question.status };
    const manual = question.harness.driver === 'manual';
    const runner = manual ? getHarnessRunner(question.id) : null;
    if (manual && runner === null) {
      results.push({ ...base, outcome: 'PENDING_HARNESS', note: question.harness.pending });
      continue;
    }
    if (!live) {
      results.push({ ...base, outcome: 'STUB', note: 'no ANTHROPIC_API_KEY; pipeline-only run' });
      continue;
    }
    if (manual) {
      // Phase 2 harness (eval-harnesses.mjs): fault injection at the
      // provider.fetch seam / resume / compaction pressure. The runner owns
      // its workspace; we clean it up once the evidence is captured.
      let ws = null;
      try {
        const out = await runner({ sdk });
        ws = out.ws;
        toJudge.push({ question, base, evidence: trimEvidence(out.evidence) });
      } catch (err) {
        results.push({ ...base, outcome: 'ERROR', note: String(err).slice(0, 500) });
      } finally {
        if (ws !== null) rmSync(ws.cwd, { recursive: true, force: true });
      }
      continue;
    }
    const ws = seedWorkspace(question.harness);
    try {
      const phases = question.harness.phases ?? [question.harness];
      const evidence = { phases: [], harnessNotes: question.harness.envelope ?? null };
      for (const phase of phases) {
        // Headless run: no permission callback exists, so tool calls must not
        // stall on approval — the scenarios only touch seeded temp workspaces.
        // The SDK gates bypassPermissions behind the explicit opt-in flag
        // (first LIVE round 2026-07-12 run #58 caught the missing pair).
        const { transcript, result } = await runPhase(sdk, phase, ws, {
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          // Envelope questions (e.g. tok-06) judge measured prompt size, not
          // vibes: surface the SDK's own per-request composition estimate
          // (system/prompt_composition rides the transcript into evidence).
          ...(question.harness.envelope !== undefined && question.harness.envelope !== null
            ? { includePromptComposition: true }
            : {}),
        });
        evidence.phases.push({
          transcript: transcript.slice(0, 200),
          result,
        });
      }
      evidence.memoryDump = dumpMemory(ws);
      toJudge.push({ question, base, evidence: trimEvidence(evidence) });
    } catch (err) {
      results.push({ ...base, outcome: 'ERROR', note: String(err).slice(0, 500) });
    } finally {
      rmSync(ws.cwd, { recursive: true, force: true });
    }
  }

  // ---- judging stage: inline (default) or one Message Batch (--judge-batches)
  if (judgeBatches && toJudge.length > 0) {
    try {
      const graded = await judgeViaBatches(toJudge, judgePrompt);
      for (const { question, base, evidence } of toJudge) {
        let g = graded.get(question.id);
        // A verdict without a valid 1-5 score is NOT a score (self-improve
        // #2). Batch-lane misses fall back to ONE inline retry (self-improve
        // #4) before surfacing as ERROR.
        if (g === undefined || g.error !== undefined || !isValidVerdict(g)) {
          try {
            console.log(`judge retry (inline) for ${question.id}: batch verdict missing/invalid`);
            g = await judgeOnce(question, evidence, judgePrompt);
          } catch (err) {
            g = { error: String(err).slice(0, 300) };
          }
        }
        if (g.error !== undefined) {
          results.push({ ...base, outcome: 'ERROR', note: g.error });
        } else if (!isValidVerdict(g)) {
          results.push(invalidVerdictResult(base, g));
        } else {
          results.push({ ...base, outcome: 'SCORED', ...g });
        }
      }
    } catch (err) {
      for (const { base } of toJudge) {
        results.push({ ...base, outcome: 'ERROR', note: String(err).slice(0, 500) });
      }
    }
  } else {
    for (const { question, base, evidence } of toJudge) {
      try {
        const graded = await judge(question, evidence, judgePrompt);
        if (!isValidVerdict(graded)) {
          results.push(invalidVerdictResult(base, graded));
        } else {
          results.push({ ...base, outcome: 'SCORED', ...graded });
        }
      } catch (err) {
        results.push({ ...base, outcome: 'ERROR', note: String(err).slice(0, 500) });
      }
    }
  }
  // Report in question order regardless of judging lane.
  const order = new Map(doc.questions.map((q, i) => [q.id, i]));
  results.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  return results;
}

/* ------------------------------------------------------------ report */

function summarize(baseline, behavior) {
  const scored = behavior.filter((r) => r.outcome === 'SCORED');
  const dimMeans = computeDimensionMeans(behavior);
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
