/**
 * Silver Core SDK 公开类型面 — SDK 消息与可观测性变体。
 *
 * 自 src/types.ts 按其自带的分节切出（结构审视 P7，2026-07-27）：切分依据是文件
 * 原本就标好的分节注释，不是新发明的边界。src/types.ts 保留为 barrel，所有
 * `from '../types.js'` 的既有 import 一行未动。
 *
 * 溯源与合规声明见 src/types.ts 头注（clean-room，仅据公开文档）。
 */

import type { NormalizedProviderError } from '../error-normalize.js';
import type { HookEvent } from './hooks.js';
import type { SDKMemoryHealth } from './options.js';
import type { PermissionMode, SDKPermissionDenial } from './permissions.js';
import type { SlashCommand } from './query.js';
import type { SDKDeferredToolUse } from './subsystems.js';
import type { APIAssistantMessage, APIUserMessage, ModelUsage, NonNullableUsage, RawMessageStreamEvent, StopReason } from './wire.js';

// ---------------------------------------------------------------------------
// SDK messages
// ---------------------------------------------------------------------------

// 'oauth' is NEW-IN-DOCS (live docs value); 'none' is a BPT-local extension.
export type ApiKeySource = 'user' | 'project' | 'org' | 'temporary' | 'oauth' | 'none';

/**
 * NEW-IN-DOCS: provenance of a user-role message, forwarded onto the
 * corresponding result so hosts can tell what triggered a turn. typed-not-
 * populated in this engine (all turns here are effectively `human`; an absent
 * `origin` already means human input per the official contract). */
export type SDKMessageOrigin =
  | { kind: 'human' }
  | { kind: 'channel'; server: string }
  | { kind: 'peer'; from: string; name?: string; senderTaskId?: string }
  | { kind: 'task-notification' }
  | { kind: 'coordinator' }
  | { kind: 'auto-continuation' };

/**
 * NEW-IN-DOCS: coarse error class attached to an assistant message. typed-not-
 * populated in this engine (error detail surfaces via SDKResultMessage). */
export type SDKAssistantMessageError =
  | 'authentication_failed'
  | 'oauth_org_not_allowed'
  | 'billing_error'
  | 'rate_limit'
  | 'overloaded'
  | 'invalid_request'
  | 'model_not_found'
  | 'server_error'
  | 'max_output_tokens'
  | 'unknown';

export type SDKUserMessage = {
  type: 'user';
  uuid?: string;
  session_id: string;
  message: APIUserMessage;
  parent_tool_use_id: string | null;
  /** NEW-IN-DOCS. typed-not-populated. */
  origin?: SDKMessageOrigin;
};

export type SDKUserMessageReplay = {
  type: 'user';
  uuid: string;
  session_id: string;
  message: APIUserMessage;
  parent_tool_use_id: string | null;
  isReplay: true;
  /** NEW-IN-DOCS. typed-not-populated. */
  origin?: SDKMessageOrigin;
};

export type SDKAssistantMessage = {
  type: 'assistant';
  uuid: string;
  session_id: string;
  message: APIAssistantMessage;
  parent_tool_use_id: string | null;
  /** NEW-IN-DOCS. typed-not-populated. */
  error?: SDKAssistantMessageError;
};

export type SDKPartialAssistantMessage = {
  type: 'stream_event';
  uuid: string;
  session_id: string;
  event: RawMessageStreamEvent;
  parent_tool_use_id: string | null;
  /**
   * Official field (P2 parity): milliseconds from turn start to the first
   * streamed token, attached once known (i.e. from the event that latches the
   * first token onward). Absent on events emitted before the first token.
   */
  ttft_ms?: number;
};

/** Per-assistant-turn metrics (v0.3 budget instrumentation). */
export type SDKTurnMetrics = {
  index: number;
  model: string;
  usage: NonNullableUsage;
  costUsd: number;
  apiMs: number;
  stopReason: StopReason;
  toolCalls: number;
};

