# Migrating BPT Desktop from `@anthropic-ai/claude-agent-sdk`

Audience: the BPT Desktop (Electron) codebase currently importing the official
Claude Agent SDK. This SDK is a surface-compatible drop-in whose engine drives
the Anthropic Messages API directly — no CLI subprocess, nothing to install
beside the package itself.

Compatibility surface is pinned to the official **0.3.201** baseline
(docs/COMPAT.md is the authoritative per-field ledger; docs/POSITIONING.md is
the strategy anchor — surface tracked, behavior deliberately not).

## 1. The one-line swap

```ts
// before
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
// after
import { query, tool, createSdkMcpServer } from 'bpt-agent-sdk';
```

Install from the packed tarball (the sanctioned distribution line — this
package is not published to npm):

```bash
npm install /path/to/bpt-agent-sdk-<version>.tgz
```

Build a tarball from a checkout with `npm run build && npm pack`.

## 2. Credentials

No `claude login`, no keychain. The transport resolves, in order:

1. `options.provider` — `{ apiKey, baseUrl?, authToken?, maxOutputTokens?, promptCaching? }`
   (BPT extension; the recommended path for a desktop app that manages its own key)
2. `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` env vars

## 3. Electron wiring notes

- Run the SDK in the **main process** (it uses `node:child_process`,
  `node:fs`, `fetch`). Renderers talk to it over IPC; stream each `SDKMessage`
  to the renderer as it arrives.
- The package is **ESM** (`"type": "module"`). Electron ≥ 28 loads ESM in the
  main process; otherwise use a dynamic `import()` from your CJS entry.
- Node ≥ 18 built-in `fetch` is required (Electron ≥ 22 ships it).
- One `query()` call = one conversation run. Use streaming-input mode (pass an
  `AsyncIterable` as `prompt`) to keep a chat session open across user turns,
  and `q.close()` when the window closes.

The four host callbacks a desktop app should implement are demonstrated in
`examples/electron-host.mjs`:

| Callback | What the app provides |
|---|---|
| `canUseTool` | your permission dialog; return `{ behavior: 'allow' }` / `'deny'`, optionally echo back a `suggestions` entry via `updatedPermissions` to "always allow" |
| `onUserQuestion` | renders AskUserQuestion choices as UI |
| `webSearch` | your search backend for the WebSearch tool |
| `onElicitation` | answers MCP server elicitation prompts |

## 4. What behaves differently (read before filing bugs)

Surface is drop-in; behavior is not bit-identical — the engine is an
independent reimplementation and the default system prompt is a faithful open
reproduction of the official one (see POSITIONING.md §2 for why the residual
gap is structural, not a backlog):

1. **Model "feel"**: `systemPrompt: { preset: 'claude_code' }` maps to the
   `v5` faithful open reproduction of the official Claude Code main-loop prompt
   (assembled from the public prompt reconstruction — reverse-engineered from
   the publicly distributed CLI, MIT — with attribution). Any residual
   feel-drift in tool choice, formatting and refusal edges comes from the
   secret-sauce layer (the public reconstruction is not the live proprietary
   prompt + undocumented CLI behavior) and from your model/provider choice
   (change the model, change the feel) — not from a refusal to reproduce.
2. **Costs are estimates**: `total_cost_usd` comes from a static price table.
   Per-run `result.metrics` (turns / tokens / cache hit ratio / per-tool
   timings) is the instrument to watch instead.
3. **Grep** is a pure-JS regex engine, not ripgrep — fine for project trees,
   slow on monorepos.
4. **Bash state** persists `cd` + exported vars via state-file replay, not a
   long-lived shell: functions/aliases/unexported vars reset per call.
5. **Filesystem settings via `settingSources`** (default LOAD-ALL since
   v0.8 — see 5m): CLAUDE.md / AGENTS.md are injected on the preset/default
   system-prompt path, and a project `.mcp.json` is loaded on every path.
   Pass `settingSources: []` to opt out. skills / plugins stay CLI-coupled
   and absent.
