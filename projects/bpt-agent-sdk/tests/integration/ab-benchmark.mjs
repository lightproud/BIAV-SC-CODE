/**
 * A/B efficiency benchmark over a representative task set (POSITIONING.md §7:
 * "复利效率不能估,得测" — the measurement mandate).
 *
 * Runs the SAME 7 tasks (5 English + 2 Chinese workloads) through an engine
 * and captures per-run efficiency metrics: turns, tokens, cost, cache hit
 * ratio, API time, per-tool timings. Output: a JSON report + a markdown table
 * + an offender ranking (most expensive tasks first, slowest tools first).
 *
 * Engines:
 *   --engine=bpt       this SDK's compiled dist (default; run `npm run build` first)
 *   --engine=official  `@anthropic-ai/claude-agent-sdk`, if the operator has
 *                      installed it (never a dependency of this package — the
 *                      comparison is run-twice-and-diff, no official code here)
 *
 * Compare two saved reports:
 *   node tests/integration/ab-benchmark.mjs --compare a.json b.json
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node tests/integration/ab-benchmark.mjs \
 *     [--engine=bpt] [--model=claude-haiku-4-5-20251001] [--out=ab-report.json] [--tasks=1,3,5]
 *
 * NOT part of `npm test`: needs a key, spends real API budget, is
 * non-deterministic. Exit codes: 0 success, 2 no key (skipped), 1 failure.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// --- CLI ---------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const eq = a.indexOf('=');
    return eq === -1 ? [a.slice(2), true] : [a.slice(2, eq), a.slice(eq + 1)];
  }),
);
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (args.compare === true && positional.length === 2) {
  compareReports(positional[0], positional[1]);
  process.exit(0);
}

const ENGINE = args.engine === 'official' ? 'official' : 'bpt';
const MODEL = typeof args.model === 'string' ? args.model : 'claude-haiku-4-5-20251001';
const OUT = typeof args.out === 'string' ? args.out : `ab-report-${ENGINE}.json`;
// --variant v1|v2: this SDK's harness-prompt variant (BPT experiment). Only
// meaningful for --engine=bpt; ignored by the official engine.
const VARIANT = ['v1', 'v2', 'v3', 'v4', 'v5'].includes(args.variant) ? args.variant : undefined;
// --repeat N: run each task N times and report the MEDIAN of the metrics
// (denoises single-sample outliers, e.g. one slow/retried turn). Default 1.
const REPEAT = Math.max(1, Number.parseInt(args.repeat, 10) || 1);

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ab-benchmark: no ANTHROPIC_API_KEY, skipping (exit 2).');
  process.exit(2);
}

// The official arm imports @anthropic-ai/claude-agent-sdk. It is NEVER a
// dependency of this package (black-box comparison discipline); CI installs it with
// `npm i --no-save` for the comparison run only. A missing package or a
// CLI-startup failure is reported as a skip (exit 2), not a crash — "the
// official engine could not start headless" is itself a finding (it is the
// whole reason BPT needs this SDK).
let sdk;
if (ENGINE === 'official') {
  try {
    sdk = await import('@anthropic-ai/claude-agent-sdk');
  } catch (err) {
    console.log(
      `ab-benchmark: could not load @anthropic-ai/claude-agent-sdk ` +
        `(${err instanceof Error ? err.message : String(err)}); skipping the ` +
        `official arm (exit 2). Install it with \`npm i --no-save\` for this run.`,
    );
    process.exit(2);
  }
} else {
  sdk = await import('../../dist/index.js');
}

// --- Representative task set ---------------------------------------------------
// Each task: fixture(dir) seeds files; prompt drives the model; check(text)
// loosely validates the outcome so a silently-broken run is not reported as a
// clean efficiency number.

const TASKS = [
  {
    id: 1,
    name: 'read-summarize (en)',
    fixture(dir) {
      fs.writeFileSync(
        path.join(dir, 'notes.md'),
        '# Sprint notes\n\nAction items:\n1. fix login bug\n2. update docs\n3. ship v2\n',
      );
    },
    prompt:
      'Read notes.md and answer: how many action items are listed? Reply with just the number.',
    check: (text) => text.includes('3'),
  },
  {
    id: 2,
    name: 'search-code (en)',
    fixture(dir) {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src/a.js'), 'export function helper() { return 1; }\n');
      fs.writeFileSync(
        path.join(dir, 'src/billing.js'),
        'export function computeTotal(items) { return items.length; }\n',
      );
    },
    prompt:
      'Find which file under src/ defines the function computeTotal and reply with just the file name.',
    check: (text) => text.includes('billing.js'),
  },
  {
    id: 3,
    name: 'write-edit cycle (en)',
    fixture() {},
    prompt:
      'Create config.json containing {"level": 1}, then use Edit to change level to 2, ' +
      'then read the file and reply with its final content.',
    check: (text) => text.includes('2'),
  },
  {
    id: 4,
    name: 'bash-pipeline (en)',
    fixture(dir) {
      fs.writeFileSync(path.join(dir, 'data.csv'), 'a,1\nb,2\nc,3\nd,4\n');
    },
    prompt: 'Using Bash, count the lines in data.csv and reply with just the count.',
    check: (text) => text.includes('4'),
  },
  {
    id: 5,
    name: 'zh-summarize (中文长文摘要)',
    fixture(dir) {
      fs.writeFileSync(
        path.join(dir, 'report_zh.md'),
        '# 社区季度报告\n\n本季度 Discord 消息量环比上升百分之四十，' +
          '主要讨论集中在新角色的技能机制与剧情走向。玩家对第九章的' +
          '叙事压缩表达了不满，但对新卡牌系统普遍好评。结论：社区活跃度' +
          '显著回升，叙事节奏是当前最大的负面反馈来源。\n',
      );
    },
    prompt: '阅读 report_zh.md，用一句中文概括它的结论。',
    check: (text) => /活跃|叙事|回升/.test(text),
  },
  {
    id: 6,
    name: 'zh-edit (中文改档)',
    fixture(dir) {
      fs.writeFileSync(
        path.join(dir, 'todo_zh.md'),
        '任务一：未完成\n任务二：未完成\n任务三：已完成\n',
      );
    },
    prompt: '把 todo_zh.md 里所有的「未完成」都改成「已完成」，然后读出文件内容确认。',
    check: (text) => !text.includes('未完成') || text.includes('已完成'),
  },
  {
    id: 7,
    name: 'structured-extract',
    fixture(dir) {
      fs.writeFileSync(
        path.join(dir, 'blurb.txt'),
        'Morimens (忘却前夜) is a dark-fantasy card game first released in 2024.\n',
      );
    },
    prompt: 'Read blurb.txt and extract the game title and release year.',
    options: {
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { title: { type: 'string' }, year: { type: 'number' } },
          required: ['title', 'year'],
        },
      },
    },
    check: (text, result) => {
      const so = result?.structured_output;
      return so !== undefined ? so.year === 2024 : text.includes('2024');
    },
  },
  // --- Long-conversation tasks (id >= 8) -------------------------------------
  // Force many sequential turns so prompt caching has repeated READ chances.
  // These directly test whether the observed 0% cache hit is a short-task
  // artifact (then it should climb here) or a real caching defect (then it
  // stays ~0 even across many turns). They need a higher maxTurns.
  {
    id: 8,
    name: 'long-chain files (en, many turns)',
    longConversation: true,
    fixture() {},
    options: { maxTurns: 24 },
    prompt:
      'Do these steps one at a time, using a tool for each: ' +
      'create step1.txt containing "1"; create step2.txt containing "2"; ' +
      'create step3.txt containing "3"; create step4.txt containing "4"; ' +
      'read step1.txt; read step2.txt; read step3.txt; read step4.txt; ' +
      'then reply with the sum of all four numbers.',
    check: (text) => text.includes('10'),
  },
  {
    id: 9,
    name: 'long-chain edits (zh, many turns)',
    longConversation: true,
    fixture(dir) {
      fs.writeFileSync(path.join(dir, 'ledger.txt'), 'a=1\nb=1\nc=1\nd=1\n');
    },
    options: { maxTurns: 24 },
    prompt:
      '逐步操作 ledger.txt，每步用一次工具：把 a 改成 10；把 b 改成 20；' +
      '把 c 改成 30；把 d 改成 40；然后读出文件，回复四个数的总和。',
    check: (text) => text.includes('100'),
  },
  // --- Hard tasks (id >= 10): can actually FAIL, so they discriminate quality.
  // These use `verify(dir)` (runs BEFORE cleanup) to exercise the produced code
  // for real, instead of a loose text `check`. This is where a prompt
  // improvement (verify-before-finishing, no-hard-coding) should show up.
  {
    id: 10,
    name: 'hard: find & fix a real bug',
    hard: true,
    options: { maxTurns: 12 },
    fixture(dir) {
      // total() has a bug: starts the sum at 1 instead of 0.
      fs.writeFileSync(
        path.join(dir, 'calc.mjs'),
        'export function total(xs) {\n  let sum = 1; // seed\n  for (const x of xs) sum += x;\n  return sum;\n}\n',
      );
    },
    prompt:
      'There is a bug in calc.mjs: total([1,2,3,4]) should return 10 but does not. ' +
      'Find and fix the bug in calc.mjs so it returns the correct sum for any array of numbers.',
    async verify(dir) {
      try {
        const m = await import(`file://${path.join(dir, 'calc.mjs')}?t=${Date.now()}`);
        // correct AND general: not hard-coded to the example input
        return (
          m.total([1, 2, 3, 4]) === 10 &&
          m.total([]) === 0 &&
          m.total([5, 5]) === 10 &&
          m.total([10]) === 10
        );
      } catch {
        return false;
      }
    },
  },
  {
    id: 11,
    name: 'hard: general solution (no hard-coding)',
    hard: true,
    options: { maxTurns: 12 },
    fixture() {},
    prompt:
      'Create prime.mjs exporting a function isPrime(n) that returns true if n is a prime ' +
      'number and false otherwise. It must work for any non-negative integer. ' +
      'For example isPrime(17) is true and isPrime(1) is false.',
    async verify(dir) {
      try {
        const m = await import(`file://${path.join(dir, 'prime.mjs')}?t=${Date.now()}`);
        const cases = [
          [1, false], [2, true], [3, true], [4, false], [17, true],
          [18, false], [19, true], [20, false], [0, false], [97, true],
        ];
        // A hard-coded `return n === 17` passes the example but fails here.
        return cases.every(([n, want]) => m.isPrime(n) === want);
      } catch {
        return false;
      }
    },
  },
];

const selected =
  typeof args.tasks === 'string'
    ? TASKS.filter((t) => args.tasks.split(',').map(Number).includes(t.id))
    : TASKS;

// --- Run ------------------------------------------------------------------------

async function runTask(task) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ab-${ENGINE}-t${task.id}-`));
  task.fixture(dir);
  const started = Date.now();
  let resultMsg;
  let finalText = '';
  let verifyOk;
  try {
    const q = sdk.query({
      prompt: task.prompt,
      options: {
        model: MODEL,
        cwd: dir,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 8,
        persistSession: false,
        // The BPT arm runs the real shipped harness: the claude_code preset,
        // whose default variant is v5 (the faithful official reproduction).
        // This makes the standalone A/B and the vs-official comparison reflect
        // what an actual integration gets, not a stripped-down prompt. A
        // harnessPromptVariant only takes effect on this preset path, so the
        // preset MUST be present (leaving it off silently ignored the variant —
        // the bug that made an earlier v1-vs-v4 run look identical). The
        // official engine ships its own prompt; we pass nothing extra to it.
        ...(ENGINE === 'bpt'
          ? {
              systemPrompt: { type: 'preset', preset: 'claude_code' },
              ...(VARIANT ? { harnessPromptVariant: VARIANT } : {}),
            }
          : {}),
        ...(task.options ?? {}),
      },
    });
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const t = msg.message.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('');
        if (t.length > 0) finalText = t;
      } else if (msg.type === 'result') {
        resultMsg = msg;
      }
    }
    // Hard tasks verify the PRODUCED code by executing it — must run BEFORE the
    // cleanup below removes the fixture dir. A verify that throws counts as fail.
    if (typeof task.verify === 'function') {
      try {
        verifyOk = (await task.verify(dir)) === true;
      } catch {
        verifyOk = false;
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const m = resultMsg?.metrics; // bpt extension; absent on the official SDK
  const usage = resultMsg?.usage ?? {};
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheable = (usage.input_tokens ?? 0) + cacheRead + cacheCreation;
  return {
    id: task.id,
    name: task.name,
    subtype: resultMsg?.subtype ?? 'no-result',
    error: resultMsg?.errorMessage,
    // Hard tasks (id >= 10) judge by executing the produced code (verifyOk);
    // the rest judge by the loose text `check`. A task with neither always fails.
    passed:
      resultMsg?.subtype === 'success' &&
      (typeof task.verify === 'function'
        ? verifyOk === true
        : typeof task.check === 'function'
          ? task.check(finalText, resultMsg) === true
          : false),
    turns: resultMsg?.num_turns ?? 0,
    costUsd: resultMsg?.total_cost_usd ?? 0,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    // Raw cache write/read split so a 0% ratio is diagnosable: creation>0 &&
    // read==0 => writes happen but reads miss (prefix drift); both 0 =>
    // cache_control not engaging server-side at all.
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    cacheHitRatio: m?.cacheHitRatio ?? (cacheable > 0 ? cacheRead / cacheable : 0),
    wallMs: Date.now() - started,
    durationMs: resultMsg?.duration_ms ?? Date.now() - started,
    apiMs: resultMsg?.duration_api_ms ?? 0,
    ttftMs: m?.ttftMs ?? resultMsg?.ttft_ms,
    perTool: m?.perTool ?? [],
  };
}

/** Run one task REPEAT times; return a row of MEDIAN metrics + pass fraction. */
async function runTaskRepeated(task) {
  const samples = [];
  for (let i = 0; i < REPEAT; i++) samples.push(await runTask(task));
  const pick = (k) => median(samples.map((s) => s[k]));
  const passedCount = samples.filter((s) => s.passed).length;
  return {
    id: task.id,
    name: task.name,
    longConversation: task.longConversation === true,
    samples: REPEAT,
    passRate: passedCount / REPEAT,
    passed: passedCount === REPEAT, // strict: every sample must pass
    subtype: samples[samples.length - 1]?.subtype,
    error: samples.find((s) => !s.passed)?.error,
    turns: pick('turns'),
    costUsd: pick('costUsd'),
    inputTokens: pick('inputTokens'),
    outputTokens: pick('outputTokens'),
    cacheCreationTokens: pick('cacheCreationTokens'),
    cacheReadTokens: pick('cacheReadTokens'),
    cacheHitRatio: pick('cacheHitRatio'),
    wallMs: pick('wallMs'),
    apiMs: pick('apiMs'),
    ttftMs: pick('ttftMs'),
    perTool: samples[samples.length - 1]?.perTool ?? [],
  };
}

