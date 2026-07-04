/**
 * BPT Agent SDK - streamable HTTP MCP connection (module F).
 *
 * POSTs JSON-RPC 2.0 messages to the server URL and accepts either a plain
 * JSON body or an SSE stream carrying the response message. Contains its own
 * minimal SSE line parser on purpose - module F must not import the module A
 * transport files. Clean-room implementation written from the public MCP
 * specification only.
 *
 * The legacy 'sse' transport (separate GET event stream + POST endpoint) is
 * NOT implemented: constructing this class with a type:'sse' config throws
 * NotImplementedError, which the registry reports as a 'failed' status.
 */

import type {
  CallToolResult,
  CallToolResultContent,
  ElicitationHandler,
  JSONSchema,
  McpHttpServerConfig,
  McpResource,
  McpResourceContent,
  McpSSEServerConfig,
} from '../types.js';
import { AbortError, NotImplementedError } from '../errors.js';
import { parseResourcesList, parseResourceContents } from './stdio.js';
import { resolveElicitation } from './elicitation.js';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'bpt-agent-sdk', version: '0.1.0' } as const;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** Safety cap on tools/list pagination to avoid a misbehaving-server loop. */
const MAX_LIST_PAGES = 100;

type JsonRpcId = string | number;

type JsonRpcMessage = {
  jsonrpc?: unknown;
  id?: JsonRpcId | null;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string } | null;
};

/**
 * One streamable-HTTP MCP server connection. Lifecycle:
 * connect() -> listTools()/callTool()* -> close().
 */
export class HttpMcpConnection {
  private readonly url: string;
  private readonly configHeaders: Record<string, string>;
  private readonly label: string;
  private readonly debug: (msg: string) => void;
  private readonly requestTimeoutMs: number;
  /** Aborting this cancels every in-flight request; set by close(). */
  private readonly closeController = new AbortController();

  private nextId = 1;
  private sessionId: string | undefined;
  private initialized = false;
  private protocolVersion = MCP_PROTOCOL_VERSION;
  private info: { name: string; version: string } | undefined;
  private readonly elicitation?: ElicitationHandler;

  constructor(
    config: McpHttpServerConfig | McpSSEServerConfig,
    opts: {
      /** Label used in debug lines (usually the configured server name). */
      name?: string;
      debug?: (msg: string) => void;
      requestTimeoutMs?: number;
      /** Host handler answering server-initiated elicitation/create requests. */
      elicitation?: ElicitationHandler;
    } = {},
  ) {
    if (config.type === 'sse') {
      throw new NotImplementedError(
        "legacy 'sse' MCP transport",
        "Use a streamable HTTP server config (type: 'http') instead.",
      );
    }
    this.url = config.url;
    this.configHeaders = { ...(config.headers ?? {}) };
    this.label = opts.name ?? config.url;
    this.debug = opts.debug ?? (() => {});
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.elicitation = opts.elicitation;
  }

