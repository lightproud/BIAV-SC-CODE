#!/usr/bin/env node
/**
 * Day-one upgrade canary — the first thing to run after swapping the pin to
 * silver-core-sdk 0.52+ / silver-core-agent-sdk 0.68+ (see docs/MIGRATION-0.3x-to-0.68.md §0/§4).
 *
 * Four checks, one per failure class the upgrade touches:
 *   C1 build/import sanity     — the package resolves, query() is callable
 *   C2 first session           — a text round-trip yields a success result
 *                                with the fields a consumer reads
 *   C3 tool call               — the model-driven Read tool really touches
 *                                the filesystem and its result flows back
 *   C4 disconnect recovery     — an HTTP-200/zero-events stream self-heals
 *                                and the transportHealth ledger records it
 *
 * Modes:
 *   default   — keyless: a local Messages-API emulator scripts the model;
 *               every other layer (HTTP, SSE, engine loop, tools, sessions)
 *               runs for real. Safe to run anywhere, costs nothing.
 *   --live    — the same checks against the real Anthropic API using
 *               ANTHROPIC_API_KEY (C4 becomes a ledger-presence check: we do
 *               not induce faults against the real endpoint).
 *   --model=X — override the live model (default claude-haiku-4-5-20251001).
 *
 * Standalone by design: copy this single file anywhere. It resolves the SDK
 * by package name first (run it inside the consuming app), then falls back
 * to ../dist/index.js (run it from a built checkout).
 *
 * Exit code 0 = all checks passed; 1 = at least one failed.
 */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const LIVE = process.argv.includes('--live');
const MODEL_ARG = process.argv.find((a) => a.startsWith('--model='));
const LIVE_MODEL = MODEL_ARG ? MODEL_ARG.slice('--model='.length) : 'claude-haiku-4-5-20251001';

// --- resolve the SDK ---------------------------------------------------------
let sdk;
let sdkOrigin;
try {
  sdk = await import('silver-core-sdk');
  sdkOrigin = 'package "silver-core-sdk"';
} catch {
  const local = new URL('../dist/index.js', import.meta.url);
  try {
    sdk = await import(local.href);
    sdkOrigin = fileURLToPath(local);
  } catch {
    console.error(
      'canary: cannot resolve the SDK. Either run inside an app that has\n' +
        'silver-core-sdk installed, or build a checkout first (npm run build).',
    );
    process.exit(1);
  }
}
const { query } = sdk;

function sdkVersion() {
  try {
    const entry = import.meta.resolve
      ? fileURLToPath(import.meta.resolve('silver-core-sdk'))
      : null;
    const root = entry ? path.dirname(path.dirname(entry)) : path.dirname(path.dirname(fileURLToPath(new URL('../dist/index.js', import.meta.url))));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// --- minimal local Messages-API emulator --------------------------------------
function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function msgStart(res, model) {
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_canary',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0 },
    },
  });
}
function streamText(res, model, text) {
  msgStart(res, model);
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}
function streamToolUse(res, model, id, name, input) {
  msgStart(res, model);
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } });
  const json = JSON.stringify(input);
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(0, 4) } });
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(4) } });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 8 } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}
function countToolTurns(messages) {
  return messages.filter(
    (m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'),
  ).length;
}

/** Start an emulator; handler(ctx, res) where ctx = {attempt, toolTurns, model}. */
function startEmulator(handler) {
  let attempt = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      attempt += 1;
      const reqJson = JSON.parse(body);
      handler({ attempt, toolTurns: countToolTurns(reqJson.messages), model: reqJson.model }, res);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    }),
  );
}
const closeServer = (server) => new Promise((r) => server.close(() => r()));

// --- check runner --------------------------------------------------------------
const results = [];
async function check(id, title, fn) {
  const t0 = performance.now();
  try {
    const note = await fn();
    const ms = Math.round(performance.now() - t0);
    results.push({ id, title, status: 'PASS', ms, note });
    console.log(`[PASS] ${id} ${title} (${ms}ms)${note ? ' — ' + note : ''}`);
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    if (err && err.canarySkip) {
      results.push({ id, title, status: 'SKIP', ms, note: err.message });
      console.log(`[SKIP] ${id} ${title} — ${err.message}`);
    } else {
      results.push({ id, title, status: 'FAIL', ms, note: String(err?.message ?? err) });
      console.error(`[FAIL] ${id} ${title} (${ms}ms)\n       ${String(err?.stack ?? err).split('\n').join('\n       ')}`);
    }
  }
}
const skip = (msg) => Object.assign(new Error(msg), { canarySkip: true });

