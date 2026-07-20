/**
 * Silver Core SDK - provider-transport factory.
 *
 * Single switch point for `ProviderConfig.protocol`: every place that builds
 * a transport (query, session manager, utility generators) goes through here
 * so protocol selection behaves identically across the SDK. Default stays the
 * direct Anthropic Messages API transport — existing consumers see zero
 * behavior change.
 */

import type { ProviderConfig } from '../types.js';
import type { Transport } from '../internal/contracts.js';
import { ConfigurationError } from '../errors.js';
import { AnthropicTransport } from './anthropic.js';
import { OpenAIChatTransport } from './openai.js';

export type ProviderTransportConfig = {
  provider?: ProviderConfig;
  env: Record<string, string | undefined>;
  debug: (m: string) => void;
  /** Beta flags for the `anthropic-beta` header; ignored on the OpenAI protocol. */
  betas?: string[];
};

export function createProviderTransport(cfg: ProviderTransportConfig): Transport {
  // Runtime-validate the protocol: the compile-time union is 'anthropic' |
  // 'openai-chat', but a JSON config or an `as` cast can smuggle a typo
  // through at runtime. audit r4 Y7-2: reject an unknown protocol loudly
  // instead of silently defaulting to the Anthropic wire — which then 400s
  // when the caller's endpoint/credentials belong to a non-Anthropic gateway.
  const protocol = cfg.provider?.protocol as string | undefined;
  if (protocol !== undefined && protocol !== 'anthropic' && protocol !== 'openai-chat') {
    throw new ConfigurationError(
      `createProviderTransport: unknown provider.protocol ${JSON.stringify(
        protocol,
      )} (expected 'anthropic' or 'openai-chat')`,
    );
  }
  if (protocol === 'openai-chat') {
    return new OpenAIChatTransport({
      provider: cfg.provider,
      env: cfg.env,
      debug: cfg.debug,
    });
  }
  return new AnthropicTransport({
    provider: cfg.provider,
    env: cfg.env,
    debug: cfg.debug,
    betas: cfg.betas,
  });
}
