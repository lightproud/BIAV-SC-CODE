# BPT Agent SDK — Compatibility Matrix (v0.1)

Target surface: `@anthropic-ai/claude-agent-sdk` public API as documented at
code.claude.com/docs/en/agent-sdk/typescript (fetched 2026-07-03).

Tiers:
- **FULL** — implemented with documented semantics.
- **PARTIAL** — implemented with a documented behavioral subset/difference.
- **ACCEPTED** — type-compatible; accepted at runtime with a debug warning,
  no behavior in v0.1.
- **UNSUPPORTED** — absent from types or throws `NotImplementedError`.

## Exported functions

| Export | Tier | Notes |
|---|---|---|
| `query()` | FULL | string and AsyncIterable prompt modes |
| `tool()` | FULL | zod v4 raw shapes; JSON Schema derived via `z.toJSONSchema` |
| `createSdkMcpServer()` | FULL | in-process dispatch, no wire protocol |
| `listSessions()` / `getSessionInfo()` | PARTIAL | reads this SDK's own JSONL store only |
| `startup()` / `WarmQuery` | UNSUPPORTED | no subprocess to pre-warm; direct API needs no warmup |
| `getSessionMessages()` / `renameSession()` / `tagSession()` / `resolveSettings()` | UNSUPPORTED | v0.2 candidates |

## Engine difference (the point of this SDK)

The reference SDK spawns the proprietary Claude Code CLI as its engine. This
SDK implements the agent loop directly against the public Messages API:
`fetch` + SSE, tool_use dispatch, multi-turn history. Consequences:
- No `pathToClaudeCodeExecutable`, `executable`, `executableArgs`,
  `spawnClaudeCodeProcess` (ACCEPTED, ignored — there is no subprocess).
- Credentials come from `options.provider` (BPT extension) or
  `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`.
- `total_cost_usd` is an **estimate** from a static price table.
- No filesystem settings/CLAUDE.md/skills/plugins loading in v0.1
  (`settingSources` ACCEPTED, loads nothing).

## Options fields

| Field | Tier | Notes |
|---|---|---|
| `abortController` | FULL | |
| `additionalDirectories` | FULL | fs tools + additionalDirectories containment |
| `agents` | ACCEPTED | subagents land in v0.2 |
| `allowedTools` / `disallowedTools` | FULL | incl. `Tool(spec)` prefix rules and `mcp__srv__*` |
| `canUseTool` | FULL | |
| `continue` | PARTIAL | resumes latest session from this SDK's store |
| `cwd` | FULL | |
| `env` | FULL | used for transport + Bash tool |
| `fallbackModel` | PARTIAL | one retry per turn on 429/5xx |
| `forkSession` | FULL | |
| `hooks` | PARTIAL | see hook table |
| `includePartialMessages` | FULL | raw stream events as `stream_event` |
| `maxBudgetUsd` | FULL | based on estimated cost |
| `maxThinkingTokens` / `thinking` | FULL | maps to Messages API `thinking` |
| `maxTurns` | FULL | |
| `mcpServers` | PARTIAL | stdio/http/sdk FULL; `sse` legacy transport UNSUPPORTED |
| `model` | FULL | default `ANTHROPIC_MODEL` env or `claude-sonnet-4-5` |
| `permissionMode` | PARTIAL | `default`/`acceptEdits`/`bypassPermissions`/`plan`/`dontAsk`; `auto` (classifier) not offered |
| `persistSession` / `sessionId` / `resume` | FULL | JSONL store |
| `provider` | FULL | **BPT extension** — direct-API connection settings |
| `settingSources` | ACCEPTED | no filesystem settings in v0.1 |
| `stderr` | PARTIAL | receives debug log lines (no subprocess stderr exists) |
| `strictMcpConfig` | FULL | trivially: only options servers are ever used |
| `systemPrompt` | PARTIAL | preset `claude_code` maps to this SDK's own harness prompt (+`append`) |
| `tools` | PARTIAL | string[] filters built-ins; preset = all built-ins |
| `betas` | FULL | forwarded as `anthropic-beta` header |
| `debug` / `debugFile` | PARTIAL | `debug` → stderr callback; `debugFile` ACCEPTED |
| `effort`, `outputFormat`, `sandbox`, `plugins`, `skills`, `toolAliases`, `toolConfig`, `sessionStore*`, `managedSettings`, `enableFileCheckpointing`, `taskBudget`, `onElicitation`, `planModeInstructions`, `promptSuggestions`, `agentProgressSummaries`, `forwardSubagentText`, `includeHookEvents`, `loadTimeoutMs`, `allowDangerouslySkipPermissions`, `title`, `resumeSessionAt` | ACCEPTED | warned + ignored in v0.1 (typed loosely via `Options` extension slot in v0.2 planning) |

