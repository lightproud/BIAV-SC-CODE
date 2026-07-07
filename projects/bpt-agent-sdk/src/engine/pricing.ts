/**
 * Engine pricing helpers: static cost estimation and usage arithmetic.
 *
 * Prices are ESTIMATES from a static table (USD per million tokens) and are
 * documented as such; they are not authoritative billing data. Unknown model
 * ids estimate to 0.
 */

import type { NonNullableUsage, Usage } from '../types.js';

type PriceEntry = {
  /** Model-id prefix this entry applies to. */
  prefix: string;
  /** USD per MTok of regular input tokens. */
  input: number;
  /** USD per MTok of output tokens. */
  output: number;
  /** USD per MTok of cache-creation input tokens. */
  cacheWrite: number;
  /** USD per MTok of cache-read input tokens. */
  cacheRead: number;
};

/** Static price table (USD per MTok). Longest matching prefix wins. cacheWrite
 *  is the 5-minute rate (= input x1.25); the 1-hour rate (input x2) is computed
 *  in estimateCostUsd from the run's cacheTtl. */
const PRICE_TABLE: readonly PriceEntry[] = [
  { prefix: 'claude-opus-', input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  { prefix: 'claude-sonnet-', input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  { prefix: 'claude-haiku-', input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  // S5 (BPT audit 2026-07-07): claude-fable-* matched no prefix -> cost 0.
  { prefix: 'claude-fable-', input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1.0 },
];

const MTOK = 1_000_000;

/**
 * Normalize a cloud-provider model id back to its canonical `claude-...` form so
 * the price prefix still matches (S1, BPT audit 2026-07-07). Without this,
 * Bedrock (`us.anthropic.claude-opus-4-8`) and Vertex (`claude-opus-4-8@vertex`)
 * ids matched no prefix -> cost 0 -> `maxBudgetUsd` silently never enforced.
 */
export function normalizeModelId(model: string): string {
  // Bedrock: "<region>.anthropic.claude-…" or "anthropic.claude-…"
  let m = model.replace(/^[a-z]{2}\.anthropic\./, '').replace(/^anthropic\./, '');
  // Vertex: "claude-…@<region-or-version>"
  const at = m.indexOf('@');
  return at === -1 ? m : m.slice(0, at);
}

/**
 * Estimate the USD cost of one API response given its normalized usage.
 * Longest-prefix match on the (cloud-normalized) model id; unknown models
 * return 0. Cache-creation is billed by TTL — 5m = input x1.25 (the table's
 * cacheWrite), 1h = input x2. Our SDK sets one cacheTtl per request, so every
 * cache_creation token in a response used that TTL (C1, BPT audit 2026-07-07).
 */
export function estimateCostUsd(
  model: string,
  usage: NonNullableUsage,
  cacheTtl: '5m' | '1h' = '5m',
): number {
  const normalized = normalizeModelId(model);
  let best: PriceEntry | undefined;
  for (const entry of PRICE_TABLE) {
    if (normalized.startsWith(entry.prefix)) {
      if (best === undefined || entry.prefix.length > best.prefix.length) {
        best = entry;
      }
    }
  }
  if (best === undefined) return 0;
  const cacheWriteRate = cacheTtl === '1h' ? best.input * 2 : best.cacheWrite;
  return (
    (usage.input_tokens * best.input +
      usage.output_tokens * best.output +
      usage.cache_creation_input_tokens * cacheWriteRate +
      usage.cache_read_input_tokens * best.cacheRead) /
    MTOK
  );
}

/** Normalize a wire Usage into one with all cache fields as plain numbers. */
export function normalizeUsage(u: Usage): NonNullableUsage {
  return {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
  };
}

/** Field-wise sum of two normalized usages (running totals). */
export function addUsage(a: NonNullableUsage, b: NonNullableUsage): NonNullableUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens:
      a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
  };
}
