/**
 * BPT Agent SDK - public type surface.
 *
 * Clean-room reimplementation of the @anthropic-ai/claude-agent-sdk public
 * API surface, grounded exclusively in the public documentation
 * (code.claude.com/docs/en/agent-sdk/typescript, /hooks, /mcp) and the
 * public Anthropic Messages API documentation. No proprietary code was
 * consulted. The engine drives the Messages API directly - there is no
 * bundled CLI executable.
 *
 * Compatibility tiers per field/feature are documented in docs/COMPAT.md.
 */

// ---------------------------------------------------------------------------
// Anthropic Messages API wire types (minimal independent subset)
// ---------------------------------------------------------------------------

/** Server-side tool invocation counts the API reports on a response usage. */
export type ServerToolUse = {
  web_search_requests?: number;
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  /** Server tool call counts (e.g. web_search_requests), when the API reports them. */
  server_tool_use?: ServerToolUse | null;
  /** The service tier that served the response (e.g. 'standard', 'batch'), when reported. */
  service_tier?: string | null;
};

/** Usage with cache fields normalized to numbers (never null/undefined). */
export type NonNullableUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
};

export type TextBlock = {
  type: 'text';
  text: string;
  citations?: unknown[] | null;
};

export type ThinkingBlock = {
  type: 'thinking';
  thinking: string;
  signature: string;
};

export type RedactedThinkingBlock = {
  type: 'redacted_thinking';
  data: string;
};

export type ToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

/** Content blocks that can appear in an assistant message. */
export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ToolUseBlock;

export type TextBlockParam = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' } | null;
};

export type ImageBlockParam = {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
  cache_control?: { type: 'ephemeral' } | null;
};

/**
 * A document content block (e.g. a base64 PDF). Valid at the top level of a
 * user message AND inside a tool_result's content array (the API's
 * handle-tool-calls docs list `document` among the allowed tool_result block
 * types). The base64 source mirrors top-level PDF support; the docs' explicit
 * tool_result example only shows a `text` source, so base64-in-tool_result is
 * supported-but-not-demonstrated (see docs/COMPAT.md).
 */
export type DocumentBlockParam = {
  type: 'document';
  source:
    | { type: 'base64'; media_type: 'application/pdf'; data: string }
    | { type: 'text'; media_type: 'text/plain'; data: string }
    | { type: 'url'; url: string };
  title?: string;
  context?: string;
  cache_control?: { type: 'ephemeral' } | null;
};

export type ToolUseBlockParam = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultBlockParam = {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | Array<TextBlockParam | ImageBlockParam | DocumentBlockParam>;
  is_error?: boolean;
  cache_control?: { type: 'ephemeral' } | null;
};

export type ThinkingBlockParam = {
  type: 'thinking';
  thinking: string;
  signature: string;
};

export type RedactedThinkingBlockParam = {
  type: 'redacted_thinking';
  data: string;
};

export type ContentBlockParam =
  | TextBlockParam
  | ImageBlockParam
  | ToolUseBlockParam
  | ToolResultBlockParam
  | ThinkingBlockParam
  | RedactedThinkingBlockParam;

export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | null;

/** An assistant message as returned by the Messages API. */
export type APIAssistantMessage = {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: ContentBlock[];
  stop_reason: StopReason;
  stop_sequence: string | null;
  usage: Usage;
};

/** A message param as sent to the Messages API. */
export type APIUserMessage = {
  role: 'user';
  content: string | ContentBlockParam[];
};

export type APIMessageParam = {
  role: 'user' | 'assistant';
  content: string | ContentBlockParam[];
};

/** JSON Schema shape sent to the API as a tool input schema. */
export type JSONSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

export type APIToolDefinition = {
  name: string;
  description?: string;
  input_schema: JSONSchema;
  /** Prompt-cache breakpoint marker (set by the cache-control layer). */
  cache_control?: { type: 'ephemeral' } | null;
};

