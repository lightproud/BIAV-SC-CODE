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
 *   - different protocol -> ONE memoized transport per protocol, built through
 *     the same `createProviderTransport()` switch point the root query uses.
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
 * Build the standard cross-protocol subagent transport resolver. Pass the
 * result as `Options.resolveSubagentTransport`.
 */
export function createSubagentTransportResolver(
  opts: SubagentTransportResolverOptions,
): SubagentTransportResolver {
  const cache = new Map<WireProtocol, Transport>();
  return (input) => {
    // Forks never switch (the runtime never consults the resolver for them;
    // this guard keeps the helper safe under direct calls too).
    if (input.fork) return undefined;
    const protocol = opts.protocolForModel(input.model);
    if (protocol === input.parentProtocol) return undefined;
    let transport = cache.get(protocol);
    if (transport === undefined) {
      transport = createProviderTransport({
        provider: buildChildProvider(
          protocol,
          input.parentProvider,
          opts.providers?.[protocol],
        ),
        env: input.env,
        debug: input.debug,
        ...(protocol === 'anthropic' && opts.betas !== undefined
          ? { betas: opts.betas }
          : {}),
      });
      cache.set(protocol, transport);
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
