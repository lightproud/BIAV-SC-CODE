/**
 * /loop interval-loop primitive (BPT-EXTENSION, src/prompt-loop.ts) —
 * parser grammar (the single source of truth hosts consume) and controller
 * scheduling semantics (immediate first run, fixed-delay, no overlap,
 * stop/abort/error policies).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPromptLoop,
  parseLoopCommand,
  ConfigurationError,
  DEFAULT_LOOP_INTERVAL_LABEL,
  DEFAULT_LOOP_INTERVAL_MS,
  LOOP_SLASH_COMMAND,
  MAX_LOOP_INTERVAL_MS,
  MIN_LOOP_INTERVAL_MS,
} from '../src/index.js';

function expectDirective(input: string) {
  const parsed = parseLoopCommand(input);
  expect(parsed).not.toBeNull();
  if (!parsed || !parsed.ok) throw new Error(`expected ok parse, got ${JSON.stringify(parsed)}`);
  return parsed.directive;
}

function expectInvalid(input: string): string {
  const parsed = parseLoopCommand(input);
  expect(parsed).not.toBeNull();
  if (!parsed || parsed.ok) throw new Error(`expected invalid parse, got ${JSON.stringify(parsed)}`);
  return parsed.error;
}

describe('parseLoopCommand', () => {
  it('returns null for anything that is not a /loop invocation', () => {
    expect(parseLoopCommand('hello')).toBeNull();
    expect(parseLoopCommand('/compact')).toBeNull();
    expect(parseLoopCommand('/loops every day')).toBeNull(); // no prefix confusion
    expect(parseLoopCommand('/Loop 10m x')).toBeNull(); // command names are case-sensitive
    expect(parseLoopCommand('say /loop 10m x')).toBeNull();
  });

  it('parses interval + prompt', () => {
    const d = expectDirective('/loop 10m 继续查bpt的bug');
    expect(d.intervalMs).toBe(600_000);
    expect(d.intervalLabel).toBe('10m');
    expect(d.explicitInterval).toBe(true);
    expect(d.prompt).toBe('继续查bpt的bug');
  });

  it('defaults to 10m when the interval is omitted', () => {
    const d = expectDirective('/loop check the deploy status');
    expect(d.intervalMs).toBe(DEFAULT_LOOP_INTERVAL_MS);
    expect(d.intervalLabel).toBe(DEFAULT_LOOP_INTERVAL_LABEL);
    expect(d.explicitInterval).toBe(false);
    expect(d.prompt).toBe('check the deploy status');
  });

  it('supports s/m/h with aliases and decimals', () => {
    expect(expectDirective('/loop 30s x').intervalMs).toBe(30_000);
    expect(expectDirective('/loop 45sec x').intervalMs).toBe(45_000);
    expect(expectDirective('/loop 45secs x').intervalMs).toBe(45_000);
    expect(expectDirective('/loop 5min x').intervalMs).toBe(300_000);
    expect(expectDirective('/loop 5mins x').intervalMs).toBe(300_000);
    expect(expectDirective('/loop 2h x').intervalMs).toBe(7_200_000);
    expect(expectDirective('/loop 1hr x').intervalMs).toBe(3_600_000);
    expect(expectDirective('/loop 2hrs x').intervalMs).toBe(7_200_000);
    expect(expectDirective('/loop 1.5m x').intervalMs).toBe(90_000);
    expect(expectDirective('/loop 10M x').intervalMs).toBe(600_000); // unit case-insensitive
  });

  it('keeps a slash-command task verbatim for host resubmission', () => {
    const d = expectDirective('/loop 5m /daily-news');
    expect(d.prompt).toBe('/daily-news');
  });

  it('preserves multiline prompts', () => {
    const d = expectDirective('/loop 10m first line\nsecond line');
    expect(d.prompt).toBe('first line\nsecond line');
    const noInterval = expectDirective('/loop first line\nsecond line');
    expect(noInterval.prompt).toBe('first line\nsecond line');
  });

  it('rejects /loop without a task, loudly', () => {
    expect(expectInvalid('/loop')).toMatch(/requires a prompt/);
    expect(expectInvalid('/loop 10m')).toMatch(/after the interval/);
    expect(expectInvalid('/loop   ')).toMatch(/requires a prompt/);
  });

  it('rejects a digit-leading first token that is not a valid interval (fail-closed)', () => {
    expect(expectInvalid('/loop 10x task')).toMatch(/not a valid interval/);
    expect(expectInvalid('/loop 10 task')).toMatch(/not a valid interval/);
  });

  it('rejects out-of-bounds intervals', () => {
    expect(expectInvalid('/loop 0s task')).toMatch(/at least 1s/);
    expect(expectInvalid('/loop 0.5s task')).toMatch(/at least 1s/);
    expect(expectInvalid('/loop 9999999h task')).toMatch(/at most/);
    expect(expectDirective('/loop 1s task').intervalMs).toBe(MIN_LOOP_INTERVAL_MS);
  });

  it('accepts the setTimeout ceiling boundary', () => {
    // 596h = 2_145_600_000 ms, just under 2^31-1.
    expect(expectDirective('/loop 596h task').intervalMs).toBeLessThanOrEqual(MAX_LOOP_INTERVAL_MS);
  });

  it('exports honest menu metadata without registering an engine built-in', async () => {
    expect(LOOP_SLASH_COMMAND.name).toBe('loop');
    expect(LOOP_SLASH_COMMAND.argumentHint).toContain('interval');
    const { BUILTIN_SLASH_COMMANDS } = await import('../src/engine/slash-commands.js');
    expect(BUILTIN_SLASH_COMMANDS.some((c) => c.name === 'loop')).toBe(false);
  });
});

describe('createPromptLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('validates options at construction (ConfigurationError per the layer whitelist)', () => {
    const run = vi.fn();
    expect(() => createPromptLoop({ prompt: '', run })).toThrow(ConfigurationError);
    expect(() => createPromptLoop({ prompt: 'x', run, intervalMs: MIN_LOOP_INTERVAL_MS - 1 })).toThrow(
      ConfigurationError,
    );
    expect(() => createPromptLoop({ prompt: 'x', run, intervalMs: 60_000.5 })).toThrow(
      ConfigurationError,
    );
    expect(() =>
      createPromptLoop({ prompt: 'x', run, intervalMs: MAX_LOOP_INTERVAL_MS + 1 }),
    ).toThrow(ConfigurationError);
    expect(() => createPromptLoop({ prompt: 'x', run, maxIterations: 0 })).toThrow(
      ConfigurationError,
    );
  });

  it('runs immediately on start, then on a fixed delay after each completion', async () => {
    const calls: Array<{ iteration: number; at: number }> = [];
    const loop = createPromptLoop({
      prompt: 'p',
      intervalMs: 60_000,
      run: async (prompt, iteration) => {
        expect(prompt).toBe('p');
        calls.push({ iteration, at: Date.now() });
        // Each run takes 10s: fixed-delay means period = 70s, not 60s.
        await new Promise((r) => setTimeout(r, 10_000));
      },
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((c) => c.iteration)).toEqual([1]);

    await vi.advanceTimersByTimeAsync(10_000 + 60_000);
    expect(calls.map((c) => c.iteration)).toEqual([1, 2]);
    expect(calls[1].at - calls[0].at).toBe(70_000);

    await vi.advanceTimersByTimeAsync(10_000 + 60_000);
    expect(loop.iterations).toBe(2);
    expect(calls).toHaveLength(3);
    loop.stop();
    await vi.runAllTimersAsync();
  });

  it('immediate: false waits one interval before the first run', async () => {
    const run = vi.fn();
    const loop = createPromptLoop({ prompt: 'p', run, intervalMs: 60_000, immediate: false });
    loop.start();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    loop.stop();
    await vi.runAllTimersAsync();
  });

  it('stops after maxIterations with the right summary', async () => {
    const run = vi.fn();
    const loop = createPromptLoop({ prompt: 'p', run, intervalMs: 60_000, maxIterations: 3 });
    loop.start();
    await vi.advanceTimersByTimeAsync(300_000);
    const summary = await loop.done;
    expect(run).toHaveBeenCalledTimes(3);
    expect(summary).toEqual({ iterations: 3, stopReason: 'max_iterations' });
    expect(loop.running).toBe(false);
  });

  it('stop() while idle resolves done without another run', async () => {
    const run = vi.fn();
    const loop = createPromptLoop({ prompt: 'p', run, intervalMs: 60_000 });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    loop.stop();
    loop.stop(); // idempotent
    const summary = await loop.done;
    expect(summary).toEqual({ iterations: 1, stopReason: 'stopped' });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('stop() during an in-flight run lets it settle, then stops', async () => {
    let settled = false;
    const loop = createPromptLoop({
      prompt: 'p',
      intervalMs: 60_000,
      run: async () => {
        await new Promise((r) => setTimeout(r, 5_000));
        settled = true;
      },
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    loop.stop();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    const summary = await loop.done;
    expect(settled).toBe(true);
    expect(summary).toEqual({ iterations: 1, stopReason: 'stopped' });
  });

  it('honors AbortSignal, including pre-aborted and mid-flight', async () => {
    const run = vi.fn();
    const pre = new AbortController();
    pre.abort();
    const dead = createPromptLoop({ prompt: 'p', run, signal: pre.signal });
    dead.start();
    expect((await dead.done).stopReason).toBe('aborted');
    expect(run).not.toHaveBeenCalled();

    const ctrl = new AbortController();
    const loop = createPromptLoop({
      prompt: 'p',
      intervalMs: 60_000,
      signal: ctrl.signal,
      run: () => new Promise((r) => setTimeout(r, 5_000)),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await loop.done).toEqual({ iterations: 1, stopReason: 'aborted' });
  });

  it('abort wins over a concurrent stop() while in flight', async () => {
    const ctrl = new AbortController();
    const loop = createPromptLoop({
      prompt: 'p',
      signal: ctrl.signal,
      run: () => new Promise((r) => setTimeout(r, 5_000)),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    ctrl.abort();
    loop.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await loop.done).stopReason).toBe('aborted');
  });

  it('defaults to stopping on error with the error in the summary', async () => {
    const boom = new Error('boom');
    const loop = createPromptLoop({
      prompt: 'p',
      intervalMs: 60_000,
      run: () => Promise.reject(boom),
    });
    loop.start();
    const summary = await loop.done;
    expect(summary.stopReason).toBe('error');
    expect(summary.error).toBe(boom);
    expect(summary.iterations).toBe(1);
  });

  it("onError: 'continue' keeps looping through failures", async () => {
    let attempts = 0;
    const loop = createPromptLoop({
      prompt: 'p',
      intervalMs: 60_000,
      onError: 'continue',
      maxIterations: 3,
      run: () => {
        attempts += 1;
        return Promise.reject(new Error(`fail ${attempts}`));
      },
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(attempts).toBe(3);
    expect((await loop.done).stopReason).toBe('max_iterations');
  });

  it('onError callback decides per error and sees the iteration index', async () => {
    const seen: Array<[string, number]> = [];
    const loop = createPromptLoop({
      prompt: 'p',
      intervalMs: 60_000,
      onError: (error, iteration) => {
        seen.push([(error as Error).message, iteration]);
        return iteration < 2 ? 'continue' : 'stop';
      },
      run: (_p, i) => Promise.reject(new Error(`fail ${i}`)),
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(300_000);
    const summary = await loop.done;
    expect(seen).toEqual([
      ['fail 1', 1],
      ['fail 2', 2],
    ]);
    expect(summary.stopReason).toBe('error');
    expect(summary.iterations).toBe(2);
  });

  it('start() is idempotent and a stopped loop cannot restart', async () => {
    const run = vi.fn();
    const loop = createPromptLoop({ prompt: 'p', run, intervalMs: 60_000 });
    loop.start();
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    loop.stop();
    await loop.done;
    loop.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(loop.running).toBe(false);
  });

  it('bridges a parsed directive end-to-end (the thin host wiring)', async () => {
    const parsed = parseLoopCommand('/loop 1m /daily-news');
    if (!parsed?.ok) throw new Error('parse failed');
    const submitted: string[] = [];
    const loop = createPromptLoop({
      prompt: parsed.directive.prompt,
      intervalMs: parsed.directive.intervalMs,
      maxIterations: 2,
      run: (prompt) => {
        submitted.push(prompt);
      },
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(submitted).toEqual(['/daily-news', '/daily-news']);
    expect((await loop.done).stopReason).toBe('max_iterations');
  });
});
