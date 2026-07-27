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

/**
 * Keep the LAST n UTF-16 units WITHOUT splitting a surrogate pair. The mirror
 * of sliceSurrogateSafe, for sites that must preserve the END of a stream: a
 * command's verdict lands in its final lines, not its first.
 *
 * Note the boundary asymmetry — a head cut drops a trailing HIGH surrogate
 * (0xD800-0xDBFF), a tail cut drops a leading LOW surrogate (0xDC00-0xDFFF).
 */
export function sliceTailSurrogateSafe(s: string, n: number): string {
  if (n <= 0) return '';
  const cut = s.length > n ? s.slice(-n) : s;
  const first = cut.charCodeAt(0);
  // A leading LOW surrogate means the cut landed mid-pair: drop it.
  return first >= 0xdc00 && first <= 0xdfff ? cut.slice(1) : cut;
}