// --- Streaming events (SSE) -------------------------------------------------

export type MessageStartEvent = {
  type: 'message_start';
  message: APIAssistantMessage;
};

export type ContentBlockStartEvent = {
  type: 'content_block_start';
  index: number;
  content_block:
    | { type: 'text'; text: string }
    | { type: 'thinking'; thinking: string; signature?: string }
    | { type: 'redacted_thinking'; data: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
};

export type ContentBlockDeltaEvent = {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'signature_delta'; signature: string };
};

export type ContentBlockStopEvent = {
  type: 'content_block_stop';
  index: number;
};

export type MessageDeltaEvent = {
  type: 'message_delta';
  delta: { stop_reason: StopReason; stop_sequence: string | null };
  usage: { output_tokens: number; input_tokens?: number };
};

export type MessageStopEvent = {
  type: 'message_stop';
};

export type PingEvent = { type: 'ping' };

export type ErrorEvent = {
  type: 'error';
  error: { type: string; message: string };
};

export type RawMessageStreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent
  | ErrorEvent;

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type PermissionMode =
  /** Standard behavior: safe read-only tools run, others consult rules/canUseTool. */
  | 'default'
  /** Auto-accept file edits (Write/Edit and file-mutating operations). */
  | 'acceptEdits'
  /** Bypass permission checks entirely. */
  | 'bypassPermissions'
  /** Planning mode: only read-only tools are permitted. */
  | 'plan'
  /** Never prompt: deny anything that is not pre-approved by rules. */
  | 'dontAsk'
  /** v0.2: heuristic-classified approvals (src/permissions/classifier.ts). */
  | 'auto';

export type PermissionBehavior = 'allow' | 'deny' | 'ask';

export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session';

export type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
};

export type PermissionUpdate =
  | {
      type: 'addRules';
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'replaceRules';
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'removeRules';
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'setMode';
      mode: PermissionMode;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'addDirectories';
      directories: string[];
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'removeDirectories';
      directories: string[];
      destination: PermissionUpdateDestination;
    };

export type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };

export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
    requestId?: string;
  },
) => Promise<PermissionResult | null>;

export type SDKPermissionDenial = {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PostToolBatch'
  | 'UserPromptSubmit'
  | 'MessageDisplay'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Notification';

export type BaseHookInput = {
  session_id: string;
  cwd: string;
  hook_event_name: HookEvent;
  transcript_path?: string;
  agent_id?: string;
  agent_type?: string;
};

export type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_use_id?: string;
};

export type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
  tool_use_id?: string;
  duration_ms?: number;
};

export type PostToolUseFailureHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUseFailure';
  tool_name: string;
  tool_input: unknown;
  error: string;
  tool_use_id?: string;
  duration_ms?: number;
};

export type PostToolBatchHookInput = BaseHookInput & {
  hook_event_name: 'PostToolBatch';
  tool_names: string[];
};

export type UserPromptSubmitHookInput = BaseHookInput & {
  hook_event_name: 'UserPromptSubmit';
  prompt: string;
};

export type MessageDisplayHookInput = BaseHookInput & {
  hook_event_name: 'MessageDisplay';
  message_text: string;
};

export type StopHookInput = BaseHookInput & {
  hook_event_name: 'Stop';
  stop_hook_active: boolean;
};

export type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStart';
};

export type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStop';
  stop_hook_active: boolean;
  agent_transcript_path?: string;
};

export type PreCompactHookInput = BaseHookInput & {
  hook_event_name: 'PreCompact';
  trigger: 'manual' | 'auto';
  custom_instructions: string | null;
};

export type PermissionRequestHookInput = BaseHookInput & {
  hook_event_name: 'PermissionRequest';
  tool_name: string;
  tool_input: unknown;
  tool_use_id?: string;
};

export type SessionStartHookInput = BaseHookInput & {
  hook_event_name: 'SessionStart';
  source: 'startup' | 'resume' | 'clear' | 'compact';
};

