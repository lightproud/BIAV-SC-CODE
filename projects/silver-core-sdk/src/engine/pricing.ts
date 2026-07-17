/**
 * Engine pricing helpers: static cost estimation and usage arithmetic.
 *
 * Prices are ESTIMATES from a static table (USD per million tokens) and are
 * documented as such; they are not authoritative billing data. Unknown model
 * ids estimate to 0.
 */

import type { NonNullableUsage, PriceOverride, Usage } from '../types.js';

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
  // Audit 2026-07-17 L6: legacy generation-first ids (claude-3-5-sonnet-20241022
  // etc.) matched no prefix -> cost 0 -> maxBudgetUsd silently unenforced for
  // callers pinned to older models. Longest prefix wins, so these never shadow
  // the generation-last entries above.
  { prefix: 'claude-3-opus-', input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  { prefix: 'claude-3-7-sonnet-', input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  { prefix: 'claude-3-5-sonnet-', input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  { prefix: 'claude-3-5-haiku-', input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  { prefix: 'claude-3-haiku-', input: 0.25, output: 1.25, cacheWrite: 0.3125, cacheRead: 0.025 },
];

const MTOK = 1_000_000;

/** Longest-prefix match over caller overrides (normalized id). */
function matchOverride(
  normalized: string,
  overrides: Record<string, PriceOverride> | undefined,
): PriceEntry | undefined {
  if (overrides === undefined) return undefined;
  let bestPrefix: string | undefined;
  for (const prefix of Object.keys(overrides)) {
    if (normalized.startsWith(prefix)) {
      if (bestPrefix === undefined || prefix.length > bestPrefix.length) {
        bestPrefix = prefix;
      }
    }
  }
  if (bestPrefix === undefined) return undefined;
  const o = overrides[bestPrefix] as PriceOverride;
  return {
    prefix: bestPrefix,
    input: o.input,
    output: o.output,
    cacheWrite: o.cacheWrite ?? o.input * 1.25,
    cacheRead: o.cacheRead ?? o.input * 0.1,
  };
}

/** True when a price is known for `model` (static table or overrides) — the
 *  budget cap is only enforceable when this holds. */
export function hasPriceFor(
  model: string,
  overrides?: Record<string, PriceOverride>,
): boolean {
  const normalized = normalizeModelId(model);
  if (matchOverride(normalized, overrides) !== undefined) return true;
  return PRICE_TABLE.some((e) => normalized.startsWith(e.prefix));
}

/**
 * Normalize a cloud-provider model id back to its canonical `claude-...` form so
 * the price prefix still matches (S1, BPT audit 2026-07-07). Without this,
 * Bedrock (`us.anthropic.claude-opus-4-8`) and Vertex (`claude-opus-4-8@vertex`)
 * ids matched no prefix -> cost 0 -> `maxBudgetUsd` silently never enforced.
 */
export function normalizeModelId(model: string): string {
  // Bedrock: "<region-profile>.anthropic.claude-…" or "anthropic.claude-…".
  // The region/inference-profile prefix is NOT always two letters: cross-region
  // inference profiles ship as `apac.`, `global.`, and `us-gov.` alongside the
  // two-letter `us.`/`eu.` forms. The old two-letter-only regex left those
  // spellings un-normalized → no price-table prefix matched → cost estimated as
  // $0 → maxBudgetUsd silently unenforceable on exactly those models. Match a
  // general lowercase[digits/hyphen] profile token before `.anthropic.`; a
  // canonical `claude-…` / Vertex `claude-…@…` id has no `.anthropic.` and is
  // untouched, and the bare `anthropic.` form is still handled by the second
  // replace, so there is no double strip.
  let m = model
    .replace(/^[a-z][a-z0-9-]*\.anthropic\./, '')
    .replace(/^anthropic\./, '');
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
  overrides?: Record<string, PriceOverride>,
): number {
  const normalized = normalizeModelId(model);
  // Caller overrides win over the static table (they exist to price models
  // the table cannot know about — and to correct it when it is stale).
  let best: PriceEntry | undefined = matchOverride(normalized, overrides);
  if (best === undefined) {
    for (const entry of PRICE_TABLE) {
      if (normalized.startsWith(entry.prefix)) {
        if (best === undefined || entry.prefix.length > best.prefix.length) {
          best = entry;
        }
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
    web_search_requests: u.server_tool_use?.web_search_requests ?? 0,
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
    web_search_requests: (a.web_search_requests ?? 0) + (b.web_search_requests ?? 0),
  };
}
