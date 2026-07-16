/**
 * T21-2 verification: the docs/PERFORMANCE.md proxy recipe MECHANISM, proven
 * end-to-end through a REAL local forward proxy process.
 *
 * The documented consumer recipe injects an undici EnvHttpProxyAgent via
 * `provider.fetch`. undici is a consumer-side dependency (Electron/BPT ships
 * it); this suite verifies the same mechanism vendor-neutrally: an injected
 * `provider.fetch` that routes EVERY transport request through a real
 * absolute-form HTTP forward proxy, asserting the three things an enterprise
 * proxy user needs:
 *   1. every attempt (retries included) goes THROUGH the proxy;
 *   2. SSE streaming and auth headers survive the proxy hop;
 *   3. the per-attempt abort signal still works through the injected fetch.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import type { StreamRequest } from '../src/internal/contracts.js';
import type { RawMessageStreamEvent } from '../src/types.js';

// --- target emulator -----------------------------------------------------------

let target: http.Server;
let targetUrl = '';
let targetHits: Array<{ auth?: string }> = [];
let targetScript: Array<(res: http.ServerResponse) => void> = [];

function sseOk(res: http.ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`event: ping\ndata: {"type":"ping"}\n\n`);
  res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
  res.end();
}
function rateLimit(res: http.ServerResponse): void {
  res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow' } }));
}

// --- a REAL forward proxy (absolute-form request target) --------------------------

let proxy: http.Server;
let proxyUrl = '';
let proxied = 0;

beforeEach(async () => {
  targetHits = [];
  targetScript = [];
  proxied = 0;
  await new Promise<void>((r) => {
    target = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c));
      req.on('end', () => {
        targetHits.push({ auth: req.headers['x-api-key'] as string | undefined });
        const step = targetScript.shift() ?? sseOk;
        step(res);
      });
    });
    target.listen(0, '127.0.0.1', () => {
      const a = target.address();
      targetUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
      r();
    });
  });
  await new Promise<void>((r) => {
    proxy = http.createServer((req, res) => {
      // absolute-form: GET http://host:port/path HTTP/1.1
      proxied += 1;
      const url = new URL(req.url ?? '');
      const upstream = http.request(
        { host: url.hostname, port: url.port, path: url.pathname + url.search, method: req.method, headers: { ...req.headers, host: url.host } },
        (ures) => {
          res.writeHead(ures.statusCode ?? 502, ures.headers);
          ures.pipe(res);
        },
      );
      upstream.on('error', () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    });
    proxy.listen(0, '127.0.0.1', () => {
      const a = proxy.address();
      proxyUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
      r();
    });
  });
});
afterEach(async () => {
  // The abort case deliberately leaves a hung connection - force-drop sockets
  // so close() resolves.
  proxy.closeAllConnections();
  target.closeAllConnections();
  await new Promise<void>((r) => proxy.close(() => r()));
  await new Promise<void>((r) => target.close(() => r()));
});

/** The recipe shape: provider.fetch routes the request via the proxy - here by
 *  sending the ORIGINAL absolute URL as the request-target (what a dispatcher
 *  does under the hood). Body/headers/signal pass through untouched. */
function proxyFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const abs = url instanceof URL ? url.href : url;
  return new Promise<Response>((resolve, reject) => {
    const u = new URL(proxyUrl);
    const req = http.request(
      {
        host: u.hostname,
        port: u.port,
        path: abs, // absolute-form = forward-proxy semantics
        method: init?.method ?? 'GET',
        headers: init?.headers as Record<string, string>,
      },
      (res) => {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            res.on('data', (chunk: Buffer) => c.enqueue(new Uint8Array(chunk)));
            res.on('end', () => c.close());
            res.on('error', (e) => c.error(e));
          },
        });
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') headers.set(k, v);
        }
        resolve(new Response(body, { status: res.statusCode ?? 0, headers }));
      },
    );
    req.on('error', reject);
    if (init?.signal) {
      const sig = init.signal;
      const onAbort = (): void => {
        req.destroy(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
        reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
      };
      if (sig.aborted) onAbort();
      else sig.addEventListener('abort', onAbort, { once: true });
    }
    if (init?.body) req.end(init.body as string);
    else req.end();
  });
}

function makeTransport() {
  return new AnthropicTransport({
    provider: { apiKey: 'proxy-key', baseUrl: targetUrl, fetch: proxyFetch },
    env: {},
    debug: () => undefined,
  });
}
function baseReq(extra: Partial<StreamRequest> = {}): StreamRequest {
  return { model: 'claude-test-1', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }], ...extra };
}
async function collect(gen: AsyncIterable<RawMessageStreamEvent>): Promise<RawMessageStreamEvent[]> {
  const out: RawMessageStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('proxy recipe mechanism (T21-2, docs/PERFORMANCE.md)', () => {
  it('an SSE turn flows through the proxy with auth intact', async () => {
    const events = await collect(makeTransport().stream(baseReq()));
    expect(events).toEqual([{ type: 'ping' }, { type: 'message_stop' }]);
    expect(proxied).toBe(1);
    expect(targetHits).toHaveLength(1);
    expect(targetHits[0]!.auth).toBe('proxy-key');
  });

  it('RETRIES also route through the proxy (429 then success = 2 proxied requests)', async () => {
    targetScript = [rateLimit, sseOk];
    const events = await collect(makeTransport().stream(baseReq()));
    expect(events).toEqual([{ type: 'ping' }, { type: 'message_stop' }]);
    expect(proxied).toBe(2);
  });

  it('a caller abort propagates through the injected fetch', async () => {
    // never respond: hold the socket open so the abort races the request phase
    targetScript = [
      () => {
        /* hang - no response */
      },
    ];
    const ac = new AbortController();
    const pending = collect(makeTransport().stream(baseReq({ signal: ac.signal })));
    setTimeout(() => ac.abort(), 50);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
