/**
 * maxOutputTokens: protocol-aware default + boundary behavior (BPT ruling
 * 2026-07-14). The openai-chat default rises 8192 -> 128000 (agentic turns on
 * large-output gateway models were starved); the anthropic default stays 8192
 * (that API 400s a cap above the model's output ceiling and no per-model
 * table is bundled). provider.maxOutputTokens overrides either default.
 * Boundary: 128000 is sendable on the wire; a gateway whose model caps lower
 * rejects with a CLEAR surfaced APIStatusError (server message preserved,
 * no retry on 400).
 */

import { describe, expect, it, vi } from 'vitest';

import { buildEngineConfig } from '../src/engine/config-builder.js';
import { OpenAIChatTransport } from '../src/transport/openai.js';
import { APIStatusError } from '../src/errors.js';
import type { Options } from '../src/types.js';

const noop = (): void => {};

function engineConfigOf(options: Options) {
  return buildEngineConfig({
    options,
    cwd: '/tmp/proj',
    initialModel: 'claude-sonnet-4-5',
    builtinToolNames: ['Read', 'Grep'],
    debug: noop,
  }).engineConfig;
}

describe('maxOutputTokens protocol-aware default', () => {
  it('defaults to 8192 with no provider config (anthropic path unchanged)', () => {
    expect(engineConfigOf({}).maxOutputTokens).toBe(8192);
  });

  it("defaults to 8192 on protocol 'anthropic'", () => {
    expect(
      engineConfigOf({ provider: { protocol: 'anthropic' } }).maxOutputTokens,
    ).toBe(8192);
  });

  it("defaults to 128000 on protocol 'openai-chat'", () => {
    expect(
      engineConfigOf({ provider: { protocol: 'openai-chat' } }).maxOutputTokens,
    ).toBe(128_000);
  });

  it('provider.maxOutputTokens overrides the openai-chat default', () => {
    expect(
      engineConfigOf({
        provider: { protocol: 'openai-chat', maxOutputTokens: 4096 },
      }).maxOutputTokens,
    ).toBe(4096);
  });

  it('provider.maxOutputTokens overrides the anthropic default too (either direction)', () => {
    expect(
      engineConfigOf({
        provider: { protocol: 'anthropic', maxOutputTokens: 128_000 },
      }).maxOutputTokens,
    ).toBe(128_000);
  });
});

describe('maxOutputTokens wire boundary (openai-chat)', () => {
  it('sends max_tokens: 128000 on the wire (and renames via maxTokensParam)', async () => {
    const chunks = [
      {
        id: 'c1',
        model: 'big-model',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }],
      },
      {
        id: 'c1',
        model: 'big-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
    ];
    const sse =
      chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
    const injected = vi.fn(
      async () =>
        new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    const transport = new OpenAIChatTransport({
      provider: {
        protocol: 'openai-chat',
        apiKey: 'k',
        fetch: injected,
        openai: { maxTokensParam: 'max_completion_tokens' },
      },
      env: {},
      debug: noop,
    });
    for await (const _ of transport.stream({
      model: 'big-model',
      max_tokens: 128_000,
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      // drain
    }
    const body = JSON.parse(String(injected.mock.calls[0]![1]!.body)) as Record<
      string,
      unknown
    >;
    expect(body.max_completion_tokens).toBe(128_000);
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('surfaces a gateway over-limit rejection as a clear, non-retried APIStatusError', async () => {
    const gatewayMessage =
      'max_tokens is too large: 128000. This model supports at most 16384 completion tokens.';
    const injected = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: gatewayMessage, type: 'invalid_request_error', code: null },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
    );
    const transport = new OpenAIChatTransport({
      provider: { protocol: 'openai-chat', apiKey: 'k', fetch: injected },
      env: {},
      debug: noop,
    });
    let caught: unknown;
    try {
      for await (const _ of transport.stream({
        model: 'small-model',
        max_tokens: 128_000,
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        // drain
      }
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(APIStatusError);
    const err = caught as APIStatusError;
    expect(err.status).toBe(400);
    expect(err.errorType).toBe('invalid_request_error');
    // The gateway's own explanation must reach the caller verbatim — this is
    // the "clear error above the model/gateway ceiling" contract.
    expect(err.message).toContain('supports at most 16384');
    // 400 is not retryable: exactly one POST.
    expect(injected).toHaveBeenCalledTimes(1);
  });
});
