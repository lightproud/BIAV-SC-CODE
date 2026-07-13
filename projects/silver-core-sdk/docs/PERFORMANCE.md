# PERFORMANCE — response-time model and recipes

What the SDK controls about response time, what it already does by default,
and the knobs a consumer (BPT Desktop) can turn. Measured with
`tests/integration/perf-overhead.mjs` (zero-key, emulator-driven): the engine
itself adds ~1ms of bookkeeping per turn and ~5µs per SSE event — the real
latency budget lives in the network and the model, so that is where the
defaults below aim.

## The latency anatomy of one turn

```
user turn ──► request assembly ──► TCP/TLS connect? ──► server TTFT ──► stream ──► tool run ──► next turn
              (~1ms, SDK)           (0ms warm /          (model+cache)   (SDK ~5µs/event)
                                     100-300ms cold)
```

- **Request assembly** — history stringify, cache-control shaping, tool defs.
  Engine-side, sub-millisecond per turn (tool defs are built once per turn
  and their token estimate is cached by name-set).
- **Connection** — held warm by default since v0.45.0; see below.
- **Server TTFT** — dominated by prompt size and prompt-cache hits. Prompt
  caching is ON by default with a 4-breakpoint layout (tools / system x2 /
  last message); `metrics.cacheHitRatio` on every result tells you whether it
  is working (steady-state agent loops should sit well above 0.8).
- **Stream** — the idle watchdog costs one timestamp write per event; the
  parser re-slices its buffer once per chunk.
- **Tools** — runs of >= 2 consecutive read-only tools execute concurrently
  (`Promise.all`, results kept in order); side-effecting tools stay serial.

## Connections stay warm by default (v0.45.0, keeper ruling 2026-07-11)

The default HTTP client is the SDK's own zero-dependency node:http(s)
adapter (`src/transport/node-http.ts`) with long keep-alive agents:

- Node's global fetch (undici) drops pooled connections after **~4s idle**,
  so any turn whose tool run exceeds that re-paid a TCP+TLS handshake
  (typically 100-300ms) — every turn. The adapter's agents hold the socket
  across those gaps, bounded by a **55s free-socket TTL** (v0.53.3,
  `FREE_SOCKET_TTL_MS`): middleboxes (Azure LB, ALB, nginx, corporate
  proxies) drop idle flows silently — no FIN/RST — and an unbounded pool
  accumulated zombie sockets that stalled the next request for the full
  request-phase timeout (worst under concurrent conversations, each
  parking sockets between turns). 55s sits under the common 60s middlebox
  idle floor; an expired socket costs one fresh handshake, never a stall.
- Measured head-to-head (same TLS server): adapter reused ONE connection
  across 21 requests where undici recycled mid-run; kept the socket across a
  5.2s idle gap; resumed TLS sessions after a forced close
  (`isSessionReused=true`, saves ~1 RTT on reconnect); ~3x lower
  per-request overhead (0.86ms vs 2.62ms median, localhost).
- Idle pooled sockets are unref'd, so the warm pool never blocks process
  exit; the classic reuse-just-as-the-server-closes ECONNRESET race is
  absorbed by the transport's existing request-phase retries.
- Honest divergences from fetch (all inert against the Messages API): no
  redirect following, no accept-encoding, bodies always carry an explicit
  content-length (never chunked — some gateways reject chunked requests).

Escape hatches, in priority order:

1. `provider.fetch` — full custom fetch (see below), always wins.
2. `provider.httpClient: 'fetch'` (env `BPT_HTTP_CLIENT=fetch`) — restore the
   pre-v0.45 late-bound global fetch, for undici semantics such as
   `setGlobalDispatcher` / `NODE_USE_ENV_PROXY` proxying.

Why not HTTP/2: measured 2026-07-11 (probe in the session record), undici's
`allowH2` either opened one session PER concurrent request (no multiplexing)
or, forced onto one session, serialized the streams (8 concurrent SSE turns:
223ms → 1262ms). No deliverable win, plus TCP head-of-line risk for long SSE
streams — parked until undici's h2 truly multiplexes.

## Recipe: first-turn preconnect (方案丙)

`provider.preconnect: true` (env `BPT_PRECONNECT=1`) fires one
fire-and-forget unauthenticated HEAD at transport construction, so
DNS+TCP+TLS overlaps MCP connect / session resolution instead of delaying
the first token (~100-300ms off first-turn TTFT). Default OFF — it is extra
traffic the caller did not ask for. Failures are swallowed; no credential
rides the probe.

```js
const q = query({
  prompt: '...',
  options: { provider: { apiKey, preconnect: true } },
});
```

## Recipe: proxies, mTLS, instrumentation (`provider.fetch`)

`provider.fetch` is used for **every** request the transport issues (both
protocols, retries included) and receives exactly what the built-in client
would send — endpoint URL, headers, body, and the per-attempt abort signal.
Neither built-in client honors `HTTPS_PROXY`-style env vars; proxy users
inject a fetch:

```js
import { EnvHttpProxyAgent } from 'undici';
const proxy = new EnvHttpProxyAgent();
const q = query({
  prompt: '...',
  options: {
    provider: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: (url, init) => fetch(url, { ...init, dispatcher: proxy }),
    },
  },
});
```

## Recipe: perceived latency

- `includePartialMessages: true` streams `stream_event` deltas so a UI can
  render tokens as they arrive instead of waiting for the assembled turn;
  `ttft_ms` rides the events once the first token lands.
- `metrics.ttftMs` / `perTurn[].apiMs` / `perTool[].totalMs` on every result
  break a slow run down into "network/model" vs "tools" — measure before
  tuning.

## Keeping it honest

- `tests/integration/perf-overhead.mjs` — SDK-overhead probe (median of N
  runs; `--out=report.json` to save). Run it before and after touching a hot
  path.
- `tests/transport-node-http.test.ts` — adapter fidelity + keep-alive reuse +
  abort + unref + node-client emulator e2e.
- `tests/integration/ab-benchmark.mjs` — real-API task benchmark (cost,
  cache-hit ratio, per-tool timings) for changes whose effect only shows on
  the wire.
