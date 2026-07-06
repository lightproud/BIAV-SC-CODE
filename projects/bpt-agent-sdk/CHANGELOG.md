# Changelog — bpt-agent-sdk

Consumer-facing build ledger (BPT pins `npm pack` tarballs by this version:
`bpt-agent-sdk-<version>.tgz`). Discipline, in force since 0.6.2: **every
merge that changes shipped runtime code (`src/` or runtime dependencies)
bumps the version** — bug fixes bump patch, new capability bumps minor —
and adds one line here. A CI guard (`scripts/check-version-bump.mjs`) reds
any src-changing merge that forgets. 0.6.1 and 0.6.2 below are retroactive
labels for builds that shipped under a duplicated "0.6.0". The **0.1–0.5**
entries at the bottom are likewise retroactive — reconstructed from the commit
sequence (no per-merge ledger existed before the 0.6.2 discipline), so their
granularity stops at the commit-title level.

## 0.9.0 — 2026-07-06

- **feat (BPT-EXTENSION): SessionManager — in-process shared coordination +
  supervised recovery** (proposal `Public-Info-Pool/Resource/proposal/
  bpt-sdk-session-manager-20260706.md`). `createBptSession(options)` returns a
  manager that hosts multiple `mgr.query()` conversations over ONE shared
  transport + ONE shared MCP registry (connect once, multiplex — no more N×
  connections for N conversations); `mgr.usage()` aggregates cost/tokens
  read-only; `mgr.close()` is the single reaper. Ownership contract: queries
  BORROW shared connections and never tear them down; a borrowed registry
  no-ops closeAll and rejects setServers. Standalone `query()` is unchanged
  (sugar over a private manager). Per-query `provider`/`mcpServers` on a
  managed query are rejected (D1: shared-only in v1). The official Agent SDK
  has no in-process coordinator (its coordination lives in the wrapped CLI).
- **feat: supervised auto-resume**. When a managed query has a `sessionStore`
  and `recovery.autoResume !== false`, a RECOVERABLE failure (APIConnectionError,
  MCP connection-class McpError, or APIStatusError 429/5xx — classified by the
  stable E6c error `code`, never message text) is transparently re-driven from
  the store via resume, up to `recovery.maxResumes` (default 2). Terminal
  failures (abort/config/4xx/unknown — fail-closed) are forwarded/rethrown
  untouched; on exhaustion the last error carries `resumeAttempts`. A
  `system/status` observability message is emitted before each re-drive. The
  engine surfaces API failures as an `error_during_execution` RESULT (not a
  throw), so the supervisor watches error results; `SDKResultMessage` gains an
  additive `error_code` field carrying the underlying stable code.
- **feat: write-ahead turn checkpoints**. A persisting query brackets each
  engine turn with `pending_turn` / `turn_complete` store records; a resume
  whose transcript ends with a dangling `pending_turn` re-drives that request
  segment before consuming new input — never replaying already-executed tools
  (their tool_results are already paired in the replayed history).
- **feat: built-in `fileSessionStore(dir)` / `FileSessionStore`** — durable
  JSONL session store (one file per session, reversible path-safe encoding,
  torn-tail tolerant) satisfying the public `SessionStore` contract, so
  durable persistence + crash recovery is a one-line opt-in.
- **feat (DX): Bash cmd-habit correction**. On Windows the Bash description
  gains a registered note (POSIX bash, not cmd — ls/cp/mv, forward slashes);
  on any platform an exit-127 failure whose first command word is cmd-only
  (copy/move/del/erase/xcopy/robocopy/findstr/cls/md/rd/ren) gets a corrective
  hint appended (dir/type excluded — real coreutils/builtin, zero false
  positives).
- Migration: none required — all additions are additive. Consumers switching
  on `SDKResultMessage` may read the new optional `error_code`.

## 0.8.1 — 2026-07-05

- **fix (CRITICAL — thinking model-gate)**: the `claude_code` preset default no
  longer sends `thinking: {type:'adaptive'}` to models that reject it. Adaptive
  is a 4.6-generation API capability; pre-4.6 models (Haiku 4.5, Sonnet 4.5/4,
  Opus 4.5/4.1/4, 3.x) 400 on it and require `{type:'enabled', budget_tokens}` —
  and 4.7+ models are the mirror image (budget_tokens 400s). v0.7's
  unconditional-adaptive default (E7-01) therefore 400'd **every** request on
  any pre-4.6 model: the first real L5 round on haiku-4.5 (run 28753349435) was
  0/40, turns=0, cost=$0 while the official arm ran clean. `computeThinking` now
  emits, per LIVE model (recomputed each turn), whichever form the API accepts;
  the boundary is `src/engine/thinking-model.ts` (`supportsAdaptiveThinking`).
  Keyless unit tests missed this because they stub the transport — added
  thinking-model + conformance-l2 wire-form regression locks so the next one
  reds CI. No public API change.

## 0.8.0 — 2026-07-05

