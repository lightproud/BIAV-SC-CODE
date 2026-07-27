/**
 * Silver Core SDK 公开类型面 — 提示词组装（BPT 扩展）。
 *
 * 自 src/types.ts 按其自带的分节切出（结构审视 P7，2026-07-27）：切分依据是文件
 * 原本就标好的分节注释，不是新发明的边界。src/types.ts 保留为 barrel，所有
 * `from '../types.js'` 的既有 import 一行未动。
 *
 * 溯源与合规声明见 src/types.ts 头注（clean-room，仅据公开文档）。
 */

import type { SDKAPIRetryMessage, SDKAssistantMessage, SDKAuthStatusMessage, SDKCommandsChangedMessage, SDKCompactBoundaryMessage, SDKElicitationCompleteMessage, SDKFilesPersistedEvent, SDKHookProgressMessage, SDKHookResponseMessage, SDKHookStartedMessage, SDKInformationalMessage, SDKLocalCommandOutputMessage, SDKMemoryRecallMessage, SDKNotificationMessage, SDKPartialAssistantMessage, SDKPermissionDeniedMessage, SDKPluginInstallMessage, SDKPromptSuggestionMessage, SDKRateLimitEvent, SDKResultMessage, SDKSessionStateChangedMessage, SDKStatusMessage, SDKSystemMessage, SDKTaskNotificationMessage, SDKTaskProgressMessage, SDKTaskStartedMessage, SDKTaskUpdatedMessage, SDKToolProgressMessage, SDKToolUseSummaryMessage, SDKUserMessage, SDKUserMessageReplay, SDKWorkerShuttingDownMessage } from './messages.js';
import type { SDKMirrorErrorMessage } from './subsystems.js';

// ---------------------------------------------------------------------------
// Prompt composition (BPT-EXTENSION, spec 2026-07-09)
// ---------------------------------------------------------------------------

/** One estimated per-part entry of a prompt composition. */
export type PromptCompositionPart = {
  /** Caller/role label, when known (e.g. 'append', 'environment', a host layer). */
  label?: string;
  estTokens: number;
};

/**
 * 需求 A: the request decomposed into estimated per-part token counts, using
 * the SDK's own estimator (engine/tokens.ts) so the numbers share the same
 * context-window accounting the compaction layer uses. Every count is an
 * ESTIMATE (exact per-segment truth needs the API `count_tokens` endpoint).
 */
export type PromptComposition = {
  /** The preset/base harness (or a bare string systemPrompt). 0 for the host
   *  `segments` form, which has no engine-owned base. */
  systemBase: { estTokens: number };
  /** Each appended stable/volatile system part, in wire order, with its label. */
  systemAppend: PromptCompositionPart[];
  toolDefs: { estTokens: number; count: number };
  messages: { estTokens: number; count: number };
  /** Sum of every bucket above. */
  totalEstTokens: number;
  /** EXACT wire-content byte sizes (UTF-8), complementary to the token
   *  estimates above (BPT-EXTENSION 2026-07-12). Unlike estTokens these are
   *  not estimates — they measure the assembled request's actual bytes, which
   *  a host sizing against a byte envelope (or a byte-precise panel) needs.
   *  `system` is the whole system field; `total` is system+toolDefs+messages. */
  bytes: { system: number; toolDefs: number; messages: number; total: number };
};

/** 需求 B: one cache_control breakpoint and the estimated size of the prefix
 *  it seals (tools → system → messages prefix order). */
export type CacheBreakpoint = {
  /** Which part the sealed prefix ends at: 'toolDefs' | 'systemBase' |
   *  'systemAppend[i]' | 'messages[last]'. */
  afterPart: string;
  /** Estimated tokens in the whole prefix up to and including `afterPart`. */
  prefixEstTokens: number;
};

/** The full build-time description of a request: per-part estimate + cache map. */
export type RequestComposition = {
  promptComposition: PromptComposition;
  cacheBreakpoints: CacheBreakpoint[];
};

/**
 * BPT-EXTENSION: emitted just before each request is sent when
 * `options.includePromptComposition` is true. Carries the SDK's own per-part
 * token estimate (需求 A) and the request's cache-breakpoint map (需求 B), so a
 * "context composition" panel can use the SDK's exact segmentation instead of
 * reverse-engineering a transcript, and map the API's real usage counts onto
 * content buckets. The wire request is unaffected by this message.
 */
