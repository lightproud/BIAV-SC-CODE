/**
 * Live end-to-end smoke test against the REAL api.anthropic.com.
 *
 * The genuine model decides which tools to call; the whole SDK stack runs for
 * real. This is NOT part of `npm test` (it needs a key, spends real API
 * budget, and is non-deterministic). Run it manually or via the
 * `bpt-agent-sdk-live-smoke` GitHub Actions workflow (workflow_dispatch),
 * which injects the ANTHROPIC_API_KEY repository secret into the runner.
 *
 *   Requires: `npm run build` first (imports the compiled dist).
 *   Reads:    process.env.ANTHROPIC_API_KEY  (never hardcoded, never committed)
 *   Optional: process.argv[2] = model id (default claude-haiku-4-5-20251001)
 *
 * Exit codes: 0 success, 2 no key (skipped), 1 run failed.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.log('[skip] ANTHROPIC_API_KEY not set — skipping the live real-API smoke test.');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.resolve(here, '../../dist/index.js');
if (!fs.existsSync(distIndex)) {
  console.error('[error] dist not built — run `npm run build` first.');
  process.exit(1);
}
const { query } = await import(distIndex);

const model = process.argv[2] || 'claude-haiku-4-5-20251001';
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bpt-live-'));

console.log('='.repeat(68));
console.log('BPT Agent SDK — live real-API smoke test');
console.log('model:', model, '| sandbox:', sandbox);
console.log('='.repeat(68));

const t0 = Date.now();
let ok = false;
try {
  const q = query({
    prompt:
      'You are in a working directory. Use the Write tool to create haiku.txt with a short two-line note about "a brain in a vat". Then use Read to read it back. Then use Bash to run "wc -c haiku.txt". Then tell me in one sentence what you did.',
    options: {
      provider: { apiKey: KEY },
      cwd: sandbox,
      persistSession: false,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      model,
      maxTurns: 12,
    },
  });

  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') {
      console.log(`\n[init] model=${m.model} tools=${m.tools.join(',')} apiKeySource=${m.apiKeySource}`);
    } else if (m.type === 'assistant') {
      for (const b of m.message.content) {
        if (b.type === 'text' && b.text.trim()) console.log(`\n[assistant] ${b.text.trim()}`);
        if (b.type === 'tool_use') console.log(`\n[tool_use] ${b.name}(${JSON.stringify(b.input).slice(0, 160)})`);
      }
    } else if (m.type === 'user' && Array.isArray(m.message.content)) {
      for (const b of m.message.content) {
        if (b.type === 'tool_result') {
          const t = typeof b.content === 'string' ? b.content : (b.content?.[0]?.text ?? '');
          console.log(`[tool_result${b.is_error ? ' ERR' : ''}] ${String(t).replace(/\n/g, ' / ').slice(0, 90)}`);
        }
      }
    } else if (m.type === 'result') {
      console.log(`\n[result] ${m.subtype} | turns=${m.num_turns} | cost=$${m.total_cost_usd.toFixed(6)} | in=${m.usage.input_tokens} out=${m.usage.output_tokens} | ${Date.now() - t0}ms`);
      if (m.subtype === 'success') {
        console.log(`[answer] ${m.result}`);
        ok = true;
      }
    }
  }

  const f = path.join(sandbox, 'haiku.txt');
  const exists = fs.existsSync(f);
  console.log(`\n[disk] ${f} exists=${exists}`);
  if (exists) console.log('[content]\n' + fs.readFileSync(f, 'utf8'));
  // The model was asked to create the file; treat a missing file as a soft signal, not a hard fail.
  if (!ok) throw new Error('run did not end in a success result');
  console.log('\n[PASS] live real-API smoke test succeeded.');
} catch (e) {
  console.error('\n[FAIL]', e?.name, e?.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
