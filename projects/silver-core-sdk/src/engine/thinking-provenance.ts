/**
 * Cross-model thinking-block hygiene (BPT request 2026-07-07).
 *
 * Extended-thinking blocks carry a `signature` the SIGNING model verifies on
 * replay. Replaying a thinking block to a DIFFERENT model than produced it
 * fails signature verification → `400 invalid_request_error: Invalid signature
 * in thinking block`, and since the bad block lives in history, EVERY later turn
 * re-hits it (the conversation dies). This mirrors Anthropic's own replay
 * contract: same model → pass thinking back as-is; different model → drop it.
 *
 * We track the signing model per assistant turn as a NON-ENUMERABLE Symbol
 * property (so it never serializes onto the wire `messages`), then strip
 * `thinking` / `redacted_thinking` from every CLOSED historical assistant turn
 * whose signer ≠ the target model. Turns with NO stamp (loaded from a resumed
 * transcript) are treated as stale and stripped too — safe, and it fixes the
 * resume path without threading provenance through the store. The one turn we
 * never strip is the in-flight tool-loop turn (the API REQUIRES its thinking
 * before the tool_use); that cross-model edge is handled upstream at the
 * fallback-switch site, not here.
 */

import type { APIMessageParam, ContentBlockParam } from '../types.js';

/** Non-enumerable marker: which model SIGNED this assistant turn's blocks. */
const SIGNING_MODEL = Symbol('bpt.signingModel');

/** Stamp an assistant turn with the model that produced (signed) it. */
export function stampSigningModel(turn: APIMessageParam, model: string): void {
  Object.defineProperty(turn, SIGNING_MODEL, {
    value: model,
    enumerable: false, // never reaches JSON.stringify -> never on the wire
    configurable: true,
    writable: true,
  });
}

/** The signing model of a turn, or undefined when unstamped (e.g. resumed). */
export function signingModelOf(turn: APIMessageParam): string | undefined {
  return (turn as { [SIGNING_MODEL]?: string })[SIGNING_MODEL];
}

function isThinking(b: ContentBlockParam): boolean {
  return b.type === 'thinking' || b.type === 'redacted_thinking';
}

function contentHasToolResult(content: APIMessageParam['content']): boolean {
  return Array.isArray(content) && content.some((b) => b.type === 'tool_result');
}

function contentHasThinking(content: APIMessageParam['content']): boolean {
  return Array.isArray(content) && content.some(isThinking);
}

/**
 * Index of the in-flight assistant turn whose thinking must NOT be stripped:
 * only when the request is a tool-loop continuation (its last message is a
 * user turn carrying tool_result blocks) is the preceding assistant turn
 * "open" and its thinking API-required. A fresh user prompt closes the prior
 * assistant turn, so nothing is protected. Returns -1 when none is protected.
 */
export function protectedTurnIndex(messages: APIMessageParam[]): number {
  const last = messages[messages.length - 1];
  if (last === undefined || last.role !== 'user' || !contentHasToolResult(last.content)) {
    return -1;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') return i;
  }
  return -1;
}

/**
 * Return a copy of `messages` with `thinking`/`redacted_thinking` stripped from
 * every CLOSED assistant turn whose signing model ≠ `targetModel` (or which
 * carries no stamp). The in-flight tool-loop turn (protectedTurnIndex) is left
 * intact. When nothing needs stripping — the common same-model steady state —
 * the ORIGINAL array reference is returned unchanged, so the request bytes (and
 * the prompt cache) are untouched. text / tool_use / tool_result are never
 * altered.
 */
export function stripStaleThinking(
  messages: APIMessageParam[],
  targetModel: string,
): APIMessageParam[] {
  const protectedIdx = protectedTurnIndex(messages);
  let changed = false;
  const out: APIMessageParam[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== 'assistant' || i === protectedIdx || !contentHasThinking(m.content)) {
      out.push(m);
      continue;
    }
    const signer = signingModelOf(m);
    const stale = signer === undefined || signer !== targetModel;
    if (!stale) {
      out.push(m);
      continue;
    }
    changed = true;
    const filtered = (m.content as ContentBlockParam[]).filter((b) => !isThinking(b));
    // A thinking-only assistant turn (a max_tokens cut before any text/tool_use)
    // strips down to ZERO content blocks. Replaying {role:'assistant',content:[]}
    // 400s "content must not be empty" on EVERY later request — the bad turn
    // lives in history, so the whole session wedges permanently and no resume
    // can recover it. Drop the empty turn entirely instead of emitting it: it
    // carried no answer and no tool call, and the Anthropic API coalesces any
    // now-adjacent user turns (the memory-flush path already appends a user turn
    // right after a tool_result user turn and relies on the same coalescing).
    if (filtered.length === 0) continue;
    out.push({ role: m.role, content: filtered });
  }
  return changed ? out : messages;
}
