# BPT Agent SDK — Architecture & Module Contracts

Clean-room agent harness with a `@anthropic-ai/claude-agent-sdk`-compatible
public surface. The engine drives the **Anthropic Messages API directly**
(fetch + SSE); there is no bundled CLI executable and no subprocess engine.

Inputs used for the design: the public SDK documentation
(code.claude.com/docs/en/agent-sdk/{typescript,hooks,mcp,permissions}) and the
public Messages API documentation. No proprietary code was consulted.

## Ground rules (every module)

1. **Language**: TypeScript strict, ESM (`module: NodeNext`). Relative imports
   MUST use the `.js` suffix (`import { x } from '../types.js'`).
2. **Imports**: a module may import ONLY from `src/types.ts`, `src/errors.ts`,
   `src/internal/contracts.ts`, Node builtins (`node:` prefix), `zod`,
   `fast-glob`, and files it owns. Never import another module's files.
3. **No default exports.** Named exports only.
4. **No new dependencies.** Runtime deps are exactly `zod` (v4) and `fast-glob`.
5. **UUIDs**: `randomUUID` from `node:crypto`.
6. **Abort**: honor `AbortSignal` everywhere; surface as `AbortError`
   (`src/errors.ts`). Never swallow aborts.
7. **No `console.*`** in library code — use the injected `debug` callback.
8. Keep files self-contained and unit-testable; avoid module-level mutable
   state.

## Module map

| Module | Owner files (under `src/`) | Contract |
|--------|---------------------------|----------|
| A transport | `transport/sse.ts`, `transport/anthropic.ts` | `Transport` |
| B engine | `engine/pricing.ts`, `engine/prompts.ts`, `engine/accumulator.ts`, `engine/loop.ts` | `EngineConfig`/`EngineDeps` |
| C fs tools | `tools/fsutil.ts`, `tools/read.ts`, `tools/write.ts`, `tools/edit.ts` | `BuiltinTool` |
| D exec/search tools | `tools/bash.ts`, `tools/glob.ts`, `tools/grep.ts` | `BuiltinTool` |
| E permissions + hooks | `permissions/rules.ts`, `permissions/gate.ts`, `hooks/matcher.ts`, `hooks/runner.ts` | `PermissionGate`, `HookRunner` |
| F mcp | `mcp/stdio.ts`, `mcp/http.ts`, `mcp/sdk-server.ts`, `mcp/registry.ts` | `McpRegistry`, `tool()`, `createSdkMcpServer()` |
| G sessions + query | `sessions/store.ts`, `tools/index.ts`, `query.ts`, `index.ts` + `examples/*`, `README.md` | `SessionStore`, `Query`, package exports |

## A — Transport

`transport/sse.ts`
- `export async function* parseSSE(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<{ event?: string; data: string }>`
- Robust SSE framing: events split on blank line, `\r\n` tolerated, multi-line
  `data:` concatenated with `\n`, `:` comment lines ignored, trailing partial
  frames flushed on stream end only if complete.

`transport/anthropic.ts`
- `export class AnthropicTransport implements Transport`
- `constructor(cfg: { provider?: ProviderConfig; env: Record<string, string | undefined>; debug: (m: string) => void })`
- Credential resolution order: `provider.apiKey` → `env.ANTHROPIC_API_KEY`
  (header `x-api-key`), else `provider.authToken` → `env.ANTHROPIC_AUTH_TOKEN`
  (header `Authorization: Bearer …`). Neither → throw `ConfigurationError`
  at first `stream()` call. `apiKeySource()`: `'user'` when from provider
  config, `'project'` when from env, `'none'` otherwise.
- Base URL: `provider.baseUrl` → `env.ANTHROPIC_BASE_URL` →
  `https://api.anthropic.com`. Endpoint `POST {base}/v1/messages`.
