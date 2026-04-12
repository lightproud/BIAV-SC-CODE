/**
 * token-accounting.ts — 6-dimensional token meter.
 *
 * Why 6 dimensions: Token transparency is Day-0 差异化 #2. Users must see
 * exactly WHERE their tokens go — system prompt, tools schema, history,
 * generation, cache hit, cache write. This module computes and tracks
 * per-turn and per-conversation breakdowns.
 *
 * Why rough estimation: We can't perfectly decompose input_tokens from
 * the API into system/tools/history because the API only reports totals.
 * We estimate by counting tokens in each component BEFORE sending, using
 * a simple char/4 heuristic. The API's actual cache_hit/cache_write/output
 * numbers are exact.
 */

import type { TokenUsage, ToolDescriptor } from '../../src/types';
import { getContextWindow as getContextWindowFromRegistry } from '../../src/models';

// ── Compression thresholds ─────────────────────────────────────
//
// Why here (not in models.ts): compression logic is a token-accounting
// concern. models.ts owns the raw data; this module owns the derived
// thresholds and estimation heuristics.

/**
 * Safety margin: 5% of context window is reserved as hard buffer
 * for API overhead, token-counting imprecision, and response framing.
 */
const SAFETY_MARGIN_RATIO = 0.05;

/** Re-export for convenience — callers don't need to import models.ts directly. */
export const getContextWindow = getContextWindowFromRegistry;

/**
 * Calculate the dynamic history budget for compression decisions.
 *
 * Aider-inspired split budget: instead of "compress at X% of window",
 * we calculate how much space history ACTUALLY has after accounting for
 * system prompt, tool schemas, and output reserve. History gets the rest.
 *
 * Budget = contextWindow - safetyMargin - systemTokens - toolTokens - outputReserve
 *
 * This automatically adapts to:
 * - Models with different context windows (1M vs 200k vs 64k)
 * - Gears with different tool counts (chat: 5 tools vs work: 6+)
 * - Silver Core context injection (bigger system prompt = less history room)
 * - @Cite injections (counted as history, so they reduce remaining budget)
 */
export function getHistoryBudget(
  model: string,
  systemPromptTokens: number,
  toolSchemaTokens: number,
  maxOutputTokens: number,
): number {
  const contextWindow = getContextWindow(model);
  const safetyMargin = Math.floor(contextWindow * SAFETY_MARGIN_RATIO);

  const budget = contextWindow - safetyMargin - systemPromptTokens - toolSchemaTokens - maxOutputTokens;
  // Never return negative — means the model is too small for this config
  return Math.max(0, budget);
}

/**
 * Legacy threshold for when overhead is unknown (e.g. shouldCompress called
 * before system prompt is built). Falls back to 90% of context window
 * minus a generous flat reserve.
 */
export function getCompressionThreshold(model: string, configOverride?: number | null): number {
  const contextWindow = getContextWindow(model);
  const safetyCeiling = Math.floor(contextWindow * (1 - SAFETY_MARGIN_RATIO));

  // Default: 90% of window
  const defaultThreshold = Math.floor(contextWindow * 0.90);

  if (configOverride != null && configOverride > 0) {
    return Math.min(configOverride, safetyCeiling);
  }

  return Math.min(defaultThreshold, safetyCeiling);
}

// ── Token estimation ───────────────────────────────────────────

/**
 * Rough token count aware of CJK vs Latin text.
 *
 * Why not a simple char/4: BPE tokenizers encode CJK characters as 2-3 tokens
 * each, while Latin text averages ~4 chars per token. This project mixes
 * Chinese and English heavily, so uniform char/4 underestimates by ~2x for
 * Chinese-heavy prompts (which is most of ours).
 *
 * Exported for use by compressor (overhead calculation) and other consumers.
 */
export function estimateTokens(text: string): number {
  let cjkChars = 0;
  let otherChars = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4DBF) ||   // CJK Extension A
      (code >= 0x3000 && code <= 0x303F) ||   // CJK Symbols and Punctuation
      (code >= 0xFF00 && code <= 0xFFEF) ||   // Fullwidth Forms
      (code >= 0x3040 && code <= 0x309F) ||   // Hiragana
      (code >= 0x30A0 && code <= 0x30FF)      // Katakana
    ) {
      cjkChars++;
    } else {
      otherChars++;
    }
  }
  // CJK: ~2 tokens per character; Latin: ~4 chars per token
  return Math.ceil(cjkChars * 2 + otherChars / 4);
}

/**
 * Estimate the token breakdown BEFORE sending a request.
 * This gives the user a "preview" of what this turn will cost.
 */
export function estimateRequestTokens(
  systemPrompt: string,
  tools: ToolDescriptor[],
  historyJson: string,
): { system: number; tools: number; history: number } {
  return {
    system: estimateTokens(systemPrompt),
    tools: estimateTokens(JSON.stringify(tools)),
    history: estimateTokens(historyJson),
  };
}

/**
 * Merge our pre-send estimates with the API's post-response actuals.
 * The API gives us: total input, output, cache_hit, cache_write.
 * We fill in system/tools/history from our estimates.
 */
export function mergeUsage(
  preEstimate: { system: number; tools: number; history: number },
  apiUsage: TokenUsage,
): TokenUsage {
  return {
    system: preEstimate.system,
    tools: preEstimate.tools,
    history: preEstimate.history,
    generation: apiUsage.generation,
    cacheHit: apiUsage.cacheHit,
    cacheWrite: apiUsage.cacheWrite,
    estimatedCostUsd: apiUsage.estimatedCostUsd,
  };
}

/**
 * Accumulate token usage across turns in a conversation.
 */
export function accumulateUsage(total: TokenUsage, turn: TokenUsage): TokenUsage {
  return {
    system: total.system + turn.system,
    tools: total.tools + turn.tools,
    history: total.history + turn.history,
    generation: total.generation + turn.generation,
    cacheHit: total.cacheHit + turn.cacheHit,
    cacheWrite: total.cacheWrite + turn.cacheWrite,
    estimatedCostUsd: total.estimatedCostUsd + turn.estimatedCostUsd,
  };
}

export function emptyUsage(): TokenUsage {
  return { system: 0, tools: 0, history: 0, generation: 0, cacheHit: 0, cacheWrite: 0, estimatedCostUsd: 0 };
}

/**
 * Check if cache hit rate is below the T1 red-line threshold (80%).
 */
export function isCacheHealthy(usage: TokenUsage): boolean {
  const totalInput = usage.system + usage.tools + usage.history;
  if (totalInput === 0) return true;
  const hitRate = usage.cacheHit / totalInput;
  return hitRate >= 0.8;
}
