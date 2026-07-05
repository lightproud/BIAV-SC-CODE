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

import type { Readable, Writable } from 'node:stream';

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
  /**
   * The model's maximum context window in tokens (REQUIRED on the official
   * surface). Populated by the engine loop from the static public model-window
   * table (engine/context-window.ts) — an ESTIMATE with the same provenance
   * discipline as the price table, not an authoritative API value. Optional
   * during the transition: the subagent usage-ledger merge
   * (src/subagents/runtime.ts:407-419) does not propagate it yet, so entries
   * folded through that path may lack it.
   */
  contextWindow?: number;
  /**
   * Max output tokens in force for requests to this model (REQUIRED on the
   * official surface). This engine reports the ACTUAL per-request `max_tokens`
   * cap it sends (provider.maxOutputTokens ?? 8192) — an honest runtime value,
   * NOT the model's theoretical output ceiling (no public per-model
   * max-output table is bundled). Optional during the transition (same
   * subagent-ledger caveat as contextWindow).
   */
  maxOutputTokens?: number;
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

/**
 * A prompt-cache breakpoint. `ttl` selects the cache lifetime: omitted / '5m'
 * is the default 5-minute ephemeral cache (1.25x write price); '1h' is the
 * 1-hour cache (2x write price, GA — no beta header needed). Read price is
 * 0.1x either way.
 */
export type CacheControlEphemeral = { type: 'ephemeral'; ttl?: '5m' | '1h' };

export type TextBlockParam = {
  type: 'text';
  text: string;
  cache_control?: CacheControlEphemeral | null;
};

export type ImageBlockParam = {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
  cache_control?: CacheControlEphemeral | null;
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
  cache_control?: CacheControlEphemeral | null;
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
  cache_control?: CacheControlEphemeral | null;
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
  cache_control?: CacheControlEphemeral | null;
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
  /** Planning mode: read-only tools are auto-allowed; writes ROUTE to
   *  canUseTool (an ask) rather than being hard-denied. */
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
    /** Unique id of this permission request (required on the official surface;
     *  the gate generates one per canUseTool consultation). */
    requestId: string;
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
  | 'Notification'
  // NEW-IN-DOCS (live docs, above pins agent-sdk 0.3.199): six additional hook
  // events. All are typed-not-fired here — this SDK has no natural runtime hook
  // point for any of them (no Setup phase / agent-teams / Task four-piece /
  // settings engine / worktree lifecycle), so they are declared for drop-in
  // type compatibility only and never emitted. See each input type below.
  | 'Setup'
  | 'TeammateIdle'
  | 'TaskCompleted'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove';

export type BaseHookInput = {
  session_id: string;
  cwd: string;
  hook_event_name: HookEvent;
  transcript_path?: string;
  agent_id?: string;
  agent_type?: string;
  /**
   * NEW-IN-DOCS: UUID of the user prompt currently being processed (matches the
   * OpenTelemetry `prompt.id`). Official requires Claude Code v2.1.196+; absent
   * until the first user input. typed-not-populated in this engine.
   */
  prompt_id?: string;
  /** NEW-IN-DOCS: active permission mode at hook time. typed-not-populated. */
  permission_mode?: string;
  /** NEW-IN-DOCS: reasoning-effort level at hook time. typed-not-populated. */
  effort?: { level: string };
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
  /**
   * NEW-IN-DOCS: official incremental-render protocol. NOTE this engine is NOT
   * a true incremental delta stream — it fires MessageDisplay ONCE per COMPLETED
   * assistant message (same honest-subset stance as the Monitor tool). Therefore
   * `final` is always true, `delta` carries the whole message segment, and
   * `index` is monotonic across emits. Hosts that expect mid-message deltas will
   * simply receive one final delta per message.
   */
  turn_id: string;
  message_id: string;
  index: number;
  final: boolean;
  delta: string;
  /**
   * @deprecated Superseded by the official `delta` field (NEW-IN-DOCS). Kept on
   * a dual track so existing consumers keep compiling; carries the same whole
   * message text as `delta`.
   */
  message_text: string;
};

/** NEW-IN-DOCS: summary of a live background task, attached to Stop /
 *  SubagentStop inputs. typed-not-populated in this engine. */
export type BackgroundTaskSummary = {
  id: string;
  type: string;
  status: string;
  description: string;
  command?: string;
  agent_type?: string;
  server?: string;
  tool?: string;
  name?: string;
};

/** NEW-IN-DOCS: summary of a session cron, attached to Stop / SubagentStop
 *  inputs. typed-not-populated in this engine. */
export type SessionCronSummary = {
  id: string;
  schedule: string;
  recurring: boolean;
  prompt: string;
};

export type StopHookInput = BaseHookInput & {
  hook_event_name: 'Stop';
  stop_hook_active: boolean;
  /** NEW-IN-DOCS. typed-not-populated. */
  last_assistant_message?: string;
  /** NEW-IN-DOCS. typed-not-populated. */
  background_tasks?: BackgroundTaskSummary[];
  /** NEW-IN-DOCS. typed-not-populated. */
  session_crons?: SessionCronSummary[];
};

export type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStart';
};

