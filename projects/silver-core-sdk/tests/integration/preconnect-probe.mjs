#!/usr/bin/env node
/**
 * T21-3 measurement probe: does `provider.preconnect` pay off on YOUR network?
 *
 * The knob fires one unauthenticated HEAD at transport construction so
 * DNS+TCP+TLS overlaps query init (docs/PERFORMANCE.md 方案丙). Whether that
 * is worth defaulting ON in BPT depends on the real gateway's handshake cost -
 * loopback shows ~0ms, a corporate gateway shows the true 100-300ms. This
 * probe measures it where it matters: run it ON THE BPT BOX against the real
 * endpoint.
 *
 * Usage (keyless local emulator - pipeline check only, expect ~0 delta):
 *   node tests/integration/preconnect-probe.mjs
 * Usage (the real question - BPT box, real gateway):
 *   PROBE_BASE_URL=https://your-gateway PROBE_API_KEY=... \
 *     node tests/integration/preconnect-probe.mjs --reps=9
 *
 * Output: median first-turn TTFT (query start -> first stream event) for
 * preconnect OFF vs ON, plus the recommendation rule of thumb.
 */

import http from 'node:http';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const REPS = Number(arg('reps', '9'));
const REAL_URL = process.env.PROBE_BASE_URL;
const REAL_KEY = process.env.PROBE_API_KEY;

const { query } = await import('../../dist/index.js');

// --- keyless fallback: local emulator ------------------------------------------
let server;
let baseUrl = REAL_URL ?? '';
let socketOpens = 0; // WX5-4: TCP connections accepted by the local emulator.
if (!REAL_URL) {
  function sse(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  await new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.method === 'HEAD') {
          // WX5-4 (audit r3): answer a preconnect HEAD warmup with 200, not 405.
          // A 405 makes a real preconnect look like a failed request and muddies
          // whether the warmup actually opened a socket ahead of the POST.
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          return res.end();
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        sse(res, 'message_start', {
          type: 'message_start',
          message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-emulator-1', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } },
        });
        sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
        sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pong' } });
        sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
        sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
        sse(res, 'message_stop', { type: 'message_stop' });
        res.end();
      });
    });
    // WX5-4: observe the socket layer so a preconnect that silently no-fires is
    // distinguishable from one that fired but saved nothing — count each TCP
    // connection the server accepts.
    server.on('connection', () => {
      socketOpens += 1;
    });
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

async function oneRep(preconnect) {
  const socketsBefore = socketOpens;
  const t0 = performance.now();
  let firstEventMs = -1;
  const q = query({
    prompt: 'Reply with one word.',
    options: {
      provider: {
        apiKey: REAL_KEY ?? 'probe-key',
        baseUrl,
        preconnect,
        ...(REAL_URL ? {} : {}),
      },
      model: REAL_URL ? (process.env.PROBE_MODEL ?? 'claude-haiku-4-5-20251001') : 'claude-emulator-1',
      settingSources: [],
      sandbox: false,
      maxTurns: 1,
    },
  });
  for await (const m of q) {
    if (firstEventMs < 0 && (m.type === 'assistant' || m.type === 'stream_event')) {
      firstEventMs = performance.now() - t0;
    }
  }
  return { firstEventMs, sockets: socketOpens - socketsBefore };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

console.log(`preconnect probe - ${REAL_URL ? 'REAL endpoint ' + REAL_URL : 'local emulator (pipeline check; expect ~0 delta)'}, reps=${REPS}`);
const off = [];
const on = [];
const offSockets = [];
const onSockets = [];
for (let i = 0; i < REPS; i++) {
  const r0 = await oneRep(false);
  off.push(r0.firstEventMs);
  offSockets.push(r0.sockets);
  const r1 = await oneRep(true);
  on.push(r1.firstEventMs);
  onSockets.push(r1.sockets);
}
const mOff = median(off);
const mOn = median(on);
console.log(`preconnect OFF: median first-event ${mOff.toFixed(0)}ms  (raw: ${off.map((x) => x.toFixed(0)).join(',')})`);
console.log(`preconnect ON : median first-event ${mOn.toFixed(0)}ms  (raw: ${on.map((x) => x.toFixed(0)).join(',')})`);
console.log(`delta: ${(mOff - mOn).toFixed(0)}ms`);
// WX5-4: sockets opened per rep. A preconnect ON rep that opens the SAME count
// as OFF (typically 1: only the POST) means the warmup silently no-fired — a
// no-saving that is otherwise indistinguishable from a saving-that-was-zero.
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
console.log(
  `sockets opened — OFF total ${sum(offSockets)}, ON total ${sum(onSockets)} ` +
    `(ON > OFF means the preconnect warmup actually opened an extra socket ahead of the POST)`,
);
console.log(
  mOff - mOn > 50
    ? 'recommendation: the handshake saving is real on this network - default preconnect ON in BPT.'
    : 'recommendation: no meaningful saving measured here - leave preconnect OFF (default).',
);
if (server) await new Promise((r) => server.close(() => r()));
