# Migrating a 0.3x-pinned consumer to 0.68

Audience: a consumer (BPT Desktop) pinned on the **0.3x tarball line**
(`bpt-agent-sdk-0.30.0.tgz` … `bpt-agent-sdk-0.39.0.tgz`, shipped 2026-07-08
to 2026-07-10) — or on the intermediate **0.52 line** — upgrading to
**`silver-core-agent-sdk-0.68.0.tgz`**. This document covers exactly that
window and **supersedes `MIGRATION-0.3x-to-0.52.md`** (every claim of the old
document is carried forward here, re-verified or updated); the general
swap-from-official guide stays in `docs/MIGRATION.md`, and the per-feature
ledger stays in `docs/COMPAT.md`.

**Compatibility verdict up front**: the frozen 0.3x public surface is still
drop-in — compiler-verified against `tests/fixtures/legacy-0-3x-surface.json`
(0.30.0 / 0.37.1 / 0.39.0 endpoints): **zero value exports removed, zero type
exports removed, zero `Options` fields removed from 0.39.0/0.37.1**, and
exactly one `Options` field removed relative to 0.30.0
(`harnessPromptVariant`, §3.3). The 0.3x consumption patterns still run green
as a permanent suite (`tests/legacy-consumer-0-3x.test.ts`). What is NEW
since 0.52, and behavioral: the **slash retirement** (0.63.0, §3.6) — the
single biggest break in the whole window — plus a second package-rename hop
(§3.1), the MultiEdit arc (§3.7), the family lockstep regime (§3.8), and a
handful of default-semantics shifts (§3.5). Everything else in 0.53–0.68 is
additive surface or silent hardening you inherit for free (§1).

## 0-pre. The actual pin: 0.37.1 — your exact checklist

The black-pool BPT pin is **0.37.1** (keeper, 2026-07-12; re-confirmed for
this document 2026-07-18). What applies to THIS pin on the way to 0.68.0:

| Item | Applies? | Where |
|---|---|---|
| Package rename chain (npm name now `silver-core-agent-sdk`) | YES | §3.1 |
| `[background subagent …]` → `<task-notification>` XML | YES | §3.2 |
| `harnessPromptVariant` removal | **NO** — 0.37.1 is already past 0.33.0 | §3.3 |
| Stop-hook `decision: 'block'` now honored | **YES** — audit your Stop hooks | §3.4 |
| Default-semantics shifts (timeoutMs / HTTP client / budget / interrupt / openai max_tokens / `sonnet` alias) | YES | §3.5 |
| **Slash retirement** — `/`-prefixed text now passes through verbatim | **YES** | §3.6 |
| MultiEdit removal | NO — never existed on your pin (allowlist note only) | §3.7 |
| Family lockstep + Maestro peer range (only if you also install the maestro package) | YES | §3.8 |

Two 0.37.1-specific notes, updated for 0.68:

- **Twin-build caveat.** The 0.38.0 release (custom slash commands) shipped
  with its version constant still reading 0.37.1 (repaired in 0.39.0), so TWO
  different builds label their tarball `bpt-agent-sdk-0.37.1.tgz`. Their
  public export surfaces are identical; the difference is behavioral only.
  Disambiguate on the box: `node_modules/bpt-agent-sdk/dist/engine/slash-commands.js`
  present = the 0.38.0 feature build; absent = true 0.37.1. **This test only
  works on pre-0.63 boxes**: 0.63.0 deleted that very file again (slash
  retirement), so its absence in a ≥0.63 install means nothing.
- **The twin question stops mattering at 0.63.0.** Whichever build you are
  on, the `.claude/commands` expansion the 0.38.0 build introduced is GONE at
  the destination — see §3.6. You no longer need to care which twin you have,
  only whether the host ever relied on slash expansion.

## 0. The upgrade recipe