const rows = [];
for (const task of selected) {
  const tag = REPEAT > 1 ? ` (median of ${REPEAT})` : '';
  process.stdout.write(`[${ENGINE}] task ${task.id}: ${task.name}${tag} ... `);
  try {
    const row = await runTaskRepeated(task);
    rows.push(row);
    console.log(
      `${row.passed ? 'ok' : `CHECK ${Math.round(row.passRate * 100)}%`} ` +
        `turns=${row.turns} cost=$${row.costUsd.toFixed(4)} ` +
        `cache(w/r)=${row.cacheCreationTokens}/${row.cacheReadTokens}`,
    );
    if (!row.passed && row.error !== undefined) {
      console.log(`    error(${row.subtype}): ${row.error}`);
    }
  } catch (err) {
    console.log(`ERROR ${err instanceof Error ? err.message : String(err)}`);
    rows.push({ id: task.id, name: task.name, subtype: 'harness-error', passed: false });
  }
}

// --- Report -----------------------------------------------------------------------

const report = {
  engine: ENGINE,
  model: MODEL,
  variant: VARIANT,
  repeat: REPEAT,
  at: new Date().toISOString(),
  tasks: rows,
  totals: {
    costUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0),
    turns: rows.reduce((s, r) => s + (r.turns ?? 0), 0),
    wallMs: rows.reduce((s, r) => s + (r.wallMs ?? 0), 0),
    apiMs: rows.reduce((s, r) => s + (r.apiMs ?? 0), 0),
    passed: rows.filter((r) => r.passed).length,
    of: rows.length,
  },
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`\n| # | task | ok | turns | cost $ | cache w/r | hit | api ms | wall ms |`);
console.log(`|---|------|----|-------|--------|-----------|-----|--------|---------|`);
for (const r of rows) {
  console.log(
    `| ${r.id} | ${r.name} | ${r.passed ? 'y' : `${Math.round((r.passRate ?? 0) * 100)}%`} | ` +
      `${r.turns ?? '-'} | ${(r.costUsd ?? 0).toFixed(4)} | ` +
      `${r.cacheCreationTokens ?? '-'}/${r.cacheReadTokens ?? '-'} | ` +
      `${r.cacheHitRatio !== undefined ? (r.cacheHitRatio * 100).toFixed(0) + '%' : '-'} | ` +
      `${Math.round(r.apiMs ?? 0)} | ${Math.round(r.wallMs ?? 0)} |`,
  );
}