function baseOptions(extra) {
  return {
    settingSources: [],
    sandbox: false,
    maxTurns: 8,
    ...extra,
  };
}

async function collect(prompt, options) {
  const messages = [];
  for await (const m of query({ prompt, options })) messages.push(m);
  const result = messages[messages.length - 1];
  if (!result || result.type !== 'result') throw new Error('stream ended without a result message');
  return { messages, result };
}

// --- the four checks -------------------------------------------------------------
console.log(`silver-core-sdk day-one canary — mode: ${LIVE ? 'LIVE (real API)' : 'emulator (keyless)'}`);

await check('C1', 'build/import sanity', async () => {
  if (typeof query !== 'function') throw new Error('query is not a function');
  for (const name of ['tool', 'createSdkMcpServer', 'generateRuntimeReport']) {
    if (typeof sdk[name] !== 'function') throw new Error(`missing export: ${name}`);
  }
  return `version ${sdkVersion()}, from ${sdkOrigin}`;
});

if (!LIVE) {
  // ---------------- emulator mode ----------------
  await check('C2', 'first session (text round-trip)', async () => {
    const { server, baseUrl } = await startEmulator((ctx, res) => streamText(res, ctx.model, 'CANARY-OK'));
    try {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-'));
      const { messages, result } = await collect(
        'Reply with exactly: CANARY-OK',
        baseOptions({ provider: { apiKey: 'canary-key', baseUrl }, model: 'claude-emulator-1', cwd, sessionDir: path.join(cwd, '.sessions') }),
      );
      const init = messages.find((m) => m.type === 'system' && m.subtype === 'init');
      if (!init?.session_id) throw new Error('no init/session_id');
      if (result.subtype !== 'success') throw new Error(`result.subtype = ${result.subtype}`);
      if (result.result !== 'CANARY-OK') throw new Error(`unexpected result text: ${result.result}`);
      if (typeof result.total_cost_usd !== 'number' || !result.usage) throw new Error('result accounting fields missing');
      fs.rmSync(cwd, { recursive: true, force: true });
      return `session ${init.session_id.slice(0, 8)}..., num_turns=${result.num_turns}`;
    } finally {
      await closeServer(server);
    }
  });

  await check('C3', 'tool call (real fs Read via the agent loop)', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-'));
    const sentinel = `CANARY-SENTINEL-${Math.random().toString(36).slice(2, 10)}`;
    fs.writeFileSync(path.join(cwd, 'canary.txt'), sentinel + '\n');
    const { server, baseUrl } = await startEmulator((ctx, res) => {
      if (ctx.toolTurns === 0) return streamToolUse(res, ctx.model, 'tu_1', 'Read', { file_path: 'canary.txt' });
      return streamText(res, ctx.model, 'read complete');
    });
    try {
      const { messages, result } = await collect(
        'Read canary.txt and repeat its sentinel token.',
        baseOptions({ provider: { apiKey: 'canary-key', baseUrl }, model: 'claude-emulator-1', cwd, sessionDir: path.join(cwd, '.sessions') }),
      );
      if (result.subtype !== 'success') throw new Error(`result.subtype = ${result.subtype}`);
      const sawRead = messages.some(
        (m) => m.type === 'assistant' && m.message.content.some((b) => b.type === 'tool_use' && b.name === 'Read'),
      );
      if (!sawRead) throw new Error('no Read tool_use observed');
      const toolResultText = JSON.stringify(
        messages.filter((m) => m.type === 'user').map((m) => m.message.content),
      );
      if (!toolResultText.includes(sentinel)) throw new Error('tool_result does not contain the sentinel — Read did not really touch the fs');
      fs.rmSync(cwd, { recursive: true, force: true });
      return 'Read executed, sentinel flowed back through tool_result';
    } finally {
      await closeServer(server);
    }
  });

  await check('C4', 'disconnect recovery (empty stream self-heals, ledger records it)', async () => {
    const { server, baseUrl } = await startEmulator((ctx, res) => {
      if (ctx.attempt === 1) return res.end(); // HTTP 200, zero SSE events: the fan-out gateway failure shape
      return streamText(res, ctx.model, 'recovered');
    });
    try {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-'));
      const { result } = await collect(
        'ping through a flaky gateway',
        baseOptions({ provider: { apiKey: 'canary-key', baseUrl }, model: 'claude-emulator-1', cwd, sessionDir: path.join(cwd, '.sessions') }),
      );
      if (result.subtype !== 'success') throw new Error(`did not recover: result.subtype = ${result.subtype}`);
      const th = result.metrics?.transportHealth;
      if (!th) throw new Error('metrics.transportHealth missing from the result');
      if ((th.emptyStreamRetries ?? 0) < 1) throw new Error(`ledger did not record the heal: ${JSON.stringify(th)}`);
      fs.rmSync(cwd, { recursive: true, force: true });
      return `healed; transportHealth.emptyStreamRetries=${th.emptyStreamRetries}`;
    } finally {
      await closeServer(server);
    }
  });
} else {
  // ---------------- live mode ----------------
  const key = process.env.ANTHROPIC_API_KEY;
  const liveOpts = (cwd) =>
    baseOptions({ model: LIVE_MODEL, cwd, sessionDir: path.join(cwd, '.sessions'), maxTurns: 6 });
  let liveResult;

  await check('C2', `first session (real API, ${LIVE_MODEL})`, async () => {
    if (!key) throw skip('ANTHROPIC_API_KEY not set');
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-'));
    const { messages, result } = await collect(
      'Reply with exactly this token and nothing else: CANARY-OK',
      liveOpts(cwd),
    );
    liveResult = result;
    const init = messages.find((m) => m.type === 'system' && m.subtype === 'init');
    if (!init?.session_id) throw new Error('no init/session_id');
    if (result.subtype !== 'success') throw new Error(`result.subtype = ${result.subtype}`);
    if (!String(result.result).includes('CANARY-OK')) throw new Error(`unexpected reply: ${result.result}`);
    fs.rmSync(cwd, { recursive: true, force: true });
    return `cost $${result.total_cost_usd.toFixed(4)}, num_turns=${result.num_turns}`;
  });

  await check('C3', 'tool call (real model drives Read)', async () => {
    if (!key) throw skip('ANTHROPIC_API_KEY not set');
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-'));
    const sentinel = `CANARY-SENTINEL-${Math.random().toString(36).slice(2, 10)}`;
    fs.writeFileSync(path.join(cwd, 'canary.txt'), sentinel + '\n');
    const { messages, result } = await collect(
      'Use the Read tool to read the file canary.txt in the working directory, then repeat the sentinel token it contains.',
      liveOpts(cwd),
    );
    if (result.subtype !== 'success') throw new Error(`result.subtype = ${result.subtype}`);
    const sawRead = messages.some(
      (m) => m.type === 'assistant' && m.message.content.some((b) => b.type === 'tool_use' && b.name === 'Read'),
    );
    if (!sawRead) throw new Error('the model never called Read');
    const toolResultText = JSON.stringify(
      messages.filter((m) => m.type === 'user').map((m) => m.message.content),
    );
    if (!toolResultText.includes(sentinel)) throw new Error('tool_result does not contain the sentinel');
    fs.rmSync(cwd, { recursive: true, force: true });
    return `Read executed, cost $${result.total_cost_usd.toFixed(4)}`;
  });

  await check('C4', 'disconnect-recovery measurement plane (ledger present)', async () => {
    if (!key) throw skip('ANTHROPIC_API_KEY not set');
    // No induced faults against the real endpoint; assert the ledger exists so
    // any real-world disconnects during day one are measurable.
    const th = liveResult?.metrics?.transportHealth;
    if (!th) throw new Error('metrics.transportHealth missing — the resilience measurement plane is not live');
    return `ledger live: ${JSON.stringify(th)}`;
  });
}

// --- verdict ------------------------------------------------------------------
const fails = results.filter((r) => r.status === 'FAIL');
const skips = results.filter((r) => r.status === 'SKIP');
console.log('---');
console.log(
  `canary verdict: ${fails.length === 0 ? 'GREEN' : 'RED'} — ` +
    `${results.filter((r) => r.status === 'PASS').length} passed, ${fails.length} failed, ${skips.length} skipped`,
);
if (fails.length > 0) {
  console.log('If a check fails, start at docs/MIGRATION-0.3x-to-0.68.md section 3 (breaking points).');
}
process.exit(fails.length === 0 ? 0 : 1);
