/**
 * Silver Core SDK - MCP wire-shape layer shared by the stdio and HTTP
 * connections (module F).
 *
 * Both transports speak the SAME JSON-RPC 2.0 payloads; only the framing
 * differs (newline-delimited stdout vs POST body / SSE). Everything that
 * parses or normalizes a payload therefore belongs here, once: the protocol
 * constants, the JSON-RPC message shape, and the pure result parsers. The
 * per-transport files keep only their framing, lifecycle and error context.
 *
 * Before this module the two files carried byte-identical copies of
 * `extractServerInfo` / `parseToolAnnotations` / `parseToolsListResult` /
 * `normalizeCallToolResult` / `normalizeContentItem`, and http.ts imported
 * `parseResourcesList` / `parseResourceContents` from stdio.ts - a sibling
 * dependency that existed only because there was nowhere neutral to put them.
 *
 * Clean-room implementation written from the public MCP specification only.
 */

import type {
  CallToolResult,
  CallToolResultContent,
  JSONSchema,
  McpResource,
  McpResourceContent,
  ToolAnnotations,
} from '../types.js';
import { McpError } from '../errors.js';
import { SDK_VERSION } from '../version.js';

/** Protocol revision this client advertises in `initialize`. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';
/** Protocol revisions this clean-room client can speak. A server that
 *  negotiates anything outside this set fails connect (spec: the client SHOULD
 *  disconnect on an unsupported version) instead of having the unknown version
 *  echoed into every later request (audit r4 Z6-1/Z6-2). */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const CLIENT_INFO = { name: 'silver-core-sdk', version: SDK_VERSION } as const;
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** Safety cap on tools/list pagination to avoid a misbehaving-server loop. */
export const MAX_LIST_PAGES = 100;

export type JsonRpcId = string | number;

export type JsonRpcMessage = {
  jsonrpc?: unknown;
  id?: JsonRpcId | null;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string } | null;
};

/** One entry of a parsed tools/list page. */
export type McpToolDescriptor = {
  name: string;
  description?: string;
  inputSchema: JSONSchema;
  annotations?: ToolAnnotations;
};

export function extractServerInfo(result: unknown): { name: string; version: string } | undefined {
  if (result && typeof result === 'object' && 'serverInfo' in result) {
    const si = (result as { serverInfo?: unknown }).serverInfo;
    if (si && typeof si === 'object') {
      const { name, version } = si as { name?: unknown; version?: unknown };
      return {
        name: typeof name === 'string' ? name : 'unknown',
        version: typeof version === 'string' ? version : 'unknown',
      };
    }
  }
  return undefined;
}

/** The non-empty string protocolVersion from an initialize result, else
 *  undefined (audit r4 Z6-1/Z6-2). */
export function extractProtocolVersion(result: unknown): string | undefined {
  if (result && typeof result === 'object') {
    const pv = (result as { protocolVersion?: unknown }).protocolVersion;
    if (typeof pv === 'string' && pv.length > 0) return pv;
  }
  return undefined;
}

/** Coerce a raw MCP tool `annotations` object into ToolAnnotations, keeping
 * only well-typed known fields; undefined when nothing usable is present. */
export function parseToolAnnotations(raw: unknown): ToolAnnotations | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const out: ToolAnnotations = {};
  if (typeof a.title === 'string') out.title = a.title;
  if (typeof a.readOnlyHint === 'boolean') out.readOnlyHint = a.readOnlyHint;
  if (typeof a.destructiveHint === 'boolean') out.destructiveHint = a.destructiveHint;
  if (typeof a.idempotentHint === 'boolean') out.idempotentHint = a.idempotentHint;
  if (typeof a.openWorldHint === 'boolean') out.openWorldHint = a.openWorldHint;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseToolsListResult(result: unknown): {
  list: McpToolDescriptor[];
  nextCursor?: string;
} {
  const list: McpToolDescriptor[] = [];
  if (!result || typeof result !== 'object') return { list };
  const obj = result as { tools?: unknown; nextCursor?: unknown };
  if (Array.isArray(obj.tools)) {
    for (const raw of obj.tools) {
      if (!raw || typeof raw !== 'object') continue;
      const t = raw as {
        name?: unknown;
        description?: unknown;
        inputSchema?: unknown;
        annotations?: unknown;
      };
      if (typeof t.name !== 'string' || t.name.length === 0) continue;
      const annotations = parseToolAnnotations(t.annotations);
      list.push({
        name: t.name,
        description: typeof t.description === 'string' ? t.description : undefined,
        inputSchema:
          t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
            ? (t.inputSchema as JSONSchema)
            : { type: 'object' },
        ...(annotations !== undefined ? { annotations } : {}),
      });
    }
  }
  const nextCursor =
    typeof obj.nextCursor === 'string' && obj.nextCursor.length > 0
      ? obj.nextCursor
      : undefined;
  return { list, nextCursor };
}

export function normalizeCallToolResult(raw: unknown): CallToolResult {
  if (!raw || typeof raw !== 'object') {
    return { content: [{ type: 'text', text: JSON.stringify(raw ?? null) }] };
  }
  const obj = raw as { content?: unknown; isError?: unknown; structuredContent?: unknown };
  const content: CallToolResultContent[] = [];
  if (Array.isArray(obj.content)) {
    for (const item of obj.content) content.push(normalizeContentItem(item));
  }
  const result: CallToolResult = { content };
  if (obj.isError === true) result.isError = true;
  if (obj.structuredContent !== undefined) result.structuredContent = obj.structuredContent;
  return result;
}