export type SessionEndHookInput = BaseHookInput & {
  hook_event_name: 'SessionEnd';
  reason: string;
};

export type NotificationHookInput = BaseHookInput & {
  hook_event_name: 'Notification';
  message: string;
  title?: string;
  notification_type?: string;
};

export type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | PostToolBatchHookInput
  | UserPromptSubmitHookInput
  | MessageDisplayHookInput
  | StopHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | PreCompactHookInput
  | PermissionRequestHookInput
  | SessionStartHookInput
  | SessionEndHookInput
  | NotificationHookInput;

export type HookPermissionDecision = 'allow' | 'deny' | 'ask' | 'defer';

export type HookJSONOutput = {
  /** When false, the agent stops after this hook. */
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  /** Legacy-style decision field; 'block' behaves like a deny. */
  decision?: 'approve' | 'block';
  /** Message surfaced to the user (not the model). */
  systemMessage?: string;
  reason?: string;
  /** Fire-and-forget mode: agent proceeds without waiting. */
  async?: boolean;
  asyncTimeout?: number;
  hookSpecificOutput?: {
    hookEventName: HookEvent;
    /** PreToolUse: permission decision for the pending tool call. */
    permissionDecision?: HookPermissionDecision;
    permissionDecisionReason?: string;
    /** PreToolUse: replaces the tool input (requires allow/ask decision). */
    updatedInput?: Record<string, unknown>;
    /** PostToolUse / UserPromptSubmit / SessionStart: extra context for the model. */
    additionalContext?: string;
    /** PostToolUse: replace the tool output before the model sees it. */
    updatedToolOutput?: unknown;
  };
};

export type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookJSONOutput | void>;

export type HookCallbackMatcher = {
  /**
   * Pattern matched against the event's filter field (tool name for tool
   * hooks). Exact-string set (letters, digits, _, -, spaces, ',', '|') is
   * compared literally with '|'/',' alternatives; anything else is an
   * unanchored regular expression. Omitted/'*'/'' matches everything.
   */
  matcher?: string;
  hooks: HookCallback[];
  /** Timeout in seconds for each callback (default 60). */
  timeout?: number;
};

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export type McpStdioServerConfig = {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type McpSSEServerConfig = {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
};

export type McpHttpServerConfig = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
};

/** In-process SDK MCP server created via createSdkMcpServer(). */
export type McpSdkServerConfigWithInstance = {
  type: 'sdk';
  name: string;
  instance: SdkMcpServerInstance;
};

export type McpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig
  | McpSdkServerConfigWithInstance;

export type McpServerStatus = {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  serverInfo?: { name: string; version: string };
  error?: string;
  /** The config this server was registered with (echoed back; task #17). */
  config?: McpServerConfig;
  /** Per-server tool names, present once the server is connected. */
  tools?: string[];
  /** Provenance of the config. Typed for compat; not tracked by this engine. */
  scope?: 'user' | 'project' | 'local' | 'dynamic';
};

/** One MCP resource descriptor (resources/list entry). */
export type McpResource = {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  /** Owning server name (populated by the registry when aggregating). */
  server?: string;
};

/** One MCP resource's contents (resources/read entry). */
export type McpResourceContent = {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
};

/** MCP tool result content (subset of the MCP CallToolResult schema). */
export type CallToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | {
      type: 'resource_link';
      uri: string;
      name?: string;
      description?: string;
      mimeType?: string;
    }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string } };

export type CallToolResult = {
  content: CallToolResultContent[];
  isError?: boolean;
  /** Optional machine-readable payload (MCP structuredContent). */
  structuredContent?: unknown;
};

export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

/** A tool definition registered on an in-process SDK MCP server. */
export type SdkMcpToolDefinition<TArgs = Record<string, unknown>> = {
  name: string;
  description: string;
  /** JSON Schema for the tool input (converted from zod at creation time). */
  inputJsonSchema: JSONSchema;
  handler: (args: TArgs, extra: unknown) => Promise<CallToolResult>;
  annotations?: ToolAnnotations;
};

