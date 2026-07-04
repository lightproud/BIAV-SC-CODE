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

Surface is drop-in; behavior is not bit-identical — the engine and the system
prompt are independent implementations (see POSITIONING.md §2 for why this is
structural, not a backlog):

1. **Model "feel"**: the official CLI's proprietary system prompt is not
   reproduced (clean-room discipline). Tool choice, formatting and refusal
   edges can drift. `systemPrompt: { preset: 'claude_code' }` maps to this
   SDK's own harness prompt.
2. **Costs are estimates**: `total_cost_usd` comes from a static price table.
   Per-run `result.metrics` (turns / tokens / cache hit ratio / per-tool
   timings) is the instrument to watch instead.
3. **Grep** is a pure-JS regex engine, not ripgrep — fine for project trees,
   slow on monorepos.
4. **Bash state** persists `cd` + exported vars via state-file replay, not a
   long-lived shell: functions/aliases/unexported vars reset per call.
5. **No filesystem settings**: `settingSources` loads only a project
   `.mcp.json`; CLAUDE.md / skills / plugins / sandbox are CLI-coupled and
   deliberately absent. Everything is configured through `Options`.
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
