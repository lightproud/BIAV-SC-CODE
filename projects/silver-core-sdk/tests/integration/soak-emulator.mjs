#!/usr/bin/env node
/**
 * Emulator soak: a long-running resource-leak probe for the whole SDK stack.
 *
 * Drives thousands of REAL sessions (real HTTP/SSE via the local Messages-API
 * emulator, real agent loop, real fs tools, real JSONL session persistence)
 * sequentially for hours, mixing the lifecycle operations a long-lived host
 * performs: fresh sessions, resume chains, forkSession, and forced
 * auto-compaction folds (tiny contextWindowTokens override).
 *
 * Every --snapshot-sec seconds it appends one JSONL line with process
 * resource counters (rss / heap / external / active handles / open fds /
 * cumulative sessions+turns). Leak analysis = read the JSONL, look at slopes.
 *
 * Usage:
 *   npm run build   # the probe drives dist/, like the other .mjs probes
 *   node tests/integration/soak-emulator.mjs \
 *     --duration-min=480 --snapshot-sec=60 --out=/tmp/soak.jsonl
 *
 * Keyless, deterministic, zero network beyond 127.0.0.1. NOT part of npm test.
 */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const DURATION_MIN = Number(arg('duration-min', '480'));
const SNAPSHOT_SEC = Number(arg('snapshot-sec', '60'));
const OUT = arg('out', path.join(os.tmpdir(), 'silver-soak.jsonl'));
const SESSION_WIPE_EVERY = Number(arg('wipe-every', '200')); // sessions per store dir generation

const { query, forkSession } = await import('../../dist/index.js');

// --- emulator ---------------------------------------------------------------
function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function msgStart(res, model) {
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_soak',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 200, output_tokens: 0 },
    },
  });
}
function streamText(res, model, text) {
  msgStart(res, model);
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  // several deltas to exercise the SSE accumulator
  const step = Math.max(1, Math.ceil(text.length / 5));
  for (let i = 0; i < text.length; i += step) {
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + step) } });
  }
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: Math.ceil(text.length / 4) } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}
function streamToolUse(res, model, id, name, input) {
  msgStart(res, model);
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } });
  const json = JSON.stringify(input);
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(0, 6) } });
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(6) } });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}
function countToolTurns(messages) {
  return messages.filter(
    (m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'),
  ).length;
}

// Per-request script: a 2-tool loop (Write then Read) then a fat text turn
// (pads history so the tiny compaction window folds regularly).
const PAD = 'soak-pad '.repeat(2000); // ~18KB per final turn (fuels compaction folds)
let server;
let baseUrl;
await new Promise((resolve) => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reqJson = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const t = countToolTurns(reqJson.messages);
      if (t === 0) return streamToolUse(res, reqJson.model, 'tu_w', 'Write', { file_path: 'soak.txt', content: 'soak cycle content\n' });
      if (t === 1) return streamToolUse(res, reqJson.model, 'tu_r', 'Read', { file_path: 'soak.txt' });
      return streamText(res, reqJson.model, 'cycle done. ' + PAD);
    });
  });
  server.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
});

// --- resource snapshots -------------------------------------------------------
const t0 = Date.now();
let sessions = 0;
let turns = 0;
let resumes = 0;
let forks = 0;
let compactions = 0;
let errors = 0;
let lastError = null;

function snapshot(tag = 'tick') {
  const mu = process.memoryUsage();
  let fds = -1;
  try {
    fds = fs.readdirSync('/proc/self/fd').length;
  } catch {
    /* non-linux */
  }
  let handles = -1;
  try {
    handles = process._getActiveHandles().length;
  } catch {
    /* private API drift */
  }
  const line = {
    tag,
    t_min: Math.round((Date.now() - t0) / 6000) / 10,
    sessions,
    turns,
    resumes,
    forks,
    compactions,
    errors,
    rss_mb: Math.round(mu.rss / 1048576),
    heap_used_mb: Math.round(mu.heapUsed / 1048576),
    heap_total_mb: Math.round(mu.heapTotal / 1048576),
    external_mb: Math.round(mu.external / 1048576),
    array_buffers_mb: Math.round((mu.arrayBuffers ?? 0) / 1048576),
    handles,
    fds,
    ...(lastError ? { last_error: lastError } : {}),
  };
  fs.appendFileSync(OUT, JSON.stringify(line) + '\n');
  return line;
}