/** Per-tool aggregate metrics across a run (v0.3). */
export type SDKToolMetrics = {
  name: string;
  calls: number;
  totalMs: number;
  errors: number;
};

/**
 * Disconnect-taxonomy ledger for one run (BPT-EXTENSION, resilience P0-2).
 * Counts every transport-level fault the run absorbed or surfaced, by cause,
 * so "it keeps disconnecting for various reasons" becomes a measurable
 * spectrum: which cause dominates decides the fix (endpoint routing vs knob
 * tuning vs code). All counters are 0 on a clean run.
 */
export type SDKTransportHealth = {
  /** Request-phase retries on socket/DNS/TLS failures (pre-headers). */
  networkRetries: number;
  /** Request-phase retries on retryable HTTP statuses (408/429/5xx/529). */
  httpRetries: number;
  /** In-transport replays of an HTTP-200-but-zero-events body. */
  emptyStreamRetries: number;
  /** Streams that dropped mid-body after delivering at least one event. */
  midStreamDrops: number;
  /** Idle-watchdog aborts (connected stream went silent past the window). */
  idleStalls: number;
  /** streamMaxDurationMs hard-cap aborts (plus fallback body timeouts). */
  maxDurationAborts: number;
  /** Truncated turns whose delivered-whole blocks were salvaged (E3). */
  turnsSalvaged: number;
  /** Bounded engine-level turn replays after replay-safe failures (P0-1). */
  turnReplays: number;
};

/**
 * Per-run budget/efficiency metrics (v0.3). A superset of the flat result
 * fields, packaged for logging + A/B comparison. `cacheHitRatio` is
 * cache_read / (input + cache_read + cache_creation), 0 when no caching.
 */
export type SDKRunMetrics = {
  numTurns: number;
  durationMs: number;
  durationApiMs: number;
  ttftMs?: number;
  usage: NonNullableUsage;
  totalCostUsd: number;
  cacheHitRatio: number;
  perTurn: SDKTurnMetrics[];
  perTool: SDKToolMetrics[];
  modelUsage: Record<string, ModelUsage>;
  /** Disconnect-taxonomy ledger (BPT-EXTENSION, resilience P0-2); present on
   *  every run — all-zero means a clean network run. */
  transportHealth?: SDKTransportHealth;
  /** Memory-operation counters (BPT-EXTENSION, memory spec R8); present when
   *  the memory system is enabled for the query. */
  memoryHealth?: SDKMemoryHealth;
};

/** NEW-IN-DOCS: why the agent loop ended (SDKResultMessage.terminal_reason).
 *  typed-not-populated in this engine — `stop_reason`/`subtype` remain the
 *  authoritative termination signals. */
export type TerminalReason =
  | 'completed'
  | 'max_turns'
  | 'tool_deferred'
  | 'aborted_streaming'
  | 'aborted_tools'
  | 'hook_stopped'
  | 'stop_hook_prevented'
  | 'blocking_limit'
  | 'rapid_refill_breaker'
  | 'prompt_too_long'
  | 'image_error'
  | 'model_error'
  // NEW-IN-DOCS (official 0.3.207 chase, 2026-07-13): the union gained six
  // members with zero exported-symbol change on the tarball. Typed for
  // drop-in exhaustiveness; typed-not-populated here (this field carries no
  // engine emission site — see the grep in the 0.3.207 diff report).
  | 'api_error'
  | 'malformed_tool_use_exhausted'
  | 'budget_exhausted'
  | 'structured_output_retry_exhausted'
  | 'tool_deferred_unavailable'
  | 'turn_setup_failed';

/** NEW-IN-DOCS: fast-mode state on the result. typed-not-populated. */
export type FastModeState = 'on' | 'off' | 'cooldown';