- Headers: `anthropic-version: provider.apiVersion ?? '2023-06-01'`,
  `content-type: application/json`, `user-agent: bpt-agent-sdk/0.1.0`, plus
  `provider.defaultHeaders`.
- Body: from `StreamRequest` + `stream: true`. Omit undefined fields.
- Streaming: parse SSE frames, `JSON.parse` each `data`, yield as
  `RawMessageStreamEvent`. An SSE `error` event or an `{type:'error'}` payload
  → throw `APIStatusError` with the payload's error type/message.
- Retries: on 429/408/5xx/529 (`overloaded_error`) and network errors, retry
  with exponential backoff + jitter (base 1s, factor 2, respect `retry-after`
  seconds header), max `provider.maxRetries ?? 4`. NEVER retry once the first
  SSE event has been consumed (mid-stream failures propagate as
  `APIConnectionError`). 4xx other than 408/429 → `APIStatusError` immediately.
- Per-request timeout `provider.timeoutMs ?? 600000` via `AbortSignal.timeout`
  combined with the caller signal (`AbortSignal.any`).

## B — Engine

`engine/pricing.ts`
- `export function estimateCostUsd(model: string, usage: NonNullableUsage): number`
- Static table (USD per MTok): opus-4 family in=15 out=75 cacheWrite=18.75
  cacheRead=1.5; sonnet family in=3 out=15 cacheWrite=3.75 cacheRead=0.3;
  haiku family in=1 out=5 cacheWrite=1.25 cacheRead=0.1. Longest-prefix match
  on model id (`claude-opus-`, `claude-sonnet-`, `claude-haiku-`); unknown
  model → 0 (estimates, documented as such).
- `export function normalizeUsage(u: Usage): NonNullableUsage`,
  `export function addUsage(a: NonNullableUsage, b: NonNullableUsage): NonNullableUsage`.

`engine/prompts.ts`
- `export function buildSystemPrompt(opt: Options['systemPrompt'], ctx: { cwd: string; toolNames: string[] }): string`
- Own text (clean-room, do NOT reproduce any known system prompt): concise
  agent-harness prompt — role, cwd, tool-usage guidance, safety line about
  destructive commands. `undefined` → minimal default. String → verbatim.
  Preset `claude_code` → the default harness prompt; `append` concatenated
  after two newlines.

`engine/accumulator.ts`
- `export class MessageAccumulator` — feed `RawMessageStreamEvent`s, produce
  the final `APIAssistantMessage`.
- `message_start` seeds id/model/usage. `content_block_start` opens a block by
  index; `text_delta`/`thinking_delta`/`signature_delta` append;
  `input_json_delta` accumulates the partial JSON string, parsed at
  `content_block_stop` (empty string → `{}`; parse failure → throw
  `APIConnectionError` with context). `message_delta` sets
  stop_reason/stop_sequence and merges usage (output_tokens replace,
  input side fields keep max).

`engine/loop.ts`
- `export async function* runAgentLoop(history: APIMessageParam[], deps: EngineDeps, config: EngineConfig): AsyncGenerator<SDKMessage, void>`
- `history` already contains the new user turn(s). Loop:
  1. Build request: system, messages=history, tools = builtin defs
     (`inputSchema` → `input_schema`) + MCP defs from `deps.mcp.allTools()`.
     `thinking`: from config (adaptive → omit; enabled → budget_tokens =
     `budget_tokens ?? budget ?? maxThinkingTokens ?? 10000`; disabled → omit).
  2. Stream; if `includePartialMessages`, yield each raw event as
     `SDKPartialAssistantMessage` (type `stream_event`). Accumulate.
  3. Yield `SDKAssistantMessage` (uuid = randomUUID, parent_tool_use_id null).
     Fire `MessageDisplay` hooks with the concatenated text (non-blocking
     semantics: aggregate but only use systemMessages/debug).
  4. Track usage + cost per model (`modelUsage` keyed by response model id).
     The `maxBudgetUsd` gate fires only when about to make another billable
     call (in the `tool_use` continue path, step 5) → yield result
     `error_max_budget_usd`; a naturally-ended answer that merely tips the
     budget still yields `success` (it is already paid for).
  5. `stop_reason === 'tool_use'` with ≥1 tool_use block → execute the blocks
     sequentially in content order (see below), append assistant message + one
     user message with all tool_result blocks to history, fire `PostToolBatch`
     hooks, increment turn counter; if `maxTurns` reached → result
     `error_max_turns`; else next iteration. A `tool_use` stop with zero
     tool_use blocks falls through to the natural-end success path (never push
     an empty-content user turn). A permission deny carrying `interrupt` or a
     `PostToolUse`/`PreToolUse` hook `continue:false` finishes the remaining
     blocks' results then terminates with `error_during_execution`.
  6. Any other stop_reason → fire `Stop` hooks, yield result `success`
     (`result` = concatenated text blocks of the final assistant message),
     return.
