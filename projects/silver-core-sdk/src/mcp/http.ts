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
  ElicitationHandler,
  McpHttpServerConfig,
  McpResource,
  McpResourceContent,
  McpSSEServerConfig,
} from '../types.js';
import { AbortError, McpError, NotImplementedError } from '../errors.js';
import { resolveElicitation } from './elicitation.js';
import { sliceSurrogateSafe } from '../internal/text.js';
// Wire-shape layer shared with stdio.ts — constants, the JSON-RPC message shape
// and every pure result parser live there once (see protocol.ts).
import {
  CLIENT_INFO,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MCP_PROTOCOL_VERSION,
  extractServerInfo,
  listToolsPaginated,
  negotiateProtocolVersion,
  normalizeCallToolResult,
  parseResourceContents,
  parseResourcesList,
  type JsonRpcId,
  type JsonRpcMessage,
  type McpToolDescriptor,
  rpcErrorToError as rpcErrorToErrorFor,
} from './protocol.js';

/** Bound on the best-effort session-termination DELETE in close(): a dead or
 *  unresponsive server must never stall teardown. */
const SESSION_DELETE_TIMEOUT_MS = 2_000;
/** W8-2 (audit r3): max bytes the SSE reader may accumulate — for a single
 *  unterminated line (no `\n`) OR across the data lines of one event — before
 *  treating the stream as hostile. A server/MITM that never emits a boundary
 *  would otherwise grow the buffer without bound → OOM. 16 MiB dwarfs any real
 *  JSON-RPC response. */
const MAX_SSE_BUFFER_BYTES = 16 * 1024 * 1024;

/** This connection's transport tag, bound once into the shared JSON-RPC error
 *  wrapper so every call site reads exactly as it did before. */