export type SDKResultMessage =
  | {
      type: 'result';
      subtype: 'success';
      uuid: string;
      session_id: string;
      duration_ms: number;
      duration_api_ms: number;
      is_error: boolean;
      num_turns: number;
      result: string;
      /**
       * Why the final assistant turn stopped (REQUIRED on the official
       * surface, `string | null`). Carries the API stop_reason of the final
       * turn, or `'tool_deferred'` when a PreToolUse hook deferred a tool
       * call (the official defer-detection protocol — pair it with
       * `deferred_tool_use`).
       */
      stop_reason: string | null;
      /** Validated object when options.outputFormat was set and validation passed. */
      structured_output?: unknown;
      /** Present on a turn that ended because a tool call was deferred. */
      deferred_tool_use?: SDKDeferredToolUse;
      /** Time to first token (ms), when measured. */
      ttft_ms?: number;
      ttft_stream_ms?: number;
      total_cost_usd: number;
      usage: NonNullableUsage;
      modelUsage: Record<string, ModelUsage>;
      permission_denials: SDKPermissionDenial[];
      /** HTTP status of the last API error observed during the run, if any. */
      api_error_status?: number;
      /** NEW-IN-DOCS. typed-not-populated. */
      terminal_reason?: TerminalReason;
      /** NEW-IN-DOCS. typed-not-populated. */
      fast_mode_state?: FastModeState;
      /** NEW-IN-DOCS. typed-not-populated. */
      origin?: SDKMessageOrigin;
      /** v0.3 per-run budget/efficiency metrics. */
      metrics?: SDKRunMetrics;
    }
  | {
      type: 'result';
      subtype:
        | 'error_max_turns'
        | 'error_during_execution'
        | 'error_max_budget_usd'
        | 'error_max_structured_output_retries';
      uuid: string;
      session_id: string;
      duration_ms: number;
      duration_api_ms: number;
      is_error: boolean;
      num_turns: number;
      /**
       * REQUIRED on the official surface (`string | null`). The last API
       * stop_reason observed before the run ended in error, or null when no
       * assistant turn completed (e.g. a pre-turn block or an API failure on
       * the first turn).
       */
      stop_reason: string | null;
      total_cost_usd: number;
      usage: NonNullableUsage;
      modelUsage: Record<string, ModelUsage>;
      permission_denials: SDKPermissionDenial[];
      errorMessage?: string;
      /** Official-surface parallel of errorMessage (the reference SDK reports
       *  error text as a string[]); always [errorMessage] in this engine. */
      errors?: string[];
      /** HTTP status when the run ended on an API error (e.g. 429, 529). */
      api_error_status?: number;
      /**
       * BPT-EXTENSION (SM-乙b): stable machine `code` of the underlying SDK
       * error (E6c ErrorCode string, e.g. 'api_connection_failed') on an
       * `error_during_execution` result. Lets a SessionManager classify a
       * recoverable-vs-terminal API failure by code, not by message text.
       * Absent for codeless failures and on non-error results.
       */
      error_code?: string;
      /**
       * Unified normalized upstream error (error normalization 2026-07-14).
       * Present when the run ended on an actual provider/transport failure
       * (`error_during_execution`); carries status / code / provider / model /
       * requestId / retryable in a STABLE shape so a host never has to parse
       * errorMessage or duck-type a raw gateway object. Absent for
       * max-turns / budget / refusal / structured-retry stops.
       */
      providerError?: NormalizedProviderError;
      /** Time to first token (ms); only present when a token actually arrived. */
      ttft_ms?: number;
      ttft_stream_ms?: number;
      /** NEW-IN-DOCS. typed-not-populated. */
      terminal_reason?: TerminalReason;
      /** NEW-IN-DOCS. typed-not-populated. */
      fast_mode_state?: FastModeState;
      /** NEW-IN-DOCS. typed-not-populated. */
      origin?: SDKMessageOrigin;
      /** v0.3 per-run budget/efficiency metrics. */
      metrics?: SDKRunMetrics;
    };

