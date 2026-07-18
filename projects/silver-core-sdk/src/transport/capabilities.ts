/**
 * Provider capability degradation (BPT-EXTENSION, keeper memo 2026-07-18 §3).
 *
 * `provider.capabilities` is the host's structured declaration of what an
 * endpoint TRULY supports; this module applies it at the wire boundary. The
 * rules, in one place:
 *  - degradation happens only when a capability is EXPLICITLY declared
 *    unsupported — an omitted declaration keeps today's per-protocol wire
 *    bytes exactly (drop-in);
 *  - every applied degradation is reported through the debug sink (one line
 *    per request listing what was dropped/forced) — never silent;
 *  - this is a declaration seam, not a model profile: no probing, no
 *    per-model tables (that mechanism stays un-chartered per the memo).
 *
 * The anthropic transport calls degradeAnthropicRequestBody on its wire body;
 * the openai translator consults the same declaration inside
 * encodeOpenAIRequest (reasoning_effort suppression / parallel_tool_calls).
 * The `usage` dimension has no wire effect — the query layer surfaces it as
 * an informational message at startup (budget enforceability).
 */

import type { ProviderCapabilities } from '../types.js';
import type { StreamRequest } from '../internal/contracts.js';

type WireBody = Omit<StreamRequest, 'signal' | 'onRetry'>;

/** True when the declaration asks for cache_control markers to be stripped
 *  (the endpoint caches automatically or not at all). */
export function capsStripCacheControl(caps: ProviderCapabilities | undefined): boolean {
  return caps?.promptCaching === 'automatic' || caps?.promptCaching === 'none';
}

function withoutCacheControl<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => withoutCacheControl(v)) as unknown as T;
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (!('cache_control' in obj)) {
      // Blocks nest cache-bearing structures only one level down (content
      // arrays); recurse over object/array fields to catch them.
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        const next = typeof v === 'object' && v !== null ? withoutCacheControl(v) : v;
        if (next !== v) changed = true;
        out[k] = next;
      }
      return (changed ? out : value) as T;
    }
    const { cache_control: _dropped, ...rest } = obj;
    return withoutCacheControl(rest) as T;
  }
  return value;
}

/** Does any part of the body carry a cache_control marker? (cheap pre-check
 *  so the no-marker path stays allocation-free and byte-identical). */
function hasCacheControl(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((v) => hasCacheControl(v));
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if ('cache_control' in obj) return true;
    return Object.values(obj).some(
      (v) => typeof v === 'object' && v !== null && hasCacheControl(v),
    );
  }
  return false;
}

/**
 * Apply the capability declaration to an anthropic-wire request body.
 * Returns the SAME object when nothing applies (byte-identical fast path);
 * reports applied degradations as one debug line.
 */
export function degradeAnthropicRequestBody(
  body: WireBody,
  caps: ProviderCapabilities | undefined,
  debug?: (m: string) => void,
): WireBody {
  if (caps === undefined) return body;
  const applied: string[] = [];
  let out: WireBody = body;

  if (caps.thinking === false && out.thinking !== undefined) {
    const { thinking: _dropped, ...rest } = out;
    out = rest;
    applied.push('thinking dropped (capabilities.thinking: false)');
  }

  if (capsStripCacheControl(caps) && hasCacheControl(out)) {
    out = withoutCacheControl(out);
    applied.push(
      `cache_control markers stripped (capabilities.promptCaching: '${caps.promptCaching}')`,
    );
  }

  if (
    caps.parallelToolCalls === false &&
    out.tools !== undefined &&
    out.tools.length > 0
  ) {
    const choice = out.tool_choice;
    if (choice === undefined) {
      out = { ...out, tool_choice: { type: 'auto', disable_parallel_tool_use: true } };
      applied.push('disable_parallel_tool_use forced (capabilities.parallelToolCalls: false)');
    } else if (
      (choice.type === 'auto' || choice.type === 'any' || choice.type === 'tool') &&
      !('disable_parallel_tool_use' in choice && choice.disable_parallel_tool_use === true)
    ) {
      out = { ...out, tool_choice: { ...choice, disable_parallel_tool_use: true } };
      applied.push('disable_parallel_tool_use forced (capabilities.parallelToolCalls: false)');
    }
  }

  if (applied.length > 0) {
    debug?.(`transport: capability degradation — ${applied.join('; ')}`);
  }
  return out;
}