const snapTimer = setInterval(() => snapshot('tick'), SNAPSHOT_SEC * 1000);
snapTimer.unref();
process.on('SIGTERM', () => {
  snapshot('sigterm');
  process.exit(0);
});

// --- the soak loop --------------------------------------------------------------
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silver-soak-'));
let generation = 0;
let sessionDir = path.join(root, `gen-${generation}`, '.sessions');
let cwd = path.join(root, `gen-${generation}`, 'work');
fs.mkdirSync(sessionDir, { recursive: true });
fs.mkdirSync(cwd, { recursive: true });

function baseOptions(extra = {}) {
  return {
    provider: { apiKey: 'soak-key', baseUrl, maxOutputTokens: 512 },
    model: 'claude-emulator-1',
    cwd,
    sessionDir,
    settingSources: [],
    sandbox: false,
    maxTurns: 10,
    // Small window + small reserved output forces REAL auto-compaction folds
    // throughout the soak (deterministic fold - no extra model calls).
    compaction: { enabled: true, contextWindowTokens: 25000 },
    ...extra,
  };
}

async function runOne(options, prompt) {
  let sid;
  // WX5-6/WX5-7 (audit r3): count EACH compact_boundary fold, not runs-that-saw-
  // at-least-one. A boolean collapsed multiple folds within one run to 1, so the
  // metric labelled "compactions" actually counted runs-with-a-fold and
  // undercounted the real fold total.
  let compactionEvents = 0;
  for await (const m of query({ prompt, options })) {
    if (m.type === 'system' && m.subtype === 'init') sid = m.session_id;
    if (m.type === 'system' && m.subtype === 'compact_boundary') compactionEvents += 1;
    if (m.type === 'assistant') turns += 1;
  }
  compactions += compactionEvents;
  return sid;
}

console.log(`soak: starting — duration ${DURATION_MIN}min, snapshots every ${SNAPSHOT_SEC}s -> ${OUT}`);
snapshot('start');

const deadline = t0 + DURATION_MIN * 60_000;
let chainSid = null;
while (Date.now() < deadline) {
  try {
    const n = sessions;
    if (chainSid && n % 5 === 2) {
      // resume the running chain (every 5th session, offset 2)
      chainSid = await runOne(baseOptions({ resume: chainSid }), `soak resume round ${n}: write then read then summarize.`);
      resumes += 1;
    } else if (chainSid && n % 17 === 9) {
      // fork the chain occasionally, then continue on the fork
      const forked = await forkSession(chainSid, { sessionDir, cwd });
      forks += 1;
      chainSid = await runOne(baseOptions({ resume: forked.sessionId ?? forked }), `soak fork round ${n}: continue on the fork.`);
    } else {
      chainSid = await runOne(baseOptions(), `soak round ${n}: write soak.txt, read it back, then finish.`);
    }
    sessions += 1;
    // rotate the store dir so disk stays bounded; breaks the resume chain deliberately
    if (sessions % SESSION_WIPE_EVERY === 0) {
      generation += 1;
      const old = path.join(root, `gen-${generation - 1}`);
      sessionDir = path.join(root, `gen-${generation}`, '.sessions');
      cwd = path.join(root, `gen-${generation}`, 'work');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.mkdirSync(cwd, { recursive: true });
      chainSid = null;
      fs.rmSync(old, { recursive: true, force: true });
      snapshot('rotate');
    }
  } catch (err) {
    errors += 1;
    lastError = String(err?.message ?? err).slice(0, 200);
    chainSid = null; // start a fresh chain after any failure
  }
}

snapshot('end');
clearInterval(snapTimer);
await new Promise((r) => server.close(() => r()));
fs.rmSync(root, { recursive: true, force: true });
console.log(`soak: done — ${sessions} sessions, ${turns} turns, ${resumes} resumes, ${forks} forks, ${compactions} compactions, ${errors} errors`);