- **feat (BEHAVIOR REVERSAL, bump-pin ruling)**: an OMITTED `settingSources`
  now loads **user+project+local** (CLAUDE.md / AGENTS.md / project `.mcp.json`),
  matching official Claude Code and the live `@anthropic-ai/claude-agent-sdk`
  docs. This flips the earlier pinned-0.3.199 default (omitted = load nothing) —
  the last behavior-level NEW-IN-DOCS hold, gated behind the keeper up-pin
  decision because a default flip diverges from the pinned conformance arm.
  An explicit array is honored verbatim: `settingSources: []` is the explicit
  opt-OUT (load nothing); an explicit subset loads exactly that subset. Single
  source of truth: `src/internal/setting-sources.ts` (`resolveSettingSources`).
  Migration: callers who omitted the field to get "no on-disk sources" must now
  pass `settingSources: []` to keep that behavior. See MIGRATION.md §5g.
  (skills/plugins loading remains a separate PARTIAL — unchanged here.)

## 0.7.1 — 2026-07-05

- **feat (BPT-EXTENSION)**: `provider.cacheTtl?: '5m' | '1h'` selects the
  prompt-cache lifetime for the breakpoints this engine places. Omitted / '5m'
  keeps the bare `{ type: 'ephemeral' }` marker (5-minute default, byte-
  identical to before — wire ratchet unaffected); '1h' stamps `ttl: '1h'` on
  every breakpoint (2x write price, GA — no beta header). The official Agent
  SDK exposes NO cache-TTL knob (its wrapped CLI decides internally and only
  reports the 5m/1h split in usage); this direct-API engine lets the caller
  choose. No effect when `promptCaching` is false.

## 0.7.0 — 2026-07-05

