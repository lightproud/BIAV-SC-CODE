/**
 * BPT Master Protocol Types (母版协议类型)
 *
 * Why: These types are the single source of truth for data structures shared
 * between the Electron main process and the React renderer. Both sides import
 * from here (or from equivalent declarations in preload). Keeping one canonical
 * definition prevents drift between IPC sender and receiver.
 */

// ─── Conversation ───────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;   // epoch ms
  updatedAt: number;   // epoch ms
  messages: Message[];
  gear: Gear;
}

export type Gear = 'chat' | 'work';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: ContentBlock[];
  timestamp: number;
  tokenUsage?: TokenUsage;
}

// ─── Content Blocks ─────────────────────────────────────────────

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | CiteBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  /** Full result stored locally when truncated. null = not truncated. */
  fullArtifactPath?: string;
  isError?: boolean;
}

/** A @Cite block injected from BPE panel into the conversation. */
export interface CiteBlock {
  type: 'cite';
  source: string;   // file path
  lineStart?: number;
  lineEnd?: number;
  text: string;
}

// ─── Token Accounting (6-dimensional) ───────────────────────────

export interface TokenUsage {
  system: number;
  tools: number;
  history: number;
  generation: number;
  cacheHit: number;
  cacheWrite: number;
  /** Estimated cost in USD for this single turn. */
  estimatedCostUsd: number;
}

// ─── LLM Provider ───────────────────────────────────────────────

export interface LLMEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Model ID to send in the request body. */
  model: string;
}

/**
 * Events streamed from main process to renderer during a chat turn.
 * Includes both LLM-originated events and orchestrator events (tool_result, assistant_continue).
 */
export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; text: string }
  | { type: 'tool_use_end' }
  | { type: 'tool_result'; toolUseId: string; name: string; content: string; isError: boolean; artifactId?: string }
  | { type: 'assistant_continue' }
  | { type: 'message_end'; usage: TokenUsage }
  | { type: 'error'; error: string };

// ─── Tool Registry ──────────────────────────────────────────────

export type ToolSource = 'builtin' | 'mcp' | 'plugin';

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  source: ToolSource;
  /** Which gear(s) this tool is active in. Empty = always active. */
  gears: Gear[];
}

// ─── Silver Core ────────────────────────────────────────────────

export interface SilverSearchResult {
  file: string;
  score: number;
  preview: string;
  scores: Record<string, number>;
}

export interface SilverGraphNode {
  name: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface SilverGraphNeighbor {
  name: string;
  type: string;
  edge: string;
  direction: string;
  depth: number;
}

// ─── BPE (Black Pool Explorer) ──────────────────────────────────

export interface BPEChunk {
  id: number;
  file: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  language: string;
  score: number;
  /** One-sentence summary from Haiku reranker, if available. */
  summary?: string;
}

// ─── App Config ─────────────────────────────────────────────────

export interface AppConfig {
  endpoint: LLMEndpoint;
  silverMcpPath: string;     // path to scripts/mcp_server.py
  repoRoot: string;          // path to brain-in-a-vat root
  truncateThreshold: number; // max tokens for tool result before truncation
  compressionTriggerTurns: number;
  compressionTriggerTokens: number;
}

// ─── IPC Channel Names ──────────────────────────────────────────
// Why: Centralizing channel names prevents typos and makes it easy to
// audit which channels exist.

export const IPC = {
  // LLM
  CHAT_SEND: 'chat:send',
  CHAT_STREAM: 'chat:stream',
  CHAT_ABORT: 'chat:abort',

  // Conversations
  CONV_LIST: 'conv:list',
  CONV_CREATE: 'conv:create',
  CONV_DELETE: 'conv:delete',

  // Config
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',

  // Gear
  GEAR_SWITCH: 'gear:switch',
  GEAR_GET: 'gear:get',

  // Silver Core
  SILVER_SEARCH: 'silver:search',
  SILVER_GRAPH_QUERY: 'silver:graphQuery',
  SILVER_GRAPH_FILES: 'silver:graphFiles',
  SILVER_RECOMMEND: 'silver:recommend',
  SILVER_STATUS: 'silver:status',

  // BPE
  BPE_SEARCH: 'bpe:search',
  BPE_LOOKUP: 'bpe:lookup',
  BPE_STATUS: 'bpe:status',

  // Token log
  TOKEN_LOG: 'token:log',
  TOKEN_HISTORY: 'token:history',

  // Cite
  CITE_INJECT: 'cite:inject',

  // Artifacts
  ARTIFACT_LIST: 'artifact:list',
  ARTIFACT_GET: 'artifact:get',
  ARTIFACT_DELETE: 'artifact:delete',

  // Dream / Sentinel
  DREAM_LIST: 'dream:list',
  DREAM_GET: 'dream:get',
  DREAM_LATEST: 'dream:latest',
  DREAM_INSIGHTS: 'dream:insights',
  SENTINEL_ALERTS: 'sentinel:alerts',

  // Updater
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_EVENT: 'updater:event',

  // Shell
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE: 'window:toggle',
} as const;
