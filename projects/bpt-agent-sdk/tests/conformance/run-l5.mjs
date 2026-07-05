/**
 * L5 dual-engine REAL-API runner + gate B (conformance suite M4) and the L6
 * zero-cost official-arm public-stream trace retention hook (blueprint §四).
 *
 * Runs every task in tests/conformance/l5-tasks.mjs through BOTH engines -
 * 'bpt' (this SDK's built dist) and 'official' (@anthropic-ai/
 * claude-agent-sdk, installed transiently per pins.json, never a repo
 * dependency) - against the real api.anthropic.com, repeat times each, and
 * applies the blueprint's ONLY end-to-end gate:
 *
 *   Gate B: aggregate pass-rate over all task-repeats per engine; ours must
 *   be >= official minus 5 percentage points. Single tasks may trade wins.
 *   Efficiency axes (turns / cost / wall) are REPORTED ONLY - run #74 proved
 *   wall-clock deltas are API-latency noise, never a gate.
 *
 * Usage (REAL round - needs a key, spends budget):
 *   ANTHROPIC_API_KEY=... node tests/conformance/run-l5.mjs \
 *     [--model=claude-haiku-4-5-20251001] [--repeat=5] [--budget-usd=1.5] \
 *     [--gate] [--econ] [--tasks=chat-01,code-03|--tasks=code] \
 *     [--thinking=4096] [--traces-bpt] [--out=path.json]
 *
 * Keyless smoke (this is the only mode runnable without a key - proves the
 * harness end-to-end against the M1 content-blind emulator, zero spend):
 *   node tests/conformance/run-l5.mjs --smoke
 *
 * EXPECTED REAL-RUN LOAD (blueprint budget basis, haiku-4.5 pricing): 18
 * tasks x 2 engines x repeat=5 = 180 runs, ~42 assistant turns => ~50 API
 * calls per engine per repeat, ~500 calls/arm/round. Three cost scenarios:
 *   (a) cross-run prefix-cache HITS (sequential runs inside the 5-min TTL):
 *       ~$1.35-1.5 -> fits the $1.5 cap; the design point.
 *   (b) per-run cache WRITE only (writes never read back): ~$4.2 -> over.
 *   (c) no cache at all (the 0%-read defect ab-benchmark already flags):
 *       ~$7.3 -> over ~5x.
 * The runner prints ab-benchmark's cache write/read diagnosis so the round's
 * scenario is identified from run 1, and the budget guard aborts cleanly
 * (partial report) when the projection from ACTUAL usage exceeds
 * --budget-usd. Mitigations for (b)/(c): --econ honors the task library's
 * repeatOverride (repeat=3 on the 11 low-variance chat/retrieval/document
 * tasks, full 5 on the 7 discriminators), and --tasks shards the round
 * across dispatches (gate B aggregates the union; the blueprint cap is
 * per-dispatch ~$1.5).
 *
 * L6 retention (zero marginal cost, NO gate): every OFFICIAL-arm run's
 * PUBLIC SDKMessage stream - the messages OUR consumer loop received, never
 * request bodies - is serialized to l5-traces/official/<task>-rN.json
 * (--traces-bpt mirrors ours under l5-traces/bpt/). These are legal
 * observations under the standing clean-room boundary (memory/decisions.md
 * 2026-07-05 净室观测边界): assertions and retention touch only the public
 * stream, fs side effects, terminal results and wire metadata. Every trace
 * and the report itself pass assertContentBlind before hitting disk.
 *
 * Exit semantics: 0 = report written (gate off, or gate PASS); 1 = --gate
 * and gate B breached or inconclusive (a gate that could not run to
 * completion must not go green), or a BPT-arm failure in --smoke (scripted
 * determinism means any smoke failure is a harness/engine regression);
 * 2 = missing prerequisite (no key outside --smoke / official pkg absent).
 *
 * NOT part of `npm test`. Deterministic-test discipline: mkdtemp cwds,
 * cleanup in finally, no wall-clock assertions - the per-run abort timer and
 * the streaming turn-release barrier are loud-fail settle barriers only.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { L5_TASKS, L5_KNOWN_DIFFERENCES } from './l5-tasks.mjs';
import { aggregateRunMetrics } from './l5-aggregate.mjs';
import { startEmulator, textReply, assertContentBlind } from './emulator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DUMMY_KEY = 'sk-ant-api03-' + 'A'.repeat(95);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const SMOKE = args.smoke === true;
const MODEL = typeof args.model === 'string' ? args.model : 'claude-haiku-4-5-20251001';
const REPEAT = Math.max(1, Number.parseInt(args.repeat, 10) || 5);
const BUDGET_USD = Number.parseFloat(args['budget-usd']) > 0 ? Number.parseFloat(args['budget-usd']) : 1.5;
const GATE = args.gate === true;
// Review finding: gate B is defined over the FULL task library; enforcing it
// on a --tasks shard silently changes its meaning. Sharded gating requires
// the explicit acknowledgement flag (report-only stays fine without it).
if (GATE && typeof args.tasks === 'string' && args['gate-shard'] !== true) {
  console.error('run-l5: --gate with --tasks enforces a SHARD-LOCAL gate, not blueprint gate B (full-library aggregate). Pass --gate-shard to acknowledge, or drop --gate for a report-only shard.');
  process.exit(1);
}
const ECON = args.econ === true;
// Fix-2 (dissection 2026-07-05, KD-L5-03 variable isolation): --thinking=N
// pins maxThinkingTokens to the SAME explicit budget on BOTH arms, so a
// correctness delta can no longer hide behind the engines' different
// thinking DEFAULTS (official CLI: on, undisclosed budget; ours since E1:
// on, 4096 under the claude_code preset). Unset = each engine's own default
// (the product-realistic comparison). Real mode only - smoke is scripted.
const THINKING = Number.parseInt(args.thinking, 10);
const THINKING_SET = Number.isFinite(THINKING) && THINKING >= 0;
const TRACE_BPT = args['traces-bpt'] === true;
const OUT = typeof args.out === 'string' ? args.out : join(HERE, '..', '..', 'conformance-l5.json');
const TRACE_ROOT = join(HERE, '..', '..', 'l5-traces');
const TOLERANCE_PP = 5;

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Smoke trio - one representative per harness surface (scripts defined in
// the smoke section below): pure-text result / real Edit + fs sentinel /
// 3-turn streaming input. Declared before task selection uses it.
const SMOKE_TASK_IDS = ['chat-01', 'document-02', 'longconv-01'];

// --- Task selection -----------------------------------------------------------
// --tasks tokens match a task id OR a whole dimension; the union across
// sharded dispatches is what gate B is defined over (see header).
const selected = SMOKE
  ? L5_TASKS.filter((t) => SMOKE_TASK_IDS.includes(t.id))
  : typeof args.tasks === 'string'
    ? L5_TASKS.filter((t) =>
        args.tasks.split(',').some((tok) => tok === t.id || tok === t.dimension),
      )
    : L5_TASKS;

/** Effective repeats: --econ honors the library's per-task budget lever. */
function effRepeat(task) {
  if (SMOKE) return 1;
  return ECON ? Math.min(REPEAT, task.repeatOverride ?? REPEAT) : REPEAT;
}

