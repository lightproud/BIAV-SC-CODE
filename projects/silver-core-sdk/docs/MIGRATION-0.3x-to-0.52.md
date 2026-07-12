# Migrating a 0.3x-pinned consumer to 0.52

Audience: a consumer (BPT Desktop) pinned on the **0.3x tarball line**
(`bpt-agent-sdk-0.30.0.tgz` … `bpt-agent-sdk-0.39.0.tgz`, shipped 2026-07-08
to 2026-07-10) upgrading to **`silver-core-sdk-0.52.0.tgz`**. This document
covers exactly that window; the general swap-from-official guide stays in
`docs/MIGRATION.md`, and the per-feature tier ledger stays in `docs/COMPAT.md`.

**Compatibility verdict up front**: the public surface is drop-in across the
whole window. Compiler-verified against the frozen 0.3x surface
(`tests/fixtures/legacy-0-3x-surface.json`, enumerated from the historical
trees with the TypeScript checker): **zero value exports removed, zero type
exports removed, zero `Options` fields removed from 0.39.0**, and exactly
**one** `Options` field removed relative to 0.30.0
(`harnessPromptVariant`, §3.3). The 0.3x consumption patterns — options
shapes, `canUseTool` / hook signatures, the result fields, session resume,
`await q.interrupt()` — run green on the current build as a permanent suite
(`tests/legacy-consumer-0-3x.test.ts`). What remains for the consumer is the
package rename (§3.1), two narrow behavioral breaks (§3.2, and §3.4 for older
pins), and a handful of default-semantics shifts to be aware of (§3.5).

## 0. The upgrade recipe

```bash
# 1. swap the pin — the package was RENAMED at 0.41.0
npm rm bpt-agent-sdk
npm install /path/to/silver-core-sdk-0.52.0.tgz

# 2. codemod the import specifier
#    'bpt-agent-sdk' -> 'silver-core-sdk'  (everywhere, incl. dynamic import())

# 3. grep the codebase for the three break surfaces
#    '[background subagent'     -> switch to <task-notification> XML (§3.2)
#    'harnessPromptVariant'     -> delete; the single default replaced it (§3.3)
#    Stop-hook 'block' returns  -> now honored, review your Stop hooks (§3.4)

# 4. run the day-one canary (keyless emulator mode; add --live with a key).
#    The tarball ships dist/ only — copy the single standalone file
#    scripts/canary-day-one.mjs from the SDK checkout next to your app first.
node canary-day-one.mjs
```

## 1. What you get with zero code changes

These take effect the moment the pin lands.

### 1.1 Disconnect survival, four layers (0.36.0 / 0.37.1 / 0.43.0 / 0.51.1)

The "it still disconnects for various reasons" class is closed engine-side:

- **Empty-stream self-heal** (0.36.0 Anthropic arm, 0.37.1 OpenAI arm): an
  HTTP 200 that closes with zero SSE events — the fan-out gateway signature
  that previously crashed the turn with a raw
  `Protocol error: finalize before message_start` — is retried inside the
  transport, so the main conversation AND subagents self-heal with no host
  involvement. Exhaustion throws a retryable-class error with the stable code
  `empty_stream`.
- **Bounded turn replay** (0.43.0): a stream failure that consumed nothing is
  replayed up to 2 times with backoff instead of killing the run (semantically
  safe — no tool ran, no content accepted). Visible as `api_retry` messages
  with `reason: "turn_replay:<code>"`.
- **Transport health ledger** (0.43.0): every result carries
  `metrics.transportHealth` (retries by cause, mid-stream drops, idle stalls,
  salvages, replays) — disconnect debugging becomes reading a ledger instead
  of reproducing a race.
- **Headless process survival** (0.51.1): the replay-backoff timer is now
  ref'd, so a plain-script (top-level-await) consumer no longer has its event
  loop drain mid-recovery (node exited 13 with zero output). Long-running
  Electron hosts were less exposed, but any headless runner of this SDK was.
- **Ping-only non-start retried** (0.48.9), **Retry-After honored properly**
  (0.48.3: HTTP-date form parsed; an explicit "wait 90s" is honored up to a
  120s ceiling instead of being clamped back into the same limit).

### 1.2 Built-in keep-alive HTTP client (0.45.0)

The default HTTP client is the SDK's own zero-dependency `node:http(s)`
keep-alive adapter. Any turn whose tool run exceeded global fetch's ~4s idle
pool used to re-pay a TCP+TLS handshake (~100–300 ms) per turn; long
keep-alive agents end that, TLS sessions resume across reconnects, and idle
pooled sockets are unref'd (a warm pool never blocks process exit). Escape
hatch if you need the old client: `provider.httpClient: 'fetch'` or env
`BPT_HTTP_CLIENT=fetch` (see §3.5 for who needs it).

### 1.3 Engine response-time pass (0.44.0)

Measured medians (repeat=9): 30-turn tool-loop engine bookkeeping
29.7 ms → 18.0 ms (−39%); 8000-delta stream wall 57.4 ms → 48.6 ms. Idle
watchdog re-arms lazily (one timer per idle window instead of per SSE event),
one tool-def build per turn, SSE parser line scan de-quadraticized.