  /** Run the MCP initialize handshake over HTTP. */
  async connect(signal?: AbortSignal): Promise<void> {
    const result = await this.rpcRequest(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: this.elicitation ? { elicitation: {} } : {},
        clientInfo: CLIENT_INFO,
      },
      signal,
    );
    this.info = extractServerInfo(result);
    if (result && typeof result === 'object') {
      const pv = (result as { protocolVersion?: unknown }).protocolVersion;
      // Echo the server-negotiated version in subsequent request headers.
      if (typeof pv === 'string' && pv.length > 0) this.protocolVersion = pv;
    }
    this.initialized = true;
    await this.rpcNotify('notifications/initialized', undefined, signal);
  }

  /** serverInfo from the initialize handshake (undefined before connect). */
  serverInfo(): { name: string; version: string } | undefined {
    return this.info;
  }

  /** tools/list with cursor pagination. */
  async listTools(
    signal?: AbortSignal,
  ): Promise<Array<{ name: string; description?: string; inputSchema: JSONSchema }>> {
    const tools: Array<{ name: string; description?: string; inputSchema: JSONSchema }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const result = await this.rpcRequest(
        'tools/list',
        cursor === undefined ? {} : { cursor },
        signal,
      );
      const { list, nextCursor } = parseToolsListResult(result);
      tools.push(...list);
      if (!nextCursor) return tools;
      cursor = nextCursor;
    }
    this.debug(
      `[mcp:${this.label}] tools/list pagination exceeded ${MAX_LIST_PAGES} pages; truncating`,
    );
    return tools;
  }

  /** tools/call; unknown result content types are stringified to text. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    const result = await this.rpcRequest('tools/call', { name, arguments: args }, signal);
    return normalizeCallToolResult(result);
  }

  /** resources/list (single page); [] when the server has no resources support. */
  async listResources(signal?: AbortSignal): Promise<McpResource[]> {
    try {
      const result = await this.rpcRequest('resources/list', {}, signal);
      return parseResourcesList(result);
    } catch (err) {
      if (err instanceof AbortError) throw err;
      return [];
    }
  }

  /** resources/read for one uri. */
  async readResource(uri: string, signal?: AbortSignal): Promise<McpResourceContent[]> {
    const result = await this.rpcRequest('resources/read', { uri }, signal);
    return parseResourceContents(result);
  }

  /** Cancel all in-flight requests; further calls fail with AbortError. */
  async close(): Promise<void> {
    this.closeController.abort();
  }

  // -- HTTP plumbing ---------------------------------------------------------

  private async rpcRequest(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    return await this.post({ jsonrpc: '2.0', id, method, params }, id, signal);
  }

  private async rpcNotify(method: string, params?: unknown, signal?: AbortSignal): Promise<void> {
    const payload: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (params !== undefined) payload.params = params;
    await this.post(payload, null, signal);
  }

  /**
   * POST one JSON-RPC message. expectId === null means notification (no
   * response body expected); otherwise resolves with the matching response's
   * result, from either a plain JSON body or an SSE stream.
   */
  private async post(
    payload: Record<string, unknown>,
    expectId: JsonRpcId | null,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.closeController.signal.aborted) {
      throw new AbortError(`MCP HTTP connection '${this.label}' closed`);
    }
    if (signal?.aborted) throw new AbortError();

    // Single controller drives fetch + body read; we track why it fired so
    // caller aborts surface as AbortError and timeouts as plain errors.
    const controller = new AbortController();
    let abortCause: 'caller' | 'timeout' | 'closed' | undefined;
    const timer = setTimeout(() => {
      abortCause ??= 'timeout';
      controller.abort();
    }, this.requestTimeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    const onCallerAbort = (): void => {
      abortCause ??= 'caller';
      controller.abort();
    };
    const onClose = (): void => {
      abortCause ??= 'closed';
      controller.abort();
    };
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    this.closeController.signal.addEventListener('abort', onClose, { once: true });

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      // Track and echo the server-assigned session id.
      const newSession = response.headers.get('mcp-session-id');
      if (newSession) this.sessionId = newSession;

      if (!response.ok) {
        const detail = await safeReadText(response);
        throw new Error(
          `MCP server '${this.label}' returned HTTP ${response.status}${
            detail ? `: ${truncate(detail)}` : ''
          }`,
        );
      }

      if (expectId === null) {
        // Notification: typically 202 Accepted with no meaningful body.
        await drainBody(response);
        return undefined;
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (contentType.includes('text/event-stream')) {
        if (!response.body) {
          throw new Error(`MCP server '${this.label}' returned an SSE response without a body`);
        }
        return await this.readSseResponse(response.body, expectId);
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new Error(`MCP server '${this.label}' returned an invalid JSON response body`);
      }
      return extractResponse(data, expectId, this.label);
    } catch (err) {
      if (abortCause === 'caller' || signal?.aborted) throw new AbortError();
      if (abortCause === 'closed') {
        throw new AbortError(`MCP HTTP connection '${this.label}' closed`);
      }
      if (abortCause === 'timeout') {
        throw new Error(
          `MCP request '${String(payload.method ?? '?')}' to server '${this.label}' timed out after ${this.requestTimeoutMs}ms`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
      this.closeController.signal.removeEventListener('abort', onClose);
    }
  }

  private buildHeaders(): Record<string, string> {
    // Merge user headers with keys lowercased so a config header differing only
    // in case from a protocol header REPLACES it rather than producing a
    // duplicate case-variant key (which fetch's Headers would merge into one
    // malformed comma-joined value). Protocol content-type/accept are applied
    // first and remain overridable by an explicit user header of the same name.
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    for (const [k, v] of Object.entries(this.configHeaders)) {
      headers[k.toLowerCase()] = v;
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.initialized) headers['mcp-protocol-version'] = this.protocolVersion;
    return headers;
  }

  /**
   * Minimal private SSE parser: accumulates data: lines per event (events end
   * on a blank line), returns the JSON-RPC response matching the request id.
   * Other stream messages (server requests/notifications) are logged and
   * skipped - out of scope for v0.1.
   */
  private async readSseResponse(
    body: ReadableStream<Uint8Array>,
    id: JsonRpcId,
  ): Promise<unknown> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dataLines: string[] = [];

    const handleEvent = (payloadText: string): { hit: true; value: unknown } | undefined => {
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(payloadText) as JsonRpcMessage;
      } catch {
        this.debug(`[mcp:${this.label}] ignoring non-JSON SSE data`);
        return undefined;
      }
      if (msg.id === id && msg.method === undefined && ('result' in msg || 'error' in msg)) {
        if (msg.error) throw rpcErrorToError(this.label, msg.error);
        return { hit: true, value: msg.result };
      }
      // Server-initiated request (method + id): this client implements no
      // server-callable methods, so answer with JSON-RPC "method not found"
      // via a fresh POST, mirroring stdio.ts. Leaving it unanswered would make
      // the server wait forever (and time out the in-flight call). Pure
      // notifications (no id) stay ignored.
      if (typeof msg.method === 'string' && msg.id !== undefined && msg.id !== null) {
        const replyId = msg.id;
        // Server-initiated elicitation/create: resolve via the host handler and
        // POST back the resulting action payload (fail-closed to 'decline').
        if (msg.method === 'elicitation/create' && this.elicitation) {
          void resolveElicitation(msg.params, this.elicitation, this.closeController.signal)
            .then((result) => this.post({ jsonrpc: '2.0', id: replyId, result }, null))
            .catch(() =>
              this.post({ jsonrpc: '2.0', id: replyId, result: { action: 'decline' } }, null),
            )
            // The fallback decline POST can ITSELF reject (e.g. the connection
            // is already closing -> post() throws AbortError). Without this
            // terminal catch that second rejection is unhandled and can crash
            // the process under a strict unhandledRejection policy.
            .catch((err: unknown) => {
              this.debug(
                `[mcp:${this.label}] elicitation reply failed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
          return undefined;
        }
        void this.post(
          {
            jsonrpc: '2.0',
            id: replyId,
            error: { code: -32601, message: 'Method not found' },
          },
          null,
        ).catch((err: unknown) => {
          this.debug(
            `[mcp:${this.label}] failed to answer server request '${msg.method as string}': ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
        return undefined;
      }
      this.debug(
        `[mcp:${this.label}] ignoring SSE message${
          typeof msg.method === 'string' ? ` '${msg.method}'` : ''
        }`,
      );
      return undefined;
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line === '') {
            if (dataLines.length > 0) {
              const outcome = handleEvent(dataLines.join('\n'));
              dataLines = [];
              if (outcome) return outcome.value;
            }
            continue;
          }
          if (line.startsWith(':')) continue; // SSE comment line
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).replace(/^ /, ''));
          }
          // event:/id:/retry: fields are irrelevant for response extraction.
        }
      }
      // Flush a trailing frame in case the stream ended without a blank line.
      if (dataLines.length > 0) {
        const outcome = handleEvent(dataLines.join('\n'));
        if (outcome) return outcome.value;
      }
      throw new Error(
        `MCP server '${this.label}' SSE stream ended without a response for request ${String(id)}`,
      );
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Stream already closed or errored; nothing to release.
      }
    }
  }
}

