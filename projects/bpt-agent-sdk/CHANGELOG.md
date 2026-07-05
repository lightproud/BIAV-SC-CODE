# Changelog — bpt-agent-sdk

Consumer-facing build ledger (BPT pins `npm pack` tarballs by this version:
`bpt-agent-sdk-<version>.tgz`). Discipline, in force since 0.6.2: **every
merge that changes shipped runtime code (`src/` or runtime dependencies)
bumps the version** — bug fixes bump patch, new capability bumps minor —
and adds one line here. A CI guard (`scripts/check-version-bump.mjs`) reds
any src-changing merge that forgets. 0.6.1 and 0.6.2 below are retroactive
labels for builds that shipped under a duplicated "0.6.0".

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
