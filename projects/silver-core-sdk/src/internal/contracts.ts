/**
 * Silver Core SDK - internal module contracts.
 *
 * Every module implements against these interfaces and imports types ONLY
 * from '../types.js', '../errors.js' and this file. This keeps the seven
 * implementation modules independently buildable and testable.
 */

import type {
  APIMessageParam,
  APIToolDefinitionParam,
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
  OutputFormatConfig,
  PermissionMode,
  PermissionUpdate,
  PriceOverride,
  RawMessageStreamEvent,
  SandboxContext,
  SDKMessage,
  SDKPermissionDenial,
  TextBlockParam,
  ThinkingConfigParam,
  ToolAnnotations,
  ToolChoice,
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
  /** Disconnect-taxonomy class of this retry (resilience P0-2): what kind of
   *  failure triggered it, so the loop can count retries by cause. */
  kind?: 'network' | 'http_status' | 'empty_stream';
};

export type StreamRequest = {
  model: string;
  max_tokens: number;
  system?: string | TextBlockParam[];
  messages: APIMessageParam[];
  tools?: APIToolDefinitionParam[];
  /** Messages API `tool_choice`; forwarded verbatim by the transport. Only set
   *  when `tools` is non-empty (the API 400s on tool_choice without tools). */
  tool_choice?: ToolChoice;
  /** Messages API `output_config` (structured outputs). Set only when the
   *  caller opts into native structured outputs (`outputFormat.native`);
   *  forwarded verbatim by the transport. The old top-level `output_format`
   *  param is deprecated — `output_config.format` is the current wire shape. */
  output_config?: { format: { type: 'json_schema'; schema: JSONSchema } };
  thinking?:
    | { type: 'adaptive'; display?: 'summarized' | 'omitted' }
    | { type: 'enabled'; budget_tokens: number; display?: 'summarized' | 'omitted' }
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
  /**
   * Optional resource release (idle connection pools etc.). The built-in
   * transports do not implement it — their keep-alive sockets are unref'd
   * with a bounded idle TTL, so an abandoned instance self-cleans. The
   * subagent runtime calls it at query teardown on transports a
   * `resolveSubagentTransport` resolution returned with `owned: true`.
   */
  dispose?(): void;
}

// ---------------------------------------------------------------------------
// Built-in tools (modules C, D)
// ---------------------------------------------------------------------------

export type ToolResultPayload = {
  content: string | Array<TextBlockParam | ImageBlockParam | DocumentBlockParam>;
  isError?: boolean;
};

