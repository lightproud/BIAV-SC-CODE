# RESILIENCE — the layered disconnect-survival model

Audience: consumers running this SDK over imperfect links (corporate
gateways, translating proxies, high-latency routes) who want the
commercial-agent "never disconnects" feel. That feel is not a better
network — it is layered fallback: every layer absorbs a class of fault
so the user sees a few seconds of retry instead of a dead session.

Introduced 0.43.0 (keeper ruling 2026-07-10 「全量」, resilience P0/P1/P2).

## 1. The four layers

| # | Layer | Where | What it absorbs |
|---|-------|-------|-----------------|
| 1 | Request-phase retries | transport | connect failures, 408/429/5xx/529, empty streams (HTTP 200, zero events) |
| 2 | Bounded turn replay | engine | stream failures that consumed NOTHING (zero events, zero-event stalls, discarded partials) |
| 3 | Truncation salvage (E3) | engine | mid-stream drops / hard-cap aborts AFTER whole blocks arrived |
| 4 | Session auto-resume | **consumer** | process-level failures, exhausted budgets — see §5 recipe |

Layers 1–3 ship in the SDK. Layer 4 is a consumer loop over the session
store; the SDK provides the primitives (`resume`, session persistence,
stable `error_code` on results).

### Layer 1 — request phase (before any event)

- 429/408/5xx/network errors: exponential backoff + jitter, honoring
  `retry-after`; default 10 retries (`maxRetries` /
  `CLAUDE_CODE_MAX_RETRIES`, env capped at 15).
- Empty stream (HTTP 200, zero SSE events, clean close): replayed inside
  the transport within the same budget — an observed gateway-throttle
  shape; zero events = zero consumption = safe.

### Layer 2 — bounded turn replay (P0-1)

A turn whose stream failed while NOTHING was accepted — zero events, a
zero-event stall, or a partial delivery whose salvage found no whole
block — executed no tool and committed no content. Re-issuing it cannot
double-consume anything; the only cost is the duplicate request. The
engine replays such turns up to `TURN_REPLAY_LIMIT` (2) times per turn
with short backoff (500ms, 1s). Every replay is visible: an `api_retry`
message with `reason: "turn_replay:<code>"` plus the
`transportHealth.turnReplays` counter. Budget exhausted -> the error
surfaces with its stable `error_code`.

### Layer 3 — truncation salvage (E3, extended by P1)

A stream that dropped AFTER delivering whole blocks is a truncated turn:
the engine keeps the whole blocks (partial text becomes the answer;
complete `tool_use` blocks execute), marks the result's `errors`, and
continues. As of P1 this also applies to hard-cap aborts
(`streamMaxDurationMs`) and fallback body timeouts — a timeout no longer
voids delivered content.

**Salvage mode (`options.resilience.salvageMode`, v0.52.0).** The default
`'accept'` is the behavior above — the partial is the answer (official
2.1.201 semantics, drop-in). Set `'continue'` when a *complete* answer
matters more than the flowed prefix: the engine declines the partial and
re-drives the turn through the Layer-2 bounded replay, producing a full
fresh answer (no duplicated prefix, since it is a new turn). It records a
`turnReplay` rather than a `turnsSalvaged`, and a turn that keeps
truncating still degrades to the honest error path once replays exhaust.
Costs one or more extra turns; leave it at `'accept'` unless partial
answers are unacceptable for your workload.

## 2. Body governance (P1): who is allowed to kill a flowing stream

- `timeoutMs` (default 600000) governs the REQUEST phase: connect
  through response headers, per attempt.
- The streaming body is governed by the **idle watchdog**
  (`streamIdleTimeoutMs`, default 300000; the API's periodic pings keep
  it honest) plus the optional **hard cap** (`streamMaxDurationMs`,
  default 0 = off; env `BPT_STREAM_MAX_DURATION_MS`).
- A healthy long turn — events still flowing — is therefore never cut by
  a wall clock that ignores progress. Before P1, a >10-minute turn died
  at `timeoutMs` even while streaming; that was one whole class of
  "random disconnects".
- Never-unbounded invariant: with the idle watchdog explicitly disabled
  (`streamIdleTimeoutMs: 0`) and no hard cap, `timeoutMs` falls back to
  governing the body too. No configuration hangs forever.

