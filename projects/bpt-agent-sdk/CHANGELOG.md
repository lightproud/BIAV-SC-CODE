# Changelog — bpt-agent-sdk

Consumer-facing build ledger (BPT pins `npm pack` tarballs by this version:
`bpt-agent-sdk-<version>.tgz`). Discipline, in force since 0.6.2: **every
merge that changes shipped runtime code (`src/` or runtime dependencies)
bumps the version** — bug fixes bump patch, new capability bumps minor —
and adds one line here. A CI guard (`scripts/check-version-bump.mjs`) reds
any src-changing merge that forgets. 0.6.1 and 0.6.2 below are retroactive
labels for builds that shipped under a duplicated "0.6.0".

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
