/**
 * Silver Core SDK 公开类型面 — query() 选项面。
 *
 * 自 src/types.ts 按其自带的分节切出（结构审视 P7，2026-07-27）：切分依据是文件
 * 原本就标好的分节注释，不是新发明的边界。src/types.ts 保留为 barrel，所有
 * `from '../types.js'` 的既有 import 一行未动。
 *
 * 溯源与合规声明见 src/types.ts 头注（clean-room，仅据公开文档）。
 */

import type { HookCallbackMatcher, HookEvent } from './hooks.js';
import type { AgentDefinition, McpServerConfig } from './mcp.js';
import type { CanUseTool, PermissionMode } from './permissions.js';
import type { ProviderConfig, SandboxOptions, SubagentTransportResolver, ThinkingConfigParam } from './provider.js';
import type { CompactionOptions, ElicitationHandler, GoalConfig, LoopStopProposal, OutputFormatConfig, ResilienceOptions, SessionStore, StructuredPrelude, UserQuestionHandler, WebSearchHandler } from './subsystems.js';
import type { SDKBackgroundEvent } from './messages.js';
import type { ToolChoice } from './wire.js';
import type { Readable, Writable } from 'node:stream';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SettingSource = 'user' | 'project' | 'local';
// Default semantics (bump-pin ruling 2026-07-05, keeper "确定升钉了"): an OMITTED
// `settingSources` loads user+project+local — matching official Claude Code /
// the live @anthropic-ai/claude-agent-sdk docs. This FLIPPED the earlier
// pinned-0.3.199 default (omitted = load nothing); it was the last behavior-
// level NEW-IN-DOCS hold, gated behind the up-pin because a default flip
// diverges from the pinned conformance arm. An explicit array — including `[]`
// — is honored verbatim: `[]` is the explicit opt-OUT. Resolver:
// internal/setting-sources.ts (single source of truth).

/**
 * One segment of a caller-composed system prompt (`systemPrompt` segments
 * form). The caller owns WHAT each segment contains and its ORDER; `cache:
 * true` asks the engine to place a prompt-cache breakpoint at that segment's
 * end. This is the generic seam a host uses to inject its OWN layered prompt
 * (e.g. built-in core -> team -> user -> project) and still get optimal
 * caching — the engine only decides WHERE the wire-level cache breakpoints go,
 * never what the layers are or where they come from. Order segments
 * stability-descending (most-shared first) so the cached prefix is reused
 * across the widest set of requests. Up to 3 cached segments are honored
 * (the 4th API breakpoint is reserved for the tool schemas); extras are
 * dropped from the least-shared end with a debug warning.
 */
export type SystemPromptSegment = {
  text: string;
  cache?: boolean;
  /**
   * BPT-EXTENSION (prompt-composition, 2026-07-09): an optional human label for
   * this layer (e.g. 'core' / 'team' / 'memory'). Metadata only — it is NEVER
   * serialized onto the wire; it flows through solely so the prompt-composition
   * breakdown (Options.includePromptComposition) can attribute this segment's
   * tokens to the caller's own bucket.
   */
  label?: string;
};

/** Official plugin config (Options.plugins element). ACCEPTED-IGNORED in this
 *  SDK: no plugin loader exists; typed so drop-in callers compile. */
export type SdkPluginConfig = {
  type: 'local';
  path: string;
  skipMcpDiscovery?: boolean;
};

/** Official built-in-tool behavior config (Options.toolConfig).
 *  ACCEPTED-IGNORED in this SDK: the SDK itself renders nothing — option
 *  `preview` fragments ARE accepted and forwarded to the host handler
 *  (2026-07-28 ruling), but this format hint has no SDK-side consumer. */
export type ToolConfig = {
  askUserQuestion?: {
    previewFormat?: 'markdown' | 'html';
  };
};

/** Official options handed to a custom spawnClaudeCodeProcess function.
 *  N/A-by-design here (this SDK spawns no CLI subprocess); typed for drop-in
 *  compatibility only. */
export interface SpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}

/** Official custom-spawn process handle (ChildProcess satisfies it).
 *  N/A-by-design here; typed for drop-in compatibility only. */
