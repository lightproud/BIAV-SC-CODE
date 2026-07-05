# OSS Claude Code Reimplementations — Engine-Mechanics Survey

Research deliverable for `projects/bpt-agent-sdk`. Goal: survey notable open-source Claude Code
reimplementations / compatible agent CLIs and extract the ENGINE MECHANICS that a leaked/reconstructed
system prompt cannot reveal, then map the best designs onto our SDK.

Method: WebSearch + WebFetch (DeepWiki architecture wikis, reverse-engineering blogs, raw source),
plus direct reading of our own `projects/bpt-agent-sdk/src`. Every design below is described in our own
words. No verbatim code was copied. Numbers flagged `[confirmed]` came from source/DeepWiki; `[community]`
came from reverse-engineering write-ups (version-dependent, treat as directional).

---

## 0. License ledger (READ FIRST — this gates what we may reference vs copy)

| Project | Repo | License | Copy code? |
|---|---|---|---|
| **OpenCode** | github.com/sst/opencode (now anomalyco/opencode) | **MIT** | Permissive — reference freely, keep attribution |
| **OpenAI Codex CLI** | github.com/openai/codex | **Apache-2.0** | Permissive (patent grant) — reference freely |
| **Google Gemini CLI** | github.com/google-gemini/gemini-cli | **Apache-2.0** | Permissive — reference freely |
| **Block goose** | github.com/block/goose | **Apache-2.0** [confirmed via LICENSE] | Permissive — reference freely |
| **Cline** | github.com/cline/cline | **Apache-2.0** [confirmed via LICENSE] | Permissive — reference freely |
| **Charmbracelet Crush** | github.com/charmbracelet/crush | **FSL-1.1-MIT** ⚠ | **Source-available, NOT open now** — converts to MIT after 2y. Designs only; do NOT copy code |
| **Claude Code** (reference) | Anthropic, npm `@anthropic-ai/claude-code` | **Proprietary** ⚠ | **Designs only. NEVER copy code.** The 2026 source-map leak does not license reuse |
| Reverse-engineered rebuilds (ruvnet/open-claude-code, Claurst, anon-kode, etc.) | various | mixed / derived-from-proprietary ⚠ | Legally tainted (derived from decompiled Claude Code). Read for ideas, do NOT lift code |

**Good news on copyleft:** none of the major reference targets is GPL/AGPL. The only non-permissive one is
Crush (FSL, source-available). Our discipline of *reimplementing designs in our own words* keeps us clean
across all of them. Small-child analogy: we may look at other kids' finished LEGO castles and learn the
*technique*, but we build our own bricks — and we never photocopy the one castle stamped "do not copy" (Claude Code)
or the one on a 2-year library loan (Crush).

---

## 1. Per-project engine designs

### 1.1 OpenCode — closest architectural cousin, MIT, best single reference

- **Stack/maturity:** TypeScript engine (`packages/opencode/src`) + Go TUI; very mature, active. Provider-agnostic via
  the Vercel AI SDK (`streamText`). Architecturally the closest MIT-licensed analog to Claude Code.
- **(1) Prompt assembly + cache breakpoints** `[confirmed]`: `provider/transform.ts` `ProviderTransform`
  normalizes internal `MessageV2` → `ModelMessage[]`. `applyCaching()` (≈ lines 306–339) places **cache_control on
  the first 2 system messages AND the last 2 messages**; components are merged into **exactly 2 system messages** to
  align with the provider caching boundary. Anthropic path sets `cache_control` at the message level; OpenAI-compatible
  via `providerOptions`. `ProviderTransform.options()` sets `promptCacheKey = sessionID`. So: 2 stable-prefix
  breakpoints + 2 rolling-tail breakpoints.
- **(2) SSE/retry** `[confirmed]`: `session/retry.ts`. `SessionRetry.retryable` = 5xx + rate limits;
  `SessionRetry.delay` = exponential backoff honoring `retry-after` / `retry-after-ms` headers.
  **`ContextOverflowError` is explicitly excluded from retry** to prevent "doom loops." No dedicated idle watchdog found.
- **(3) Session storage** `[confirmed]`: **SQLite + Drizzle ORM** (`bun-sqlite`, WAL, foreign_keys ON) — NOT JSONL.
  `SessionTable` (id, projectID, title, agent, model, tokens, time). Messages stored separately; `MessageV2.page`
  does cursor pagination + part hydration. Assistant message metadata tracks input/output/reasoning/cache_read/cache_write
  tokens + cost. `session-trim.ts` for trimming.