/**
 * NOTE (audit 2026-07-10 F6, stage 2 deferred by its own recommendation):
 * the optional fields below would group naturally into `session`
 * (shells/sandbox/readFilePaths/recordFileChange/sessionKey) and
 * `capabilities` (webSearch/askUser/mcpResources/fetchImpl) sub-objects, but
 * regrouping touches every builtin tool file and is a churn-wide mechanical
 * change — the audit's verdict was "do it at a major-version window", and
 * v0.x minor batches keep the flat shape. Until then: new per-query state
 * keys on `sessionKey`, and new optional fields must document their absent
 * behavior here.
 */
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
   * O-B2 SendMessage bridge: continue / stop a previously spawned subagent.
   * Wired on the ROOT loop's ToolContext only — subagent messaging is
   * root-loop-only in this SDK, so a child context never carries it (the
   * SendMessage tool then fails honestly; TaskStop falls through to shells).
   */
  subagents?: {
    /** Continue a subagent's conversation (see SubagentRuntime.sendMessage). */
    send(params: {
      to: string;
      message: string;
      signal: AbortSignal;
    }): Promise<{ content: string; isError: boolean }>;
    /**
     * Stop a subagent by agentId. Returns a human-readable outcome when the
     * id names a known subagent, undefined when it does not (the caller then
     * tries other id spaces, e.g. background shells).
     */
    stop(taskId: string): string | undefined;
  };
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
  /**
   * Stable per-query identity object (audit 2026-07-10 F6): the ONE key for
   * any per-query WeakMap state (worktree sessions, task stores, ...). The
   * query layer creates it once and the subagent runtime threads the SAME
   * reference into child contexts. Before this field, per-query state was
   * keyed on the readFilePaths Set's object identity — an invisible coupling
   * where rebuilding that Set would silently drop unrelated session state.
   * Absent -> keyers fall back to their historical keys (bare tool use).
   */
  sessionKey?: object;
  /**
   * Plan-mode control surface consumed by ExitPlanMode (mode read + flip).
   * Formalized from the previous duck-typed `as`-cast context extension
   * (audit 2026-07-10 F6): the field is now part of the contract.
   */
  permissionGate?: Pick<PermissionGate, 'getMode' | 'setMode'>;
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
  /**
   * The Agent tool's `model` input (E7-02): per-call model override for an
   * ISOLATED child, resolved through the same alias path as (and taking
   * precedence over) AgentDefinition.model. Ignored in fork mode — a fork
   * must byte-match the parent's cached prefix, model included.
   */
  model?: string;
  /**
   * The Agent tool's `isolation` input (E7-02): 'worktree' runs the child in
   * a temporary detached git worktree of the runtime cwd, removed after the
   * child finishes ONLY when it left no uncommitted/untracked changes.
   */
  isolation?: 'worktree';
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
  /**
   * Safe to run concurrently with the other tools of the same assistant
   * batch even though it is NOT readOnly — its side effects are contained in
   * an independent context (e.g. Agent: each subagent runs its own isolated
   * loop). Feeds ONLY the engine's parallel grouping; permission semantics
   * (plan-mode allow, default-mode auto-approve) still key off readOnly.
   */
  parallelSafe?: boolean;
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
  /** True once KillShell/dispose asked to terminate; the exit handler uses it
   *  to decide the honest terminal status (killed vs completed-before-kill). */
  killRequested: boolean;
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
// Memory store (module C/D, BPT-EXTENSION — memory system spec R3)
// ---------------------------------------------------------------------------

/**
 * The MemoryStore contract is part of the PUBLIC type surface (a hosting
 * application implements it), so it lives in ../types.ts; re-exported here
 * because it is also the internal seam the memory tool executes against.
 * See the JSDoc there + docs/MEMORY.md.
 */
export type { MemoryStore } from '../types.js';

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
  /** Replace the live server set at runtime; callers read statuses() for
   *  the outcome (query.ts owns the public McpSetServersResult shape). */
  setServers(servers: Record<string, McpServerConfig>): Promise<void>;
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

/** Role of a system-prompt part in the prompt-composition decomposition
 *  (BPT-EXTENSION, 2026-07-09). */
export type SystemPartRole =
  | 'base'
  | 'codebase-instructions'
  | 'append'
  | 'structured-output'
  | 'environment'
  | 'segment';

/** One labeled part of the system prompt, as the engine knows it at build time
 *  (before the parts are concatenated into wire blocks). `label` defaults to the
 *  role but carries a caller-supplied label for `append` segments / host
 *  `segments`, so a panel can re-bucket parts (e.g. Root / Runtime / Memory). */
export type SystemCompositionPart = {
  role: SystemPartRole;
  label?: string;
  estTokens: number;
};

/** The static (per-request-invariant) system half of the composition, built by
 *  the query layer where the parts still exist as separate strings and passed to
 *  analyzeRequestComposition. */
