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
// Anthropic Messages API wire types (minimal clean-room subset)
// ---------------------------------------------------------------------------

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
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
  content?: string | Array<TextBlockParam | ImageBlockParam>;
  is_error?: boolean;
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
  | 'dontAsk';

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
};

export type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
};

export type PostToolUseFailureHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUseFailure';
  tool_name: string;
  tool_input: unknown;
  error: string;
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

export type HookPermissionDecision = 'allow' | 'deny' | 'ask';

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
};

/** MCP tool result content (subset of the MCP CallToolResult schema). */
export type CallToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string } };

export type CallToolResult = {
  content: CallToolResultContent[];
  isError?: boolean;
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
  maxOutputTokens?: number;
};

export type ThinkingConfigParam =
  | { type: 'adaptive' }
  | { type: 'enabled'; budget_tokens?: number; budget?: number }
  | { type: 'disabled' };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SettingSource = 'user' | 'project' | 'local';

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
  includePartialMessages?: boolean;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;
  maxTurns?: number;
  mcpServers?: Record<string, McpServerConfig>;
  model?: string;
  permissionMode?: PermissionMode;
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
  /** Accepted for compatibility; this SDK loads no filesystem settings in v0.1. */
  settingSources?: SettingSource[];
  stderr?: (data: string) => void;
  /** Only use MCP servers passed in options (always true for this SDK). */
  strictMcpConfig?: boolean;
  systemPrompt?:
    | string
    | { type: 'preset'; preset: 'claude_code'; append?: string };
  thinking?: ThinkingConfigParam;
  /** Restrict built-in tools by name; defaults to all built-ins. */
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
  /** Extra beta flags forwarded via the anthropic-beta header. */
  betas?: string[];
  /** Enable debug logging via stderr callback. */
  debug?: boolean;
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
      total_cost_usd: number;
      usage: NonNullableUsage;
      modelUsage: Record<string, ModelUsage>;
      permission_denials: SDKPermissionDenial[];
    }
  | {
      type: 'result';
      subtype: 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd';
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

export type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKCompactBoundaryMessage
  | SDKPartialAssistantMessage;

// ---------------------------------------------------------------------------
// Query interface
// ---------------------------------------------------------------------------

export type ModelInfo = {
  id: string;
  displayName?: string;
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