- **(4) Compaction** `[confirmed]`: `session/overflow.ts` + `session/compaction.ts`. Usable limit = window −
  reserved output (default **32000**) − **`COMPACTION_BUFFER` 20000**. Keeps last **2 turns** (`DEFAULT_TAIL_TURNS`).
  Tool output pruned only above **40000 tokens** (`PRUNE_PROTECT`), `PRUNE_MINIMUM` 20000; `skill` tool never pruned;
  media stripped during summary. `SUMMARY_TEMPLATE` = Goal / Constraints / Progress / Key Decisions / Next Steps /
  Critical Context. A `CompactionPart` is injected into a new user message to queue the summarization; boundary emitted.
- **(5) Permissions** `[confirmed]`: values allow/deny/ask. **Evaluation order deny → ask → allow; deny always wins.**
  Pattern match, **last matching rule wins** (put `*` catch-all first). Agent rules take precedence over global. Bash
  matched with globs (`"git *": "allow"`, `"rm *": "deny"`). `read` allow by default but `.env` denied.
- **(6) Model routing:** `session/llm/request.ts` merges global config + agent options + model variants.
- **(7) Truncation/budget:** tool-output prune threshold 40000 tokens (above).
- **(8) Subagents:** `SubtaskPart` recursive agent calls (`message-v2.ts`).
- **(10) Tool loop:** sequential (processor sets `ToolPart` → running → execute). No documented read-only parallelism.
- Sources: DeepWiki `sst/opencode` pages 2.1/2.3/2.4/4.3; opencode.ai/docs/permissions; LICENSE.

### 1.2 Claude Code (Anthropic, proprietary) — the reference target, designs only

Reconstructed from the 2026 source-map leak analyses + community reverse-engineering. **We may mirror the DESIGN, never the code.**

- **(1) Cache breakpoints** `[community]`: Anthropic API allows **up to 4** breakpoints; prefix hierarchy is
  **tools → system → messages** (everything up to and including the marked block is cached). Claude Code splits the
  system prompt at **`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`**: a *stable* section (instructions + tool defs, shareable across
  orgs) vs a *dynamic* tail (project config, git status, timestamps) marked `DANGEROUS_uncachedSystemPromptSection` so
  per-user volatility never busts the shared prefix. The **messages breakpoint slides forward each turn** to include the
  latest assistant response. Deferred tool schemas (ToolSearch) append *after* the breakpoint so toggling a tool doesn't
  invalidate the cached prefix. ("14 tracked cache-break vectors.")
- **(2) SSE/retry** `[community]`: async-generator streaming in `queryLoop()`/QueryEngine.ts; `onStreamingFallback`
  callback retries with an alternative strategy; reactive compaction on prompt-too-long.
- **(3) Session storage** `[community]`: **append-only JSONL** under project-specific paths (`sessionStorage.ts`), with
  `parentUuid` linkage between records; resume/fork rebuild from transcript (`conversationRecovery.ts`); **subagent
  conversations stored as separate "sidechain" transcripts** so child history never inflates the parent;
  **session-scoped permissions deliberately NOT restored on resume/fork** (resumed = fresh permission context). Lock file
  uses `mtime` as a semantic timestamp with rollback on failure.
