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
  if (cfg.provider?.protocol === 'openai-chat') {
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
