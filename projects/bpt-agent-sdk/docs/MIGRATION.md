# Migrating BPT Desktop from `@anthropic-ai/claude-agent-sdk`

Audience: the BPT Desktop (Electron) codebase currently importing the official
Claude Agent SDK. This SDK is a surface-compatible drop-in whose engine drives
the Anthropic Messages API directly — no CLI subprocess, nothing to install
beside the package itself.

Compatibility surface is pinned to the official **0.3.199** baseline
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
5. **No filesystem settings**: `settingSources` loads only a project
   `.mcp.json`; CLAUDE.md / skills / plugins are CLI-coupled and deliberately
   absent. Everything is configured through `Options`.
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
   v0.6), matching the observable official default. Budget defaults to 4096
   (our chosen value — the official budget is unobservable); opt out with
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