export function normalizeContentItem(item: unknown): CallToolResultContent {
  if (item && typeof item === 'object') {
    const t = item as {
      type?: unknown;
      text?: unknown;
      data?: unknown;
      mimeType?: unknown;
      resource?: unknown;
    };
    if (t.type === 'text' && typeof t.text === 'string') {
      return { type: 'text', text: t.text };
    }
    if (t.type === 'image' && typeof t.data === 'string' && typeof t.mimeType === 'string') {
      return { type: 'image', data: t.data, mimeType: t.mimeType };
    }
    if (t.type === 'audio' && typeof t.data === 'string' && typeof t.mimeType === 'string') {
      return { type: 'audio', data: t.data, mimeType: t.mimeType };
    }
    if (t.type === 'resource_link' && typeof (t as { uri?: unknown }).uri === 'string') {
      const rl = t as {
        uri: string;
        name?: unknown;
        description?: unknown;
        mimeType?: unknown;
      };
      const out: CallToolResultContent = { type: 'resource_link', uri: rl.uri };
      if (typeof rl.name === 'string') out.name = rl.name;
      if (typeof rl.description === 'string') out.description = rl.description;
      if (typeof rl.mimeType === 'string') out.mimeType = rl.mimeType;
      return out;
    }
    if (t.type === 'resource' && t.resource && typeof t.resource === 'object') {
      const r = t.resource as {
        uri?: unknown;
        mimeType?: unknown;
        text?: unknown;
        blob?: unknown;
      };
      if (typeof r.uri === 'string') {
        const resource: { uri: string; mimeType?: string; text?: string; blob?: string } = {
          uri: r.uri,
        };
        if (typeof r.mimeType === 'string') resource.mimeType = r.mimeType;
        if (typeof r.text === 'string') resource.text = r.text;
        // BlobResourceContents (MCP spec): base64 binary payload — dropping it
        // silently emptied embedded binary resources (audit 2026-07-17 L36).
        if (typeof r.blob === 'string') resource.blob = r.blob;
        return { type: 'resource', resource };
      }
    }
  }
  // Unknown content types are surfaced as stringified text rather than dropped.
  return { type: 'text', text: JSON.stringify(item ?? null) };
}

/** Parse a resources/list JSON-RPC result into McpResource[]. */
export function parseResourcesList(raw: unknown): McpResource[] {
  const arr = (raw as { resources?: unknown } | null)?.resources;
  if (!Array.isArray(arr)) return [];
  const out: McpResource[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.uri !== 'string') continue;
    const res: McpResource = { uri: r.uri };
    if (typeof r.name === 'string') res.name = r.name;
    if (typeof r.description === 'string') res.description = r.description;
    if (typeof r.mimeType === 'string') res.mimeType = r.mimeType;
    out.push(res);
  }
  return out;
}

/** Parse a resources/read JSON-RPC result into McpResourceContent[]. */
export function parseResourceContents(raw: unknown): McpResourceContent[] {
  const arr = (raw as { contents?: unknown } | null)?.contents;
  if (!Array.isArray(arr)) return [];
  const out: McpResourceContent[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    if (typeof c.uri !== 'string') continue;
    const content: McpResourceContent = { uri: c.uri };
    if (typeof c.mimeType === 'string') content.mimeType = c.mimeType;
    if (typeof c.text === 'string') content.text = c.text;
    if (typeof c.blob === 'string') content.blob = c.blob;
    out.push(content);
  }
  return out;
}

/** Wrap a JSON-RPC error object in an McpError carrying the caller's
 *  transport tag (the only part of this that was ever transport-specific). */
export function rpcErrorToError(
  label: string,
  error: { code?: number; message?: string },
  transport: 'stdio' | 'http',
): Error {
  const code = typeof error.code === 'number' ? ` ${String(error.code)}` : '';
  return new McpError(
    'mcp_rpc_error',
    `MCP server '${label}' returned JSON-RPC error${code}: ${error.message ?? 'unknown error'}`,
    {
      serverLabel: label,
      transport,
      phase: 'request',
      ...(typeof error.code === 'number' ? { rpcCode: error.code } : {}),
    },
  );
}

/**
 * Verify the version the server negotiated in `initialize` is one this client
 * can speak, and return it (undefined when the server named none, which the
 * spec tolerates — the client keeps its advertised default).
 *
 * Spec: the client SHOULD disconnect on an unsupported version rather than
 * echo an unknown one into every later request (audit r4 Z6-1/Z6-2).
 */
export function negotiateProtocolVersion(
  result: unknown,
  label: string,
  transport: 'stdio' | 'http',
): string | undefined {
  const pv = extractProtocolVersion(result);
  if (pv !== undefined && !SUPPORTED_PROTOCOL_VERSIONS.includes(pv)) {
    throw new McpError(
      'mcp_invalid_response',
      `MCP server '${label}' negotiated unsupported protocol version '${pv}' ` +
        `(client supports ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')})`,
      { serverLabel: label, transport, phase: 'connect' },
    );
  }
  return pv;
}

/**
 * Drain `tools/list` across its cursor pagination, bounded by MAX_LIST_PAGES so
 * a misbehaving server that never drops its cursor cannot loop forever. The
 * caller supplies its own request function, which is the only per-transport part.
 */
export async function listToolsPaginated(
  request: (method: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>,
  label: string,
  debug: (msg: string) => void,
  signal?: AbortSignal,
): Promise<McpToolDescriptor[]> {
  const tools: McpToolDescriptor[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await request('tools/list', cursor === undefined ? {} : { cursor }, signal);
    const { list, nextCursor } = parseToolsListResult(result);
    tools.push(...list);
    if (!nextCursor) return tools;
    cursor = nextCursor;
  }
  debug(`[mcp:${label}] tools/list pagination exceeded ${MAX_LIST_PAGES} pages; truncating`);
  return tools;
}
