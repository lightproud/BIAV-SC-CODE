/**
 * MCP elicitation helper (module F).
 *
 * Shared by the stdio and streamable-HTTP wire connections. An MCP server may
 * send a server-initiated `elicitation/create` request when it needs
 * structured input from the user (MCP spec 2025-06-18). This module parses that
 * request into the public {@link ElicitationRequest}, invokes the host handler,
 * and maps the host's {@link ElicitationResult} back to the JSON-RPC result
 * payload the server expects.
 *
 * Fail-closed: a missing handler or any thrown error resolves to
 * `{ action: 'decline' }` so a misbehaving server or host cannot hang the wire.
 */

import type {
  ElicitationHandler,
  ElicitationRequest,
  ElicitationResult,
  JSONSchema,
} from '../types.js';

/** JSON-RPC `result` payload written back for an elicitation/create request. */
export type ElicitationJsonRpcResult =
  | { action: 'accept'; content: Record<string, unknown> }
  | { action: 'decline' }
  | { action: 'cancel' };

/**
 * Parse a raw MCP `elicitation/create` params object into a public
 * ElicitationRequest. Missing/invalid fields fall back to safe defaults
 * (empty message, empty object schema) rather than throwing.
 */
export function parseElicitationParams(params: unknown): ElicitationRequest {
  const obj =
    params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  const message = typeof obj['message'] === 'string' ? (obj['message'] as string) : '';
  const rawSchema = obj['requestedSchema'];
  const requestedSchema: JSONSchema =
    rawSchema && typeof rawSchema === 'object' && !Array.isArray(rawSchema)
      ? (rawSchema as JSONSchema)
      : { type: 'object' };
  return { message, requestedSchema };
}

/** Normalize a host ElicitationResult into the JSON-RPC result payload. */
function normalizeResult(result: unknown): ElicitationJsonRpcResult {
  if (result && typeof result === 'object') {
    const action = (result as { action?: unknown }).action;
    if (action === 'accept') {
      const content = (result as { content?: unknown }).content;
      if (content && typeof content === 'object' && !Array.isArray(content)) {
        return { action: 'accept', content: content as Record<string, unknown> };
      }
      // accept without a valid content object is invalid; fail closed.
      return { action: 'decline' };
    }
    if (action === 'cancel') return { action: 'cancel' };
    if (action === 'decline') return { action: 'decline' };
  }
  return { action: 'decline' };
}

/**
 * Resolve a server-initiated elicitation request. Always resolves (never
 * rejects): a missing handler, an aborted signal, an invalid response, or any
 * thrown error all map to `{ action: 'decline' }`.
 */
export async function resolveElicitation(
  params: unknown,
  handler: ElicitationHandler | undefined,
  signal: AbortSignal,
): Promise<ElicitationJsonRpcResult> {
  if (!handler) return { action: 'decline' };
  try {
    const request = parseElicitationParams(params);
    const result: ElicitationResult = await handler(request, { signal });
    return normalizeResult(result);
  } catch {
    return { action: 'decline' };
  }
}