export type SystemComposition = {
  /** Ordered parts; the `base` part (when present) is the systemBase bucket. */
  parts: SystemCompositionPart[];
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
  /** Messages API `tool_choice` steer/constraint; forwarded to each request
   *  when tools are present. Absent -> the API default (`auto`). */
  toolChoice?: ToolChoice;
  /** Context-compaction tunables; absent -> never compact. */
  compaction?: CompactionConfig;
  /** E3 salvage mode (BPT-EXTENSION, resilience). Default 'accept': a
   *  mid-stream truncation keeps the whole blocks delivered so far as the
   *  turn's answer (official 2.1.201 semantics, drop-in). 'continue': the
   *  partial is NOT accepted as final — the turn falls through to the bounded
   *  replay so the model produces a complete answer (a fresh turn, so no
   *  duplicated prefix). Opt-in; the default is byte-for-byte the old path. */
  salvageMode?: 'accept' | 'continue';
  /** Structured-output schema; when set the engine validates + re-prompts. */
  outputFormat?: OutputFormatConfig;
  /** Bound on structured-output re-prompts (default 2). */
  maxStructuredOutputRetries?: number;
  /** Automatic prompt caching (cache_control breakpoints). */
  promptCaching?: boolean;
  /** Cache lifetime for the breakpoints this engine places ('5m' default, '1h'
   *  for the 1-hour cache). BPT-EXTENSION; no effect when promptCaching false. */
  cacheTtl?: '5m' | '1h';
  /** Custom model pricing overrides (ProviderConfig.pricing) threaded into
   *  every cost estimate this loop makes. BPT-EXTENSION (audit 2026-07-10). */
  pricing?: Record<string, PriceOverride>;
  /** tool_use id of the spawning Agent call; stamped on this loop's messages
   *  so subagent messages thread. Root loop leaves it undefined -> null. */
  parentToolUseId?: string | null;
  includePartialMessages: boolean;
  /** BPT-EXTENSION (prompt-composition, 2026-07-09): when true, the loop emits a
   *  `system`/`prompt_composition` observability message before each request.
   *  Default false. */
  includePromptComposition?: boolean;
  /** Static (per-request-invariant) labeled system-part breakdown, used to give
   *  the prompt-composition message its 需求 A systemBase/systemAppend split.
   *  Built by the query layer; absent -> the analyzer derives a best-effort
   *  split from the wire `system` field. */
  systemComposition?: SystemComposition;
  /**
   * Anthropic-provided (server-declared) tool entries to advertise on the
   * wire verbatim (BPT-EXTENSION — memory system spec R2 mode A). Each entry
   * is sent in `tools[]` as `{ type, name }` with NO input_schema (the API
   * injects the definition + protocol prompt server-side), and a builtin of
   * the SAME name is skipped from schema advertisement while remaining
   * executable — the local builtin is the execution loop for the server-
   * declared tool. Anthropic protocol only; the query layer never sets this
   * on an openai-chat transport.
   */
  serverTools?: Array<{ type: string; name: string }>;
  /**
   * Memory compaction flush (BPT-EXTENSION, memory spec R7): when set and
   * auto-compaction WOULD trigger, the loop first injects this prompt as a
   * user turn (one write opportunity for un-saved progress) and folds on the
   * following check. A PreCompact hook deny suppresses both the flush and
   * that turn's fold. Set by the query layer when the memory system is
   * enabled with flushOnCompaction.
   */
  memoryFlush?: { prompt: string };
  sessionId: string;
  cwd: string;
  /** Absolute transcript path of THIS loop's session, when it was persisted to a
   *  path-backed store. Populates the official hook base field `transcript_path`
   *  on every hook this loop fires (via baseHookFields). Absent -> the store is
   *  not path-backed or persistence is off; the field is then omitted. */
  transcriptPath?: string;
};