export type SDKPromptCompositionMessage = {
  type: 'system';
  subtype: 'prompt_composition';
  uuid: string;
  session_id: string;
  /** Model this request targets (the composition is per-request). */
  model: string;
  promptComposition: PromptComposition;
  cacheBreakpoints: CacheBreakpoint[];
};

/** The full live background-task set after a membership change (official
 *  `system`/`background_tasks_changed` encoding, NEW-IN-DOCS 0.3.203). REPLACE
 *  semantics: a consumer swaps its whole task set for `tasks`. TYPED, not
 *  emitted — this engine's background tasks are shells (BashOutput/TaskOutput
 *  over the ShellManager), the candidate source, but no membership-change emit
 *  is wired (the shell registry has no change-notification channel into the
 *  pull-based stream; task lifecycle rides task_started/task_updated instead). */
export type SDKBackgroundTasksChangedMessage = {
  type: 'system';
  subtype: 'background_tasks_changed';
  uuid: string;
  session_id: string;
  tasks: {
    task_id: string;
    task_type: string;
    description: string;
  }[];
};

/** Progress on an in-flight control_request (official `system`/
 *  `control_request_progress` encoding, NEW-IN-DOCS 0.3.205). TYPED, not
 *  emitted — this direct-API engine has no control_request wire protocol
 *  (N/A-by-design, like reinitialize/applyFlagSettings), so there is no
 *  in-flight control request to report progress for. */
export type SDKControlRequestProgressMessage = {
  type: 'system';
  subtype: 'control_request_progress';
  uuid: string;
  session_id: string;
  /** request_id of the in-flight control_request this progress belongs to. */
  request_id: string;
  status: 'started' | 'api_retry';
  attempt?: number;
  max_retries?: number;
  retry_delay_ms?: number;
  error_status?: number | null;
};

/**
 * The observability / status arm of the SDKMessage union (task #16; official
 * discriminator split since v0.7 — see the section banner above for the
 * `system`+subtype vs top-level `type` partition and the emitted-vs-typed
 * split in docs/COMPAT.md).
 */
export type SDKObservabilityMessage =
  | SDKPermissionDeniedMessage
  | SDKToolProgressMessage
  | SDKToolUseSummaryMessage
  | SDKTaskStartedMessage
  | SDKTaskProgressMessage
  | SDKTaskUpdatedMessage
  | SDKTaskNotificationMessage
  | SDKHookStartedMessage
  | SDKHookProgressMessage
  | SDKHookResponseMessage
  | SDKFilesPersistedEvent
  | SDKLocalCommandOutputMessage
  | SDKCommandsChangedMessage
  | SDKRateLimitEvent
  | SDKAPIRetryMessage
  | SDKAuthStatusMessage
  | SDKElicitationCompleteMessage
  | SDKInformationalMessage
  | SDKNotificationMessage
  | SDKPromptSuggestionMessage
  | SDKMemoryRecallMessage
  | SDKWorkerShuttingDownMessage
  | SDKPluginInstallMessage
  | SDKSessionStateChangedMessage
  | SDKPromptCompositionMessage
  | SDKBackgroundTasksChangedMessage
  | SDKControlRequestProgressMessage
  | SDKStatusMessage;

/** The engine's active goal loop state (official `active_goal` encoding,
 *  NEW-IN-DOCS 0.3.205; `value: null` clears it). TYPED, not emitted — this
 *  headless engine runs no persistent goal/condition loop to report. */
export type SDKActiveGoalMessage = {
  type: 'active_goal';
  uuid: string;
  session_id: string;
  value: {
    condition: string;
    iterations: number;
    set_at: number;
    tokens_at_start: number;
    last_reason?: string;
  } | null;
};

/** A conversation-reset boundary carrying the id of the fresh conversation
 *  (official `conversation_reset` encoding, NEW-IN-DOCS 0.3.205). TYPED, not
 *  emitted — this engine does not reset a conversation mid-stream (a new
 *  conversation is a new query()/session, not an in-stream boundary). */
export type SDKConversationResetMessage = {
  type: 'conversation_reset';
  uuid: string;
  session_id: string;
  new_conversation_id: string;
};

export type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKCompactBoundaryMessage
  | SDKMirrorErrorMessage
  | SDKPartialAssistantMessage
  | SDKActiveGoalMessage
  | SDKConversationResetMessage
  | SDKObservabilityMessage;
