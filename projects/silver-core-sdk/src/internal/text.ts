/**
 * Shared text primitives.
 *
 * sliceSurrogateSafe was born as a private helper in engine/compaction.ts
 * (D4, audit r2 2026-07-17) while ~10 other `.slice(0, N)` truncation sites
 * kept splitting surrogate pairs (audit r4 2026-07-17, R7s family). It is
 * exported from here so every truncation site can share the one correct
 * implementation instead of growing private near-twins.
 */

/**
 * Truncate to at most n UTF-16 units WITHOUT splitting a surrogate pair.
 * A bare .slice() cutting an astral codepoint (emoji, CJK Ext-B) in half
 * leaves a lone surrogate in the output, which serializes as U+FFFD on every
 * subsequent wire request — permanently, wherever the truncated text is
 * persisted or replayed.
 */
export function sliceSurrogateSafe(s: string, n: number): string {
  const cut = s.slice(0, n);
  const last = cut.charCodeAt(cut.length - 1);
  // A trailing HIGH surrogate means the cut landed mid-pair: drop it.
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
