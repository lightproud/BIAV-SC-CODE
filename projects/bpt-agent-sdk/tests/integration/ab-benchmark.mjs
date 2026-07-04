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

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ab-benchmark: no ANTHROPIC_API_KEY, skipping (exit 2).');
  process.exit(2);
}

const sdk =
  ENGINE === 'official'
    ? await import('@anthropic-ai/claude-agent-sdk')
    : await import('../../dist/index.js');

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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const m = resultMsg?.metrics; // bpt extension; absent on the official SDK
  const usage = resultMsg?.usage ?? {};
  const cacheable =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);
  return {
    id: task.id,
    name: task.name,
    subtype: resultMsg?.subtype ?? 'no-result',
    error: resultMsg?.errorMessage,
    passed: resultMsg?.subtype === 'success' && task.check(finalText, resultMsg) === true,
    turns: resultMsg?.num_turns ?? 0,
    costUsd: resultMsg?.total_cost_usd ?? 0,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheHitRatio:
      m?.cacheHitRatio ?? (cacheable > 0 ? (usage.cache_read_input_tokens ?? 0) / cacheable : 0),
    durationMs: resultMsg?.duration_ms ?? Date.now() - started,
    apiMs: resultMsg?.duration_api_ms ?? 0,
    ttftMs: m?.ttftMs ?? resultMsg?.ttft_ms,
    perTool: m?.perTool ?? [],
  };
}

const rows = [];
for (const task of selected) {
  process.stdout.write(`[${ENGINE}] task ${task.id}: ${task.name} ... `);
  try {
    const row = await runTask(task);
    rows.push(row);
    console.log(
      `${row.passed ? 'ok' : 'CHECK-FAILED'} turns=${row.turns} cost=$${row.costUsd.toFixed(4)}`,
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
  at: new Date().toISOString(),
  tasks: rows,
  totals: {
    costUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0),
    turns: rows.reduce((s, r) => s + (r.turns ?? 0), 0),
    passed: rows.filter((r) => r.passed).length,
    of: rows.length,
  },
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`\n| # | task | ok | turns | cost $ | in-tok | out-tok | cacheHit | api ms |`);
console.log(`|---|------|----|-------|--------|--------|---------|----------|--------|`);
for (const r of rows) {
  console.log(
    `| ${r.id} | ${r.name} | ${r.passed ? 'y' : 'N'} | ${r.turns ?? '-'} | ` +
      `${(r.costUsd ?? 0).toFixed(4)} | ${r.inputTokens ?? '-'} | ${r.outputTokens ?? '-'} | ` +
      `${r.cacheHitRatio !== undefined ? (r.cacheHitRatio * 100).toFixed(0) + '%' : '-'} | ${r.apiMs ?? '-'} |`,
  );
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
    `${report.totals.passed}/${report.totals.of} checks passed\nreport: ${OUT}`,
);
process.exit(report.totals.passed === report.totals.of ? 0 : 1);

// --- Compare mode ------------------------------------------------------------------

function compareReports(fileA, fileB) {
  const a = JSON.parse(fs.readFileSync(fileA, 'utf8'));
  const b = JSON.parse(fs.readFileSync(fileB, 'utf8'));
  const byId = (rep) => new Map(rep.tasks.map((t) => [t.id, t]));
  const mb = byId(b);
  console.log(`A=${a.engine}(${a.model})  B=${b.engine}(${b.model})\n`);
  console.log('| # | task | turns A/B | cost A/B | in-tok A/B | cacheHit A/B |');
  console.log('|---|------|-----------|----------|------------|--------------|');
  for (const ta of a.tasks) {
    const tb = mb.get(ta.id);
    if (tb === undefined) continue;
    const pct = (x) => (x === undefined ? '-' : `${(x * 100).toFixed(0)}%`);
    console.log(
      `| ${ta.id} | ${ta.name} | ${ta.turns}/${tb.turns} | ` +
        `${(ta.costUsd ?? 0).toFixed(4)}/${(tb.costUsd ?? 0).toFixed(4)} | ` +
        `${ta.inputTokens}/${tb.inputTokens} | ${pct(ta.cacheHitRatio)}/${pct(tb.cacheHitRatio)} |`,
    );
  }
  console.log(
    `\ntotals  cost: ${a.totals.costUsd.toFixed(4)} vs ${b.totals.costUsd.toFixed(4)}   ` +
      `turns: ${a.totals.turns} vs ${b.totals.turns}`,
  );
}
