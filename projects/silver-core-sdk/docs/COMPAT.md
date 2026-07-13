# Silver Core SDK — Compatibility Matrix

Target surface: `@anthropic-ai/claude-agent-sdk` public API (npm 0.3.207; chased from 0.3.205 2026-07-13, keeper ruling 「追」, zero exported-symbol drift — 0.3.201 -> 0.3.205 chased 2026-07-10, 0.3.199 -> 0.3.201 chased 2026-07-05) as
documented at code.claude.com/docs/en/agent-sdk/* (fetched 2026-07-03).

For a full 146-row completion audit against the latest official surface
(including the unmodeled subsystems and the roadmap), see
`Public-Info-Pool/Resource/repo-engineering/bpt-agent-sdk-completion-audit-20260703.md`.

For the FIELD-LEVEL reconciliation against the live official docs (snapshot
2026-07-05: `Public-Info-Pool/Reference/Agent-SDK-Docs/typescript-20260705.md`),
including the drop-in breaking-gap list and the NEW-IN-DOCS ledger
(post-0.3.199 surface), see
`Public-Info-Pool/Resource/repo-engineering/bpt-sdk-official-docs-interface-audit-20260705.md`.
Stale rows flagged there were corrected in this file on 2026-07-05.

## 0.3.205 -> 0.3.207 chase (2026-07-13, keeper ruling 「追」)

An empirical type-surface diff of the official tarballs (0.3.205 vs 0.3.207,
`sdk.d.ts` parsed via the TS compiler API — full report
`Public-Info-Pool/Resource/repo-engineering/silver-core-sdk-vs-official-diff-20260713.md`)
found the pinned 0.3.205 baseline drifted 2 patch versions behind npm latest
`0.3.207` with **zero exported-symbol change (232 = 232, none added/removed)**.
The drift is entirely field-level/additive:

- **`TerminalReason` union +6 members** — `api_error`,
  `malformed_tool_use_exhausted`, `budget_exhausted`,
  `structured_output_retry_exhausted`, `tool_deferred_unavailable`,
  `turn_setup_failed`. IMPLEMENTED: added to the union (`src/types.ts`) for
  drop-in exhaustiveness; **typed-not-populated** (this field has no engine
  emission site here — grep-verified). Exhaustive lock in
  `tests/b2c-alignment.test.ts` (12 → 18).
- **`mcp_call` staging fields** (`input_files`/`output_files`/`expires_at`/`timeout_ms`,
  Cowork synced-file lane) — **N/A-BY-DESIGN**: these ride the `control_request`
  wire protocol this headless direct-API engine does not implement (same posture
  as `get_plan`/`get_workspace_diff`/`reinitialize`). No code; registered here to
  prevent drift-misjudgement.
- **PostToolUse-family structured-tool-output field** (`AgentToolCompletedOutput`
  shape) — additive-optional on the hook-output shapes; not populated (no hook
  emission of the full typed Output object here).
- **`SDKModelRefusalNoFallbackMessage`** doc refinement (per-category routing
  declines the retry) — documentation-only; no interface change.

No package `version` change to the tracked-Claude-Code number (this SDK keeps
its own independent version, 0.53.7 — see CHANGELOG).

## 0.3.201 -> 0.3.205 chase (2026-07-10, keeper ruling 「追」)

A type-surface diff of the official tarballs (`sdk.d.ts` + `package.json`, not
the external changelog) found the pinned 0.3.201 baseline drifted 4 patch
versions behind npm latest `0.3.205` (published 2026-07-08); `claudeCodeVersion`
`2.1.201` -> `2.1.205`. Seven new exported types, zero removed. All were
reconciled onto this SDK following the established NEW-IN-DOCS posture — **typed
for drop-in exhaustiveness, emitted only where a headless direct-API engine has
an honest source** (none here):

- **`SDKActiveGoalMessage`** (`type:'active_goal'`) — top-level variant, TYPED-not-emitted (no persistent goal/condition loop to report). Added to `SDKMessage`.
- **`SDKConversationResetMessage`** (`type:'conversation_reset'`) — top-level variant, TYPED-not-emitted (a new conversation is a new `query()`/session here, not an in-stream boundary). Added to `SDKMessage`.
- **`SDKBackgroundTasksChangedMessage`** (`system`/`background_tasks_changed`, 0.3.203) — observability arm, TYPED-not-emitted. The candidate source is the ShellManager background-task set (BashOutput/TaskOutput), but no membership-change channel feeds the pull-based stream; task lifecycle rides `task_started`/`task_updated`.
- **`SDKControlRequestProgressMessage`** (`system`/`control_request_progress`, 0.3.205) — observability arm, TYPED-not-emitted (N/A-by-design: no control_request wire protocol, like reinitialize/applyFlagSettings).
- **`SDKControlGetPlanRequest`** / **`SDKControlGetWorkspaceDiffRequest`** (`get_plan` / `get_workspace_diff`, 0.3.205) — control-protocol request subtypes, typed for parity; N/A-by-design (no control_request protocol here; no diff engine).
- **`SDKControlInterruptResponse`** (`{ still_queued }`, 0.3.205) — `Query.interrupt()` moved from `Promise<void>` to this typed receipt. Implemented: interrupt() returns `{ still_queued: [] }` (this engine keeps no uuid-stamped async message queue surviving an abort). Source-compatible — an `await q.interrupt()` that ignores the result is unaffected.

Also folded in **`SessionMessage.parent_agent_id`** (0.3.202): the spawning
subagent's agentId, surfaced by `getSessionMessages` from persisted metadata
(null when the transcript's metadata lacks it — official contract). No package
`version` change to the tracked-Claude-Code number: this SDK keeps its own
independent version (see CHANGELOG). Tests: `tests/compat-0-3-205.test.ts`
(new-type assignability, interrupt receipt, parent_agent_id round-trip) +
`tests/observability.test.ts` (union completeness, 25 -> 27 sampled variants).

## v0.12 status (P2 PARTIAL-closure pass, 2026-07-06)

A row-by-row re-audit of every PARTIAL entry against the CURRENT source (four
parallel read-only audits) sorted them into three buckets: (a) STALE — code was
already at parity, only the note lagged (esp. the v0.7 campaign); (b) GENUINE —
an intrinsic/structural divergence of a headless direct-API engine (no
subprocess/CLI/ripgrep/PDF-dep/plugins); (c) REAL-GAP — implementable. This pass
**closed 8 REAL-GAPs with code + tests** and reconciled the stale rows to FULL:

- **Edit read-before-write gate** — Edit now refuses to edit a file this session
  has not Read (matches Write / the official Edit tool). *Behavioral change* —
  see MIGRATION §P2.
- **stream_event `ttft_ms`** — attached once the first token latches.
- **PostToolBatch `tool_calls[]`** — the official full-block shape now rides
  alongside the deprecated `tool_names`.
- **SubagentStop `agent_transcript_path`** — populated for a path-backed
  persisted store.
- **thinking `display`** ('summarized'|'omitted') — forwarded onto the wire.
- **`maxThinkingTokens`** carries the official `@deprecated` tag.
- **`debugFile`** — debug lines are now appended to it (was accepted-ignored).
- **mcpServerStatus `scope`** — provenance ('project'/'local'/'dynamic') tracked.

Deferred (honest, non-structural, not yet done): Read `.ipynb` cell rendering
(currently returned as raw JSON — usable, not cell-formatted) and the legacy
`sse` MCP transport (being retired upstream). Structural PARTIALs (continue,
agents name/POST, permissionMode auto-heuristic, stderr, sandbox platform
backends, Monitor/Workflow push channel, Grep no-ripgrep, Read PDF-slice,
accountInfo, supportedCommands) stay PARTIAL by design.

## v0.7 status (completion-inventory full-implementation campaign, 2026-07-05)

The keeper ruling 「全面实现」 drove a full-surface alignment pass. What landed
(breaking items detailed in MIGRATION.md §4/5f–5l; per-row tiers below updated):

- **Built-in tool surface 15 → 20 of 24 official tools**: Task quadruplet
  (TaskCreate/TaskGet/TaskUpdate/TaskList) ships as the default task surface
  (official 0.3.142 semantics: TodoWrite off by default, `CLAUDE_CODE_ENABLE_TASKS=0`
  reverts); ExitPlanMode (real plan→default gate flip), EnterWorktree (named
  worktrees + cross-turn cwd), Monitor (honest subset — background watch, no push
  channel), and Workflow (restricted-vm orchestration engine, official
  meta/agent()/parallel()/pipeline() and concurrency/lifetime caps) all ship.
  Remaining absent: NotebookEdit (no notebook surface, by design); the 3
  Task*-adjacent CLI-host tools with no headless source.
- **Observability encoding migrated** to official `{type:'system', subtype:…}`
  for all ten reversed variants (was a v0.7 candidate; now done — see the
  Observability arm note). E8 subagent-lifecycle encoding aligned.
- **Wire alignment (E7)**: thinking default is `{type:"adaptive"}` **on 4.6+
  models only** — pre-4.6 models (haiku 4.5, sonnet 4.5, …) get
  `{type:"enabled", budget_tokens}` instead, since adaptive 400s there (v0.8.1
  model-gate fix; see `src/engine/thinking-model.ts`). Read `pages`;
  Bash `dangerouslyDisableSandbox` always in schema; Agent `model`/`isolation`.
  Wire ratchet shrinks to `Agent:params` (our BPT-only `fork` extension) plus
  placement/thinking residuals. E7-03 tool-block cache breakpoint kept as a
  measured KD (dropping it never gains a byte; loses the tool prefix on
  system-prompt divergence).
- **Result/type shapes to official**: setMcpServers → added/removed/errors;
  rewindFiles → canRewind/error/filesChanged; SDKResultMessage.stop_reason
  required both arms; McpServerStatus.tools object array; ModelUsage
  contextWindow/maxOutputTokens; 22 more Options fields typed; removeDirectories
  and suppressOutput honored; session rename/tag round-trips.
- **Errors**: McpError taxonomy, stable machine-readable `code` on every error
  (docs/ERRORS.md), throw-discipline static guard.
- **Resilience defaults**: maxRetries 4→10 (env-capped 15), stream watchdog
  120s→300s, new background-subagent stall watchdog.
- **NEW-IN-DOCS (above the pinned 0.3.199/2.1.201 baseline)**: six new hook
  events typed (typed-not-fired — no natural headless hook point), MessageDisplay
  5-field incremental protocol emitted, plus additive optional types
  (SDKMessageOrigin, error/terminal_reason enums, etc.). The **`settingSources`
  default reversal** (omit = load-all) is DONE as of v0.8 (keeper bump-pin ruling
  2026-07-05): it was the one behavior-level reversal and deliberately tracks the
  LIVE docs ahead of the pinned arm. Explicit `[]` is the opt-out.

## Divergences from the official SDK (where we differ on purpose)

A focused ledger of the INTENTIONAL differences between this SDK and
`@anthropic-ai/claude-agent-sdk`. Four kinds: **BPT-EXTENSION** (we expose
something official does not), **HONEST-SUBSET** (official has it; we do a
scoped, truthfully-labeled version), **KEPT-DIVERGENCE** (measured, kept on
purpose), **N/A-BY-DESIGN** (out of scope for a direct-API headless engine).
Per-row detail lives in the sections below; this is the at-a-glance table.

| Area | Kind | Official | Ours |
|---|---|---|---|
| **Engine model** | — | wraps the Claude Code CLI (black-box subprocess) | drives the Messages API directly (fetch+SSE, no CLI); this is the root of most divergences below |
| `createBptSession` (SessionManager) | BPT-EXTENSION | no in-process coordinator (coordination lives in the wrapped CLI host) | one manager hosts many `mgr.query()` conversations over a shared transport + shared MCP pool; supervised auto-resume from a store; `error_code` on result (v0.9.0) |
| Read total-output cap (`readLimits`) | BPT-EXTENSION | line + per-line caps only | additionally caps TOTAL Read output on a line boundary (default 50000), with a footer that reflects the real range, per-line truncation markers, and a Grep hint; `options.readLimits` tunes the numbers (v0.10.0) |
| `enumerateBuiltinToolMetadata` | BPT-EXTENSION | built-in tool defs are internal to the CLI; no public read API | zero-side-effect read-only projection of the default built-in tools as `{ name, description, inputJsonSchema }` (MCP-metadata-shaped), so a host can size the built-in tool block instead of estimating it as a residual (v0.11.0) |
| `provider.protocol: 'openai-chat'` + `provider.openai` | BPT-EXTENSION | Anthropic-only (the wrapped CLI speaks the Messages API) | translating transport drives any OpenAI-compatible Chat Completions endpoint; engine keeps Messages API shapes, translation at the wire boundary only (see docs/OPENAI-PROTOCOL.md) (v0.35.0) |
| `provider.pricing` | BPT-EXTENSION | static internal price table | USD-per-MTok overrides keyed by model-id prefix (win over the static table); makes cost metrics + `maxBudgetUsd` enforceable on non-Claude models (v0.37.0) |
| `resolveSubagentTransport` + `createSubagentTransportResolver` | BPT-EXTENSION | single Anthropic protocol; no per-subagent transport concept | cross-protocol subagent routing: host callback resolves the transport an ISOLATED child drives when its model needs a different wire protocol than the parent (absent -> children share the parent transport, the previous behavior; forks never consult it); standard implementation memoizes one transport per protocol and derives the child provider from protocol-agnostic parent knobs + the child protocol's own env chain (see docs/OPENAI-PROTOCOL.md "Cross-protocol subagents") (v0.54.0) |
| `hookFailureMode` | BPT-EXTENSION | hook failures are logged and ignored | `'closed'` turns a throwing/timed-out hook into a deny so hook-enforced policy fails safe; default `'open'` keeps official-parity behavior (v0.37.0) |
| `provider.cacheTtl` | BPT-EXTENSION | no cache-TTL knob (CLI decides 5m/1h internally; only reports the split in usage) | caller picks `'5m'`/`'1h'` per query (v0.7.1) |
| `provider.fetch` | BPT-EXTENSION | HTTP stack is internal to the wrapped CLI | custom fetch used for EVERY transport request (both protocols, retries included); highest-priority override — the proxy/mTLS/instrumentation seam (recipes: docs/PERFORMANCE.md) (v0.44.0) |
| `provider.httpClient` + built-in node adapter | BPT-EXTENSION | HTTP stack is internal to the wrapped CLI | default 'node' since v0.45.0: zero-dependency node:http(s) keep-alive client (connections survive slow tool runs instead of re-paying a ~100-300ms TCP+TLS handshake at undici's ~4s idle cliff; TLS session resumption; idle sockets unref'd). 'fetch' restores the pre-v0.45 late-bound global fetch (env `BPT_HTTP_CLIENT`) (v0.45.0) |
| `provider.preconnect` | BPT-EXTENSION | no preconnect concept | opt-in fire-and-forget unauthenticated HEAD at transport construction; warms DNS+TCP+TLS in parallel with query init (~100-300ms off first-turn TTFT); env `BPT_PRECONNECT=1` (v0.45.0) |
| `options.memory` (memory system) | BPT-EXTENSION | memory rides the CLI host / API-side memory_20250818 only | `memory_20250818`-equivalent six-command tool with CLIENT-INJECTED storage (`MemoryStore` contract + `MemoryFileOps` primitives + `createMemoryStore` reference-format engine + local-fs default + publishable contract suite). Mode `native` sends the official typed entry (Anthropic protocol; API injects definition + protocol prompt); mode `custom` advertises an SDK-defined equivalent tool + injects the docs-verbatim protocol fragment (works on `openai-chat` too). SDK-layer path-traversal validation on every command; resident `/memories/MEMORY.md` head injected at session start (line/byte-capped). Official naming kept where one exists (`memory` tool name, command set, reference return strings); see docs/MEMORY.md for the mapping + migration notes (v0.46.0; M2 in v0.47.0 adds R7 write-timing rounds `flushOnCompaction`/`sessionEndUpdate`, R8 `limits` + `metrics.memoryHealth`, R9 `schema:'cards'`) |
| `provider.promptCaching` | BPT-EXTENSION | no toggle (caching is internal) | caller can turn the whole breakpoint layer off |
| tool-block cache breakpoint | KEPT-DIVERGENCE | 0 breakpoints on tool blocks | 1 (last tool) — measured to only ever gain cache hits on system-prompt divergence, never lose (E7-03) |
| `compaction.model` / `preTier` | BPT-EXTENSION | fixed compaction | route summarization to a cheap model + deterministic pre-tier |
| `sandbox` object form + bwrap backend | BPT-EXTENSION | CLI-managed sandbox | pluggable object-form config, default-on bwrap, network-off default |
| worker-fork preset / Agent `fork` param | BPT-EXTENSION | no fork | prefix-sharing subagent fork (residual `Agent:params` wire delta) |
| result `metrics` / `task_progress` superset | BPT-EXTENSION | — | extra observability fields (additive) |
| `analyzeRequestComposition` / `includePromptComposition` / `system`.`prompt_composition` | BPT-EXTENSION | request composition is internal; the API reports only aggregate `usage` | build-time per-part token estimate (需求 A: systemBase / systemAppend / toolDefs / messages via `engine/tokens.ts`) + `cache_control` breakpoint map (需求 B: each breakpoint's sealed-prefix estimate), so a host can attribute usage to buckets without reverse-engineering the transcript. Preset `appendSegments` + `SystemPromptSegment.label` carry per-bucket labels (metadata only, wire byte-identical) (v0.32.0) |
| Monitor | HONEST-SUBSET | pushes events into the conversation | background watch, read via BashOutput (no push channel) |
| Workflow | HONEST-SUBSET | async background launch | synchronous execution, result returned inline |
| MessageDisplay | HONEST-SUBSET | per-delta incremental | per-completed-message (final always true) |
| Read PDF `pages` | HONEST-SUBSET | slices PDF pages | validates the param; page-slicing itself unsupported (no PDF dep), errors honestly |
| Grep | HONEST-SUBSET | ripgrep binary | pure-JS regex (large-repo perf caveat; see the crossover diagnostic 2026-07-07). v0.13.0: `count`/`files_with_matches` default to COMPLETE (no silent 250-cap truncation), all modes announce cap-induced truncation, and a `grep.scan` debug line reports full-scan coverage |
| `runConcurrent` (SessionManager) | BPT-EXTENSION | no in-process fan-out driver | drives many `mgr.query()` conversations in parallel with a concurrency bound + per-task failure isolation, closing the pull-driven "sequential-await" footgun (v0.13.0) |
| `provider.maxConcurrentRequests` | BPT-EXTENSION | CLI owns request concurrency | caps concurrent in-flight Messages API requests through a shared transport (FIFO queue), so a large multi-conversation fan-out does not thrash the rate limit (v0.13.0) |
| six new hooks (Setup/TeammateIdle/…) | HONEST-SUBSET | fire | typed-not-fired (no natural headless hook point) |
| MCP subscription tools (4) | N/A-BY-DESIGN | subscribe + server push | absent (no push-to-conversation channel) |
| NotebookEdit | N/A-BY-DESIGN | edits Jupyter cells | absent (no notebook surface) |
| TaskOutput / TaskStop tools | FULL | model-facing task tools | v0.31.0 (2026-07-08): shipped under the official names, delegating to the same ShellManager as BashOutput/KillShell (a background task IS a background shell here). TaskOutput reproduces `task_id`/`block`/`timeout` (blocking poll for new output); TaskStop takes `task_id` + deprecated `shell_id`. Legacy BashOutput/KillShell still ship (reproduced Bash/Monitor descriptions reference them). Types `TaskOutputInput`/`TaskStopInput`/`TaskStopOutput` in tool-types.ts (TaskOutput has no official output member) |
| full settings engine / OTel / 3P providers | N/A-BY-DESIGN | present | out of scope for a direct-API engine |
| `reinitialize()` / `applyFlagSettings()` | N/A-BY-DESIGN | CLI control requests | no CLI to control |
| `settingSources` default | IMPLEMENTED | omit = load-all (live docs) | omit = load user+project+local (v0.8 bump-pin flip); explicit `[]` = opt-out |
| KD-12 rate-limit encoding | KEPT-DIVERGENCE | `system/api_retry` on 429 | `rate_limit_event` on 429 (triaged) |

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
  API's 4-breakpoint max; **BPT-EXTENSION v0.7.1** `provider.cacheTtl: '1h'`
  switches the breakpoints to the 1-hour cache, default `'5m'`), `ttft_ms`/`deferred_tool_use` result extras, init
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
  `rewindFiles`; tool search (deferred MCP schemas + cold built-in schemas via
  `toolSearch: true`, `silverCoreToolOptions()` variant); standalone session
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
| `tool()` | FULL | zod v4 raw shapes; JSON Schema derived via `z.toJSONSchema`; 5th param accepts BOTH the official `extras?: { annotations?: ToolAnnotations }` wrapper (primary overload) and the legacy bare `ToolAnnotations` — resolved by the `'annotations' in arg` key test (P2 re-audit: the old "silently dropped" note was stale, fixed in v0.7 #480; test mcp.test.ts) |
| `createSdkMcpServer()` | FULL | in-process dispatch, no wire protocol |
| `listSessions()` / `getSessionInfo()` | FULL | reads this SDK's own JSONL store (structural scope). Option is `includeWorktrees` (`includeWorkspace` kept as a `@deprecated` alias); `getSessionInfo()` returns `undefined` for a miss; `SDKSessionInfo` carries `gitBranch`/`tag`, `customTitle` is populated from `meta_update`, summary follows customTitle > firstPrompt precedence (no auto tier — this store keeps no auto summaries). P2 re-audit: every docs-audit sub-claim was stale, fixed in v0.7 #480 (tests sessions-store / b2b-alignment) |
| `startup()` / `WarmQuery` | UNSUPPORTED | no subprocess to pre-warm; direct API needs no warmup |
| `getSessionMessages()` / `renameSession()` / `tagSession()` / `deleteSession()` / `forkSession()` | FULL | over this SDK's own JSONL store (or an external `sessionStore`); no Claude Code store interop (structural). P2 re-audit — all three docs-audit sub-claims were stale, fixed in v0.7 #480: rename/tag round-trip WORKS (`meta_update` records are read back last-write-wins by `store.load`, incl. tag-clear on `null`); `getSessionMessages` has `dir`/`limit`/`offset`, and (0.3.205 chase) surfaces the official `SessionMessage.parent_agent_id` (0.3.202) from persisted metadata — null when the transcript lacks it; `renameSession` validates non-empty title (`ConfigurationError`). Tests sessions-store / b2b-alignment / compat-0-3-205 |
| `resolveSettings()` | UNSUPPORTED | settings engine is CLI-coupled (N/A-by-design) |
| `analyzeRequestComposition()` | BPT-EXTENSION | v0.32.0: pure build-time descriptor of a request — `{ promptComposition, cacheBreakpoints }` (需求 A per-part estimate + 需求 B cache-breakpoint map), using `engine/tokens.ts`. Zero side effects; complements `buildSystemPromptParts` / `enumerateBuiltinToolMetadata` |
| `buildSystemPromptParts()` | BPT-EXTENSION | returns the stable prompt split (`base`/`project`/`volatile`) plus, since v0.32.0, the labeled per-part decomposition (`parts`) that feeds the prompt-composition breakdown |

## Engine difference (the point of this SDK)

The reference SDK spawns the proprietary Claude Code CLI as its engine. This
SDK implements the agent loop directly against the public Messages API:
`fetch` + SSE, tool_use dispatch, multi-turn history. Consequences:
- No `pathToClaudeCodeExecutable`, `executable`, `executableArgs`,
  `spawnClaudeCodeProcess` (ACCEPTED, ignored — there is no subprocess).
- Credentials come from `options.provider` (BPT extension) or
  `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`.
- `total_cost_usd` is an **estimate** from a static price table.
- **`settingSources` loads CLAUDE.md / AGENTS.md** (v0.5; default flipped
  v0.8): 'project'/'local' walk up from cwd, 'user' reads ~/.claude/CLAUDE.md;
  the text is injected as a cached system-reminder on the `claude_code` preset
  path, and a project `.mcp.json` is loaded on EVERY systemPrompt path.
  OMITTED loads all three sources (the v0.8 load-all default, matching
  official Claude Code); an explicit `[]` loads nothing (opt-out).
  Skills/plugins loading still not implemented.
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
| `additionalDirectories` | FULL | sandbox writablePaths (Bash) + subagent inheritance. NOTE: since 0.6.4 (keeper ruling BPT #2) Read/Write/Edit have NO path fence — they reach any path the process can, gated by permission mode (official-aligned); additionalDirectories no longer gates fs-tool access, only sandbox write allowance. |
| `agents` | PARTIAL | executed since v0.2 (subagent runtime); the delegation tool is named `Agent` here vs official `Task`, and official 2.1.201 delegation made 4 POSTs vs our deterministic parent+child+parent 3 (conformance run-l2 s13-agents-task, KD-11, 2026-07-05) |
| `allowedTools` / `disallowedTools` | FULL | `Tool(spec)` prefix rules + `mcp__srv__*` (exact server match) + `*` / `mcp__*` globs (v0.4); bare-name `disallowedTools` removes the tool definition from the request; plan mode never auto-approves writes via an allow rule; rewritten inputs re-checked against deny rules |
| `canUseTool` | FULL | invoked on prompt-fallthrough with `signal`/`suggestions`/`requestId`/`toolUseID`; `updatedInput`/`updatedPermissions` honored (incl. hook-`ask` rewrite); `null` return = skip (app resolves out of band) |
| `continue` | PARTIAL | resumes latest session from this SDK's store |
| `cwd` | FULL | |
| `env` | FULL | used for transport + Bash tool |
| `fallbackModel` | FULL | on a 429/5xx the turn retries once on the fallback model, then stays switched for the rest of the run (official intent; P2 re-audit confirmed complete — test conformance-l2-locks) |
| `forkSession` | FULL | |
| `hooks` | PARTIAL | see hook table |
| `includePartialMessages` | FULL | raw stream events as `stream_event` |
| `maxBudgetUsd` | PARTIAL | based on estimated cost (a static price table, not billing truth); stop ORDERING matches official 2.1.201 (E5, 2026-07-05): a turn requesting tools past the cap stops BEFORE any tool executes (zero side effects, no tool_result user turn, terminal `error_max_budget_usd`), while a naturally ending turn still yields its completed success result (conformance run-l2 s12 converged) |
| `maxThinkingTokens` / `thinking` | FULL | **Model-gated wire form (v0.8.1)**: `computeThinking` emits `{type:'adaptive'}` on 4.6+ models and `{type:'enabled', budget_tokens}` on pre-4.6 models — recomputed each turn from the live model, since the two forms 400 on the wrong tier (root-cause fix for the v0.7 haiku 400-storm, run 28753349435). On the `claude_code` preset path thinking is DEFAULT-ON like the official CLI (opt out with `maxThinkingTokens: 0` or `thinking: {type:'disabled'}`); off the preset path `maxThinkingTokens` alone is only a budget fallback and sends no thinking param on its own. The official `budgetTokens` field name IS accepted (alongside the `budget_tokens`/`budget` aliases). **P2**: the official `display` sub-option ('summarized'\|'omitted') is now forwarded onto the wire thinking param (adaptive + enabled forms; test engine.test.ts), and `maxThinkingTokens` now carries the official `@deprecated` tag |
| `maxTurns` | FULL | |
| `mcpServers` | PARTIAL | stdio/http/sdk FULL; `sse` legacy transport UNSUPPORTED (throws NotImplementedError → `failed` status). P2 re-audit: `sse` is being retired upstream — implementable (an SSE MCP client, src/mcp/http.ts) but deferred; the three modern transports are complete |
| `model` | FULL | default `ANTHROPIC_MODEL` env or `claude-sonnet-4-5` |
| `permissionMode` | PARTIAL | all 6 values incl. `auto` (the old "`auto` not offered" note was stale — offered since v0.2, docs-audit 2026-07-05); our `auto` is a HEURISTIC classifier while the official docs describe a model-driven classifier (semantics differ). `bypassPermissions` requires the `allowDangerouslySkipPermissions` interlock (below) |
| `allowDangerouslySkipPermissions` | FULL | safety interlock: `bypassPermissions` (initial or via `setPermissionMode`) throws `ConfigurationError` unless this is `true`. BPT-only strictness: official 0.3.199/2.1.201 does NOT enforce the interlock live - it proceeds to the model without the flag (conformance run-l2 s6-bypass-interlock-refusal, 2026-07-05) |
| `persistSession` / `sessionId` / `resume` | FULL | JSONL store |
| `provider` | FULL | **BPT extension** — direct-API connection settings |
| `settingSources` | PARTIAL | loads CLAUDE.md / AGENTS.md + project `.mcp.json` ('project'/'local'/'user'); **omit = load-all default (v0.8), explicit `[]` = opt-out**; skills/plugins not loaded |
| `includeEnvironmentContext` | FULL | **BPT extension** — inject official-style `<env>` block (default true on the preset) |
| `stderr` | PARTIAL | receives debug log lines (no subprocess stderr exists) |
| `strictMcpConfig` | ACCEPTED | typed but consulted nowhere in src; the old "only options servers are ever used" rationale is stale since v0.5 `settingSources` can load `.mcp.json` servers, and no strict/lax fork exists to lock (conformance-l2-locks reconciliation, 2026-07-05) |
| `systemPrompt` | FULL | preset `claude_code` maps to this SDK's own harness prompt (+`append`); the proprietary CLI prompt is unobtainable, so the preset is the open reproduction (P2 re-audit: both paths implemented, additive segments seam below — not a capability gap); **BPT extension** `{ type: 'segments', segments: [{text, cache?}] }` forwards caller-composed blocks verbatim with per-segment cache breakpoints (the generic seam for host prompt layering — up to 3 cached system segments; message-caching off in this path). The host owns which layers/order/trust; the engine only places the wire breakpoints |
| `tools` | FULL | string[] restricts built-ins by name (unknown names warned+ignored); preset/undefined = all built-ins; the Agent + MCP-resource tools fold into the same filter (P2 re-audit: matches official semantics exactly — no behavioral gap) |
| `toolChoice` | FULL | C10 (v0.17.0): forwarded verbatim as the Messages API `tool_choice` param on every request that advertises tools — `{type:'auto'\|'any'\|'tool'\|'none'}` with optional `disable_parallel_tool_use`; `tool` requires `name`. Omitted when the request carries no tools (the API 400s on tool_choice with an empty tool set). Tests engine.test.ts + transport.test.ts |
| `betas` | FULL | forwarded as `anthropic-beta` header |
| `includeHookEvents` | FULL | v0.4: emits `hook_started` / `hook_response` pairs (per callback invocation, correlated by `hook_id`) into the stream |
| `includePromptComposition` | FULL | **BPT extension (v0.32.0)** — emits a `system`/`prompt_composition` message before each request with the per-part token estimate (需求 A) + `cache_control` breakpoint map (需求 B); default off. Same payload available synchronously via exported `analyzeRequestComposition` |
| `systemPrompt.appendSegments` | FULL | **BPT extension (v0.32.0)** — preset-path labeled append buckets `{ label, text }[]`; concatenated into the append tail byte-identically to `append` (labels are metadata only, never on the wire), so the prompt-composition breakdown can attribute each bucket (Root / Runtime / Memory …). Also the answer to the ContextRing "Skills" bucket (keeper 2026-07-09): a persistent active-skill segment labeled `skill:<id>` is attributed in `systemAppend`. This SDK has NO skills subsystem (session `skills` ACCEPTED-IGNORED, no `load_skill` tool), so message-injected or first-load skill tokens stay in the `messages` bucket |
| `debug` / `debugFile` | FULL | `debug` → stderr callback (or process.stderr); **P2**: `debugFile` now honored — each debug line is best-effort appended to the file (was accepted-ignored; test query.test.ts) |
| `outputFormat` | PARTIAL | **Honesty fix (C9, v0.18.0): was mislabeled FULL.** Default path is enforced OFF the wire — a system-prompt instruction + a local lenient validator + a bounded re-prompt, ending in the `structured_output` result / `error_max_structured_output_retries` (v0.2). It works on every model and enforces the full local constraint set, but there is NO server-side guarantee — the official feature is `output_config: { format }` + `messages.parse()`, which this default does not use. **`native: true` (C9) now ALSO forwards the schema on the wire** as `output_config.format` for the server-side guarantee — supported models only (Fable 5 / Opus 4.8 / Sonnet 5 / Haiku 4.5 / Opus 4.5·4.1) and the documented schema subset (objects need `additionalProperties:false`; `minLength`/`minimum`/… are not enforced server-side). The local validator still runs as the complement/fallback, so opting in never loses a constraint. Native is off by default so older models / richer schemas don't 400. Tests engine.test.ts + structured-output.test.ts |
| `onElicitation` | FULL | MCP elicitation callback (v0.2); auto-decline when absent |
| `sessionStore` / `sessionStoreFlush` | FULL | external store mirror (v0.2); flush modes `batched`/`eager`, default `batched` matches official |
| `enableFileCheckpointing` | FULL | file checkpointing + `rewindFiles` (v0.2) |
| `loadTimeoutMs` | FULL | default 60000 matches official |
| `agent`, `settings`, `permissionPromptToolName`, `extraArgs`, `effort`, `plugins`, `skills`, `toolAliases`, `toolConfig`, `managedSettings`, `taskBudget`, `planModeInstructions`, `promptSuggestions`, `agentProgressSummaries`, `forwardSubagentText`, `title`, `resumeSessionAt` | ACCEPTED | each present key emits exactly one debug warning, then ignored. NOTE (2026-07-08): these ARE now declared on the TS `Options` type (T2-3, ACCEPTED block in src/types.ts) — object literals from an official-SDK caller pass excess-property checking; the fields are typed-but-inert, not compile errors. (Previous stale entries `outputFormat`/`onElicitation`/`sessionStore*`/`enableFileCheckpointing`/`loadTimeoutMs` graduated in v0.2 and now have their own rows above; `debugFile` graduated to FULL and moved to the `debug`/`debugFile` row.) |
| `sandbox` (`boolean \| SandboxOptions`) | PARTIAL | v0.6 bash sandbox (G-SANDBOX). Default ON when a backend resolves — bubblewrap on Linux (`--ro-bind / /` + rw-bind cwd/additionalDirectories/state/tmp, `--unshare-net` unless `allowNetwork`, `$TMPDIR` redirect). Per-call Bash `dangerouslyDisableSandbox` routes through the permission gate as an ask (never auto-allowed except under `bypassPermissions` or a matching allow rule); `allowEscape:false` = mandatory mode (param disabled). Sandboxed failures matching a restriction signature carry `[sandbox]` evidence + the retry path. **Not implemented:** macOS Seatbelt, the domain-whitelist network proxy (network is binary on/off). **Windows: no backend resolves → Bash runs unsandboxed with NO sandbox guidance emitted — identical honesty posture to official Claude Code on Windows.** The object sub-shape (`enabled`/`allowNetwork`/`writablePaths`/`allowEscape`/`backend`) is BPT-shaped. |

## Built-in tools

| Tool | Tier | Notes |
|---|---|---|
| Read | PARTIAL | text files (cat -n) + images (PNG/JPEG/GIF/WebP → image block) + PDF (→ base64 `document` block; the API's handle-tool-calls docs allow `document` inside tool_result, though the base64 source there is supported-but-not-explicitly-demonstrated); all magic-byte sniffed (task #17); notebooks returned as raw JSON text — cells not rendered individually (P2: a closable, NON-structural sub-gap — deferred, not yet done); oversized files (>50MB) rejected with a Grep hint rather than buffered. v0.7: official `pages` param (PDF page range) validated to contract (1-based, ascending, ≤20); PDF page-slicing itself is HONEST-unsupported (no PDF dep) — a `pages` read of a PDF errors clearly rather than silently returning the whole document, and `pages` on a non-PDF errors. Path fence removed (#483 keeper ruling): resolves to any location the process can reach, permission gate is the sole access control |
| Write / Edit | FULL | same input field names (`file_path`, `old_string`, …); BOTH enforce the official read-before-write gate — a bare Write/Edit over an existing un-read file errors with the verbatim official text and leaves the file untouched; new files pass (Write); a successful Read unlocks (Write E4 2026-07-05 pinned live L5 code-03 r1 vs r2; **Edit gate added in P2** to match the official Edit tool — behavioral change, MIGRATION §P2; test tools-fs.test.ts). OUR chosen extensions where the pinned evidence is silent: a successful Write/Edit also registers its path (create-then-revise does not self-block), and the gate spans subagents (one read-set per query). Success/error wording differs elsewhere (KD-L3-05/07/08). Path fence removed (#483) — same posture as Read |
| Bash | PARTIAL | Windows: shell resolved via `CLAUDE_CODE_GIT_BASH_PATH` -> Git-for-Windows standard locations (official-parity posture; actionable error when absent, bare `bash`/WSL never tried; foreground+background termination route through planProcessKill so win32 taskkill is used, #482/#484). v0.5: `cd` + exported env persist across calls (state-file replay — functions/aliases/unexported vars do NOT persist; not a long-lived shell process) and `run_in_background` launches a detached shell whose id feeds BashOutput/KillShell. v0.6: sandboxed by default when a backend resolves (see the `sandbox` option row); foreground and background both wrap through the backend and run in their own process group (timeout/abort reap the whole group; `--unshare-pid` + SIGKILL escalation reaps across the sandbox pid namespace). v0.7: `dangerouslyDisableSandbox` is ALWAYS in the schema (official parity); it is a no-op without a sandbox and CANNOT bypass the gate (escape still needs sandbox active + allowEscape + an independent ask) |
| Task quadruplet (TaskCreate/TaskGet/TaskUpdate/TaskList) | FULL | v0.7: the DEFAULT task surface (official 0.3.142: TodoWrite off by default, `CLAUDE_CODE_ENABLE_TASKS=0` reverts to TodoWrite-only). Symmetric dependency edges (blocks/blockedBy), owner/status workflow, session-shared store (parent + subagents see one list); TaskGet unknown-id returns null (not error) per official |
| ExitPlanMode | FULL | v0.7: really flips the permission gate plan→default (main loop and subagents each flip their own gate); `allowedPrompts` echoed not applied (no NL prompt rules in this gate); honest errors when unbridged or not in plan mode |
| EnterWorktree | FULL | v0.7: creates/enters named worktrees under `.claude/worktrees`; in-place cwd switch survives turn-boundary rebuilds (fs tools + subagent spawns; Bash follows via persistent state). `worktree.baseRef` not shipped (HEAD base) |
| Monitor | PARTIAL | v0.7: honest subset — a background watch on the shared shell registry; events accumulate for BashOutput/KillShell reads. NO push-into-conversation channel (headless has none) and NO `ws` source; the schema and description say so |
| Workflow | PARTIAL | v0.7: restricted-vm orchestration. All five official params (script/scriptPath/name/args/resumeFromRunId) + wire title/description; meta literal recursive-descent parsed (not eval'd); agent()/parallel()/pipeline()/phase()/log()/args/budget/workflow() with official concurrency (min(16,cores-2)), lifetime (1000), per-call (4096) caps and the Date.now/Math.random determinism ban. Structural adaptation: SYNCHRONOUS execution (no background task channel — same as Monitor); `budget` is a null-total stub (no token-metering source) |
| BashOutput | FULL | v0.5: incremental reads (new output since last call) + status/exit code; optional per-line regex `filter`; read-only (auto-approved, parallel-group eligible). FULL is vs the DOCUMENTED SDK lifecycle: live official 2.1.201 moved backgrounding to a task-file model and its own BashOutput answers "No task found" for the id its Bash advertised, so no official-arm parity evidence exists (conformance run-l3 L3-BG-01, KD-L3-19, 2026-07-05) |
| KillShell | FULL | v0.5: SIGTERM then SIGKILL escalation on the background shell's process group. Same official-arm caveat as BashOutput (run-l3 L3-BG-01, KD-L3-19) |
| TaskOutput | FULL | v0.31.0 (2026-07-08): official-named successor to BashOutput — reads output accumulated since the previous read + status, over the SAME ShellManager. Reproduces `task_id`/`block`/`timeout` (blocking polls up to `timeout` ms, default 60000, for new output or terminal status); read-only (auto-approved, parallel-group eligible). No `filter` (not in the official schema; use BashOutput for per-line filtering) |
| TaskStop | FULL | v0.31.0 (2026-07-08): official-named successor to KillShell — SIGTERM→SIGKILL on the background shell's process group. Takes `task_id` (or deprecated `shell_id`); already-terminal tasks report their status without re-killing. v0.42.0 (O-B2): `task_id` ALSO accepts a subagent agentId (official v2.1.198 semantics) — checked against the subagent registry before falling through to shells; a non-running subagent reports its status without kill events |
| SendMessage | PARTIAL | v0.42.0 (O-B2): continue a previously spawned subagent with its FULL transcript intact (the runtime retains every child's live history for the query's life; per-agent serialization; stopped workers revivable). `{to, summary?, message}` — `to` is an agentId ONLY: teammate NAMES, the `"main"` address and peer-origin message emission belong to the agent-teams naming machinery this SDK does not ship (SDKMessageOrigin `peer`/`coordinator` + TeammateIdle stay typed-not-emitted). Foreground children reply as the tool result; background children ack + reply on a later drained turn as official `<task-notification>` XML (drain format aligned to the archive shape in the same batch). Root-loop-only: isolated children never see the tool; fork children keep the schema (prefix byte-match) and get an honest error. Coordinator presets ship alongside (COORDINATOR_MODE_PROMPT adapted + COORDINATOR_WORKER_AGENT faithful, agents.ts) |
| Glob | PARTIAL | fast-glob, mtime-sorted newest-first; official 2.1.201 emitted ASCENDING order under ascending-utimes pins, so ordering parity with the live engine is not established - path sets agree (conformance run-l3 L3-GLOB-01, KD-L3-20, 2026-07-05) |
| Grep | PARTIAL | pure-JS regex engine (no ripgrep binary); large-repo perf caveat (crossover diagnostic 2026-07-07). v0.13.0 fixed the silent 250-cap truncation: `count`/`files_with_matches` default COMPLETE, all modes announce truncation, `grep.scan` debug telemetry added. The ripgrep-vs-pure-JS decision itself is pending (keeper) |
| WebFetch / WebSearch | FULL | registered in v0.2 |
| TodoWrite | PARTIAL | v0.7: OFF by default (Task quadruplet is the default surface); `CLAUDE_CODE_ENABLE_TASKS=0` reverts to TodoWrite-only, per official 0.3.142 |
| Agent | PARTIAL | the subagent spawn tool; v0.7 gains `model`/`isolation:'worktree'` and the official required set [description, prompt] (subagent_type defaults to general-purpose). Residual param delta = our BPT-only `fork` extension |
| NotebookEdit / MultiEdit | UNSUPPORTED | deliberately untracked (BPT has no notebook surface; MultiEdit retired upstream) |

## SDKMessage stream

| Variant | Tier | Notes |
|---|---|---|
| `system/init` | PARTIAL | apiKeySource, tools, mcp_servers, model, permissionMode, agents, claude_code_version, betas, skills, plugins ALL emitted (the old "claude_code_version/betas/skills/plugins absent" note was stale — docs-audit 2026-07-05); `slash_commands` REAL since v0.38 (bare names: built-in `compact` + custom `.claude/commands` — see "Custom slash commands" below; official CC lists its full host command set, ours only what this engine can honor); `skills` always `[]`; `plugins` element shape is `string[]` vs official `{name, path}[]`; `claude_code_version`/`skills`/`plugins` typed optional where official requires them |
| `assistant` | FULL | full `APIAssistantMessage` |
| `user` (echo + tool results) | FULL | prompt echo and tool_result user turns both yielded and persisted in order |
| `stream_event` | FULL | behind `includePartialMessages`; **P2**: `SDKPartialAssistantMessage` now carries the official `ttft_ms?` field, attached from the event that latches the first token onward (test engine.test.ts) |
| `result` success / error_max_turns / error_during_execution / `error_max_budget_usd` / `error_max_structured_output_retries` | PARTIAL | success arm carries ttft_ms + structured_output + deferred_tool_use + v0.3 `metrics`; error arm carries both `errorMessage: string` and the official-parallel `errors: string[]` (v0.4). Mid-stream SSE truncation degrades gracefully like official 2.1.201 (E3, 2026-07-05): the blocks the wire delivered whole are salvaged - partial text becomes the `success` answer, complete tool_use blocks EXECUTE (at either cut depth, with or without stop_reason) and the loop re-requests to deliver the tool_result; the connection error rides `errors` as a non-fatal note on the terminal result (former KD-L4-04 + all three truncation engine findings retired; residual KD-L4-02: official also appends the error as assistant text and throws from the iterator post-result - deliberately not replicated). An UNCLOSED tool_use (mid-transmission input) never executes; nothing salvageable falls back to `error_during_execution`. Remaining fault-path divergence: on a terminal non-retryable 400 ours ends with a clean `result/error_during_execution` where official surfaces the error as assistant text plus `result/success` then throws (KD-L4-01; run-l4 l4-http400-non-retryable, l4-script-exhausted-400-terminal). Reporting semantics on streamed multi-turn input match official (E2, 2026-07-05, KD-L5-04 retired): `num_turns`/`usage` are PER-RESULT (that turn's own figures), `total_cost_usd`/`duration_api_ms` are session-cumulative; `modelUsage` stays session-cumulative (official per-result semantics unobserved - our choice); internal `maxTurns`/`maxBudgetUsd` enforcement remains session-wide. Query-layer synthetic results (hook-block / pre-turn cap stop / interrupt) report `num_turns: 0` + zero `usage` (no engine turn ran for them; official shape unobserved) |
| `system/compact_boundary` | FULL | emitted on manual `/compact` + auto-compaction (v0.2) |
| `system/mirror_error` | FULL | emitted on a session-store mirror failure |
| `active_goal` | TYPED | NEW-IN-DOCS 0.3.205; no persistent goal/condition loop in a headless engine (`value:null` clears) |
| `conversation_reset` | TYPED | NEW-IN-DOCS 0.3.205; a new conversation is a new `query()`/session here, not an in-stream boundary |

### Observability arm (v0.3 — task #16)

The official SDKMessage union carries a large observability/status arm. We add
the full set of variant TYPES so drop-in consumers can switch exhaustively, and
EMIT the subset this headless engine has a real source event for.

Design note (updated 2026-07-05, v0.7 alignment DONE): the ten reversed
variants now emit and type as official `{type:'system', subtype:…}`
(task_started/progress/updated/notification, hook_started/progress/response,
files_persisted, local_command_output, commands_changed), with payloads aligned
to the 0.3.201 snapshot (`task_name`→`description`, `cancelled`→`killed`,
official usage/patch envelopes, hook output/outcome fields; `task_progress`
stays a documented BPT superset). The E8 subagent-lifecycle encoding aligned in
lockstep (KD-L35-02 retired). This was a BREAKING change (MIGRATION 5f). The
four former export-name differences now use the official spelling with
deprecated aliases: `SDKFilesPersistedEvent`, `SDKRateLimitEvent`,
`SDKAPIRetryMessage`, `SDKControlInitializeResponse`. All carry the house
`uuid`/`session_id` envelope. Union: `SDKObservabilityMessage`. Remaining
top-level-`type` variants (tool_use_summary, tool_progress, auth_status,
prompt_suggestion) are unemitted-typed. `SDKRateLimitEvent` gains the official
`rate_limit_info` envelope (KD-12 429-vs-api_retry semantics unchanged).

| Variant | Tier | Notes |
|---|---|---|
| `permission_denied` | FULL (emitted) | yielded on every permission-gate deny, before the tool_result; mirrors the `result.permission_denials` ledger; `blocker:'canUseTool'` set on a canUseTool interrupt, else omitted |
| `tool_progress`, `tool_use_summary` | TYPED | no mid-tool progress channel (tools are one-shot) |
| `task_started` / `task_progress` / `task_updated` / `task_notification` | FULL (emitted, v0.4) | Agent-tool subagent lifecycle: `task_started` at spawn (task_id = agentId, task_name = the Agent call's `description`), `task_progress` per child assistant turn (turn-budget share, `status: 'turn N/M'`), `task_updated` on completed/failed/cancelled (bounded result preview), `task_notification` for BACKGROUND children (completed/failed/stopped). Buffered by the runtime and drained into the stream at message boundaries (foreground events surface after their Agent tool group finishes — a pull-based generator cannot interleave mid-await) |
| `hook_started` / `hook_response` | FULL (emitted, v0.4) | behind `options.includeHookEvents`: one pair per callback invocation, correlated by `hook_id`; `result` = bounded output JSON, `error` = failure/timeout text. Same message-boundary drain as task events |
| `hook_progress` | TYPED | callbacks are opaque promises; no honest mid-callback progress source |
| `rate_limit_event`, `api_retry` | FULL (emitted) | the transport's per-request `onRetry` observer bridges each 429/5xx/network retry into the stream: a `rate_limit_event` on 429 (with `retry_after_ms`), an `api_retry` otherwise (with `status`/`reason`), yielded just before the retried attempt's stream. Shape split vs official: 2.1.201 encodes the per-429-retry notification as `system/api_retry` too - it emits no `rate_limit_event` on 429 (triaged KD-12; conformance run-l4 l4-429-retry-after-recover / l4-429-storm-two-vs-budget, 2026-07-05) |
| `files_persisted`, `local_command_output`, `commands_changed`, `auth_status`, `elicitation_complete`, `notification`, `prompt_suggestion`, `memory_recall`, `worker_shutting_down`, `plugin_install`, `session_state_changed`, `system/status` | TYPED | no source event in a headless engine with no plugins/skills/CC-host. `commands_changed` specifically: custom commands (v0.38) load ONCE at query construction — the set never changes mid-query, so there is still no change source; `local_command_output` covers CC-host LOCAL commands (`/voice`, `/usage`), which have no engine equivalent |
| `system/background_tasks_changed` | TYPED | NEW-IN-DOCS 0.3.203; candidate source is the ShellManager background-task set (BashOutput/TaskOutput) but no membership-change channel feeds the pull-based stream (task lifecycle rides task_started/task_updated). REPLACE semantics: the payload is the full live set |
| `system/control_request_progress` | TYPED | NEW-IN-DOCS 0.3.205; no control_request wire protocol (N/A-by-design) so no in-flight control request to report progress for |
| `system/prompt_composition` | FULL (emitted, v0.32.0) | **BPT-EXTENSION**; behind `options.includePromptComposition` (default off): one message per request, just before it is sent, carrying `promptComposition` (需求 A per-part estimate) + `cacheBreakpoints` (需求 B cache-prefix map) + `model`. Read-only — the wire request is never affected |

## Custom slash commands (`.claude/commands`) — v0.38

Open reproduction of the official custom-command surface, SDK-side subset
(`src/engine/slash-commands.ts`). Loading follows `settingSources` ('project' →
`<cwd>/.claude/commands/`, 'user' → `~/.claude/commands/`), one `*.md` file per
command, subdirectories namespace with ':' (`frontend/component.md` →
`/frontend:component`), project wins over user on collision, built-in names
(`compact`) reserved. A PURE-TEXT `/name [args]` user turn is expanded to the
command body with `$ARGUMENTS` / `$1`..`$9` substituted (args appended after a
blank line when the body has no placeholder); history and persistence carry the
EXPANDED body, `UserPromptSubmit` hooks see the RAW typed text, and the
`firstPrompt` session meta stays raw.

| Aspect | Tier | Notes |
|---|---|---|
| Load + list + expand (`$ARGUMENTS`, `$1`..`$9`, frontmatter `description`/`argument-hint`, ':' namespacing) | FULL | commands load once at query construction; unknown `/name` passes through as plain text (official CLI raises a local "Unknown command" error instead — no engine-honest equivalent) |
| `!command` inline-bash execution | UNSUPPORTED | would need the permission gate wired into command PREPROCESSING (a pre-turn execution surface this engine does not have); declared, not silent |
| `@file` references | UNSUPPORTED | same preprocessing surface; use the model's Read tool instead |
| frontmatter `allowed-tools` / `model` / `disable-model-invocation` | UNSUPPORTED | parsed keys are ignored (no per-turn tool/model scoping surface); `description`/`argument-hint` are the consumed subset |
| `SlashCommand` tool (model-invoked commands) | UNSUPPORTED | official gives the MODEL a SlashCommand tool; here expansion is input-side only |

## Hooks

| Event | Tier | Notes |
|---|---|---|
| PreToolUse | FULL | allow/deny/ask + updatedInput (ask rewrite survives to canUseTool); deny > ask > allow; input carries `tool_use_id` (the old "lacks" note was stale — docs-audit 2026-07-05) |
| PostToolUse | FULL | additionalContext + updatedToolOutput + `continue:false`; input carries `tool_use_id` + `duration_ms` (the old "lacks" note was stale — docs-audit 2026-07-05) |
| PostToolUseFailure | FULL | |
| PostToolBatch | FULL | fires per batch; **P2**: input carries the official `tool_calls[]` (each `{tool_name, tool_input, tool_use_id}`) alongside the deprecated `tool_names`; `continue:false` honored (test engine.test.ts) |
| UserPromptSubmit | FULL | additionalContext appended; a block skips the prompt in streaming mode / ends the run in string mode (one prompt to skip — matches official semantics; P2 re-audit — tests query.test.ts) |
| MessageDisplay | PARTIAL | v0.7: official 5-field incremental protocol emitted (turn_id/message_id/index/final/delta); fires once per completed message (so `final` is always true, `delta` is the whole message), not per true delta; `message_text` kept deprecated |
| Setup / TeammateIdle / TaskCompleted / ConfigChange / WorktreeCreate / WorktreeRemove | TYPED (v0.7) | NEW-IN-DOCS hook events typed into HookEvent/HookInput but typed-not-fired — no natural runtime hook point in a headless engine (no setup phase / teammates / settings-merge engine; worktree + task-completed lifecycles have no honest hook site here) |
| Stop | FULL | fired at natural end of a run. **v0.39**: official BLOCK semantics honored (the pre-0.39 "FULL" overstated — fired but log-only): a `decision: 'block'` PREVENTS the stop, the reason is fed back as a user turn and the loop runs another assistant turn (`stop_hook_active` true on subsequent Stop inputs; the /goal goal-gating primitive); `continue: false` forces the stop and wins over block. ROOT LOOP ONLY — child loops (parentToolUseId set) are governed by SubagentStop, so a goal gate never captures subagents; a stubborn block still honors maxTurns/maxBudgetUsd (test stop-hook-block.test.ts) |
| SessionStart / SessionEnd | FULL | |
| Notification | ACCEPTED | never fired in v0.1 (no code path emits it) |
| SubagentStart / SubagentStop | PARTIAL | fire since v0.2 (the old "never fire" note was stale — docs-audit 2026-07-05); **P2**: SubagentStop now populates the official-required `agent_transcript_path` for a path-backed persisted store (absent for a non-path store — test subagents.test.ts). **v0.18.3**: the official base `transcript_path` (the MAIN session's transcript) is now populated on SubagentStart/Stop too, distinct from `agent_transcript_path` (the subagent's). v0.7: input types gain optional `background_tasks`/`session_crons`/`last_assistant_message` (NEW-IN-DOCS, typed-not-populated — no headless source, keeps this row PARTIAL) |
| PreCompact | FULL | fires on manual `/compact` + auto-compaction since v0.2 (the old "never fires" note was stale — docs-audit 2026-07-05) |
| PermissionRequest | ACCEPTED | never fires in v0.1 |
| `defer` permission decision | FULL | end-to-end since v0.2. v0.7: `deferred_tool_use` carries the official `id`/`name`/`input` field names alongside the deprecated `tool_use_id`/`tool_name`/`tool_input` (dual-track), and the official `stop_reason: "tool_deferred"` IS modeled; an unrecognized `permissionDecision` fails closed as deny (P2 re-audit — effectively full; test tool-types.test.ts) |
| legacy `decision: 'approve'`/`'block'` | FULL | mapped to allow/deny in aggregation (allow only when no explicit `permissionDecision` on the same output) |
| Matcher semantics | FULL | exact-set vs regex rules per docs |
| `async: true` outputs | FULL | fire-and-forget |
| Settings-file shell hooks | UNSUPPORTED | callback hooks only |

## Query methods

| Method | Tier | Notes |
|---|---|---|
| `interrupt()` | FULL | 0.3.205: returns the official `SDKControlInterruptResponse` receipt (`{ still_queued }`) instead of `void`; this engine keeps no uuid-stamped async message queue surviving an abort, so the receipt is always `{ still_queued: [] }`. Source-compatible for callers that ignore the return |
| `setPermissionMode()` / `setModel()` / `setMaxThinkingTokens()` | FULL | |
| `initializationResult()` / `supportedModels()` / `supportedCommands()` / `supportedAgents()` | PARTIAL | P2 re-audit: `supportedModels` returns a real known-model list, `supportedAgents` returns the configured agents, `initializationResult` returns real agents/models/account — all NON-empty. `supportedCommands` REAL since v0.38 (the old "genuinely `[]` — structural" note is retired): built-in `compact` + loaded custom commands in the official `SlashCommand` shape (`name`/`description`/`argumentHint`). Still PARTIAL as a row: official lists the full CC host command set (`/clear`, `/help`, …) that has no engine equivalent here |
| `mcpServerStatus()` | FULL | carries `config` (echoed back) + per-server `tools[]` when connected; **P2**: `scope` now tracked — 'project' (`.mcp.json`) / 'local' (programmatic `options.mcpServers`) / 'dynamic' (added via `setMcpServers`); test query.test.ts. v0.7: `tools` is the official OBJECT array (`{name, description?, annotations{readOnly/destructive/openWorld}?}`), assembled at the registry |
| `accountInfo()` | PARTIAL | apiKeySource only |
| `streamInput()` | FULL | streaming-input mode |
| `close()` | FULL | |
| `rewindFiles()` / `reconnectMcpServer()` / `toggleMcpServer()` / `stopTask()` | FULL | implemented since v0.2. v0.7: `RewindFilesResult` is the official `{canRewind, error?, filesChanged?, insertions?, deletions?}` (unknown ids soft-fail `{canRewind:false, error}` instead of throwing; `insertions`/`deletions` typed-not-populated — no diff engine); deprecated house fields kept |
| `setMcpServers()` | FULL | v0.7: returns the official `{added, removed, errors}` from a real before/after diff (the deprecated `servers` status list rides along one more version) |
| `reinitialize()` / `applyFlagSettings()` | UNSUPPORTED | no control_request wire protocol / no settings engine (N/A-by-design for a direct-API engine) |