export type SDKSystemMessage = {
  type: 'system';
  subtype: 'init';
  uuid: string;
  session_id: string;
  apiKeySource: ApiKeySource;
  cwd: string;
  tools: string[];
  mcp_servers: Array<{ name: string; status: string }>;
  model: string;
  permissionMode: PermissionMode;
  slash_commands: string[];
  output_style: string;
  agents?: string[];
  claude_code_version?: string;
  betas?: string[];
  skills?: string[];
  plugins?: string[];
};

export type SDKCompactBoundaryMessage = {
  type: 'system';
  subtype: 'compact_boundary';
  uuid: string;
  session_id: string;
  compact_metadata: {
    trigger: 'manual' | 'auto';
    pre_tokens: number;
  };
};

// ---------------------------------------------------------------------------
// Observability / status message variants (v0.3 — task #16; re-encoded v0.7)
//
// Drop-in surface for the official SDKMessage union's observability arm.
// v0.7 (B2a/E8, KD-L35-02 retirement): the live official docs fully specify
// the discriminators — `type:'system'` + `subtype` for status /
// task_notification / hook_started / hook_progress / hook_response /
// task_started / task_progress / task_updated / files_persisted /
// local_command_output / commands_changed; TOP-LEVEL `type` for
// tool_use_summary / tool_progress / auth_status / rate_limit_event /
// prompt_suggestion. This union follows that split exactly (the pre-v0.7
// all-top-level encoding is gone — no runtime dual-emit; see
// docs/MIGRATION.md §4 item 5f). Payload fields follow the official names;
// BPT-only extras are marked as such per-field.
// Every message carries our house `uuid`/`session_id` envelope.
//
// EMITTED by this engine today: permission_denied (gate deny), rate_limit_event
// / api_retry (transport retries, v0.3), system/task_started / task_progress /
// task_updated / task_notification (subagent lifecycle, v0.4), system/
// hook_started / hook_response (hook lifecycle behind includeHookEvents, v0.4).
// The rest are TYPED for union exhaustiveness but have no source event in a
// headless engine with no plugins/skills/CC-host/slash-command framework; see
// docs/COMPAT.md for the emitted-vs-typed split.
// ---------------------------------------------------------------------------

/** A tool call the permission gate denied. EMITTED on every gate deny. */
export type SDKPermissionDeniedMessage = {
  type: 'permission_denied';
  uuid: string;
  session_id: string;
  tool_name: string;
  tool_use_id: string;
  /** The gate's human-readable denial reason. */
  reason: string;
  /** Coarse source of the block, when derivable (else omitted). */
  blocker?: 'rule' | 'mode' | 'hook' | 'canUseTool' | 'other';
};

/** Progress (0..100) from a long-running tool. Typed; not emitted. */
export type SDKToolProgressMessage = {
  type: 'tool_progress';
  uuid: string;
  session_id: string;
  tool_use_id: string;
  progress: number;
  status?: string;
  details?: Record<string, unknown>;
};

/** A compact summary of a completed tool call. Typed; not emitted. */
export type SDKToolUseSummaryMessage = {
  type: 'tool_use_summary';
  uuid: string;
  session_id: string;
  tool_name: string;
  tool_use_id: string;
  input_summary: string;
  result_summary: string;
};

/** A background task / subagent started (official `system`/`task_started`
 *  encoding, v0.7). EMITTED when the Agent tool spawns a subagent (foreground
 *  or background); task_id is the agentId. `task_type` is always
 *  'local_agent' (this engine spawns no local_bash/remote_agent tasks). */
export type SDKTaskStartedMessage = {
  type: 'system';
  subtype: 'task_started';
  uuid: string;
  session_id: string;
  task_id: string;
  tool_use_id?: string;
  description: string;
  task_type?: string;
};

