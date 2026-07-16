// Child-process repro for the replay-backoff process-exit bug (v0.51.1).
//
// Runs the REAL built SDK (dist/) as a plain top-level-await script — no test
// host holding the event loop alive — against an emulator in a SEPARATE
// process (replay-exit-server.mjs; an in-process server socket would hold a
// ref and mask the drain). The client-side fault wrapper cuts the first
// response's SSE stream mid-body — the exact dc-02 harness fault that killed
// LIVE round 29178257816 — which sends the engine into its bounded turn
// replay. With an unref'd replay-backoff timer the loop drains during the
// backoff (no other live handle) and node dies with exit code 13; with the
// v0.51.1 fix the run completes to a success result and exits 0.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const server = spawn('node', [join(here, 'replay-exit-server.mjs')], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const port = await new Promise((resolve, reject) => {
  let buf = '';
  server.stdout.on('data', (c) => {
    buf += c;
    const m = /PORT=(\d+)/.exec(buf);
    if (m) resolve(Number(m[1]));
  });
  server.on('exit', () => reject(new Error('server died before reporting its port')));
});
server.unref();
server.stdout.unref?.();

const sdk = await import(pathToFileURL(join(root, 'dist', 'index.js')).href);
const { makeFaultFetch } = await import(
  pathToFileURL(join(root, 'scripts', 'eval-harnesses.mjs')).href
);
const fetchWrap = makeFaultFetch((i) => (i === 1 ? { cutAfterEvents: 2 } : 'pass'));
const cwd = mkdtempSync(join(tmpdir(), 'replay-exit-'));

let result = null;
const q = sdk.query({
  prompt: 'Say the reply.',
  options: {
    provider: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, fetch: fetchWrap },
    cwd,
    sessionDir: join(cwd, '.sessions'),
    sandbox: false,
  },
});
for await (const msg of q) {
  if (msg.type === 'result') result = msg;
}

const health = result?.metrics?.transportHealth ?? {};
console.log(
  JSON.stringify({
    subtype: result?.subtype ?? null,
    is_error: result?.is_error ?? null,
    turnReplays: health.turnReplays ?? 0,
    midStreamDrops: health.midStreamDrops ?? 0,
    emptyStreamRetries: health.emptyStreamRetries ?? 0,
    networkRetries: health.networkRetries ?? 0,
  }),
);
server.kill();
process.exit(0);
