# silver-core-sdk

An independent TypeScript agent harness whose public surface is drop-in
compatible with `@anthropic-ai/claude-agent-sdk`, but whose engine drives the
**Anthropic Messages API directly** (`fetch` + SSE). There is no bundled CLI
executable and no subprocess: the agent loop, tool dispatch, permissions,
hooks, MCP and session persistence are all implemented in this package.

Naming: the npm package is **`silver-core-agent-sdk`** (the Silver Core
Agent SDK); the runtime brand strings (User-Agent, log prefixes) remain
`silver-core-sdk`. It forms the Silver Core SDK family with
`silver-core-maestro-sdk` (the orchestration package — clocks, cross-session
state, session assembly); the two packages version in **lockstep** (always
the same number) with a one-way dependency maestro → agent.

## Identity statement (as-is)

This repository is a game project's **by-product**, provided **as-is**: no
support commitment, and issues / PRs may go unanswered. Contributions are
only considered with the contract suite fully green (`npm test` passing;
mutation-ratchet floors unbroken for touched targets). 中文:本仓为游戏项目
副产品,按 as-is 提供,无支持承诺,PR 可能不被处理;回贡仅收契约套件全绿的 PR。

The **engine** is an independent reimplementation grounded in the public SDK
documentation and the public Messages API documentation — no proprietary code
copied. The **default system prompts** are an *open reproduction* of the
official Claude Code prompts, assembled from a public reconstruction
(reverse-engineered from the publicly distributed CLI, MIT-licensed) with
attribution — not self-authored text. No genuinely internal or leaked material
is used ("publicly distributed, reverse-engineerable" is not "an internal
leak").

> **New maintainer?** [docs/ONBOARDING.md](./docs/ONBOARDING.md) gets you from
> zero to a safe, verified change in ~30 minutes.

## Install

```bash
npm install silver-core-agent-sdk
```

Requires Node.js `>= 20.3` (`AbortSignal.any`). **ESM only** - this
package ships `"type": "module"` and cannot be `require()`d from CommonJS;
use `import` (or dynamic `import()` from CJS).

## Quickstart

```ts
import { query } from 'silver-core-agent-sdk';

const q = query({
  prompt: 'Summarize the files in this directory.',
  options: { maxTurns: 10 },
});

for await (const message of q) {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') process.stdout.write(block.text);
    }
  } else if (message.type === 'result') {
    process.stdout.write(`\ndone: ${message.subtype}\n`);
  }
}
```

Set `ANTHROPIC_API_KEY` in the environment before running.

## Drop-in migration from @anthropic-ai/claude-agent-sdk

```bash
npm uninstall @anthropic-ai/claude-agent-sdk
npm install silver-core-agent-sdk
```

Then swap the import:

```ts
// before
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
// after
import { query, tool, createSdkMcpServer } from 'silver-core-agent-sdk';
```

Most call sites need no further change. Key differences to be aware of:

- **No CLI subprocess.** Options that configure the reference SDK's bundled
  executable (`pathToClaudeCodeExecutable`, `executable`, `executableArgs`,
  `spawnClaudeCodeProcess`, ...) are accepted for compatibility and ignored
  with a debug warning.
- **Credentials** come from `options.provider` (see below) or the
  `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` environment variables.
- **`total_cost_usd` is an estimate** computed from a static price table.
- **Filesystem settings load by DEFAULT** (v0.8 load-all default):
  omitting `settingSources` injects user+project+local `CLAUDE.md` /
  `AGENTS.md` (preset/default prompt path) and loads a project `.mcp.json`
  (every path). Opt out with `settingSources: []`. skills/plugins are not
  read.
- Sessions persist to this SDK's own JSONL store (see Sessions below), so
  `resume` / `continue` only see sessions created by this SDK.

The full per-feature compatibility matrix (FULL / PARTIAL / ACCEPTED /
UNSUPPORTED tiers) lives in [docs/COMPAT.md](./docs/COMPAT.md).

Disconnect survival — request retries, bounded turn replay, truncation
salvage, body-governance timeouts, and the `metrics.transportHealth`
ledger — is documented in [docs/RESILIENCE.md](./docs/RESILIENCE.md),
including the consumer-side session auto-resume recipe.

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | API key auth (sent as `x-api-key`) |
| `ANTHROPIC_AUTH_TOKEN` | Bearer token auth for gateways (sent as `Authorization: Bearer ...`) |
| `ANTHROPIC_BASE_URL` | API base URL (default `https://api.anthropic.com`) |
| `ANTHROPIC_MODEL` | Default model when `options.model` is not set (fallback `claude-sonnet-4-5`) |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | Credential / base URL for `provider.protocol: 'openai-chat'` (see docs/OPENAI-PROTOCOL.md) |
| `BPT_AGENT_HOME` | Home directory for SDK state; sessions live in `$BPT_AGENT_HOME/sessions` (default `~/.bpt-agent/sessions`) |
| `BPT_MAX_CONCURRENT_REQUESTS` | Cap on concurrent in-flight API requests through one transport (default unlimited) |
| `BPT_STREAM_MAX_DURATION_MS` | Optional hard cap on total streaming duration per turn (default off; see docs/RESILIENCE.md) |
| `CLAUDE_CODE_MAX_RETRIES` | Request retry count (default 10, env capped at 15) |
| `CLAUDE_STREAM_IDLE_TIMEOUT_MS` / `CLAUDE_ENABLE_STREAM_WATCHDOG` | Stream idle watchdog window (default 300000ms; `0` disables via the watchdog switch) |
| `CLAUDE_CODE_ENABLE_TASKS` | Toggle the Task tool family |
| `CLAUDE_CODE_GIT_BASH_PATH` | Windows: explicit Git Bash location for the Bash tool |
| `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` | Background-subagent stall watchdog (0 disables) |

## The provider option (BPT extension)

Because this SDK talks to the Messages API itself, connection settings live
on `options.provider`:

```ts
const q = query({
  prompt: '...',
  options: {
    provider: {
      apiKey: process.env.MY_KEY,      // or authToken for gateways
      baseUrl: 'https://my-gateway.example.com',
      maxRetries: 4,
      timeoutMs: 600_000,
      maxOutputTokens: 8192,           // default: 8192 (anthropic) / 128000 (openai-chat)
      defaultHeaders: { 'x-team': 'bpt' },
    },
  },
});
```

Every field is optional and falls back to the environment variables above.

### OpenAI protocol (BPT extension)

Set `provider.protocol: 'openai-chat'` to drive an OpenAI-compatible Chat
Completions endpoint (api.openai.com, DeepSeek, vLLM, one-api gateways) with
the same agent harness — the engine keeps speaking Messages API shapes and a
translating transport converts at the wire boundary. Credentials then resolve
from `provider.apiKey` / `OPENAI_API_KEY`, the base URL from
`provider.baseUrl` / `OPENAI_BASE_URL` (default `https://api.openai.com/v1`),
and `options.model` must name a model the endpoint serves. Details, tuning
knobs and honest limits: [docs/OPENAI-PROTOCOL.md](./docs/OPENAI-PROTOCOL.md).

## Sessions

Transcripts are stored one JSONL file per session under the sessions
directory (`options.sessionDir` > `$BPT_AGENT_HOME/sessions` >
`~/.bpt-agent/sessions`). Use:

- `options.resume: '<sessionId>'` to resume a stored session,
- `options.continue: true` to resume the most recent one,
- `options.forkSession: true` to copy the resumed transcript under a new id,
- `options.persistSession: false` to disable persistence,
- `listSessions()` / `getSessionInfo(sessionId)` to inspect the store.

## Built-in tools

22 default built-ins: the core six (`Read`, `Write`, `Edit`, `Bash`, `Glob`,
`Grep`) plus `WebFetch`, `WebSearch`, `AskUserQuestion`, `TodoWrite`,
`NotebookEdit`, `ExitPlanMode`, `EnterWorktree`, background-task tools
(`Bash run_in_background`, `BashOutput`, `KillShell`, `TaskOutput`,
`TaskStop`, `Monitor`), `Agent` (when subagents are configured), `Workflow`,
`ListMcpResources` / `ReadMcpResource`, and `ToolSearch` (when deferral is
active). The authoritative list is `enumerateBuiltinToolMetadata()` /
`src/tools/index.ts`. Restrict with
`options.tools: ['Read', 'Grep']`, gate with `allowedTools` /
`disallowedTools` rules (including `Bash(npm run:*)`-style specifiers),
`permissionMode`, hooks and `canUseTool`. Add your own tools with
`tool()` + `createSdkMcpServer()`, or connect external MCP servers
(stdio and streamable HTTP) via `options.mcpServers`.

## Memory (cross-session, BPT-EXTENSION)

`options.memory` enables a `memory_20250818`-equivalent six-command memory
tool whose storage the host injects (`MemoryStore` contract; local-filesystem
default under `<cwd>/.claude/memory`). On the Anthropic protocol the official
typed entry is sent and the API injects the tool definition + protocol prompt;
on `openai-chat` (or `mode: 'custom'`) the SDK advertises an equivalent tool
and injects the docs-verbatim protocol itself — same consuming code, identical
store artifacts. The head of `/memories/MEMORY.md` is auto-injected at session
start (capped; lazily `view` the rest). See [docs/MEMORY.md](./docs/MEMORY.md).

## /loop interval loops (BPT-EXTENSION)

The official SDK has no recurring-prompt facility, so an unrecognized
`/loop 10m <task>` would fall through slash-command expansion as a ONE-SHOT
plain prompt and the recurrence would be silently lost. `parseLoopCommand`
is the single source of truth for the `/loop [<interval>] <task>` grammar
(units `s|m|h`, default `10m`), and `createPromptLoop` drives a host-owned
runner on a fixed-delay cadence (next run scheduled `intervalMs` after the
previous one settles — runs never overlap). The host bridge is thin:

```ts
import { parseLoopCommand, createPromptLoop, LOOP_SLASH_COMMAND } from 'silver-core-agent-sdk';

const parsed = parseLoopCommand(userInput);
if (parsed) {
  if (!parsed.ok) return showError(parsed.error); // never pass through as a prompt
  const loop = createPromptLoop({
    ...parsed.directive,                // intervalMs + prompt
    run: (prompt) => submitTurn(prompt), // host-owned: e.g. a new query() turn
    onError: 'stop',                    // default; 'continue' or a callback
    signal: sessionAbort.signal,
  });
  loop.start();                         // immediate first run, then fixed-delay
  await loop.done;                      // { iterations, stopReason, error? }
}
```

`LOOP_SLASH_COMMAND` is menu metadata for hosts that wire this bridge; it is
deliberately NOT an engine built-in — the engine loop cannot re-invoke itself
over wall-clock time, and advertising a command the engine would swallow as
plain text is the honesty red line.

## /goal session goals (BPT-EXTENSION)

`/goal <condition>` arms a session-scoped Stop gate: when the agent tries to
stop, the faithful stop-variant condition evaluator judges the transcript;
"not met" blocks the stop (the reason is fed back as a user turn and the
loop keeps working — engine `maxTurns` / `maxBudgetUsd` still cap it), "met"
auto-clears, and the evaluator's `impossible` escape hatch clears without
looping forever. `/goal clear` disarms early. The engine's Stop-hook block
semantics (v0.39) and the evaluator prompt already shipped; this module is
the missing surface. Host bridge:

```ts
import { createSessionGoal, GOAL_SLASH_COMMAND } from 'silver-core-agent-sdk';

const goal = createSessionGoal({
  utility: { provider },              // evaluator credentials (Haiku default)
  onEvent: (e) => updateBadge(e),     // set/met/blocked/impossible/...
});
// wire ONCE into every query of the session:
const q = query({ prompt, options: { hooks: { ...goal.hooks() } } });
// route user input BEFORE submitting it as a prompt:
const outcome = goal.handleCommand(userInput);
if (outcome.handled) {
  return outcome.ok ? showInfo(outcome.message) : showError(outcome.error);
}
```

Failure direction is deliberately INVERTED from the generic hook-condition
gate: there the dangerous act is firing a hook (unverified → don't fire);
here the dangerous act is BLOCKING the stop, so an errored/unparseable/
context-less evaluation ALLOWS the stop and keeps the goal armed — a broken
judge must never trap the agent in a forced loop. `GOAL_SLASH_COMMAND` is
menu metadata only, not an engine built-in (same honesty red line as /loop).

## Examples

Runnable examples live in [examples/](./examples):

- `basic.ts` - single string prompt.
- `custom-tools.ts` - in-process SDK MCP server with a custom tool.
- `streaming-input.ts` - multi-turn AsyncIterable input.
- `hooks-permissions.ts` - PreToolUse hook, permission rules, canUseTool.
- `electron-host.mjs` - the BPT Desktop pilot-swap shape: all four host
  callbacks, streaming input, the renderer message pump, metrics.
- `ab-metrics.mjs` - per-run metrics comparison harness.

Run with `npx tsx examples/basic.ts` (or `node examples/electron-host.mjs`)
from a checkout after `npm run build`.

## License

MIT. See [LICENSE](./LICENSE).
