/**
 * Audit r4 (2026-07-17) — transport-misc cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - Y7-1: firePreconnect bounds its in-flight HEAD with an unref'd timeout
 *    so an unresponsive gateway can't pin a ref'd socket open (blocking
 *    graceful process exit); a responsive probe still completes + drains.
 *  - Y7-2: createProviderTransport rejects an unknown protocol string with a
 *    typed ConfigurationError instead of silently falling to the Anthropic
 *    wire (which then 400s against a non-Anthropic endpoint).
 *  - Sag-1: the subagent transport memo key carries behavior-tuning env
 *    (retries / stream caps / http-client), not just credentials — same
 *    credentials but a different CLAUDE_CODE_MAX_RETRIES no longer collide
 *    onto one memoized transport, while identical behavior env still memoizes.
 *
 * Skipped (see structured summary): Sag-2 (keying the memo on input.debug is
 * the only correct fix but breaks the M17 warm-pool memoization assertions in
 * two un-owned test files that pass distinct debug closures) and R7env-3
 * (proxy-env->'fetch' autodetect is a documented, test-locked design choice).
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeFetch, firePreconnect } from '../src/transport/node-http.js';
import { createProviderTransport } from '../src/transport/factory.js';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import { OpenAIChatTransport } from '../src/transport/openai.js';
import { ConfigurationError } from '../src/errors.js';
import { createSubagentTransportResolver } from '../src/subagents/transport-resolver.js';
import type { Transport } from '../src/internal/contracts.js';
import type {
  ProviderConfig,
  SubagentTransportHandle,
  SubagentTransportRequest,
} from '../src/types.js';
import { MockTransport } from './helpers/mock-transport.js';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Y7-1: preconnect probe has a bounded in-flight lifetime
// ---------------------------------------------------------------------------

describe('Y7-1: firePreconnect bounds its in-flight HEAD', () => {
  it('aborts a probe against a gateway that accepts the socket but never answers', async () => {
    let held: ServerResponse | undefined;
    const server = createServer((_req, res) => {
      held = res; // accept the connection, then never respond
    });
    const base = await listen(server);
    const logs: string[] = [];
    try {
      // Short bound so the test does not wait the 30s production default.
      firePreconnect(createNodeFetch(), base, (m) => logs.push(m), 60);
      await vi.waitFor(
        () => {
          expect(logs.some((l) => l.includes('preconnect failed'))).toBe(true);
        },
        { timeout: 2000 },
      );
      // The hung probe was aborted, not reported as a warm completion.
      expect(logs.some((l) => l.includes('preconnect completed'))).toBe(false);
    } finally {
      held?.destroy();
      await close(server);
    }
  });

  it('a responsive gateway still completes and drains (optimization intact)', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(405);
      res.end();
    });
    const base = await listen(server);
    const logs: string[] = [];
    try {
      firePreconnect(createNodeFetch(), base, (m) => logs.push(m));
      await vi.waitFor(() => {
        expect(logs.some((l) => l.includes('preconnect completed (HTTP 405)'))).toBe(true);
      });
      expect(logs.some((l) => l.includes('preconnect failed'))).toBe(false);
    } finally {
      await close(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Y7-2: unknown protocol is rejected, never silently routed to Anthropic
// ---------------------------------------------------------------------------

describe('Y7-2: createProviderTransport validates the protocol', () => {
  const base = { env: {} as Record<string, string | undefined>, debug: () => {} };
  const withProtocol = (protocol: string): ProviderConfig =>
    ({ protocol } as unknown as ProviderConfig);

  it('a typo protocol throws ConfigurationError instead of an Anthropic fallback', () => {
    for (const bogus of ['openai', 'anthropc', 'openai_chat', 'OpenAI-Chat']) {
      expect(() =>
        createProviderTransport({ ...base, provider: withProtocol(bogus) }),
      ).toThrow(ConfigurationError);
    }
  });

  it('the default (no provider) and explicit anthropic build the Anthropic transport', () => {
    expect(createProviderTransport({ ...base })).toBeInstanceOf(AnthropicTransport);
    expect(
      createProviderTransport({ ...base, provider: { protocol: 'anthropic' } }),
    ).toBeInstanceOf(AnthropicTransport);
  });

  it('openai-chat still builds the OpenAI transport', () => {
    expect(
      createProviderTransport({ ...base, provider: { protocol: 'openai-chat' } }),
    ).toBeInstanceOf(OpenAIChatTransport);
  });
});

// ---------------------------------------------------------------------------
// Sag-1: memo key carries behavior-tuning env, not just credentials
// ---------------------------------------------------------------------------

describe('Sag-1: subagent transport memo keys on behavior env', () => {
  const asHandle = (t: Transport): SubagentTransportHandle =>
    t as unknown as SubagentTransportHandle;
  // A STABLE debug sink across calls: this suite isolates the env dimension,
  // and debug is intentionally NOT part of the memo key (see Sag-2 skip).
  const debug = (): void => {};
  const request = (env: Record<string, string | undefined>): SubagentTransportRequest => ({
    model: 'bailian/deepseek-v4',
    purpose: 'subagent',
    parentModel: 'azure/gpt-parent',
    parentProtocol: 'openai-chat',
    parentTransport: asHandle(new MockTransport([])),
    parentProvider: { protocol: 'openai-chat' },
    env,
    fork: false,
    debug,
  });
  const routing = (m: string): 'anthropic' | 'openai-chat' =>
    m.startsWith('azure/') ? 'openai-chat' : 'anthropic';

  it('same credentials but different CLAUDE_CODE_MAX_RETRIES -> different transports', async () => {
    const resolve = createSubagentTransportResolver({ protocolForModel: routing });
    const a = await resolve(
      request({ ANTHROPIC_API_KEY: 'same-key', CLAUDE_CODE_MAX_RETRIES: '2' }),
    );
    const b = await resolve(
      request({ ANTHROPIC_API_KEY: 'same-key', CLAUDE_CODE_MAX_RETRIES: '9' }),
    );
    expect(a?.transport).toBeInstanceOf(AnthropicTransport);
    expect(b?.transport).not.toBe(a?.transport);
  });

  it('differing stream hard-cap / http-client env also split the memo', async () => {
    const resolve = createSubagentTransportResolver({ protocolForModel: routing });
    const a = await resolve(
      request({ ANTHROPIC_API_KEY: 'k', BPT_STREAM_MAX_DURATION_MS: '1000' }),
    );
    const b = await resolve(
      request({ ANTHROPIC_API_KEY: 'k', BPT_STREAM_MAX_DURATION_MS: '2000' }),
    );
    const c = await resolve(request({ ANTHROPIC_API_KEY: 'k', BPT_HTTP_CLIENT: 'fetch' }));
    const d = await resolve(request({ ANTHROPIC_API_KEY: 'k', BPT_HTTP_CLIENT: 'node' }));
    expect(b?.transport).not.toBe(a?.transport);
    expect(d?.transport).not.toBe(c?.transport);
  });

  it('identical behavior env still memoizes (warm-pool reuse preserved by value)', async () => {
    const resolve = createSubagentTransportResolver({ protocolForModel: routing });
    const env = { ANTHROPIC_API_KEY: 'same-key', CLAUDE_STREAM_IDLE_TIMEOUT_MS: '400000' };
    const a = await resolve(request(env));
    const b = await resolve(request({ ...env })); // fresh object, same contents
    expect(b?.transport).toBe(a?.transport);
  });
});