export type EngineDeps = {
  transport: Transport;
  builtinTools: Map<string, BuiltinTool>;
  mcp: McpRegistry;
  permissions: PermissionGate;
  hooks: HookRunner;
  toolContext: ToolContext;
  debug: (msg: string) => void;
  /**
   * Unified tool-search (lazy loading): returns true when a built-in tool's
   * schema is currently WITHHELD from the request `tools[]` — it is in the
   * cold set, deferral is active, and the model has not yet loaded it via the
   * ToolSearch builtin. buildToolDefs() skips such tools so their (often large)
   * schemas are not cold-written every turn; they resurface the turn after a
   * ToolSearch load. Absent -> no built-in is ever deferred (every built-in's
   * schema is advertised inline, the exact pre-unification behavior). The tool
   * still EXECUTES if called while deferred (has()-stays-true, context-saving
   * not access control), mirroring deferred MCP tools.
   */
  isBuiltinDeferred?: (name: string) => boolean;
  /** Shared, cross-turn request-message view. When present the engine streams
   *  from this array (compactable) instead of `history`, mirrors its own
   *  appended turns into it, and compaction splices it in place. `history`
   *  stays full + append-only for persistence. Absent -> exact v0.1 behavior. */
  requestView?: { messages: APIMessageParam[] };
  /** Root loop only: pull completed background-subagent results to append to
   *  the current tool_result user turn. Returns [] when none pending. */
  drainSubagentResults?: () => TextBlockParam[];
  /** Memory-health snapshot (BPT-EXTENSION, memory spec R8): when present the
   *  loop attaches its value to SDKRunMetrics.memoryHealth on every result.
   *  Wired by the query layer on the ROOT loop only. */
  memoryHealth?: () => import('../types.js').SDKMemoryHealth;
  /** v0.4 observability drain: pull buffered task_* / hook_* lifecycle
   *  messages (produced by the subagent runtime + hook runner, which cannot
   *  yield) so the loop can surface them at message boundaries. The queue is
   *  shared with the query layer, which drains it at its own yield points;
   *  splice-style — each buffered message is returned exactly once. */
  drainObservability?: () => SDKMessage[];
  /**
   * Family-wide (agent-tree) spend ceiling, shared by the root loop AND every
   * subagent loop of the same query. Each loop adds ITS OWN billed cost to
   * `spentUsd` in real time (in recordUsage) and trips `error_max_budget_usd`
   * once `spentUsd > capUsd`. This is the AGGREGATE ceiling that the per-loop
   * `config.maxBudgetUsd` self-cap cannot provide: without it, a coordinator
   * that fans out N concurrent subagents (each handed a full copy of
   * `maxBudgetUsd`) can spend up to (1+N)×maxBudgetUsd inside one prompt,
   * because the parent's own budget gate only sees the parent's own cost and
   * child cost folds into the session account only at result boundaries.
   *
   * `capUsd` is the ABSOLUTE `options.maxBudgetUsd` and `spentUsd` accumulates
   * cumulatively across turns, so for a childless single loop this gate trips
   * at the exact same point as the existing self-cap (identical behavior);
   * it only bites earlier when concurrent family spend is in flight. Purely
   * additive/conservative — it can trip sooner, never later. Absent when no
   * budget is configured. */
  familyBudget?: { spentUsd: number; capUsd: number };
  /** Structured tool-call telemetry (BPT-EXTENSION, governance spec S3):
   *  called once per dispatched tool_use block, at dispatch completion, with
   *  timing + outcome. The query layer persists these as `tool_call` records
   *  in the session JSONL (suppressed when persistence is off / incognito).
   *  The subagent runtime forwards the parent recorder with `parentToolUseId`
   *  stamped, so child tool calls stay attributable. */
  onToolRecord?: (rec: ToolDispatchRecord) => void;
};

/** One dispatched tool_use block's telemetry (governance spec S3). Timing
 *  spans the WHOLE dispatch pipeline (hooks + permission gate + execution);
 *  status 'error' covers execution errors, denials, hook stops and unknown
 *  tools alike — the summary carries the detail. */
export type ToolDispatchRecord = {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** ISO timestamp of dispatch start. */
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'error';
  /** Result content head, truncated at 500 chars ('[aborted]' on abort). */
  resultSummary: string;
  /** Set by the subagent runtime: the spawning Task tool_use id. */
  parentToolUseId?: string;
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
  /**
   * SM-乙b §5.2 write-ahead checkpoint: true when the transcript carries a
   * `pending_turn` record with no matching `turn_complete` — evidence the
   * prior run crashed inside a turn's API request segment. Resume re-drives
   * that request segment (never its tools: their execution state is whatever
   * tool_result records made it to disk).
   */
  pendingTurnInterrupted?: boolean;
  /** uuid of the dangling pending_turn (the recovery re-drive settles it). */
  pendingTurnUuid?: string;
  /** turn_ref of the dangling pending_turn (the interrupted user turn's uuid). */
  pendingTurnRef?: string;
};

export interface SessionStore {
  append(sessionId: string, entry: Record<string, unknown>): void;
  load(sessionId: string): Promise<StoredSession | null>;
  list(): Promise<StoredSession[]>;
  latestSessionId(): Promise<string | null>;
}
