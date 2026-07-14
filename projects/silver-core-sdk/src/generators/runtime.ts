/**
 * Shared runtime for the v0.6 "utility model call" product features.
 *
 * Every generator/classifier in this module is a SINGLE-SHOT Messages API call
 * with a faithful reproduced system prompt (see prompts.ts) — the same shape
 * the compaction summarizer (foldViaApi) already uses, factored out so each
 * feature is a thin wrapper: build a system+user pair, run it, parse the
 * output. Utility calls default to a cheap model (Haiku) via resolveModelAlias,
 * because these are mechanical single-turn classifications, not agentic work.
 *
 * The module is import-only (no side effects at import) and constructs its own
 * transport from public options so a caller can fire a utility call OUTSIDE a
 * live query() — e.g. BPT Desktop naming a session before the agent loop
 * starts, or the notification layer classifying a finished background run.
 * A transport can also be injected (opts.transport) for offline unit tests.
 */

import { AbortError } from '../errors.js';
import { createProviderTransport } from '../transport/factory.js';
import { MessageAccumulator } from '../engine/accumulator.js';
import { resolveModelAlias } from '../internal/model-alias.js';
import type { APIMessageParam, ProviderConfig } from '../types.js';
import type { StreamRequest, Transport } from '../internal/contracts.js';

/** Default cheap model alias for utility calls (mechanical single-turn work). */
export const DEFAULT_UTILITY_MODEL = 'claude-haiku-4-5';

/**
 * Public options for a utility model call. `provider` + `betas` mirror the main
 * `query()` Options so the same credentials/gateway apply; `model` overrides
 * the default cheap model (short aliases like `haiku`/`sonnet` are resolved).
 */
export interface UtilityCallOptions {
  /** Credential / base-URL / retry config, same shape as query() options. */
  provider?: ProviderConfig;
  /** Beta flags forwarded via the `anthropic-beta` header. */
  betas?: string[];
  /** Model override (alias or full id). Default: DEFAULT_UTILITY_MODEL. */
  model?: string;
  /** Max output tokens for the call. Sensible per-feature defaults apply. */
  maxTokens?: number;
  /** Cancellation. */
  signal?: AbortSignal;
  /** Debug logger; defaults to a no-op. */
  debug?: (msg: string) => void;
  /**
   * Injected transport (tests / advanced hosts). When set, provider/betas are
   * ignored and this transport drives the call — the seam that keeps every
   * generator unit-testable with zero network.
   */
  transport?: Transport;
  /**
   * Cross-protocol routing (v0.55.0): called with the RESOLVED utility model
   * to obtain the transport it should drive — the utility model (default
   * Haiku-tier) may be served on a different wire protocol than the session
   * provider. Loses to an explicit `transport`, wins over the provider-built
   * default. The query layer composes this from
   * Options.resolveSubagentTransport for its internal utility calls (hook
   * `condition` evaluation); hosts calling generators directly may pass their
   * own.
   */
  resolveTransport?: (model: string) => Transport | Promise<Transport>;
  /**
   * Environment for credential resolution when building the default transport.
   * Defaults to process.env. Ignored when `transport` is injected.
   */
  env?: Record<string, string | undefined>;
}

/**
 * audit 2026-07-14 L-4: memoized default transports for utility calls.
 *
 * Every utility call used to build a FRESH provider transport, which voided
 * the maxConcurrentRequests semaphore across calls (the gate is per-transport)
 * and fired one BPT_PRECONNECT probe per call. The default transport is now
 * cached per resolved provider-config identity: keyed by the provider object
 * reference (or, when no provider is given, the env object reference — both
 * are stable references at the call sites that repeat utility calls), with the
 * betas list as a secondary key since it changes the wire headers. WeakMap
 * keying means a dropped provider config releases its transport. The first
 * caller's debug sink is captured for the cached transport's lifetime — an
 * accepted trade for identity-stable memoization. Injected transports
 * (opts.transport) and the cross-protocol resolver keep priority and are
 * never cached here.
 */