/** Progress from a background task / subagent (official `system`/
 *  `task_progress` encoding, v0.7). EMITTED once per child assistant turn.
 *
 *  E8b ruling (2026-07-05): this message is a deliberate BPT SUPERSET of the
 *  official shape — the official fields (`description` / `subagent_type` /
 *  `usage` / `last_tool_name` / `summary`) are joined by BPT-only
 *  `progress` (share of the child's turn budget consumed, 0..99) and
 *  `status` (human-readable `turn N/M`). Foreground spawns do NOT
 *  additionally emit task_notification to mirror the official vocabulary
 *  (KD-L35-01 stands; COMPAT.md carries the ledger entry). */
export type SDKTaskProgressMessage = {
  type: 'system';
  subtype: 'task_progress';
  uuid: string;
  session_id: string;
  task_id: string;
  tool_use_id?: string;
  description: string;
  subagent_type?: string;
  usage: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
  last_tool_name?: string;
  summary?: string;
  /** BPT extension (E8b superset): turn-budget share consumed, 0..99. */
  progress: number;
  /** BPT extension (E8b superset): human-readable `turn N/M`. */
  status?: string;
  /** BPT extension (E8b superset). */
  blocked?: boolean;
};

/** Terminal update for a background task / subagent (official `system`/
 *  `task_updated` encoding with the official `patch` envelope, v0.7).
 *  EMITTED when a subagent finishes (patch.status completed/failed) or is
 *  stopped via stopTask (patch.status 'killed' — the official value; the
 *  pre-v0.7 'cancelled' is gone). Merge `patch` into a task map keyed by
 *  task_id; `end_time` is a Unix epoch timestamp in ms. */
export type SDKTaskUpdatedMessage = {
  type: 'system';
  subtype: 'task_updated';
  uuid: string;
  session_id: string;
  task_id: string;
  patch: {
    status?: 'pending' | 'running' | 'completed' | 'failed' | 'killed';
    description?: string;
    end_time?: number;
    total_paused_ms?: number;
    error?: string;
    is_backgrounded?: boolean;
  };
  /** BPT extension: bounded preview of the child's final text (the full text
   *  crosses via the Agent tool_result). */
  result?: string;
};

/** Background-task lifecycle notification (official `system`/
 *  `task_notification` encoding, v0.7). EMITTED for BACKGROUND subagents only
 *  (their terminal event otherwise has no stream anchor). `output_file` is
 *  required by the official shape but this engine writes no task output
 *  files, so it is always ''. */
export type SDKTaskNotificationMessage = {
  type: 'system';
  subtype: 'task_notification';
  uuid: string;
  session_id: string;
  task_id: string;
  tool_use_id?: string;
  status: 'completed' | 'failed' | 'stopped';
  output_file: string;
  summary: string;
  usage?: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
};

/** Hook execution began (official `system`/`hook_started` encoding, v0.7).
 *  EMITTED per hook callback invocation when options.includeHookEvents is
 *  true; hook_id pairs it with its hook_response. `hook_name` is the callback
 *  function's name ('callback' for anonymous callbacks — this engine runs
 *  in-process callbacks, not named command hooks). */
export type SDKHookStartedMessage = {
  type: 'system';
  subtype: 'hook_started';
  uuid: string;
  session_id: string;
  hook_id: string;
  hook_name: string;
  hook_event: HookEvent;
};

/** Hook execution progress (official `system`/`hook_progress` encoding,
 *  v0.7). Typed; not emitted (callbacks are opaque promises — there is no
 *  honest stdout/stderr/progress source mid-callback). */
export type SDKHookProgressMessage = {
  type: 'system';
  subtype: 'hook_progress';
  uuid: string;
  session_id: string;
  hook_id: string;
  hook_name: string;
  hook_event: HookEvent;
  stdout: string;
  stderr: string;
  output: string;
};

/** Hook execution finished (official `system`/`hook_response` encoding,
 *  v0.7). EMITTED when options.includeHookEvents is true. `output` is the
 *  callback output as bounded JSON ('' for void outputs); a failure/timeout
 *  surfaces on `stderr` with outcome 'error' (outer-signal cancellation:
 *  'cancelled'). `stdout` is always '' and `exit_code` absent — in-process
 *  callbacks have no stdio/exit code. */