export type SdkMcpServerInstance = {
  name: string;
  version: string;
  tools: Map<string, SdkMcpToolDefinition>;
};

// ---------------------------------------------------------------------------
// Agents (accepted for type compatibility; execution lands in v0.2)
// ---------------------------------------------------------------------------

export type AgentDefinition = {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  maxTurns?: number;
  permissionMode?: PermissionMode;
  /** v0.2: run this subagent as a non-blocking background task when invoked. */
  background?: boolean;
  /** Preload skills into the subagent context (ACCEPTED; no-op in v0.2). */
  skills?: string[];
  /** MCP servers for this subagent (ACCEPTED; v0.2 inherits parent servers). */
  mcpServers?: string[];
  /** First user turn when run as the MAIN thread; ignored for subagents. */
  initialPrompt?: string;
  /** Memory source (ACCEPTED; no-op in v0.2). */
  memory?: 'user' | 'project' | 'local';
  /** Reasoning effort (ACCEPTED; no-op in v0.2 - thinking inherited instead). */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number;
};

// ---------------------------------------------------------------------------
// Provider transport configuration (BPT extension)
// ---------------------------------------------------------------------------

/**
 * BPT extension: direct-API transport settings. The reference SDK spawns a
 * CLI subprocess; this SDK talks to the Messages API itself, so connection
 * settings live here. Falls back to ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN /
 * ANTHROPIC_BASE_URL environment variables when omitted.
 */
export type ProviderConfig = {
  apiKey?: string;
  /** Bearer token auth (gateways); mutually exclusive with apiKey. */
  authToken?: string;
  baseUrl?: string;
  apiVersion?: string;
  defaultHeaders?: Record<string, string>;
  maxRetries?: number;
  /** Per-request timeout in milliseconds (default 600000). */
  timeoutMs?: number;
  /**
   * Idle watchdog for the streaming phase: abort the stream if no SSE event
   * arrives for this many milliseconds (default 120000; `0` disables). Fires
   * faster and more diagnosably than the whole-request timeout when a stream
   * silently stalls — the API emits periodic `ping` events, so a gap this long
   * means the connection is stuck, not merely slow.
   */
  streamIdleTimeoutMs?: number;
  maxOutputTokens?: number;
  /** Automatic prompt caching via cache_control breakpoints; default true. */
  promptCaching?: boolean;
};

export type ThinkingConfigParam =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens?: number; budget_tokens?: number; budget?: number }
  | { type: 'disabled' };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SettingSource = 'user' | 'project' | 'local';

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
};