// --- Prerequisites --------------------------------------------------------------
if (!SMOKE && !process.env.ANTHROPIC_API_KEY) {
  console.error(
    'run-l5: ANTHROPIC_API_KEY is not set. L5 is a REAL-API differential ' +
      '(both arms hit api.anthropic.com); export a key, or use --smoke for ' +
      'the keyless emulator-backed harness check. Exiting (2).',
  );
  process.exit(2);
}

const bptSdk = await import('../../dist/index.js');
let officialSdk;
try {
  officialSdk = await import('@anthropic-ai/claude-agent-sdk');
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (!SMOKE) {
    // Without the official arm there is no comparison and no gate - the
    // whole point of L5 is dual-engine. Same skip semantics as ab-benchmark.
    console.error(
      `run-l5: could not load @anthropic-ai/claude-agent-sdk (${msg}); the ` +
        'gate needs both arms. Install per tests/conformance/pins.json with ' +
        '`npm i --no-save` (never into package.json). Exiting (2).',
    );
    process.exit(2);
  }
  console.log(`run-l5 --smoke: official arm unavailable (${msg}) - BPT arm only, gate INCONCLUSIVE.`);
  officialSdk = undefined;
}
const queryOf = (arm) => (arm === 'bpt' ? bptSdk.query : officialSdk.query);
const ARMS = officialSdk ? ['bpt', 'official'] : ['bpt'];

