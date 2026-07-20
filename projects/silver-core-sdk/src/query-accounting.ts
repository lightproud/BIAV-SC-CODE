/**
 * Session-level usage/cost accounting for query() (extracted from query.ts,
 * audit 2026-07-10 P2-3A).
 *
 * One instance per query run. Pure arithmetic over engine-turn results and
 * drained subagent ledgers — no I/O, no stream awareness — which is exactly
 * why it lives outside the 2000-line run() orchestration: the fold rules
 * (additive counters vs latest-wins static figures) are unit-testable on
 * their own, and the previous inline version had grown two near-identical
 * copies of the ModelUsage merge (now one).
 */

import type { ModelUsage, NonNullableUsage, SDKResultMessage } from './types.js';
import type { AbortedRunAccounting } from './errors.js';

/** Coerce a non-finite counter (a NaN/±Infinity total_cost_usd from a
 *  malformed result or a provider arithmetic glitch) to 0. A single NaN cost
 *  otherwise poisoned `acct.cost` permanently, and `NaN >= maxBudgetUsd` is
 *  always false — the budget gate went silently dark for the whole session,
 *  spending without a ceiling (audit r4 Sls-1). */
function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function zeroUsage(): NonNullableUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    web_search_requests: 0,
  };
}

function addUsage(a: NonNullableUsage, b: NonNullableUsage): NonNullableUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens:
      a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
    // Carry the server-tool web-search count through the fold too: dropping it
    // here kept SessionAccounting.usage.web_search_requests permanently 0,
    // diverging from pricing.ts and modelUsage.webSearchRequests, which do
    // count it (latent — query.ts reads modelUsage today, not this flat field;
    // audit 2026-07-17 T4).
    web_search_requests: (a.web_search_requests ?? 0) + (b.web_search_requests ?? 0),
  };
}

/** Fold `mu` into `target[modelId]`: token/cost counters add; static
 *  per-model figures (contextWindow / maxOutputTokens) are latest-wins with
 *  fallback to the earlier value (e.g. a subagent-ledger merge lacks them). */
function mergeModelUsage(
  target: Record<string, ModelUsage>,
  modelId: string,
  mu: ModelUsage,
): void {
  const prev = target[modelId];
  target[modelId] =
    prev === undefined
      ? { ...mu }
      : {
          inputTokens: prev.inputTokens + mu.inputTokens,
          outputTokens: prev.outputTokens + mu.outputTokens,
          cacheReadInputTokens: prev.cacheReadInputTokens + mu.cacheReadInputTokens,
          cacheCreationInputTokens:
            prev.cacheCreationInputTokens + mu.cacheCreationInputTokens,
          webSearchRequests: prev.webSearchRequests + mu.webSearchRequests,
          costUSD: prev.costUSD + mu.costUSD,
          contextWindow: mu.contextWindow ?? prev.contextWindow,
          maxOutputTokens: mu.maxOutputTokens ?? prev.maxOutputTokens,
        };
}

export class SessionAccounting {
  turns = 0;
  cost = 0;
  apiMs = 0;
  usage: NonNullableUsage = zeroUsage();
  readonly modelUsage: Record<string, ModelUsage> = {};

  /** Fold one engine-turn result's totals into the session accumulators. */
  accumulateResult(r: SDKResultMessage): void {
    // audit r4 Sls-1: finiteness guard so a NaN/Infinity counter can't poison
    // the session totals (the budget gate reads acct.cost).
    this.turns += finite(r.num_turns);
    this.cost += finite(r.total_cost_usd);
    this.apiMs += finite(r.duration_api_ms);
    this.usage = addUsage(this.usage, r.usage);
    for (const [modelId, mu] of Object.entries(r.modelUsage)) {
      mergeModelUsage(this.modelUsage, modelId, mu);
    }
  }

  /**
   * audit 2026-07-14 L-6: fold an ABORTED run's partial accounting (attached
   * to the AbortError by the engine loop) into the session totals. An aborted
   * run emits no result message, so without this fold the usage it already
   * billed — message_start input tokens, completed intermediate turns — would
   * under-count the session budget/summary.
   */
  accumulateAborted(p: AbortedRunAccounting): void {
    // audit r4 Sls-1: same finiteness guard as accumulateResult.
    this.turns += finite(p.numTurns);
    this.cost += finite(p.totalCostUsd);
    this.apiMs += finite(p.durationApiMs);
    this.usage = addUsage(this.usage, p.usage);
    for (const [modelId, mu] of Object.entries(p.modelUsage)) {
      mergeModelUsage(this.modelUsage, modelId, mu);
    }
  }

  /** Fold drained subagent usage/cost/modelUsage into the session totals. */
  foldSubagentUsage(ledger: {
    usage: NonNullableUsage;
    cost: number;
    modelUsage: Record<string, ModelUsage>;
  }): void {
    // audit r4 Sls-1: guard the subagent-ledger cost fold too — it feeds the
    // same acct.cost the budget gate reads.
    this.cost += finite(ledger.cost);
    this.usage = addUsage(this.usage, ledger.usage);
    for (const [modelId, mu] of Object.entries(ledger.modelUsage)) {
      mergeModelUsage(this.modelUsage, modelId, mu);
    }
  }

  /** Deep-copied modelUsage snapshot for a result/summary payload. */
  snapshotModelUsage(): Record<string, ModelUsage> {
    return Object.fromEntries(
      Object.entries(this.modelUsage).map(([k, v]) => [k, { ...v }]),
    );
  }
}