export type Options = {
  abortController?: AbortController;
  additionalDirectories?: string[];
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
  /** v0.4: surface hook execution as hook_started / hook_response stream
   *  messages (default false; hooks otherwise report via debug only). */
  includeHookEvents?: boolean;
  includePartialMessages?: boolean;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;
  maxTurns?: number;
  mcpServers?: Record<string, McpServerConfig>;
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
  /** Session id (UUID) to resume. */
  resume?: string;
  /** Use a specific session id for this session. */
  sessionId?: string;
  /** Directory for session transcripts (default ~/.bpt-agent/sessions). */
  sessionDir?: string;
  /**
   * Which on-disk instruction sources to load into the system prompt, matching
   * @anthropic-ai/claude-agent-sdk. 'project'/'local' walk up from cwd for
   * CLAUDE.md / AGENTS.md; 'user' reads ~/.claude/CLAUDE.md. Empty/undefined
   * loads nothing (the SDK default — the caller opts in). Only consulted on the
   * `claude_code` preset / default harness path.
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
  stderr?: (data: string) => void;
  /** Only use MCP servers passed in options (always true for this SDK). */
  strictMcpConfig?: boolean;
  systemPrompt?:
    | string
    | { type: 'preset'; preset: 'claude_code'; append?: string }
    | { type: 'segments'; segments: SystemPromptSegment[] };
  thinking?: ThinkingConfigParam;
  /** Restrict built-in tools by name; defaults to all built-ins. */
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
  /** Extra beta flags forwarded via the anthropic-beta header. */
  betas?: string[];
  /** Enable debug logging via stderr callback. */
  debug?: boolean;
  /** BPT extension: context-compaction tuning (see docs/COMPAT.md). */
  compaction?: CompactionOptions;
  /** Require the final answer to be JSON validating against a JSON Schema;
   *  the validated object is returned on the result as `structured_output`. */
  outputFormat?: OutputFormatConfig;
  /** BPT/v0.2: host web-search backend for the WebSearch tool. */
  webSearch?: WebSearchHandler;
  /** BPT/v0.2: collects answers for the AskUserQuestion tool. */
  onUserQuestion?: UserQuestionHandler;
  /** v0.2: answers MCP server elicitation requests (else auto-declined). */
  onElicitation?: ElicitationHandler;
  /** BPT extension: allow WebFetch to reach localhost/private IPs (default false). */
  allowPrivateWebFetch?: boolean;
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
  /** BPT experiment: harness system-prompt variant for the `claude_code`
   *  preset / default path. 'v1' (default) = the terse original; 'v2'/'v3' =
   *  richer prompts composed from PUBLIC prompt-engineering practice; 'v4' = a
   *  faithful reproduction of the official main-loop prompt from the PUBLIC
   *  prompt reconstruction (open reproduction, tool refs adapted); 'v5' = a
   *  COMPREHENSIVE faithful reproduction (fuller official main-loop clauses).
   *  A/B knob for measuring quality/cost/cache before promoting a new default. */
  harnessPromptVariant?: 'v1' | 'v2' | 'v3' | 'v4' | 'v5';
};

// ---------------------------------------------------------------------------
// SDK messages
// ---------------------------------------------------------------------------

export type ApiKeySource = 'user' | 'project' | 'org' | 'temporary' | 'none';

export type SDKUserMessage = {
  type: 'user';
  uuid?: string;
  session_id: string;
  message: APIUserMessage;
  parent_tool_use_id: string | null;
};

export type SDKUserMessageReplay = {
  type: 'user';
  uuid: string;
  session_id: string;
  message: APIUserMessage;
  parent_tool_use_id: string | null;
  isReplay: true;
};

export type SDKAssistantMessage = {
  type: 'assistant';
  uuid: string;
  session_id: string;
  message: APIAssistantMessage;
  parent_tool_use_id: string | null;
};

export type SDKPartialAssistantMessage = {
  type: 'stream_event';
  uuid: string;
  session_id: string;
  event: RawMessageStreamEvent;
  parent_tool_use_id: string | null;
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
};

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
      stop_reason?: StopReason;
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
      /** Time to first token (ms); only present when a token actually arrived. */
      ttft_ms?: number;
      ttft_stream_ms?: number;
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
// Observability / status message variants (v0.3 — task #16)
//
// Drop-in surface for the official SDKMessage union's observability arm. The
// published docs/types NAME these discriminators but leave several PAYLOAD
// shapes unspecified (the SDK's own issue #181 has SDKRateLimitEvent /
// SDKPromptSuggestionMessage referenced-but-unexported), and are internally
// inconsistent about top-level `type` vs `type:'system'+subtype`. We model the
// observability arm with TOP-LEVEL `type` discriminators — the most likely
// consumer pattern (e.g. `msg.type === 'permission_denied'`) — except `status`,
// which stays a `system` subtype since `system/status` is its canonical form.
// Every message carries our house `uuid`/`session_id` envelope.
//
// EMITTED by this engine today: permission_denied (gate deny), rate_limit_event
// / api_retry (transport retries, v0.3), task_started / task_progress /
// task_updated / task_notification (subagent lifecycle, v0.4), hook_started /
// hook_response (hook lifecycle behind includeHookEvents, v0.4). The rest are
// TYPED for union exhaustiveness but have no source event in a headless engine
// with no plugins/skills/CC-host/slash-command framework; see docs/COMPAT.md
// for the emitted-vs-typed split. Field shapes the official leaves
// undocumented are a self-consistent independent reconstruction.
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

