/**
 * BPT Agent SDK - internal module contracts.
 *
 * Every module implements against these interfaces and imports types ONLY
 * from '../types.js', '../errors.js' and this file. This keeps the seven
 * implementation modules independently buildable and testable.
 */

import type {
  APIMessageParam,
  APIToolDefinition,
  ApiKeySource,
  CallToolResult,
  HookEvent,
  HookInput,
  ImageBlockParam,
  JSONSchema,
  McpServerStatus,
  PermissionMode,
  PermissionUpdate,
  RawMessageStreamEvent,
  SDKPermissionDenial,
  TextBlockParam,
  ThinkingConfigParam,
} from '../types.js';

// ---------------------------------------------------------------------------
// Transport (module A)
// ---------------------------------------------------------------------------

export type StreamRequest = {
  model: string;
  max_tokens: number;
  system?: string | TextBlockParam[];
  messages: APIMessageParam[];
  tools?: APIToolDefinition[];
  thinking?: { type: 'enabled'; budget_tokens: number } | { type: 'disabled' };
  temperature?: number;
  signal?: AbortSignal;
};

export interface Transport {
  /**
   * Stream one Messages API call. Yields raw SSE events in order. Throws
   * AbortError on cancellation, APIStatusError on non-retryable API errors,
   * APIConnectionError when the network fails after retries.
   */
  stream(req: StreamRequest): AsyncGenerator<RawMessageStreamEvent, void>;
  /** Where the credential came from (for the init message). */
  apiKeySource(): ApiKeySource;
}

// ---------------------------------------------------------------------------
// Built-in tools (modules C, D)
// ---------------------------------------------------------------------------

export type ToolResultPayload = {
  content: string | Array<TextBlockParam | ImageBlockParam>;
  isError?: boolean;
};

export type ToolContext = {
  cwd: string;
  additionalDirectories: string[];
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  /** Debug logger (wired to options.stderr when debug is on). */
  debug: (msg: string) => void;
};

export interface BuiltinTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  /** Never mutates state; auto-approved in every permission mode. */
  readOnly: boolean;
  /** Mutates files; auto-approved under acceptEdits. */
  isFileEdit?: boolean;
  execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload>;
}

// ---------------------------------------------------------------------------
// Permission gate (module E)
// ---------------------------------------------------------------------------

export type GateHookDecision = {
  decision?: 'allow' | 'deny' | 'ask';
  reason?: string;
  updatedInput?: Record<string, unknown>;
};

export type PermissionCheckResult =
  | { decision: 'allow'; updatedInput: Record<string, unknown> }
  | { decision: 'deny'; message: string; interrupt?: boolean };

export interface PermissionGate {
  /**
   * Full evaluation pipeline for one tool call. Order:
   *  1. hook deny -> deny
   *  2. disallowedTools rule (original input) -> deny
   *  3. hook allow -> re-check disallowedTools against hook.updatedInput,
   *     deny if it now matches else allow (hook updatedInput wins)
   *  4. allowedTools rule -> allow, EXCEPT in plan mode a non-readOnly tool
   *     does not qualify (falls through to the step-6 plan deny)
   *  5. mode bypassPermissions -> allow
   *  6. mode plan -> readOnly ? allow : deny
   *  7. mode acceptEdits && (readOnly || isFileEdit) -> allow
   *  8. mode default/dontAsk && readOnly -> allow
   *  9. otherwise (or hook 'ask'): canUseTool if provided (called with the
   *     hook 'ask' updatedInput when present); on allow, re-check
   *     disallowedTools against the effective input, deny if it now matches
   *     (no session updates applied) else apply updates + allow; else deny.
   *     dontAsk mode never prompts and denies here.
   * A hook 'ask' skips the auto-allow outcomes of steps 3-8 (deny outcomes
   * still apply) and forces the step-9 canUseTool path.
   * Every deny is recorded and retrievable via denials().
   */
  check(
    toolName: string,
    input: Record<string, unknown>,
    opts: {
      toolUseID: string;
      signal: AbortSignal;
      readOnly: boolean;
      isFileEdit: boolean;
      hook?: GateHookDecision;
      decisionReason?: string;
    },
  ): Promise<PermissionCheckResult>;
  setMode(mode: PermissionMode): void;
  getMode(): PermissionMode;
  applyUpdates(updates: PermissionUpdate[]): void;
  denials(): SDKPermissionDenial[];
}

// ---------------------------------------------------------------------------
// Hook runner (module E)
// ---------------------------------------------------------------------------

export type AggregatedHookResult = {
  /** false when any hook returned continue:false. */
  continue: boolean;
  stopReason?: string;
  systemMessages: string[];
  /** Aggregated permission decision: deny > ask > allow. */
  decision?: 'allow' | 'deny' | 'ask';
  decisionReason?: string;
  /** Last allow-hook updatedInput wins. */
  updatedInput?: Record<string, unknown>;
  additionalContext: string[];
  updatedToolOutput?: unknown;
};

export interface HookRunner {
  hasHooks(event: HookEvent): boolean;
  /**
   * Run all matching hooks for the event in parallel and aggregate.
   * matchValue is compared against each matcher (tool name for tool hooks).
   * When matchValue is undefined, every registered matcher for the event runs.
   */
  run(
    event: HookEvent,
    input: HookInput,
    toolUseID: string | undefined,
    matchValue: string | undefined,
    signal: AbortSignal,
  ): Promise<AggregatedHookResult>;
}

// ---------------------------------------------------------------------------
// MCP registry (module F)
// ---------------------------------------------------------------------------

export type McpToolEntry = {
  /** Fully qualified: mcp__{serverName}__{toolName}. */
  qualifiedName: string;
  serverName: string;
  toolName: string;
  description?: string;
  inputSchema: JSONSchema;
};

export interface McpRegistry {
  /** Connect all configured servers (parallel, per-server timeout). */
  connectAll(): Promise<void>;
  statuses(): McpServerStatus[];
  /** All tools across connected servers (empty before connectAll). */
  allTools(): McpToolEntry[];
  has(qualifiedName: string): boolean;
  call(
    qualifiedName: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallToolResult>;
  reconnect(serverName: string): Promise<void>;
  setEnabled(serverName: string, enabled: boolean): void;
  closeAll(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Engine (module B)
// ---------------------------------------------------------------------------

export type EngineConfig = {
  model: string;
  fallbackModel?: string;
  maxOutputTokens: number;
  systemPrompt: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  thinking?: ThinkingConfigParam;
  maxThinkingTokens?: number;
  includePartialMessages: boolean;
  sessionId: string;
  cwd: string;
};

export type EngineDeps = {
  transport: Transport;
  builtinTools: Map<string, BuiltinTool>;
  mcp: McpRegistry;
  permissions: PermissionGate;
  hooks: HookRunner;
  toolContext: ToolContext;
  debug: (msg: string) => void;
};

// ---------------------------------------------------------------------------
// Session store (module G)
// ---------------------------------------------------------------------------

export type StoredSession = {
  sessionId: string;
  messages: APIMessageParam[];
  createdAt: number;
  lastModified: number;
  firstPrompt?: string;
  cwd?: string;
};

export interface SessionStore {
  append(sessionId: string, entry: Record<string, unknown>): void;
  load(sessionId: string): Promise<StoredSession | null>;
  list(): Promise<StoredSession[]>;
  latestSessionId(): Promise<string | null>;
}