5a2. **Background shells are detached process groups** whose only reclaim
   point is query teardown (`for await` completing, `close()`, or the
   generator's finally). Two residual risks a host should know (audit
   2026-07-10 M5): a HARD host-process crash orphans running background
   shells (nothing left alive to signal them), and a Query that is
   constructed but never iterated nor closed never reaches teardown. Always
   `close()` queries on window close, and consider host-level cleanup (e.g.
   a PID-file sweep) if your app must survive crashes with no orphans.
5b. **Bash sandbox** (v0.6) is ON by default when a backend resolves —
   bubblewrap on Linux. On **Windows (BPT Desktop) and macOS no backend
   resolves**, so Bash runs unsandboxed, no sandbox guidance is emitted, and no
   isolation is claimed — the same honesty posture as official Claude Code on
   Windows. Disable explicitly with `sandbox: false`; tune via the
   `SandboxOptions` object (`allowNetwork`, `writablePaths`, `allowEscape`, a
   custom `backend`).
5b-2. **Bash on Windows needs Git Bash** (2026-07-05 pilot incident fix):
   the tool resolves its shell Windows-aware — `CLAUDE_CODE_GIT_BASH_PATH`
   (the official client's knob) wins when set, then Git for Windows is probed
   at its standard install locations (Program Files / per-user). Without
   either, Bash fails with actionable guidance instead of `spawn sh ENOENT`.
   The bare `bash` name is deliberately NOT tried on Windows — System32's
   bash.exe launches WSL, whose filesystem view silently diverges. Glob /
   Grep / Read / Write / Edit are pure-Node and unaffected.
5c. **Write enforces the official read-before-write gate** (E4, v0.6): a
   Write over an existing file the session has not Read errors with
   `<tool_use_error>File has not been read yet. Read it first before writing
   to it.</tool_use_error>` and leaves the file untouched. New files pass; a
   successful Read (or the session's own prior Write/Edit of that file)
   unlocks. This is a deliberate behavior TIGHTENING to match official
   2.1.201 — a caller that used to blind-overwrite must Read first.
5d. **Extended thinking defaults ON with the `claude_code` preset** (E1,
   v0.6), matching the observable official default. On 4.6+ models the default
   is `adaptive` (no numeric budget); older models get a budget defaulting to
   10000 (our chosen value — the official budget is unobservable); opt out with
   `maxThinkingTokens: 0` or `thinking: { type: 'disabled' }`. Expect
   slightly higher per-turn cost and thinking deltas in the stream. Non-preset
   paths are unchanged.
5e. **`result` reporting semantics changed on streamed multi-turn input**
   (E2, v0.6, BREAKING for metric consumers): each result's `num_turns` and
   `usage` are now that turn's OWN figures (official semantics), no longer
   session-cumulative; `total_cost_usd` and `duration_api_ms` are
   session-cumulative. A consumer that read the last result's `num_turns` or
   `usage` as session totals must now SUM across results (cost needs no
   change). Session-wide `maxTurns`/`maxBudgetUsd` enforcement is untouched.
5f. **Observability lifecycle events re-encoded to the official
   `system`+`subtype` form** (B2a/E8, v0.7, BREAKING for stream consumers):
   `task_started` / `task_progress` / `task_updated` / `task_notification` /
   `hook_started` / `hook_response` (and the typed-only `hook_progress` /
   `files_persisted` / `local_command_output` / `commands_changed`) are no
   longer top-level message types. They now arrive as
   `{ type: 'system', subtype: '<name>', ... }`, matching the official docs'
   discriminator split — a consumer that switched on
   `msg.type === 'task_started'` must switch on
   `msg.type === 'system' && msg.subtype === 'task_started'`. There is no
   runtime dual-emit of the old shape. Payload fields moved to the official
   names at the same time:
   - `task_started`: `task_name` → `description`; gained `task_type`
     (always `'local_agent'`) and `tool_use_id?`; house `agent_id` dropped
     (it always equaled `task_id`).
   - `task_progress`: gained official `description` / `subagent_type` /
     `usage { total_tokens, tool_uses, duration_ms }` (required) /
     `last_tool_name?`; keeps BPT `progress` (turn-budget share, 0..99) and
     `status` (`turn N/M`) as a documented superset (E8b ruling — foreground
     spawns still do NOT emit `task_notification`).
   - `task_updated`: gained the official `patch` envelope — `status` moved to
     `patch.status` (stopTask now reports the official `'killed'`, not
     `'cancelled'`), `error` to `patch.error`, plus `patch.end_time` (epoch
     ms). The bounded `result` preview stays top-level as a BPT extension.
   - `task_notification`: `event` → `status`, `message` → `summary`; gained
     required `output_file` (always `''` — this engine writes no task output
     files) and `tool_use_id?`.
   - `hook_started` / `hook_response`: gained `hook_name` (callback function
     name, `'callback'` when anonymous); `hook_response` now reports
     `output` / `stdout` / `stderr` / `outcome` — `result` → `output`,
     `error` → `stderr` with `outcome: 'error'` (or `'cancelled'` on an
     outer-signal abort); `stdout` is always `''` and `exit_code` absent
     (in-process callbacks have no stdio). `includeHookEvents` semantics are
     unchanged.
   Type-name spelling now follows the official exports:
   `SDKControlInitializeResponse`, `SDKFilesPersistedEvent`,
   `SDKRateLimitEvent`, `SDKAPIRetryMessage` are the primary names; the old
   `SDKInitializationResult`, `SDKFilesPersistedMessage`,
   `SDKRateLimitEventMessage`, `SDKApiRetryMessage` remain as `@deprecated`
   aliases (dual-track, types only).
5g. **`Query.setMcpServers()` result officialized** (B2b/T2-2, v0.7,
   BREAKING): `McpSetServersResult` now leads with the official `added` /
   `removed` / `errors` fields — computed from the real before/after registry
   diff (errors maps a failed server's name to its connect error). The
   pre-alignment `servers` status array remains as a `@deprecated` dual-track
   field. The official fields are typed optional during the transition (the
   internal registry still returns the legacy shape; the Query layer always
   populates all three) — read `added`/`removed`/`errors`, not `servers`.
5h. **`Query.rewindFiles()` result officialized** (B2b/T2-2, v0.7, BREAKING):
   `RewindFilesResult` now leads with official `canRewind` / `error?` /
   `filesChanged?`. An unknown `userMessageId` now resolves with
   `{ canRewind: false, error }` instead of THROWING (soft-fail, official
   signature); checkpointing-not-enabled still throws. `insertions` /
   `deletions` are typed but never populated (no diff engine is bundled —
   honestly absent, not fabricated). Legacy `checkpointId` / `restoredFiles` /
   `deletedFiles` / `dryRun` stay populated as `@deprecated` dual-track
   fields.
5i. **`SDKResultMessage.stop_reason` on both arms + `ModelUsage` metering
   fields** (B2b/T2-4, v0.7, BREAKING for strict type consumers): the success
   arm's `stop_reason` is now REQUIRED `string | null` (was an optional
   enum) and reports the official `'tool_deferred'` on a deferred turn (pair
   with `deferred_tool_use` — the official defer-detection protocol); the
   error arm gained required `stop_reason` (the last API stop_reason observed
   before the failure, or `null` when no turn completed). `ModelUsage` gained
   `contextWindow` (static public window table — an estimate) and
   `maxOutputTokens` (the ACTUAL per-request max_tokens cap in force, not the
   model's theoretical ceiling); both optional during the transition (the
   subagent usage-ledger merge does not propagate them yet).
5j. **`McpServerStatus.tools` element shape** (B2b/T2-7, v0.7, BREAKING):
   officially an object array `{ name, description?, annotations? }`.
   `Query.mcpServerStatus()` now returns that shape (names enriched from the
   live tool entries). The TS type keeps a transitional `string[]` arm because
   the internal registry still assembles bare names; narrow on
   `typeof tools[0]` until it is removed.
5k. **Session-surface alignments** (B2b, small BREAKING items):
   `getSessionInfo()` returns `undefined` (was `null`) for an unknown id;
   `renameSession()` now REJECTS a title that is empty after trimming (throws
   `ConfigurationError`) and persists the trimmed title; the session functions
   accept the official `dir` option (alias of `sessionDir`, which wins);
   `getSessionMessages()` honors official `limit`/`offset`; `listSessions()`
   types the official `includeWorktrees` name (no-op — own JSONL store only;
   `includeWorkspace` is deprecated). Session meta now persists `gitBranch`
   (from the runtime-context probe at query construction; absent on the
   segments path / `includeEnvironmentContext:false`), so
   `SDKSessionInfo.gitBranch` reads back. `PermissionUpdate`
   `removeDirectories` is now HONORED at runtime: the main thread's effective
   tool directories are `additionalDirectories` − removed + session-added,
   recomputed each turn (subagents still receive the static base list).
5l. **`SDKRateLimitEvent` payload officialized** (B2a tail, v0.7, BREAKING):
   the event now carries the official `rate_limit_info` envelope —
   `{ status: 'rejected', resetsAt? }`, with `resetsAt` (unix seconds)
   derived from the server's real 429 Retry-After. The flat `retry_after_ms`
   / `limit_type` fields remain populated as `@deprecated` dual-track;
   `requests_remaining` was never populated. Trigger semantics are
   deliberately UNCHANGED (KD-12): this engine emits the event per 429 retry,
   whereas the official CLI emits `api_retry` on an actual 429 and reserves
   `rate_limit_event` for quota-status updates it receives from the platform
   (a feed this engine does not have).
5m. **`settingSources` default reversed to load-all** (bump-pin ruling, v0.8,
   BREAKING for callers who relied on the silent default): OMITTING
   `settingSources` now loads **user+project+local** on-disk sources
   (CLAUDE.md / AGENTS.md, and the project `.mcp.json`), matching official
   Claude Code and the live `@anthropic-ai/claude-agent-sdk` docs — the flip
   from the earlier pinned-0.3.199 "omit = load nothing" default, held until
   the up-pin because it diverges from the pinned conformance arm. To keep the
   old "no on-disk sources" behavior, pass `settingSources: []` explicitly (the
   empty array is the opt-out). An explicit subset still loads exactly that
   subset. skills/plugins loading remains a separate PARTIAL, unchanged.
6. **Sessions** live in this SDK's own JSONL store (or your `sessionStore`
   backend); official CLI session files are not readable.
7. **`sse` MCP transport** (legacy) is unsupported; stdio / http / sdk are.

Prompt caching is ON by default (matches the official SDK); disable with
`provider: { promptCaching: false }`.

## 5. Verification checklist for the pilot swap

1. `npm run build && npm pack` here; install the tarball in a scratch copy of
   the app.
2. Swap the import; typecheck the app — ACCEPTED-tier options compile and are
   ignored with a debug warning (`debug: true` surfaces them on `stderr`).
3. Run one real conversation with `includePartialMessages: true` and confirm
   the renderer's streaming path.
4. Exercise one permission prompt (`canUseTool`), one tool run per family the
   app uses (fs / Bash / MCP), one resume (`resume: sessionId`).
5. Compare `result.metrics` across a few representative tasks against the old
   engine (see `tests/integration/ab-benchmark.mjs`).

## 6. P2 partial-closure changes (0.12.0) {#p2}

The 0.12.0 PARTIAL-closure pass is drop-in-safe except for ONE behavioral
change; the rest are additive:

- **BEHAVIORAL — Edit read-before-write gate.** The `Edit` tool now refuses to
  edit an existing file this session has not `Read` first, returning the verbatim
  official error (`<tool_use_error>File has not been read yet. Read it first
  before writing to it.</tool_use_error>`) and leaving the file untouched. This
  matches the official Edit tool and the existing Write gate. A prior successful
  `Read` — or a prior successful `Edit`/`Write` of the same path (which register
  it) — unlocks the edit. If your harness previously relied on Edit mutating an
  un-read file, insert a `Read` first. (The gate only engages when the engine
  supplies a read-set, i.e. inside `query()`; it is off for direct unit calls
  that pass no `readFilePaths`.)
- **ADDITIVE — no action needed.** `stream_event.ttft_ms`, `PostToolBatch.tool_calls[]`
  (the old `tool_names` still rides along, now deprecated), `SubagentStop.agent_transcript_path`,
  `thinking.display` forwarding, `debugFile` writing, and `mcpServerStatus().scope`
  are all new/populated fields — existing consumers keep working unchanged.
