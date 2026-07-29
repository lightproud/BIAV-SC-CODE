/**
 * Silver Core SDK 公开类型面 — v0.2 子系统类型。
 *
 * 自 src/types.ts 按其自带的分节切出（结构审视 P7，2026-07-27）：切分依据是文件
 * 原本就标好的分节注释，不是新发明的边界。src/types.ts 保留为 barrel，所有
 * `from '../types.js'` 的既有 import 一行未动。
 *
 * 溯源与合规声明见 src/types.ts 头注（clean-room，仅据公开文档）。
 */

import type { McpServerStatus } from './mcp.js';
import type { JSONSchema } from './wire.js';

// ---------------------------------------------------------------------------
// v0.2 subsystem types
// ---------------------------------------------------------------------------

/** Structured-output configuration (Options.outputFormat). The SDK validates
 *  the agent's final answer against `schema` and re-prompts on mismatch.
 *
 *  By default this is enforced OFF the wire: a system-prompt instruction plus a
 *  local lenient validator with a bounded re-prompt — no server-side guarantee,
 *  but it works on every model and enforces the full local constraint set
 *  (minLength/minimum/… that the native path does not).
 *
 *  `native: true` (C9) ALSO forwards the schema on the wire as the official
 *  Messages API `output_config: { format: { type:'json_schema', schema } }`,
 *  for the server-side format guarantee. Native structured outputs are only
 *  available on supported models (Fable 5 / Opus 4.8 / Sonnet 5 / Haiku 4.5 /
 *  Opus 4.5 / Opus 4.1) and constrain the schema to a documented subset
 *  (objects need `additionalProperties: false`; `minLength`/`minimum`/… are not
 *  enforced server-side). The local validator keeps running as the complement /
 *  fallback, so opting in never LOSES a constraint — it adds the wire guarantee
 *  on top. Leave it unset on older models or unsupported schemas. */
export type OutputFormatConfig = {
  type: 'json_schema';
  schema: JSONSchema;
  /** Also send the schema on the wire as `output_config.format` (server-side
   *  guarantee, supported models only). Absent/false -> local-only (default). */
  native?: boolean;
};

/** BPT extension: disconnect-resilience tuning (docs/RESILIENCE.md). */
export type ResilienceOptions = {
  /**
   * How a MID-STREAM truncation (a connection drop after partial content, or
   * the streamMaxDurationMs hard cap) is resolved:
   * - 'accept' (default): keep the whole blocks delivered so far as the turn's
   *   answer — the official 2.1.201 salvage semantics (drop-in). A truncated
   *   final message surfaces as a partial answer.
   * - 'continue': do NOT accept the partial; re-drive the turn through the
   *   bounded replay so the model produces a COMPLETE answer. Because the
   *   replay is a fresh turn there is no duplicated prefix. Costs one (or more)
   *   extra turn(s) within TURN_REPLAY_LIMIT; a persistently truncating turn
   *   still degrades to the error path once replays exhaust.
   */
  salvageMode?: 'accept' | 'continue';
};

/** BPT extension: context-compaction tuning. When the running request
 *  history's estimated token count approaches the model context window,
 *  older turns are folded into a synthetic summary. `enabled` defaults true. */
/**
 * A LoopControl stop proposal (R5): the structured event delivered to the
 * host when the model calls the LoopControl tool. The model can only
 * PROPOSE; the host decides whether its loop continues, and the engine's
 * behavior never changes on a proposal.
 */
export type LoopStopProposal = {
  action: 'propose_stop';
  reason: string;
};

/**
 * The host-injected goal evaluator's verdict (SCS-REQ-REPOS-01 §4.3).
 * `not_achieved` blocks the stop and re-drives the loop with `reason`;
 * `achieved` and `impossible` (the judged escape hatch) allow the stop and
 * disarm the goal.
 *
 * CANONICAL family-wide shape (keeper ruling 2026-07-27):
 * silver-core-maestro-sdk's `GoalChaser` evaluator verdict is structurally
 * identical since 0.83.0, so one host evaluator serves both seams. Changing
 * this shape requires a family-wide ruling — the maestro side re-declares it
 * verbatim (no cross-package import; dependency direction stays clean).
 */
