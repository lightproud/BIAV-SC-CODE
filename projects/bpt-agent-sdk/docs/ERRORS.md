# Error codes (E6c)

Every error class in `src/errors.ts` carries a machine-readable, stable
`code` field so consumers (e.g. BPT Desktop) can route retry / switch-gateway
/ report-a-bug decisions and i18n without parsing English messages. `name`
and message text are unchanged by E6c - the drop-in surface only gains
fields.

Stability contract: codes are **append-only**. Never rename, remove, or
reuse a published code. New failure scenarios get new codes.

Discovery: `err.code` on any SDK error instance, or `errorCodeOf(err)`
(exported from the package root) which returns `undefined` for foreign
errors - Node system errors also carry a string `code` (`ENOENT`, ...), so
duck-typing the field is not safe; use the helper.

Per-layer rules for WHICH class a module may throw live in
`docs/ARCHITECTURE.md` ("Error discipline (E6)"), enforced by
`tests/error-discipline.test.ts`.

## Core codes

| Code | Class | Trigger scenario |
|------|-------|------------------|
| `aborted` | `AbortError` | The operation was cancelled via AbortController / `interrupt()` / connection close. |
| `api_connection_failed` | `APIConnectionError` | Network-level failure talking to the Messages API (default scenario; `midStreamTruncation` marks a mid-stream drop). |
| `sse_malformed_frame` | `APIConnectionError` | Reserved scenario code: an SSE frame with an event name failed to parse (transport layer wiring pending; until wired such errors carry `api_connection_failed`). |
| `stream_idle_timeout` | `APIConnectionError` | Reserved scenario code: the idle watchdog aborted a silent stream (transport layer wiring pending; same fallback as above). |
| `api_status_error` | `APIStatusError` | Non-2xx response from the Messages API (`status` / `errorType` / `requestId` fields carry the detail). |
| `not_implemented` | `NotImplementedError` | A feature accepted for type compatibility is not implemented in this version (e.g. the legacy `sse` MCP transport). |
| `config_invalid` | `ConfigurationError` | Invalid or missing configuration (no resolvable API key, unrecognized MCP server config, ...). |

## MCP codes (`McpError`)

`McpError.context` additionally carries the scene: `serverLabel` (configured
server name), `transport` (`stdio` / `http` / `sdk`), `phase`
(`connect` / `request` / `close`), plus `httpStatus` / `rpcCode` /
`timeoutMs` where noted.

| Code | Class | Trigger scenario |
|------|-------|------------------|
| `mcp_connect_timeout` | `McpError` | A server did not finish `connect()` + `listTools()` within the registry's 60s connect timeout (`timeoutMs`). Surfaces as a `failed` server status, not a thrown error, at the registry boundary. |
| `mcp_http_status` | `McpError` | Streamable-HTTP server answered a JSON-RPC POST with a non-2xx HTTP status (`httpStatus`). |
| `mcp_invalid_response` | `McpError` | Server response was structurally unusable: SSE response without a body, non-JSON response body, SSE stream ending without answering the request, or a JSON body missing the request id's answer. |
| `mcp_request_timeout` | `McpError` | One JSON-RPC request exceeded the per-request timeout (`timeoutMs`, default 60s). |
| `mcp_rpc_error` | `McpError` | Server answered with a JSON-RPC error object; `rpcCode` carries the server's numeric code. At the tool-call boundary this becomes an `is_error` tool result, not a thrown error. |
| `mcp_connection_closed` | `McpError` | Operation on a closed stdio connection: `connect()` after `close()`, or in-flight requests failed by `close()`. |
| `mcp_already_connected` | `McpError` | `connect()` called twice on the same stdio connection. |
| `mcp_not_connected` | `McpError` | Request/write on a stdio connection that is not open, or a registry operation (`readResource`) against a server that is not connected. |
| `mcp_server_exited` | `McpError` | The stdio server process exited while requests were pending. |
| `mcp_process_error` | `McpError` | The stdio server process emitted a spawn/process-level error while requests were pending. |
| `mcp_unknown_server` | `McpError` | A registry operation named a server that does not exist in the configuration. |

## Error channels (unchanged by E6)

The three-channel design still holds: transports **throw** typed errors;
tool failures return `tool_result` with `is_error: true` (never thrown);
run-level failures end the run through the `result` message's error subtypes.
`McpError` instances thrown inside connections are converted to `is_error`
tool results / `failed` statuses at the registry boundary - only aborts
propagate.