## 3. The disconnect ledger (`metrics.transportHealth`, P0-2)

Every result message carries a per-run ledger (BPT-EXTENSION;
all-zero = clean run):

| Counter | Meaning |
|---------|---------|
| `networkRetries` | request-phase socket/DNS/TLS retries |
| `httpRetries` | request-phase 408/429/5xx retries |
| `emptyStreamRetries` | in-transport empty-stream replays |
| `midStreamDrops` | streams that died mid-body (salvaged or not) |
| `idleStalls` | idle-watchdog aborts |
| `maxDurationAborts` | hard-cap aborts |
| `turnsSalvaged` | truncated turns rescued by E3 |
| `turnReplays` | bounded engine replays (layer 2) |

"It keeps disconnecting for various reasons" is not actionable;
a ledger is. Read it before tuning anything: a fleet of `httpRetries`
and `emptyStreamRetries` points at the gateway (fix = endpoint routing,
§6), `idleStalls` points at a buffering/stalling middlebox,
`midStreamDrops` at link cuts the replay/salvage layers should already
be absorbing.

## 4. Knobs (all per `provider`)

| Knob | Default | Layer |
|------|---------|-------|
| `maxRetries` / `CLAUDE_CODE_MAX_RETRIES` | 10 (env cap 15) | 1 |
| `timeoutMs` | 600000 | request phase |
| `streamIdleTimeoutMs` / `CLAUDE_STREAM_IDLE_TIMEOUT_MS`, `CLAUDE_ENABLE_STREAM_WATCHDOG=0` | 300000 | body |
| `streamMaxDurationMs` / `BPT_STREAM_MAX_DURATION_MS` | 0 (off) | body hard cap |
| `TURN_REPLAY_LIMIT` (engine constant) | 2 | 2 |
| `maxConcurrentRequests` / `BPT_MAX_CONCURRENT_REQUESTS` | 0 (off) | request shaping |

## 5. Layer 4 recipe — consumer session auto-resume

The SDK persists sessions; a consumer that auto-resumes makes
process-level failures invisible too. The pattern (BPT Desktop):

```ts
import { query } from 'silver-core-sdk';

async function resilientQuery(prompt: string, options: Options) {
  let resumeId: string | undefined;
  for (let attempt = 0; attempt <= MAX_SESSION_RESUMES; attempt++) {
    try {
      const q = query({
        prompt,
        options: { ...options, ...(resumeId ? { resume: resumeId } : {}) },
      });
      for await (const msg of q) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          resumeId = msg.session_id; // latch for a potential resume
        }
        if (msg.type === 'result') {
          if (!msg.is_error) return msg;
          // Recoverable-vs-terminal by CODE, not by message parsing:
          if (!RECOVERABLE_CODES.has(msg.error_code ?? '')) return msg;
          break; // recoverable -> resume the same session
        }
        // ... forward msg to the UI ...
      }
    } catch (err) {
      // transport threw past all SDK layers; resume unless terminal
      if (!isRecoverable(err)) throw err;
    }
    await backoff(attempt);
    prompt = ''; // resumed sessions continue from persisted history
  }
  throw new Error('session did not survive MAX_SESSION_RESUMES');
}

const RECOVERABLE_CODES = new Set([
  'api_connection_failed',
  'stream_idle_timeout',
  'stream_max_duration',
  'empty_stream',
]);
```

Rules of thumb:

- Resume, don't restart: `resume` replays the persisted history, so the
  model continues mid-task instead of starting over.
- Classify by `error_code` (stable machine codes), never by regexing
  `errorMessage`.
- Bound it: an unbounded resume loop on a hard-down endpoint is a
  spinner, not resilience. Surface after N resumes with the
  `transportHealth` ledger attached so the user (and the keeper) see the
  cause spectrum.

## 6. When code is the wrong fix

The layers absorb transient faults. If the ledger shows one endpoint
contributing most of the spectrum (e.g. a translating gateway drops
every stream at ~60s: `midStreamDrops` ≈ turn count), the economical fix
is the model→{wire, endpoint, credentials} routing table (multi-provider
line, 0.41+): route around the bad hop, keep the layers for the faults
that remain.