export type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStop';
  stop_hook_active: boolean;
  agent_transcript_path?: string;
  /** NEW-IN-DOCS. typed-not-populated. */
  last_assistant_message?: string;
  /** NEW-IN-DOCS. typed-not-populated. */
  background_tasks?: BackgroundTaskSummary[];
  /** NEW-IN-DOCS. typed-not-populated. */
  session_crons?: SessionCronSummary[];
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

// NEW-IN-DOCS hook input types (all typed-not-fired; see HookEvent note). Field
// shapes track the live docs verbatim for drop-in compatibility.

export type SetupHookInput = BaseHookInput & {
  hook_event_name: 'Setup';
  trigger: 'init' | 'maintenance';
};

export type TeammateIdleHookInput = BaseHookInput & {
  hook_event_name: 'TeammateIdle';
  teammate_name: string;
  /** @deprecated since v2.1.178. Carries the session-derived team name. */
  team_name: string;
};

export type TaskCompletedHookInput = BaseHookInput & {
  hook_event_name: 'TaskCompleted';
  task_id: string;
  task_subject: string;
  task_description?: string;
  teammate_name?: string;
  /** @deprecated since v2.1.178. Carries the session-derived team name. */
  team_name?: string;
};

export type ConfigChangeHookInput = BaseHookInput & {
  hook_event_name: 'ConfigChange';
  source:
    | 'user_settings'
    | 'project_settings'
    | 'local_settings'
    | 'policy_settings'
    | 'skills';
  file_path?: string;
};

export type WorktreeCreateHookInput = BaseHookInput & {
  hook_event_name: 'WorktreeCreate';
  name: string;
};