## Built-in tools

| Tool | Tier | Notes |
|---|---|---|
| Read | PARTIAL | text files; images/PDF/notebooks not rendered |
| Write / Edit | FULL | same input field names (`file_path`, `old_string`, …) |
| Bash | PARTIAL | no persistent shell state across calls; no sandboxing |
| Glob | FULL | fast-glob, mtime-sorted |
| Grep | PARTIAL | pure-JS regex engine (no ripgrep binary); large-repo perf caveat |
| WebFetch / WebSearch / Task / TodoWrite / NotebookEdit / MultiEdit / KillShell / BashOutput | UNSUPPORTED | not registered in v0.1 |

## SDKMessage stream

| Variant | Tier | Notes |
|---|---|---|
| `system/init` | FULL | apiKeySource, tools, mcp_servers, model, permissionMode |
| `assistant` | FULL | full `APIAssistantMessage` |
| `user` (echo + tool results) | FULL | |
| `stream_event` | FULL | behind `includePartialMessages` |
| `result` success / error_max_turns / error_during_execution | FULL | + `error_max_budget` (BPT extension) |
| `system/compact_boundary` | UNSUPPORTED | no auto-compaction in v0.1 |

## Hooks

| Event | Tier | Notes |
|---|---|---|
| PreToolUse | FULL | allow/deny/ask + updatedInput; deny > ask > allow |
| PostToolUse | FULL | additionalContext + updatedToolOutput |
| PostToolUseFailure | FULL | |
| PostToolBatch | FULL | |
| UserPromptSubmit | FULL | additionalContext; block stops the turn |
| MessageDisplay | FULL | |
| Stop | FULL | fired at natural end of a run |
| SessionStart / SessionEnd | FULL | |
| Notification | PARTIAL | fired for permission denials only in v0.1 |
| SubagentStart / SubagentStop | ACCEPTED | never fire (no subagents yet) |
| PreCompact | ACCEPTED | never fires (no compaction yet) |
| PermissionRequest | ACCEPTED | never fires in v0.1 |
| `defer` permission decision | UNSUPPORTED | treated as deny with warning |
| Matcher semantics | FULL | exact-set vs regex rules per docs |
| `async: true` outputs | FULL | fire-and-forget |
| Settings-file shell hooks | UNSUPPORTED | callback hooks only |

## Query methods

| Method | Tier | Notes |
|---|---|---|
| `interrupt()` | FULL | |
| `setPermissionMode()` / `setModel()` / `setMaxThinkingTokens()` | FULL | |
| `initializationResult()` / `supportedModels()` / `supportedCommands()` / `supportedAgents()` | PARTIAL | static/empty data (no CLI to introspect) |
| `mcpServerStatus()` | FULL | |
| `accountInfo()` | PARTIAL | apiKeySource only |
| `streamInput()` | FULL | streaming-input mode |
| `close()` | FULL | |
| `rewindFiles()` / `reinitialize()` / `applyFlagSettings()` / `setMcpServers()` / `reconnectMcpServer()` / `toggleMcpServer()` / `stopTask()` | UNSUPPORTED in types v0.1 | `reconnect/toggle` exist on the registry; surfacing on Query in v0.2 |
