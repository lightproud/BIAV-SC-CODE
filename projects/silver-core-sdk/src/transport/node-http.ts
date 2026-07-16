/**
 * Silver Core SDK - built-in node:http(s) fetch adapter (the DEFAULT HTTP
 * client since v0.45.0; keeper ruling 2026-07-11 "做", network-layer pass).
 *
 * WHY THIS EXISTS (measured, not assumed — probes in the 2026-07-11 session,
 * summarized in docs/PERFORMANCE.md):
 *  - Node's global fetch (undici) drops pooled connections after ~4s idle,
 *    so any turn whose tool run exceeds that re-pays a TCP+TLS handshake
 *    (typically 100-300ms) — every turn. A node:https Agent with
 *    `keepAlive: true` holds the socket until the SERVER closes it.
 *  - Head-to-head on the same TLS server: this adapter reused ONE connection
 *    across 21 requests where undici recycled mid-run; kept the socket across
 *    a 5.2s idle gap; resumed TLS sessions after a forced close
 *    (isSessionReused=true); and its per-request overhead measured ~3x lower
 *    (0.86ms vs 2.62ms median, localhost).
 *  - Zero new runtime dependency: no npm-undici-vs-bundled-undici drift, no
 *    extra supply-chain surface.
 *
 * SHAPE: a fetch-compatible function `(input, init) => Promise<Response>` —
 * exactly what the provider.fetch seam accepts — so the transports (and the
 * twin discipline: requestWithRetries is token-locked across both) are
 * untouched; this module only changes what the seam RESOLVES TO by default.
 *
 * Resolution order (resolveHttpClient): provider.fetch (always wins, it IS
 * the override seam) > provider.httpClient > env BPT_HTTP_CLIENT >
 * proxy-env autodetect (any of HTTPS_PROXY/HTTP_PROXY/ALL_PROXY set, either
 * case, resolves to 'fetch' — audit 2026-07-14 M-6, see resolveHttpClient) >
 * 'node'. `'fetch'` restores the exact pre-v0.45 behavior (late-bound global
 * fetch) for environments that need undici semantics — e.g. Node's
 * NODE_USE_ENV_PROXY / setGlobalDispatcher proxying, or a test suite that
 * stubs global fetch (this repo's own suite pins it via vitest env).
 *
 * HONEST DIVERGENCES from global fetch (all inert against the Messages API,
 * asserted by the adapter tests + emulator e2e):
 *  - no redirect following (the API never redirects; a 3xx surfaces as-is);
 *  - no automatic accept-encoding/decompression (we never advertise gzip, so
 *    the server never compresses);
 *  - request bodies are sent with an explicit content-length, never chunked
 *    (some gateways reject chunked requests — undici also sends a length).
 *
 * PROCESS-EXIT SAFETY: pooled keep-alive sockets are unref()'d while idle and
 * ref()'d again on reuse, so a warm pool never keeps a finished process
 * alive (the classic node Agent keep-alive hang).
 *
 * BOUNDED IDLE LIFETIME (v0.53.3, BPT stability): a free socket is destroyed
 * after FREE_SOCKET_TTL_MS of pool idleness instead of being held "until the
 * server closes it". Middleboxes (Azure LB, ALB, nginx, corporate proxies)
 * drop idle flows SILENTLY — no FIN/RST ever arrives — so an unbounded pool
 * accumulates zombie sockets that look alive to node; a request written onto
 * one hangs for the full request-phase timeout (default 600s), and a retry
 * can pick the NEXT zombie. Concurrent conversations multiply the exposure
 * (more sockets idling between turns). The TTL (55s) sits under the common
 * 60s middlebox idle floor while still covering the multi-second tool-run
 * gaps this adapter exists for; an expired socket just costs one fresh
 * TCP+TLS handshake (~100-300ms, TLS session resumption still applies).
 */

import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

import type { ProviderConfig } from '../types.js';

/** The provider.fetch seam shape (kept structurally identical to types.ts). */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Default free-socket TTL: just under the common 60s middlebox idle floor
 * (ALB 60s, nginx keepalive_timeout 75s, Azure LB 240s), far above the ~4s
 * undici recycle whose handshake re-pay this adapter was built to avoid.
 */
export const FREE_SOCKET_TTL_MS = 55_000;

/**
 * Idle keep-alive sockets must not hold the event loop open (unref while
 * pooled, ref on reuse) and must not outlive silent middlebox idle drops
 * (destroy after ttlMs of pool idleness; the TTL timer is itself unref'd).
 */
