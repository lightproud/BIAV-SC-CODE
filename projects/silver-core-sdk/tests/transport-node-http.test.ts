/**
 * Built-in node:http(s) keep-alive adapter (方案丁转正, v0.45.0) — the DEFAULT
 * HTTP client behind both transports. Unit level: fetch-shape fidelity,
 * explicit content-length (never chunked), keep-alive reuse, abort
 * propagation, idle-socket unref (process-exit safety), resolution
 * precedence. E2E level: a full agent loop + retry + interrupt through the
 * conformance emulator with httpClient 'node' — real sockets, no global
 * fetch involved (proven by a throwing global-fetch stub).
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createNodeFetch,
  getNodeFetch,
  resolveHttpClient,
  resolvePreconnect,
} from '../src/transport/node-http.js';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import { query } from '../src/index.js';
import type { StreamRequest } from '../src/internal/contracts.js';
// The conformance emulator is plain JS with no type surface.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { startEmulator, textReply, toolUseReply } from './conformance/emulator.mjs';

type Recorded = { method: string; url: string; headers: Record<string, unknown> };

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('node-http adapter (unit)', () => {
  it('speaks the fetch shape: status/headers/streamed body, explicit content-length, keep-alive reuse', async () => {
    const seen: Recorded[] = [];
    let connections = 0;
    const server = createServer((req, res) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: { ...req.headers } });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_123' });
      res.write('event: a\ndata: {}\n\n');
      res.end('event: b\ndata: {}\n\n');
    });
    server.on('connection', () => { connections += 1; });
    const base = await listen(server);
    const nodeFetch = createNodeFetch();
    try {
      const body = JSON.stringify({ hello: '世界' });
      const res = await nodeFetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'k' },
        body,
      });
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.headers.get('request-id')).toBe('req_123');
      expect(res.body).toBeTruthy();
      const text = await res.text();
      expect(text).toContain('event: a');
      expect(text).toContain('event: b');
      // Wire discipline: explicit content-length (bytes, not chars), never chunked.
      expect(seen[0]!.headers['content-length']).toBe(String(Buffer.byteLength(body)));
      expect(seen[0]!.headers['transfer-encoding']).toBeUndefined();
      expect(seen[0]!.headers['x-api-key']).toBe('k');

      // Second request rides the SAME kept-alive socket.
      await (await nodeFetch(`${base}/v1/messages`, { method: 'POST', body: '{}' })).text();
      expect(connections).toBe(1);
    } finally {
      await close(server);
    }
  });

  it('unrefs the pooled socket once idle (a warm pool must not block process exit)', async () => {
    const server = createServer((req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    const base = await listen(server);
    const nodeFetch = createNodeFetch();
    try {
      await (await nodeFetch(base, {})).text();
      // Give the agent its 'free' turn on the event loop.
      await new Promise((r) => setTimeout(r, 20));
      const free = Object.values(nodeFetch.agents.http.freeSockets).flat() as Socket[];
      expect(free.length).toBe(1);
      const handle = (free[0] as unknown as { _handle?: { hasRef?: () => boolean } })._handle;
      // hasRef is a stable-in-practice internal; skip silently if absent.
      if (handle?.hasRef !== undefined) {
        expect(handle.hasRef()).toBe(false);
      }
    } finally {
      await close(server);
    }
  });

  it('propagates AbortSignal: pre-flight abort rejects, mid-stream abort errors the body', async () => {
    let res: import('node:http').ServerResponse | undefined;
    const server = createServer((req, r) => {
      res = r;
      r.writeHead(200, { 'content-type': 'text/event-stream' });
      r.write('event: a\ndata: {}\n\n'); // then hold the stream open
    });
    const base = await listen(server);
    const nodeFetch = createNodeFetch();
    try {
      const pre = new AbortController();
      pre.abort();
      await expect(nodeFetch(base, { signal: pre.signal })).rejects.toThrow();

      const mid = new AbortController();
      const response = await nodeFetch(base, { signal: mid.signal });
      const reader = response.body!.getReader();
      await reader.read(); // first chunk arrives
      mid.abort();
      await expect(reader.read()).rejects.toThrow();
    } finally {
      res?.destroy();
      await close(server);
    }
  });

  it('resolution precedence: provider.httpClient > BPT_HTTP_CLIENT > default node; preconnect default off', () => {
    expect(resolveHttpClient({}, {})).toBe('node');
    expect(resolveHttpClient({}, { BPT_HTTP_CLIENT: 'fetch' })).toBe('fetch');
    expect(resolveHttpClient({ httpClient: 'node' }, { BPT_HTTP_CLIENT: 'fetch' })).toBe('node');
    expect(resolveHttpClient({ httpClient: 'fetch' }, {})).toBe('fetch');
    expect(resolveHttpClient({}, { BPT_HTTP_CLIENT: 'bogus' })).toBe('node');
    expect(resolvePreconnect({}, {})).toBe(false);
    expect(resolvePreconnect({}, { BPT_PRECONNECT: '1' })).toBe(true);
    expect(resolvePreconnect({ preconnect: false }, { BPT_PRECONNECT: '1' })).toBe(false);
    expect(resolvePreconnect({ preconnect: true }, {})).toBe(true);
    expect(getNodeFetch()).toBe(getNodeFetch()); // process-wide singleton
  });
});

describe('node client through the transport (default path)', () => {
  it('AnthropicTransport with default httpClient streams over real sockets — global fetch untouched', async () => {
    const globalFetch = vi.fn(async () => {
      throw new Error('global fetch must not be called on the node client path');
    });
    vi.stubGlobal('fetch', globalFetch);
    const emu = await startEmulator([{ kind: 'sse', events: textReply('node client ok') }]);
    try {
      const transport = new AnthropicTransport({
        provider: { apiKey: 'k', baseUrl: emu.url },
        env: {}, // no pin -> default 'node'
        debug: () => undefined,
      });
      const req: StreamRequest = {
        model: 'claude-test-1',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
      };
      const events: Array<{ type: string }> = [];
      for await (const e of transport.stream(req)) events.push(e as { type: string });
      expect(events.at(-1)?.type).toBe('message_stop');
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      await emu.close();
    }
  });

  it('provider.fetch still wins over the node default (injection seam is highest priority)', async () => {
    const injected = vi.fn(async () => new Response('', { status: 400 }));
    const transport = new AnthropicTransport({
      provider: { apiKey: 'k', fetch: injected, httpClient: 'node', maxRetries: 0 },
      env: {},
      debug: () => undefined,
    });
    await expect(async () => {
      for await (const _ of transport.stream({
        model: 'm',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'x' }],
      })) {
        // drain
      }
    }).rejects.toThrow();
    expect(injected).toHaveBeenCalledTimes(1);
  });

  it('preconnect fires ONE unauthenticated HEAD at construction (opt-in)', async () => {
    const seen: Recorded[] = [];
    const server = createServer((req, res) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: { ...req.headers } });
      res.writeHead(405);
      res.end();
    });
    const base = await listen(server);
    try {
      new AnthropicTransport({
        provider: { apiKey: 'secret-key', baseUrl: base, preconnect: true },
        env: {},
        debug: () => undefined,
      });
      await vi.waitFor(() => {
        expect(seen.length).toBe(1);
      });
      expect(seen[0]!.method).toBe('HEAD');
      expect(seen[0]!.url).toBe('/v1/messages');
      // No credential rides the probe.
      expect(seen[0]!.headers['x-api-key']).toBeUndefined();
      expect(seen[0]!.headers['authorization']).toBeUndefined();
    } finally {
      await close(server);
    }
  });
});

describe('node client end-to-end (emulator agent loop)', () => {
  it('drives a multi-turn tool loop, a 429 retry, and an interrupt on the node client', async () => {
    const scripts: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      scripts.push({
        kind: 'sse',
        events: toolUseReply([{ name: 'Glob', input: { pattern: '*.json' } }], { id: `msg_n_${i}` }),
      });
    }
    scripts.push({ kind: 'http429', retryAfter: '0' });
    scripts.push({ kind: 'sse', events: textReply('node e2e done.') });
    const emu = await startEmulator(scripts);
    try {
      const q = query({
        prompt: 'node-client e2e',
        options: {
          provider: { apiKey: 'k', baseUrl: emu.url, httpClient: 'node' },
          persistSession: false,
          maxTurns: 20,
        },
      });
      let result: { subtype?: string; result?: string } | undefined;
      for await (const m of q) {
        if (m.type === 'result') result = m as typeof result;
      }
      expect(result?.subtype).toBe('success');
      expect(result?.result).toBe('node e2e done.');
      expect(emu.profile.unscriptedCalls).toBe(0);
    } finally {
      await emu.close();
    }
  });

  it('interrupt() aborts a hung stream cleanly on the node client', async () => {
    const emu = await startEmulator([
      { kind: 'sse-hang', events: textReply('never'), hangAfter: 'content_block_delta' },
    ]);
    try {
      const q = query({
        prompt: 'hang',
        options: {
          provider: { apiKey: 'k', baseUrl: emu.url, httpClient: 'node' },
          persistSession: false,
        },
      });
      let outcome = 'none';
      const consumer = (async () => {
        for await (const m of q) {
          if (m.type === 'result') outcome = (m as { subtype: string }).subtype;
        }
      })();
      setTimeout(() => void q.interrupt(), 300);
      await consumer;
      expect(outcome).toBe('error_during_execution');
    } finally {
      await emu.close();
    }
  });
});
