/**
 * Silver Core SDK - public type surface.
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

import type { NormalizedProviderError } from './error-normalize.js';

/** Re-export so consumers can `import type { NormalizedProviderError }` from the
 *  package root alongside the rest of the SDK message surface. */
export type { NormalizedProviderError } from './error-normalize.js';

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
   * cap it sends (provider.maxOutputTokens, defaulting by protocol: 8192 on
   * 'anthropic', 128000 on 'openai-chat') — an honest runtime value,
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

/**
 * An Anthropic-provided (server-declared) tool entry, e.g.
 * `{ type: 'memory_20250818', name: 'memory' }`: the typed entry IS the whole
 * configuration — no input_schema is sent, the API injects the definition
 * server-side. Anthropic protocol only (the OpenAI translator drops these).
 */
export type APIServerToolDefinition = {
  type: string;
  name: string;
  /** Prompt-cache breakpoint marker (set by the cache-control layer). */
  cache_control?: CacheControlEphemeral | null;
};

/** One request `tools[]` entry: a custom tool definition or a server-declared
 *  typed entry. Discriminate on the presence of `input_schema`. */
export type APIToolDefinitionParam = APIToolDefinition | APIServerToolDefinition;

/**
 * Messages API `tool_choice` param (Options.toolChoice; forwarded verbatim to
 * the wire — snake_case `disable_parallel_tool_use` is the API field name). The
 * four variants are the official shape:
 *  - `auto`  : the model decides whether to call tools (API default).
 *  - `any`   : the model MUST call one of the available tools.
 *  - `tool`  : the model MUST call the named tool (`name` required).
 *  - `none`  : the model will NOT call any tool.
 * `disable_parallel_tool_use: true` caps the turn at a single tool call; it is
 * only meaningful for auto/any/tool (a `none` turn calls nothing).
 */
export type ToolChoice =
  | { type: 'auto'; disable_parallel_tool_use?: boolean }
  | { type: 'any'; disable_parallel_tool_use?: boolean }
  | { type: 'tool'; name: string; disable_parallel_tool_use?: boolean }
  | { type: 'none' };

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

/** One tool invocation in a PostToolBatch, official `tool_calls[]` element shape. */
export type PostToolBatchToolCall = {
  tool_name: string;
  tool_input: unknown;
  tool_use_id?: string;
};

