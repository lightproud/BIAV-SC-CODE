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
 * Compression ratio: compress when history exceeds this fraction of context window.
 *
 * Why 12%: At Sonnet $3/MTok, 120k history = $0.36/turn in history alone.
 * That's a reasonable cost ceiling. Tighter-window models (128k GPT-4o,
 * 64k DeepSeek) get proportionally tighter thresholds automatically.
 */
const COMPRESSION_RATIO = 0.12;

/**
 * Safety ceiling: never let total input exceed this fraction of context window.
 * Reserves the remaining 20% for output generation.
 */
const SAFETY_CEILING_RATIO = 0.80;

/** Reserved tokens for system prompt + tool schema + safety margin. */
const RESERVED_OVERHEAD = 10_000;

/** Re-export for convenience — callers don't need to import models.ts directly. */
export const getContextWindow = getContextWindowFromRegistry;

/**
 * Calculate the effective compression threshold for a given model.
 *
 * Why model-aware: A fixed 120k threshold is 12% of a 1M window (fine)
 * but 60% of a 200k window (dangerous) and 94% of a 128k window (fatal).
 * The threshold must scale with the model's actual capacity.
 *
 * Returns the token count at which history compression should trigger.
 * The threshold is the smallest of:
 * 1. contextWindow * COMPRESSION_RATIO  — cost control
 * 2. contextWindow * SAFETY_CEILING_RATIO - reserved  — hard ceiling
 * 3. configOverride (if user set one, respect it but cap at safety ceiling)
 */
export function getCompressionThreshold(model: string, configOverride?: number | null): number {
  const contextWindow = getContextWindow(model);

  // Cost-based: compress proactively to control per-turn cost
  const costThreshold = Math.floor(contextWindow * COMPRESSION_RATIO);

  // Safety: leave room for system prompt, tools, and output
  const safetyCeiling = Math.floor(contextWindow * SAFETY_CEILING_RATIO) - RESERVED_OVERHEAD;

  // Model-aware default = the tighter of cost and safety
  const modelThreshold = Math.min(costThreshold, safetyCeiling);

  // If user configured an override, use it but never exceed safety ceiling
  if (configOverride != null && configOverride > 0) {
    return Math.min(configOverride, safetyCeiling);
  }

  return modelThreshold;
}

// ── Token estimation ───────────────────────────────────────────

/**
 * Rough token count aware of CJK vs Latin text.
 *
 * Why not a simple char/4: BPE tokenizers encode CJK characters as 2-3 tokens
 * each, while Latin text averages ~4 chars per token. This project mixes
 * Chinese and English heavily, so uniform char/4 underestimates by ~2x for
 * Chinese-heavy prompts (which is most of ours).
 */
function estimateTokens(text: string): number {
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
