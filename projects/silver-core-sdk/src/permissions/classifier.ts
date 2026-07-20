/**
 * The permissionMode 'auto' classifier.
 *
 * In 'auto' mode the gate asks a classifier whether an unmatched tool call
 * should be auto-approved, prompted (routed to canUseTool), or denied - with
 * NO extra model round-trip in the default implementation. The exported
 * `ToolClassifier` type is the seam for an optional custom classifier injected
 * at gate construction time.
 *
 * This module is pure: it imports nothing, performs no I/O, and is directly
 * unit-testable.
 */

/** The verdict the 'auto' classifier returns for one tool call. */
export type AutoDecision = 'allow' | 'prompt' | 'deny';

/**
 * A classifier consulted by the gate under permissionMode 'auto'. Receives the
 * tool name, its input, and the tool's static risk flags. Must be synchronous
 * and side-effect free (it runs inside the permission hot path).
 */
export type ToolClassifier = (
  toolName: string,
  input: Record<string, unknown>,
  meta: { readOnly: boolean; isFileEdit: boolean },
) => AutoDecision;

/**
 * The default 'auto' classifier - a static heuristic, no model call:
 *   - a read-only tool             -> 'allow'
 *   - ANY non-read-only tool       -> 'prompt' (route to canUseTool)
 *
 * The non-read-only branch is deliberately broad: it covers builtin mutators
 * (Bash / Write / Edit), file edits, AND unknown / third-party MCP tools whose
 * risk cannot be statically assessed (e.g. mcp__gmail__send, a delete/push/pay
 * call). Auto-allowing those unattended would let 'auto' mode silently execute
 * destructive third-party mutations with no canUseTool consultation, so an
 * unknown non-read-only tool must PROMPT rather than allow. Broad auto-allow of
 * MCP mutations, if ever wanted, must be opt-in per server via allow rules -
 * never the default here.
 */
export function defaultAutoClassifier(
  _toolName: string,
  _input: Record<string, unknown>,
  meta: { readOnly: boolean; isFileEdit: boolean },
): AutoDecision {
  if (meta.readOnly) return 'allow';
  return 'prompt';
}
