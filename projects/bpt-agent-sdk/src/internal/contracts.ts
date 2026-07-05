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
  DocumentBlockParam,
  HookEvent,
  HookInput,
  ImageBlockParam,
  JSONSchema,
  McpResource,
  McpResourceContent,
  McpServerConfig,
  McpServerStatus,
  McpSetServersResult,
  OutputFormatConfig,
  PermissionMode,
  PermissionUpdate,
  RawMessageStreamEvent,
  SandboxContext,
  SDKMessage,
  SDKPermissionDenial,
  TextBlockParam,
  ThinkingConfigParam,
  ToolAnnotations,
  UserQuestionHandler,
  WebSearchHandler,
} from '../types.js';

// ---------------------------------------------------------------------------
// Transport (module A)
// ---------------------------------------------------------------------------

/** Retry-attempt info the transport surfaces so the loop can emit
 * rate_limit_event / api_retry observability messages. */
export type RetryInfo = {
  attempt: number;
  maxRetries: number;
  /** HTTP status that triggered the retry; absent for a network-level retry. */
  status?: number;
  /** Milliseconds the server asked us to wait (Retry-After), when present. */
  retryAfterMs?: number;
  /** API error type (e.g. 'rate_limit_error', 'overloaded_error') when known. */
  errorType?: string;
};

export type StreamRequest = {
  model: string;
  max_tokens: number;
  system?: string | TextBlockParam[];
  messages: APIMessageParam[];
  tools?: APIToolDefinition[];
  thinking?:
    | { type: 'adaptive' }
    | { type: 'enabled'; budget_tokens: number }
    | { type: 'disabled' };
  temperature?: number;
  signal?: AbortSignal;
  /** Per-request retry observer; the transport calls it on each retry. Not
   * serialized into the request body. */
  onRetry?: (info: RetryInfo) => void;
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
  content: string | Array<TextBlockParam | ImageBlockParam | DocumentBlockParam>;
  isError?: boolean;
};

export type ToolContext = {
  cwd: string;
  additionalDirectories: string[];
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  /** Debug logger (wired to options.stderr when debug is on). */
  debug: (msg: string) => void;
  /** v0.2 subagent spawn callback (wired by the subagent runtime). */
  spawnSubagent?: SpawnSubagentFn;
  /**
   * FORK support: return a shallow copy of the parent loop's CURRENT request
   * messages so the Agent tool can EAGERLY snapshot the parent context at spawn
   * time (a fork child continues from the parent's cached prefix). Installed by
   * the engine loop on its own toolContext; absent when no live parent loop is
   * wired (fork then degrades to isolated).
   */
  getForkHistory?: () => APIMessageParam[];
  /** v0.2 WebSearch backend; undefined -> the tool returns a not-configured error. */
  webSearch?: WebSearchHandler;
  /** v0.2 AskUserQuestion handler; undefined -> the tool returns a not-configured error. */
  askUser?: UserQuestionHandler;
  /** MCP resources access; undefined when no MCP registry is wired. */
  mcpResources?: {
    list(server: string | undefined, signal: AbortSignal): Promise<McpResource[]>;
    read(server: string, uri: string, signal: AbortSignal): Promise<McpResourceContent[]>;
  };
  /** v0.2 WebFetch escape hatch for localhost/private hosts (default false). */
  allowPrivateWebFetch?: boolean;
  /** Injectable fetch for tests; defaults to globalThis.fetch when undefined. */
  fetchImpl?: typeof fetch;
  /**
   * File-checkpoint recorder. When enableFileCheckpointing is on, fs tools
   * (Write/Edit) call this BEFORE mutating a file so the pre-image is captured.
   * `preImage` is the current UTF-8 content, or null when the file does not
   * yet exist. Synchronous + best-effort - implementations must never throw.
   */
  recordFileChange?: (absPath: string, preImage: string | null) => void;
  /** v0.5 shell session state (background shells + persistent foreground
   *  cwd/env). Wired per query; absent -> Bash is stateless and
   *  BashOutput/KillShell report unavailability. */
  shells?: ShellManager;
  /** v0.6 sandbox state (G-SANDBOX). Present -> Bash wraps commands with the
   *  resolved backend by default; absent -> Bash runs unsandboxed (no backend
   *  on this platform, or explicitly disabled). */
  sandbox?: SandboxContext;
  /**
   * Read-before-write gate state (E4): absolute paths whose content this
   * SESSION has seen. One shared Set per query - the subagent runtime threads
   * the SAME reference into child contexts (like shells/sandbox), so a parent
   * Read satisfies a child's gate and vice versa. Registered by a successful
   * Read, and by Write/Edit after they mutate a file (the session knows the
   * bytes it just wrote); Glob/Grep never register. Consulted only by Write:
   * overwriting an EXISTING file whose path is not in the set is rejected
   * with the official error text. Absent -> the gate is off (bare tool use
   * outside query(), e.g. direct unit tests that opt out).
   */
  readFilePaths?: Set<string>;
};

