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
 * Tools that always route to a prompt under 'auto' even when a subclass forgot
 * to flag them isFileEdit (a shell can mutate anything).
 */
const KNOWN_DESTRUCTIVE: ReadonlySet<string> = new Set(['Bash', 'Write', 'Edit']);

/**
 * The default 'auto' classifier - a static heuristic, no model call:
 *   - a read-only tool             -> 'allow'
 *   - a file edit (Write/Edit) OR a known-destructive name (Bash/Write/Edit)
 *                                  -> 'prompt' (route to canUseTool)
 *   - anything else (unknown / MCP non-read-only tools)
 *                                  -> 'allow'
 */
export function defaultAutoClassifier(
  toolName: string,
  _input: Record<string, unknown>,
  meta: { readOnly: boolean; isFileEdit: boolean },
): AutoDecision {
  if (meta.readOnly) return 'allow';
  if (meta.isFileEdit || KNOWN_DESTRUCTIVE.has(toolName)) return 'prompt';
  return 'allow';
}
