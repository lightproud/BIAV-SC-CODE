/**
 * Per-file tokenizer probe (BPT i18n cost investigation, 2026-07-08).
 *
 * The single-file token-probe.mjs showed the tool-description prose inflates
 * 1.66x in Chinese on Haiku. But the v0.28.0 L5 round showed ~2.2-3.2x cache /
 * cost inflation — much more than the prose alone. To locate exactly which of
 * the 8 translated source files drives the cost, this probe count_tokens the
 * lexer-extracted EN vs ZH prompt strings of EACH file under Haiku (the L5
 * model) and reports per-file tokens + inflation, split by whether the file is
 * in the per-turn cached prefix (drives cache-read cost) or an auxiliary
 * one-shot call.
 *
 * Fixture: fixtures/i18n-prompt-blocks.json (char-walking lexer, 100% CJK
 *   capture verified against whole-file CJK). EN=@67e2b7dd ZH=@main.
 *
 * NOTE: this measures the SOURCE prompt strings per file, not the fully
 * assembled wire prefix (which also carries English tool JSON schemas + v5
 * assembly framing). It answers "which file's translation inflated most"; the
 * wire-prefix reconciliation is a separate step.
 *
 * Usage: ANTHROPIC_API_KEY=... node tests/integration/token-probe-perfile.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
if (!API_KEY) {
  console.error('token-probe-perfile: no ANTHROPIC_API_KEY — cannot count tokens.');
  process.exit(2);
}
const MODEL = process.argv.find((a) => a.startsWith('--model='))?.split('=')[1] || 'claude-haiku-4-5-20251001';

const { blocks } = JSON.parse(readFileSync(join(HERE, 'fixtures', 'i18n-prompt-blocks.json'), 'utf8'));
const cjk = (s) => [...s].filter((c) => c >= '一' && c <= '鿿').length;

async function countTokens(text) {
  if (!text) return 0;
  const res = await fetch(`${BASE_URL}/v1/messages/count_tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: text }] }),
  });
  if (!res.ok) throw new Error(`count_tokens ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return (await res.json()).input_tokens;
}

console.log(`token-probe-perfile: per-file EN vs ZH prompt tokens under ${MODEL} (count_tokens, $0)`);
console.log();
console.log('| file | inPrefix | EN tok | ZH tok | ratio | ZH CJK |');
console.log('|---|---|---|---|---|---|');

const rows = [];
for (const b of blocks) {
  try {
    const enTok = await countTokens(b.en);
    const zhTok = await countTokens(b.zh);
    rows.push({ ...b, enTok, zhTok });
    console.log(`| ${b.file.replace('src/', '')} | ${b.inPrefix} | ${enTok} | ${zhTok} | ${(zhTok / (enTok || 1)).toFixed(2)}x | ${cjk(b.zh)} |`);
  } catch (err) {
    console.log(`| ${b.file.replace('src/', '')} | ${b.inPrefix} | ERROR: ${String(err.message).slice(0, 60)} | | | |`);
  }
}

const sum = (rs, k) => rs.reduce((a, r) => a + (r[k] || 0), 0);
const prefix = rows.filter((r) => r.inPrefix);
const aux = rows.filter((r) => !r.inPrefix);
console.log();
console.log(`[cached-prefix files]  EN ${sum(prefix, 'enTok')} -> ZH ${sum(prefix, 'zhTok')} tok = ${(sum(prefix, 'zhTok') / (sum(prefix, 'enTok') || 1)).toFixed(2)}x`);
console.log(`[auxiliary/one-shot]   EN ${sum(aux, 'enTok')} -> ZH ${sum(aux, 'zhTok')} tok = ${(sum(aux, 'zhTok') / (sum(aux, 'enTok') || 1)).toFixed(2)}x`);
console.log(`[all translated files] EN ${sum(rows, 'enTok')} -> ZH ${sum(rows, 'zhTok')} tok = ${(sum(rows, 'zhTok') / (sum(rows, 'enTok') || 1)).toFixed(2)}x`);
console.log();
console.log(
  'Reconcile vs L5: the v0.28.0 round showed ~2.2x cost on 1-turn tasks and ~3.2x cache-reads on ' +
    'multi-turn tasks. If the cached-prefix-files inflation here is well BELOW that, the cost driver ' +
    'is NOT raw translated-prompt size — it points to the assembled wire prefix (English tool schemas ' +
    'dilute, v5 assembly framing) or caching/turn dynamics.',
);
