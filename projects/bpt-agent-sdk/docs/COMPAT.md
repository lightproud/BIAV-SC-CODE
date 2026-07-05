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
  `compact_boundary` emission (tokenizer-free, CJK-aware estimator). BPT
  extension `compaction.model` routes the summarization call to a cheap model
  (e.g. `'haiku'`, alias-resolved) to cut compaction cost; the summary usage is
  billed to that model.
  extension **`compaction.preTier`** (default true) runs a cheap deterministic
  pre-tier over the folded prefix BEFORE the summarization step: it
  de-duplicates repeated identical `tool_result` blocks and pointer-izes
  oversized `tool_result` content to `compaction.preTierMaxToolResultChars`
  (default 4000; head+tail kept, middle replaced with a `[…N chars elided…]`
  marker), so fewer tokens reach the summarizer. It only sheds `tool_result`
  bulk — user/assistant text is never touched, and message ordering /
  tool_use↔tool_result pairing are preserved. Set `preTier:false` to opt out, or
  `preTierMaxToolResultChars:0` to keep dedupe but disable truncation.
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
  **Stable-prefix caching (v0.5+):** the system prompt is split into a stable
  prefix (tool list + static guidance, byte-identical across runs) and a
  volatile cwd tail; the cache breakpoint lands on the stable block so the cwd
  rides after it and never invalidates the cached prefix. This lets independent
  queries in an org reuse `tools + stable system` across the cache TTL —
  measured to lift multi-turn cache hit toward the official engine's, where
  before the per-run cwd broke every cross-query match.
- **New builtin tools** — WebFetch (streamed + SSRF guard), WebSearch (host
  callback), AskUserQuestion (host callback), TodoWrite; MCP elicitation.
- **Sessions** — external `SessionStore` mirror; file checkpointing +
  `rewindFiles`; tool search (deferred MCP schemas); standalone session
  functions; Query methods (reconnect/toggle/setMcpServers/rewindFiles/stopTask).

