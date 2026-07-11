/**
 * T20: official-arm memory-tool WIRE CAPTURE (conformance memory axis).
 *
 * Sends two minimal real requests through the OFFICIAL @anthropic-ai/sdk with
 * the memory tool enabled and prints the exact request bodies it puts on the
 * wire, so the conformance suite can diff silver-core-sdk's native-mode
 * assembly against an official reference:
 *
 *   arm "ga":     client.messages.create with the typed entry
 *                 `{type:'memory_20250818', name:'memory'}` passed alongside
 *                 one ordinary custom tool — captures how the GA surface
 *                 serializes a mixed tools[] (verbatim? reordered? extra
 *                 fields? which headers?).
 *   arm "runner": client.beta.messages.toolRunner + the official
 *                 betaMemoryTool/BetaLocalFilesystemMemoryTool helpers — the
 *                 official SHIPPED memory consumer; captures the beta-surface
 *                 wire shape (endpoint, anthropic-beta header, entry shape).
 *
 * Clean-room compliance: reads only the OFFICIAL SDK's own outgoing request
 * (observation boundary r2 explicitly allows official-arm request bodies);
 * the API key is read from the environment, never printed — captured headers
 * are whitelisted (content-type / anthropic-version / anthropic-beta /
 * user-agent) and the body never contains credentials.
 *
 * Run (CI): the live-smoke workflow installs the official SDK with
 * `npm install --no-save @anthropic-ai/sdk` and runs this script; the capture
 * is printed between BEGIN/END markers for retrieval from the job log, and
 * costs a few cents (two tiny haiku calls).
 *
 * Exit codes: 0 success, 2 no key (skipped), 1 failed.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.log('[skip] ANTHROPIC_API_KEY not set — skipping the official memory wire capture.');
  process.exit(2);
}

let Anthropic, betaMemoryTool, BetaLocalFilesystemMemoryTool;
try {
  ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  ({ betaMemoryTool } = await import('@anthropic-ai/sdk/helpers/beta/memory'));
  ({ BetaLocalFilesystemMemoryTool } = await import('@anthropic-ai/sdk/tools/memory/node'));
} catch (e) {
  console.error(
    '[error] official SDK not installed — run `npm install --no-save @anthropic-ai/sdk` first:',
    e?.message,
  );
  process.exit(1);
}

const model = process.argv[2] || 'claude-haiku-4-5-20251001';
const HEADER_WHITELIST = ['content-type', 'anthropic-version', 'anthropic-beta', 'user-agent'];
const captures = [];
let currentArm = 'unlabeled';

async function capturingFetch(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('/v1/messages')) {
    let bodyText;
    if (typeof init?.body === 'string') bodyText = init.body;
    else if (input instanceof Request) bodyText = await input.clone().text();
    const rawHeaders = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const headers = {};
    for (const name of HEADER_WHITELIST) {
      const v = rawHeaders.get(name);
      if (v !== null) headers[name] = v;
    }
    captures.push({
      arm: currentArm,
      url,
      headers,
      body: bodyText !== undefined ? JSON.parse(bodyText) : null,
    });
  }
  return fetch(input, init);
}

const client = new Anthropic({ apiKey: KEY, fetch: capturingFetch });
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'official-mem-capture-'));

try {
  // Arm 1 (GA): typed entry passed alongside one ordinary custom tool.
  currentArm = 'ga';
  await client.messages.create({
    model,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply with exactly OK. Do not use any tools.' }],
    tools: [
      {
        name: 'echo_probe',
        description: 'Echo a string back.',
        input_schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
      { type: 'memory_20250818', name: 'memory' },
    ],
  });

  // Arm 2 (beta runner): the official shipped memory consumer.
  currentArm = 'runner';
  const backend = await BetaLocalFilesystemMemoryTool.init(sandbox);
  const runner = client.beta.messages.toolRunner({
    model,
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Reply with exactly OK. Do not use any tools.' }],
    tools: [betaMemoryTool(backend)],
    max_iterations: 2,
  });
  await runner;

  const out = {
    capturedWith: '@anthropic-ai/sdk (installed --no-save at run time)',
    model,
    captures,
  };
  console.log('===BEGIN-OFFICIAL-MEMORY-WIRE-CAPTURE===');
  console.log(JSON.stringify(out, null, 2));
  console.log('===END-OFFICIAL-MEMORY-WIRE-CAPTURE===');
  console.log(`[capture] ${captures.length} request(s) captured (arms: ga, runner).`);
  if (captures.length === 0) {
    console.error('[error] no /v1/messages request was captured');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('[FAIL]', e?.name, e?.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