export type GoalVerdict = {
  status: 'achieved' | 'not_achieved' | 'impossible';
  reason?: string;
};

/** What the goal evaluator sees at each natural stop. */
export type GoalEvaluationContext = {
  /** The configured goal description. */
  goal: string;
  /** Bounded engine-assembled evidence: last assistant message + transcript
   *  tail (may be '' — a pure-function evaluator checking external state,
   *  e.g. running tests, needs none of it). */
  context: string;
  /** Consecutive blocked stops so far for this goal. */
  blocks: number;
  signal: AbortSignal;
};

/** Host-observable goal lifecycle notifications. */
export type GoalEvent =
  | { kind: 'achieved'; goal: string; reason: string }
  | { kind: 'impossible'; goal: string; reason: string }
  | { kind: 'blocked'; goal: string; reason: string; blocks: number }
  | { kind: 'evaluator_error'; goal: string; reason: string }
  | { kind: 'block_limit'; goal: string; blocks: number };

/**
 * Structured session goal (`options.goal`) — the goal's ONLY entrance. Arms
 * a Stop gate: the loop may not stop naturally until the HOST-INJECTED
 * evaluator judges the goal achieved (or impossible — the escape hatch).
 * The evaluator is a pure function (deterministic judge: run tests /
 * assertions — preferred) or the host's own judge-model call; the engine
 * hardcodes no model choice. Evaluator failure ALLOWS the stop (a broken
 * judge must never trap the loop). maxTurns / maxBudgetUsd still cap a
 * stubborn goal.
 */
export type GoalConfig = {
  /** The goal description (shown to the evaluator and in feedback turns). */
  goal: string;
  /** Host-injected judge, called at each natural stop while armed. */
  evaluator: (
    ctx: GoalEvaluationContext,
  ) => GoalVerdict | Promise<GoalVerdict>;
  /** Escape policy: after this many consecutive blocked stops, allow the
   *  stop (goal stays armed). Default unbounded — the engine's own caps
   *  (maxTurns / maxBudgetUsd) are the safety net. */
  maxBlocks?: number;
  /** Bounded transcript-tail read for the evaluator context (default 32768). */
  transcriptTailBytes?: number;
  /** Lifecycle notifications (UI badges, runner logs). */
  onEvent?: (event: GoalEvent) => void;
};

/** One structured prelude block for `Options.prelude` (R1 turn injection). */
export type StructuredPrelude = {
  /** Optional label rendered as the block's first line. */
  title?: string;
  /** The block body, rendered verbatim inside the system-reminder. */
  content: string;
};

/**
 * A structured context region that must survive automatic compaction VERBATIM
 * (SCS-REQ-REPOS-01 R3). The engine re-stamps every declared region into the
 * post-fold context on each compaction; regions live under a total byte cap
 * and an over-cap declaration throws instead of truncating.
 */
export type RetainedRegion = {
  /** Host-chosen stable identifier (declaring the same id replaces). */
  id: string;
  /** Optional human-readable label rendered on the region block. */
  title?: string;
  /** The verbatim content to preserve across folds. */
  content: string;
};