export interface SpawnedProcess {
  stdin: Writable;
  stdout: Readable;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal: NodeJS.Signals): boolean;
  on(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  on(event: 'error', listener: (error: Error) => void): void;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  once(event: 'error', listener: (error: Error) => void): void;
  off(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  off(event: 'error', listener: (error: Error) => void): void;
}

/**
 * BPT-EXTENSION: tunable Read output limits (spec 2026-07-06). The MECHANISM
 * (total-char cap on a line boundary, a footer that reflects the cap, per-line
 * truncation markers, the Grep hint) lives in the SDK; only the NUMBERS are the
 * caller's. Both default when omitted (50000 total chars / 2000 per line).
 */
export type ReadLimits = {
  /** Total characters one Read returns before truncating on a line boundary. */
  maxOutputChars?: number;
  /** Characters kept per line before the per-line truncation marker. */
  maxLineChars?: number;
};

/**
 * BPT-EXTENSION: tunable Bash output limits, symmetric with ReadLimits
 * (2026-07-28 alignment audit — the cap used to be a hard-coded 30000 with no
 * knob, half of the official two-tier design: Claude Code defaults to 30000
 * and allows raising to 150000 via BASH_MAX_OUTPUT_LENGTH). Resolution order:
 * this option, then the BASH_MAX_OUTPUT_LENGTH env var, then 30000 — every
 * source clamped to the official 150000 ceiling.
 */
export type BashLimits = {
  /** Total characters one Bash call returns (tail-kept; the dropped-chars
   *  marker leads the output). Clamped to [1, 150000]. */
  maxOutputChars?: number;
};

/**
 * Client-side storage contract for the memory tool (BPT-EXTENSION, memory
 * system spec R3): the injection point that keeps memory data entirely in the
 * hosting application's hands — the SDK defines the contract and never knows
 * the storage medium. Paths are virtual (`/memories[/...]`) and arrive
 * SDK-validated (spec R4); implementations must still not trust them (defense
 * in depth). Each method returns the reference result string, or throws an
 * Error whose message is the reference error string.
 *
 * Prefer implementing the storage primitives (`MemoryFileOps`) and wrapping
 * them with `createMemoryStore()` — that inherits the byte-exact reference
 * formats. Validate any implementation with `runMemoryStoreContractSuite()`.
 */
export interface MemoryStore {
  view(path: string, viewRange?: [number, number]): Promise<string>;
  create(path: string, fileText: string): Promise<string>;
  strReplace(path: string, oldStr: string, newStr: string | undefined): Promise<string>;
  insert(path: string, insertLine: number, insertText: string): Promise<string>;
  delete(path: string): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<string>;
  /**
   * OPTIONAL host-facing raw accessor (BPT-EXTENSION, testbed gap G4,
   * 0.71.0): the exact stored content of an EXISTING file — no header, no
   * line numbers, no truncation. NOT one of the six model-facing memory
   * commands (models keep using view); embedders that read their own memory
   * writes back previously had to strip view's reference decoration or drop
   * to the FileOps primitive layer. Engine-built stores (createMemoryStore /
   * createLocalFilesystemMemoryStore) implement it; custom implementations
   * may omit it — consumers feature-detect.
   */
  read?(path: string): Promise<string>;
}

/**
 * One memory mount declaration (BPT-EXTENSION, memory governance spec S1):
 * a virtual subtree under `/memories` this query may touch, with its rights.
 * Mounts are per-query — the embedder instantiates them from its own session
 * context (e.g. `/memories/team` read-only + `/memories/users/<id>` read-write
 * for a user session; `/memories/team` read-write for a synthesis batch task).
 */
export type MemoryMount = {
  /** Virtual path under /memories (e.g. '/memories/team'). Trailing slashes
   *  are tolerated; an invalid path is a ConfigurationError at query(). */
  path: string;
  mode: 'read-only' | 'read-write';
};

/**
 * Memory system configuration (BPT-EXTENSION; docs/MEMORY.md). Presence of
 * the object enables the `memory` tool (set `enabled: false` to keep a shared
 * options spread but switch the system off).
 */
/**
 * Run-signal ledger options (self-improvement spec SCS-REQ-002 loop 1 /
 * REQ-1.1; see src/reporting/run-log.ts for the record contract).
 */
export type RunLogOptions = {
  /** Directory for the runlog-{YYYY-MM-DD}.jsonl day files (created on demand). */
  dir: string;
  /** Workload tag stamped on every record of this query (e.g. 'coding' /
   *  'non-coding'); the report's top-consumer split keys on it. */
  scenario?: string;
};

export type MemoryOptions = {
  /** Default true when the object is present. */
  enabled?: boolean;
  /**
   * Storage implementation. Default: a local-filesystem store rooted at
   * `<cwd>/.claude/memory/memories` (development / single-machine use).
   */
  store?: MemoryStore;
  /**
   * Base directory for the DEFAULT local store (ignored when `store` is
   * given); the memory root is `<baseDir>/memories`.
   */
  baseDir?: string;
  /**
   * Tool assembly mode (spec R2). 'native' declares the official
   * `{ type: 'memory_20250818', name: 'memory' }` entry and lets the API
   * inject the definition + protocol prompt (Anthropic protocol only);
   * 'custom' advertises an SDK-defined equivalent tool and injects the
   * protocol prompt SDK-side (any protocol). Default: by transport protocol —
   * anthropic -> 'native', openai-chat -> 'custom'. Forcing 'native' on an
   * openai-chat provider is a configuration error (query() throws).
   */
  mode?: 'native' | 'custom';
  /** `create` on an existing file overwrites instead of erroring (the
   *  reference behavior; spec R1 opt-in). Default false. */
  createOverwrite?: boolean;
  /**
   * Memory scope routing (governance spec S1): the subtrees this query may
   * touch and with what rights, enforced at the SDK tool layer (never via
   * prompt discipline). Writes outside a read-write mount and any access
   * outside every mount are rejected with structured errors; a strict
   * ancestor directory of a mount stays viewable for navigation with its
   * listing filtered to mount-visible entries. Omit for unrestricted
   * access to the whole /memories tree (pre-S1 behavior); an empty array is
   * a ConfigurationError. The resident index (R6) is only injected when
   * `/memories/MEMORY.md` is readable under the mounts.
   */
  mounts?: MemoryMount[];
  /**
   * Resident memory index (spec R6): at session start the harness reads the
   * head of `/memories/MEMORY.md` (when it exists) into the system prompt so
   * the index survives context resets without a tool round-trip. `false`
   * disables; defaults: maxLines 200, maxBytes 25600 — first limit hit wins.
   */
  indexInjection?: false | { maxLines?: number; maxBytes?: number };
  /** Extra consumer guidance appended after the protocol prompt in 'custom'
   *  mode (e.g. "Only record information relevant to <topic>."). */
  instructions?: string;
  /**
   * Governance limits (spec R8). Defaults: maxFileBytes 65536,
   * maxFilesPerDirectory 64, maxViewChars 16000 (view output beyond this is
   * truncated on a line boundary with a view_range pagination hint). Byte and
   * file-count limits are enforced in the store engine (createMemoryStore /
   * the built-in local store); view truncation and the create-size cap are
   * ALSO enforced at the tool layer, so they hold for directly-implemented
   * MemoryStore injections too.
   */
  limits?: {
    maxFileBytes?: number;
    maxFilesPerDirectory?: number;
    maxViewChars?: number;
  };
  /**
   * Frontmatter memory schema (keeper ruling 2026-07-29, T75 r1 §一):
   * 'frontmatter' requires every written memory file to begin with the
   * official Claude Code memory frontmatter head — required `name` and
   * one-line `description` (<= 150 chars), `metadata.type` in
   * user | feedback | project | reference, optional `metadata.pinned`.
   * Invalid content is rejected with a structured error that restates the
   * format and the delete+create migration path. Also injects the official
   * memory-instructions guidance (when_to_save / body_structure per type)
   * into the system tail, and is the hard prerequisite for `attachment`.
   * Omit for free-form writing. The resident index /memories/MEMORY.md is
   * exempt. (The former 'cards' mode was retired in 2.0.0 — cards was a
   * BPT-EXTENSION, not a Claude memory shape; see docs/MEMORY.md migration
   * notes.)
   */
  schema?: 'frontmatter';
  /**
   * Selective memory attachment (T75 r1 §二; official "determine which
   * memory files to attach" shape): at session assembly, after the R6 index
   * injection, one bounded picker model call selects up to `maxFiles` (<= 5)
   * memory files relevant to the first prompt by filename + frontmatter
   * description; their full content is injected into the system tail under
   * the same background-context-and-verify envelope as the index. Opt-in and
   * BILLED (the picker is a real model call, folded into session usage
   * accounting); requires `schema: 'frontmatter'` (ConfigurationError
   * otherwise — without descriptions the picker has no relevance signal).
   * Frontmatter `pinned: true` files bypass the picker, always attach, do
   * not count against maxFiles, and take priority within the 25600-byte
   * total budget (over-budget selections are dropped at file boundaries and
   * disclosed). S1 mounts bound the candidate set; incognito sessions still
   * attach (attachment is a read). A failed picker degrades to pinned-only
   * attachment — never a blocked session.
   */
  attachment?: {
    enabled: true;
    /** 1..5; default 5 (the official picker ceiling). */
    maxFiles?: number;
    /** Picker call settings; `model` defaults to the session model. */
    picker?: { model?: string };
  };
  /**
   * Compaction flush (spec R7): when auto-compaction is about to fold the
   * conversation, first give the model one write opportunity ("record
   * un-saved progress to memory now") — the fold happens on the following
   * turn. A PreCompact hook deny suppresses the flush (and the fold). Default
   * true; set false to compact without the flush round.
   */
  flushOnCompaction?: boolean;
  /**
   * Session-end progress card (spec R7): when the query ends NORMALLY (never
   * on abort or error), run one bounded memory-update round — the progress
   * card lives under `/memories/progress/`, with only a one-line pointer in
   * the index (keeper 2026-07-27 ruling; writing the card INTO MEMORY.md was
   * the bug that ruling removed — see prompt-fragments.ts R7). Its
   * assistant/user messages are streamed, its result message is absorbed into
   * session accounting instead of being yielded (the task's own final result
   * stays the last result the consumer sees). Default true when memory is
   * enabled; set false to disable.
   */
  sessionEndUpdate?: boolean;
  /**
   * Pitfall recording protocol (self-improvement spec SCS-REQ-002 Phase 0 /
   * REQ-3.2): inject an sdk-original system-prompt fragment instructing the
   * model to record non-obvious failures ("pitfalls") under
   * `/memories/pitfalls/` — one file per distinct pitfall with symptom, root
   * cause, fix and avoidance — restricted to technical facts (the stripping
   * rule: no evaluative statements about people, no PII beyond what the fix
   * requires). Applies in BOTH assembly modes (it is consumer guidance layered
   * on top of the base protocol, not a duplicate of it). The object form
   * appends extra guidance after the default text. Never injected on an
   * incognito session (memory is read-only there; a write protocol would
   * contradict it). Default: disabled.
   */
  pitfalls?: boolean | { instructions?: string };
};

/**
 * Outcome of the session-end progress-card round (memory spec R7) for one
 * run — the write-back observability signal (keeper 2026-07-20, BPT
 * memory-rot diagnosis). The failure mode this exposes: a ledger-driven host
 * whose sessions routinely end at a cap / driver timeout never gets the
 * round, the progress card goes stale, and every resume re-verifies the
 * world from an outdated recovery point. Contract for hosts: any final value
 * other than 'ran' means the progress card was NOT updated this run —
 * compensate (e.g. dispatch a dedicated card-update session) or the next
 * resume works from a stale card.
 *
 *  - 'pending'           — the run never reached the session-end decision
 *                          point (abort / thrown error / blocked input);
 *  - 'ran'               — the round was driven to completion;
 *  - 'failed'            — the round started but did not complete (error or
 *                          abort mid-round; non-fatal to the query);
 *  - 'disabled'          — sessionEndUpdate: false, or an incognito session;
 *  - 'skipped-no-turns'  — zero turns ran, nothing to record;
 *  - 'skipped-abort'     — the life signal was aborted at the decision point;
 *  - 'skipped-budget'    — maxBudgetUsd was already spent;
 *  - 'skipped-turns'     — maxTurns was already spent;
 *  - 'skipped-interrupt' — a string-mode interrupt ended the run.
 */
export type SDKMemorySessionEndUpdate =
  | 'pending'
  | 'ran'
  | 'failed'
  | 'disabled'
  | 'skipped-no-turns'
  | 'skipped-abort'
  | 'skipped-budget'
  | 'skipped-turns'
  | 'skipped-interrupt';

/**
 * Memory-operation counters for one run (spec R8 observability; rides
 * SDKRunMetrics.memoryHealth when the memory system is enabled). All-zero
 * means the model never touched memory. For the on-demand DEEP health scan
 * of the store itself (directory waterlines / rot / capacity headroom /
 * supersede-chain integrity — the dream-trigger surface), see
 * `assessMemoryStoreHealth()`; pass these counters in to get the read/write
 * ratio stamped alongside.
 */
export type SDKMemoryHealth = {
  /** Total memory tool invocations. */
  operations: number;
  /** view commands. */
  reads: number;
  /** create / str_replace / insert / delete / rename commands. */
  writes: number;
  /** Invocations that returned is_error. */
  errors: number;
  /** UTF-8 bytes of view output returned to the model (post-truncation). */
  bytesRead: number;
  /** UTF-8 bytes of content handed to write commands (file_text /
   *  insert_text / new_str). */
  bytesWritten: number;
  /** Estimated tokens of the selective-attachment injection (r1 §二), 0 when
   *  attachment is off or attached nothing — the read-side residency cost of
   *  the attached memory files, next to indexInjectionTokens below. */
  attachmentInjectionTokens: number;
  /** Estimated tokens of the resident memory-index injection (R6), so the
   *  read-side residency cost shows up on the bill. */
  indexInjectionTokens: number;
  /** R7 write-back observability: what happened to the session-end
   *  progress-card round. Advances during the run ('pending' until the
   *  decision point); the final value is authoritative once the query has
   *  finished — read it via the last result's metrics or, on paths where no
   *  result can carry it (abort / cap), via `Query.memoryHealthSnapshot()`. */
  sessionEndUpdate: SDKMemorySessionEndUpdate;
};

/**
 * One structured tool-call record (BPT-EXTENSION, memory governance spec S3),
 * persisted to the session JSONL at the same level as the message lines so
 * "the model SAID it called a tool" is always checkable against "a tool call
 * actually happened". Records are written at dispatch time by the engine —
 * they never depend on reconstructing tool_use blocks from message text.
 * Read them back with `getSessionToolCalls()`; audit claims against them with
 * `auditToolClaims()`. Incognito sessions (S2) write none.
 */
export type SDKToolCallRecord = {
  type: 'tool_call';
  uuid: string;
  session_id: string;
  /** 1-based dispatch sequence within one query() run (a resumed session's
   *  file restarts at 1 for the new run; `timestamp` orders across runs). */
  seq: number;
  /** ISO timestamp of dispatch start. */
  timestamp: string;
  /** The tool_use block id — joins the record to the full tool_use block
   *  (untruncated input) persisted in the assistant message. */
  tool_use_id: string;
  tool_name: string;
  /** JSON of the input, truncated at 2048 chars (see tool_use_id for the
   *  full input). */
  tool_input: string;
  /** 'ok' = a tool_result without is_error; 'error' covers execution errors,
   *  permission denials, hook stops and unknown tools (detail in
   *  result_summary). */
  status: 'ok' | 'error';
  /** Full dispatch duration (hooks + permission gate + execution). */
  duration_ms: number;
  /** Result content head, truncated at 500 chars. */
  result_summary: string;
  /** Present on a subagent's tool call: the parent Task tool_use id. */
  parent_tool_use_id?: string;
};

export type Options = {
  abortController?: AbortController;
  additionalDirectories?: string[];
  /** Read output limits (BPT-EXTENSION); omit for the defaults. */
  readLimits?: ReadLimits;
  /** Bash output limits (BPT-EXTENSION); omit for env/default resolution. */
  bashLimits?: BashLimits;
  /** Programmatic subagent definitions (type-compatible; execution in v0.2). */
  agents?: Record<string, AgentDefinition>;
  allowedTools?: string[];
  disallowedTools?: string[];
  canUseTool?: CanUseTool;
  /** Continue the most recent persisted session. */
  continue?: boolean;
  cwd?: string;
  env?: Record<string, string | undefined>;
  fallbackModel?: string;
  forkSession?: boolean;
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  /**
   * BPT-EXTENSION (audit 2026-07-10): what a hook callback's failure (throw
   * or timeout) means for the permission aggregate. 'open' (default, the
   * historical and official-parity behavior): the failure is logged and
   * treated as neutral — note this means a broken PreToolUse policy hook
   * silently stops denying. 'closed': the failure contributes a deny, so
   * hook-enforced policy fails safe (tool calls block while the hook is
   * broken). Cancellation via the caller's signal is never treated as a deny.
   * A matcher-level HookCallbackMatcher.failureMode overrides this global
   * setting for that matcher's callbacks (audit 2026-07-14 M-1).
   */
  hookFailureMode?: 'open' | 'closed';
  /** v0.4: surface hook execution as system/hook_started + system/
   *  hook_response stream messages (official encoding since v0.7; default
   *  false — hooks otherwise report via debug only). Semantics unchanged by
   *  the v0.7 re-encoding. */
  includeHookEvents?: boolean;
  /**
   * BPT-EXTENSION (prompt-composition, 2026-07-09): emit a `system` /
   * `prompt_composition` observability message just before each request is sent,
   * carrying the SDK's own per-part token estimate (systemBase / systemAppend /
   * toolDefs / messages) and the request's cache_control breakpoint map (each
   * with the estimated size of the prefix it seals). Lets a downstream "context
   * composition" panel use the SDK's exact segmentation + context-window
   * accounting口径 instead of reverse-engineering a transcript, and map the
   * API's real usage counts onto content buckets. Default false (zero cost when
   * off; the wire request is never affected). The same data is available
   * synchronously via the exported `analyzeRequestComposition`.
   */
  includePromptComposition?: boolean;
  includePartialMessages?: boolean;
  /**
   * Incognito session (BPT-EXTENSION, memory governance spec S2): a session
   * that leaves no SDK-side persistent trace. When true:
   *  - the session transcript is NOT persisted (persistSession is forced off;
   *    combining with `sessionStore` is a ConfigurationError);
   *  - the memory tool degrades to READ-ONLY: `view` stays available ("knows
   *    you, doesn't record you"), the five write commands are rejected with a
   *    structured error at the SDK layer;
   *  - the R7 memory write rounds (compaction flush + session-end progress
   *    card) are disabled;
   *  - structured tool-call records (S3) are not written.
   * Promise boundary: "incognito" means nothing enters SDK storage or the
   * memory store. Requests are still sent to the configured model API and
   * remain subject to its terms; workspace files the model edits via
   * Write/Edit/Bash are the user's own actions and are out of scope.
   */
  incognito?: boolean;
  /**
   * BPT-EXTENSION (SCS-REQ-REPOS-01 §3 R1): structured content prepended to
   * this query's FIRST genuine prompt, rendered as `<system-reminder>`
   * blocks ahead of the prompt text. The turn-injection seam for host-built
   * loops: pass `ledger.toPrelude()` (R4) here so the dedup digest rides
   * every injected turn. Hooks (UserPromptSubmit) see the RAW typed prompt;
   * history and persistence carry the composed text.
   */
  prelude?: StructuredPrelude[];
  /**
   * BPT-EXTENSION (SCS-REQ-REPOS-01 §3 R5): opt-in registration of the
   * LoopControl tool (model-side loop surface). When set, the model can
   * PROPOSE stopping the host's loop; each proposal arrives at `onProposal`
   * as a structured event. The engine's behavior never changes on a
   * proposal — continuing is the host's decision alone.
   */
  loopControl?: {
    onProposal?: (proposal: LoopStopProposal) => void;
  };
  /**
   * BPT-EXTENSION (SCS-REQ-REPOS-01 §4.3): structured session goal — a
   * stricter stopping condition over the engine's Stop-gate mechanism, with
   * a HOST-INJECTED evaluator. This structured config is the goal's ONLY
   * entrance; the engine recognizes no goal text convention.
   */
  goal?: GoalConfig;
  maxBudgetUsd?: number;
  /**
   * BPT-EXTENSION (SCS-REQ-REPOS-01 §3 R2): the fraction of `maxBudgetUsd` at
   * which the one-shot `budget:threshold` hook event fires (root loop only).
   * Default 0.8. Must be in (0, 1]; only meaningful with `maxBudgetUsd` set
   * and a `budget:threshold` hook subscribed.
   */
  budgetThresholdRatio?: number;
  /**
   * @deprecated Official docs mark `maxThinkingTokens` deprecated in favor of
   * the structured `thinking` config. Still honored here as a budget fallback
   * (see `thinking`); prefer `thinking: { type, budget_tokens }`.
   */
  maxThinkingTokens?: number;
  maxTurns?: number;
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Model id for the session. Effectively REQUIRED since 0.94.0: when absent,
   * query() falls back to the ANTHROPIC_MODEL environment variable, and when
   * that is also unset it throws a ConfigurationError — this SDK ships no
   * built-in default model id (deliberate divergence from the official SDK;
   * the package cannot know which ids the consumer's gateway serves, and a
   * silent baked-in fallback surfaces only as a delayed gateway 400).
   */
  model?: string;
  permissionMode?: PermissionMode;
  /**
   * Safety interlock required to enter `permissionMode: 'bypassPermissions'`.
   * Matches @anthropic-ai/claude-agent-sdk: bypassPermissions is refused unless
   * this is explicitly `true`. Applies to the initial mode and to
   * `setPermissionMode('bypassPermissions')` mid-session.
   */
  allowDangerouslySkipPermissions?: boolean;
  /** Persist the session transcript to disk (default true). */
  persistSession?: boolean;
  /** BPT extension: direct Messages API connection settings. */
  provider?: ProviderConfig;
  /**
   * BPT-EXTENSION (cross-protocol subagent routing, 2026-07-13): resolve the
   * transport an ISOLATED subagent drives when its resolved model needs a
   * different wire protocol than the parent (e.g. an openai-chat parent
   * spawning a child model only served on the gateway's Anthropic route —
   * previously the child rode the parent transport unconditionally and the
   * gateway 400'd "model not found"). Absent -> children share the parent
   * transport (existing behavior). Forks never consult it. See
   * `createSubagentTransportResolver()` for the standard implementation.
   * Since v0.55.0 the same callback also routes the OTHER internal calls that
   * target a non-session model — utility generator calls (hook `condition`
   * evaluation) and the compaction summarizer — distinguished by
   * `input.purpose`.
   */
  resolveSubagentTransport?: SubagentTransportResolver;
  /**
   * BPT-EXTENSION (model-alias mapping, 2026-07-17): host overrides for the
   * short model aliases (`opus` / `sonnet` / `haiku` / `fable`) that
   * AgentDefinition.model, compaction.model, and utility calls may use. The
   * built-in table maps them to Anthropic-official ids, which a gateway
   * serving different ids rejects (a bare `'sonnet'` then 400s the subagent).
   * Entries here win over the built-in table key-by-key and may add new keys
   * (including remapping a full id); `'inherit'` is not remappable. Absent ->
   * the built-in table alone (previous behavior).
   */
  modelAliases?: Readonly<Record<string, string>>;
  /**
   * Bash sandbox (G-SANDBOX). Default ON when a backend resolves (bubblewrap
   * on Linux); on platforms with no backend (win32/darwin) Bash runs
   * unsandboxed and no sandbox guidance is emitted — the SDK never pretends
   * isolation it does not have (official Claude Code ships no sandbox on
   * Windows either). `false` disables explicitly. The object form is
   * BPT-shaped (documented in docs/COMPAT.md); the per-call Bash escape input
   * follows the official name `dangerouslyDisableSandbox` and routes through
   * the permission gate as an ask.
   */
  sandbox?: boolean | SandboxOptions;
  /** Session id (UUID) to resume. */
  resume?: string;
  /** Use a specific session id for this session. */
  sessionId?: string;
  /** Directory for session transcripts (default ~/.bpt-agent/sessions). */
  sessionDir?: string;
  /**
   * Which on-disk instruction sources to load, matching
   * @anthropic-ai/claude-agent-sdk. Two DISTINCT effects (audit 2026-07-10
   * P0-5):
   *  1. CLAUDE.md / AGENTS.md system-prompt injection — 'project'/'local' walk
   *     up from cwd, 'user' reads ~/.claude/CLAUDE.md. Applies ONLY on the
   *     `claude_code` preset / default harness path (a string/segments
   *     systemPrompt is caller-owned verbatim).
   *  2. Project `.mcp.json` server loading — applies on EVERY systemPrompt
   *     path (project/local sources enable it).
   * OMITTED (undefined) loads all three sources — user+project+local —
   * matching official Claude Code (the bump-pin default, 2026-07-05). An
   * explicit `[]` loads nothing (opt-out); an explicit subset loads exactly
   * that subset.
   */
  settingSources?: SettingSource[];
  /**
   * Inject the official-style `<env>` runtime-context block (working directory,
   * git repo/branch, platform, OS version, date) plus the model line into the
   * system prompt. Reproduces the official runtime assembly. Default true on the
   * `claude_code` preset / default path; set false to omit it. Ignored for a
   * string or segments systemPrompt (the caller owns those verbatim).
   */
  includeEnvironmentContext?: boolean;
  /**
   * Automation-continuation prompt fragment (BPT-EXTENSION, keeper memo
   * 2026-07-18 §3): append a short sdk-original fragment to the default
   * harness telling the model it runs inside an automated loop — finish ALL
   * the work before ending the turn, keep calling tools, no mid-task
   * progress reports. Motivated by mainline non-Anthropic models stalling
   * mid-run ("中途熄火") on agentic tasks. Default is PROTOCOL-GATED:
   * `true` on `provider.protocol: 'openai-chat'`, `false` on 'anthropic'
   * (whose harness already carries the act-when-ready discipline). Explicit
   * true/false overrides the default either way. Preset/default systemPrompt
   * path only — a string or segments systemPrompt is caller-owned verbatim.
   */
  continuationPrompt?: boolean;
  stderr?: (data: string) => void;
  /** ACCEPTED-IGNORED (audit 2026-07-10): despite the official name, this SDK
   *  has no consumer for the flag — project `.mcp.json` loading is governed by
   *  `settingSources` instead. See docs/COMPAT.md. */
  strictMcpConfig?: boolean;
  /**
   * System-prompt selection. NOTE a documented behavior fork (audit
   * 2026-07-10 P1-5a): OMITTING this field and spelling the `claude_code`
   * preset converge on the SAME prompt text, but ONLY the preset spelling
   * enables the default thinking configuration — cost and stream content
   * differ between the two "equivalent" spellings. See also `thinking`.
   */
  systemPrompt?:
    | string
    | {
        type: 'preset';
        preset: 'claude_code';
        append?: string;
        /**
         * BPT-EXTENSION (prompt-composition, 2026-07-09): labeled append
         * segments layered after the preset base, in order. Their `text` is
         * concatenated into the appended stable tail exactly as `append` would
         * be (byte-identical wire output, so caching/conformance are
         * unaffected) — the `label`s are metadata only and let the
         * prompt-composition breakdown (includePromptComposition) attribute
         * each bucket (e.g. Root / Runtime / Memory) separately. When both are
         * present, `append` is emitted first, then these in order.
         */
        appendSegments?: { label: string; text: string }[];
        /**
         * NEW-IN-DOCS: move per-session dynamic context into the first user
         * message for better prompt-cache reuse across machines.
         * typed-not-populated in this engine.
         */
        excludeDynamicSections?: boolean;
      }
    | { type: 'segments'; segments: SystemPromptSegment[] };
  /**
   * Thinking configuration. Unset + `claude_code` PRESET systemPrompt ->
   * default thinking is enabled (E1); unset + OMITTED systemPrompt -> no
   * thinking param is sent (the preset-vs-omitted fork, audit 2026-07-10
   * P1-5a). On `provider.protocol: 'openai-chat'` this config does not
   * translate and is dropped from the wire (use provider.openai.reasoningEffort).
   */
  thinking?: ThinkingConfigParam;
  /** Restrict built-in tools by name; defaults to all built-ins. */
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
  /**
   * Steer or constrain tool use for every request in this session. Forwarded
   * verbatim as the Messages API `tool_choice` param when tools are present
   * (an empty tool set omits it, since the API rejects `tool_choice` with no
   * tools). `{ type: 'tool', name }` forces a specific tool; `{ type: 'any' }`
   * forces some tool; `{ type: 'none' }` forbids tools; and
   * `disable_parallel_tool_use: true` caps the turn at one tool call. Omitted ->
   * the API default (`auto`). */
  toolChoice?: ToolChoice;
  /** Extra beta flags forwarded via the anthropic-beta header. */
  betas?: string[];
  /** Enable debug logging via stderr callback. */
  debug?: boolean;
  /** Official: write debug logs to a file (implies debug). FULL (P2): each
   *  debug line is best-effort appended to this file in addition to the stderr
   *  callback / process.stderr. See docs/COMPAT.md. */
  debugFile?: string;
  /** BPT extension: context-compaction tuning (see docs/COMPAT.md). */
  compaction?: CompactionOptions;
  /** BPT extension: disconnect-resilience tuning (see docs/RESILIENCE.md). */
  resilience?: ResilienceOptions;
  /** Require the final answer to be JSON validating against a JSON Schema;
   *  the validated object is returned on the result as `structured_output`. */
  outputFormat?: OutputFormatConfig;
  /** BPT/v0.2: host web-search backend for the WebSearch tool. */
  webSearch?: WebSearchHandler;
  /** BPT/v0.2: collects answers for the AskUserQuestion tool. */
  onUserQuestion?: UserQuestionHandler;
  /** v0.2: answers MCP server elicitation requests (else auto-declined). */
  onElicitation?: ElicitationHandler;
  /**
   * SECOND DELIVERY CHANNEL for background-task lifecycle events (keeper ruling
   * 2026-07-29: align with the official conversation / background-task split).
   *
   * When set, `task_started` / `task_progress` / `task_updated` /
   * `task_notification` / `background_tasks_changed` are delivered HERE, at the
   * moment they are produced, instead of being queued into the pull-based
   * SDKMessage stream. That is what lets a terminal event exist at all for work
   * cancelled during teardown: the stream's "a result ends the stream" contract
   * cannot carry one, and until this existed a background child killed by query
   * teardown left a host task tracker showing it as still running forever.
   *
   * NOT dual-emitted: an event delivered here does NOT also appear in the
   * stream, so a host never has to de-duplicate. Leaving this unset keeps the
   * previous behavior byte-for-byte (every event stays in the stream), so this
   * is a drop-in-compatible addition.
   *
   * Called synchronously and never awaited; a throw is caught and logged to the
   * debug channel, never propagated — observability must not be able to alter
   * or abort the run (the same posture as every other host callback here).
   */
  onBackgroundEvent?: (event: SDKBackgroundEvent) => void;
  /** BPT extension: allow WebFetch to reach localhost/private IPs (default false). */
  allowPrivateWebFetch?: boolean;
  /** BPT-EXTENSION: cross-session memory tool (memory_20250818 equivalence);
   *  see MemoryOptions + docs/MEMORY.md. Absent -> no memory tool. */
  memory?: MemoryOptions;
  /** BPT-EXTENSION (self-improvement spec SCS-REQ-002 loop 1): mirror every
   *  consumer-facing result message as one JSONL line in
   *  `{dir}/runlog-{YYYY-MM-DD}.jsonl` — the signal source
   *  generateRuntimeReport() aggregates. Facts only, no conversation content;
   *  incognito sessions contribute transport/token statistics but no
   *  identity, tag or error text. Absent -> no ledger writes. */
  runLog?: RunLogOptions;
  /** Mirror session transcripts to an external backend (S3/Redis/DB). */
  sessionStore?: SessionStore;
  /** Flush cadence for sessionStore mirror writes. Default 'batched'. */
  sessionStoreFlush?: 'batched' | 'eager';
  /** Timeout (ms) for each external sessionStore load on resume. Default 60000. */
  loadTimeoutMs?: number;
  /** Track Write/Edit pre-images so Query.rewindFiles() can restore files. */
  enableFileCheckpointing?: boolean;
  /** Defer MCP tool schemas behind a ToolSearch tool. undefined -> auto. */
  toolSearch?: boolean;

  // -------------------------------------------------------------------------
  // Official Options fields ACCEPTED at runtime but NOT acted on (T2-3,
  // 2026-07-05). Each was already in the runtime ACCEPTED whitelist
  // (query.ts emits one debug warning per present key); they are typed here so
  // an official-SDK caller's object literal passes excess-property checking.
  // The per-field JSDoc states the HONEST support level — none of these
  // change engine behavior today. See docs/COMPAT.md for the ledger.
  // -------------------------------------------------------------------------

  /** Official: agent name for the main thread. ACCEPTED-IGNORED (main-thread
   *  agent selection is not implemented; agents run via the Agent tool). */
  agent?: string;
  /** Official: generate one-line subagent progress summaries onto
   *  task_progress.summary. ACCEPTED-IGNORED (no summary generation source;
   *  task_progress.summary is typed but never populated). */
  agentProgressSummaries?: boolean;
  /** Official: response effort level. ACCEPTED-IGNORED (not forwarded to the
   *  Messages API; use `thinking` to steer reasoning depth). */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Official: JS runtime for the CLI subprocess. N/A-BY-DESIGN (this SDK
   *  spawns no subprocess); accepted so migration call sites compile. */
  executable?: 'bun' | 'deno' | 'node';
  /** Official: argv for the CLI subprocess executable. N/A-BY-DESIGN. */
  executableArgs?: string[];
  /** Official: extra CLI flags. N/A-BY-DESIGN (no CLI argv exists). */
  extraArgs?: Record<string, string | null>;
  /** Official: forward subagent text/thinking blocks into the parent stream.
   *  ACCEPTED-IGNORED (only tool_use/tool_result blocks cross today). */
  forwardSubagentText?: boolean;
  /** Official: policy-tier settings from the embedding host. ACCEPTED-IGNORED
   *  (no settings merge engine). Official type is the Settings file shape;
   *  typed loosely here because that shape is not reproduced. */
  managedSettings?: Record<string, unknown>;
  /** Official: path to the CLI executable. N/A-BY-DESIGN (no CLI). */
  pathToClaudeCodeExecutable?: string;
  /** Official: MCP tool name for permission prompts. ACCEPTED-IGNORED
   *  (permission prompting goes through `canUseTool`). */
  permissionPromptToolName?: string;
  /** Official: replace the plan-mode workflow body. ACCEPTED-IGNORED (plan
   *  mode uses this engine's fixed prompt fragment). */
  planModeInstructions?: string;
  /** Official: load local plugins. ACCEPTED-IGNORED (no plugin loader;
   *  system/init `plugins` is always []). */
  plugins?: SdkPluginConfig[];
  /** Official: emit a prompt_suggestion message after each turn.
   *  ACCEPTED-IGNORED (SDKPromptSuggestionMessage is typed, never emitted). */
  promptSuggestions?: boolean;
  /** Official: resume at a specific message UUID. ACCEPTED-IGNORED (resume
   *  always materializes the full transcript). */
  resumeSessionAt?: string;
  /** Official: inline settings object or settings-file path (flag-settings
   *  layer). ACCEPTED-IGNORED (no settings engine; `applyFlagSettings()` is
   *  likewise absent from Query). Typed loosely — the official Settings file
   *  shape is not reproduced. */
  settings?: string | Record<string, unknown>;
  /** Official: skills available to the session. ACCEPTED-IGNORED (no skills
   *  subsystem; system/init `skills` is always []). */
  skills?: string[] | 'all';
  /** Official: custom process spawner for VMs/containers. N/A-BY-DESIGN
   *  (no subprocess to spawn). */
  spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;
  /** Official (alpha): API-side task token budget. ACCEPTED-IGNORED (the
   *  model is not told a remaining-budget figure; use maxBudgetUsd for
   *  client-side enforcement). */
  taskBudget?: { total: number };
  /** Official: display title for the session. ACCEPTED-IGNORED at query time
   *  (use renameSession() to title a persisted session). */
  title?: string;
  /** Official: map built-in tool names to MCP replacements.
   *  ACCEPTED-IGNORED (built-ins always run their own implementations). */
  toolAliases?: Record<string, string>;
  /** Official: built-in tool behavior config. ACCEPTED-IGNORED. */
  toolConfig?: ToolConfig;
};
