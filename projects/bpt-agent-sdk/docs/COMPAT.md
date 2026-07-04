# BPT Agent SDK — Compatibility Matrix

Target surface: `@anthropic-ai/claude-agent-sdk` public API (npm 0.3.199) as
documented at code.claude.com/docs/en/agent-sdk/* (fetched 2026-07-03).

For a full 146-row completion audit against the latest official surface
(including the unmodeled subsystems and the roadmap), see
`Public-Info-Pool/Resource/repo-engineering/bpt-agent-sdk-completion-audit-20260703.md`.

## v0.2 status (what graduated from the v0.1 audit)

v0.2 implemented most of the P0/P1 gaps the audit flagged. Now **FULL / PARTIAL**
(were MISSING/ACCEPTED in v0.1):

- **Context compaction** — auto threshold + `/compact` + PreCompact hook +
  `compact_boundary` emission (tokenizer-free, CJK-aware estimator).
- **Structured outputs** — `outputFormat` json_schema, validate + re-prompt,
  `structured_output` result, `error_max_structured_output_retries`.
- **Subagent runtime** — Agent tool, `agents` executed, foreground + background
  tasks (budget/turn-capped), depth cap, `parent_tool_use_id` threading, `stopTask`.
- **Permissions v2** — official 6-step order, ask rules first-class,
  `permissionMode: 'auto'` classifier (unknown non-readonly → prompt),
  `canUseTool` full context + `null`=skip, `defer` end-to-end.
- **Prompt caching** — `cache_control` breakpoints **on by default** (matches
  the official SDK; disable via `provider.promptCaching: false`; capped at the
  API's 4-breakpoint max), `ttft_ms`/`deferred_tool_use` result extras, init
  fields, hook input `tool_use_id`/`duration_ms`, MCP audio/resource_link,
  `.mcp.json` loading, `thinking.budgetTokens` alias.
- **New builtin tools** — WebFetch (streamed + SSRF guard), WebSearch (host
  callback), AskUserQuestion (host callback), TodoWrite; MCP elicitation.
- **Sessions** — external `SessionStore` mirror; file checkpointing +
  `rewindFiles`; tool search (deferred MCP schemas); standalone session
  functions; Query methods (reconnect/toggle/setMcpServers/rewindFiles/stopTask).

The full observability/status message arm was TYPED in v0.3 (task #16) so the
SDKMessage union is exhaustive for drop-in consumers; `permission_denied` is
emitted, the rest are typed-not-emitted (see the Observability arm table below).

Still deliberately out of scope (N/A-by-design): the CLI-coupled subsystems
(CLI system prompt, settings engine, bubblewrap sandbox, Bedrock/Vertex/Foundry,
OTel), and the WarmQuery/startup pre-warm lifecycle. See the audit for the
rationale.

The per-field tiers below were reconciled against actual code as of the v0.1
adversarial-review pass; the v0.2 graduations above supersede the "MISSING/
ACCEPTED" entries for the listed subsystems.

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
| `tool()` | FULL | zod v4 raw shapes; JSON Schema derived via `z.toJSONSchema`; optional 5th `annotations` (ToolAnnotations) forwarded onto the definition (task #17) |
| `createSdkMcpServer()` | FULL | in-process dispatch, no wire protocol |
| `listSessions()` / `getSessionInfo()` | PARTIAL | reads this SDK's own JSONL store only; option bag accepts `dir` (alias for `sessionDir`) + `limit`; `includeWorkspace` typed but not honored (no Claude Code store interop) (task #17) |
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
- **Parallel read-only tool execution** (bucket-1): within one assistant turn,
  a maximal run of ≥2 consecutive **read-only builtin** tools (Read/Glob/Grep)
  executes concurrently (`Promise.all`); non-read-only and lone tools stay
  sequential. Results stay in tool_use order; a stop/defer from any tool
  overrides the rest of its concurrent group with a "Not executed" marker, so
  the observable contract matches sequential execution. Read-only builtins in
  `default` mode already auto-approve via the gate; wiring an MCP tool's
  `readOnlyHint` annotation into that path (auto-approve + parallel grouping)
  is a follow-up (McpToolEntry does not yet carry annotations).

## Options fields

| Field | Tier | Notes |
|---|---|---|
| `abortController` | FULL | |
| `additionalDirectories` | FULL | fs tools + additionalDirectories containment |
| `agents` | ACCEPTED | subagents land in v0.2 |
| `allowedTools` / `disallowedTools` | PARTIAL | `Tool(spec)` prefix rules + `mcp__srv__*` (exact server match); bare-name `disallowedTools` removes the tool definition from the request; plan mode never auto-approves writes via an allow rule; rewritten inputs re-checked against deny rules. Deny-position `*`/`mcp__*` globs not yet supported |
| `canUseTool` | PARTIAL | invoked on prompt-fallthrough; `updatedInput`/`updatedPermissions` honored (incl. hook-`ask` rewrite); `suggestions`/`requestId` not passed; `null` return treated as deny (not skip-response) |
| `continue` | PARTIAL | resumes latest session from this SDK's store |
| `cwd` | FULL | |
| `env` | FULL | used for transport + Bash tool |
| `fallbackModel` | PARTIAL | one retry per turn on 429/5xx |
| `forkSession` | FULL | |
| `hooks` | PARTIAL | see hook table |
| `includePartialMessages` | FULL | raw stream events as `stream_event` |
| `maxBudgetUsd` | FULL | based on estimated cost |
| `maxThinkingTokens` / `thinking` | PARTIAL | `thinking.type:'enabled'` maps to the Messages API `thinking` (budget clamped below `max_tokens`); `maxThinkingTokens` alone is only a budget fallback and sends no thinking param on its own; fields are `budget_tokens`/`budget`, not the official `budgetTokens` |
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
| `agent`, `settings`, `permissionPromptToolName`, `extraArgs`, `effort`, `outputFormat`, `sandbox`, `plugins`, `skills`, `toolAliases`, `toolConfig`, `sessionStore*`, `managedSettings`, `enableFileCheckpointing`, `taskBudget`, `onElicitation`, `planModeInstructions`, `promptSuggestions`, `agentProgressSummaries`, `forwardSubagentText`, `includeHookEvents`, `loadTimeoutMs`, `allowDangerouslySkipPermissions`, `title`, `resumeSessionAt` | ACCEPTED | each present key emits exactly one debug warning, then ignored in v0.1 |

## Built-in tools

| Tool | Tier | Notes |
|---|---|---|
| Read | PARTIAL | text files (cat -n) + images (PNG/JPEG/GIF/WebP → image block) + PDF (→ base64 `document` block; the API's handle-tool-calls docs allow `document` inside tool_result, though the base64 source there is supported-but-not-explicitly-demonstrated); all magic-byte sniffed (task #17); notebooks not rendered; oversized files (>50MB) rejected with a Grep hint rather than buffered |
| Write / Edit | FULL | same input field names (`file_path`, `old_string`, …) |
| Bash | PARTIAL | no persistent shell state across calls; no sandboxing; runs in its own process group (timeout/abort reap the whole group; background/daemon children do not hang the tool) |
| Glob | FULL | fast-glob, mtime-sorted |
| Grep | PARTIAL | pure-JS regex engine (no ripgrep binary); large-repo perf caveat |
| WebFetch / WebSearch / Task / TodoWrite / NotebookEdit / MultiEdit / KillShell / BashOutput | UNSUPPORTED | not registered in v0.1 |

## SDKMessage stream

| Variant | Tier | Notes |
|---|---|---|
| `system/init` | PARTIAL | apiKeySource, tools, mcp_servers, model, permissionMode present; official `claude_code_version`/`betas`/`skills`/`plugins` absent; `slash_commands` always `[]` |
| `assistant` | FULL | full `APIAssistantMessage` |
| `user` (echo + tool results) | FULL | prompt echo and tool_result user turns both yielded and persisted in order |
| `stream_event` | FULL | behind `includePartialMessages` |
| `result` success / error_max_turns / error_during_execution / `error_max_budget_usd` / `error_max_structured_output_retries` | PARTIAL | success arm carries ttft_ms + structured_output + deferred_tool_use + v0.3 `metrics`; error arm carries `errorMessage: string` rather than official `errors: string[]` |
| `system/compact_boundary` | FULL | emitted on manual `/compact` + auto-compaction (v0.2) |
| `system/mirror_error` | FULL | emitted on a session-store mirror failure |

### Observability arm (v0.3 — task #16)

The official SDKMessage union carries a large observability/status arm. We add
the full set of variant TYPES so drop-in consumers can switch exhaustively, and
EMIT the subset this headless engine has a real source event for.

Design note: the official docs/types are internally inconsistent about
top-level `type` vs `type:'system'+subtype` for these variants (and its own
issue #181 has `SDKRateLimitEvent`/`SDKPromptSuggestionMessage`
referenced-but-unexported). We model the arm with **top-level `type`**
discriminators — the most likely consumer pattern (`msg.type === 'permission_denied'`)
— except `status`, kept as `system/status`. Field shapes the official leaves
undocumented are a self-consistent clean-room reconstruction. All carry the
house `uuid`/`session_id` envelope. Union: `SDKObservabilityMessage`.

| Variant | Tier | Notes |
|---|---|---|
| `permission_denied` | FULL (emitted) | yielded on every permission-gate deny, before the tool_result; mirrors the `result.permission_denials` ledger; `blocker:'canUseTool'` set on a canUseTool interrupt, else omitted |
| `tool_progress`, `tool_use_summary` | TYPED | no mid-tool progress channel (tools are one-shot) |
| `task_started` / `task_progress` / `task_updated` / `task_notification` | TYPED | subagents run detached; lifecycle not surfaced as stream events yet |
| `hook_started` / `hook_progress` / `hook_response` | TYPED | would gate behind `includeHookEvents`; hooks currently report via debug only |
| `rate_limit_event`, `api_retry` | FULL (emitted) | the transport's per-request `onRetry` observer bridges each 429/5xx/network retry into the stream: a `rate_limit_event` on 429 (with `retry_after_ms`), an `api_retry` otherwise (with `status`/`reason`), yielded just before the retried attempt's stream |
| `files_persisted`, `local_command_output`, `commands_changed`, `auth_status`, `elicitation_complete`, `informational`, `notification`, `prompt_suggestion`, `memory_recall`, `worker_shutting_down`, `plugin_install`, `session_state_changed`, `system/status` | TYPED | no source event in a headless engine with no plugins/skills/CC-host/slash-command framework |

## Hooks

| Event | Tier | Notes |
|---|---|---|
| PreToolUse | FULL | allow/deny/ask + updatedInput (ask rewrite survives to canUseTool); deny > ask > allow; input lacks `tool_use_id` field (carried in the 2nd callback arg) |
| PostToolUse | FULL | additionalContext + updatedToolOutput + `continue:false`; input lacks `tool_use_id`/`duration_ms` fields |
| PostToolUseFailure | FULL | |
| PostToolBatch | PARTIAL | fires per batch; input is `{ tool_names }` not the official `{ tool_calls[] }`; `continue:false` honored |
| UserPromptSubmit | PARTIAL | additionalContext appended; a block skips the prompt in streaming mode / ends the run in string mode |
| MessageDisplay | PARTIAL | fires once per completed message (`message_text`), not per delta |
| Stop | FULL | fired at natural end of a run |
| SessionStart / SessionEnd | FULL | |
| Notification | ACCEPTED | never fired in v0.1 (no code path emits it) |
| SubagentStart / SubagentStop | ACCEPTED | never fire (no subagents yet) |
| PreCompact | ACCEPTED | never fires (no compaction yet) |
| PermissionRequest | ACCEPTED | never fires in v0.1 |
| `defer` permission decision | UNSUPPORTED | an unrecognized `permissionDecision` fails closed as deny with a debug warning |
| legacy `decision: 'approve'`/`'block'` | FULL | mapped to allow/deny in aggregation (allow only when no explicit `permissionDecision` on the same output) |
| Matcher semantics | FULL | exact-set vs regex rules per docs |
| `async: true` outputs | FULL | fire-and-forget |
| Settings-file shell hooks | UNSUPPORTED | callback hooks only |

## Query methods

| Method | Tier | Notes |
|---|---|---|
| `interrupt()` | FULL | |
| `setPermissionMode()` / `setModel()` / `setMaxThinkingTokens()` | FULL | |
| `initializationResult()` / `supportedModels()` / `supportedCommands()` / `supportedAgents()` | PARTIAL | static/empty data (no CLI to introspect) |
| `mcpServerStatus()` | FULL | now carries `config` (echoed back) + per-server `tools[]` when connected; `scope` typed but not tracked (task #17) |
| `accountInfo()` | PARTIAL | apiKeySource only |
| `streamInput()` | FULL | streaming-input mode |
| `close()` | FULL | |
| `rewindFiles()` / `reinitialize()` / `applyFlagSettings()` / `setMcpServers()` / `reconnectMcpServer()` / `toggleMcpServer()` / `stopTask()` | UNSUPPORTED in types v0.1 | `reconnect/toggle` exist on the registry; surfacing on Query in v0.2 |
