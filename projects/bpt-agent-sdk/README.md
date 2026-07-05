# bpt-agent-sdk

An independent TypeScript agent harness whose public surface is drop-in
compatible with `@anthropic-ai/claude-agent-sdk`, but whose engine drives the
**Anthropic Messages API directly** (`fetch` + SSE). There is no bundled CLI
executable and no subprocess: the agent loop, tool dispatch, permissions,
hooks, MCP and session persistence are all implemented in this package.

The **engine** is an independent reimplementation grounded in the public SDK
documentation and the public Messages API documentation — no proprietary code
copied. The **default system prompts** are an *open reproduction* of the
official Claude Code prompts, assembled from a public reconstruction
(reverse-engineered from the publicly distributed CLI, MIT-licensed) with
attribution — not self-authored text. No genuinely internal or leaked material
is used ("publicly distributed, reverse-engineerable" is not "an internal
leak").

## Install

```bash
npm install bpt-agent-sdk
```

Requires Node.js `>= 20.3` (`AbortSignal.any`). **ESM only** - this
package ships `"type": "module"` and cannot be `require()`d from CommonJS;
use `import` (or dynamic `import()` from CJS).

## Quickstart

```ts
import { query } from 'bpt-agent-sdk';

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
npm install bpt-agent-sdk
```

Then swap the import:

```ts
// before
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
// after
import { query, tool, createSdkMcpServer } from 'bpt-agent-sdk';
```

Most call sites need no further change. Key differences to be aware of:

- **No CLI subprocess.** Options that configure the reference SDK's bundled
  executable (`pathToClaudeCodeExecutable`, `executable`, `executableArgs`,
  `spawnClaudeCodeProcess`, ...) are accepted for compatibility and ignored
  with a debug warning.
- **Credentials** come from `options.provider` (see below) or the
  `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` environment variables.
- **`total_cost_usd` is an estimate** computed from a static price table.
- **No filesystem settings loading** in v0.1: `settingSources` is accepted
  but no `CLAUDE.md`, settings files, skills or plugins are read.
- Sessions persist to this SDK's own JSONL store (see Sessions below), so
  `resume` / `continue` only see sessions created by this SDK.

The full per-feature compatibility matrix (FULL / PARTIAL / ACCEPTED /
UNSUPPORTED tiers) lives in [docs/COMPAT.md](./docs/COMPAT.md).

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | API key auth (sent as `x-api-key`) |
| `ANTHROPIC_AUTH_TOKEN` | Bearer token auth for gateways (sent as `Authorization: Bearer ...`) |
| `ANTHROPIC_BASE_URL` | API base URL (default `https://api.anthropic.com`) |
| `ANTHROPIC_MODEL` | Default model when `options.model` is not set (fallback `claude-sonnet-4-5`) |
| `BPT_AGENT_HOME` | Home directory for SDK state; sessions live in `$BPT_AGENT_HOME/sessions` (default `~/.bpt-agent/sessions`) |

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
      maxOutputTokens: 8192,
      defaultHeaders: { 'x-team': 'bpt' },
    },
  },
});
```

Every field is optional and falls back to the environment variables above.

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

`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`. Restrict with
`options.tools: ['Read', 'Grep']`, gate with `allowedTools` /
`disallowedTools` rules (including `Bash(npm run:*)`-style specifiers),
`permissionMode`, hooks and `canUseTool`. Add your own tools with
`tool()` + `createSdkMcpServer()`, or connect external MCP servers
(stdio and streamable HTTP) via `options.mcpServers`.

## Examples

Runnable examples live in [examples/](./examples):

- `basic.ts` - single string prompt.
- `custom-tools.ts` - in-process SDK MCP server with a custom tool.
- `streaming-input.ts` - multi-turn AsyncIterable input.
- `hooks-permissions.ts` - PreToolUse hook, permission rules, canUseTool.

Run with `npx tsx examples/basic.ts` from a checkout.

## License

MIT. See [LICENSE](./LICENSE).