```bash
# 1. swap the pin — the npm name is now silver-core-agent-sdk (see §3.1)
npm rm bpt-agent-sdk            # (or silver-core-sdk / @biav/agent-sdk if
                                #  you came through an intermediate pin)
npm install /path/to/silver-core-agent-sdk-0.68.0.tgz

# 2. codemod the import specifier
#    'bpt-agent-sdk' -> 'silver-core-agent-sdk'  (everywhere, incl. dynamic import())

# 3. grep the codebase for the break surfaces
#    '/'-prefixed prompts, '.claude/commands' -> slash retirement (§3.6)
#    '[background subagent'     -> switch to <task-notification> XML (§3.2)
#    'harnessPromptVariant'     -> delete; the single default replaced it (§3.3)
#    Stop-hook 'block' returns  -> now honored, review your Stop hooks (§3.4)
#    "model: 'sonnet'"          -> now resolves to claude-sonnet-5 (§3.5)

# 4. run the day-one canary (keyless emulator mode; add --live with a key).
#    The tarball ships dist/ only — copy the single standalone file
#    scripts/canary-day-one.mjs from the SDK checkout next to your app first.
node canary-day-one.mjs
```

The condensed, tick-off version of this recipe is the black-pool upgrade
checklist in §5.

## 1. What you get with zero code changes

These take effect the moment the pin lands. §1.1–§1.5 are the 0.3x→0.52
gains (unchanged, re-verified); §1.6–§1.7 are new in 0.53–0.68.

### 1.1 Disconnect survival, four layers (0.36.0 / 0.37.1 / 0.43.0 / 0.51.1)

