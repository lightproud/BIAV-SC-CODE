/**
 * Silver Core SDK - standard resolveSubagentTransport implementation
 * (cross-protocol subagent routing, 2026-07-13).
 *
 * The SDK cannot know which wire protocol serves an arbitrary model id — that
 * routing table is gateway-specific host knowledge. This factory turns the
 * host's one-line policy (`protocolForModel`) into a full resolver:
 *
 *   - same protocol as the parent -> `undefined` (share the parent transport;
 *     byte-for-byte the no-option behavior),
 *   - different protocol -> ONE memoized transport per TENANT IDENTITY
 *     (protocol + derived provider config + credential/endpoint env chain +
 *     function-knob identity; M17, audit T49 — protocol-only memoization let
 *     a resolver shared across differently-credentialed queries hand tenant
 *     B's subagents tenant A's API key), built through the same
 *     `createProviderTransport()` switch point the root query uses.
 *
 * Provider derivation is deliberately NOT a blind copy of the parent config:
 * the two protocols append different URL suffixes (`/v1/messages` vs
 * `/chat/completions`) and resolve credentials from different env chains
 * (`ANTHROPIC_*` vs `OPENAI_*`), so protocol-specific fields (baseUrl,
 * credentials, apiVersion, defaultHeaders, openai.*) only come from the
 * host's explicit per-protocol config or the standard env fallback — never
 * from the parent. Protocol-agnostic knobs (retries, timeouts, fetch,
 * httpClient, preconnect, pricing) do carry over.
 *
 * Lifecycle: memoized transports are resolver-owned (`owned: false` on every
 * resolution) and live as long as the resolver instance; the built-in
 * transports self-clean (unref'd keep-alive sockets with a bounded idle TTL),
 * so sharing one resolver across queries is safe and keeps the warm pools.
 */

import type {
  ProviderConfig,
  SubagentTransportHandle,
  SubagentTransportResolver,
} from '../types.js';
import type { Transport } from '../internal/contracts.js';
import { createProviderTransport } from '../transport/factory.js';

type WireProtocol = 'anthropic' | 'openai-chat';

export type SubagentTransportResolverOptions = {
  /**
   * The host's model->protocol routing table (e.g.
   * `(m) => m.startsWith('azure/') ? 'openai-chat' : 'anthropic'`). Called
   * with the fully resolved child model id.
   */
  protocolForModel: (model: string) => WireProtocol;
  /**
   * Explicit per-protocol provider configs for child transports. A protocol
   * without an entry builds from the parent's protocol-agnostic knobs plus
   * the standard env fallback chain for that protocol.
   */
  providers?: Partial<Record<WireProtocol, ProviderConfig>>;
  /** Beta header flags for a child ANTHROPIC transport (ignored on the
   *  OpenAI protocol, same as the root query). */
  betas?: string[];
};

/** Provider knobs safe to carry across a protocol switch. */
const PROTOCOL_AGNOSTIC_KEYS = [
  'maxRetries',
  'timeoutMs',
  'streamIdleTimeoutMs',
  'streamMaxDurationMs',
  'maxConcurrentRequests',
  'fetch',
  'httpClient',
  'preconnect',
  'pricing',
] as const;

function buildChildProvider(
  protocol: WireProtocol,
  parent: ProviderConfig | undefined,
  explicit: ProviderConfig | undefined,
): ProviderConfig {
  const base: ProviderConfig = { ...(explicit ?? {}) };
  for (const key of PROTOCOL_AGNOSTIC_KEYS) {
    if (base[key] === undefined && parent?.[key] !== undefined) {
      (base as Record<string, unknown>)[key] = parent[key];
    }
  }
  base.protocol = protocol;
  return base;
}

/**
 * Env vars a child transport of the given protocol resolves its credential /
 * endpoint from (M17: these are part of the transport's TENANT IDENTITY).
 * Mirrors the resolution chains in transport/anthropic.ts (resolveCredential,
 * baseUrl) and transport/openai.ts (resolveOpenAICredential, baseUrl).
 */
const IDENTITY_ENV_KEYS: Record<WireProtocol, readonly string[]> = {
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'],
  'openai-chat': ['OPENAI_API_KEY', 'OPENAI_BASE_URL'],
};

/**
 * M17 (audit T49) — memo key carrying the transport's full tenant identity,
 * not just its protocol. The previous cache was keyed by protocol alone, so a
 * resolver shared across queries (the documented usage) handed tenant B's
 * subagents the transport built with tenant A's credentials/endpoint —
 * cross-tenant credential mixing. The key covers everything that feeds the
 * transport's identity: the derived child provider's serializable config
 * (credentials, baseUrl, apiVersion, headers, openai.*), the per-protocol
 * credential/endpoint env chain, and the identity of any function-valued
 * knobs (fetch/httpClient) carried over from the parent. The key stays
 * in-process only (never logged) — it holds the same secrets the transport
 * itself holds in memory.
 */
function transportIdentityKey(
  protocol: WireProtocol,
  child: ProviderConfig,
  env: Record<string, string | undefined>,
  fnIdentity: (fn: unknown) => string,
): string {
  const cfg: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(child)) {
    cfg[k] = typeof v === 'function' ? fnIdentity(v) : v;
  }
  const envSlice: Record<string, string | undefined> = {};
  for (const k of IDENTITY_ENV_KEYS[protocol]) envSlice[k] = env[k];
  return JSON.stringify([protocol, cfg, envSlice]);
}

/**
 * Build the standard cross-protocol subagent transport resolver. Pass the
 * result as `Options.resolveSubagentTransport`.
 */
export function createSubagentTransportResolver(
  opts: SubagentTransportResolverOptions,
): SubagentTransportResolver {
  const cache = new Map<string, Transport>();
  // Stable per-resolver identity for function-valued provider knobs: two
  // different fetch/httpClient implementations must never collapse onto one
  // cached transport, while the same function object always maps to one id.
  const fnIds = new WeakMap<object, number>();
  let nextFnId = 0;
  const fnIdentity = (fn: unknown): string => {
    const key = fn as object;
    let id = fnIds.get(key);
    if (id === undefined) {
      id = nextFnId++;
      fnIds.set(key, id);
    }
    return `fn#${id}`;
  };
  return (input) => {
    // Forks never switch (the runtime never consults the resolver for them;
    // this guard keeps the helper safe under direct calls too).
    if (input.fork) return undefined;
    const protocol = opts.protocolForModel(input.model);
    if (protocol === input.parentProtocol) return undefined;
    const child = buildChildProvider(
      protocol,
      input.parentProvider,
      opts.providers?.[protocol],
    );
    const cacheKey = transportIdentityKey(protocol, child, input.env, fnIdentity);
    let transport = cache.get(cacheKey);
    if (transport === undefined) {
      transport = createProviderTransport({
        provider: child,
        env: input.env,
        debug: input.debug,
        ...(protocol === 'anthropic' && opts.betas !== undefined
          ? { betas: opts.betas }
          : {}),
      });
      cache.set(cacheKey, transport);
    }
    return {
      transport: transport as SubagentTransportHandle,
      // Memoized across spawns: the resolver owns the instance; the built-in
      // transports self-clean, so no teardown bookkeeping is required.
      owned: false,
      protocol,
    };
  };
}