// Cache diagnosis (answers "why is cacheHit 0%"): separate WRITE from READ.
const totCreate = rows.reduce((s, r) => s + (r.cacheCreationTokens ?? 0), 0);
const totRead = rows.reduce((s, r) => s + (r.cacheReadTokens ?? 0), 0);
console.log('\nCache diagnosis:');
console.log(`  total cache_creation (writes): ${totCreate}`);
console.log(`  total cache_read     (reads):  ${totRead}`);
if (totCreate === 0 && totRead === 0) {
  console.log('  => cache_control is NOT engaging server-side (no writes, no reads).');
} else if (totCreate > 0 && totRead === 0) {
  console.log('  => writes happen but reads miss: the cached prefix drifts across turns.');
} else {
  console.log('  => caching is working (writes + reads present).');
}

// Offender ranking: what to optimize first (POSITIONING §7 "按 offender 排序").
const byCost = [...rows].filter((r) => r.costUsd !== undefined).sort((a, b) => b.costUsd - a.costUsd);
const byTurns = [...rows].filter((r) => r.turns !== undefined).sort((a, b) => b.turns - a.turns);
const toolAgg = new Map();
for (const r of rows) {
  for (const t of r.perTool ?? []) {
    const e = toolAgg.get(t.name) ?? { calls: 0, totalMs: 0, errors: 0 };
    e.calls += t.calls;
    e.totalMs += t.totalMs;
    e.errors += t.errors;
    toolAgg.set(t.name, e);
  }
}
const slowTools = [...toolAgg.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 5);

