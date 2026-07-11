/**
 * Silver Core SDK - error types.
 *
 * E6c: every error class carries a machine-readable, STABLE `code` so
 * consumers (e.g. BPT Desktop) can do i18n and retry/report routing without
 * parsing English messages. `name` + message text stay unchanged (the drop-in
 * surface only gains fields, never changes them). Codes are append-only:
 * never rename or reuse a published code.
 */

/** Stable machine-readable codes for MCP subsystem failures (`McpError`). */
export type McpErrorCode =
  /** A server did not finish connect+listTools within the connect timeout. */
  | 'mcp_connect_timeout'
  /** Streamable-HTTP server answered a JSON-RPC POST with a non-2xx status. */
  | 'mcp_http_status'
  /** Server response was structurally unusable (no body / bad JSON / no answer for the request id). */
  | 'mcp_invalid_response'
  /** One JSON-RPC request exceeded its per-request timeout. */
  | 'mcp_request_timeout'
  /** Server answered with a JSON-RPC error object (code/message from the server). */
  | 'mcp_rpc_error'
  /** Operation attempted on a connection that was closed (or closed mid-flight). */
  | 'mcp_connection_closed'
  /** connect() called twice on the same stdio connection. */
  | 'mcp_already_connected'
  /** Operation attempted on a server that is not (yet) connected. */
  | 'mcp_not_connected'
  /** stdio server process exited before answering pending requests. */
  | 'mcp_server_exited'
  /** stdio server process emitted a spawn/process-level error. */
  | 'mcp_process_error'
  /** A named MCP server does not exist in the registry. */
  | 'mcp_unknown_server';

/**
 * All stable error codes. The `APIConnectionError` scenario codes
 * (`sse_malformed_frame`, `stream_idle_timeout`, `empty_stream`) are WIRED at
 * both transports' throw sites (audit 2026-07-10 cleared the stale
 * "wiring pending" note); errors without a scenario carry the class default
 * `api_connection_failed`.
 */
export type ErrorCode =
  | 'aborted'
  | 'api_connection_failed'
  | 'sse_malformed_frame'
  | 'stream_idle_timeout'
  /** The streamMaxDurationMs hard cap cut a flowing stream (resilience P1).
   *  Delivered-whole blocks remain salvageable (midStreamTruncation). */
  | 'stream_max_duration'
  /** HTTP 200 but the SSE body carried zero events (not even message_start) —
   *  a replay-safe non-start (observed as an upstream-throttle shape under
   *  concurrent fan-out). The transport retries internally; this code surfaces
   *  only after the retry budget is exhausted. */
  | 'empty_stream'
  | 'api_status_error'
  | 'not_implemented'
  | 'config_invalid'
  | 'memory_tool_error'
  | McpErrorCode;

/** Thrown when an operation is aborted via AbortController/interrupt(). */
export class AbortError extends Error {
  override name = 'AbortError';
  readonly code: ErrorCode = 'aborted';
  constructor(message = 'The operation was aborted') {
    super(message);
  }
}

/** Network-level failure talking to the Messages API. */
export class APIConnectionError extends Error {
  override name = 'APIConnectionError';
  readonly code: ErrorCode;
  /**
   * E3: set by the transport when the stream ended after at least one event
   * was delivered (a truncated turn) — a mid-stream connection drop, the
   * streamMaxDurationMs hard cap, or the fallback body timeout. The engine
   * may salvage the completed content blocks instead of voiding the turn.
   * Never set for idle-watchdog aborts, caller aborts, or pre-stream failures.
   */
  midStreamTruncation?: boolean;
  /**
   * Resilience P0-1: set by the transport when the stream failed before
   * delivering ANY event — nothing was consumed, no content was accepted, no
   * tool executed — so re-issuing the whole turn is semantically safe (the
   * only cost is the duplicate request). The engine replays such turns within
   * a bounded budget instead of surfacing the error to the consumer.
   */
  turnReplaySafe?: boolean;
  constructor(
    message: string,
    override readonly cause?: unknown,
    code: Extract<
      ErrorCode,
      | 'api_connection_failed'
      | 'sse_malformed_frame'
      | 'stream_idle_timeout'
      | 'stream_max_duration'
      | 'empty_stream'
    > = 'api_connection_failed',
  ) {
    super(message);
    this.code = code;
  }
}

/** Non-2xx response from the Messages API. */
export class APIStatusError extends Error {
  override name = 'APIStatusError';
  readonly code: ErrorCode = 'api_status_error';
  constructor(
    readonly status: number,
    readonly errorType: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

/** Feature accepted for type compatibility but not implemented in this version. */
export class NotImplementedError extends Error {
  override name = 'NotImplementedError';
  readonly code: ErrorCode = 'not_implemented';
  constructor(feature: string, hint?: string) {
    super(
      `silver-core-sdk: ${feature} is not implemented in this version${hint ? `. ${hint}` : ''}`,
    );
  }
}

/** Invalid or missing configuration (e.g. no API key resolvable). */
export class ConfigurationError extends Error {
  override name = 'ConfigurationError';
  readonly code: ErrorCode = 'config_invalid';
}

/**
 * A memory-tool command failed (missing path, duplicate old_str, root
 * protection, ...). `message` is the REFERENCE error string from the official
 * memory-tool docs, verbatim — the memory tool surfaces it as the is_error
 * tool_result content, so the model reads exactly what the docs trained it
 * to expect (docs/MEMORY.md R1).
 */
export class MemoryToolError extends Error {
  override name = 'MemoryToolError';
  readonly code: ErrorCode = 'memory_tool_error';
}

/** Which MCP transport an `McpError` originated from. */
export type McpTransportKind = 'stdio' | 'http' | 'sdk';

/** Lifecycle phase an `McpError` occurred in. */
export type McpPhase = 'connect' | 'request' | 'close';

/**
 * E6a: typed error for the MCP subsystem (mcp/http.ts, mcp/stdio.ts,
 * mcp/registry.ts). Carries the failing server's label, transport kind and
 * lifecycle phase so consumers can `instanceof`-route and report the scene
 * without parsing the message. Aborts still use `AbortError`; an
 * unimplemented transport still uses `NotImplementedError`; bad server
 * CONFIG still uses `ConfigurationError` - McpError covers runtime protocol/
 * connection failures.
 */
export class McpError extends Error {
  override name = 'McpError';
  constructor(
    readonly code: McpErrorCode,
    message: string,
    readonly context: {
      /** Configured server name (or url/command fallback label). */
      serverLabel?: string;
      transport?: McpTransportKind;
      phase?: McpPhase;
      /** HTTP status for `mcp_http_status`. */
      httpStatus?: number;
      /** JSON-RPC error code for `mcp_rpc_error`. */
      rpcCode?: number;
      /** Timeout budget for `mcp_request_timeout` / `mcp_connect_timeout`. */
      timeoutMs?: number;
    } = {},
  ) {
    super(message);
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof AbortError ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/**
 * The stable `code` of an SDK error object, or undefined for foreign errors
 * (Node system errors also carry a string `code` - ENOENT etc. - so this
 * checks the SDK classes rather than duck-typing the field).
 */
export function errorCodeOf(err: unknown): ErrorCode | undefined {
  if (
    err instanceof AbortError ||
    err instanceof APIConnectionError ||
    err instanceof APIStatusError ||
    err instanceof NotImplementedError ||
    err instanceof ConfigurationError ||
    err instanceof McpError
  ) {
    return err.code;
  }
  return undefined;
}