/** A background task / subagent started. EMITTED (v0.4) when the Agent tool
 *  spawns a subagent (foreground or background); task_id is the agentId. */
export type SDKTaskStartedMessage = {
  type: 'task_started';
  uuid: string;
  session_id: string;
  task_id: string;
  task_name: string;
  agent_id?: string;
};

/** Progress from a background task / subagent. EMITTED (v0.4) once per child
 *  assistant turn; `progress` is the share of the child's turn budget consumed
 *  (0..99), `status` is a human-readable `turn N/M`. */
export type SDKTaskProgressMessage = {
  type: 'task_progress';
  uuid: string;
  session_id: string;
  task_id: string;
  progress: number;
  status?: string;
  summary?: string;
  blocked?: boolean;
};

/** Terminal update for a background task / subagent. EMITTED (v0.4) when a
 *  subagent finishes (completed/failed) or is stopped via stopTask (cancelled);
 *  `result` carries a bounded prefix of the child's final text. */
export type SDKTaskUpdatedMessage = {
  type: 'task_updated';
  uuid: string;
  session_id: string;
  task_id: string;
  status: 'completed' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
};

/** Background-task lifecycle notification. EMITTED (v0.4) for BACKGROUND
 *  subagents only (their terminal event otherwise has no stream anchor). */
export type SDKTaskNotificationMessage = {
  type: 'task_notification';
  uuid: string;
  session_id: string;
  task_id: string;
  event: 'completed' | 'failed' | 'stopped';
  message?: string;
};

/** Hook execution began. EMITTED (v0.4) per hook callback invocation when
 *  options.includeHookEvents is true; hook_id pairs it with its hook_response. */
export type SDKHookStartedMessage = {
  type: 'hook_started';
  uuid: string;
  session_id: string;
  hook_id: string;
  hook_event: HookEvent;
};

/** Hook execution progress. Typed; not emitted (callbacks are opaque
 *  promises — there is no honest mid-callback progress source). */
export type SDKHookProgressMessage = {
  type: 'hook_progress';
  uuid: string;
  session_id: string;
  hook_id: string;
  hook_event: HookEvent;
  progress?: number;
  status?: string;
};

/** Hook execution finished. EMITTED (v0.4) when options.includeHookEvents is
 *  true; `result` is the callback output as JSON, `error` the failure/timeout. */
export type SDKHookResponseMessage = {
  type: 'hook_response';
  uuid: string;
  session_id: string;
  hook_id: string;
  hook_event: HookEvent;
  result?: string;
  error?: string;
};

/** Files written / changed during a turn. Typed; not emitted. */
export type SDKFilesPersistedMessage = {
  type: 'files_persisted';
  uuid: string;
  session_id: string;
  files: Array<{
    path: string;
    operation: 'created' | 'modified' | 'deleted';
    size?: number;
  }>;
};

/** Output of a local slash-command run. Typed; not emitted. */
export type SDKLocalCommandOutputMessage = {
  type: 'local_command_output';
  uuid: string;
  session_id: string;
  command: string;
  output: string;
  exit_code?: number;
};

/** The available slash-command set changed. Typed; not emitted. */
export type SDKCommandsChangedMessage = {
  type: 'commands_changed';
  uuid: string;
  session_id: string;
  available_commands: SlashCommand[];
};

/** A rate limit was hit and a retry scheduled. EMITTED (v0.3) via the
 *  transport's per-request onRetry observer on each 429 retry. */
