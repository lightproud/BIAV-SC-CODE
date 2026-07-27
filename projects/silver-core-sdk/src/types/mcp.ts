/**
 * Silver Core SDK 公开类型面 — MCP 服务端配置与子代理定义。
 *
 * 自 src/types.ts 按其自带的分节切出（结构审视 P7，2026-07-27）：切分依据是文件
 * 原本就标好的分节注释，不是新发明的边界。src/types.ts 保留为 barrel，所有
 * `from '../types.js'` 的既有 import 一行未动。
 *
 * 溯源与合规声明见 src/types.ts 头注（clean-room，仅据公开文档）。
 */

import type { PermissionMode } from './permissions.js';
import type { JSONSchema } from './wire.js';

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
  | {
      type: 'resource';
      resource: { uri: string; mimeType?: string; text?: string; blob?: string };
    };

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
