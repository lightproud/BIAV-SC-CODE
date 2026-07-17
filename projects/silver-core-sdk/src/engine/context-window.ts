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
 * Static per-model OUTPUT-token ceiling table (same provenance discipline as
 * the window table: estimates from public model documentation). Used to
 * re-clamp max_tokens when a FALLBACK switch lands on a model whose output
 * ceiling is lower than the configured cap — sending the primary model's cap
 * would 400. Longest matching prefix wins; unknown ids return undefined
 * (no clamp — conservative).
 */
const OUTPUT_CEILING_TABLE: readonly WindowEntry[] = [
  { prefix: 'claude-opus-', window: 32_000 },
  { prefix: 'claude-sonnet-', window: 64_000 },
  { prefix: 'claude-haiku-', window: 64_000 },
  { prefix: 'claude-3-7-sonnet-', window: 64_000 },
  { prefix: 'claude-3-5-sonnet-', window: 8_192 },
  { prefix: 'claude-3-5-haiku-', window: 8_192 },
  { prefix: 'claude-3-opus-', window: 4_096 },
  { prefix: 'claude-3-haiku-', window: 4_096 },
];

/** Output-token ceiling for a model id, or undefined when unknown. */
export function outputCeilingFor(model: string): number | undefined {
  let best: WindowEntry | undefined;
  for (const entry of OUTPUT_CEILING_TABLE) {
    if (model.startsWith(entry.prefix)) {
      if (best === undefined || entry.prefix.length > best.prefix.length) {
        best = entry;
      }
    }
  }
  return best?.window;
}

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
