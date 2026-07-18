/**
 * Silver Core SDK - streamable HTTP MCP connection (module F).
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
  ToolAnnotations,
} from '../types.js';
import { AbortError, McpError, NotImplementedError } from '../errors.js';
import { parseResourcesList, parseResourceContents } from './stdio.js';
import { resolveElicitation } from './elicitation.js';
import { sliceSurrogateSafe } from '../internal/text.js';
import { SDK_VERSION } from '../version.js';

const MCP_PROTOCOL_VERSION = '2025-06-18';
/** Protocol revisions this clean-room client can speak. A server that
 *  negotiates anything outside this set fails connect (spec: the client SHOULD
 *  disconnect on an unsupported version) instead of having the unknown version
 *  echoed into every later request header (audit r4 Z6-1). */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const CLIENT_INFO = { name: 'silver-core-sdk', version: SDK_VERSION } as const;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** Bound on the best-effort session-termination DELETE in close(): a dead or
 *  unresponsive server must never stall teardown. */
const SESSION_DELETE_TIMEOUT_MS = 2_000;
/** Safety cap on tools/list pagination to avoid a misbehaving-server loop. */
const MAX_LIST_PAGES = 100;
/** W8-2 (audit r3): max bytes the SSE reader may accumulate — for a single
 *  unterminated line (no `\n`) OR across the data lines of one event — before
 *  treating the stream as hostile. A server/MITM that never emits a boundary
 *  would otherwise grow the buffer without bound → OOM. 16 MiB dwarfs any real
 *  JSON-RPC response. */