- Tool execution (per tool_use block):
  1. `PreToolUse` hooks via `deps.hooks.run('PreToolUse', …, toolName)`.
     `continue === false` → tool_result error "hook stopped execution",
     remaining blocks in the batch get error results too, then emit result
     `success` with is_error… NO — simpler and deterministic: treat as deny
     for this call and continue the loop normally.
  2. `deps.permissions.check(toolName, input, { hook: aggregated, … })`.
     Deny → tool_result `{ is_error: true, content: message }`.
  3. Allow → execute: builtin from `deps.builtinTools` with
     `deps.toolContext`; else `deps.mcp.call(qualifiedName, …)` mapping
     `CallToolResult.content` text/image parts into tool_result content and
     `isError` through; unknown tool → error result "No such tool".
     Builtin throws → `PostToolUseFailure` hooks + error tool_result.
  4. Success → `PostToolUse` hooks; `updatedToolOutput` (stringified if not
     string) replaces content; `additionalContext` entries appended as extra
     text lines after the tool_result content.
- Errors from transport mid-run: if `config.fallbackModel` is set and the
  error is `APIStatusError` with status 429/5xx/529 on the FIRST attempt of a
  turn, retry the turn once with the fallback model; otherwise yield result
  `error_during_execution` (errorMessage = err.message) and return. Abort →
  rethrow `AbortError` (query layer handles).
- Result message common fields: duration_ms (loop start→now),
  duration_api_ms (sum of stream call durations), num_turns (assistant
  turns), usage (running total), modelUsage, total_cost_usd,
  permission_denials = `deps.permissions.denials()`.

## C — FS tools (`BuiltinTool` implementations)

`tools/fsutil.ts`
- `resolveWithin(cwd: string, additional: string[], p: string): { ok: true; abs: string } | { ok: false; reason: string }`
  — resolve `p` (absolute or cwd-relative) with `path.resolve`, `ok` iff the
  result is inside cwd or any additional directory (prefix check on
  `path.sep` boundaries after `path.resolve`; no symlink escape handling in
  v0.1 — documented).
- `looksBinary(buf: Buffer): boolean` (NUL byte in first 8KB).
- `formatCatN(lines: string[], startLine: number): string` — `cat -n` style:
  right-aligned 6-char line number + tab; truncate each line at 2000 chars.

Input field names are part of the compat surface (hooks read them):
- `tools/read.ts` — name `Read`, readOnly. Input `{ file_path: string; offset?: number; limit?: number }`.
  Default limit 2000 lines. Missing file / directory / binary → isError with
  clear message. Empty file → system-reminder-style note text.
- `tools/write.ts` — name `Write`, isFileEdit. Input `{ file_path: string; content: string }`.
  `mkdir -p` parent, write UTF-8, report created vs overwritten (+ byte count).
