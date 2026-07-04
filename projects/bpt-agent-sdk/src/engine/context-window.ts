/**
 * Model context-window table.
 *
 * Maps a model id to its maximum context window (input + output tokens), by
 * longest-matching prefix, mirroring the static prefix table in pricing.ts.
 * Values are ESTIMATES sourced from public model documentation and are used
 * only to size the compaction threshold; they are not authoritative limits.
 * Unknown model ids fall back to DEFAULT_CONTEXT_WINDOW (conservative).
 *
 * NOTE: sonnet-4-5 / sonnet-5 can run a 1M-token window under the
 * 'context-1m' beta. v0.2 does NOT auto-detect that beta here; callers that
 * enable it override the window via CompactionOptions.contextWindowTokens.
 */

/** Returned for any model id not matched by the table below. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

type WindowEntry = {
  /** Model-id prefix this entry applies to. */
  prefix: string;
  /** Maximum context window in tokens. */
  window: number;
};

/** Static window table. Longest matching prefix wins. */
const WINDOW_TABLE: readonly WindowEntry[] = [
  { prefix: 'claude-opus-', window: 200_000 },
  { prefix: 'claude-sonnet-', window: 200_000 },
  { prefix: 'claude-haiku-', window: 200_000 },
];

/**
 * Maximum context window (tokens) for a model id. Longest-prefix match;
 * unknown models return DEFAULT_CONTEXT_WINDOW.
 */
export function contextWindowFor(model: string): number {
  let best: WindowEntry | undefined;
  for (const entry of WINDOW_TABLE) {
    if (model.startsWith(entry.prefix)) {
      if (best === undefined || entry.prefix.length > best.prefix.length) {
        best = entry;
      }
    }
  }
  return best === undefined ? DEFAULT_CONTEXT_WINDOW : best.window;
}