- **(4) Compaction** `[community]`: a **5-layer cascade of context shapers run before each model call**:
  1. `applyToolResultBudget()` — per-tool-result size cap, oversized replaced by a **content reference** persisted for
     reconstruction on resume;
  2. `snipCompactIfNeeded()` — "Snip," lightweight temporal trim of old history (local, zero cost);
  3. **Microcompact** — dedup/clear old tool results & thinking blocks, cache-aware;
  4. `applyCollapsesIfNeeded()` — "Context Collapse," read-time projection replacing messages with collapsed summaries;
  5. `compactConversation()`/`autoCompact.ts` — the only model-calling tier, a **9-section structured summary**:
     Primary Request & Intent / Key Technical Concepts / Files & Code Sections / Errors & Fixes / Problem Solving /
     All User Messages / Pending Tasks / Current Work / (optional) Next Step. (`sessionMemoryCompact.ts` preserves
     extracted memory separately.)
  `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` (circuit-breaker). Auto trigger ≈ **~92% nominal with a practical cap
  near ~83.5%** in some versions (a ~13K-token buffer before firing, ~20K-token target summary size);
  overridable via `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. Rehydration = boundary marker + summary + re-read recent files +
  todo restore + continuation prompt.
- **(5) Permissions** `[community]`: **7 modes** (plan / default / acceptEdits / dontAsk / bypassPermissions, plus
  internal `auto` ML-classifier and `bubble` subagent-escalation). **Deny-first — order deny → allow → ask**:
  `toolMatchesRule()` checks deny rules before allow, so a broad deny cannot be overridden by a narrow allow.
  **`bashSecurity.ts` has 23 numbered security checks** (blocked Zsh builtins, zero-width-space / IFS null-byte /
  equals-expansion injection defenses from HackerOne reports); command-injection handling **splits each command on
  `&&` / `||` / `|` / `;` and prefix-matches every segment** (a chained command is allowed only if all segments are),
  with a `bashClassifier.ts` LLM intent check supplementing static rules (a deprecated `splitCommand` vs newer parser
  disagree on `\r` tokenization — both still load-bearing).
- **(6) Model routing** `[confirmed docs]`: two slots — **`ANTHROPIC_MODEL`** (main) + **`ANTHROPIC_SMALL_FAST_MODEL`**
  (a **Haiku** for background chores: conversation titles, summarization helpers, topic/quota classification, trivial
  main-loop work). `opusplan` = Opus in plan mode, Sonnet in execution. Safety-classifier flag → re-run on default Opus.
  `fallbackModel`; `MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3` escalated-output retries.
- **(7) Truncation** `[confirmed community]`: Bash validation threshold **30000 chars**, file reads **2000 lines** max;
  per-tool-result budgets with exempt tools (`maxResultSizeChars` non-finite).
- **(8) Subagents** `[community]`: **three models — Fork, Teammate, Worktree.** Fork copies parent context as
  **byte-identical**, so "spawning 5 agents costs barely more than 1" (shared prompt cache). `AgentTool` built via the
  same `buildTool()` factory; children run in **isolated context** and **return only summary text**; session perms not
  restored for children.
- **(9) Replay/workflow** `[confirmed]`: Claude Code shipped a **Workflows engine** — the model **writes a JS
  orchestration script**, and a runtime executes it in the background across many agents with **journaling +
  deterministic resume** (each run's script is saved under `~/.claude/projects/`, so it can be read, diffed against a
  prior run, edited, and re-executed deterministically). A real deterministic-replay orchestration engine.
- **(10) Tool loop** `[confirmed]`: **`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` default 10.** `StreamingToolExecutor`
  runs **read-only tools in parallel, serializes state-modifying tools**, uses **path-overlap detection** for file tools,
  buffers results and **emits them in request order**, and a sibling abort controller kills in-flight subprocesses on a
  Bash error. Async generator yields tool completions as they finish.
- Sources: alex000kim.com source-leak post; claudefast/sabrina.dev/wavespeed/engineerscodex leak analyses;
  decodeclaude.com/compaction-deep-dive; 0xtresser Claude-Code-VS-OpenCode book; platform.claude.com prompt-caching docs;
  Claude Code parallel-tool docs.

### 1.3 OpenAI Codex CLI — Apache-2.0, Rust, sandbox is the standout

- **Stack:** Rust workspace (codex-core, codex-tui, codex-exec, codex-mcp-server…). Mature.
- **(2) Streaming/watchdog** `[confirmed]`: **provider-configurable idle timeout `stream_idle_timeout`** (a real
  stall watchdog between SSE events), `COMPACT_REQUEST_TIMEOUT_IDLE_MULTIPLIER = 4`, `RESPONSE_STREAM_CHANNEL_CAPACITY =
  1600`; 401 → auth recovery, 426 → fall back to HTTP transport; 429/5xx delegated to the `codex_api` crate.
- **(1) Caching:** no `cache_control` (OpenAI Responses API) — relies on the **automatic prefix cache** (≥1024 tokens,
  byte-exact) + `prompt_cache_key = conversation id` on every request; the loop is deliberately **append-only/linear**
  (never edits earlier items, so the exact-prefix match holds). ~85–95% reported hit rate.
- **(3) Storage** `[confirmed]`: **rollout files** = append-only **JSONL event streams** (`RolloutRecorder`),
  `SESSIONS_SUBDIR` / `ARCHIVED_SESSIONS_SUBDIR`. Resume replays events; **fork** truncates via
  `TruncateBeforeNthUserMessage`. `agent-graph-store` persists parent/child thread topology.
- **(4) Compaction** `[confirmed]`: auto-trigger ≈ effective_window − **13,000 tokens** (effective_window = model_window
  − min(max_output, 20,000)); user override `model_auto_compact_token_limit` clamped to 90%. Two tiers: **Session-Memory
  Compact** (substitute structured memory, no LLM call — common path) then proprietary **`POST /v1/responses/compact`**
  returning a `type=compaction` item; full history replaced by the handoff summary.
- **(7) Truncation** `[confirmed]`: hard cap **256 lines OR 10 KiB, whichever first**, head+tail (first 128 + last 128),
  middle elided; configurable via `tool_output_token_limit`.
- **(5) Permissions/sandbox** `[confirmed]` — the best OSS sandbox design: `ExecPolicyManager` matches prefix +
  blacklist rules from `.rules`; `AskForApproval` = Never / OnFailure / OnRequest / Granular. **OS-level sandbox**:
  macOS Seatbelt (dynamically generated SBPL via `sandbox-exec`), Linux **bubblewrap** (namespace isolation
  `--unshare-user/pid/net`, read-only binds) + **Landlock/seccomp**. `.git`/`.agents`/`.codex` forced read-only even in
  write mode. `apply_patch` runs in a subprocess (`--codex-run-as-apply-patch`) with `assess_patch_safety`.
- **(8) Subagents** `[confirmed]`: `SpawnAgentHandlerV2` + `ThreadManager` (spawn / resume / fork); role overlay
  (explorer/reviewer) as a high-precedence `ConfigLayerStack` layer; children keep own history but share
  AuthManager/ModelsManager/McpManager.
- **(10) Tool loop:** sequential via `ToolOrchestrator` (one tool at a time through approval+sandbox).
- Sources: DeepWiki `openai/codex` (5.5/5.6/5.7/3.6/3.8); source excerpts via subagent.

### 1.4 Google Gemini CLI — Apache-2.0, TS — cleanest retry + compaction constants

- **Stack:** TypeScript/Node ≥20, npm monorepo `packages/`. Uses `@google/genai` SDK.
- **(2) Retry** `[confirmed]` — the most explicit backoff spec found: `DEFAULT_MAX_ATTEMPTS = 10`, `initialDelayMs
  5000`, `maxDelayMs 30000`, delay `= min(maxDelay, delay*2)`, **jitter ±30%** (quota errors +0–20% only). Retries
  429/499/5xx, **excludes 400**. `retryDelayMs` acts as a floor; `onPersistent429` → fallback model resets the attempt
  counter. `geminiChat.ts` also does mid-stream retry (max 4) on API disconnects/malformed chunks.
- **(3) Storage** `[confirmed]`: **JSONL** under `chats/` keyed by UUID + `projectHash`; `ConversationRecord`
  (sessionId, projectHash, model, MessageRecord[]) + `SessionInfo` (times, messageCount, displayName, AI `summary`);
  **shadow git repo** for checkpoints (`createFileSnapshot()` commits workspace changes per turn). `--resume`
  latest/index/uuid; **`$rewindTo` record appended to truncate conversation on reload** (elegant append-only rewind).
- **(4) Compaction** `[confirmed]`: `chatCompressionService.ts`. `DEFAULT_COMPRESSION_TOKEN_THRESHOLD = 0.5` (fires at
  **50%** of window — conservative), `COMPRESSION_PRESERVE_THRESHOLD = 0.3` (keep last **30%** verbatim, summarize the
  older 70%), `COMPRESSION_FUNCTION_RESPONSE_TOKEN_BUDGET = 50000` for tool outputs in the preserved tail.
  `findCompressSplitPoint()` forces the cut at a **user-role boundary, never inside a tool call/response pair.**
- **(5) Permissions** `[confirmed]`: modes `plan < default < autoEdit < yolo`. A **priority-tiered policy engine** (not
  ordered lists): `final_priority = tier_base + toml_priority/1000`, tiers Default 1 / Extension 2 / Workspace 3 / User 4
  / Admin 5, highest wins; decisions allow / ask_user / deny; **in headless mode `ask_user` auto-downgrades to DENY**.
  Folder-trust (TOFU) gates project settings; sandbox via Docker/Podman/macOS seatbelt profiles (`SandboxManager`).
- **(6) Model routing** `[confirmed]`: three strategies — **Override** (hardcoded per agent/retry), **Classifier** (an
  LLM rates task complexity → flash for simple, pro for complex), **Fallback** (quota/error reroute, `resolvePolicyChain`
  downgrade chains). Models pro / flash / flash-lite.
- **(8) Subagents** `[confirmed]`: `LocalAgentExecutor` runs each subagent with **fresh isolated registries** (no cross-
  agent bleed, parent history NOT shared); returns a **single consolidated summary**.
- Sources: DeepWiki `google-gemini/gemini-cli` (4.4/4.5/4.12/3.9/5.5/5.6/3.11); source excerpts via subagent.

### 1.5 Block goose — Apache-2.0, Rust — Recipe workflow engine + LLM permission judge

- **Stack:** Rust; SQLite via `sqlx`. Mature.
- **(4) Compaction** `[confirmed]`: `check_if_compaction_needed()` fires when `current_tokens/context_limit > 0.8`
  (default **80%**), before each LLM call, or on `ProviderError::ContextLengthExceeded`. `TokenCounter` uses tiktoken
  `o200k_base` with a 10000-entry LRU. `do_compact()` does **progressive tool-response filtering at 0/10/20/50/100%**
  with **middle-out removal** (keep early + recent, drop the middle). Visibility restructuring: originals become
  user-visible only, the summary agent-visible only, plus a continuation primer.
- **(5) Permissions** `[confirmed]`: modes Auto / Approve / **SmartApprove** / Chat. SmartApprove uses an **LLM-based
  `PermissionJudge` classifier** (reads/lists/SELECTs auto-approved). Per-tool overrides AlwaysAllow / AskBefore /
  NeverAllow. Precedence: env `GOOSE_MODE` > config.yaml > runtime. Dedicated prompt-injection-detection subsystem.
- **(6) Model routing:** compile-time **Canonical Models registry (~1700 models)** for capability discovery.
- **(9) Workflow** `[confirmed]` — the standout: **Recipe Engine** executes declarative **YAML workflows via minijinja
  templates** — the clearest OSS example of deterministic, reusable orchestration.
- Sources: DeepWiki `block/goose` (4.6/6.2/6.4); Cargo.toml; canonical_models.json.

### 1.6 Cline — Apache-2.0, TS — git-shadow checkpoints + Plan/Act + one-tool-per-message

- **Stack:** TypeScript VS Code extension, now a monorepo with a `ClineCore` SDK (`sdk/packages/core`). Mature.
- **(3) Checkpoints** `[confirmed]`: **git shadow-repo snapshots** for workspace diff/rollback
  (`checkpointRestore.ts`, `DiffViewProvider`, `sdk-checkpoints.ts`) — restore any prior turn's file state.
- **(4) Context** `[confirmed]`: `CONTEXT_WINDOW_WARNING_THRESHOLD_PERCENT = 50`; **truncation, not summarization** —
  always keep the first task message + recent exchanges, remove middle progressively; **dedup repeated file reads →
  "compact notices."**
- **(5) Permissions:** `CommandPermissionController` + `ClineIgnoreController`; "YOLO mode" toggle bypasses approvals.
- **(6) Model routing:** Plan vs Act modes can use different models (per-mode routing).
- **(10) Tool loop:** the well-known **one-tool-per-message** discipline (ToolExecutor routes a single tool-use block per
  assistant turn) — simpler and safer but higher latency than Claude Code's parallel batching.
- Sources: DeepWiki `cline/cline`; direct clone (LICENSE = Apache-2.0; retry.ts, checkpoints dir, sdk/packages).

### 1.7 Crush (Charmbracelet) — FSL-1.1-MIT ⚠ — designs only

Go, SQLite + sqlc, `Coordinator` managing named agents (Coder + Task sub-task delegation), Fantasy LLM-provider
abstraction, pub/sub bus. Instructive for a clean provider-abstraction + persistence split, but **source-available (not
open) — read for ideas, do not copy.** Source: github.com/charmbracelet/crush; DeepWiki.

### 1.8 Also-noted (not deep-dived)

ruvnet/open-claude-code (rebuild from decompile — tainted), Claurst (Rust clean-room, multi-provider), anon-kode
(OpenAI-API terminal koder), Claw Code (Rust+Python early prototype), yasasbanukaofficial/claude-code &
chauncygu/collection (mirror the leaked skeleton — tainted). Useful as idea maps; avoid lifting code from anything
derived from the leak.

---

## 2. Gap-by-gap synthesis — best OSS design per mechanic

1. **Prompt assembly + cache breakpoints** — *Best: Claude Code's stable/dynamic split; cleanest permissive copy: OpenCode.*
   Two-tier design: a **stable prefix** (tools + static system) cached once and shared across turns/sessions, and a
   **dynamic tail** (cwd, git, timestamps) kept OUT of the cached prefix. Put a rolling breakpoint on the last message so
   each turn extends the cache to include the latest assistant reply. OpenCode's "first-2 + last-2" 4-breakpoint layout
   is the concrete MIT reference.
2. **SSE + retry + watchdog** — *Best backoff spec: Gemini CLI. Best stall watchdog: Codex.* Gemini: exp backoff ×2,
   jitter, `retry-after` floor, retry 429/499/5xx not 400, fallback-model on persistent 429. **Codex adds the missing
   piece: a per-stream idle timeout** that aborts a stalled SSE connection between events (nobody else has this cleanly).
   Universal rule (OpenCode): **never retry a context-overflow error** (doom-loop guard).
3. **Session storage + resume** — *Two valid schools.* JSONL append-only (Claude Code, Codex rollouts, Gemini) = simple,
   auditable, crash-safe, greppable, and enables **append-only rewind** (Gemini's `$rewindTo` sentinel). SQLite (OpenCode,
   goose, Crush) = pagination + rich token/cost metadata. For an SDK, **append-only JSONL wins on simplicity + fork/resume
   via replay.** Claude Code's **sidechain transcripts** (subagent history in separate files) is the key idea to preserve
   parent context.
4. **Compaction** — *Best layered design: Claude Code's 5-tier cascade. Best explicit constants: Gemini + OpenCode + goose.*
   The insight: **no single strategy fits all pressure** — cheap local tiers first (per-result budget → temporal snip →
   tool-result dedup/microcompact), model summarization only as last resort. Concrete knobs to steal: OpenCode's reserved-
   output + safety-buffer math; Gemini's user-role split point + tool-output budget; goose's progressive 0/10/20/50/100%
   tool-response filtering with middle-out removal.
5. **Permissions** — *Best precedence model: Claude Code / OpenCode deny-first (deny → ask → allow, deny always wins).*
   *Best sandbox: Codex* (Seatbelt/bubblewrap/Landlock, forced-read-only critical dirs). *Best bash safety: Claude Code's
   `bashSecurity.ts`* — decompose a command on `&&`/`||`/`;`/pipes and prefix-match each sub-command, so
   `git status && rm -rf /` can't ride in on a `git *` allow.
6. **Model routing** — *Best: Claude Code.* Cheap/background model for summarization & titles; `fallbackModel` with a
   bounded recovery count; per-subagent model. Gemini's `onPersistent429 → fallback` and Cline's per-mode model are
   simpler variants.
7. **Tool-result truncation + budget** — *Best: Claude Code's per-result budget with a persisted content-reference* (swap
   an oversized result for a pointer, keep the full bytes on disk, rehydrate on resume) — this feeds compaction tier 1.
   Concrete caps: Bash 30000 chars, Read 2000 lines (Claude Code); tool-output budgets 40000 (OpenCode) / 50000 (Gemini).
8. **Subagent / fork** — *Best: Claude Code's three modes* — **Fork** (byte-identical inherited context, shared prompt
   cache → cheap fan-out), **Teammate**, **Worktree** (isolated). Universal: children return **summary-only**, keep their
   transcript on a **sidechain**. Codex's role-overlay `ConfigLayerStack` is a clean way to parameterize a subagent.
9. **Deterministic replay / workflow** — *Two shapes.* **Authored workflows: goose Recipe Engine** (declarative YAML +
   minijinja) and **Claude Code Workflows** (model writes a JS orchestration script, journaled for deterministic resume,
   script saved to disk so it can be diffed/edited/re-run). **State-reconstruction replay: Codex rollouts** (replay the
   JSONL event stream to rebuild exact state). Gemini and most others have nothing here.
10. **Tool loop (parallel / read-only batching)** — *Best: Claude Code.* Concurrency cap (`MAX_TOOL_USE_CONCURRENCY`=10),
    **read-only tools parallel / mutating tools serialized**, **path-overlap detection** for file writes, results **emitted
    in request order**, sibling-abort on error. Cline's one-tool-per-message is the safe-but-slow opposite.

---

## 3. Mapping to bpt-agent-sdk (what we already do; what to adopt)

Verified by reading `projects/bpt-agent-sdk/src`. "You verify" = confirm before acting.

| # Mechanic | Our SDK today | Gap vs best OSS | Adopt (reimplement — license note) |
|---|---|---|---|
| 1 Cache breakpoints | **Strong.** `engine/cache-control.ts` places ≤3 breakpoints (last tool, system, last message) + a `'first'/'last'/'preserve'` stable-vs-cwd system split; rolling last-message breakpoint | Only ~parity. Could use the 4th breakpoint; our stable/volatile split already mirrors Claude Code's `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` | Minor: consider a 2nd system breakpoint (stable + dynamic) to use all 4 slots. Design ref: OpenCode (MIT) |
| 2 SSE/retry/watchdog | **Good retry**, `transport/anthropic.ts`: base 1s ×2, jitter [0.5,1], max 60s, retry-after, max 4, never retry mid-stream, 600s per-request timeout. `transport/sse.ts` robust framing | **Missing: idle/stall watchdog** between SSE events. A hung-but-open stream only trips the 600s whole-request timeout | **Adopt Codex's `stream_idle_timeout`** — reset a short timer on each event; abort+retry (pre-first-event only) on idle. Reimplement; Codex Apache-2.0 |
| 3 Session storage + resume | **Strong.** `sessions/store.ts` append-only JSONL (meta + messages); `sessions/checkpoints.ts` pre-image blob store + rewind; resume/continue/fork in `query.ts` | No `parentUuid` record linkage; subagents don't persist sidechain transcripts | Add **parentUuid linkage** + optional **sidechain transcript** per subagent (Claude Code design; describe-only). Gemini's `$rewindTo` sentinel is a nice conversation-rewind option (Apache-2.0) |
| 4 Compaction | **Good summary tier.** `engine/compaction.ts`: threshold 0.85, keepRatio 0.3, minRecentTurns 2, pairing-preserving partition, deterministic OR API fold, PreCompact veto, boundary emission | **Single-tier.** No cheap pre-tiers: no per-tool-result budget, no temporal snip, no tool-result dedup/microcompact | **Adopt the cascade:** add (a) per-tool-result budget→content-reference, (b) tool-result dedup/microcompact BEFORE model summarization. Refs: Claude Code (design), OpenCode/goose (permissive) |
| 5 Permissions + bash | **Solid gate.** `permissions/gate.ts` deny-first multi-stage; `rules.ts` prefix match on primary arg; `classifier.ts` auto (readonly→allow else prompt) | **Missing bash decomposition.** A `Bash(...)` specifier matches the whole command string; no split on `&&`/`||`/`;`/pipe → prefix-allow can be smuggled past | **Adopt Claude Code's `bashSecurity` decomposition** (split + per-subcommand match). Optional: OS sandbox à la Codex for Bash. Designs only |
| 6 Model routing | **Partial.** `subagents/agents.ts` aliases opus/sonnet/haiku/fable/inherit; live `setModel`; `fallbackModel` on first-attempt 429/5xx | Compaction summary uses `config.model`, not a cheap model | **Route summarization/title to Haiku** (add `compaction.model`); we already have the alias machinery. Claude Code design |
| 7 Truncation/budget | **Good caps.** Bash 30000 chars, Read 2000 lines, Glob 100, Grep head_limit 250; `tokens.ts` estimate + `pricing.ts` + `maxBudgetUsd` | No per-tool-result budget with persisted reference/rehydration | Ties to #4: **content-reference on oversized tool_result**, rehydrate on resume. Claude Code design |
| 8 Subagent/fork | **Good isolation.** `subagents/agent-tool.ts` fresh isolated context, general-purpose fallback, depth 5, background, summary-only | No **fork-with-inherited-context** (cache-shared cheap fan-out); no sidechain persistence | Add a **Fork mode** (clone parent history + share prompt cache) alongside current fresh mode. Claude Code design |
| 9 Replay/workflow | **None** | No declarative workflow engine | Optional/low priority: a **goose-style YAML recipe** runner if we ever want reproducible pipelines. Apache-2.0 |
| 10 Tool loop | **Sequential** (`engine/loop.ts` executes tool_use blocks in content order) | **No read-only parallelism.** Slower multi-tool turns | **Adopt concurrent read-only batching:** run `readOnly` tools via `Promise.all` up to a concurrency cap, serialize mutating tools, path-overlap guard, emit in request order. We already tag tools `readOnly`. Claude Code design (describe-only) |

---

## 4. Ranked highest-value engine designs to adopt (value ÷ effort)

1. **Concurrent read-only tool batching (Gap 10).** *High value, low effort.* Our tools already carry `readOnly`;
   `engine/loop.ts` just needs a batched `Promise.all` path (cap ~10) + serialize mutators + emit in order. Biggest
   latency win per line of code. Design: Claude Code (describe-only).
2. **SSE idle/stall watchdog (Gap 2).** *High value, low effort.* Add a per-event idle timer in `transport/anthropic.ts`;
   abort a silently-hung stream instead of waiting 600s. Design: Codex `stream_idle_timeout` (Apache-2.0).
3. **Bash command decomposition for permissions (Gap 5).** *High value, low-med effort, security-critical.* Split on
   `&&`/`||`/`;`/`|` and prefix-match each sub-command in `permissions/rules.ts` before allowing. Closes a real
   allow-rule-smuggling hole. Design: Claude Code `bashSecurity` (describe-only).
4. **Compaction pre-tiers: per-result budget + tool-result dedup (Gaps 4+7).** *High value, med effort.* Insert cheap
   local tiers before the model-summary fold so we shed bytes without paying for a summary. Design: Claude Code cascade
   (describe-only) + OpenCode/goose constants (MIT/Apache).
5. **Route summarization to a cheap model (Gap 6).** *Med value, low effort.* Add `compaction.model` defaulting to Haiku;
   reuse existing alias resolution. Design: Claude Code.
6. **Subagent Fork mode + sidechain transcripts (Gaps 8+3).** *Med value, med effort.* Cheap fan-out via inherited
   cache-shared context; persist child transcripts separately. Design: Claude Code (describe-only).
7. **Use the 4th cache breakpoint / dual system breakpoint (Gap 1).** *Low-med value, low effort.* We're near parity;
   splitting system into stable+dynamic breakpoints squeezes a bit more cache reuse. Design: OpenCode (MIT).
8. **`$rewindTo`-style conversation rewind (Gap 3).** *Low value, low effort, nice-to-have.* Append-only conversation
   rewind sentinel to complement our file-checkpoint rewind. Design: Gemini CLI (Apache-2.0).
9. **Declarative workflow/recipe engine (Gap 9).** *Low value for an SDK, high effort.* Defer unless a reproducible-
   pipeline use case appears. Design: goose Recipe Engine (Apache-2.0).

**Bottom line:** our SDK is already mature and covers 8 of 10 mechanics at good quality. The clear wins are (1) parallel
read-only tools, (2) an SSE idle watchdog, and (3) bash-command decomposition in permissions — all low-effort, all
reimplementable from permissively-licensed or describe-only designs, none requiring any copyleft or proprietary code.

---

## 5. Source URLs

- OpenCode: https://github.com/sst/opencode · https://deepwiki.com/sst/opencode/{2.1,2.3,2.4,4.3} · https://opencode.ai/docs/permissions/ · https://github.com/sst/opencode/blob/HEAD/LICENSE
- Claude Code internals: https://alex000kim.com/posts/2026-03-31-claude-code-source-leak/ · https://claudefa.st/blog/guide/mechanics/claude-code-source-leak · https://www.sabrina.dev/p/claude-code-source-leak-analysis · https://wavespeed.ai/blog/posts/claude-code-architecture-leaked-source-deep-dive/ · https://read.engineerscodex.com/p/diving-into-claude-codes-source-code · https://decodeclaude.com/compaction-deep-dive/ · https://0xtresser.github.io/Claude-Code-VS-OpenCode/ · https://arxiv.org/html/2604.14228v1 · https://platform.claude.com/docs/en/build-with-claude/prompt-caching · https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use
- Codex CLI: https://github.com/openai/codex · https://deepwiki.com/openai/codex (5.5/5.6/5.7/3.6/3.8)
- Gemini CLI: https://github.com/google-gemini/gemini-cli · https://deepwiki.com/google-gemini/gemini-cli (4.4/4.5/4.12/3.9/5.5)
- goose: https://github.com/block/goose · https://deepwiki.com/block/goose (4.6/6.2/6.4)
- Cline: https://github.com/cline/cline · https://deepwiki.com/cline/cline
- Crush: https://github.com/charmbracelet/crush · https://deepwiki.com/charmbracelet/crush
- Context-compaction comparisons: https://codex.danielvaughan.com/2026/04/14/context-compaction-deep-dive-codex-cli-claude-code-opencode/ · https://www.x-cmd.com/blog/260617/
- Ecosystem/leak overviews: https://github.com/ruvnet/open-claude-code · https://github.com/chauncygu/collection-claude-code-source-code · https://dev.to/kolkov/we-reverse-engineered-12-versions-of-claude-code-then-it-leaked-its-own-source-code-pij · https://github.com/anthropics/claude-agent-sdk-typescript/issues/57