function manageFreeSockets<T extends http.Agent | https.Agent>(agent: T, ttlMs: number): T {
  const anyAgent = agent as unknown as {
    keepSocketAlive(socket: import('node:net').Socket): boolean;
    reuseSocket(socket: import('node:net').Socket, req: http.ClientRequest): void;
  };
  const ttlTimers = new WeakMap<import('node:net').Socket, ReturnType<typeof setTimeout>>();
  const clearTtl = (socket: import('node:net').Socket): void => {
    const timer = ttlTimers.get(socket);
    if (timer !== undefined) {
      clearTimeout(timer);
      ttlTimers.delete(socket);
    }
  };
  // Finding L2 — synchronously evict a socket from the agent's free pool. The
  // TTL callback destroy()s a dying socket, but the agent only drops it from
  // `freeSockets` on the ASYNC 'close' event; in that window reuseSocket could
  // hand the destroyed socket to a new request → ECONNRESET + a wasted retry.
  // Removing it from the pool first closes the selection window.
  const removeFromFree = (socket: import('node:net').Socket): void => {
    const free = (agent as unknown as {
      freeSockets: Record<string, import('node:net').Socket[] | undefined>;
    }).freeSockets;
    if (free === undefined) return;
    for (const name of Object.keys(free)) {
      const list = free[name];
      if (list === undefined) continue;
      const idx = list.indexOf(socket);
      if (idx !== -1) {
        list.splice(idx, 1);
        if (list.length === 0) delete free[name];
        return;
      }
    }
  };
  const origKeep = anyAgent.keepSocketAlive.bind(anyAgent);
  const origReuse = anyAgent.reuseSocket.bind(anyAgent);
  anyAgent.keepSocketAlive = (socket) => {
    const keep = origKeep(socket);
    if (keep) {
      socket.unref();
      clearTtl(socket); // re-arm, never stack
      const timer = setTimeout(() => {
        ttlTimers.delete(socket);
        removeFromFree(socket); // evict BEFORE destroy so reuse can't pick it
        socket.destroy();
      }, ttlMs);
      timer.unref();
      ttlTimers.set(socket, timer);
    }
    return keep;
  };
  anyAgent.reuseSocket = (socket, req) => {
    clearTtl(socket);
    socket.ref();
    origReuse(socket, req);
  };
  return agent;
}

/** Statuses whose Response must carry a null body per the Fetch spec. */
function isNullBodyStatus(status: number): boolean {
  return status === 101 || status === 204 || status === 205 || status === 304;
}

function toHeaders(raw: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

function normalizeHeaders(init: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  if (init === undefined || init === null) return out;
  if (init instanceof Headers) {
    init.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(init)) {
    for (const [key, value] of init) out[String(key).toLowerCase()] = String(value);
    return out;
  }
  for (const [key, value] of Object.entries(init)) out[key.toLowerCase()] = String(value);
  return out;
}

/**
 * Build a fetch-shaped function over node:http/https with long-keep-alive
 * agents. Instantiable for tests (isolated pools); production uses the
 * process-wide singleton via getNodeFetch() so every transport shares one
 * warm pool (mirroring global-fetch semantics).
 */
export type NodeFetch = FetchLike & {
  /** Test observability only: the underlying keep-alive pools. */
  readonly agents: { http: http.Agent; https: https.Agent };
};

export function createNodeFetch(opts: { freeSocketTtlMs?: number } = {}): NodeFetch {
  const ttlMs = opts.freeSocketTtlMs ?? FREE_SOCKET_TTL_MS;
  const httpsAgent = manageFreeSockets(
    new https.Agent({ keepAlive: true, maxCachedSessions: 100, scheduling: 'lifo' }),
    ttlMs,
  );
  const httpAgent = manageFreeSockets(
    new http.Agent({ keepAlive: true, scheduling: 'lifo' }),
    ttlMs,
  );

  const nodeFetch = function nodeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      let url: URL;
      try {
        url = input instanceof URL ? input : new URL(input);
      } catch (err) {
        reject(new TypeError(`nodeFetch: invalid URL: ${String(input)}`));
        return;
      }
      const isTls = url.protocol === 'https:';
      if (!isTls && url.protocol !== 'http:') {
        reject(new TypeError(`nodeFetch: unsupported protocol: ${url.protocol}`));
        return;
      }
      const headers = normalizeHeaders(init.headers);
      const body = init.body;
      if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof Uint8Array)) {
        reject(new TypeError('nodeFetch: only string/Uint8Array bodies are supported'));
        return;
      }
      // Explicit content-length: never send a chunked request body (gateway
      // compatibility; matches what undici does for string bodies).
      if (typeof body === 'string' || body instanceof Uint8Array) {
        headers['content-length'] = String(
          typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength,
        );
      }
      const req = (isTls ? https : http).request(
        url,
        {
          method: init.method ?? 'GET',
          headers,
          agent: isTls ? httpsAgent : httpAgent,
          // Node wires this to req.destroy(), erroring the in-flight request
          // and (post-headers) the response stream - same observable behavior
          // the transports already handle for fetch aborts.
          signal: init.signal ?? undefined,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const responseBody = isNullBodyStatus(status)
            ? null
            : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>);
          resolve(
            new Response(responseBody, {
              status,
              statusText: res.statusMessage ?? '',
              headers: toHeaders(res.headers),
            }),
          );
        },
      );
      req.on('error', reject);
      if (typeof body === 'string' || body instanceof Uint8Array) req.write(body);
      req.end();
    });
  } as NodeFetch;
  Object.defineProperty(nodeFetch, 'agents', {
    value: { http: httpAgent, https: httpsAgent },
    enumerable: false,
  });
  return nodeFetch;
}