The "it still disconnects for various reasons" class is closed engine-side:
empty-stream self-heal (0.36.0 Anthropic arm / 0.37.1 OpenAI arm; exhaustion
throws a retryable-class error with stable code `empty_stream`); bounded turn
replay (0.43.0: a stream failure that consumed nothing is replayed up to 2
times with backoff, visible as `api_retry` with `reason: "turn_replay:<code>"`);
transport health ledger (`metrics.transportHealth`, 0.43.0); headless process
survival (0.51.1: the replay-backoff timer is ref'd, so a plain-script
consumer's event loop no longer drains mid-recovery). Plus: ping-only
non-start retried (0.48.9), Retry-After HTTP-date form honored up to a 120 s
ceiling (0.48.3), and — new since 0.52 — a degenerate stream that produced
zero content is no longer booked as a silent SUCCESS on either arm
(0.55.1 Anthropic `empty_message` / 0.55.2 OpenAI metadata-only + `[DONE]`).

### 1.2 Built-in keep-alive HTTP client (0.45.0, hardened 0.53.3 / 0.58.0)

The default HTTP client is the SDK's own zero-dependency `node:http(s)`
keep-alive adapter: no per-turn TCP+TLS re-handshake after slow tool runs,
TLS session resumption, idle pooled sockets unref'd. Hardened since 0.52:
idle sockets are destroyed after a **55 s free-socket TTL** (below common
60 s middlebox idle cutoffs — closes the "azure gateway turn hangs with no
output" class; 0.53.3), and when **proxy environment variables are set** the
default now resolves to the proxy-capable `'fetch'` client instead of the
proxy-blind node adapter (0.58.0; §3.5). Escape hatch unchanged:
`provider.httpClient: 'fetch'` / env `BPT_HTTP_CLIENT=fetch`.

### 1.3 Engine response-time pass (0.44.0)

Measured medians (repeat=9): 30-turn tool-loop engine bookkeeping
29.7 ms → 18.0 ms (−39%); 8000-delta stream wall 57.4 ms → 48.6 ms.

### 1.4 Correctness fixes you inherit silently (0.37.0 / 0.48.x)

Among others, each with a regression test: WebFetch SSRF bypass via
IPv4-mapped IPv6 closed (0.48.1); permanent session death from thinking-only
turns / orphan tool_use persist paths fixed (0.48.1 / 0.37.0);
`maxBudgetUsd` is an aggregate agent-tree ceiling (0.48.1); `close()` no
longer aborts a shared `AbortController` (0.48.1); resume integrity
(fork/continue/interrupt edge cases, 0.48.2 / 0.48.7); shared-MCP sibling
isolation under a SessionManager (0.48.8).

### 1.5 Tool-surface growth (advertised to the model by default)

New built-ins ship enabled: `TaskOutput` / `TaskStop` (0.31.0), `SendMessage`
(0.42.0), and — new since 0.52 — `EnterPlanMode` + `ReadMcpResourceDirTool`
(0.62.0). If your host maintains permission allowlists or tool-name matchers,
extend them deliberately; `disallowedTools` removes any of them. (MultiEdit
appeared 0.61.0 and was removed 0.65.0 — net zero for you; §3.7.)

### 1.6 The 0.53–0.67 hardening waves (nothing to adopt, everything to gain)

Several keeper-driven audit campaigns landed in this window — session
stability (0.53.4–0.53.7), four bug-sweep rounds (0.62.1–0.62.7), and the
T49/T50/T52 legacy-defect campaigns (0.63.1–0.67.2, ~390 fixes at
P0/high/medium/low tiers). Highlights a 0.3x consumer inherits: tool-schema
boundary validation (a single schema-less MCP tool no longer 400s the whole
request on strict gateways, 0.53.2); pure-tool-loop compaction no longer
spins without folding (0.53.4); MCP stdio close reaps the whole child
process tree (0.54.1); openai-chat image/tool_result/PDF wire hardening
(0.56.0); subagent-forged `<task-notification>` structure is XML-escaped
(injection defense, 0.62.6); `Write`/`Edit` are atomic (tmp+rename — a crash
mid-write no longer truncates the target, 0.64.6/0.66.1); scoped permission
rules (`WebFetch(domain:…)` etc.) that never took effect now do (0.62.2);
path-traversal and `**`-deny permission fixes (0.65.3). None of these change
the public surface.

### 1.7 More honest accounting

Interrupted turns, background subagents, and the session-end memory round no
longer leak out of cost accounting (0.53.4 / 0.53.5 / 0.59.1 / 0.62.7 /
0.64.1). Hosts reading `maxBudgetUsd` stops, result costs, or (new)
`getSessionAccounting()` see slightly HIGHER, truer numbers — if a budget
was calibrated against the old leaky reading, revisit it.

## 2. Recommended opt-ins (explicit switches, in priority order)

1. **`options.runLog`** + `generateRuntimeReport()` + `compareReports()`
   (0.50.0 / 0.51.0) — facts-only JSONL ledger; turn it on for the upgrade
   observation window: day-over-day deltas make "did the upgrade change
   anything" a table instead of a feeling. `docs/REPORTING.md`.
2. **`resilience: { salvageMode: 'continue' }`** (0.52.0) — a mid-stream
   truncation is re-driven to a COMPLETE answer instead of accepting partial
   blocks; the recommended posture for unattended runs.
3. **The loop-support surface** (0.63.0, R1–R6) if the host builds unattended
   loops: `options.prelude` + `getSessionAccounting()` (turn injection with a
   pre-injection accounting read), `budget:threshold` / `budget:exhausted`
   hook events, `compaction.retainedRegions` + `Query.setRetainedRegion`,
   `ReportLedger` (dedup primitive), `options.loopControl` (model-side
   propose-stop, host decides), `declareEngineSurface()`. These replace every
   ad-hoc loop pattern the 0.3x line forced hosts to hand-roll.
4. **`options.goal`** (0.63.0) — the structured successor to the retired
   `/goal` (§3.6): goal text + host-injected evaluator + `maxBlocks` escape
   policy arming the engine's Stop gate.
5. **`options.memory`** (0.46.0–0.48.0) with governance: `memory.mounts`,
   `options.incognito`, `memory.pitfalls` (0.49.0). All opt-in.
   `docs/MEMORY.md` / `docs/MEMORY-GOVERNANCE.md`.
6. **`options.modelAliases`** (0.64.0) — host override table for model
   aliases; the one-line fix if your gateway rejects the new `sonnet`
   default (§3.5).
7. **`provider.preconnect`** (0.45.0) and **`toolSearch: true`** /
   `silverCoreToolOptions()` (0.34.0) — TTFT and cold-schema token savings;
   A/B them with `runLog` on.
8. **`includePromptComposition`** (0.32.0; exact UTF-8 `bytes` since 0.52.0)
   — per-request composition estimates + cache-breakpoint map for the
   ContextRing panel; label host segments via `appendSegments`.
9. **`hookFailureMode: 'closed'`** (0.37.0; per-matcher `failureMode`
   since 0.58.0) and **`streamMaxDurationMs`** (0.43.0) if you want a hard
   wall-clock cap back.
10. **`resolveSubagentTransport`** (0.54.0, `purpose` field since 0.55.0) —
    cross-protocol routing for subagent / utility / compaction calls (e.g.
    subagents on a cheap openai-chat gateway while the root loop stays on
    Anthropic). **`SandboxOptions.envScrub`** and
    **`provider.openai.strictStructuredOutput`** (0.65.7) round out the
    opt-in hardening set.

## 3. Breaking points (code or config changes required)

### 3.1 The rename chain: one runtime rename, then two npm-only hops

| Hop | Version | Scope |
|---|---|---|
| `bpt-agent-sdk` → `silver-core-sdk` | 0.41.0 | npm name **and** runtime identity strings |
| `silver-core-sdk` → `@biav/agent-sdk` | 0.66.0 | npm identity ONLY |
| `@biav/agent-sdk` → `silver-core-agent-sdk` | 0.67.0 | npm identity ONLY |

Update **together**: the dependency name in `package.json`, the pinned
tarball filename (`silver-core-agent-sdk-0.68.0.tgz`), and every import
specifier → `'silver-core-agent-sdk'`. The **runtime identity strings
changed once, at 0.41.0, and have NOT changed since** — log-matching /
telemetry code targets these:

| Surface | 0.3x value | 0.41.0+ (incl. 0.68) |
|---|---|---|
| stderr log prefix | `[bpt-agent-sdk]` | `[silver-core-sdk]` |
| User-Agent | `bpt-agent-sdk/<version>` | `silver-core-sdk/<version>` |
| MCP `clientInfo.name` | `bpt-agent-sdk` | `silver-core-sdk` |
| `NotImplementedError` message prefix | `bpt-agent-sdk` | `silver-core-sdk` |

(0.41.1 also fixed MCP `clientInfo.version` reporting a hardcoded `0.1.0`.)
So after this upgrade the npm name (`silver-core-agent-sdk`) and the runtime
brand (`silver-core-sdk`) deliberately differ — do not "fix" one to match
the other.

### 3.2 Background subagent drain notes are `<task-notification>` XML (0.42.0)

The old `[background subagent …]` text prefix is gone; background children
report completion via the `<task-notification>` block (task-id / status /
summary / result / usage). Any consumer parsing the old prefix must switch
to matching the XML block. Since 0.62.6 the summary/result fields are
XML-escaped (a subagent can no longer forge notification structure) — a
parser that un-escapes entities is correct, one that regex-matches raw
angle brackets inside fields is not.

### 3.3 Pins ≤ 0.32 only: `harnessPromptVariant` removed (0.33.0)

`Options.harnessPromptVariant` (`'v1'`–`'v5'`) and `PromptContext.variant`
are gone; there is ONE harness prompt (the comprehensive faithful
reproduction, the former v5). Callers passing a variant must delete the
field. An **unset** `systemPrompt` resolves to the full default harness, not
the old 2-line minimal prompt (measured ~3× cheaper in multi-turn thanks to
caching, but it IS a different prompt — pass an explicit string for the old
minimal behavior).

### 3.4 Pins ≤ 0.38 only: Stop-hook `decision: 'block'` is now honored (0.39.0)

Pre-0.39 the engine logged a Stop hook's block and stopped anyway; now the
block reason feeds back as a user turn and the loop runs another assistant
turn (`stop_hook_active: true` on subsequent Stop inputs; `continue: false`
still forces the stop; root loop only; maxTurns / maxBudgetUsd still cap a
stubborn block). **Audit your existing Stop hooks**: one that returned
`'block'` casually was inert before and now drives extra (billed) turns.

### 3.5 Default-semantics shifts (no code change, but review before day one)

Carried forward from the 0.52 document, all still true at 0.68:

- **`timeoutMs` governs the request phase only** (0.43.0); a flowing stream
  is governed by the idle watchdog (default 300 s) + optional
  `streamMaxDurationMs`.
- **`maxBudgetUsd` is an aggregate agent-tree ceiling** (0.48.1) — and
  leak-free since the accounting fixes (§1.7); raise a calibrated cap if the
  old effective spend was intentional.
- **`interrupt()` returns `SDKControlInterruptResponse`** (0.40.0), always
  `{ still_queued: [] }` here; only an explicit `Promise<void>` annotation
  needs widening.
- **`api_retry` messages appear in new situations** (0.36.0 / 0.43.0; since
  0.57.1 they also carry `providerError` + `retryable` / `retry_remaining` /
  `retry_reason` — additive fields).

New in 0.53–0.68:

- **openai-chat default `maxOutputTokens` is 128000** (0.57.0; anthropic
  stays 8192). A gateway model with a lower output ceiling now rejects with
  a clear HTTP 400 `APIStatusError` (not retried) — set
  `provider.maxOutputTokens` explicitly if your gateway needs it.
- **`sonnet` resolves to `claude-sonnet-5`** (0.64.0; was
  `claude-sonnet-4-5`). Any bare-alias call sites now send the new id; if a
  gateway only knows specific ids, map them once via `options.modelAliases`.
  `opus` / `haiku` unchanged; `'inherit'` resolves before the override table
  and is never remappable.
- **Proxy environments default to the `'fetch'` HTTP client** (0.58.0):
  with proxy env vars set and no explicit `httpClient`, the SDK picks the
  proxy-capable client instead of the proxy-blind node adapter. A host that
  sets proxy vars but relied on node-adapter semantics must now pass
  `provider.httpClient: 'node'` explicitly.
- **Free-socket TTL 55 s** (0.53.3, §1.2) — pure hardening, listed here only
  because connection-reuse timing observably changes.

### 3.6 The slash retirement (0.63.0) — one-shot clean cut, no deprecation period

**The engine no longer recognizes ANY text starting with `/`.** Prompts pass
through to the wire verbatim (regression-locked, including a source-residue
grep guard). What this means per pin:

- **All 0.3x pins**: the manual `/compact` text recognition (present across
  the 0.3x line) is gone — a user typing `/compact` now sends that literal
  text to the model. Compaction itself is unchanged (auto-compaction, R7
  memory flush, `compaction.*` options all stay); only the TEXT trigger is
  retired. `system/init.slash_commands` is now always `[]`;
  `supportedCommands()` / `initializationResult().commands` return `[]` —
  code reading them must tolerate empty.
- **0.38.0-twin / ≥0.38 pins**: the `.claude/commands` markdown expansion
  layer (pure-text `/name [args]` user turns expanded per `settingSources`)
  is DELETED. Hosts whose users relied on custom slash commands must do the
  expansion client-side before calling `query()` — input parsing belongs to
  the client layer now.
- **Pins that adopted the 0.59–0.62 window's primitives** (not BPT's actual
  pins, listed for completeness): `parseLoopCommand` / `createPromptLoop` /
  `LOOP_SLASH_COMMAND` (0.59.0) and `parseGoalCommand` / `createSessionGoal`
  / `GOAL_SLASH_COMMAND` (0.60.0) are deleted — compile-time errors. The
  goal mechanism survives structured-only as `options.goal` (§2 item 4); the
  loop primitive's successor is the maestro package's ledger/driver/schedule
  machinery (§3.8).

Grep list for the upgrade: `.claude/commands`, `/compact`, `parseLoopCommand`,
`createPromptLoop`, `parseGoalCommand`, `createSessionGoal`,
`supportedCommands`, `slash_commands`.

### 3.7 MultiEdit: born 0.61.0, removed 0.65.0 — net zero for you

Neither the 0.3x line nor 0.52 had MultiEdit; it existed only in the
0.61.0–0.64.x window (soft-deprecated 0.64.4, removed 0.65.0, hard
alignment with upstream). For a 0.3x/0.52 → 0.68 jump the net effect is
**MultiEdit never existed**. Only impact surface: a host that manually added
`MultiEdit` to a tool-name allowlist / permission matcher mid-window should
remove the entry. Multi-file edits are several `Edit` calls (or `Edit` with
`replace_all` for a repeated string) — it was model-facing tool surface,
never a public API export.

### 3.8 Family lockstep + the maestro peer range (0.68.0)

From 0.68.0 the SDK family runs a **lockstep version clock**:
`silver-core-agent-sdk` and `silver-core-maestro-sdk` always carry the SAME
version — a shipped change in either package bumps both, CI enforces
equality. Consumer rules:

- Pin **both tarballs to the same version number**
  (`silver-core-agent-sdk-0.68.0.tgz` + `silver-core-maestro-sdk-0.68.0.tgz`).
- The maestro package declares `peerDependencies:
  "silver-core-agent-sdk": ">=0.68.0 <1.0.0"` — installing a mixed-version
  pair fails peer resolution by design.
- Agent-only consumers are unaffected beyond the version number (0.68.0
  itself contains no agent-side code change).

### 3.9 Mid-window adopters only: `resolveSubagentTransport` gained a required `purpose` field (0.55.0)

A custom transport resolver written against 0.54.0 must be rebuilt: the
resolver input gained the required field
`purpose: 'subagent' | 'utility' | 'compaction'` (0.55.0 routes utility +
compaction calls through the same seam). The factory-standard
`createSubagentTransportResolver()` ignores `purpose`, so standard users
only rebuild, not rewrite.

## 4. New capability inventory 0.53 → 0.68 (adopt-at-will)

For orientation — everything here is opt-in and absent from the 0.3x mental
model: persisted message uuids (0.53.0), `BuiltinTool.parallelSafe` +
parallel foreground Agent batches (0.53.8), cross-protocol subagent routing
(0.54.0/0.55.0), openai-chat wire hardening (0.56.0), 128k openai default
output (0.57.0), `NormalizedProviderError` (0.57.1), per-matcher hook
`failureMode` + DNS pinning (0.58.0), the loop-support surface R1–R6 +
structured `options.goal` (0.63.0), `options.modelAliases` (0.64.0),
`EnterPlanMode` / `ReadMcpResourceDirTool` (0.62.0), `envScrub` /
`strictStructuredOutput` (0.65.7), and the maestro orchestration package
(ledger / driver / schedule / workflow graph / goal chaser / delivery
contract) as a separate lockstep-versioned install (§3.8).

## 5. The black-pool upgrade checklist (终点检查单)

Work top to bottom; each line is a yes/no gate.

1. [ ] `npm rm bpt-agent-sdk` (or the intermediate name you actually pin);
   install `silver-core-agent-sdk-0.68.0.tgz`. If the maestro package is
   also installed: same version, both tarballs (§3.8).
2. [ ] Codemod every import specifier → `'silver-core-agent-sdk'`.
3. [ ] Do NOT touch log-matching / telemetry code: runtime strings are still
   `silver-core-sdk` (§3.1).
4. [ ] Grep the slash surface (§3.6 grep list). Any hit on
   `.claude/commands` expansion or `/compact` typing → move that parsing
   client-side. Any import of the deleted loop/goal exports → migrate to
   `options.goal` / maestro.
5. [ ] Grep `'[background subagent'` → switch to `<task-notification>` XML
   (§3.2).
6. [ ] Audit Stop hooks for casual `'block'` returns (§3.4).
7. [ ] Bare `'sonnet'` call sites: confirm the gateway accepts
   `claude-sonnet-5`, else add `options.modelAliases` (§3.5).
8. [ ] openai-chat gateways: confirm 128k `max_tokens` is accepted, else set
   `provider.maxOutputTokens` (§3.5).
9. [ ] Proxy-env hosts: confirm the 0.58.0 `'fetch'` default is what you
   want, else pin `provider.httpClient` (§3.5).
10. [ ] Tool allowlists: add `EnterPlanMode` / `ReadMcpResourceDirTool` (or
    disallow them deliberately); drop any mid-window `MultiEdit` entry
    (§1.5 / §3.7).
11. [ ] Budgets calibrated on pre-0.53 leaky accounting: re-check against
    the truer numbers (§1.7).
12. [ ] Copy `scripts/canary-day-one.mjs` next to the app; run keyless, then
    `--live`. Green = done.
13. [ ] Recommended: turn on `options.runLog` for the observation window and
    compare day-over-day (§2 item 1).

## 6. Verification: how this document knows what it claims

- **Surface freeze**: `tests/fixtures/legacy-0-3x-surface.json` — the full
  export surface (values + types) and `Options` fields of 0.30.0
  (`8c709f068`), 0.37.1 (`cbdbfa184`) and 0.39.0 (`cf67a6e56`), enumerated
  with the TypeScript compiler from the historical trees.
- **Permanent conformance suite**: `tests/legacy-consumer-0-3x.test.ts` —
  surface lock (every frozen export/field must still exist; the §3.3 removal
  is pinned and must STAY removed) + 0.3x consumption patterns driven
  through the real stack against the local Messages-API emulator (keyless,
  part of `npm test`).
- **Day-one canary**: `scripts/canary-day-one.mjs` — build sanity, first
  session, tool round-trip, disconnect recovery; emulator mode needs no key,
  `--live` re-runs the same checks against the real API.
- Change provenance for every entry above: `CHANGELOG.md` versions 0.31.0
  through 0.68.0 (slash retirement: 0.63.0 entry; MultiEdit removal: 0.65.0
  entry; lockstep: 0.68.0 entry; npm renames: 0.66.0 / 0.67.0 entries).