export type CompactionOptions = {
  enabled?: boolean;
  /** Fraction of the (window - reserved output) budget at which auto-compaction fires. Default 0.85. */
  autoThresholdRatio?: number;
  /** Fraction of the input budget kept verbatim as the recent suffix. Default 0.30. */
  keepRatio?: number;
  /** Minimum number of genuine user turns kept in the suffix. Default 2. */
  minRecentTurns?: number;
  /** Use a real Messages API summarization call instead of the deterministic fold. Default false. */
  useApiSummary?: boolean;
  /**
   * Model for the summarization call (only used when useApiSummary is true).
   * Summarization is a cheap, mechanical task, so routing it to a small fast
   * model (e.g. Haiku) cuts compaction cost without touching main-loop quality.
   * Accepts a full model id or a short alias ('haiku'/'sonnet'/'opus'/'fable').
   * Default: the session model.
   */
  model?: string;
  /** Extra guidance appended to the summarizer instructions. */
  customInstructions?: string;
  /** Override the model context window (e.g. for a 1M-context beta). */
  contextWindowTokens?: number;
  /**
   * Run a cheap deterministic PRE-TIER over the folded prefix BEFORE the
   * summarization step (G1): de-duplicate repeated identical tool_result blocks
   * and pointer-ize oversized tool_result bulk, so fewer tokens reach the
   * summarizer (foldViaApi) / deterministic recap. Only tool_result bulk is
   * shed — user/assistant text is never touched, and message ordering /
   * tool_use<->tool_result pairing are preserved. Default true (opt-out with false).
   */
  preTier?: boolean;
  /**
   * Byte budget (chars) for a single string tool_result in the pre-tier: content
   * longer than this is truncated to head+tail with a `[…N chars elided…]`
   * marker in the middle. Default 4000. Set 0 to disable truncation (dedupe of
   * identical results still runs).
   */
  preTierMaxToolResultChars?: number;
  /**
   * Structured context regions that survive every automatic compaction
   * VERBATIM (R3): each fold re-stamps the declared regions into the
   * post-compaction context. Mutable at runtime via
   * `Query.setRetainedRegion` / `Query.removeRetainedRegion`.
   */
  retainedRegions?: RetainedRegion[];
  /**
   * Total byte cap across all retained regions (rendered form). A declaration
   * that would exceed it THROWS (`ConfigurationError`) — the engine never
   * silently truncates a retained region. Default 16384.
   */
  retainedRegionMaxBytes?: number;
};

/**
 * The tool call a defer paused on (SDKResultMessage.deferred_tool_use).
 *
 * The official field names are `id` / `name` / `input` — those are the
 * authoritative surface. The `tool_use_id` / `tool_name` / `tool_input`
 * spellings are this SDK's pre-alignment names, kept during a dual-track
 * transition (both sets are meant to be populated at the emit site) and
 * slated for removal once consumers migrate.
 */
export type SDKDeferredToolUse = {
  /** Official name for the deferred tool_use id (canonical). */
  id?: string;
  /** Official name for the deferred tool name (canonical). */
  name?: string;
  /** Official name for the deferred tool input (canonical). */
  input?: Record<string, unknown>;
  /** @deprecated Use `id` (official field name). */
  tool_use_id: string;
  /** @deprecated Use `name` (official field name). */
  tool_name: string;
  /** @deprecated Use `input` (official field name). */
  tool_input: Record<string, unknown>;
};

/** One web search result surfaced to the model by a webSearch callback. */
export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string;
};

/** Host-provided web-search backend (this SDK ships no search engine). */
export type WebSearchHandler = (
  query: string,
  options: { allowedDomains?: string[]; blockedDomains?: string[]; signal: AbortSignal },
) => Promise<WebSearchResult[] | string>;

/** One question posed to the user by the AskUserQuestion tool. */
export type UserQuestion = {
  question: string;
  header: string;
  /** `preview` (official option field, 2026-07-28 keeper ruling "三处全补"):
   *  a self-contained HTML fragment the HOST may render when the option is
   *  focused. The SDK accepts and forwards it verbatim to the host handler —
   *  whether it is rendered is the host UI's choice (honest-ACCEPTED: the SDK
   *  itself draws nothing). Official constraint: single-select questions only. */
  options: Array<{ label: string; description?: string; preview?: string }>;
  multiSelect?: boolean;
};

/** The user's answer to one question (selected option labels). */
export type UserQuestionAnswer = {
  header: string;
  answers: string[];
};

/** Host handler that collects answers for AskUserQuestion. */
export type UserQuestionHandler = (
  questions: UserQuestion[],
  options: { signal: AbortSignal },
) => Promise<UserQuestionAnswer[] | null>;

/** An MCP server's elicitation/create request (structured input it needs). */
export type ElicitationRequest = {
  message: string;
  requestedSchema: JSONSchema;
};

