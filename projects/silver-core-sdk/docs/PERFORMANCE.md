# PERFORMANCE — response-time model and recipes

What the SDK controls about response time, what it already does by default,
and the knobs a consumer (BPT Desktop) can turn. Measured with
`tests/integration/perf-overhead.mjs` (zero-key, emulator-driven): the engine
itself adds ~1ms of bookkeeping per turn and ~5µs per SSE event — the real
latency budget lives in the network and the model, so that is where the
recipes below aim.

## The latency anatomy of one turn

```
user turn ──► request assembly ──► TCP/TLS connect? ──► server TTFT ──► stream ──► tool run ──► next turn
              (~1ms, SDK)           (0ms warm /          (model+cache)   (SDK ~5µs/event)
                                     100-300ms cold)
```

- **Request assembly** — history stringify, cache-control shaping, tool defs.
  Engine-side, already sub-millisecond per turn (tool defs are built once per
  turn and their token estimate is cached by name-set).
- **Connection** — see keep-alive below; the one place a consumer can lose
  100-300ms per turn silently.
- **Server TTFT** — dominated by prompt size and prompt-cache hits. Prompt
  caching is ON by default with a 4-breakpoint layout (tools / system x2 /
  last message); `metrics.cacheHitRatio` on every result tells you whether it
  is working (steady-state agent loops should sit well above 0.8).
- **Stream** — the idle watchdog costs one timestamp write per event; the
  parser re-slices its buffer once per chunk.
- **Tools** — runs of >= 2 consecutive read-only tools execute concurrently
  (`Promise.all`, results kept in order); side-effecting tools stay serial.

## Recipe: keep the TLS connection warm across slow turns

Node's built-in fetch (undici) pools connections with a **~4s idle
keep-alive** by default. An agent whose tool executions (or user think time)
exceed that pays a fresh TCP+TLS handshake — typically 100-300ms — on **every
turn**. Inject a fetch bound to a long-keep-alive undici Agent:

```js
import { Agent } from 'undici';
import { query } from 'silver-core-sdk';

const keepAlive = new Agent({
  keepAliveTimeout: 60_000,      // idle pool lifetime between turns
  keepAliveMaxTimeout: 600_000,  // ceiling when the server hints longer
});

const q = query({
  prompt: '...',
  options: {
    provider: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: (url, init) => fetch(url, { ...init, dispatcher: keepAlive }),
    },
  },
});
```

`provider.fetch` (BPT-EXTENSION) is used for **every** request the transport
issues (both protocols, retries included) and receives exactly what the
global fetch would have — endpoint URL, headers, body, and the per-attempt
abort signal. It is also the seam for proxies, mTLS, and instrumentation.

Alternative (process-wide, no per-transport wiring):

```js
import { Agent, setGlobalDispatcher } from 'undici';
setGlobalDispatcher(new Agent({ keepAliveTimeout: 60_000 }));
```

## Recipe: warm the connection before the first turn

The first request of a process pays DNS + TCP + TLS. To overlap that with
your own startup (the SDK deliberately sends no traffic you did not ask for):

```js
// Fire-and-forget; any response (401 included) leaves the pool warm.
fetch('https://api.anthropic.com/v1/messages', {
  method: 'HEAD', dispatcher: keepAlive,
}).catch(() => {});
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
- `tests/integration/ab-benchmark.mjs` — real-API task benchmark (cost,
  cache-hit ratio, per-tool timings) for changes whose effect only shows on
  the wire.
