/**
 * T2-6 transport resilience defaults, aligned to the official reference:
 * maxRetries default 10 (env CLAUDE_CODE_MAX_RETRIES capped at 15), stream
 * idle watchdog default 300000ms (env CLAUDE_STREAM_IDLE_TIMEOUT_MS clamped
 * to that minimum, CLAUDE_ENABLE_STREAM_WATCHDOG=0 disables), and the
 * background-subagent stall watchdog (CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS,
 * default 600000). Explicit provider options keep their uncapped/unclamped
 * override semantics.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AnthropicTransport,
  DEFAULT_MAX_RETRIES,
  DEFAULT_STREAM_IDLE_MS,
  resolveMaxRetries,
  resolveStreamIdleMs,
} from '../src/transport/anthropic.js';
import {
  DEFAULT_ASYNC_AGENT_STALL_TIMEOUT_MS,
  StallWatchdog,
  resolveStallTimeoutMs,
} from '../src/transport/stall-watchdog.js';
import { APIStatusError } from '../src/errors.js';
import type { StreamRequest } from '../src/internal/contracts.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('resilience defaults (official values)', () => {
  it('maxRetries defaults to 10 and the stream idle watchdog to 300000ms', () => {
    expect(DEFAULT_MAX_RETRIES).toBe(10);
    expect(DEFAULT_STREAM_IDLE_MS).toBe(300_000);
    expect(resolveMaxRetries({}, {})).toBe(10);
    expect(resolveStreamIdleMs({}, {})).toBe(300_000);
  });

  it('stall watchdog defaults to 600000ms', () => {
    expect(DEFAULT_ASYNC_AGENT_STALL_TIMEOUT_MS).toBe(600_000);
    expect(resolveStallTimeoutMs({})).toBe(600_000);
  });
});

describe('resolveMaxRetries', () => {
  it('provider.maxRetries wins and is NOT capped (explicit override semantics)', () => {
    expect(resolveMaxRetries({ maxRetries: 99 }, { CLAUDE_CODE_MAX_RETRIES: '3' })).toBe(99);
    expect(resolveMaxRetries({ maxRetries: 0 }, {})).toBe(0);
  });

  it('CLAUDE_CODE_MAX_RETRIES is honored and capped at 15 (official)', () => {
    expect(resolveMaxRetries({}, { CLAUDE_CODE_MAX_RETRIES: '2' })).toBe(2);
    expect(resolveMaxRetries({}, { CLAUDE_CODE_MAX_RETRIES: '15' })).toBe(15);
    expect(resolveMaxRetries({}, { CLAUDE_CODE_MAX_RETRIES: '99' })).toBe(15);
  });

  it('an unparseable env value falls back to the default', () => {
    expect(resolveMaxRetries({}, { CLAUDE_CODE_MAX_RETRIES: 'lots' })).toBe(10);
    expect(resolveMaxRetries({}, { CLAUDE_CODE_MAX_RETRIES: '-1' })).toBe(10);
    expect(resolveMaxRetries({}, { CLAUDE_CODE_MAX_RETRIES: '' })).toBe(10);
  });
});

describe('resolveStreamIdleMs', () => {
  it('provider.streamIdleTimeoutMs wins, unclamped, and 0 disables', () => {
    expect(resolveStreamIdleMs({ streamIdleTimeoutMs: 30 }, {})).toBe(30);
    expect(
      resolveStreamIdleMs({ streamIdleTimeoutMs: 30 }, { CLAUDE_STREAM_IDLE_TIMEOUT_MS: '900000' }),
    ).toBe(30);
    expect(resolveStreamIdleMs({ streamIdleTimeoutMs: 0 }, {})).toBe(0);
  });

  it('CLAUDE_ENABLE_STREAM_WATCHDOG=0 disables the watchdog (official off switch)', () => {
    expect(resolveStreamIdleMs({}, { CLAUDE_ENABLE_STREAM_WATCHDOG: '0' })).toBe(0);
  });

  it('CLAUDE_STREAM_IDLE_TIMEOUT_MS is clamped to the official 300000 minimum', () => {
    expect(resolveStreamIdleMs({}, { CLAUDE_STREAM_IDLE_TIMEOUT_MS: '600000' })).toBe(600_000);
    expect(resolveStreamIdleMs({}, { CLAUDE_STREAM_IDLE_TIMEOUT_MS: '1000' })).toBe(300_000);
    expect(resolveStreamIdleMs({}, { CLAUDE_STREAM_IDLE_TIMEOUT_MS: '0' })).toBe(300_000);
  });
});

describe('transport uses the env-resolved retry budget', () => {
  function rateLimited(): Response {
    return new Response(
      JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'nope' } }),
      { status: 429, headers: { 'retry-after': '0' } },
    );
  }

  function baseReq(): StreamRequest {
    return { model: 'claude-test-1', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] };
  }

  async function exhaust(t: AnthropicTransport): Promise<unknown> {
    try {
      for await (const ev of t.stream(baseReq())) void ev;
    } catch (err) {
      return err;
    }
    throw new Error('expected the stream to reject');
  }

  it('CLAUDE_CODE_MAX_RETRIES=1 -> exactly 2 attempts on persistent 429', async () => {
    const fetchMock = vi.fn(async () => rateLimited());
    vi.stubGlobal('fetch', fetchMock);
    const t = new AnthropicTransport({
      provider: { apiKey: 'k' },
      env: { CLAUDE_CODE_MAX_RETRIES: '1', BPT_HTTP_CLIENT: 'fetch' },
      debug: () => undefined,
    });
    const err = await exhaust(t);
    expect(err).toBeInstanceOf(APIStatusError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('provider.maxRetries=0 beats the env override (no retry)', async () => {
    const fetchMock = vi.fn(async () => rateLimited());
    vi.stubGlobal('fetch', fetchMock);
    const t = new AnthropicTransport({
      provider: { apiKey: 'k', maxRetries: 0 },
      env: { CLAUDE_CODE_MAX_RETRIES: '5', BPT_HTTP_CLIENT: 'fetch' },
      debug: () => undefined,
    });
    const err = await exhaust(t);
    expect(err).toBeInstanceOf(APIStatusError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('StallWatchdog', () => {
  it('fires onStall after the timeout with no touch', () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const dog = new StallWatchdog({ timeoutMs: 1_000, onStall });
    vi.advanceTimersByTime(999);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(dog.stalled).toBe(true);
  });

  it('touch() resets the silence timer (stream events keep it alive)', () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const dog = new StallWatchdog({ timeoutMs: 1_000, onStall });
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(900);
      dog.touch();
    }
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onStall).toHaveBeenCalledTimes(1);
    dog.dispose();
  });

  it('dispose() cancels the watchdog and it never fires', () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const dog = new StallWatchdog({ timeoutMs: 1_000, onStall });
    dog.dispose();
    vi.advanceTimersByTime(10_000);
    expect(onStall).not.toHaveBeenCalled();
    expect(dog.stalled).toBe(false);
  });

  it('timeoutMs 0 constructs a disabled watchdog', () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const dog = new StallWatchdog({ timeoutMs: 0, onStall });
    vi.advanceTimersByTime(3_600_000);
    dog.touch();
    vi.advanceTimersByTime(3_600_000);
    expect(onStall).not.toHaveBeenCalled();
    expect(dog.stalled).toBe(false);
  });

  it('resolveStallTimeoutMs honors the env override (0 disables) and rejects junk', () => {
    expect(resolveStallTimeoutMs({ CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '120000' })).toBe(120_000);
    expect(resolveStallTimeoutMs({ CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '0' })).toBe(0);
    expect(resolveStallTimeoutMs({ CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: 'never' })).toBe(600_000);
    expect(resolveStallTimeoutMs({ CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '-5' })).toBe(600_000);
  });
});