let sharedNodeFetch: NodeFetch | undefined;

/** Process-wide adapter singleton: one warm connection pool for the process. */
export function getNodeFetch(): NodeFetch {
  if (sharedNodeFetch === undefined) sharedNodeFetch = createNodeFetch();
  return sharedNodeFetch;
}

/**
 * Proxy env vars that flip the default HTTP client to 'fetch' (audit
 * 2026-07-14 M-6). Both cases are listed because both are conventional and
 * the env record passed in is case-sensitive (unlike Windows process env).
 */
const PROXY_ENV_VARS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const;

/**
 * HTTP-client resolution: provider.httpClient (explicit override) >
 * BPT_HTTP_CLIENT env ('node' | 'fetch') > proxy-env autodetect (below) >
 * default 'node' (the built-in keep-alive adapter). provider.fetch is NOT
 * decided here — it always wins at the transport's call site regardless of
 * this setting.
 *
 * Proxy autodetect (audit 2026-07-14 M-6): the built-in node adapter dials
 * origins DIRECTLY — it never reads HTTPS_PROXY/HTTP_PROXY/ALL_PROXY — so in
 * a proxy-only environment defaulting to 'node' makes every request fail (or
 * silently bypass an audit proxy where direct egress is open). When no
 * explicit choice was made and any proxy env var is set non-empty, resolve
 * to 'fetch': global fetch (undici) can be proxied via NODE_USE_ENV_PROXY or
 * setGlobalDispatcher. An explicit 'node' (provider or BPT_HTTP_CLIENT)
 * always wins over the autodetect.
 */
export function resolveHttpClient(
  provider: ProviderConfig,
  env: Record<string, string | undefined>,
): 'node' | 'fetch' {
  if (provider.httpClient === 'node' || provider.httpClient === 'fetch') {
    return provider.httpClient;
  }
  const fromEnv = env.BPT_HTTP_CLIENT;
  if (fromEnv === 'node' || fromEnv === 'fetch') return fromEnv;
  for (const name of PROXY_ENV_VARS) {
    const value = env[name];
    if (typeof value === 'string' && value.length > 0) return 'fetch';
  }
  return 'node';
}

/**
 * Preconnect resolution (方案丙): provider.preconnect (explicit) >
 * BPT_PRECONNECT=1 env > default false. When on, the transport fires ONE
 * fire-and-forget HEAD to its endpoint at construction so the first real
 * request finds DNS+TCP+TLS already done (~100-300ms off first-turn TTFT,
 * overlapped with MCP connect / session resolution). Default OFF: it is
 * extra traffic the caller did not ask for, and some gateways log oddly on
 * unauthenticated HEADs.
 */
export function resolvePreconnect(
  provider: ProviderConfig,
  env: Record<string, string | undefined>,
): boolean {
  if (provider.preconnect !== undefined) return provider.preconnect === true;
  return env.BPT_PRECONNECT === '1';
}

/**
 * Fire the preconnect probe: any response (401/405 included) leaves the
 * pool warm; every failure is swallowed - this is an optimization, never a
 * failure source. No credential rides the probe.
 */
export function firePreconnect(
  fetchFn: FetchLike,
  endpoint: string,
  debug: (m: string) => void,
): void {
  void fetchFn(endpoint, { method: 'HEAD' })
    .then((res) => {
      void res.body?.cancel().catch(() => undefined);
      debug(`transport: preconnect completed (HTTP ${res.status})`);
    })
    .catch((err) => {
      debug(
        `transport: preconnect failed (ignored): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}