// -- shared-shape helpers (duplicated from stdio.ts by design: module F files
// stay self-contained and there is no shared helper file in the module map) --

function extractResponse(data: unknown, id: JsonRpcId, label: string): unknown {
  const candidates = Array.isArray(data) ? data : [data];
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const msg = item as JsonRpcMessage;
    if (msg.id === id && ('result' in msg || 'error' in msg)) {
      if (msg.error) throw rpcErrorToError(label, msg.error);
      return msg.result;
    }
  }
  throw new Error(
    `MCP server '${label}' response did not include an answer for request ${String(id)}`,
  );
}

function extractServerInfo(result: unknown): { name: string; version: string } | undefined {
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

function parseToolsListResult(result: unknown): {
  list: Array<{ name: string; description?: string; inputSchema: JSONSchema }>;
  nextCursor?: string;
} {
  const list: Array<{ name: string; description?: string; inputSchema: JSONSchema }> = [];
  if (!result || typeof result !== 'object') return { list };
  const obj = result as { tools?: unknown; nextCursor?: unknown };
  if (Array.isArray(obj.tools)) {
    for (const raw of obj.tools) {
      if (!raw || typeof raw !== 'object') continue;
      const t = raw as { name?: unknown; description?: unknown; inputSchema?: unknown };
      if (typeof t.name !== 'string' || t.name.length === 0) continue;
      list.push({
        name: t.name,
        description: typeof t.description === 'string' ? t.description : undefined,
        inputSchema:
          t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
            ? (t.inputSchema as JSONSchema)
            : { type: 'object' },
      });
    }
  }
  const nextCursor =
    typeof obj.nextCursor === 'string' && obj.nextCursor.length > 0
      ? obj.nextCursor
      : undefined;
  return { list, nextCursor };
}

function normalizeCallToolResult(raw: unknown): CallToolResult {
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

function normalizeContentItem(item: unknown): CallToolResultContent {
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
      const r = t.resource as { uri?: unknown; mimeType?: unknown; text?: unknown };
      if (typeof r.uri === 'string') {
        const resource: { uri: string; mimeType?: string; text?: string } = { uri: r.uri };
        if (typeof r.mimeType === 'string') resource.mimeType = r.mimeType;
        if (typeof r.text === 'string') resource.text = r.text;
        return { type: 'resource', resource };
      }
    }
  }
  // Unknown content types are surfaced as stringified text rather than dropped.
  return { type: 'text', text: JSON.stringify(item ?? null) };
}

function rpcErrorToError(label: string, error: { code?: number; message?: string }): Error {
  const code = typeof error.code === 'number' ? ` ${String(error.code)}` : '';
  return new Error(
    `MCP server '${label}' returned JSON-RPC error${code}: ${error.message ?? 'unknown error'}`,
  );
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

async function drainBody(response: Response): Promise<void> {
  try {
    if (response.body) await response.body.cancel();
  } catch {
    // Nothing to release.
  }
}

function truncate(s: string, max = 300): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}
