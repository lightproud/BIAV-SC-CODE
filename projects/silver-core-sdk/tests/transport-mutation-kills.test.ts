/**
 * Mutation-kill tests: transport module (overnight quality campaign,
 * transport round 1 scored 67.77% - 445 survived + 137 no-coverage).
 * This file takes the resilience-critical small files first: the SSE
 * parser's deterministic field edges + abort paths, the stall watchdog's
 * whole lifecycle, and node-http's header normalization / null-body
 * statuses / resolution seams / preconnect probe. The big remaining
 * clusters (openai.ts translator, anthropic.ts long tail) are ledgered in
 * the campaign report rather than force-killed tonight.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { parseSSE, type SSEFrame } from '../src/transport/sse.js';
import {
  DEFAULT_ASYNC_AGENT_STALL_TIMEOUT_MS,
  StallWatchdog,
  resolveStallTimeoutMs,
} from '../src/transport/stall-watchdog.js';
import {
  createNodeFetch,
  firePreconnect,
  resolveHttpClient,
  resolvePreconnect,
} from '../src/transport/node-http.js';

// ---------------------------------------------------------------------------
// SSE parser: deterministic field-grammar edges + abort paths
// ---------------------------------------------------------------------------

function streamOf(chunks: Array<Uint8Array | string>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(typeof ch === 'string' ? enc.encode(ch) : ch);
      c.close();
    },
  });
}
async function parseAll(chunks: Array<Uint8Array | string>, signal?: AbortSignal): Promise<SSEFrame[]> {
  const out: SSEFrame[] = [];
  for await (const f of parseSSE(streamOf(chunks), signal)) out.push(f);
  return out;
}

describe('SSE field-grammar edges (sse.ts survivors)', () => {
  it("a bare 'data' line (no colon) carries an empty value", async () => {
    expect(await parseAll(['data\n\n'])).toEqual([{ data: '' }]);
  });

  it("'data:x' (no space after colon) keeps the full value - only ONE leading space is stripped", async () => {
    expect(await parseAll(['data:x\n\n'])).toEqual([{ data: 'x' }]);
    expect(await parseAll(['data:  two\n\n'])).toEqual([{ data: ' two' }]);
  });

  it("a bare 'event' line names an empty event; the frame still dispatches on its data", async () => {
    expect(await parseAll(['event\ndata: d\n\n'])).toEqual([{ event: '', data: 'd' }]);
  });

  it('frame state fully resets between frames (event name does not bleed forward)', async () => {
    expect(
      await parseAll(['event: a\ndata: 1\n\ndata: 2\n\n']),
    ).toEqual([{ event: 'a', data: '1' }, { data: '2' }]);
  });

  it('re-drained buffers never re-emit already-consumed lines (multi-chunk duplication guard)', async () => {
    // Three chunks, each ending mid-way: any buffer mis-trim would duplicate
    // 'data: 1' into the second frame or emit extra frames.
    const frames = await parseAll(['data: 1\n', '\ndata: 2', '\n\n']);
    expect(frames).toEqual([{ data: '1' }, { data: '2' }]);
  });

  it('a pre-aborted signal rejects with AbortError before reading anything', async () => {
    const c = new AbortController();
    c.abort();
    await expect(parseAll(['data: x\n\n'], c.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborting between chunks rejects with AbortError and stops yielding', async () => {
    const c = new AbortController();
    const enc = new TextEncoder();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        pulls += 1;
        if (pulls === 1) {
          ctrl.enqueue(enc.encode('data: first\n\n'));
        } else {
          c.abort(); // abort while the parser awaits the next read
          // never enqueue again; cancel() from the parser ends the read
        }
      },
    });
    const seen: SSEFrame[] = [];
    await expect(
      (async () => {
        for await (const f of parseSSE(body, c.signal)) seen.push(f);
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toEqual([{ data: 'first' }]);
  });
});

// ---------------------------------------------------------------------------
// Stall watchdog: env resolution + full lifecycle
// ---------------------------------------------------------------------------

describe('stall watchdog (stall-watchdog.ts survivors)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('env resolution: integer wins, 0 disables, junk/blank/negative fall back to default', () => {
    expect(resolveStallTimeoutMs({ CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '5000' })).toBe(5000);
    expect(resolveStallTimeoutMs({ CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '0' })).toBe(0);
    expect(resolveStallTimeoutMs({})).toBe(DEFAULT_ASYNC_AGENT_STALL_TIMEOUT_MS);
    expect(resolveStallTimeoutMs({ CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '' })).toBe(
      DEFAULT_ASYNC_AGENT_STALL_TIMEOUT_MS,
    );
    expect(resolveStallTimeoutMs({ CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '   ' })).toBe(
      DEFAULT_ASYNC_AGENT_STALL_TIMEOUT_MS,
    );
    expect(resolveStallTimeoutMs({ CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: 'ten' })).toBe(
      DEFAULT_ASYNC_AGENT_STALL_TIMEOUT_MS,
    );
    expect(resolveStallTimeoutMs({ CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '-1' })).toBe(
      DEFAULT_ASYNC_AGENT_STALL_TIMEOUT_MS,
    );
    expect(resolveStallTimeoutMs({ CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '1.5' })).toBe(
      DEFAULT_ASYNC_AGENT_STALL_TIMEOUT_MS,
    );
  });

  it('fires exactly once after silence; touch() resets the clock', () => {
    vi.useFakeTimers();
    let stalls = 0;
    const dog = new StallWatchdog({ timeoutMs: 1000, onStall: () => (stalls += 1) });
    vi.advanceTimersByTime(900);
    dog.touch(); // reset at t=900
    vi.advanceTimersByTime(900);
    expect(stalls).toBe(0); // 900 into the SECOND window - a non-reset would have fired at t=1000
    vi.advanceTimersByTime(200);
    expect(stalls).toBe(1);
    expect(dog.stalled).toBe(true);
    // once fired, more time and more touches change nothing
    dog.touch();
    vi.advanceTimersByTime(5000);
    expect(stalls).toBe(1);
  });

  it('dispose() cancels the pending fire and stays safe to repeat; touch() after dispose is inert', () => {
    vi.useFakeTimers();
    let stalls = 0;
    const dog = new StallWatchdog({ timeoutMs: 1000, onStall: () => (stalls += 1) });
    dog.dispose();
    dog.dispose();
    dog.touch(); // must NOT re-arm a disposed watchdog
    vi.advanceTimersByTime(10_000);
    expect(stalls).toBe(0);
    expect(dog.stalled).toBe(false);
  });

  it('timeoutMs 0 constructs a disabled watchdog that never fires', () => {
    vi.useFakeTimers();
    let stalls = 0;
    const dog = new StallWatchdog({ timeoutMs: 0, onStall: () => (stalls += 1) });
    dog.touch();
    vi.advanceTimersByTime(DEFAULT_ASYNC_AGENT_STALL_TIMEOUT_MS * 2);
    expect(stalls).toBe(0);
    expect(dog.stalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// node-http: header normalization, null-body statuses, resolution, preconnect
// ---------------------------------------------------------------------------

type Echo = { headers: http.IncomingHttpHeaders; method: string };

let server: http.Server | undefined;
let baseUrl = '';

function startEcho(status = 200): Promise<void> {
  server = http.createServer((req, res) => {
    const payload = JSON.stringify({ headers: req.headers, method: req.method });
    res.writeHead(status, { 'content-type': 'application/json', 'x-echo': 'yes' });
    if (status === 204 || status === 304) return res.end();
    res.end(payload);
  });
  return new Promise((r) =>
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      r();
    }),
  );
}

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});

describe('node-http fetch adapter (node-http.ts survivors)', () => {
  it('normalizes Headers-instance, tuple-array, and record inits - keys lowercased on the wire', async () => {
    await startEcho();
    const fetchFn = createNodeFetch();

    const viaRecord = await fetchFn(baseUrl, { headers: { 'X-Alpha': 'a' } });
    const r1 = (await viaRecord.json()) as Echo;
    expect(r1.headers['x-alpha']).toBe('a');

    const viaArray = await fetchFn(baseUrl, { headers: [['X-Beta', 'b']] });
    const r2 = (await viaArray.json()) as Echo;
    expect(r2.headers['x-beta']).toBe('b');

    const h = new Headers();
    h.set('X-Gamma', 'c');
    const viaHeaders = await fetchFn(baseUrl, { headers: h });
    const r3 = (await viaHeaders.json()) as Echo;
    expect(r3.headers['x-gamma']).toBe('c');
  });

  it('a 204 response carries a NULL body (null-body status handling)', async () => {
    await startEcho(204);
    const fetchFn = createNodeFetch();
    const res = await fetchFn(baseUrl);
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    // a normal 200 keeps a readable body
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    await startEcho(200);
    const ok = await fetchFn(baseUrl);
    expect(ok.status).toBe(200);
    expect(ok.body).not.toBeNull();
  });

  it('resolveHttpClient precedence: provider > env > node default (junk ignored)', () => {
    expect(resolveHttpClient({}, {})).toBe('node');
    expect(resolveHttpClient({ httpClient: 'fetch' }, {})).toBe('fetch');
    expect(resolveHttpClient({ httpClient: 'node' }, { BPT_HTTP_CLIENT: 'fetch' })).toBe('node');
    expect(resolveHttpClient({}, { BPT_HTTP_CLIENT: 'fetch' })).toBe('fetch');
    expect(resolveHttpClient({}, { BPT_HTTP_CLIENT: 'node' })).toBe('node');
    expect(resolveHttpClient({}, { BPT_HTTP_CLIENT: 'weird' })).toBe('node');
    expect(resolveHttpClient({}, { BPT_HTTP_CLIENT: '' })).toBe('node');
  });

  it('resolvePreconnect precedence: explicit provider beats env; env needs exactly "1"', () => {
    expect(resolvePreconnect({}, {})).toBe(false);
    expect(resolvePreconnect({ preconnect: true }, {})).toBe(true);
    expect(resolvePreconnect({ preconnect: false }, { BPT_PRECONNECT: '1' })).toBe(false);
    expect(resolvePreconnect({}, { BPT_PRECONNECT: '1' })).toBe(true);
    expect(resolvePreconnect({}, { BPT_PRECONNECT: 'yes' })).toBe(false);
  });

  it('firePreconnect: a completed probe debug-logs the status; a dead endpoint logs failed-and-ignored', async () => {
    await startEcho();
    const lines: string[] = [];
    firePreconnect((u, i) => createNodeFetch()(u, i), baseUrl, (m) => lines.push(m));
    await vi.waitFor(() => {
      expect(lines.join('\n')).toContain('preconnect completed (HTTP 200)');
    });

    const lines2: string[] = [];
    firePreconnect(
      (u, i) => createNodeFetch()(u, i),
      'http://127.0.0.1:1/unreachable',
      (m) => lines2.push(m),
    );
    await vi.waitFor(() => {
      expect(lines2.join('\n')).toContain('preconnect failed (ignored)');
    });
  });
});