export type SDKHookResponseMessage = {
  type: 'system';
  subtype: 'hook_response';
  uuid: string;
  session_id: string;
  hook_id: string;
  hook_name: string;
  hook_event: HookEvent;
  output: string;
  stdout: string;
  stderr: string;
  exit_code?: number;
  outcome: 'success' | 'error' | 'cancelled';
};

/** File checkpoints persisted to disk (official `system`/`files_persisted`
 *  encoding + official payload, v0.7). Typed; not emitted. */
export type SDKFilesPersistedEvent = {
  type: 'system';
  subtype: 'files_persisted';
  uuid: string;
  session_id: string;
  files: Array<{ filename: string; file_id: string }>;
  failed: Array<{ filename: string; error: string }>;
  processed_at: string;
};

/** @deprecated Use the official export name SDKFilesPersistedEvent (v0.7
 *  spelling swap; the payload now follows the official shape). */
export type SDKFilesPersistedMessage = SDKFilesPersistedEvent;

/** Output of a local slash-command run (official `system`/
 *  `local_command_output` encoding + official payload, v0.7). Typed; not
 *  emitted. */
export type SDKLocalCommandOutputMessage = {
  type: 'system';
  subtype: 'local_command_output';
  uuid: string;
  session_id: string;
  content: string;
};

/** The available slash-command set changed (official `system`/
 *  `commands_changed` encoding + official `commands` field, v0.7). Typed;
 *  not emitted. */
export type SDKCommandsChangedMessage = {
  type: 'system';
  subtype: 'commands_changed';
  uuid: string;
  session_id: string;
  commands: SlashCommand[];
};

/** A rate limit was hit and a retry scheduled. EMITTED (v0.3) via the
 *  transport's per-request onRetry observer on each 429 retry. Top-level
 *  `type` matches the official discriminator and (since B2b, 2026-07-05) the
 *  payload carries the official `rate_limit_info` envelope.
 *
 *  KD-12 note (semantics deliberately NOT force-aligned): the official CLI
 *  emits this event for account/quota STATUS updates and emits `api_retry`
 *  on an actual 429; this engine has no quota-status feed, so it emits this
 *  event per 429 retry (status is therefore always 'rejected', with
 *  `resetsAt` derived from the server's real Retry-After when present).
 *  `utilization` / `errorCode` / credits fields have no data source here and
 *  are honestly absent. See docs/COMPAT.md. */
export type SDKRateLimitEvent = {
  type: 'rate_limit_event';
  uuid: string;
  session_id: string;
  /** Official envelope. */
  rate_limit_info: {
    status: 'allowed' | 'allowed_warning' | 'rejected';
    /** Unix seconds when the limit is expected to lift (from Retry-After). */
    resetsAt?: number;
    utilization?: number;
    errorCode?: 'credits_required';
    canUserPurchaseCredits?: boolean;
    hasChargeableSavedPaymentMethod?: boolean;
  };
  /** @deprecated Pre-alignment flat field (dual-track); use
   *  rate_limit_info.resetsAt. Still populated at the emit site. */
  retry_after_ms?: number;
  /** @deprecated Pre-alignment flat field (dual-track); always 'api'. */
  limit_type?: 'api' | 'token' | 'requests';
  /** @deprecated Pre-alignment flat field; never populated. */
  requests_remaining?: number;
  /** Unified normalized upstream error for this 429 (error normalization
   *  2026-07-14): stable status/code/provider/model/requestId/retryAfterMs the
   *  host can consume without parsing. Additive. */
  providerError?: NormalizedProviderError;
};

/** @deprecated Use the official export name SDKRateLimitEvent (v0.7 spelling
 *  swap). */
export type SDKRateLimitEventMessage = SDKRateLimitEvent;

/** An API call is being retried. EMITTED (v0.3) via the transport's onRetry
 *  observer on each non-429 (5xx/network) retry, and by the engine's bounded
 *  turn-replay. */