- `tools/edit.ts` — name `Edit`, isFileEdit. Input `{ file_path: string; old_string: string; new_string: string; replace_all?: boolean }`.
  Errors: file missing; `old_string === new_string`; not found; ambiguous
  (found >1 and !replace_all — report count). Success reports replacement
  count and a short context snippet of the first edit site.

## D — Exec/search tools

- `tools/bash.ts` — name `Bash`, NOT readOnly. Input `{ command: string; timeout?: number; description?: string }`.
  `spawn('bash', ['-c', command], { cwd, env })` (fallback `sh` if bash
  missing). Timeout default 120000, max 600000 → SIGTERM then SIGKILL after
  2s grace. Abort signal kills likewise. Capture stdout+stderr, each capped
  at 30000 chars with `[truncated]` marker. Non-zero exit → isError, content
  includes exit code + streams. Never throw for command failure (only for
  spawn impossibility).
- `tools/glob.ts` — name `Glob`, readOnly. Input `{ pattern: string; path?: string }`.
  fast-glob (`dot: false`, ignore `**/node_modules/**`, `**/.git/**`),
  results sorted by mtime desc, capped at 100 paths + truncation note; no
  matches → "No files found".
- `tools/grep.ts` — name `Grep`, readOnly. Input `{ pattern, path?, glob?, type?, output_mode? ('files_with_matches' default | 'content' | 'count'), -i?, -n? (default true), -A?, -B?, -C?, multiline?, head_limit? (default 250) }`.
  Enumerate files via fast-glob (same ignores; `type` maps: js/ts/py/rust/go/
  java/c/cpp/md/json → extension globs), skip binaries and files >10MB,
  JS `RegExp` (flags: i when `-i`, m always, s when multiline), per-file
  scan line by line (multiline: whole-content scan). Output formats mirror
  ripgrep conventions (`path:line:text` for content mode with `-n`,
  `path-line-text` for context lines, `--` separators between hunks).

## E — Permissions + hooks

`permissions/rules.ts`
- `export type ParsedRule = { toolName: string; specifier?: string }`
- `parseRule(raw: string): ParsedRule` — `Tool`, `Tool(spec)`.
- `ruleMatches(rule: ParsedRule, toolName: string, input: Record<string, unknown>): boolean`
  — tool name: exact, or `mcp__server__*` / `mcp__server` wildcard forms for
  MCP tools. Specifier (when present): compared against the tool's primary
  string argument (`command` for Bash, `file_path` for fs tools, `pattern`
  for Glob/Grep, else JSON of input): exact match, or prefix match when the
  spec ends with `*` (`Bash(npm run:*)` style: strip trailing `*`, prefix
  compare; a lone `:*` boundary is treated as prefix too).
- `matchToolName(pattern: string, toolName: string): boolean` for
  allowedTools/disallowedTools entries (plain names, `mcp__srv__*`, `mcp__srv`).

`permissions/gate.ts`
- `export class DefaultPermissionGate implements PermissionGate` — evaluation
  order EXACTLY as documented in `contracts.ts`. Constructor takes
  `{ mode, allowedTools, disallowedTools, canUseTool, debug }`. Session rule
  sets mutated by `applyUpdates` (only `destination:'session'` honored;
  others → debug warn). `dontAsk` differs from `default` only at step 9:
  never calls `canUseTool`, denies directly. In plan mode an `allowedTools`
  match (step 4) does NOT auto-approve a non-readOnly tool — it falls through
  to the step-6 plan deny (plan never auto-approves writes/edits). A
  rewritten input (hook-allow `updatedInput` at step 3, or `canUseTool`
  `updatedInput` at step 9) is re-checked against `disallowedTools` before the
  allow returns, so a rewrite cannot smuggle a call past a deny rule. Deny
  messages must name the tool and the deciding stage. All denials recorded
  (tool_name, tool_use_id, tool_input).