// --- Streaming-input turn release ------------------------------------------------
// Long-conversation tasks feed 3 user turns through an AsyncIterable; turn
// N+1 is released only after turn N's completion is visible on the PUBLIC
// stream. Completion is counted as max(result messages, assistant messages
// with stop_reason end_turn) so either per-turn encoding an engine uses
// satisfies the barrier; if neither shows up the barrier fails LOUDLY
// (settle-barrier discipline - never a silent skip).
function makeTurnSync(barrierMs) {
  let results = 0;
  let endTurns = 0;
  const waiters = [];
  const completed = () => Math.max(results, endTurns);
  const flush = () => {
    for (const w of [...waiters]) w();
  };
  return {
    onMessage(msg) {
      if (msg?.type === 'result') results += 1;
      else if (msg?.type === 'assistant' && msg.message?.stop_reason === 'end_turn') endTurns += 1;
      else return;
      flush();
    },
    waitForCompletions(n) {
      if (completed() >= n) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `turn-release barrier: completion #${n} not observed within ${barrierMs}ms ` +
                  '(loud fail - the engine emitted neither a per-turn result nor an end_turn assistant message)',
              ),
            ),
          barrierMs,
        );
        waiters.push(() => {
          if (completed() >= n) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    },
  };
}

async function* streamTurns(texts, sync) {
  for (let i = 0; i < texts.length; i++) {
    if (i > 0) await sync.waitForCompletions(i);
    yield {
      type: 'user',
      session_id: '', // stamped by the SDK
      parent_tool_use_id: null,
      message: { role: 'user', content: texts[i] },
    };
  }
}

// --- Smoke mode: scripted replies against the M1 content-blind emulator ----------
// Three representatives, one per harness surface: chat-01 (pure text
// result), document-02 (real Edit tool + fs sentinel check), longconv-01
// (3-turn streaming input + turn-release barrier). Scripts live HERE, not in
// the task library - the library stays pure real-API semantics.
// (SMOKE_TASK_IDS is declared above the task-selection block.)

// allowedTools instead of bypassPermissions: the official claude-code
// refuses bypass when running as root without IS_SANDBOX=1 - the same CI
// risk L3 documented. Real rounds keep the ab-benchmark house options.
const SMOKE_ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

/**
 * Scripted tool turn with UNIQUE tool_use ids per turn (L3 rationale: the
 * M1 toolUseReply reuses toolu_conf_N every turn, ambiguous in multi-turn
 * chains where tool_use_id is the correlation key).
 */
