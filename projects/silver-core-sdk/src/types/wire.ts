/**
 * Silver Core SDK 公开类型面 — Anthropic Messages API 线格式子集（独立最小实现）。
 *
 * 自 src/types.ts 按其自带的分节切出（结构审视 P7，2026-07-27）：切分依据是文件
 * 原本就标好的分节注释，不是新发明的边界。src/types.ts 保留为 barrel，所有
 * `from '../types.js'` 的既有 import 一行未动。
 *
 * 溯源与合规声明见 src/types.ts 头注（clean-room，仅据公开文档）。
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
  /**
   * Server-side web-search call count carried through from the wire
   * `usage.server_tool_use.web_search_requests` (normalizeUsage populates it).
   * Optional so the various zeroUsage() factories can omit it (treated as 0);
   * without this field the count is stripped before recordUsage and the
   * official-surface ModelUsage.webSearchRequests is permanently 0.
   */
  web_search_requests?: number;
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