`hooks/matcher.ts`
- `export function matcherMatches(matcher: string | undefined, value: string | undefined): boolean`
  — omitted/`''`/`'*'` → true. Exact-set charset `[A-Za-z0-9_\-, |]` →
  split on `|`/`,`, trim, exact compare. Otherwise unanchored `new RegExp`.
  Invalid regex → false + never throw. `value === undefined` → true.

`hooks/runner.ts`
- `export class DefaultHookRunner implements HookRunner` — constructor
  `{ hooks: Options['hooks'], debug }`. `run()` collects matching callbacks,
  executes ALL in parallel (`Promise.allSettled`), per-callback timeout
  (`matcher.timeout ?? 60` seconds) via `AbortSignal.any` +
  `AbortSignal.timeout`; rejected/timeout → debug warn, ignored. `void`/`{}`
  → neutral. `async: true` outputs → detach (do not await beyond return),
  neutral. Aggregate: decision deny > ask > allow (`decision:'block'` counts
  as deny with `reason`); `continue:false` wins; systemMessages/
  additionalContext collected in completion order; updatedInput from the
  last allow output; updatedToolOutput last-wins.

## F — MCP

`mcp/stdio.ts`
- `export class StdioMcpConnection` — spawn `command args` with merged env
  (config.env over inherited), cwd optional. Wire = newline-delimited
  JSON-RPC 2.0 over stdin/stdout (one JSON object per line; tolerate
  multiple/partial lines via buffer split). Handshake: `initialize`
  (protocolVersion `'2025-06-18'`, capabilities `{}`, clientInfo
  `{ name: 'bpt-agent-sdk', version: '0.1.0' }`) → store serverInfo →
  `notifications/initialized`. `listTools()` = `tools/list` with cursor
  pagination. `callTool()` = `tools/call { name, arguments }`, map result to
  `CallToolResult` (unknown content types → text via JSON.stringify).
  Request timeout 60s default. Server-initiated requests → respond
  `{ error: { code: -32601 } }`; notifications ignored. `close()`: kill
  child (SIGTERM→SIGKILL 2s).
- `mcp/http.ts` — `export class HttpMcpConnection` (streamable HTTP): POST
  JSON-RPC to url, headers + `Accept: application/json, text/event-stream`,
  `MCP-Protocol-Version` header after init; response either JSON body or SSE
  stream carrying the response message (reuse a minimal internal SSE line
  parser — do NOT import module A). Track `Mcp-Session-Id` response header
  and echo it. Same handshake/methods as stdio. SSE-transport config
  (`type:'sse'`) → constructor throws `NotImplementedError` (registry
  reports `failed` status with the message).
- `mcp/sdk-server.ts` —
  `export function tool<S extends z.ZodRawShape>(name, description, inputSchema: S, handler): SdkMcpToolDefinition` (zod v4:
  `z.toJSONSchema(z.object(inputSchema))`, strip `$schema`; handler wrapped:
  parse/validate args with the zod object, validation error → isError
  result). `export function createSdkMcpServer(opts): McpSdkServerConfigWithInstance`
  building `SdkMcpServerInstance` with a tools Map.
  `export class SdkMcpConnection` — in-process dispatch, no wire protocol;
  handler exceptions → `{ isError: true }` text result.
- `mcp/registry.ts` — `export class DefaultMcpRegistry implements McpRegistry`
  — builds a connection per config entry (default type stdio when `command`
  present), `connectAll` parallel with 60s per-server timeout, failures →
  status `failed` + error message (never throw). Qualified names
  `mcp__{server}__{tool}`. `setEnabled(false)` → status `disabled`, tools
  excluded. `call()` on unknown/disabled → isError result.

## G — Sessions + Query + exports