const utilityTransportCache = new WeakMap<object, Map<string, Transport>>();

/** Resolve (or build) the transport a utility call will drive. */
export function resolveUtilityTransport(opts: UtilityCallOptions): Transport {
  if (opts.transport !== undefined) return opts.transport;
  const env = opts.env ?? process.env;
  const keyObj: object = opts.provider ?? env;
  const betasKey = (opts.betas ?? []).join(',');
  let byBetas = utilityTransportCache.get(keyObj);
  if (byBetas === undefined) {
    byBetas = new Map();
    utilityTransportCache.set(keyObj, byBetas);
  }
  const cached = byBetas.get(betasKey);
  if (cached !== undefined) return cached;
  const transport = createProviderTransport({
    provider: opts.provider,
    env,
    debug: opts.debug ?? (() => {}),
    betas: opts.betas,
  });
  byBetas.set(betasKey, transport);
  return transport;
}

/**
 * Run one utility model call and return the concatenated assistant TEXT.
 * `system` is the faithful prompt; `user` is the single user turn (the command,
 * transcript tail, session content, etc.). Non-text blocks are ignored.
 */
export async function runUtilityCall(
  system: string,
  user: string | APIMessageParam[],
  opts: UtilityCallOptions,
  maxTokensDefault: number,
): Promise<string> {
  const model = resolveModelAlias(opts.model ?? DEFAULT_UTILITY_MODEL, DEFAULT_UTILITY_MODEL);
  // Transport precedence: explicit injection (tests) > cross-protocol
  // resolver keyed by the resolved model (v0.55.0) > provider-built default.
  const transport =
    opts.transport ??
    (opts.resolveTransport !== undefined
      ? await opts.resolveTransport(model)
      : resolveUtilityTransport(opts));
  const messages: APIMessageParam[] =
    typeof user === 'string' ? [{ role: 'user', content: user }] : user;
  const req: StreamRequest = {
    model,
    max_tokens: opts.maxTokens ?? maxTokensDefault,
    system,
    messages,
    // Deterministic classification/extraction: pin temperature to 0 so the
    // same input maps to the same label/prefix run-to-run.
    temperature: 0,
    signal: opts.signal,
  };
  const acc = new MessageAccumulator();
  for await (const ev of transport.stream(req)) {
    // Fail LOUD on abort: a mid-stream cancellation must reject, never return
    // the partial text accumulated so far. Silently returning a truncated reply
    // would let a security-sensitive classifier (detectCommandPrefix) hand back
    // a fragment that parses as a benign prefix instead of an injection verdict.
    if (opts.signal?.aborted) throw new AbortError();
    acc.feed(ev);
  }
  const final = acc.finalize();
  return final.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/**
 * Extract the first balanced JSON object from a model reply, tolerating code
 * fences and surrounding prose. Utility prompts ask for bare JSON, but models
 * occasionally wrap it — this makes parsing robust without being lenient about
 * structure (it returns the FIRST top-level object only). Returns null when no
 * balanced object is present.
 */
export function extractJsonObject(text: string): unknown {
  // Fast path: the whole reply is already JSON.
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  // Scan for the first balanced { … } that PARSES, honoring string literals so
  // a brace inside a quoted value never miscounts. A balanced group that fails
  // to parse (e.g. a `{placeholder}` in prose before the real JSON) does NOT
  // abort the search — we resume from the next `{`. This never executes input;
  // it only slices a substring and hands it to JSON.parse.
  let searchFrom = trimmed.indexOf('{');
  while (searchFrom >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = searchFrom; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const parsed = tryParse(trimmed.slice(searchFrom, i + 1));
          if (parsed !== undefined) return parsed;
          break; // balanced but unparseable -> try the next '{' (audit 2026-07-14 L-9c)
        }
      }
    }
    // Whether the group closed-but-failed or never balanced, advance to the
    // next candidate '{' after the current start.
    searchFrom = trimmed.indexOf('{', searchFrom + 1);
  }
  return null;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
