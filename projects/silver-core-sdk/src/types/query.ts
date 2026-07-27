/**
 * Silver Core SDK 公开类型面 — query 接口 / SessionManager / 会话信息。
 *
 * 自 src/types.ts 按其自带的分节切出（结构审视 P7，2026-07-27）：切分依据是文件
 * 原本就标好的分节注释，不是新发明的边界。src/types.ts 保留为 barrel，所有
 * `from '../types.js'` 的既有 import 一行未动。
 *
 * 溯源与合规声明见 src/types.ts 头注（clean-room，仅据公开文档）。
 */

import type { McpServerConfig, McpServerStatus } from './mcp.js';
import type { ApiKeySource, FastModeState, SDKUserMessage } from './messages.js';
import type { Options, SDKMemoryHealth } from './options.js';
import type { PermissionMode } from './permissions.js';
import type { SDKMessage } from './prompt.js';
import type { McpSetServersResult, RetainedRegion, RewindFilesResult } from './subsystems.js';
import type { ModelUsage, NonNullableUsage } from './wire.js';

// ---------------------------------------------------------------------------
// Query interface
// ---------------------------------------------------------------------------

export type ModelInfo = {
  /** Model id/alias (official field name; consumers read `.value`). */
  value: string;
  resolvedModel?: string;
  displayName?: string;
  description?: string;
  supportsEffort?: boolean;
};

export type SlashCommand = {
  name: string;
  description: string;
  argumentHint: string;
  aliases?: string[];
};

export type AgentInfo = {
  name: string;
  description?: string;
};

export type AccountInfo = {
  apiKeySource: ApiKeySource;
  // Surface parity with the official SDK. Not populated by the direct-API
  // engine (no CLI account introspection channel); typed so consumers that
  // read these fields narrow correctly instead of hitting `never`.
  email?: string;
  organization?: string;
  subscriptionType?: string;
  tokenSource?: string;
};

/** Payload of Query.initializationResult() / reinitialize() (official export
 *  name since v0.7). */
export type SDKControlInitializeResponse = {
  commands: SlashCommand[];
  agents: AgentInfo[];
  output_style: string;
  available_output_styles: string[];
  models: ModelInfo[];
  account: AccountInfo;
  /** NEW-IN-DOCS. typed-not-populated. */
  fast_mode_state?: FastModeState;
};

/** @deprecated Use the official export name SDKControlInitializeResponse
 *  (v0.7 spelling swap). */
export type SDKInitializationResult = SDKControlInitializeResponse;

/** Control request: fetch the current plan (official control-protocol subtype
 *  `get_plan`, NEW-IN-DOCS 0.3.205). Typed for surface parity; N/A-by-design —
 *  this direct-API engine has no control_request wire protocol to receive it
 *  (same posture as reinitialize/applyFlagSettings). */
export type SDKControlGetPlanRequest = {
  subtype: 'get_plan';
};

/** Control request: fetch the current workspace diff (official control-protocol
 *  subtype `get_workspace_diff`, NEW-IN-DOCS 0.3.205). Typed for surface parity;
 *  N/A-by-design — no control_request wire protocol here, and no diff engine. */
export type SDKControlGetWorkspaceDiffRequest = {
  subtype: 'get_workspace_diff';
};

/** Payload of Query.interrupt() (official control-response shape, NEW-IN-DOCS
 *  0.3.205 — interrupt() moved from `void` to this typed receipt).
 *
 *  `still_queued` lists the uuids of async user messages that survive the
 *  interrupt (queued commands, plus a batch already dequeued for the imminent
 *  turn). In this engine (L2-5, audit 2026-07-17) it reports the uuid-stamped
 *  user messages still buffered in the streaming-input queue — those survive
 *  the interrupt and will drive future turns. Messages pushed without a uuid
 *  cannot be listed by uuid and are omitted, so an empty array does not mean
 *  "nothing will run" (per the official coverage caveat). */
export type SDKControlInterruptResponse = {
  still_queued: string[];
};