const MAX_SSE_BUFFER_BYTES = 16 * 1024 * 1024;

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
      if (typeof pv === 'string' && pv.length > 0) {
        // audit r4 Z6-1: reject a negotiated version we cannot speak instead of
        // echoing an unknown version into every later request header.
        if (!SUPPORTED_PROTOCOL_VERSIONS.includes(pv)) {
          throw new McpError(
            'mcp_invalid_response',
            `MCP server '${this.label}' negotiated unsupported protocol version '${pv}' ` +
              `(client supports ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')})`,
            { serverLabel: this.label, transport: 'http', phase: 'connect' },
          );
        }
        // Echo the server-negotiated version in subsequent request headers.
        this.protocolVersion = pv;
      }
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
  ): Promise<Array<{ name: string; description?: string; inputSchema: JSONSchema; annotations?: ToolAnnotations }>> {
    const tools: Array<{ name: string; description?: string; inputSchema: JSONSchema; annotations?: ToolAnnotations }> = [];
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

  /** resources/directory/read: direct children of a directory resource. Errors
   *  propagate (a server without directory support rejects the request). */
  async readResourceDir(uri: string, signal?: AbortSignal): Promise<McpResource[]> {
    const result = await this.rpcRequest('resources/directory/read', { uri }, signal);
    return parseResourcesList(result);
  }

  /** Terminate the server-side session (spec SHOULD: HTTP DELETE with the
   *  session id), then cancel all in-flight requests; further calls fail with
   *  AbortError. The DELETE is best-effort — servers MAY answer 405, and a
   *  dead server must never make close() hang or throw — but skipping it
   *  leaked one live server-side session per teardown until expiry. */
  async close(): Promise<void> {
    if (this.closeController.signal.aborted) return;
    if (this.sessionId !== undefined && this.initialized) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SESSION_DELETE_TIMEOUT_MS);
        if (typeof timer.unref === 'function') timer.unref();
        try {
          const response = await fetch(this.url, {
            method: 'DELETE',
            headers: this.buildHeaders(),
            signal: controller.signal,
          });
          await drainBody(response);
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // Best-effort only: the server may not support explicit termination.
      }
    }
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
    /** True on the single retry after a 404 session-expiry re-initialize. */
    retriedAfterSessionLoss = false,
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
    // Re-check AFTER registration: 'abort' never fires retroactively for an
    // already-aborted signal, so an abort landing between the top guards and
    // the registrations above would leave this request uncancellable until
    // requestTimeoutMs (audit 2026-07-17 L35).
    if (signal?.aborted) onCallerAbort();
    else if (this.closeController.signal.aborted) onClose();

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

      // Session-expiry recovery (spec 2025-06-18: a request with a stale
      // Mcp-Session-Id MUST get 404, and the client MUST start a NEW session
      // with a fresh InitializeRequest). Previously the stale id was neither
      // cleared nor re-initialized, so every later call kept echoing it and
      // the connection stayed bricked until a manual reconnect. Recover once
      // per request: drop the session, re-run the handshake, replay the call.
      if (
        !response.ok &&
        response.status === 404 &&
        this.sessionId !== undefined &&
        !retriedAfterSessionLoss &&
        // Never recover the handshake's own messages: a 404 inside connect()
        // would recurse connect() -> post() -> connect() unboundedly.
        payload.method !== 'initialize' &&
        payload.method !== 'notifications/initialized'
      ) {
        await drainBody(response);
        this.debug(
          `[mcp:${this.label}] HTTP 404 with a session id — session expired; ` +
            `re-initializing and retrying once`,
        );
        this.sessionId = undefined;
        this.initialized = false;
        await this.connect(signal);
        return await this.post(payload, expectId, signal, true);
      }

      if (!response.ok) {
        const detail = await safeReadText(response);
        throw new McpError(
          'mcp_http_status',
          `MCP server '${this.label}' returned HTTP ${response.status}${
            detail ? `: ${truncate(detail)}` : ''
          }`,
          {
            serverLabel: this.label,
            transport: 'http',
            phase: 'request',
            httpStatus: response.status,
          },
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
          throw new McpError(
            'mcp_invalid_response',
            `MCP server '${this.label}' returned an SSE response without a body`,
            { serverLabel: this.label, transport: 'http', phase: 'request' },
          );
        }
        return await this.readSseResponse(response.body, expectId);
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new McpError(
          'mcp_invalid_response',
          `MCP server '${this.label}' returned an invalid JSON response body`,
          { serverLabel: this.label, transport: 'http', phase: 'request' },
        );
      }
      // audit r4 Z6-3: a plain-JSON body may interleave server-initiated
      // requests (a JSON-RPC batch) alongside our response; answer them like
      // the SSE path does so the server is not left waiting. Non-request
      // messages (our response, notifications) are ignored by the helper.
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item && typeof item === 'object') {
          this.answerServerRequest(item as JsonRpcMessage);
        }
      }
      return extractResponse(data, expectId, this.label);
    } catch (err) {
      if (abortCause === 'caller' || signal?.aborted) throw new AbortError();
      if (abortCause === 'closed') {
        throw new AbortError(`MCP HTTP connection '${this.label}' closed`);
      }
      if (abortCause === 'timeout') {
        throw new McpError(
          'mcp_request_timeout',
          `MCP request '${String(payload.method ?? '?')}' to server '${this.label}' timed out after ${this.requestTimeoutMs}ms`,
          {
            serverLabel: this.label,
            transport: 'http',
            phase: 'request',
            timeoutMs: this.requestTimeoutMs,
          },
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
   * Answer a server-initiated JSON-RPC request (method + non-null id):
   * elicitation/create resolves via the host handler and POSTs back the action
   * payload (fail-closed to 'decline'); any other method gets a fresh
   * "method not found" POST. Returns true iff `msg` was such a request;
   * responses and notifications return false. Shared by the SSE reader AND the
   * plain-JSON body path so a server request delivered either way is answered
   * rather than leaving the server to wait (audit r4 Z6-3).
   */
  private answerServerRequest(msg: JsonRpcMessage): boolean {
    const method = msg.method;
    if (typeof method !== 'string' || msg.id === undefined || msg.id === null) {
      return false;
    }
    const replyId = msg.id;
    if (method === 'elicitation/create') {
      // NOTE: no `&& this.elicitation` guard - resolveElicitation itself maps a
      // missing handler to { action: 'decline' } (the documented auto-decline);
      // guarding here made that branch dead and replied -32601 instead
      // (found by the batch-3 onElicitation test, 2026-07-05).
      // Handler failure and DELIVERY failure are distinct (audit r2 I7): a
      // thrown handler falls back to the documented auto-decline payload BEFORE
      // the single reply POST; a failed POST is only logged — never answered
      // again, since a second reply to the same JSON-RPC id violates JSON-RPC
      // and can contradict a reply the server already received.
      void resolveElicitation(msg.params, this.elicitation, this.closeController.signal)
        .catch(() => ({ action: 'decline' as const }))
        .then((result) => this.post({ jsonrpc: '2.0', id: replyId, result }, null))
        .catch((err: unknown) => {
          this.debug(
            `[mcp:${this.label}] elicitation reply failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      return true;
    }
    // This client implements no server-callable methods: answer method-not-
    // found via a fresh POST, mirroring stdio.ts. Leaving it unanswered would
    // make the server wait forever (and time out the in-flight call).
    void this.post(
      { jsonrpc: '2.0', id: replyId, error: { code: -32601, message: 'Method not found' } },
      null,
    ).catch((err: unknown) => {
      this.debug(
        `[mcp:${this.label}] failed to answer server request '${method}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
    return true;
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
      // Server-initiated request (method + id): answer it (shared with the
      // plain-JSON body path, audit r4 Z6-3). Pure notifications (no id) and
      // other messages fall through to the debug log below.
      if (this.answerServerRequest(msg)) return undefined;
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
        // W8-2: bound both the unterminated-line buffer and the accumulated
        // event data. Past the cap with no newline in sight, the server is not
        // framing messages — abort rather than grow to OOM.
        if (
          buffer.length > MAX_SSE_BUFFER_BYTES ||
          dataLines.reduce((n, l) => n + l.length, 0) > MAX_SSE_BUFFER_BYTES
        ) {
          throw new McpError(
            'mcp_invalid_response',
            `MCP server '${this.label}' SSE stream exceeded ${MAX_SSE_BUFFER_BYTES} bytes ` +
              `without a complete message; aborting`,
            { serverLabel: this.label, transport: 'http', phase: 'request' },
          );
        }
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
      // Final decoder flush (audit 2026-07-17 L68): a multi-byte UTF-8
      // character split across the LAST chunk boundary sits buffered inside
      // the TextDecoder and was silently dropped without this.
      buffer += decoder.decode();
      // M10 (audit 2026-07-17): a final `data:` line with NO trailing newline
      // never left `buffer` (the line loop only consumes up to '\n'), so a
      // server omitting the last newline had its whole response dropped as
      // mcp_invalid_response. The stream is over — treat the remnant as a
      // complete line at EOF.
      let tailLine = buffer;
      if (tailLine.endsWith('\r')) tailLine = tailLine.slice(0, -1);
      if (tailLine.startsWith('data:')) {
        dataLines.push(tailLine.slice(5).replace(/^ /, ''));
      }
      // Flush a trailing frame in case the stream ended without a blank line.
      if (dataLines.length > 0) {
        const outcome = handleEvent(dataLines.join('\n'));
        if (outcome) return outcome.value;
      }
      throw new McpError(
        'mcp_invalid_response',
        `MCP server '${this.label}' SSE stream ended without a response for request ${String(id)}`,
        { serverLabel: this.label, transport: 'http', phase: 'request' },
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
  throw new McpError(
    'mcp_invalid_response',
    `MCP server '${label}' response did not include an answer for request ${String(id)}`,
    { serverLabel: label, transport: 'http', phase: 'request' },
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

/** Coerce a raw MCP tool `annotations` object into ToolAnnotations, keeping
 * only well-typed known fields; undefined when nothing usable is present. */
function parseToolAnnotations(raw: unknown): ToolAnnotations | undefined {
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

function parseToolsListResult(result: unknown): {
  list: Array<{ name: string; description?: string; inputSchema: JSONSchema; annotations?: ToolAnnotations }>;
  nextCursor?: string;
} {
  const list: Array<{ name: string; description?: string; inputSchema: JSONSchema; annotations?: ToolAnnotations }> = [];
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

function rpcErrorToError(label: string, error: { code?: number; message?: string }): Error {
  const code = typeof error.code === 'number' ? ` ${String(error.code)}` : '';
  return new McpError(
    'mcp_rpc_error',
    `MCP server '${label}' returned JSON-RPC error${code}: ${error.message ?? 'unknown error'}`,
    {
      serverLabel: label,
      transport: 'http',
      phase: 'request',
      ...(typeof error.code === 'number' ? { rpcCode: error.code } : {}),
    },
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
  // Surrogate-safe: a bare slice could cut an astral codepoint in half and
  // leave a lone surrogate in the MCP error detail (audit r4 R7s-8).
  return s.length > max ? `${sliceSurrogateSafe(s, max)}...` : s;
}