export type SDKRateLimitEventMessage = {
  type: 'rate_limit_event';
  uuid: string;
  session_id: string;
  retry_after_ms: number;
  limit_type: 'api' | 'token' | 'requests';
  requests_remaining?: number;
};

/** An API call is being retried. EMITTED (v0.3) via the transport's onRetry
 *  observer on each non-429 (5xx/network) retry. */
export type SDKApiRetryMessage = {
  type: 'api_retry';
  uuid: string;
  session_id: string;
  attempt: number;
  max_retries: number;
  status?: number;
  reason?: string;
};

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

/** A free-form informational log surfaced into the stream. Typed; not emitted. */
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

/**
 * The observability / status arm of the SDKMessage union (task #16). Only
 * SDKPermissionDeniedMessage is emitted today; the rest are typed for drop-in
 * exhaustiveness (see docs/COMPAT.md).
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
  | SDKFilesPersistedMessage
  | SDKLocalCommandOutputMessage
  | SDKCommandsChangedMessage
  | SDKRateLimitEventMessage
  | SDKApiRetryMessage
  | SDKAuthStatusMessage
  | SDKElicitationCompleteMessage
  | SDKInformationalMessage
  | SDKNotificationMessage
  | SDKPromptSuggestionMessage
  | SDKMemoryRecallMessage
  | SDKWorkerShuttingDownMessage
  | SDKPluginInstallMessage
  | SDKSessionStateChangedMessage
  | SDKStatusMessage;

export type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKCompactBoundaryMessage
  | SDKMirrorErrorMessage
  | SDKPartialAssistantMessage
  | SDKObservabilityMessage;

// ---------------------------------------------------------------------------
// v0.2 subsystem types
// ---------------------------------------------------------------------------

/** Structured-output configuration (Options.outputFormat). The SDK validates
 *  the agent's final answer against `schema` and re-prompts on mismatch. */
export type OutputFormatConfig = {
  type: 'json_schema';
  schema: JSONSchema;
};

/** BPT extension: context-compaction tuning. When the running request
 *  history's estimated token count approaches the model context window,
 *  older turns are folded into a synthetic summary. `enabled` defaults true. */
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
  /** Treat a user turn whose text is `/compact [instructions]` as a manual compaction. Default true. */
  recognizeCommand?: boolean;
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
};

/** The tool call a defer paused on (SDKResultMessage.deferred_tool_use). */
export type SDKDeferredToolUse = {
  tool_use_id: string;
  tool_name: string;
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
  options: Array<{ label: string; description?: string }>;
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

/** Result of Query.setMcpServers(). */
export type McpSetServersResult = {
  servers: McpServerStatus[];
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
};

/** Result of Query.rewindFiles(). */
export type RewindFilesResult = {
  checkpointId: string;
  restoredFiles: string[];
  deletedFiles: string[];
  dryRun: boolean;
};

/** Best-effort external-store write failure surfaced on the stream. */
export type SDKMirrorErrorMessage = {
  type: 'system';
  subtype: 'mirror_error';
  uuid: string;
  session_id: string;
  error: string;
};

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
  description?: string;
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

export type SDKInitializationResult = {
  commands: SlashCommand[];
  agents: AgentInfo[];
  output_style: string;
  available_output_styles: string[];
  models: ModelInfo[];
  account: AccountInfo;
};

export interface Query extends AsyncGenerator<SDKMessage, void> {
  /**
   * Interrupt the running turn. In streaming-input mode this aborts the
   * active turn and the session accepts further input; in string mode it
   * aborts the run and the generator yields a terminal
   * `error_during_execution` result. Honored between turns via an
   * interrupt-requested flag when no turn is currently active.
   */
  interrupt(): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  initializationResult(): Promise<SDKInitializationResult>;
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
  /** Push an additional user-message stream into a streaming-input session. */
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  close(): void;
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
  cwd?: string;
  createdAt?: number;
};
