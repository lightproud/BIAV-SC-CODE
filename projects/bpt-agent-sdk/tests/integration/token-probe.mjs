/**
 * Cross-model tokenizer probe (BPT i18n cost investigation, 2026-07-08).
 *
 * The v0.28.0 Chinese-i18n L5 round cost ~50% more than the v0.18.2 English
 * round on Haiku (bpt cache-reads 5.4M -> 16.8M, 3.13x) even though the Chinese
 * prompt text is FEWER characters. The keeper's hypothesis: Haiku still uses an
 * older tokenizer that splits each Chinese character into multiple tokens, while
 * newer models use a more CJK-efficient tokenizer.
 *
 * This probe settles it empirically and for ~$0: it calls the Messages API
 * count_tokens endpoint (NO generation, no charge) for the SAME English and
 * Chinese tool-description prose under each model's own tokenizer, and reports
 * tokens, tokens-per-character, and the Chinese/English token ratio per model.
 * If Haiku's zh/en ratio and absolute Chinese token count are much higher than
 * the newer models', the hypothesis is confirmed.
 *
 * Samples: tests/integration/fixtures/i18n-token-samples.json
 *   en = pre-i18n English descriptions (@67e2b7dd, v0.18.3)
 *   zh = current Chinese descriptions (@main, v0.28.0)
 *
 * Usage: ANTHROPIC_API_KEY=... node tests/integration/token-probe.mjs
 * Optional: --models=a,b,c   --base-url=https://api.anthropic.com
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  }),
);

const BASE_URL = (args['base-url'] || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
if (!API_KEY) {
  console.error('token-probe: no ANTHROPIC_API_KEY in env — cannot count tokens. (This probe needs the API; count_tokens is free but requires a key.)');
  process.exit(2);
}

// Default set spans the tokenizer generations we care about: 4.5 Haiku (the
// suspected old tokenizer) vs the newer Sonnet 5 / Opus 4.8 / Fable 5.
const MODELS = (args.models
  ? String(args.models).split(',')
  : ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5']
).map((m) => m.trim());

const samples = JSON.parse(readFileSync(join(HERE, 'fixtures', 'i18n-token-samples.json'), 'utf8'));
const cjk = (s) => [...s].filter((c) => c >= '一' && c <= '鿿').length;
const EN = samples.en;
const ZH = samples.zh;

async function countTokens(model, text) {
  const res = await fetch(`${BASE_URL}/v1/messages/count_tokens`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: text }] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`count_tokens ${res.status} for ${model}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.input_tokens;
}

console.log('token-probe: cross-model tokenizer comparison (count_tokens, no generation, $0)');
console.log(`samples: EN ${EN.length} chars / ${cjk(EN)} CJK | ZH ${ZH.length} chars / ${cjk(ZH)} CJK (${(100 * cjk(ZH) / ZH.length).toFixed(0)}%)`);
console.log();
console.log('| model | EN tok | ZH tok | ZH tok/CJK-char | ZH/EN tok ratio |');
console.log('|---|---|---|---|---|');

const rows = [];
for (const model of MODELS) {
  try {
    const enTok = await countTokens(model, EN);
    const zhTok = await countTokens(model, ZH);
    const perCjk = (zhTok / cjk(ZH)).toFixed(2);
    const ratio = (zhTok / enTok).toFixed(2);
    rows.push({ model, enTok, zhTok, perCjk, ratio });
    console.log(`| ${model} | ${enTok} | ${zhTok} | ${perCjk} | ${ratio} |`);
  } catch (err) {
    console.log(`| ${model} | ERROR: ${String(err.message).slice(0, 80)} | | | |`);
  }
}

console.log();
if (rows.length >= 2) {
  const byZh = [...rows].sort((a, b) => b.zhTok - a.zhTok);
  const worst = byZh[0];
  const best = byZh[byZh.length - 1];
  console.log(
    `Verdict: on the SAME Chinese text, ${worst.model} emits ${worst.zhTok} tokens ` +
      `(${worst.perCjk}/CJK-char) vs ${best.model} ${best.zhTok} (${best.perCjk}/CJK-char) — ` +
      `${(worst.zhTok / best.zhTok).toFixed(2)}x. A higher count = a less CJK-efficient tokenizer. ` +
      `English is the control (should be ~equal across models).`,
  );
}