export type SDKAPIRetryMessage = {
  type: 'api_retry';
  uuid: string;
  session_id: string;
  attempt: number;
  max_retries: number;
  status?: number;
  reason?: string;
  /** Whether the failure being retried is retryable (always true on an emitted
   *  api_retry — a retry is in progress). Additive (error normalization
   *  2026-07-14). */
  retryable?: boolean;
  /** Retries left in this budget after the current one. Additive. */
  retry_remaining?: number;
  /** Short machine reason for the retry (error type / kind / http_<status> /
   *  turn_replay:<code>). Additive. */
  retry_reason?: string;
  /** Unified normalized upstream error for this retry: stable status / code /
   *  provider / model / requestId the host can consume without parsing.
   *  Additive. */
  providerError?: NormalizedProviderError;
};

/** @deprecated Use the official export name SDKAPIRetryMessage (v0.7
 *  capitalization swap). */
export type SDKApiRetryMessage = SDKAPIRetryMessage;

/** Authentication status. Typed; not emitted. */
export type SDKAuthStatusMessage = {
  type: 'auth_status';
  uuid: string;
  session_id: string;
  status: 'authenticated' | 'unauthenticated' | 'expired';
  provider?: string;
};

/** A server-initiated elicitation resolved. Typed; not emitted. */
export type SDKElicitationCompleteMessage = {
  type: 'elicitation_complete';
  uuid: string;
  session_id: string;
  elicitation_id: string;
  result: 'accepted' | 'declined' | 'error';
  value?: unknown;
  error?: string;
};

/** A free-form informational log surfaced into the stream. EMITTED since the
 *  2026-07-10 audit batch: once after init for ACCEPTED-IGNORED options present
 *  on the call, and for OpenAI-protocol knobs the wire cannot honor
 *  (unpriceable maxBudgetUsd / dropped thinking / ignored betas+apiVersion). */
export type SDKInformationalMessage = {
  type: 'informational';
  uuid: string;
  session_id: string;
  level: 'info' | 'warning' | 'debug';
  message: string;
  details?: Record<string, unknown>;
};

/** A user-facing notification. Typed; not emitted. */
export type SDKNotificationMessage = {
  type: 'notification';
  uuid: string;
  session_id: string;
  level: 'info' | 'warning' | 'error';
  title: string;
  message: string;
};

/** A suggested next prompt (gated by promptSuggestions). Typed; not emitted. */
export type SDKPromptSuggestionMessage = {
  type: 'prompt_suggestion';
  uuid: string;
  session_id: string;
  suggestion: string;
  reasoning?: string;
};

/** A memory item recalled into context. Typed; not emitted. */
export type SDKMemoryRecallMessage = {
  type: 'memory_recall';
  uuid: string;
  session_id: string;
  context: string;
  source: 'user' | 'project' | 'local';
  confidence?: number;
};

/** The worker is shutting down. Typed; not emitted. */
export type SDKWorkerShuttingDownMessage = {
  type: 'worker_shutting_down';
  uuid: string;
  session_id: string;
  graceful: boolean;
  reason?: string;
};

/** Plugin install lifecycle. Typed; not emitted. */
export type SDKPluginInstallMessage = {
  type: 'plugin_install';
  uuid: string;
  session_id: string;
  plugin_name: string;
  status: 'installing' | 'installed' | 'failed' | 'completed';
  error?: string;
};

/** Session state transition. Typed; not emitted. */
export type SDKSessionStateChangedMessage = {
  type: 'session_state_changed';
  uuid: string;
  session_id: string;
  state: 'active' | 'paused' | 'completed';
  reason?: string;
};

/** A coarse engine status (canonical `system`/`status` form). Typed; not emitted. */
export type SDKStatusMessage = {
  type: 'system';
  subtype: 'status';
  uuid: string;
  session_id: string;
  status: string | null;
  details?: Record<string, unknown>;
};
