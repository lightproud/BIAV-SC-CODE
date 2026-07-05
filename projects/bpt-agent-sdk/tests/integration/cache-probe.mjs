/**
 * Controlled prompt-cache probe (get-the-truth diagnostic).
 *
 * Runs ONE multi-turn task N times BACK-TO-BACK and prints, per turn, the
 * cache_creation (write) and cache_read (read) token counts from
 * result.metrics.perTurn. This answers the open question the A/B could not:
 *   - within a run: does turn 2+ READ the prefix turn 1 WROTE? (cross-turn)
 *   - across runs:  does run 2/3's turn 1 READ what run 1 wrote? (cross-request,
 *                   same org, identical stable prefix, within the 5-min TTL)
 *
 * If reads stay 0 even here, the stable prefix genuinely is not being reused
 * (a real gap); if reads appear on later turns/runs, the A/B's 0% was a
 * short-single-run artifact. No theorizing — the per-turn numbers decide.
 *
 * Usage: ANTHROPIC_API_KEY=... node tests/integration/cache-probe.mjs \
 *   [--model=claude-haiku-4-5-20251001] [--runs=3] [--variant=v1|v4]
 * Exit: 0 ok, 2 no key (skipped).
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const eq = a.indexOf('=');
    return eq === -1 ? [a.slice(2), true] : [a.slice(2, eq), a.slice(eq + 1)];
  }),
);
const MODEL = typeof args.model === 'string' ? args.model : 'claude-haiku-4-5-20251001';
const RUNS = Math.max(1, Number.parseInt(args.runs, 10) || 3);
const VARIANT = ['v1', 'v2', 'v3', 'v4', 'v5'].includes(args.variant) ? args.variant : undefined;
// --big: inflate the system prompt COMFORTABLY above the 2048 Haiku floor
// (~4500 tokens of filler) to test whether caching becomes reliable when the
// stable prefix is big (like the official's), isolating "marginal-size zone"
// from a deeper defect. Diagnostic only — never a shipped prompt.
const BIG = args.big === true || args.big === 'true';
const BIG_APPEND = 'Additional standing operating guidance for this session. '.repeat(600);

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('cache-probe: no ANTHROPIC_API_KEY, skipping (exit 2).');
  process.exit(2);
}

const sdk = await import('../../dist/index.js');

// A multi-turn task: read a file, then edit it (~3 turns) — the same shape as
// benchmark task 10 that showed 4140/0. Fresh cwd per run so we test whether
// the cwd-independent STABLE prefix is reused across runs.
function seed(dir) {
  fs.writeFileSync(
    path.join(dir, 'calc.mjs'),
    'export function total(xs) {\n  let sum = 1; // bug: should be 0\n  for (const x of xs) sum += x;\n  return sum;\n}\n',
  );
}
const PROMPT =
  'There is a bug in calc.mjs: total([1,2,3,4]) should return 10 but does not. ' +
  'Read the file, then fix the bug with Edit so it returns the correct sum.';

async function runOnce(i) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cacheprobe-${i}-`));
  seed(dir);
  let resultMsg;
  try {
    const q = sdk.query({
      prompt: PROMPT,
      options: {
        model: MODEL,
        cwd: dir,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 8,
        persistSession: false,
        // A harnessPromptVariant only takes effect on the claude_code preset
        // path, so selecting a variant REQUIRES also selecting the preset (else
        // the minimal default prompt is used and the variant is ignored).
        ...(BIG
          ? { systemPrompt: { type: 'preset', preset: 'claude_code', append: BIG_APPEND } }
          : VARIANT
            ? {
                harnessPromptVariant: VARIANT,
                systemPrompt: { type: 'preset', preset: 'claude_code' },
              }
            : {}),
      },
    });
    for await (const msg of q) {
      if (msg.type === 'result') resultMsg = msg;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return resultMsg;
}

console.log(
  `cache-probe: model=${MODEL} ${BIG ? 'BIG-prefix(~4.5k tok filler)' : `variant=${VARIANT ?? 'v1(default)'}`} runs=${RUNS}, back-to-back\n`,
);
let firstRunWroteAt = null;
for (let i = 1; i <= RUNS; i++) {
  const r = await runOnce(i);
  const per = r?.metrics?.perTurn ?? [];
  console.log(`--- run ${i} (${r?.subtype}) ---`);
  console.log('  turn | input | cache_write | cache_read | apiMs');
  for (const t of per) {
    const u = t.usage;
    console.log(
      `  ${String(t.index).padStart(4)} | ${String(u.input_tokens).padStart(5)} | ` +
        `${String(u.cache_creation_input_tokens).padStart(11)} | ` +
        `${String(u.cache_read_input_tokens).padStart(10)} | ${Math.round(t.apiMs)}`,
    );
    if (firstRunWroteAt === null && u.cache_creation_input_tokens > 0) firstRunWroteAt = `run${i}/turn${t.index}`;
  }
  const totW = per.reduce((s, t) => s + t.usage.cache_creation_input_tokens, 0);
  const totR = per.reduce((s, t) => s + t.usage.cache_read_input_tokens, 0);
  console.log(`  run ${i} totals: write=${totW} read=${totR} turns=${per.length}`);
}
console.log(
  `\nverdict: first cache WRITE at ${firstRunWroteAt ?? 'never'}. ` +
    `If later turns/runs show cache_read > 0, the stable prefix IS reused ` +
    `(A/B 0% was a short-single-run artifact). If read stays 0 across all ` +
    `runs despite writes, cross-request reuse is genuinely not happening.`,
);