export type PostToolBatchHookInput = BaseHookInput & {
  hook_event_name: 'PostToolBatch';
  /**
   * Official field (P2 parity): the full tool_use blocks that ran in the batch,
   * each carrying `tool_name`/`tool_input`/`tool_use_id`.
   */
  tool_calls: PostToolBatchToolCall[];
  /**
   * @deprecated Superseded by the official `tool_calls` field. Kept on a dual
   * track so existing consumers keep compiling; carries the same tool names as
   * `tool_calls.map(c => c.tool_name)`.
   */
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
  /**
   * BPT-EXTENSION (audit 2026-07-14 M-1): per-matcher failure policy for THIS
   * matcher's callbacks, overriding Options.hookFailureMode when set. The
   * global default stays 'open' (official drop-in parity), which means a
   * crashed or timed-out callback is treated as "no opinion" — a security
   * PreToolUse hook that WOULD have denied silently stops denying. Marking
   * the security-critical matcher 'closed' turns its callback failures into a
   * deny (fail safe) without changing behavior for every other hook; 'open'
   * likewise wins over a global 'closed' for a best-effort matcher. Omitted
   * -> the global setting applies.
   */
  failureMode?: 'open' | 'closed';
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
  /** Provenance of the config (P2): 'project' (.mcp.json) / 'local'
   *  (programmatic options.mcpServers) / 'dynamic' (added via setMcpServers). */
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
// Agents (subagent definitions; executed by the subagent runtime since v0.2)
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
 * Caller-supplied price entry (BPT-EXTENSION, audit 2026-07-10): USD per MTok
 * for a model-id prefix, merged OVER the static Claude price table (overrides
 * win on prefix match). Lets a gateway consumer price non-Claude models so
 * cost metrics and `maxBudgetUsd` are enforceable on the OpenAI protocol.
 */
export type PriceOverride = {
  /** USD per MTok of regular input tokens. */
  input: number;
  /** USD per MTok of output tokens. */
  output: number;
  /** USD per MTok of cache-creation input; default input x1.25. */
  cacheWrite?: number;
  /** USD per MTok of cache-read input; default input x0.1. */
  cacheRead?: number;
};

/**
 * Tuning for the OpenAI-protocol transport (BPT-EXTENSION). Read only when
 * `ProviderConfig.protocol` is 'openai-chat'; see docs/OPENAI-PROTOCOL.md.
 */
export type OpenAIProtocolOptions = {
  /**
   * Wire-model remapping applied by the transport just before the request is
   * encoded: `modelMap[model] ?? model`. Keys are the RESOLVED model ids that
   * would otherwise hit the wire — including Claude defaults baked into
   * subsystems (generators' utility model, verifier, alias table), e.g.
   * `{ 'claude-haiku-4-5': 'gpt-4o-mini' }`. One knob instead of chasing every
   * per-call-site model override; unmapped `claude-*` ids on this protocol
   * log a debug warning (they will 404 on an OpenAI endpoint).
   */
  modelMap?: Record<string, string>;
  /**
   * Name of the credential header (default 'authorization', sent as
   * `Bearer <key>`). Any other name sends the RAW key under that header —
   * e.g. 'api-key' for Azure OpenAI-style gateways.
   */
  authHeaderName?: string;
  /**
   * Extra query parameters appended to the chat/completions URL on every
   * request — e.g. `{ 'api-version': '2024-06-01' }` for Azure-style gateways.
   */
  extraQueryParams?: Record<string, string>;
  /**
   * Which wire param carries the output-token cap. Default 'max_tokens' (the
   * param every OpenAI-compatible gateway accepts); api.openai.com reasoning
   * models reject it and require 'max_completion_tokens'.
   */
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
  /**
   * Forwarded verbatim as `reasoning_effort`. The Anthropic `thinking` config
   * has no Chat Completions equivalent and is dropped from the wire; this is
   * the OpenAI-native reasoning knob instead.
   */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  /**
   * Extra top-level body fields merged into every request (gateway params,
   * e.g. `{ enable_thinking: false }`). Translator-owned keys win on conflict.
   */
  extraBody?: Record<string, unknown>;
};

/**
 * BPT extension: direct-API transport settings. The reference SDK spawns a
 * CLI subprocess; this SDK talks to the Messages API itself, so connection
 * settings live here. Falls back to ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN /
 * ANTHROPIC_BASE_URL environment variables when omitted.
 */
export type ProviderConfig = {
  /**
   * Wire protocol this transport speaks (BPT-EXTENSION). 'anthropic' (default)
   * drives the Messages API directly; 'openai-chat' drives an OpenAI-compatible
   * Chat Completions endpoint through a translating transport — the engine
   * keeps speaking Messages API shapes, translation happens at the wire
   * boundary only. With 'openai-chat', credentials resolve from apiKey /
   * authToken / OPENAI_API_KEY and baseUrl defaults to
   * 'https://api.openai.com/v1' (OPENAI_BASE_URL env fallback); `options.model`
   * must name a model the endpoint serves. See docs/OPENAI-PROTOCOL.md.
   */
  protocol?: 'anthropic' | 'openai-chat';
  /** OpenAI-protocol tuning; read only when protocol is 'openai-chat'. */
  openai?: OpenAIProtocolOptions;
  /**
   * Custom model pricing (BPT-EXTENSION, audit 2026-07-10): USD-per-MTok
   * entries keyed by model-id prefix, merged over the static Claude table
   * (overrides win on prefix match). Required for cost metrics /
   * `maxBudgetUsd` enforcement on non-Claude models (protocol 'openai-chat');
   * also usable to correct a stale static entry.
   */
  pricing?: Record<string, PriceOverride>;
  apiKey?: string;
  /** Bearer token auth (gateways); mutually exclusive with apiKey. */
  authToken?: string;
  baseUrl?: string;
  apiVersion?: string;
  defaultHeaders?: Record<string, string>;
  maxRetries?: number;
  /**
   * Per-request timeout in milliseconds (default 600000). Governs the REQUEST
   * phase (connect through response headers) of each attempt. Once the stream
   * is flowing, the body is governed by the idle watchdog plus the optional
   * `streamMaxDurationMs` hard cap instead — a healthy long turn is never cut
   * mid-flow by a clock that ignores progress. Fallback: when the idle
   * watchdog is explicitly disabled (`streamIdleTimeoutMs: 0`) and no hard cap
   * is set, this timeout keeps governing the body too, so no configuration is
   * ever unbounded.
   */
  timeoutMs?: number;
  /**
   * Idle watchdog for the streaming phase: abort the stream if no SSE event
   * arrives for this many milliseconds (default 300000; `0` disables). Fires
   * faster and more diagnosably than the whole-request timeout when a stream
   * silently stalls — the API emits periodic `ping` events, so a gap this long
   * means the connection is stuck, not merely slow.
   */
  streamIdleTimeoutMs?: number;
  /**
   * Optional hard cap on TOTAL streaming duration in milliseconds (default 0 =
   * disabled; env fallback `BPT_STREAM_MAX_DURATION_MS`). Unlike the idle
   * watchdog this fires even on a flowing stream; when it does, content blocks
   * delivered whole remain salvageable (E3) instead of the turn being voided.
   * BPT-EXTENSION: the primary body governor is the idle watchdog — set this
   * only when an absolute wall-clock bound per turn is required.
   */
  streamMaxDurationMs?: number;
  /**
   * Cap on concurrently in-flight Messages API requests through THIS transport
   * (default 0 = unlimited). When many conversations share one transport (a
   * SessionManager), N concurrent `mgr.query()` drives open N streams at once
   * and can thrash the API rate limit; set this to bound the API concurrency
   * while `runConcurrent`'s `concurrency` bounds the conversations. Excess
   * requests queue (FIFO) until a slot frees; a request holds its slot for the
   * whole streaming lifetime. Env fallback: `BPT_MAX_CONCURRENT_REQUESTS`.
   * BPT-EXTENSION: the official SDK has no such knob (its CLI owns concurrency).
   */
  maxConcurrentRequests?: number;
  /**
   * Custom fetch implementation used for EVERY HTTP request this transport
   * issues. BPT-EXTENSION. Highest-priority override: when set it wins over
   * `httpClient` and the built-in default. The seam for proxies, mTLS, and
   * request instrumentation (recipes: docs/PERFORMANCE.md). The function
   * receives exactly what the transport would pass to global fetch (endpoint
   * URL + RequestInit including signal) and must resolve to a WHATWG
   * Response whose body is the SSE stream.
   */
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  /**
   * Which built-in HTTP client drives requests when `fetch` is not injected
   * (BPT-EXTENSION; default 'node', env fallback `BPT_HTTP_CLIENT`).
   * - 'node' (default since v0.45.0): the SDK's zero-dependency node:http(s)
   *   adapter with long keep-alive agents + TLS session cache — connections
   *   survive slow tool runs instead of re-paying a TCP+TLS handshake
   *   (typically 100-300ms) each turn, the way global fetch's ~4s idle pool
   *   does. Idle sockets are unref'd, so the warm pool never blocks process
   *   exit. Divergences from fetch (all inert against the Messages API): no
   *   redirect following, no accept-encoding, bodies always carry an
   *   explicit content-length.
   * - 'fetch': the pre-v0.45 behavior — the CURRENT global fetch, resolved
   *   at call time. Pick this when you rely on undici semantics such as
   *   setGlobalDispatcher / NODE_USE_ENV_PROXY proxying or global-fetch
   *   test stubs.
   */
  httpClient?: 'node' | 'fetch';
  /**
   * Fire ONE fire-and-forget unauthenticated HEAD to the endpoint at
   * transport construction (BPT-EXTENSION; default false, env fallback
   * `BPT_PRECONNECT=1`). Warms DNS+TCP+TLS in parallel with MCP connect /
   * session resolution so the first real request skips the handshake
   * (~100-300ms off first-turn TTFT). Off by default: it is extra traffic
   * the caller did not ask for. Failures are swallowed (never a failure
   * source); no credential rides the probe.
   */
  preconnect?: boolean;
  /**
   * Per-request output-token cap (`max_tokens` / the configured
   * maxTokensParam on the wire). Default is protocol-aware: 8192 on
   * 'anthropic' (that API 400s a cap above the model's output ceiling and no
   * per-model table is bundled), 128000 on 'openai-chat' (BPT ruling
   * 2026-07-14 — agentic turns on large-output gateway models were starved
   * at 8192). A model/gateway whose ceiling is lower rejects the request
   * with a clear surfaced APIStatusError; set this explicitly to match your
   * endpoint. Note: compaction budgets derive from `contextWindow -
   * maxOutputTokens`, so a cap at/above the model's context window disables
   * compaction (logged, not silent).
   */
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
 * Opaque handle to the SDK's internal Transport contract (BPT-EXTENSION,
 * cross-protocol subagent routing 2026-07-13). The public type surface cannot
 * import `internal/contracts.ts` (contracts imports types.ts — a cycle), so
 * this structural stand-in carries transports across the
 * `resolveSubagentTransport` boundary. Treat values as opaque: obtain them
 * from `input.parentTransport` or `createSubagentTransportResolver()`; the
 * real internal Transport satisfies this shape.
 */
export interface SubagentTransportHandle {
  stream(req: never): AsyncGenerator<unknown, void>;
  apiKeySource(): ApiKeySource;
  /** Optional resource release (idle connection pools etc.). The built-in
   *  transports self-clean (unref'd keep-alive sockets with a TTL) and do not
   *  implement it; a custom transport may. Called by the subagent runtime at
   *  query teardown for resolutions returned with `owned: true`. */
  dispose?(): void;
}

/**
 * What `resolveSubagentTransport` returns for one isolated-subagent spawn
 * (BPT-EXTENSION, cross-protocol subagent routing 2026-07-13).
 */
export type SubagentTransportResolution = {
  /** Transport the child loop must drive. Return the parent's own instance
   *  (or `undefined` from the resolver) to share it. */
  transport: SubagentTransportHandle;
  /**
   * True hands the transport's lifecycle to the subagent runtime: its
   * `dispose()` (when implemented) is called once at query teardown, after
   * every child settled. False (default) means the host owns it — e.g. an
   * instance memoized across spawns. Children NEVER dispose a shared parent
   * transport regardless of this flag.
   */
  owned?: boolean;
  /** Wire protocol of `transport`, for the spawn log line only. */
  protocol?: 'anthropic' | 'openai-chat';
  /**
   * Thinking config for the child. Omitted + transport SWITCHED + child model
   * id without 'claude' -> the runtime safely drops the inherited thinking
   * config (a Claude-shaped `thinking` param sent to a non-Claude model is
   * gateway-rejected more often than honored). Omitted + transport shared ->
   * the parent config is inherited unchanged (existing behavior). NOTE this
   * value is the config-level INTENT: the engine still fits the wire form to
   * the live child model per turn (computeThinking — adaptive vs
   * budget_tokens), exactly as it does for the main loop's Options.thinking.
   */
  thinking?: ThinkingConfigParam;
  /** Child maxThinkingTokens; same defaulting rules as `thinking`. */
  maxThinkingTokens?: number;
  /** Child promptCaching; inherited from the parent when omitted. */
  promptCaching?: boolean;
};

/** Input handed to `resolveSubagentTransport` for one internal model call. */
export type SubagentTransportRequest = {
  /** Fully resolved child model id (per-call override / agentDef.model /
   *  parent fallback, aliases expanded). */
  model: string;
  /**
   * Which internal call is asking (v0.55.0): 'subagent' (isolated child
   * spawn), 'utility' (generator calls, e.g. hook `condition` evaluation on
   * the default Haiku-tier utility model), or 'compaction' (the summarizer
   * when `compaction.model` differs from the session model). The standard
   * resolver routes purely by model; hosts may branch on this for logging or
   * per-purpose policy.
   */
  purpose: 'subagent' | 'utility' | 'compaction';
  /** The live parent model id. */
  parentModel: string;
  /** Wire protocol of the parent transport. */
  parentProtocol: 'anthropic' | 'openai-chat';
  parentTransport: SubagentTransportHandle;
  /** The query's provider config (undefined when the caller passed none). */
  parentProvider?: ProviderConfig;
  /** The query's resolved env (credential/base-URL fallback chains). */
  env: Record<string, string | undefined>;
  /** Always false in v1: forks NEVER consult the resolver (a fork's cached
   *  prefix requires the parent model + transport). Field kept so the shape
   *  is forward-compatible should that ever loosen. */
  fork: boolean;
  debug: (msg: string) => void;
};

/**
 * Host callback resolving the transport an ISOLATED subagent drives
 * (BPT-EXTENSION, cross-protocol subagent routing 2026-07-13). Called once
 * per isolated spawn AFTER the child model is resolved; never called for
 * forks. Return `undefined` to share the parent transport (the default when
 * the option is absent — existing single-protocol behavior is unchanged).
 * `createSubagentTransportResolver()` builds the common implementation from a
 * model->protocol routing table with per-protocol transport memoization.
 */
export type SubagentTransportResolver = (
  input: SubagentTransportRequest,
) =>
  | SubagentTransportResolution
  | undefined
  | Promise<SubagentTransportResolution | undefined>;

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
 *  Forwarded verbatim to the wire thinking param (P2); the API owns the actual
 *  summarize/omit behavior. */
export type ThinkingDisplay = 'summarized' | 'omitted';

export type ThinkingConfigParam =
  | { type: 'adaptive'; display?: ThinkingDisplay }
  | {
      type: 'enabled';
      budgetTokens?: number;
      budget_tokens?: number;
      budget?: number;
      /** NEW-IN-DOCS. Forwarded to the wire thinking param (P2). */
      display?: ThinkingDisplay;
    }
  | { type: 'disabled' };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SettingSource = 'user' | 'project' | 'local';
// Default semantics (bump-pin ruling 2026-07-05, keeper "确定升钉了"): an OMITTED
// `settingSources` loads user+project+local — matching official Claude Code /
// the live @anthropic-ai/claude-agent-sdk docs. This FLIPPED the earlier
// pinned-0.3.199 default (omitted = load nothing); it was the last behavior-
// level NEW-IN-DOCS hold, gated behind the up-pin because a default flip
// diverges from the pinned conformance arm. An explicit array — including `[]`
// — is honored verbatim: `[]` is the explicit opt-OUT. Resolver:
// internal/setting-sources.ts (single source of truth).

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
  /**
   * BPT-EXTENSION (prompt-composition, 2026-07-09): an optional human label for
   * this layer (e.g. 'core' / 'team' / 'memory'). Metadata only — it is NEVER
   * serialized onto the wire; it flows through solely so the prompt-composition
   * breakdown (Options.includePromptComposition) can attribute this segment's
   * tokens to the caller's own bucket.
   */
  label?: string;
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

/**
 * BPT-EXTENSION: tunable Read output limits (spec 2026-07-06). The MECHANISM
 * (total-char cap on a line boundary, a footer that reflects the cap, per-line
 * truncation markers, the Grep hint) lives in the SDK; only the NUMBERS are the
 * caller's. Both default when omitted (50000 total chars / 2000 per line).
 */
export type ReadLimits = {
  /** Total characters one Read returns before truncating on a line boundary. */
  maxOutputChars?: number;
  /** Characters kept per line before the per-line truncation marker. */
  maxLineChars?: number;
};

/**
 * Client-side storage contract for the memory tool (BPT-EXTENSION, memory
 * system spec R3): the injection point that keeps memory data entirely in the
 * hosting application's hands — the SDK defines the contract and never knows
 * the storage medium. Paths are virtual (`/memories[/...]`) and arrive
 * SDK-validated (spec R4); implementations must still not trust them (defense
 * in depth). Each method returns the reference result string, or throws an
 * Error whose message is the reference error string.
 *
 * Prefer implementing the storage primitives (`MemoryFileOps`) and wrapping
 * them with `createMemoryStore()` — that inherits the byte-exact reference
 * formats. Validate any implementation with `runMemoryStoreContractSuite()`.
 */
export interface MemoryStore {
  view(path: string, viewRange?: [number, number]): Promise<string>;
  create(path: string, fileText: string): Promise<string>;
  strReplace(path: string, oldStr: string, newStr: string | undefined): Promise<string>;
  insert(path: string, insertLine: number, insertText: string): Promise<string>;
  delete(path: string): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<string>;
}

/**
 * One memory mount declaration (BPT-EXTENSION, memory governance spec S1):
 * a virtual subtree under `/memories` this query may touch, with its rights.
 * Mounts are per-query — the embedder instantiates them from its own session
 * context (e.g. `/memories/team` read-only + `/memories/users/<id>` read-write
 * for a user session; `/memories/team` read-write for a synthesis batch task).
 */
export type MemoryMount = {
  /** Virtual path under /memories (e.g. '/memories/team'). Trailing slashes
   *  are tolerated; an invalid path is a ConfigurationError at query(). */
  path: string;
  mode: 'read-only' | 'read-write';
};

/**
 * Memory system configuration (BPT-EXTENSION; docs/MEMORY.md). Presence of
 * the object enables the `memory` tool (set `enabled: false` to keep a shared
 * options spread but switch the system off).
 */
/**
 * Run-signal ledger options (self-improvement spec SCS-REQ-002 loop 1 /
 * REQ-1.1; see src/reporting/run-log.ts for the record contract).
 */
export type RunLogOptions = {
  /** Directory for the runlog-{YYYY-MM-DD}.jsonl day files (created on demand). */
  dir: string;
  /** Workload tag stamped on every record of this query (e.g. 'coding' /
   *  'non-coding'); the report's top-consumer split keys on it. */
  scenario?: string;
};

export type MemoryOptions = {
  /** Default true when the object is present. */
  enabled?: boolean;
  /**
   * Storage implementation. Default: a local-filesystem store rooted at
   * `<cwd>/.claude/memory/memories` (development / single-machine use).
   */
  store?: MemoryStore;
  /**
   * Base directory for the DEFAULT local store (ignored when `store` is
   * given); the memory root is `<baseDir>/memories`.
   */
  baseDir?: string;
  /**
   * Tool assembly mode (spec R2). 'native' declares the official
   * `{ type: 'memory_20250818', name: 'memory' }` entry and lets the API
   * inject the definition + protocol prompt (Anthropic protocol only);
   * 'custom' advertises an SDK-defined equivalent tool and injects the
   * protocol prompt SDK-side (any protocol). Default: by transport protocol —
   * anthropic -> 'native', openai-chat -> 'custom'. Forcing 'native' on an
   * openai-chat provider is a configuration error (query() throws).
   */
  mode?: 'native' | 'custom';
  /** `create` on an existing file overwrites instead of erroring (the
   *  reference behavior; spec R1 opt-in). Default false. */
  createOverwrite?: boolean;
  /**
   * Memory scope routing (governance spec S1): the subtrees this query may
   * touch and with what rights, enforced at the SDK tool layer (never via
   * prompt discipline). Writes outside a read-write mount and any access
   * outside every mount are rejected with structured errors; a strict
   * ancestor directory of a mount stays viewable for navigation with its
   * listing filtered to mount-visible entries. Omit for unrestricted
   * access to the whole /memories tree (pre-S1 behavior); an empty array is
   * a ConfigurationError. The resident index (R6) is only injected when
   * `/memories/MEMORY.md` is readable under the mounts.
   */
  mounts?: MemoryMount[];
  /**
   * Resident memory index (spec R6): at session start the harness reads the
   * head of `/memories/MEMORY.md` (when it exists) into the system prompt so
   * the index survives context resets without a tool round-trip. `false`
   * disables; defaults: maxLines 200, maxBytes 25600 — first limit hit wins.
   */
  indexInjection?: false | { maxLines?: number; maxBytes?: number };
  /** Extra consumer guidance appended after the protocol prompt in 'custom'
   *  mode (e.g. "Only record information relevant to <topic>."). */
  instructions?: string;
  /**
   * Governance limits (spec R8). Defaults: maxFileBytes 65536,
   * maxFilesPerDirectory 64, maxViewChars 16000 (view output beyond this is
   * truncated on a line boundary with a view_range pagination hint). Byte and
   * file-count limits are enforced in the store engine (createMemoryStore /
   * the built-in local store); view truncation and the create-size cap are
   * ALSO enforced at the tool layer, so they hold for directly-implemented
   * MemoryStore injections too.
   */
  limits?: {
    maxFileBytes?: number;
    maxFilesPerDirectory?: number;
    maxViewChars?: number;
  };
  /**
   * Structured memory-card mode (spec R9): 'cards' requires every written
   * memory file to be one or more cards with the fixed fields 结论 / 依据 /
   * 过期条件 under a `## <title>` heading. Invalid content is rejected with a
   * structured error the model can retry from. Aimed at models with weak
   * write-side discipline; omit for free-form writing.
   */
  schema?: 'cards';
  /** Card limits for schema 'cards'. Defaults: maxCardChars 500,
   *  maxCardsPerFile 50. */
  cards?: { maxCardChars?: number; maxCardsPerFile?: number };
  /**
   * Compaction flush (spec R7): when auto-compaction is about to fold the
   * conversation, first give the model one write opportunity ("record
   * un-saved progress to memory now") — the fold happens on the following
   * turn. A PreCompact hook deny suppresses the flush (and the fold). Default
   * true; set false to compact without the flush round.
   */
  flushOnCompaction?: boolean;
  /**
   * Session-end progress card (spec R7): when the query ends NORMALLY (never
   * on abort or error), run one bounded memory-update round ("update the
   * progress card in /memories/MEMORY.md"). Its assistant/user messages are
   * streamed, its result message is absorbed into session accounting instead
   * of being yielded (the task's own final result stays the last result the
   * consumer sees). Default true when memory is enabled; set false to
   * disable.
   */
  sessionEndUpdate?: boolean;
  /**
   * Pitfall recording protocol (self-improvement spec SCS-REQ-002 Phase 0 /
   * REQ-3.2): inject an sdk-original system-prompt fragment instructing the
   * model to record non-obvious failures ("pitfalls") under
   * `/memories/pitfalls/` — one file per distinct pitfall with symptom, root
   * cause, fix and avoidance — restricted to technical facts (the stripping
   * rule: no evaluative statements about people, no PII beyond what the fix
   * requires). Applies in BOTH assembly modes (it is consumer guidance layered
   * on top of the base protocol, not a duplicate of it). The object form
   * appends extra guidance after the default text. Never injected on an
   * incognito session (memory is read-only there; a write protocol would
   * contradict it). Default: disabled.
   */
  pitfalls?: boolean | { instructions?: string };
};

/**
 * Memory-operation counters for one run (spec R8 observability; rides
 * SDKRunMetrics.memoryHealth when the memory system is enabled). All-zero
 * means the model never touched memory.
 */
export type SDKMemoryHealth = {
  /** Total memory tool invocations. */
  operations: number;
  /** view commands. */
  reads: number;
  /** create / str_replace / insert / delete / rename commands. */
  writes: number;
  /** Invocations that returned is_error. */
  errors: number;
  /** UTF-8 bytes of view output returned to the model (post-truncation). */
  bytesRead: number;
  /** UTF-8 bytes of content handed to write commands (file_text /
   *  insert_text / new_str). */
  bytesWritten: number;
  /** Estimated tokens of the resident memory-index injection (R6), so the
   *  read-side residency cost shows up on the bill. */
  indexInjectionTokens: number;
};

/**
 * One structured tool-call record (BPT-EXTENSION, memory governance spec S3),
 * persisted to the session JSONL at the same level as the message lines so
 * "the model SAID it called a tool" is always checkable against "a tool call
 * actually happened". Records are written at dispatch time by the engine —
 * they never depend on reconstructing tool_use blocks from message text.
 * Read them back with `getSessionToolCalls()`; audit claims against them with
 * `auditToolClaims()`. Incognito sessions (S2) write none.
 */
export type SDKToolCallRecord = {
  type: 'tool_call';
  uuid: string;
  session_id: string;
  /** 1-based dispatch sequence within one query() run (a resumed session's
   *  file restarts at 1 for the new run; `timestamp` orders across runs). */
  seq: number;
  /** ISO timestamp of dispatch start. */
  timestamp: string;
  /** The tool_use block id — joins the record to the full tool_use block
   *  (untruncated input) persisted in the assistant message. */
  tool_use_id: string;
  tool_name: string;
  /** JSON of the input, truncated at 2048 chars (see tool_use_id for the
   *  full input). */
  tool_input: string;
  /** 'ok' = a tool_result without is_error; 'error' covers execution errors,
   *  permission denials, hook stops and unknown tools (detail in
   *  result_summary). */
  status: 'ok' | 'error';
  /** Full dispatch duration (hooks + permission gate + execution). */
  duration_ms: number;
  /** Result content head, truncated at 500 chars. */
  result_summary: string;
  /** Present on a subagent's tool call: the parent Task tool_use id. */
  parent_tool_use_id?: string;
};

export type Options = {
  abortController?: AbortController;
  additionalDirectories?: string[];
  /** Read output limits (BPT-EXTENSION); omit for the defaults. */
  readLimits?: ReadLimits;
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
  /**
   * BPT-EXTENSION (audit 2026-07-10): what a hook callback's failure (throw
   * or timeout) means for the permission aggregate. 'open' (default, the
   * historical and official-parity behavior): the failure is logged and
   * treated as neutral — note this means a broken PreToolUse policy hook
   * silently stops denying. 'closed': the failure contributes a deny, so
   * hook-enforced policy fails safe (tool calls block while the hook is
   * broken). Cancellation via the caller's signal is never treated as a deny.
   * A matcher-level HookCallbackMatcher.failureMode overrides this global
   * setting for that matcher's callbacks (audit 2026-07-14 M-1).
   */
  hookFailureMode?: 'open' | 'closed';
  /** v0.4: surface hook execution as system/hook_started + system/
   *  hook_response stream messages (official encoding since v0.7; default
   *  false — hooks otherwise report via debug only). Semantics unchanged by
   *  the v0.7 re-encoding. */
  includeHookEvents?: boolean;
  /**
   * BPT-EXTENSION (prompt-composition, 2026-07-09): emit a `system` /
   * `prompt_composition` observability message just before each request is sent,
   * carrying the SDK's own per-part token estimate (systemBase / systemAppend /
   * toolDefs / messages) and the request's cache_control breakpoint map (each
   * with the estimated size of the prefix it seals). Lets a downstream "context
   * composition" panel use the SDK's exact segmentation + context-window
   * accounting口径 instead of reverse-engineering a transcript, and map the
   * API's real usage counts onto content buckets. Default false (zero cost when
   * off; the wire request is never affected). The same data is available
   * synchronously via the exported `analyzeRequestComposition`.
   */
  includePromptComposition?: boolean;
  includePartialMessages?: boolean;
  /**
   * Incognito session (BPT-EXTENSION, memory governance spec S2): a session
   * that leaves no SDK-side persistent trace. When true:
   *  - the session transcript is NOT persisted (persistSession is forced off;
   *    combining with `sessionStore` is a ConfigurationError);
   *  - the memory tool degrades to READ-ONLY: `view` stays available ("knows
   *    you, doesn't record you"), the five write commands are rejected with a
   *    structured error at the SDK layer;
   *  - the R7 memory write rounds (compaction flush + session-end progress
   *    card) are disabled;
   *  - structured tool-call records (S3) are not written.
   * Promise boundary: "incognito" means nothing enters SDK storage or the
   * memory store. Requests are still sent to the configured model API and
   * remain subject to its terms; workspace files the model edits via
   * Write/Edit/Bash are the user's own actions and are out of scope.
   */
  incognito?: boolean;
  maxBudgetUsd?: number;
  /**
   * @deprecated Official docs mark `maxThinkingTokens` deprecated in favor of
   * the structured `thinking` config. Still honored here as a budget fallback
   * (see `thinking`); prefer `thinking: { type, budget_tokens }`.
   */
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
   * BPT-EXTENSION (cross-protocol subagent routing, 2026-07-13): resolve the
   * transport an ISOLATED subagent drives when its resolved model needs a
   * different wire protocol than the parent (e.g. an openai-chat parent
   * spawning a child model only served on the gateway's Anthropic route —
   * previously the child rode the parent transport unconditionally and the
   * gateway 400'd "model not found"). Absent -> children share the parent
   * transport (existing behavior). Forks never consult it. See
   * `createSubagentTransportResolver()` for the standard implementation.
   * Since v0.55.0 the same callback also routes the OTHER internal calls that
   * target a non-session model — utility generator calls (hook `condition`
   * evaluation) and the compaction summarizer — distinguished by
   * `input.purpose`.
   */
  resolveSubagentTransport?: SubagentTransportResolver;
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
   * Which on-disk instruction sources to load, matching
   * @anthropic-ai/claude-agent-sdk. Two DISTINCT effects (audit 2026-07-10
   * P0-5):
   *  1. CLAUDE.md / AGENTS.md system-prompt injection — 'project'/'local' walk
   *     up from cwd, 'user' reads ~/.claude/CLAUDE.md. Applies ONLY on the
   *     `claude_code` preset / default harness path (a string/segments
   *     systemPrompt is caller-owned verbatim).
   *  2. Project `.mcp.json` server loading — applies on EVERY systemPrompt
   *     path (project/local sources enable it).
   * OMITTED (undefined) loads all three sources — user+project+local —
   * matching official Claude Code (the bump-pin default, 2026-07-05). An
   * explicit `[]` loads nothing (opt-out); an explicit subset loads exactly
   * that subset.
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
  /** ACCEPTED-IGNORED (audit 2026-07-10): despite the official name, this SDK
   *  has no consumer for the flag — project `.mcp.json` loading is governed by
   *  `settingSources` instead. See docs/COMPAT.md. */
  strictMcpConfig?: boolean;
  /**
   * System-prompt selection. NOTE a documented behavior fork (audit
   * 2026-07-10 P1-5a): OMITTING this field and spelling the `claude_code`
   * preset converge on the SAME prompt text, but ONLY the preset spelling
   * enables the default thinking configuration — cost and stream content
   * differ between the two "equivalent" spellings. See also `thinking`.
   */
  systemPrompt?:
    | string
    | {
        type: 'preset';
        preset: 'claude_code';
        append?: string;
        /**
         * BPT-EXTENSION (prompt-composition, 2026-07-09): labeled append
         * segments layered after the preset base, in order. Their `text` is
         * concatenated into the appended stable tail exactly as `append` would
         * be (byte-identical wire output, so caching/conformance are
         * unaffected) — the `label`s are metadata only and let the
         * prompt-composition breakdown (includePromptComposition) attribute
         * each bucket (e.g. Root / Runtime / Memory) separately. When both are
         * present, `append` is emitted first, then these in order.
         */
        appendSegments?: { label: string; text: string }[];
        /**
         * NEW-IN-DOCS: move per-session dynamic context into the first user
         * message for better prompt-cache reuse across machines.
         * typed-not-populated in this engine.
         */
        excludeDynamicSections?: boolean;
      }
    | { type: 'segments'; segments: SystemPromptSegment[] };
  /**
   * Thinking configuration. Unset + `claude_code` PRESET systemPrompt ->
   * default thinking is enabled (E1); unset + OMITTED systemPrompt -> no
   * thinking param is sent (the preset-vs-omitted fork, audit 2026-07-10
   * P1-5a). On `provider.protocol: 'openai-chat'` this config does not
   * translate and is dropped from the wire (use provider.openai.reasoningEffort).
   */
  thinking?: ThinkingConfigParam;
  /** Restrict built-in tools by name; defaults to all built-ins. */
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
  /**
   * Steer or constrain tool use for every request in this session. Forwarded
   * verbatim as the Messages API `tool_choice` param when tools are present
   * (an empty tool set omits it, since the API rejects `tool_choice` with no
   * tools). `{ type: 'tool', name }` forces a specific tool; `{ type: 'any' }`
   * forces some tool; `{ type: 'none' }` forbids tools; and
   * `disable_parallel_tool_use: true` caps the turn at one tool call. Omitted ->
   * the API default (`auto`). */
  toolChoice?: ToolChoice;
  /** Extra beta flags forwarded via the anthropic-beta header. */
  betas?: string[];
  /** Enable debug logging via stderr callback. */
  debug?: boolean;
  /** Official: write debug logs to a file (implies debug). FULL (P2): each
   *  debug line is best-effort appended to this file in addition to the stderr
   *  callback / process.stderr. See docs/COMPAT.md. */
  debugFile?: string;
  /** BPT extension: context-compaction tuning (see docs/COMPAT.md). */
  compaction?: CompactionOptions;
  /** BPT extension: disconnect-resilience tuning (see docs/RESILIENCE.md). */
  resilience?: ResilienceOptions;
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
  /** BPT-EXTENSION: cross-session memory tool (memory_20250818 equivalence);
   *  see MemoryOptions + docs/MEMORY.md. Absent -> no memory tool. */
  memory?: MemoryOptions;
  /** BPT-EXTENSION (self-improvement spec SCS-REQ-002 loop 1): mirror every
   *  consumer-facing result message as one JSONL line in
   *  `{dir}/runlog-{YYYY-MM-DD}.jsonl` — the signal source
   *  generateRuntimeReport() aggregates. Facts only, no conversation content;
   *  incognito sessions contribute transport/token statistics but no
   *  identity, tag or error text. Absent -> no ledger writes. */
  runLog?: RunLogOptions;
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
 *  turn). In this direct-API engine there is no uuid-stamped async message
 *  queue surviving an abort — interrupt() aborts the active turn (or arms the
 *  next-turn cancel) and there is nothing left queued — so the receipt is
 *  always `{ still_queued: [] }`. The field is present for drop-in consumers
 *  that read it; an empty array does not mean "nothing will run" (per the
 *  official coverage caveat), it means this engine tracks no surviving async
 *  messages by uuid. */
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
   * uuids of async user messages that survive the interrupt. This engine keeps
   * no uuid-stamped async message queue, so the receipt is always
   * `{ still_queued: [] }` (see SDKControlInterruptResponse). Callers that
   * `await q.interrupt()` and ignore the result are unaffected.
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