export type WorktreeRemoveHookInput = BaseHookInput & {
  hook_event_name: 'WorktreeRemove';
  worktree_path: string;
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
  | NotificationHookInput
  | SetupHookInput
  | TeammateIdleHookInput
  | TaskCompletedHookInput
  | ConfigChangeHookInput
  | WorktreeCreateHookInput
  | WorktreeRemoveHookInput;

export type HookPermissionDecision = 'allow' | 'deny' | 'ask' | 'defer';

export type HookJSONOutput = {
  /** When false, the agent stops after this hook. */
  continue?: boolean;
  /**
   * Official field: hide this output's systemMessage from the conversation
   * surface. Honored by the hook aggregator since v0.7 (T2-7 close-out);
   * permission decisions and continue:false still apply regardless.
   */
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
  /**
   * v0.6: optional natural-language CONDITION gating this matcher. When set,
   * the runner evaluates it with a bounded single-shot model call (the
   * reproduced hook-condition evaluator; the stop variant for Stop /
   * SubagentStop events) BEFORE firing this matcher's callbacks, and SKIPS
   * them when the condition is not met. FAILS CLOSED: a garbled or errored
   * evaluation counts as not met. Omitted -> the existing fully-deterministic
   * path, zero model calls.
   */
  condition?: string;
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

/** Official per-tool entry of McpServerStatus.tools (name + optional
 *  description and coarse behavior annotations). */
export type McpServerToolInfo = {
  name: string;
  description?: string;
  annotations?: {
    readOnly?: boolean;
    destructive?: boolean;
    openWorld?: boolean;
  };
};

export type McpServerStatus = {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  serverInfo?: { name: string; version: string };
  error?: string;
  /** The config this server was registered with (echoed back; task #17). */
  config?: McpServerConfig;
  /**
   * Per-server tools, present once the server is connected — the official
   * McpServerToolInfo object shape (v0.7 alignment, T2-7), assembled at the
   * registry with description and mapped annotation hints.
   */
  tools?: McpServerToolInfo[];
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
  /**
   * FORK mode (opt-in). When true, an invocation of this subagent type continues
   * from the PARENT's context instead of a fresh isolated one: the child inherits
   * the parent's model + system prompt + tool set and is seeded with a copy of the
   * parent's message history (the delegated task appended as a trailing user turn),
   * so it shares the parent's already-cached prefix. Trade-off: agentDef.model /
   * tools / disallowedTools / permissionMode / prompt-as-system are INTENTIONALLY
   * ignored in fork mode (they would break the cached prefix); a fork child is
   * therefore as privileged as the parent. Default false -> isolated subagent.
   */
  fork?: boolean;
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
   * arrives for this many milliseconds (default 300000; `0` disables). Fires
   * faster and more diagnosably than the whole-request timeout when a stream
   * silently stalls — the API emits periodic `ping` events, so a gap this long
   * means the connection is stuck, not merely slow.
   */
  streamIdleTimeoutMs?: number;
  maxOutputTokens?: number;
  /** Automatic prompt caching via cache_control breakpoints; default true. */
  promptCaching?: boolean;
  /**
   * Cache lifetime for the prompt-cache breakpoints this engine places.
   * '5m' (default when omitted) is the 5-minute ephemeral cache; '1h' is the
   * 1-hour cache (2x write price, GA). BPT-EXTENSION: the official Agent SDK
   * exposes NO cache-TTL knob (its wrapped CLI decides internally); this
   * direct-API engine lets the caller choose. No effect when promptCaching is
   * false.
   */
  cacheTtl?: '5m' | '1h';
};

/**
 * Bash sandbox configuration (BPT-shaped object form of Options.sandbox).
 * Restriction scope v1: write-denial outside allowed dirs + network isolation
 * (binary) + sandbox-writable $TMPDIR — exactly what the archived guidance
 * describes, nothing invented.
 */
export type SandboxOptions = {
  /** Default true when a backend resolves. */
  enabled?: boolean;
  /** Sandboxed commands get network access (default false: `--unshare-net`). */
  allowNetwork?: boolean;
  /**
   * Extra absolute directories writable inside the sandbox. cwd,
   * additionalDirectories, the shell state dir and the sandbox tmp dir are
   * always writable automatically.
   */
  writablePaths?: string[];
  /**
   * false = mandatory mode: the Bash `dangerouslyDisableSandbox` parameter is
   * disabled by policy (removed from the schema; calls refused).
   */
  allowEscape?: boolean;
  /**
   * BPT extension: inject a custom sandbox backend (tests; a host-provided
   * Seatbelt implementation). When set it is used verbatim, no probing.
   */
  backend?: SandboxBackend;
};

/** One shell invocation a sandbox backend wraps (foreground and background). */
export type SandboxSpawnRequest = {
  shell: string;
  command: string;
  cwd: string;
  writablePaths: string[];
  tmpDir: string;
  allowNetwork: boolean;
};

/** The transformed spawn a backend returns: program + argv tail (+ env overlay). */
export type SandboxSpawnPlan = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

/** A pluggable sandbox implementation: pure argv transformation, no I/O. */
export interface SandboxBackend {
  readonly name: string;
  wrap(req: SandboxSpawnRequest): SandboxSpawnPlan;
}

/**
 * Resolved per-query sandbox state (threaded through ToolContext). Absent on a
 * context means Bash runs unsandboxed — honestly, with no sandbox prompts.
 */
export type SandboxContext = {
  backend: SandboxBackend;
  /** Per-query sandbox-writable temp dir ($TMPDIR target). */
  tmpDir: string;
  /** cwd + additionalDirectories + writablePaths + shell state dir + tmpDir. */
  writablePaths: string[];
  allowNetwork: boolean;
  /** false = mandatory mode: dangerouslyDisableSandbox is disabled by policy. */
  allowEscape: boolean;
};

/** NEW-IN-DOCS: how reasoning content is surfaced (Options.thinking `display`).
 *  typed-not-populated in this engine — no summarization/omission layer wired. */
export type ThinkingDisplay = 'summarized' | 'omitted';

export type ThinkingConfigParam =
  | { type: 'adaptive'; display?: ThinkingDisplay }
  | {
      type: 'enabled';
      budgetTokens?: number;
      budget_tokens?: number;
      budget?: number;
      /** NEW-IN-DOCS. typed-not-populated. */
      display?: ThinkingDisplay;
    }
  | { type: 'disabled' };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SettingSource = 'user' | 'project' | 'local';
// NEW-IN-DOCS default-semantics note (behavior deliberately NOT changed here):
// live docs redefine an omitted `settingSources` as "load user+project+local"
// (matching the CLI). This SDK follows the PINNED semantics — omitted = load
// NOTHING — unchanged, because flipping the default is a behavior-level reversal
// that would diverge from the pinned conformance arm. It is a keeper up-pin
// decision, handled only when the pins move. This SDK touches nothing here.

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

/** Official plugin config (Options.plugins element). ACCEPTED-IGNORED in this
 *  SDK: no plugin loader exists; typed so drop-in callers compile. */
export type SdkPluginConfig = {
  type: 'local';
  path: string;
  skipMcpDiscovery?: boolean;
};

/** Official built-in-tool behavior config (Options.toolConfig).
 *  ACCEPTED-IGNORED in this SDK: AskUserQuestion renders no preview layer. */
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
  /** v0.4: surface hook execution as system/hook_started + system/
   *  hook_response stream messages (official encoding since v0.7; default
   *  false — hooks otherwise report via debug only). Semantics unchanged by
   *  the v0.7 re-encoding. */
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
    | {
        type: 'preset';
        preset: 'claude_code';
        append?: string;
        /**
         * NEW-IN-DOCS: move per-session dynamic context into the first user
         * message for better prompt-cache reuse across machines.
         * typed-not-populated in this engine.
         */
        excludeDynamicSections?: boolean;
      }
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
  /** Official: write debug logs to a file (implies debug). ACCEPTED-IGNORED
   *  (debug output goes to the stderr callback / process.stderr only). */
  debugFile?: string;
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
  | 'model_error';

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
};

/** @deprecated Use the official export name SDKRateLimitEvent (v0.7 spelling
 *  swap). */
export type SDKRateLimitEventMessage = SDKRateLimitEvent;

/** An API call is being retried. EMITTED (v0.3) via the transport's onRetry
 *  observer on each non-429 (5xx/network) retry. */
export type SDKAPIRetryMessage = {
  type: 'api_retry';
  uuid: string;
  session_id: string;
  attempt: number;
  max_retries: number;
  status?: number;
  reason?: string;
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
  gitBranch?: string;
  cwd?: string;
  tag?: string;
  createdAt?: number;
};