// v0.2 subagent spawn contract (subagent runtime <-> Agent tool).
export type SpawnSubagentParams = {
  /** subagent_type from the Agent tool input; 'general-purpose' when generic. */
  subagentType: string;
  /** The Agent tool's `prompt` input - becomes the child's first user turn. */
  prompt: string;
  /** The Agent tool's `description` input (task label), if given. */
  description?: string;
  /** run_in_background input; AgentDefinition.background forces true. */
  runInBackground?: boolean;
  /** tool_use id of the spawning Agent call -> child config.parentToolUseId. */
  toolUseId: string;
  /** The calling tool's abort signal (foreground children chain off this). */
  signal: AbortSignal;
  /**
   * FORK: continue from the parent's context (shared cached prefix) instead of a
   * fresh isolated one. AgentDefinition.fork forces true. Only takes effect when
   * `parentHistory` is present + non-empty; otherwise degrades to isolated.
   */
  fork?: boolean;
  /**
   * FORK: an EAGER snapshot of the parent loop's request messages taken by the
   * Agent tool at spawn time (a value copy, not a lazy thunk, so a background
   * fork captures the parent context as it was at spawn). The runtime seeds the
   * fork child from this. Absent -> no parent context to inherit (isolated).
   */
  parentHistory?: APIMessageParam[];
};

export type SpawnSubagentResult = {
  /** Final text returned to the parent as the Agent tool_result content. */
  content: string;
  isError: boolean;
  agentId: string;
  /** True when a background subagent was launched (content is an ack). */
  background: boolean;
};

export type SpawnSubagentFn = (params: SpawnSubagentParams) => Promise<SpawnSubagentResult>;

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

// v0.5 shell-session contract (Bash / BashOutput / KillShell <-> ShellManager).

export type BackgroundShellStatus = 'running' | 'completed' | 'failed' | 'killed';

export type BackgroundShell = {
  id: string;
  command: string;
  pid: number | undefined;
  stdout: string;
  stdoutTruncated: boolean;
  stderr: string;
  stderrTruncated: boolean;
  /** Incremental-read cursors (BashOutput returns only new output). */
  cursorOut: number;
  cursorErr: number;
  status: BackgroundShellStatus;
  exitCode: number | null;
  exitSignal: string | null;
  kill: (sig: string) => void;
};

/** Per-query shell session state: background shells + the persistent
 *  foreground cwd/env snapshot the Bash tool replays between calls. */