/** The host's response to an elicitation request. */
export type ElicitationResult =
  | { action: 'accept'; content: Record<string, unknown> }
  | { action: 'decline' }
  | { action: 'cancel' };

/** Host handler for MCP elicitation requests (omitted -> auto-declined). */
export type ElicitationHandler = (
  request: ElicitationRequest,
  options: { signal: AbortSignal },
) => Promise<ElicitationResult>;

/**
 * Result of Query.setMcpServers() — official shape (T2-2, 2026-07-05):
 * `added` / `removed` / `errors` report the real before/after diff of the
 * server set (errors maps a failed server's name to its connect error).
 * The registry mutation is decoupled (void), so all three are required;
 * the deprecated `servers` status list still rides along for one version.
 */
export type McpSetServersResult = {
  /** Server names present after the call but not before. */
  added: string[];
  /** Server names present before the call but not after. */
  removed: string[];
  /** Failed server name -> connect error message. */
  errors: Record<string, string>;
  /** @deprecated Pre-alignment payload (full status list); use
   *  added/removed/errors, or call mcpServerStatus() for statuses. */
  servers?: McpServerStatus[];
};

/** External session store key (options.sessionStore). */
export type SessionKey = {
  projectKey: string;
  sessionId: string;
  subpath?: string;
};

export type SessionStoreEntry = { type: string; uuid?: string; [key: string]: unknown };

export type SessionStoreListEntry = { sessionId: string; mtime: number };

/** Public external session store (options.sessionStore). Distinct from the
 *  INTERNAL contracts.ts transcript-store interface of the same name. */
export type SessionStore = {
  append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void>;
  load(key: SessionKey): Promise<SessionStoreEntry[] | null>;
  listSessions?(projectKey: string): Promise<SessionStoreListEntry[]>;
  delete?(key: SessionKey): Promise<void>;
  listSubkeys?(key: { projectKey: string; sessionId: string }): Promise<string[]>;
};

/** A single message from a persisted transcript (getSessionMessages). */
export type SessionMessage = {
  type: 'user' | 'assistant';
  uuid: string;
  session_id: string;
  message: unknown;
  parent_tool_use_id: string | null;
  /**
   * agentId of the subagent that spawned this subagent, or null when the
   * message belongs to a depth-1 subagent (spawned by the main loop) or to the
   * main session itself (official field, NEW-IN-DOCS 0.3.202 — enables
   * building depth-2+ agent trees from disk-persisted metadata). Transcripts
   * whose persisted metadata lacks the field report null.
   */
  parent_agent_id: string | null;
};

/**
 * Result of Query.rewindFiles() — official shape (T2-2, 2026-07-05).
 * An unknown userMessageId resolves with `{ canRewind: false, error }`
 * (soft-fail, official signature) instead of throwing; configuration misuse
 * (checkpointing not enabled) still throws.
 */
export type RewindFilesResult = {
  /** Whether the rewind target exists and the plan could be (or was) applied. */
  canRewind: boolean;
  /** Why the rewind could not run (e.g. no checkpoint for that message id). */
  error?: string;
  /** Every file the rewind plan touches (restored + deleted). */
  filesChanged?: string[];
  /** Official line-diff stats. NOT computed by this engine (no diff layer
   *  is bundled) — honestly absent rather than fabricated. */
  insertions?: number;
  /** See `insertions` — honestly absent. */
  deletions?: number;
  /** @deprecated Pre-alignment field (dual-track); the target message UUID. */
  checkpointId?: string;
  /** @deprecated Pre-alignment field (dual-track); use filesChanged. */
  restoredFiles?: string[];
  /** @deprecated Pre-alignment field (dual-track); use filesChanged. */
  deletedFiles?: string[];
  /** @deprecated Pre-alignment field (dual-track). */
  dryRun?: boolean;
};

/** Best-effort external-store write failure surfaced on the stream. */
export type SDKMirrorErrorMessage = {
  type: 'system';
  subtype: 'mirror_error';
  uuid: string;
  session_id: string;
  error: string;
};