function toolTurn(turnNo, calls) {
  const events = [
    {
      type: 'message_start',
      message: {
        id: `msg_l5_t${turnNo}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-conformance-1',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    },
  ];
  calls.forEach((call, i) => {
    events.push(
      { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: `toolu_l5_t${turnNo}_${i + 1}`, name: call.name, input: {} } },
      { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } },
      { type: 'content_block_stop', index: i },
    );
  });
  events.push(
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  );
  return { kind: 'sse', events };
}

const text = (t, turnNo) => ({ kind: 'sse', events: textReply(t, { id: `msg_l5_t${turnNo}` }) });

const SMOKE_SCRIPTS = {
  'chat-01': () => [text('145', 1)],
  'document-02': (cwd) => [
    // Read-before-Edit: the official Edit tool rejects edits to unread files.
    toolTurn(1, [{ name: 'Read', input: { file_path: join(cwd, 'tasks.md') } }]),
    toolTurn(2, [
      {
        name: 'Edit',
        input: {
          file_path: join(cwd, 'tasks.md'),
          old_string: 'deploy | pending',
          new_string: 'deploy | done',
        },
      },
    ]),
    text('Updated only the deploy row.', 3),
  ],
  'longconv-01': (cwd) => [
    text('Acknowledged. Code word noted.', 1),
    toolTurn(2, [{ name: 'Write', input: { file_path: join(cwd, 'note.txt'), content: 'placeholder' } }]),
    text('note.txt created.', 3),
    toolTurn(4, [{ name: 'Write', input: { file_path: join(cwd, 'note.txt'), content: 'CRIMSON-7' } }]),
    text('note.txt now holds the code word.', 5),
  ],
};

/** Emulator-pointed env with inherited session identity scrubbed (run-l2/l4). */
function smokeEnv(emulatorUrl) {
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
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_SSE_PORT;
  delete env.CLAUDECODE;
  return env;
}

// --- Single run -------------------------------------------------------------------

/**
 * S2 stray-artifact sweep (first-round dissection, KD-L5-01): the official
 * arm sometimes anchors task-artifact writes at the tmpdir ROOT
 * (/tmp/<name>) instead of the sandbox cwd. A leftover from repeat N then
 * steers repeat N+1 into verifying at the wrong location - the
 * read-before-write gate plus a pre-existing correct file removes the
 * ENOENT self-rescue signal a clean tmpdir provides. Sweeping the
 * task-declared basenames before AND after every run restores per-run
 * independence; only exact, task-owned basenames are ever touched, and
 * pass semantics stay byte-identical (checks still read only the sandbox).
 */
function sweepStrays(task) {
  const removed = [];
  for (const name of task.strays ?? []) {
    const p = join(tmpdir(), name);
    try {
      if (statSync(p, { throwIfNoEntry: false })?.isFile()) {
        rmSync(p, { force: true });
        removed.push(p);
      }
    } catch {
      // A sweep that cannot stat/remove must never fail the run - the worst
      // case is the pre-fix behavior (a stray survives), which the post-run
      // row surfaces via strayArtifacts on the NEXT run's pre-sweep.
    }
  }
  return removed;
}

/**
 * One (arm, task, repeat) run in a throwaway mkdtemp cwd. Returns metrics +
 * the raw PUBLIC message array (for L6 retention; the caller drops it before
 * the row enters the report). The pass decision runs BEFORE cleanup because
 * fs-decidable checks read the sandbox.
 */
async function runOne(arm, task) {
  const preStrays = sweepStrays(task);
  if (preStrays.length > 0)
    console.warn(`run-l5: pre-run sweep removed stray artifact(s): ${preStrays.join(', ')}`);
  const dir = mkdtempSync(join(tmpdir(), `l5-${SMOKE ? 'smoke-' : ''}${arm}-${task.id}-`));
  if (typeof task.fixture === 'function') task.fixture(dir);

  const messages = [];
  const resultMsgs = [];
  const sync = makeTurnSync(SMOKE ? 60_000 : 240_000);
  const ac = new AbortController();
  // Loud-fail run barrier only - never asserted on (deterministic-test
  // discipline); streaming tasks get headroom for three agentic turns.
  const runBarrierMs = SMOKE ? 120_000 : task.turns ? 420_000 : 300_000;
  const timer = setTimeout(() => ac.abort(), runBarrierMs);

  const started = Date.now();
  let emulator;
  let lastResult;
  let finalText = '';
  let error;
  let verifyOk;
  try {
    let modeOptions;
    if (SMOKE) {
      emulator = await startEmulator(SMOKE_SCRIPTS[task.id](dir));
      modeOptions = {
        env: smokeEnv(emulator.url),
        allowedTools: SMOKE_ALLOWED_TOOLS,
        ...(arm === 'bpt' ? { sessionDir: join(dir, '.sessions') } : {}),
      };
    } else {
      // ab-benchmark house options: the BPT arm runs the real shipped
      // harness (claude_code preset - what an actual integration gets); the
      // official engine ships its own prompt, nothing extra passed.
      modeOptions = {
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        ...(arm === 'bpt' ? { systemPrompt: { type: 'preset', preset: 'claude_code' } } : {}),
        // Fix-2: identical explicit thinking budget on BOTH arms when set.
        ...(THINKING_SET ? { maxThinkingTokens: THINKING } : {}),
      };
    }
    const q = queryOf(arm)({
      prompt: task.turns ? streamTurns(task.turns, sync) : task.prompt,
      options: {
        abortController: ac,
        model: MODEL,
        cwd: dir,
        maxTurns: 8,
        ...modeOptions,
        ...(task.options ?? {}),
      },
    });
    for await (const msg of q) {
      messages.push(msg);
      sync.onMessage(msg);
      if (msg.type === 'assistant') {
        const t = (Array.isArray(msg.message?.content) ? msg.message.content : [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('');
        if (t.length > 0) finalText = t;
      } else if (msg.type === 'result') {
        lastResult = msg;
        resultMsgs.push(msg);
      }
    }
    // Code tasks execute the produced module - must run while the sandbox
    // still exists; a throwing verify counts as fail (house discipline).
    if (typeof task.verify === 'function') {
      try {
        verifyOk = (await task.verify(dir)) === true;
      } catch {
        verifyOk = false;
      }
    }
  } catch (err) {
    error = String(err?.message ?? err).slice(0, 300);
  } finally {
    clearTimeout(timer);
    if (emulator) await emulator.close();
  }

  // Pass decision BEFORE cleanup (fs-decidable checks read dir); the sandbox
  // is removed in the inner finally no matter what the check does.
  let passed = false;
  try {
    if (lastResult?.subtype === 'success') {
      if (typeof task.verify === 'function') passed = verifyOk === true;
      else if (typeof task.check === 'function') {
        try {
          passed = task.check(finalText, lastResult, dir) === true;
        } catch {
          passed = false;
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // Post-run sweep doubles as an observation: anything removed here is
  // positive evidence THIS run wrote a task artifact at the tmpdir root
  // (the KD-L5-01 anchoring behavior), surfaced on the row instead of
  // silently poisoning the next repeat.
  const strayArtifacts = sweepStrays(task);
  if (strayArtifacts.length > 0)
    console.warn(`run-l5: [${arm}] ${task.id} left stray artifact(s) at tmpdir root (KD-L5-01): ${strayArtifacts.join(', ')}`);

  // Multi-result aggregation: the rule lives in l5-aggregate.mjs (extracted
  // 2026-07-05 so it is unit-tested against REAL trace sequences in
  // tests/conformance-l5-aggregate.test.ts - the runner logic itself gets a
  // self-test instead of first executing its sum path in a paid round).
  return {
    arm,
    task: task.id,
    dimension: task.dimension,
    passed,
    error,
    ...aggregateRunMetrics(resultMsgs),
    wallMs: Date.now() - started,
    finalTextHead: finalText.slice(0, 160),
    ...(strayArtifacts.length > 0 ? { strayArtifacts } : {}),
    messages, // dropped by the caller after L6 retention
  };
}

// --- L6 trace retention ---------------------------------------------------------

let tracesWritten = { official: 0, bpt: 0 };

/**
 * Serialize one run's PUBLIC SDKMessage stream. Field name is deliberately
 * `publicStream`, NOT `messages`: assertContentBlind treats a top-level
 * '"messages":' key as the structural marker of a leaked request body, and
 * this artifact must both be and look like a public-stream observation.
 */
function writeTrace(arm, task, repeatIdx, run) {
  const dir = join(TRACE_ROOT, arm);
  mkdirSync(dir, { recursive: true });
  const payload = {
    generated_for: 'bpt-agent-sdk conformance L6 (official-arm public-stream trace retention)',
    boundary: 'PUBLIC SDKMessage stream as received by our consumer loop - request bodies are never read or persisted',
    arm,
    task: task.id,
    repeat: repeatIdx + 1,
    mode: SMOKE ? 'smoke' : 'real',
    model: MODEL,
    at: new Date().toISOString(),
    publicStream: run.messages,
  };
  const serialized = JSON.stringify(payload, null, 2);
  assertContentBlind(serialized); // audit every trace, not just the report
  writeFileSync(join(dir, `${SMOKE ? 'smoke-' : ''}${task.id}-r${repeatIdx + 1}.json`), serialized);
  tracesWritten[arm] += 1;
}

// --- Main loop: task-major, arms innermost ----------------------------------------
// Pairing bpt/official per repeat keeps a budget-aborted partial report
// comparable per task; the 5-min prefix-cache TTL is refreshed for both
// arms every ~2 runs, so scenario (a) locality survives the interleave.

const runsPlanned = selected.reduce((s, t) => s + effRepeat(t), 0) * ARMS.length;
console.log(
  `run-l5 [${SMOKE ? 'SMOKE (emulator, zero spend)' : 'REAL API'}] model=${MODEL} ` +
    `tasks=${selected.length} arms=${ARMS.join('+')} plannedRuns=${runsPlanned}` +
    (THINKING_SET ? ` thinking=${THINKING} (both arms pinned)` : '') +
    (SMOKE ? '' : ` repeat=${REPEAT}${ECON ? ' (econ overrides on)' : ''} budget=$${BUDGET_USD}`),
);

const rows = [];
let spentUsd = 0;
let runsDone = 0;
let budgetAborted = false;

outer: for (const task of selected) {
  const reps = effRepeat(task);
  for (let r = 0; r < reps; r++) {
    for (const arm of ARMS) {
      let run;
      try {
        run = await runOne(arm, task);
      } catch (err) {
        // Harness-level crash: counted as a failed run, never dropped -
        // dropping would silently inflate the arm's pass rate.
        run = {
          arm,
          task: task.id,
          dimension: task.dimension,
          passed: false,
          subtype: 'harness-error',
          error: String(err?.message ?? err).slice(0, 300),
          turns: 0,
          costUsd: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          wallMs: 0,
          messages: [],
        };
      }
      // L6: official-arm traces always (zero-cost retention hook);
      // ours only on request. Retention happens before the row is slimmed.
      if (arm === 'official' || (arm === 'bpt' && TRACE_BPT)) {
        try {
          writeTrace(arm, task, r, run);
        } catch (err) {
          // Review finding: one trace-write failure must not vaporize a
          // budget-spent round - record and continue, the run row stands.
          run.traceError = String(err?.message ?? err).slice(0, 200);
          console.warn(`run-l5: trace write failed for ${arm}/${task.id} r${r + 1}: ${run.traceError}`);
        }
      }
      delete run.messages;
      run.repeat = r + 1;
      rows.push(run);
      runsDone += 1;
      // Review finding: runs that die without a result message report
      // costUsd 0 although real spend happened - count them at the median
      // of observed run costs (fallback: a conservative flat estimate) so
      // the budget guard cannot be starved blind by aborted/hung runs.
      let charge = run.costUsd ?? 0;
      if (!SMOKE && charge === 0 && (run.error || run.subtype === 'no-result')) {
        const seen = rows.map((x) => x.costUsd).filter((c) => c > 0).sort((a, b) => a - b);
        charge = seen.length > 0 ? seen[Math.floor(seen.length / 2)] : 0.02;
        run.costEstimated = charge;
      }
      spentUsd += charge;
      console.log(
        `[${arm}] ${task.id} r${r + 1}: ${run.passed ? 'ok' : `FAIL(${run.subtype})`} ` +
          `turns=${run.turns} cost=$${(run.costUsd ?? 0).toFixed(4)} ` +
          `cache(w/r)=${run.cacheCreationTokens}/${run.cacheReadTokens}` +
          (run.error ? ` error: ${run.error}` : ''),
      );
      // Budget guard from ACTUAL usage. First-round CI lesson (run
      // 28735894053, 2026-07-05): a naive linear projection from the first
      // TWO cache-cold runs extrapolated $2.58 and aborted a round whose
      // warm-cache reality fits the cap - so (1) never project before a
      // minimum sample, only hard-stop on ACTUAL spend; (2) past the sample,
      // extrapolate from the MEDIAN of the most recent half of runs (the
      // cache-warm representative), not the all-time mean.
      if (!SMOKE && runsDone < runsPlanned) {
        const MIN_PROJECTION_SAMPLE = 8;
        let projected = null;
        if (spentUsd >= BUDGET_USD) {
          projected = spentUsd;
        } else if (runsDone >= MIN_PROJECTION_SAMPLE) {
          const recent = rows
            .slice(-Math.ceil(rows.length / 2))
            .map((x) => x.costUsd || 0)
            .filter((c) => c > 0)
            .sort((a, b) => a - b);
          const perRun = recent.length > 0 ? recent[Math.floor(recent.length / 2)] : spentUsd / runsDone;
          projected = spentUsd + perRun * (runsPlanned - runsDone);
        }
        if (projected !== null && projected > BUDGET_USD) {
          budgetAborted = true;
          console.error(
            `\nBUDGET GUARD: spent $${spentUsd.toFixed(4)} after ${runsDone}/${runsPlanned} runs ` +
              `-> projected $${projected.toFixed(2)} exceeds the $${BUDGET_USD} cap. ` +
              'Aborting cleanly with a partial report. Mitigations: --econ (repeatOverride ' +
              'downgrade on low-variance tasks) and/or shard with --tasks across dispatches.',
          );
          break outer;
        }
      }
    }
  }
}

// --- Aggregation + gate B ---------------------------------------------------------

function armAggregate(arm) {
  const armRows = rows.filter((r) => r.arm === arm);
  const passes = armRows.filter((r) => r.passed).length;
  return {
    runs: armRows.length,
    passes,
    passRate: armRows.length > 0 ? passes / armRows.length : null,
  };
}

const aggregate = { bpt: armAggregate('bpt') };
if (officialSdk) aggregate.official = armAggregate('official');

let gateVerdict;
if (!officialSdk || (aggregate.official?.runs ?? 0) === 0 || aggregate.bpt.runs === 0) {
  gateVerdict = 'INCONCLUSIVE-NO-COMPARISON';
} else if (budgetAborted) {
  // A partial round still reports rates but must not certify the gate.
  gateVerdict = 'INCONCLUSIVE-PARTIAL';
} else {
  // Epsilon absorbs float noise in passes/runs arithmetic at the 5pp edge.
  gateVerdict =
    aggregate.bpt.passRate + 1e-9 >= aggregate.official.passRate - TOLERANCE_PP / 100
      ? 'PASS'
      : 'FAIL';
}
const deltaPp =
  aggregate.official?.passRate != null && aggregate.bpt.passRate != null
    ? (aggregate.bpt.passRate - aggregate.official.passRate) * 100
    : null;

// Per-task summary: pass counts + REPORT-ONLY efficiency medians per arm.
const taskSummaries = selected.map((task) => {
  const perArm = {};
  for (const arm of ARMS) {
    const sub = rows.filter((r) => r.arm === arm && r.task === task.id);
    if (sub.length === 0) continue;
    perArm[arm] = {
      runs: sub.length,
      passes: sub.filter((r) => r.passed).length,
      medianTurns: median(sub.map((r) => r.turns)),
      medianCostUsd: median(sub.map((r) => r.costUsd)),
      medianWallMs: median(sub.map((r) => r.wallMs)),
    };
  }
  return {
    id: task.id,
    dimension: task.dimension,
    zh: task.zh === true,
    repeats: effRepeat(task),
    estTurns: task.estTurns,
    // Standing per-task explanations (L5_KNOWN_DIFFERENCES) ride next to the
    // pass counts so a report reader never mistakes a documented KD for a
    // fresh regression. Report-only - gate B ignores them.
    ...(Array.isArray(task.kd) && task.kd.length > 0 ? { kd: task.kd } : {}),
    arms: perArm,
  };
});

// Cache diagnosis per arm (ab-benchmark house): identifies which budget
// scenario (a/b/c from the header) this round actually ran under.
const cache = {};
for (const arm of ARMS) {
  const sub = rows.filter((r) => r.arm === arm);
  const creation = sub.reduce((s, r) => s + (r.cacheCreationTokens ?? 0), 0);
  const read = sub.reduce((s, r) => s + (r.cacheReadTokens ?? 0), 0);
  cache[arm] = {
    cacheCreationTokens: creation,
    cacheReadTokens: read,
    diagnosis:
      creation === 0 && read === 0
        ? 'cache_control NOT engaging server-side (scenario c: no writes, no reads)'
        : creation > 0 && read === 0
          ? 'writes happen but reads miss - prefix drifts across runs (scenario b)'
          : 'caching working: writes + reads present (scenario a, the design point)',
  };
}

// --- Report + mandatory self-audit ------------------------------------------------

const pins = JSON.parse(readFileSync(join(HERE, 'pins.json'), 'utf8'));
const report = {
  generated_for:
    'bpt-agent-sdk conformance L5 (five-dimension task library, gate B) + L6 trace retention',
  pins: { agentSdk: pins.agentSdk, claudeCode: pins.claudeCode },
  mode: SMOKE ? 'smoke' : 'real',
  model: MODEL,
  repeat: REPEAT,
  econ: ECON,
  // Fix-2 audit trail: null = engines ran their own thinking defaults.
  thinkingBudget: THINKING_SET ? THINKING : null,
  taskFilter: typeof args.tasks === 'string' ? args.tasks : null,
  gate: {
    rule: 'aggregate pass-rate over all task-repeats: bpt >= official - 5pp (single tasks may trade wins)',
    tolerancePp: TOLERANCE_PP,
    enabled: GATE,
    verdict: gateVerdict,
    deltaPp,
  },
  efficiencyAxes: 'turns/cost/wall are REPORTED ONLY - never gated (blueprint §二)',
  budget: {
    capUsd: BUDGET_USD,
    spentUsd,
    runsDone,
    runsPlanned,
    aborted: budgetAborted,
  },
  aggregate,
  knownDifferences: L5_KNOWN_DIFFERENCES,
  tasks: taskSummaries,
  runs: rows,
  cache,
  l6: {
    traceDir: 'l5-traces/',
    officialTraces: tracesWritten.official,
    bptTraces: tracesWritten.bpt,
    note: 'public SDKMessage streams only (legal observation surface); no gate ever attaches to L6',
  },
};

const serialized = JSON.stringify(report, null, 2);
assertContentBlind(serialized);
writeFileSync(OUT, serialized);

// --- Human-readable summary ---------------------------------------------------------

console.log('\n| task | dim | zh | pass b/o | turns b/o | cost $ b/o | wall ms b/o |');
console.log('|---|---|---|---|---|---|---|');
for (const t of taskSummaries) {
  const f = (arm, k, digits) => {
    const a = t.arms[arm];
    if (!a) return '-';
    const v = a[k];
    return digits !== undefined ? v.toFixed(digits) : String(v);
  };
  const pass = (arm) => (t.arms[arm] ? `${t.arms[arm].passes}/${t.arms[arm].runs}` : '-');
  console.log(
    `| ${t.id} | ${t.dimension} | ${t.zh ? 'zh' : ''} | ${pass('bpt')}/${pass('official')} | ` +
      `${f('bpt', 'medianTurns')}/${f('official', 'medianTurns')} | ` +
      `${f('bpt', 'medianCostUsd', 4)}/${f('official', 'medianCostUsd', 4)} | ` +
      `${Math.round(t.arms.bpt?.medianWallMs ?? 0)}/${Math.round(t.arms.official?.medianWallMs ?? 0)} |`,
  );
}

console.log('\nCache diagnosis (budget scenario identification):');
for (const arm of ARMS) {
  console.log(
    `  [${arm}] writes=${cache[arm].cacheCreationTokens} reads=${cache[arm].cacheReadTokens} => ${cache[arm].diagnosis}`,
  );
}

const rate = (a) => (a?.passRate != null ? `${(a.passRate * 100).toFixed(1)}%` : 'n/a');
console.log(
  `\nGate B: bpt ${aggregate.bpt.passes}/${aggregate.bpt.runs} (${rate(aggregate.bpt)}) vs ` +
    `official ${aggregate.official?.passes ?? '-'}/${aggregate.official?.runs ?? '-'} ` +
    `(${rate(aggregate.official)}), delta ${deltaPp === null ? 'n/a' : deltaPp.toFixed(1) + 'pp'}, ` +
    `tolerance -${TOLERANCE_PP}pp => ${gateVerdict}${GATE ? '' : ' (report-only; --gate to enforce)'}`,
);
console.log(
  `spent $${spentUsd.toFixed(4)} over ${runsDone}/${runsPlanned} runs` +
    (budgetAborted ? ' (BUDGET-ABORTED partial round)' : ''),
);
console.log(
  `L6 traces: official=${tracesWritten.official} bpt=${tracesWritten.bpt} under l5-traces/`,
);
console.log(`report: ${OUT}`);
console.log('content-blind self-audit: PASS');

// --- Exit semantics (header contract) ----------------------------------------------

if (SMOKE) {
  const bptFailures = rows.filter((r) => r.arm === 'bpt' && !r.passed);
  if (bptFailures.length > 0) {
    console.error(
      `\nFAIL: ${bptFailures.length} BPT-arm smoke failure(s) - scripted determinism ` +
        `means this is a harness/engine regression: ${bptFailures.map((r) => r.task).join(', ')}`,
    );
    process.exit(1);
  }
  const offFailures = rows.filter((r) => r.arm === 'official' && !r.passed);
  if (offFailures.length > 0) {
    console.error(
      `INFO: ${offFailures.length} official-arm smoke failure(s) (reported, differential finding): ` +
        offFailures.map((r) => r.task).join(', '),
    );
  }
}
if (GATE && gateVerdict !== 'PASS') {
  // A budget stop is a RESOURCE decision, not a conformance verdict - first
  // CI round conflated the two (exit 1 on INCONCLUSIVE-PARTIAL read as a
  // gate breach). Only a real FAIL, or an inconclusive round that was NOT
  // budget-bounded, reds the job.
  if (budgetAborted && gateVerdict === 'INCONCLUSIVE-PARTIAL') {
    console.error(`\nGATE B: verdict ${gateVerdict} due to the budget stop - partial evidence reported, NOT a breach (exit 0). Re-run with --econ / lower repeat / sharding for a full round.`);
  } else {
    console.error(`\nGATE B BREACH: verdict ${gateVerdict} with --gate enabled - exiting 1.`);
    process.exit(1);
  }
}
process.exit(0);