### 1.4 Correctness fixes you inherit silently

The 0.48.x world-class review series and the 0.37.0 audit-debt payoff fixed,
among others (each with a regression test):

- **WebFetch SSRF bypass** closed: an IPv4-mapped IPv6 host
  (`[::ffff:169.254.169.254]`) no longer slips past the private/metadata
  blocklist (0.48.1). SSRF, in one line: a courier tricked into knocking on
  your own safe's door for a stranger.
- **Permanent session death** fixed: a thinking-only assistant turn used to
  strip to `content: []` and 400 every later request on that session (0.48.1);
  orphan tool_use blocks on two persist paths had the same "every later
  request 400s" shape (0.37.0).
- **Aggregate budget ceiling**: `maxBudgetUsd` now caps the whole agent tree —
  a coordinator fanning out N subagents can no longer spend (1+N)× the cap
  (0.48.1). If you relied on the old per-loop reading, see §3.5.
- **`close()` no longer aborts your shared `AbortController`** — closing one
  query used to kill sibling queries wired to the same controller (0.48.1).
- **Resume integrity**: a forked session no longer reads as a permanently
  interrupted turn; `continue: true` can no longer resurrect a subagent
  sidechain transcript as the "most recent session"; a deliberately
  interrupted turn is never phantom-redriven (and re-billed) on resume
  (0.48.2 / 0.48.7).
- **Shared-MCP isolation**: under a SessionManager, one conversation toggling
  an MCP server off no longer blanks that tool for every sibling (0.48.8).

### 1.5 Tool-surface growth (advertised to the model by default)

New built-ins ship enabled: `TaskOutput` / `TaskStop` (0.31.0 — already in
your window if pinned ≥0.31) and `SendMessage` (0.42.0, subagent
continuation). If your host maintains permission allowlists or tool-name
matchers, extend them deliberately; `disallowedTools` removes any of them.

## 2. Recommended opt-ins (explicit switches, in priority order)

1. **`options.runLog`** + `generateRuntimeReport()` + `compareReports()`
   (0.50.0 / 0.51.0) — a facts-only JSONL ledger (zero conversation content)
   mirroring every result: transport health, tokens, cache ratio, cost,
   per-tool calls/failures. Turn it on for the upgrade observation window:
   day-over-day deltas (`compareReports`) make "did the upgrade change
   anything" a table instead of a feeling. `docs/REPORTING.md`.
2. **`resilience: { salvageMode: 'continue' }`** (0.52.0) — a mid-stream
   truncation is re-driven to a COMPLETE answer instead of accepting the
   partial blocks. The default `'accept'` keeps official-parity semantics;
   `'continue'` is the recommended posture for unattended runs.
3. **`options.memory`** (0.46.0–0.48.0) with governance:
   `memory.mounts` (per-query subtree read-only/read-write routing),
   `options.incognito` (one-switch zero persistence),
   `memory.pitfalls` (0.49.0, structured pitfall recording). All opt-in;
   without `options.memory` nothing changes. `docs/MEMORY.md` /
   `docs/MEMORY-GOVERNANCE.md`.
4. **`provider.preconnect`** (0.45.0, or env `BPT_PRECONNECT=1`) — overlaps
   DNS+TCP+TLS with query init; ~100–300 ms off first-turn TTFT.
5. **`toolSearch: true`** or the bundled `silverCoreToolOptions()` (0.34.0) —
   defers cold built-in schemas (~16k tokens, `Workflow` alone ~4.9k) behind
   lazy ToolSearch loading; the SVN-world bundle additionally removes
   `EnterWorktree`. Default (unset) defers nothing — enabling this is a
   deliberate request-shape change, so A/B it with `runLog` on.
6. **`includePromptComposition`** (0.32.0) — per-request composition estimates
   plus the cache-breakpoint map for the ContextRing panel; 0.52.0 adds exact
   UTF-8 `bytes` alongside the token estimates. Label host-injected segments
   via `appendSegments: [{ label, text }]` to lift them out of the Unknown
   residual (`skill:<id>` convention for persistent skill segments).
7. **`hookFailureMode: 'closed'`** (0.37.0) if a crashing hook should fail
   safe (deny) rather than open; **`streamMaxDurationMs`** (0.43.0) if you
   want a hard wall-clock cap back (see §3.5 timeoutMs semantics).
8. **Custom slash commands** (0.38.0, `.claude/commands` via
   `settingSources`) and **Stop-hook goal gating** (0.39.0 block semantics +
   model-evaluated hook `condition`) — the engine-side `/goal` primitive.

## 3. Breaking points (code or config changes required)

### 3.1 The rename (crossing 0.41.0): package, imports, identity strings

`bpt-agent-sdk` → `silver-core-sdk`. Update **together**: the dependency name
in `package.json`, the pinned tarball filename, and every import specifier.
Identity strings changed with it — grep any log-matching / telemetry code for:

| Surface | 0.3x value | now |
|---|---|---|
| stderr log prefix | `[bpt-agent-sdk]` | `[silver-core-sdk]` |
| User-Agent | `bpt-agent-sdk/<version>` | `silver-core-sdk/<version>` |
| MCP `clientInfo.name` | `bpt-agent-sdk` | `silver-core-sdk` |
| `NotImplementedError` message prefix | `bpt-agent-sdk` | `silver-core-sdk` |

(0.41.1 also fixed MCP `clientInfo.version` reporting a hardcoded `0.1.0` —
if anything downstream matched that, it now sees the real version.)

### 3.2 Background subagent drain notes are `<task-notification>` XML (0.42.0)

The old `[background subagent …]` text prefix is gone; background children
report completion via the official `<task-notification>` block (task-id /
status / summary / result / usage). Any consumer parsing the old prefix must
switch to matching the XML block. This is the only wire-visible format break
in the window.

### 3.3 Pins ≤ 0.32 only: `harnessPromptVariant` removed (0.33.0)

`Options.harnessPromptVariant` (`'v1'`–`'v5'`) and `PromptContext.variant`
are gone; there is ONE harness prompt (the comprehensive faithful
reproduction, the former v5). Callers passing a variant must delete the
field. Behavior note that rides along: an **unset** `systemPrompt` now
resolves to the full default harness, not the old 2-line minimal prompt —
measured ~3× cheaper in multi-turn than the terse variants (the large stable
prefix caches; the tiny ones fell below the cache threshold), but it IS a
different prompt: if you wanted the minimal behavior, pass an explicit string
`systemPrompt`.

### 3.4 Pins ≤ 0.38 only: Stop-hook `decision: 'block'` is now honored (0.39.0)

Pre-0.39 the engine logged a Stop hook's block and stopped anyway; now the
block reason feeds back as a user turn and the loop runs another assistant
turn (`stop_hook_active: true` on subsequent Stop inputs; `continue: false`
still forces the stop; root loop only — subagents stay governed by
SubagentStop; maxTurns / maxBudgetUsd still cap a stubborn block). **Audit
your existing Stop hooks**: one that returned `'block'` casually was inert
before and now drives extra (billed) turns.

### 3.5 Default-semantics shifts (no code change, but review before day one)

- **`timeoutMs` governs the request phase only** (0.43.0): connect through
  response headers. A flowing stream is governed by the idle watchdog
  (default 300 s) plus the optional `streamMaxDurationMs` hard cap — a
  healthy long turn is no longer cut at the 10-minute wall clock. If you
  relied on `timeoutMs` as a total-turn cap, set `streamMaxDurationMs`.
- **Default HTTP client is the built-in node adapter** (0.45.0, §1.2). Two
  consumer classes need the escape hatch (`provider.httpClient: 'fetch'` /
  `BPT_HTTP_CLIENT=fetch`): tests that stub **global fetch**, and hosts that
  relied on undici global-dispatcher semantics (`setGlobalDispatcher`,
  `NODE_USE_ENV_PROXY`). Neither built-in client honors `HTTPS_PROXY` by
  itself — an enterprise-proxy host injects `provider.fetch` per the recipe
  in `docs/PERFORMANCE.md`.
- **`maxBudgetUsd` is an aggregate agent-tree ceiling** (0.48.1): runs that
  previously overspent through concurrent subagents now stop at the cap.
  Raise the cap if the old effective spend was intentional.
- **`interrupt()` returns `SDKControlInterruptResponse`** (0.40.0), always
  `{ still_queued: [] }` here. Source-compatible for callers that `await` and
  ignore; only an explicit `: Promise<void>` annotation on the stored promise
  needs widening.
- **`api_retry` messages appear in new situations** (0.36.0 / 0.43.0 —
  empty-stream heals and turn replays). Message handling is already
  exhaustive-safe if you followed the SDKMessage union; UI layers surfacing
  retry toasts will simply see more honest signal.

## 4. Verification: how this document knows what it claims

- **Surface freeze**: `tests/fixtures/legacy-0-3x-surface.json` — the full
  export surface (values + types) and `Options` fields of 0.30.0 (commit
  `8c709f068`) and 0.39.0 (commit `cf67a6e56`), enumerated with the
  TypeScript compiler from the historical trees.
- **Permanent conformance suite**: `tests/legacy-consumer-0-3x.test.ts` —
  surface lock (every frozen export/field must still exist; the §3.3 removal
  is pinned and must STAY removed) + 0.3x consumption patterns driven through
  the real stack against the local Messages-API emulator (keyless, part of
  `npm test`).
- **Day-one canary**: `scripts/canary-day-one.mjs` — build sanity, first
  session, tool round-trip, disconnect recovery; emulator mode needs no key,
  `--live` re-runs the same checks against the real API. Standalone single
  file (the tarball ships `dist/` only): copy it from the SDK checkout into
  the consuming app and run it there.
- Change provenance for every entry above: `CHANGELOG.md` versions 0.31.0
  through 0.52.0.