console.log('\nOffenders:');
console.log(`  cost:  ${byCost.slice(0, 3).map((r) => `#${r.id} $${r.costUsd.toFixed(4)}`).join(', ')}`);
console.log(`  turns: ${byTurns.slice(0, 3).map((r) => `#${r.id} x${r.turns}`).join(', ')}`);
if (slowTools.length > 0) {
  console.log(`  tools: ${slowTools.map(([n, e]) => `${n} ${e.totalMs}ms/${e.calls} calls`).join(', ')}`);
}
console.log(
  `\ntotal: $${report.totals.costUsd.toFixed(4)}, ${report.totals.turns} turns, ` +
    `${Math.round(report.totals.wallMs)}ms wall, ${Math.round(report.totals.apiMs)}ms api, ` +
    `${report.totals.passed}/${report.totals.of} checks passed` +
    (REPEAT > 1 ? ` (median of ${REPEAT})` : '') +
    `\nreport: ${OUT}`,
);
process.exit(report.totals.passed === report.totals.of ? 0 : 1);

// --- Compare mode ------------------------------------------------------------------

function compareReports(fileA, fileB) {
  const a = JSON.parse(fs.readFileSync(fileA, 'utf8'));
  const b = JSON.parse(fs.readFileSync(fileB, 'utf8'));
  const byId = (rep) => new Map(rep.tasks.map((t) => [t.id, t]));
  const mb = byId(b);
  const rn = a.repeat || b.repeat ? ` (median of ${a.repeat ?? 1}/${b.repeat ?? 1})` : '';
  const va = a.variant ? `/${a.variant}` : '';
  const vb = b.variant ? `/${b.variant}` : '';
  console.log(`A=${a.engine}${va}(${a.model})  B=${b.engine}${vb}(${b.model})${rn}\n`);
  console.log('| # | task | ok A/B | turns A/B | cost A/B | wall ms A/B | cacheHit A/B |');
  console.log('|---|------|--------|-----------|----------|-------------|--------------|');
  for (const ta of a.tasks) {
    const tb = mb.get(ta.id);
    if (tb === undefined) continue;
    const pct = (x) => (x === undefined ? '-' : `${(x * 100).toFixed(0)}%`);
    const ok = (t) => (t.passed ? 'y' : `${Math.round((t.passRate ?? 0) * 100)}%`);
    console.log(
      `| ${ta.id} | ${ta.name} | ${ok(ta)}/${ok(tb)} | ${ta.turns}/${tb.turns} | ` +
        `${(ta.costUsd ?? 0).toFixed(4)}/${(tb.costUsd ?? 0).toFixed(4)} | ` +
        `${Math.round(ta.wallMs ?? 0)}/${Math.round(tb.wallMs ?? 0)} | ` +
        `${pct(ta.cacheHitRatio)}/${pct(tb.cacheHitRatio)} |`,
    );
  }
  const spd = (x) => Math.round(x ?? 0);
  console.log(
    `\ntotals  cost: ${a.totals.costUsd.toFixed(4)} vs ${b.totals.costUsd.toFixed(4)}   ` +
      `turns: ${a.totals.turns} vs ${b.totals.turns}   ` +
      `wall ms: ${spd(a.totals.wallMs)} vs ${spd(b.totals.wallMs)}   ` +
      `api ms: ${spd(a.totals.apiMs)} vs ${spd(b.totals.apiMs)}`,
  );
}