Completion-inventory full-implementation batch (keeper ruling 全面实现);
BREAKING items are detailed in MIGRATION.md §4/5f. Built on 0.6.5 (this
branch merged main's 0.6.3–0.6.5 Windows/path-fence work below).

- **BREAKING (observability)**: ten reversed discriminants (task_* /
  hook_* / files_persisted / local_command_output / commands_changed)
  now emit and type as official `{type:'system', subtype:...}` with
  payloads aligned to the 0.3.201 snapshot; `cancelled`->`killed`; four
  export names flip to official spelling (deprecated aliases kept).
- **BREAKING (results/types)**: setMcpServers returns added/removed/
  errors; rewindFiles returns canRewind/error/filesChanged (unknown ids
  soft-fail); SDKResultMessage.stop_reason required on both arms;
  McpServerStatus.tools is the official object array; 22 official
  Options fields enter the type surface. See MIGRATION 5g-5l.
- **feat (wire, E7-01/E7-02)**: `claude_code` preset defaults thinking
  to `{type:"adaptive"}`; Read gains `pages`, Bash always exposes
  `dangerouslyDisableSandbox` (gate unchanged), Agent tool gains
  `model`/`isolation:'worktree'` and the official required set.
- **feat (tools)**: Task quadruplet (TaskCreate/TaskGet/TaskUpdate/
  TaskList) ships as the default task surface per official 0.3.142
  semantics (`CLAUDE_CODE_ENABLE_TASKS=0` reverts to TodoWrite);
  ExitPlanMode, EnterWorktree, Monitor, and Workflow ship, bringing the
  built-in surface to 20/24.
- **feat (types)**: ToolInputSchemas/ToolOutputSchemas exported; official
  type-name aliases; deferred_tool_use official id/name/input dual-track;
  CanUseTool requestId required; Grep `context` alias; tool() accepts the
  official extras wrapper; session rename/tag round-trips (SDKSessionInfo
  customTitle/tag/gitBranch); removeDirectories and suppressOutput honored.
- **feat (resilience)**: maxRetries 4->10 (env-capped 15), stream
  watchdog 120s->300s (env floor), new background-subagent stall
  watchdog (600s default, env-tunable, reports stalls as failed).
- **feat (errors)**: McpError taxonomy over 12 bare throws, stable
  machine-readable `code` on every error (docs/ERRORS.md), throw-
  discipline guard test; sse_malformed_frame/stream_idle_timeout wired.
- E7-03 cache-breakpoint divergence measured and kept as a documented
  KD (premise-locked); wire ratchet shrinks to Agent:params (BPT `fork`
  extension) + placement/thinking residuals.

## 0.6.5 — 2026-07-05

- **fix (Windows)**: foreground Bash termination (timeout/abort) used the same
  POSIX-only `process.kill(-pid)` process-group call as the background
  KillShell bug — a no-op on Windows with the failure swallowed. Now routes
  through planProcessKill (win32 -> taskkill /T /F). Found by the new guard,
  not a fourth pilot report.
- **test/guard**: posix-hazard static guard (`tests/posix-hazard-guard.test.ts`)
  scans src/ for engine-code Windows hazards below the tool interface
  (`process.kill(-pid)`, bare `spawn('bash'/'sh')`, hardcoded `/tmp`); an
  unmarked hit reds CI. Legit platform-branched sites carry a `win-ok:` marker.
  Machine prevention for the POSIX-first-Windows-afterthought defect class.

## 0.6.4 — 2026-07-05

- **behavior/security (keeper ruling, BPT report #2)**: Read/Write/Edit no
  longer enforce a hard cwd+additionalDirectories path fence — they resolve
  paths and reach any location the process can, with the PERMISSION GATE as
  the sole access control (official Claude Code posture). The v0.1 fence was
  BPT-specific, inconsistent (Grep/Glob/Bash never had it), and — with Bash
  present — never a real security boundary, only a false sense of one.
  `fsutil.resolveWithin` -> `resolveAbs`. `additionalDirectories` keeps its
  real role (sandbox writablePaths). Consumers relying on the fence as a
  security control must use `permissionMode` / `canUseTool` instead.

## 0.6.3 — 2026-07-05

- **fix (Windows)**: KillShell now actually terminates background shells on
  Windows (`taskkill /PID <pid> /T /F`) instead of the POSIX-only
  `process.kill(-pid)` that silently no-op'd; the swallowing empty catch is
  gone (failures go to debug). (BPT Windows pilot incident #3)
- **fix (honesty)**: background-shell terminal status is decided at exit from
  what actually happened, never forced to 'killed' when kill() is called — a
  job that runs to completion reports `completed` even if a kill lost the
  race (previously marked 'killed' forever). New `kill-plan.ts` pure
  functions (`planProcessKill`, `terminalStatus`) unit-test both the Windows
  branch and the status rule on any host.

## 0.6.2 — 2026-07-05

- **fix (Windows)**: Bash tool shell resolution — `CLAUDE_CODE_GIT_BASH_PATH`
  honored, Git for Windows probed at standard locations, actionable guidance
  instead of `spawn sh ENOENT`; bare `bash` never tried on Windows (WSL trap).
  (#479, BPT Windows pilot incident #2)
- **fix (MCP)**: server-initiated `elicitation/create` with NO `onElicitation`
  handler now auto-declines on the wire as documented (the guard that made the
  decline branch dead code removed; previously replied `-32601`). (#477)
- test-only alongside: official pins chased 0.3.199 -> 0.3.201, zero
  conformance drift (#478).

## 0.6.1 — 2026-07-05 (retroactive label)

- **fix (transport)**: gateway SSE dialect tolerance — consumption stops at
  `message_stop` (official-client lifecycle); event-less non-JSON frames
  before stop are skipped; malformed NAMED frames still throw, now with
  evidence (event, frame count, data snippet). Closes the BPT production
  incident `Malformed SSE payload for event "(none)"` behind the idealab
  gateway. (#461)
- **feat/behavior (engine alignment batch E1–E5)**: `claude_code` preset
  defaults extended thinking ON; Write enforces the official
  read-before-write gate; `maxBudgetUsd` stops BEFORE executing an
  in-flight tool group; truncated turns degrade gracefully (salvage complete
  blocks); **breaking**: `result` messages report official per-result
  semantics (`num_turns`/`usage` per result, cost/apiMs cumulative — see
  MIGRATION 5e). (#462)

## 0.6.0 — 2026-07-05

- v0.6 feature series: generators/classifiers as shipped product features
  (`src/generators/`), verifier (`src/verifier/`), context tips (`src/tips/`),
  memory-file selection, hook condition gating, worker-fork preset, default-on
  Bash sandbox (pluggable bwrap backend), prompt assembly layer Track B with
  v5 as the `claude_code` preset default.

---

_The 0.1–0.5 entries below are retroactive: the foundational series shipped on
2026-07-04 without a per-merge ledger, so these are reconstructed from the
commit sequence and their granularity stops at the commit-title level. 0.6+ above
is the real per-merge record._

## 0.5 — 2026-07-04

- Productization + docs series: generators + classifiers scaffolding
  (`src/generators/`); verifier + context tips; the prompt-assembly layer with
  the `v5` `claude_code` preset (open reproduction of the official main-loop
  prompt); the COMPAT compatibility matrix, the MIGRATION guide, and the
  positioning docs.

## 0.4 — 2026-07-04

- Interaction + subagents: AskUserQuestion + WebSearch + host callbacks
  (`onUserQuestion` / `webSearch` / `onElicitation`); tool permission
  specifiers with `allowedTools` / `disallowedTools` rule-level gating;
  subagent Task tool + worker fork.

## 0.3 — 2026-07-04

- Persistence + credentials: JSONL session store (`resume` / `continue` /
  `forkSession`); the `provider` extension + gateway (Bearer-token) auth —
  connection settings the official SDK does not expose.

## 0.2 — 2026-07-04

- Gating + external tools: permissions + hooks + `canUseTool` gating; MCP
  client with stdio + streamable-HTTP transports.

## 0.1 — 2026-07-04

- Engine skeleton: clean-room scaffold; the direct Messages-API transport
  (`fetch` + SSE) + agent engine loop; the six built-in tools
  (Read/Write/Edit/Bash/Glob/Grep). No filesystem settings are loaded
  (`settingSources` accepted but inert).