`sessions/store.ts`
- `export class JsonlSessionStore implements SessionStore` — dir:
  `options.sessionDir ?? env.BPT_AGENT_HOME+'/sessions' ?? ~/.bpt-agent/sessions`.
  One `{sessionId}.jsonl` per session; first line meta
  `{ type:'meta', sessionId, createdAt, cwd, firstPrompt }`; subsequent lines
  the SDK user/assistant messages. `load()` reconstructs `APIMessageParam[]`
  (assistant `message.content` as-is; user as-is). Corrupt lines skipped with
  debug warn. Async fs (`node:fs/promises`), `append` may buffer+flush
  best-effort synchronously via appendFileSync for simplicity.
- `export async function listSessions(...)`, `getSessionInfo(...)` helpers
  re-exported through `index.ts`.

`tools/index.ts`
- `export function createBuiltinTools(): Map<string, BuiltinTool>` — Read,
  Write, Edit, Bash, Glob, Grep (imports modules C+D files).

`query.ts`
- `export function query({ prompt, options }: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Query`
- Construction: resolve cwd/env/model (default model
  `env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'`), sessionId (resume >
  sessionId > randomUUID; `continue: true` → latest stored), history from
  store when resuming (forkSession → copy under new id), transport, tools
  (filtered by `options.tools` array form; preset/undefined → all), gate,
  hook runner, mcp registry, session store (unless `persistSession === false`).
- Run sequence (single internal async generator):
  1. `SessionStart` hooks (source: resume ? 'resume' : 'startup').
  2. `mcp.connectAll()`; init `SDKSystemMessage` (subtype 'init', tools =
     builtin + mcp qualified names, mcp_servers statuses, slash_commands [],
     output_style 'default', apiKeySource from transport).
  3. Prompt ingestion: string → one user turn; AsyncIterable → for each
     incoming `SDKUserMessage` run a turn (streaming input mode; extract
     text content). Per user turn: `UserPromptSubmit` hooks —
     `continue:false` or decision block → yield result error_during_execution
     with the stop reason and end; `additionalContext` appended to the
     prompt text as extra lines.
  4. Yield the echoed `SDKUserMessage` (uuid assigned), append to history +
     store, then delegate to `runAgentLoop`, forwarding every yielded
     message (persist assistant/user messages; stamp session_id).
  5. After the loop's result message: `SessionEnd` + `Stop`… (Stop fired by
     engine; SessionEnd on generator completion/close with reason).
- `Query` object: wrap the generator, add control methods —
  `interrupt()` aborts the current turn's internal controller (streaming
  mode: generator keeps accepting next input; string mode: ends run);
  `setPermissionMode`, `setModel`, `setMaxThinkingTokens` mutate live config;
  `supportedModels()` static list; `supportedCommands/Agents` → `[]`;
  `mcpServerStatus()` from registry; `accountInfo()` from transport source;
  `initializationResult()` resolves after init emitted; `streamInput(stream)`
  only in streaming mode; `close()` aborts everything + `mcp.closeAll()`.
  Abort of the outer controller → generator throws `AbortError` unless
  already finished. `maxBudgetUsd`/`maxTurns` enforced in engine.
- `index.ts` — export `query`, `tool`, `createSdkMcpServer`, session helpers,
  all public types (`export type *` from types.js), error classes.

`examples/` — `basic.ts` (string prompt, print messages), `custom-tools.ts`
(sdk MCP server with one tool), `streaming-input.ts`, `hooks-permissions.ts`.
Examples import from `'bpt-agent-sdk'` (package self-reference OK) or
relative `../src/index.js` — use relative for runnable-without-publish.

`README.md` — quickstart, drop-in migration notes
(`@anthropic-ai/claude-agent-sdk` → `bpt-agent-sdk`), env vars, compat
pointer to docs/COMPAT.md, ESM-only note.

## Testing contract (phase after integration)

Unit tests live in `tests/`, vitest, node env. Transport is mocked with
`class MockTransport implements Transport` fed by scripted
`RawMessageStreamEvent[][]` (one array per stream() call) — lives in
`tests/helpers/mock-transport.ts`. No network in tests. Bash/fs tools tested
against `fs.mkdtemp` sandboxes.