export interface ShellManager {
  /** Directory holding the persistent foreground cwd/env snapshot ('' when
   *  no tmp dir was available — persistence then degrades to stateless). */
  readonly stateDir: string;
  /** Spawn a detached background shell; returns its bash id immediately.
   *  `disableSandbox` engages the escape hatch (skip the sandbox wrap) for
   *  this launch; ignored when no sandbox is active on the context. */
  spawnBackground(
    shell: string,
    command: string,
    ctx: Pick<ToolContext, 'cwd' | 'env' | 'sandbox'>,
    disableSandbox?: boolean,
  ): { id: string } | { error: string };
  get(id: string): BackgroundShell | undefined;
  /** Kill one background shell (SIGTERM, then SIGKILL after a grace). */
  kill(id: string): boolean;
  /** Kill every background shell and remove the state dir (query close). */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Permission gate (module E)
// ---------------------------------------------------------------------------

export type GateHookDecision = {
  decision?: 'allow' | 'deny' | 'ask' | 'defer';
  reason?: string;
  updatedInput?: Record<string, unknown>;
};

export type PermissionCheckResult =
  | { decision: 'allow'; updatedInput: Record<string, unknown> }
  | { decision: 'deny'; message: string; interrupt?: boolean }
  /** canUseTool returned null (app responded externally); NOT recorded as a denial. */
  | { decision: 'skip'; message: string }
  /** hook/user deferred; ends the current turn (deferred_tool_use on the result). */
  | { decision: 'defer'; message: string };

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
      /** v0.6 G-SANDBOX: this call requested `dangerouslyDisableSandbox`; the
       *  escape must route to an ask (never auto-allow) except bypassPermissions. */
      sandboxEscape?: boolean;
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
  /** Aggregated permission decision: deny > defer > ask > allow. */
  decision?: 'allow' | 'deny' | 'ask' | 'defer';
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
  /** Server-reported tool annotations (e.g. readOnlyHint), when provided. */
  annotations?: ToolAnnotations;
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
  /** List resources across connected servers (or one named server). */
  listResources(server: string | undefined, signal: AbortSignal): Promise<McpResource[]>;
  /** Read one resource's contents from a named server. */
  readResource(server: string, uri: string, signal: AbortSignal): Promise<McpResourceContent[]>;
  reconnect(serverName: string): Promise<void>;
  setEnabled(serverName: string, enabled: boolean): void;
  /** Replace the live server set at runtime; returns the new statuses. */
  setServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult>;
  closeAll(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Engine (module B)
// ---------------------------------------------------------------------------

/** Resolved context-compaction tunables (defaults applied by query()). */
export type CompactionConfig = {
  enabled: boolean;
  autoThresholdRatio: number;
  keepRatio: number;
  minRecentTurns: number;
  useApiSummary: boolean;
  recognizeCommand: boolean;
  customInstructions?: string;
  contextWindowTokens?: number;
  /** Model for the summarization call; absent -> the session model. */
  model?: string;
  /** Run the deterministic pre-tier (dedupe + truncate tool_result bulk) before
   *  the summarization fold. Default true. */
  preTier: boolean;
  /** Byte budget (chars) for a single string tool_result in the pre-tier; 0
   *  disables truncation (dedupe still runs). Default 4000. */
  preTierMaxToolResultChars: number;
};

export type EngineConfig = {
  model: string;
  fallbackModel?: string;
  maxOutputTokens: number;
  /** Stable system-prompt prefix (cache-worthy; byte-identical across runs). */
  systemPrompt: string;
  /** Volatile system-prompt tail (cwd etc.); sent AFTER the cache breakpoint
   *  so it never invalidates the cached stable prefix. Absent -> systemPrompt
   *  is sent as a single string (original behavior). */
  systemPromptSuffix?: string;
  /** Char offset in systemPrompt where the base harness ends and the appended
   *  stable tail (project instructions / append / structured-output) begins;
   *  enables a 2nd system cache breakpoint so the shared base and the
   *  per-project tail cache as two independently-reusable segments. Absent / 0 /
   *  >= systemPrompt.length => single system breakpoint (original behavior). */
  systemPromptBaseLen?: number;
  /** Caller-composed system blocks (segments form). When set, these are sent
   *  as the request `system` verbatim (their cache_control breakpoints are
   *  respected, the engine adds none) and take precedence over systemPrompt/
   *  systemPromptSuffix. The generic seam for host-layered prompts. */
  systemBlocks?: TextBlockParam[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  thinking?: ThinkingConfigParam;
  maxThinkingTokens?: number;
  /** Context-compaction tunables; absent -> never compact. */
  compaction?: CompactionConfig;
  /** Structured-output schema; when set the engine validates + re-prompts. */
  outputFormat?: OutputFormatConfig;
  /** Bound on structured-output re-prompts (default 2). */
  maxStructuredOutputRetries?: number;
  /** Automatic prompt caching (cache_control breakpoints). */
  promptCaching?: boolean;
  /** tool_use id of the spawning Agent call; stamped on this loop's messages
   *  so subagent messages thread. Root loop leaves it undefined -> null. */
  parentToolUseId?: string | null;
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
  /** Shared, cross-turn request-message view. When present the engine streams
   *  from this array (compactable) instead of `history`, mirrors its own
   *  appended turns into it, and compaction splices it in place. `history`
   *  stays full + append-only for persistence. Absent -> exact v0.1 behavior. */
  requestView?: { messages: APIMessageParam[] };
  /** Root loop only: pull completed background-subagent results to append to
   *  the current tool_result user turn. Returns [] when none pending. */
  drainSubagentResults?: () => TextBlockParam[];
  /** v0.4 observability drain: pull buffered task_* / hook_* lifecycle
   *  messages (produced by the subagent runtime + hook runner, which cannot
   *  yield) so the loop can surface them at message boundaries. The queue is
   *  shared with the query layer, which drains it at its own yield points;
   *  splice-style — each buffered message is returned exactly once. */
  drainObservability?: () => SDKMessage[];
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
