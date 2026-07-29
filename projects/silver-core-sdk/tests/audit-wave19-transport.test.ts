/**
 * Audit wave 19 — wire-layer regressions (src/transport/*).
 *
 * Two defects, both reproduced against the real transports before the fix:
 *
 *  1. encodeOpenAIRequest drops a tool whose `input_schema` fails the
 *     wire-safety check (null / array / primitive). The drop is correct — it
 *     would 400 the gateway — but it was silent on every channel, and the
 *     only diagnostic the function emitted (the tool-name warning) is
 *     computed from the SURVIVORS, so a dropped entry could not appear in it.
 *  2. requestWithRetries classified an UNPARSEABLE endpoint (a baseUrl typo
 *     that forgets the scheme) as a retryable network error, so the whole
 *     retry budget and its backoff ladder were spent re-issuing a POST that
 *     never left the process.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenAIChatTransport, encodeOpenAIRequest } from '../src/transport/openai.js';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import { ConfigurationError } from '../src/errors.js';

const ENV = { BPT_HTTP_CLIENT: 'fetch' };
const noop = (): void => {};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. a tool dropped for a malformed input_schema must be reported
// ---------------------------------------------------------------------------

describe('wave19: a tool dropped for a malformed input_schema is reported', () => {
  it('warns (and names the tool) when input_schema is not a schema object', () => {
    const lines: string[] = [];
    const body = encodeOpenAIRequest(
      {
        model: 'm',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'Read', input_schema: null as never }],
      },
      {},
      (m) => lines.push(m),
    );
    // The drop itself is correct (it would 400 the gateway) — but it must not
    // be silent: before the fix `lines` was empty and `tools` simply vanished.
    expect(body.tools).toBeUndefined();
    const warn = lines.find((l) => l.includes('input_schema'));
    expect(warn).toBeDefined();
    expect(warn).toMatch(/Read/);
  });

  it('a server-declared typed entry (no input_schema) is still dropped silently', () => {
    const lines: string[] = [];
    encodeOpenAIRequest(
      {
        model: 'm',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ type: 'memory_20250818', name: 'memory' }],
      },
      {},
      (m) => lines.push(m),
    );
    expect(lines.filter((l) => l.includes('input_schema'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. an unparseable endpoint must not consume the retry budget
// ---------------------------------------------------------------------------

describe('wave19: a malformed baseUrl fails fast instead of burning the retry budget', () => {
  for (const arm of ['anthropic', 'openai'] as const) {
    it(`${arm} arm: one attempt, ConfigurationError`, async () => {
      const real = globalThis.fetch;
      const spy = vi.fn((input: string | URL, init?: RequestInit) =>
        real(input as string, init),
      );
      vi.stubGlobal('fetch', spy);
      // 'api.example.com/v1' has no scheme, so the composed endpoint is not a
      // URL at all — fetch rejects with ERR_INVALID_URL before any socket.
      const provider = { apiKey: 'k', baseUrl: 'api.example.com/v1', maxRetries: 2 };
      const transport =
        arm === 'anthropic'
          ? new AnthropicTransport({ provider, env: ENV, debug: noop })
          : new OpenAIChatTransport({ provider, env: ENV, debug: noop });

      let error: unknown;
      try {
        for await (const _ of transport.stream({
          model: 'm',
          max_tokens: 8,
          messages: [{ role: 'user', content: 'hi' }],
        })) {
          void _;
        }
      } catch (err) {
        error = err;
      }

      // Before the fix: 3 attempts (maxRetries 2 + 1) and an APIConnectionError
      // after ~2s of backoff; at the default maxRetries:10, 11 attempts.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toMatch(/Invalid endpoint URL/);
      expect((error as Error).message).toMatch(/provider\.baseUrl/);
    }, 30_000);
  }
});