const rpcErrorToError = (label: string, error: { code?: number; message?: string }): Error =>
  rpcErrorToErrorFor(label, error, 'http');

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
  /** In-flight session-expiry re-initialize, shared so concurrent recoveries
   *  coalesce into ONE handshake instead of N (see reinitializeSession). */
  private reinitPromise: Promise<void> | undefined;
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
    // audit r4 Z6-1: reject a negotiated version we cannot speak instead of
    // echoing an unknown version into every later request header.
    const pv = negotiateProtocolVersion(result, this.label, 'http');
    // Echo the server-negotiated version in subsequent request headers.
    if (pv !== undefined) this.protocolVersion = pv;
    this.initialized = true;
    await this.rpcNotify('notifications/initialized', undefined, signal);
  }

  /** serverInfo from the initialize handshake (undefined before connect). */
  serverInfo(): { name: string; version: string } | undefined {
    return this.info;
  }

  /** tools/list with cursor pagination (shared drain, see protocol.ts). */
  listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]> {
    return listToolsPaginated(
      (method, params, sig) => this.rpcRequest(method, params, sig),
      this.label,
      this.debug,
      signal,
    );
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

  /** Cancel all in-flight requests, then terminate the server-side session
   *  (spec SHOULD: HTTP DELETE with the session id); further calls fail with
   *  AbortError. Aborting FIRST matters: with the DELETE first, an in-flight
   *  request could see the freshly-terminated session's 404 and run the
   *  session-expiry recovery — re-initializing a NEW server-side session (and
   *  replaying its call) during teardown, which nothing ever terminates. The
   *  DELETE is best-effort — servers MAY answer 405, and a dead server must
   *  never make close() hang or throw — but skipping it leaked one live
   *  server-side session per teardown until expiry. */
  async close(): Promise<void> {
    if (this.closeController.signal.aborted) return;
    this.closeController.abort();
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

    // A session re-initialize is IN FLIGHT (a sibling request hit the expiry
    // 404 and is re-handshaking). reinitializeSession nulls this.sessionId for
    // the duration, so a request issued inside that window goes out with NO
    // session id at all — and the 404 it earns back cannot be recovered,
    // because the recovery gate below requires `sentSessionId !== undefined`.
    // The request is simply LOST (surfaced as a raw HTTP 404, i.e. an isError
    // tool result), even though the connection healed a millisecond later.
    // Wait for the handshake and ride the fresh session instead. Only real
    // REQUESTS wait: the handshake's own messages would deadlock on their own
    // promise, and a fire-and-forget reply carries a JSON-RPC id that is
    // meaningless outside the session that issued the matching request (the
    // same reasoning that keeps them out of the replay gate below). A failed
    // handshake is not fatal here — fall through and let this request surface
    // its own error.
    if (expectId !== null && payload.method !== 'initialize') {
      const reinit = this.reinitPromise;
      if (reinit !== undefined) {
        await reinit.catch(() => undefined);
        if (this.closeController.signal.aborted) {
          throw new AbortError(`MCP HTTP connection '${this.label}' closed`);
        }
        if (signal?.aborted) throw new AbortError();
      }
    }

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

    // The session id THIS request is about to carry, captured before the fetch
    // (and before any concurrent request can mutate this.sessionId). The
    // session-expiry recovery below keys off this local, NOT the live
    // this.sessionId: a parallel in-flight request that already nulled
    // this.sessionId mid-recovery would otherwise make our own 404 fail the
    // `!== undefined` guard and surface as a raw HTTP 404 — a lost request.
    const sentSessionId = this.sessionId;
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
        sentSessionId !== undefined &&
        !retriedAfterSessionLoss &&
        // Only a real REQUEST (awaiting a reply) may be replayed onto a fresh
        // session. A fire-and-forget message (expectId === null: an elicitation
        // reply / method-not-found reply from answerServerRequest, or a
        // notification) carries a JSON-RPC id that is meaningful ONLY within the
        // session that issued the matching request. Re-initializing and
        // replaying such a RESPONSE onto a brand-new session — which never made
        // that request — is a cross-session id-context violation (the new
        // server sees a response for an unknown id) plus a needless reconnect;
        // let it surface/log its 404 instead.
        expectId !== null &&
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
        await this.reinitializeSession(sentSessionId);
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
      let bodyText: string | null;
      try {
        bodyText = await readBoundedText(response, MAX_SSE_BUFFER_BYTES);
      } catch {
        throw new McpError(
          'mcp_invalid_response',
          `MCP server '${this.label}' returned an invalid JSON response body`,
          { serverLabel: this.label, transport: 'http', phase: 'request' },
        );
      }
      // Same ceiling the SSE and stdio framings enforce: past it the peer is
      // not speaking JSON-RPC, and `response.json()` would have buffered the
      // whole thing first (the one framing branch W8-2 left uncapped).
      if (bodyText === null) {
        throw new McpError(
          'mcp_invalid_response',
          `MCP server '${this.label}' JSON response body exceeded ${MAX_SSE_BUFFER_BYTES} bytes; aborting`,
          { serverLabel: this.label, transport: 'http', phase: 'request' },
        );
      }
      try {
        data = JSON.parse(bodyText);
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

  /**
   * Re-run the initialize handshake after a session-expiry 404, coalescing
   * concurrent recoveries so N parallel expired requests trigger ONE handshake
   * rather than N. Without coalescing, parallel in-flight calls each recovered
   * independently: one re-init would install a fresh session that the sibling's
   * own re-init then orphaned (a leaked server-side session that nothing ever
   * DELETEs). `sentSessionId` is the session THIS request carried; if a
   * concurrent recovery has already finished and installed a newer session,
   * there is nothing to re-initialize — the caller just replays on it.
   */
  private async reinitializeSession(sentSessionId: string): Promise<void> {
    // A concurrent recovery already completed and installed a fresh session:
    // skip the handshake entirely and let the caller replay on the new session.
    if (this.initialized && this.sessionId !== undefined && this.sessionId !== sentSessionId) {
      return;
    }
    if (this.reinitPromise === undefined) {
      this.sessionId = undefined;
      this.initialized = false;
      // Drive the shared handshake off the connection's own close signal, not
      // any single caller's: a reconnect the other in-flight requests depend on
      // must not die because THIS caller aborted (that caller still bails
      // promptly on its own signal when post() replays after this resolves).
      this.reinitPromise = this.connect().finally(() => {
        this.reinitPromise = undefined;
      });
    }
    await this.reinitPromise;
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

/** Bound on the error-body detail read below: truncate() keeps only 300 chars,
 *  so buffering an unbounded hostile body via text() was the same OOM class as
 *  W8-2 — read a small prefix and cancel the rest. */
const MAX_ERROR_DETAIL_CHARS = 8 * 1024;

async function safeReadText(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    let out = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      if (out.length >= MAX_ERROR_DETAIL_CHARS) break;
    }
    out += decoder.decode();
    return out.trim();
  } catch {
    return '';
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Stream already closed or errored; nothing to release.
    }
  }
}

/**
 * Read a response body as text, giving up once `maxBytes` have accumulated.
 * Returns `null` when the body is over the ceiling (the caller turns that into
 * an mcp_invalid_response), so an oversized body costs `maxBytes` of memory
 * instead of however much the peer decided to send. `response.json()` /
 * `response.text()` buffer the WHOLE body first, which is the OOM W8-2 closed
 * for the SSE framing and MAX_STDOUT_LINE_BYTES closes for stdio.
 */
async function readBoundedText(response: Response, maxBytes: number): Promise<string | null> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    let out = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      if (out.length > maxBytes) return null;
    }
    out += decoder.decode();
    return out;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Stream already closed or errored; nothing to release.
    }
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