export interface Query extends AsyncGenerator<SDKMessage, void> {
  /**
   * Interrupt the running turn. In streaming-input mode this aborts the
   * active turn and the session accepts further input; in string mode it
   * aborts the run and the generator yields a terminal
   * `error_during_execution` result. Honored between turns via an
   * interrupt-requested flag when no turn is currently active.
   *
   * Returns the official interrupt receipt (0.3.205): `still_queued` lists the
   * uuids of async user messages that survive the interrupt — here, the
   * uuid-stamped user messages still buffered in the streaming-input queue
   * (see SDKControlInterruptResponse). Callers that `await q.interrupt()` and
   * ignore the result are unaffected.
   */
  interrupt(): Promise<SDKControlInterruptResponse>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  initializationResult(): Promise<SDKControlInitializeResponse>;
  supportedCommands(): Promise<SlashCommand[]>;
  supportedModels(): Promise<ModelInfo[]>;
  supportedAgents(): Promise<AgentInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  accountInfo(): Promise<AccountInfo>;
  /** Reconnect a configured MCP server by name. */
  reconnectMcpServer(serverName: string): Promise<void>;
  /** Enable/disable a configured MCP server at runtime. */
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>;
  /** Replace the live MCP server set; returns the new statuses. */
  setMcpServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult>;
  /**
   * Restore files to their state at the given user-message checkpoint.
   * Requires options.enableFileCheckpointing. dryRun computes the plan
   * without touching disk. Does NOT rewind the conversation.
   */
  rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>;
  /** Stop a background subagent task by id (no-op + debug warn when unknown). */
  stopTask(taskId: string): Promise<void>;
  /**
   * Snapshot of the run's live memory counters (SDKMemoryHealth), or null
   * when the memory system is not enabled for this query. Readable at any
   * time — including AFTER the stream ended or threw — so a host can check
   * `sessionEndUpdate` even on abort/cap paths where no result could carry
   * the final value, and compensate for a missed write-back (keeper
   * 2026-07-20, BPT memory-rot diagnosis).
   */
  memoryHealthSnapshot(): SDKMemoryHealth | null;
  /**
   * Declare (or replace, by id) a compaction retained region (R3): its content
   * survives every automatic compaction verbatim. Throws `ConfigurationError`
   * when the declaration would push the regions over
   * `compaction.retainedRegionMaxBytes` — never silently truncated.
   */
  setRetainedRegion(region: RetainedRegion): void;
  /** Remove a retained region by id; false when no such region exists. */
  removeRetainedRegion(id: string): boolean;
  /** Push an additional user-message stream into a streaming-input session. */
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  close(): void;
}

// ---------------------------------------------------------------------------
// SessionManager (BPT-EXTENSION: in-process multi-conversation coordinator)
// ---------------------------------------------------------------------------

/**
 * BPT-EXTENSION: recovery/supervision knobs for a SessionManager (SM-乙b,
 * proposal §6). Effective on mgr.query() when ALL of the following hold:
 * an external `sessionStore` is attached (shared options or per-query — no
 * store means nowhere to resume from, R2), the prompt is a string (v1 scope:
 * streaming-input conversations own their input channel and are not
 * supervised), and `autoResume` is not false. A supervised query that fails
 * with a RECOVERABLE error (§6.1: APIConnectionError, MCP connection-class
 * McpError, or APIStatusError 429/5xx after transport retries) is transparently
 * re-driven from the store via resume, up to `maxResumes` times; terminal
 * errors (abort/config/4xx/unknown) always rethrow untouched. When the bound
 * is exhausted the LAST error is rethrown with a `resumeAttempts` field
 * attached (same error object, never re-wrapped).
 */
export type SessionRecoveryOptions = {
  /** Auto-resume recoverable failures (default on once a store is attached). */
  autoResume?: boolean;
  /** Bounded resume attempts per query (supervision default: 2). */
  maxResumes?: number;
};

/**
 * BPT-EXTENSION: options for createBptSession(). The official
 * @anthropic-ai/claude-agent-sdk has no in-process multi-conversation
 * coordinator — its coordination lives inside the CLI host process, invisible
 * to SDK callers. Here the shared layer (one transport + one MCP connection
 * pool) is configured once and every mgr.query() borrows it.
 */
export type SessionManagerOptions = Options & {
  /** Supervised auto-resume knobs (SM-乙b, proposal §6). See
   *  SessionRecoveryOptions for the activation conditions. */
  recovery?: SessionRecoveryOptions;
};

/** BPT-EXTENSION: read-only cross-conversation usage aggregate (D2: view
 *  only — no hard cross-conversation budget cap in v1). */
export type SessionManagerUsage = {
  /** Sum of every managed conversation's cumulative estimated cost (USD). */
  totalCostUsd: number;
  /** Token totals summed across all managed conversations. */
  usage: NonNullableUsage;
  /** Per-model totals merged across all managed conversations. */
  modelUsage: Record<string, ModelUsage>;
  /** Number of mgr.query() calls issued so far (open or finished). */
  queries: number;
};

/**
 * BPT-EXTENSION: in-process object-level coordinator (proposal
 * bpt-sdk-session-manager-20260706, 层一). Owns one shared AnthropicTransport
 * and one shared MCP registry; queries created through it borrow both.
 * Lifecycle contract (§4.2): the manager owns the shared connections —
 * queries never close them; close() is the single teardown point.
 */
export interface SessionManager {
  /**
   * Start a managed conversation. Same shape as the standalone query();
   * per-query options may override per-conversation knobs, but `provider` and
   * `mcpServers` come from the shared layer — passing either throws
   * ConfigurationError (D1: no private per-query MCP overlay in v1).
   * Throws ConfigurationError after close().
   */
  query(args: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options?: Options;
  }): Query;
  /** Read-only aggregated usage/cost across all managed conversations. */
  usage(): SessionManagerUsage;
  /** Tear down the shared connections. Idempotent. After it resolves,
   *  further query() calls throw ConfigurationError. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Session info (listSessions surface)
// ---------------------------------------------------------------------------

export type SDKSessionInfo = {
  sessionId: string;
  summary: string;
  lastModified: number;
  fileSize?: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
  tag?: string;
  createdAt?: number;
};