The full observability/status message arm was TYPED in v0.3 (task #16) so the
SDKMessage union is exhaustive for drop-in consumers. EMITTED as of v0.4:
`permission_denied`, `rate_limit_event` / `api_retry` (v0.3), the subagent
task lifecycle (`task_started` / `task_progress` / `task_updated` /
`task_notification`) and the hook lifecycle (`hook_started` / `hook_response`,
behind `includeHookEvents`); the rest are typed-not-emitted (see the
Observability arm table below).

Still deliberately out of scope (N/A-by-design): the CLI-coupled subsystems
(CLI system prompt, settings engine, Bedrock/Vertex/Foundry, OTel), and the
WarmQuery/startup pre-warm lifecycle. See the audit for the rationale.
(The bubblewrap bash sandbox is now IMPLEMENTED — see the `sandbox` option row
and the Bash tool row below.)

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
| `getSessionMessages()` / `renameSession()` / `tagSession()` / `deleteSession()` / `forkSession()` | PARTIAL | implemented in v0.2 over this SDK's own JSONL store (or an external `sessionStore`); no Claude Code store interop |
| `resolveSettings()` | UNSUPPORTED | settings engine is CLI-coupled (N/A-by-design) |

## Engine difference (the point of this SDK)

The reference SDK spawns the proprietary Claude Code CLI as its engine. This
SDK implements the agent loop directly against the public Messages API:
`fetch` + SSE, tool_use dispatch, multi-turn history. Consequences:
- No `pathToClaudeCodeExecutable`, `executable`, `executableArgs`,
  `spawnClaudeCodeProcess` (ACCEPTED, ignored — there is no subprocess).
- Credentials come from `options.provider` (BPT extension) or
  `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`.
- `total_cost_usd` is an **estimate** from a static price table.
- **`settingSources` loads CLAUDE.md / AGENTS.md** (v0.5): 'project'/'local'
  walk up from cwd, 'user' reads ~/.claude/CLAUDE.md; the text is injected as a
  cached system-reminder on the `claude_code` preset path. Empty/undefined loads
  nothing (SDK default — opt in). Skills/plugins loading still not implemented.
- **`<env>` runtime-context block** (v0.5): the `claude_code` preset injects an
  official-style `<env>` block (working directory, git repo/branch, platform, OS
  version, date) + the model line into the volatile tail, reproducing the
  official runtime assembly. Toggle with `includeEnvironmentContext` (default true).
- **Parallel read-only tool execution** (bucket-1): within one assistant turn,
  a maximal run of ≥2 consecutive **read-only** tools executes concurrently
  (`Promise.all`); non-read-only and lone tools stay sequential. Results stay in
  tool_use order; a stop/defer from any tool overrides the rest of its
  concurrent group with a "Not executed" marker, so the observable contract
  matches sequential execution. "Read-only" covers builtins (Read/Glob/Grep via
  their `readOnly` flag) **and MCP tools whose server annotation sets
  `readOnlyHint`** — captured through `listTools` onto `McpToolEntry.annotations`
  (sdk/stdio/http). Read-only tools in `default`/`plan`/`acceptEdits` mode
  auto-approve via the gate (no canUseTool prompt), so an MCP `readOnlyHint` tool
  now both auto-approves and joins parallel groups.

## Options fields

| Field | Tier | Notes |
|---|---|---|
| `abortController` | FULL | |
| `additionalDirectories` | FULL | fs tools + additionalDirectories containment |
| `agents` | PARTIAL | executed since v0.2 (subagent runtime); the delegation tool is named `Agent` here vs official `Task`, and official 2.1.201 delegation made 4 POSTs vs our deterministic parent+child+parent 3 (conformance run-l2 s13-agents-task, KD-11, 2026-07-05) |
| `allowedTools` / `disallowedTools` | FULL | `Tool(spec)` prefix rules + `mcp__srv__*` (exact server match) + `*` / `mcp__*` globs (v0.4); bare-name `disallowedTools` removes the tool definition from the request; plan mode never auto-approves writes via an allow rule; rewritten inputs re-checked against deny rules |
| `canUseTool` | FULL | invoked on prompt-fallthrough with `signal`/`suggestions`/`requestId`/`toolUseID`; `updatedInput`/`updatedPermissions` honored (incl. hook-`ask` rewrite); `null` return = skip (app resolves out of band) |
| `continue` | PARTIAL | resumes latest session from this SDK's store |
| `cwd` | FULL | |
| `env` | FULL | used for transport + Bash tool |
| `fallbackModel` | PARTIAL | one retry per turn on 429/5xx |
| `forkSession` | FULL | |
| `hooks` | PARTIAL | see hook table |
| `includePartialMessages` | FULL | raw stream events as `stream_event` |
| `maxBudgetUsd` | PARTIAL | based on estimated cost (a static price table, not billing truth); stop ORDERING matches official 2.1.201 (E5, 2026-07-05): a turn requesting tools past the cap stops BEFORE any tool executes (zero side effects, no tool_result user turn, terminal `error_max_budget_usd`), while a naturally ending turn still yields its completed success result (conformance run-l2 s12 converged) |
| `maxThinkingTokens` / `thinking` | PARTIAL | `thinking.type:'enabled'` maps to the Messages API `thinking` (budget clamped below `max_tokens`); on the `claude_code` preset path thinking is DEFAULT-ON like the official CLI (all 54/54 official L5 traces carry thinking events; opt out with `maxThinkingTokens: 0` or `thinking: {type:'disabled'}`) — KD: the 4096 default budget is OUR chosen value, the official budget is request-body-internal and unobservable under the net-observation boundary; off the preset path `maxThinkingTokens` alone is only a budget fallback and sends no thinking param on its own; fields are `budget_tokens`/`budget`, not the official `budgetTokens` |
| `maxTurns` | FULL | |
| `mcpServers` | PARTIAL | stdio/http/sdk FULL; `sse` legacy transport UNSUPPORTED |
| `model` | FULL | default `ANTHROPIC_MODEL` env or `claude-sonnet-4-5` |
| `permissionMode` | PARTIAL | `default`/`acceptEdits`/`bypassPermissions`/`plan`/`dontAsk`; `auto` (classifier) not offered. `bypassPermissions` requires the `allowDangerouslySkipPermissions` interlock (below) |
| `allowDangerouslySkipPermissions` | FULL | safety interlock: `bypassPermissions` (initial or via `setPermissionMode`) throws `ConfigurationError` unless this is `true`. BPT-only strictness: official 0.3.199/2.1.201 does NOT enforce the interlock live - it proceeds to the model without the flag (conformance run-l2 s6-bypass-interlock-refusal, 2026-07-05) |
| `persistSession` / `sessionId` / `resume` | FULL | JSONL store |
| `provider` | FULL | **BPT extension** — direct-API connection settings |
| `settingSources` | PARTIAL | loads CLAUDE.md / AGENTS.md ('project'/'local'/'user'); skills/plugins not loaded |
| `includeEnvironmentContext` | FULL | **BPT extension** — inject official-style `<env>` block (default true on the preset) |
| `stderr` | PARTIAL | receives debug log lines (no subprocess stderr exists) |
| `strictMcpConfig` | ACCEPTED | typed but consulted nowhere in src; the old "only options servers are ever used" rationale is stale since v0.5 `settingSources` can load `.mcp.json` servers, and no strict/lax fork exists to lock (conformance-l2-locks reconciliation, 2026-07-05) |
| `systemPrompt` | PARTIAL | preset `claude_code` maps to this SDK's own harness prompt (+`append`); **BPT extension** `{ type: 'segments', segments: [{text, cache?}] }` forwards caller-composed blocks verbatim with per-segment cache breakpoints (the generic seam for host prompt layering — up to 3 cached system segments; message-caching off in this path). The host owns which layers/order/trust; the engine only places the wire breakpoints |
| `tools` | PARTIAL | string[] filters built-ins; preset = all built-ins |
| `betas` | FULL | forwarded as `anthropic-beta` header |
| `includeHookEvents` | FULL | v0.4: emits `hook_started` / `hook_response` pairs (per callback invocation, correlated by `hook_id`) into the stream |
| `debug` / `debugFile` | PARTIAL | `debug` → stderr callback; `debugFile` ACCEPTED |
| `agent`, `settings`, `permissionPromptToolName`, `extraArgs`, `effort`, `outputFormat`, `plugins`, `skills`, `toolAliases`, `toolConfig`, `sessionStore*`, `managedSettings`, `enableFileCheckpointing`, `taskBudget`, `onElicitation`, `planModeInstructions`, `promptSuggestions`, `agentProgressSummaries`, `forwardSubagentText`, `loadTimeoutMs`, `title`, `resumeSessionAt` | ACCEPTED | each present key emits exactly one debug warning, then ignored |
| `sandbox` (`boolean \| SandboxOptions`) | PARTIAL | v0.6 bash sandbox (G-SANDBOX). Default ON when a backend resolves — bubblewrap on Linux (`--ro-bind / /` + rw-bind cwd/additionalDirectories/state/tmp, `--unshare-net` unless `allowNetwork`, `$TMPDIR` redirect). Per-call Bash `dangerouslyDisableSandbox` routes through the permission gate as an ask (never auto-allowed except under `bypassPermissions` or a matching allow rule); `allowEscape:false` = mandatory mode (param disabled). Sandboxed failures matching a restriction signature carry `[sandbox]` evidence + the retry path. **Not implemented:** macOS Seatbelt, the domain-whitelist network proxy (network is binary on/off). **Windows: no backend resolves → Bash runs unsandboxed with NO sandbox guidance emitted — identical honesty posture to official Claude Code on Windows.** The object sub-shape (`enabled`/`allowNetwork`/`writablePaths`/`allowEscape`/`backend`) is BPT-shaped. |

## Built-in tools

| Tool | Tier | Notes |
|---|---|---|
| Read | PARTIAL | text files (cat -n) + images (PNG/JPEG/GIF/WebP → image block) + PDF (→ base64 `document` block; the API's handle-tool-calls docs allow `document` inside tool_result, though the base64 source there is supported-but-not-explicitly-demonstrated); all magic-byte sniffed (task #17); notebooks not rendered; oversized files (>50MB) rejected with a Grep hint rather than buffered |
| Write / Edit | PARTIAL | same input field names (`file_path`, `old_string`, …); Write enforces the official read-before-write gate (E4, 2026-07-05: a bare Write over an existing un-read file errors with the verbatim official text and leaves the file untouched; new files pass; a successful Read unlocks - pinned live, L5 code-03 r1 vs r2; KD-L3-06 retired). OUR chosen extensions where the pinned evidence is silent: a successful Write/Edit also registers its path (create-then-revise does not self-block), and the gate spans subagents (one read-set per query). Edit itself has no read-first gate (official Edit does); success/error wording differs elsewhere (KD-L3-05/07/08) |
| Bash | PARTIAL | v0.5: `cd` + exported env persist across calls (state-file replay — functions/aliases/unexported vars do NOT persist; not a long-lived shell process) and `run_in_background` launches a detached shell whose id feeds BashOutput/KillShell. v0.6: sandboxed by default when a backend resolves (see the `sandbox` option row); foreground and background both wrap through the backend and run in their own process group (timeout/abort reap the whole group; `--unshare-pid` + SIGKILL escalation reaps across the sandbox pid namespace). When the sandbox description is active the tool description carries the faithful sandbox guidance and the schema gains `dangerouslyDisableSandbox` (mandatory mode omits it) |
| BashOutput | FULL | v0.5: incremental reads (new output since last call) + status/exit code; optional per-line regex `filter`; read-only (auto-approved, parallel-group eligible). FULL is vs the DOCUMENTED SDK lifecycle: live official 2.1.201 moved backgrounding to a task-file model and its own BashOutput answers "No task found" for the id its Bash advertised, so no official-arm parity evidence exists (conformance run-l3 L3-BG-01, KD-L3-19, 2026-07-05) |
| KillShell | FULL | v0.5: SIGTERM then SIGKILL escalation on the background shell's process group. Same official-arm caveat as BashOutput (run-l3 L3-BG-01, KD-L3-19) |
| Glob | PARTIAL | fast-glob, mtime-sorted newest-first; official 2.1.201 emitted ASCENDING order under ascending-utimes pins, so ordering parity with the live engine is not established - path sets agree (conformance run-l3 L3-GLOB-01, KD-L3-20, 2026-07-05) |
| Grep | PARTIAL | pure-JS regex engine (no ripgrep binary); large-repo perf caveat |
| WebFetch / WebSearch / Task / TodoWrite | see notes | WebFetch/WebSearch/TodoWrite registered in v0.2; Task is the Agent tool |
| NotebookEdit / MultiEdit | UNSUPPORTED | deliberately untracked (BPT has no notebook surface; MultiEdit retired upstream) |

## SDKMessage stream

| Variant | Tier | Notes |
|---|---|---|
| `system/init` | PARTIAL | apiKeySource, tools, mcp_servers, model, permissionMode present; official `claude_code_version`/`betas`/`skills`/`plugins` absent; `slash_commands` always `[]` |
| `assistant` | FULL | full `APIAssistantMessage` |
| `user` (echo + tool results) | FULL | prompt echo and tool_result user turns both yielded and persisted in order |
| `stream_event` | FULL | behind `includePartialMessages` |
| `result` success / error_max_turns / error_during_execution / `error_max_budget_usd` / `error_max_structured_output_retries` | PARTIAL | success arm carries ttft_ms + structured_output + deferred_tool_use + v0.3 `metrics`; error arm carries both `errorMessage: string` and the official-parallel `errors: string[]` (v0.4). Mid-stream SSE truncation degrades gracefully like official 2.1.201 (E3, 2026-07-05): the blocks the wire delivered whole are salvaged - partial text becomes the `success` answer, complete tool_use blocks EXECUTE (at either cut depth, with or without stop_reason) and the loop re-requests to deliver the tool_result; the connection error rides `errors` as a non-fatal note on the terminal result (former KD-L4-04 + all three truncation engine findings retired; residual KD-L4-02: official also appends the error as assistant text and throws from the iterator post-result - deliberately not replicated). An UNCLOSED tool_use (mid-transmission input) never executes; nothing salvageable falls back to `error_during_execution`. Remaining fault-path divergence: on a terminal non-retryable 400 ours ends with a clean `result/error_during_execution` where official surfaces the error as assistant text plus `result/success` then throws (KD-L4-01; run-l4 l4-http400-non-retryable, l4-script-exhausted-400-terminal). Reporting semantics on streamed multi-turn input match official (E2, 2026-07-05, KD-L5-04 retired): `num_turns`/`usage` are PER-RESULT (that turn's own figures), `total_cost_usd`/`duration_api_ms` are session-cumulative; `modelUsage` stays session-cumulative (official per-result semantics unobserved - our choice); internal `maxTurns`/`maxBudgetUsd` enforcement remains session-wide. Query-layer synthetic results (hook-block / pre-turn cap stop / interrupt) report `num_turns: 0` + zero `usage` (no engine turn ran for them; official shape unobserved) |
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
undocumented are a self-consistent independent reconstruction. All carry the
house `uuid`/`session_id` envelope. Union: `SDKObservabilityMessage`.

| Variant | Tier | Notes |
|---|---|---|
| `permission_denied` | FULL (emitted) | yielded on every permission-gate deny, before the tool_result; mirrors the `result.permission_denials` ledger; `blocker:'canUseTool'` set on a canUseTool interrupt, else omitted |
| `tool_progress`, `tool_use_summary` | TYPED | no mid-tool progress channel (tools are one-shot) |
| `task_started` / `task_progress` / `task_updated` / `task_notification` | FULL (emitted, v0.4) | Agent-tool subagent lifecycle: `task_started` at spawn (task_id = agentId, task_name = the Agent call's `description`), `task_progress` per child assistant turn (turn-budget share, `status: 'turn N/M'`), `task_updated` on completed/failed/cancelled (bounded result preview), `task_notification` for BACKGROUND children (completed/failed/stopped). Buffered by the runtime and drained into the stream at message boundaries (foreground events surface after their Agent tool group finishes — a pull-based generator cannot interleave mid-await) |
| `hook_started` / `hook_response` | FULL (emitted, v0.4) | behind `options.includeHookEvents`: one pair per callback invocation, correlated by `hook_id`; `result` = bounded output JSON, `error` = failure/timeout text. Same message-boundary drain as task events |
| `hook_progress` | TYPED | callbacks are opaque promises; no honest mid-callback progress source |
| `rate_limit_event`, `api_retry` | FULL (emitted) | the transport's per-request `onRetry` observer bridges each 429/5xx/network retry into the stream: a `rate_limit_event` on 429 (with `retry_after_ms`), an `api_retry` otherwise (with `status`/`reason`), yielded just before the retried attempt's stream. Shape split vs official: 2.1.201 encodes the per-429-retry notification as `system/api_retry` too - it emits no `rate_limit_event` on 429 (triaged KD-12; conformance run-l4 l4-429-retry-after-recover / l4-429-storm-two-vs-budget, 2026-07-05) |
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
