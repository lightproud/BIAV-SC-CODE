/**
 * AgentExecutor (campaign 7, design round 3 rulings 裁2 / D2 / D6): the
 * injected assembly part. Everything here runs against a FAKE query handle —
 * the injection seam is the point (no agent SDK import anywhere in src or in
 * this test), and vitest fake timers drive the interrupt grace window.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createAgentExecutor,
  extractGoalRound,
  extractPlainAgent,
  extractWorkflowNode,
  type AgentQueryFn,
  type AgentQueryHandle,
  type AgentRunResult,
} from '../src/assembly/agent-executor.js';
import type { ExecutorContext } from '../src/driver.js';
import type { SessionRecord } from '../src/ledger/types.js';

const T0 = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

const session = (payload: unknown, id = 'job-1'): SessionRecord => ({
  id,
  intent: 'run-agent',
  payload,
  state: 'running',
  attempts: 1,
  maxAttempts: 3,
  createdAt: T0,
  updatedAt: T0,
  nextRunAt: null,
});

const ctx = (signal?: AbortSignal): ExecutorContext => ({
  attempt: 1,
  signal: signal ?? new AbortController().signal,
});

/** A finished handle: yields the given messages, records interrupt/close. */
function fakeHandle(messages: unknown[]): AgentQueryHandle & {
  interrupts: number;
  closes: number;
} {
  const state = { interrupts: 0, closes: 0 };
  return {
    get interrupts() {
      return state.interrupts;
    },
    get closes() {
      return state.closes;
    },
    async interrupt() {
      state.interrupts += 1;
      return {};
    },
    close() {
      state.closes += 1;
    },
    async *[Symbol.asyncIterator]() {
      yield* messages;
    },
  };
}

/** A hanging handle: yields `head`, then blocks until interrupt or close. */
function hangingHandle(head: unknown[]): AgentQueryHandle & {
  interrupts: number;
  closes: number;
  interruptEnds: boolean;
} {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { interrupts: 0, closes: 0, interruptEnds: true };
  return {
    get interrupts() {
      return state.interrupts;
    },
    get closes() {
      return state.closes;
    },
    set interruptEnds(v: boolean) {
      state.interruptEnds = v;
    },
    get interruptEnds() {
      return state.interruptEnds;
    },
    async interrupt() {
      state.interrupts += 1;
      if (state.interruptEnds) release?.();
      return {};
    },
    close() {
      state.closes += 1;
      release?.();
    },
    async *[Symbol.asyncIterator]() {
      yield* head;
      await gate;
    },
  };
}

const okResult = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'result',
  subtype: 'success',
  result: 'all done',
  total_cost_usd: 0.1234,
  session_id: 'agent-sess-1',
  ...over,
});

describe('createAgentExecutor construction', () => {
  it('rejects a non-function query and a non-positive grace window', () => {
    expect(() => createAgentExecutor({ query: 1 as unknown as AgentQueryFn })).toThrow(TypeError);
    const query: AgentQueryFn = () => fakeHandle([]);
    expect(() => createAgentExecutor({ query, interruptGraceMs: 0 })).toThrow(RangeError);
    expect(() => createAgentExecutor({ query, interruptGraceMs: Number.NaN })).toThrow(RangeError);
  });
});

describe('payload extraction (fail-loud, never silent)', () => {
  it('reads payload.agent by default and passes prompt/options through', async () => {
    const calls: { prompt: string; options?: Record<string, unknown> }[] = [];
    const executor = createAgentExecutor({
      query: (args) => {
        calls.push(args);
        return fakeHandle([okResult()]);
      },
    });
    const result = await executor(
      session({ agent: { prompt: 'do it', options: { model: 'claude-x' } } }),
      ctx(),
    );
    expect(result.outcome).toBe('ok');
    expect(calls).toEqual([{ prompt: 'do it', options: { model: 'claude-x' } }]);
  });

  it('falls back to the Scheduler envelope payload.data.agent', async () => {
    const calls: unknown[] = [];
    const executor = createAgentExecutor({
      query: (args) => {
        calls.push(args.prompt);
        return fakeHandle([okResult()]);
      },
    });
    const result = await executor(
      session({ schedule: { specId: 'r', fireAt: T0 }, data: { agent: { prompt: 'from spec' } } }),
      ctx(),
    );
    expect(result.outcome).toBe('ok');
    expect(calls).toEqual(['from spec']);
  });

  it('settles a payload without a run request as a LOUD error, query never called', async () => {
    let called = 0;
    const executor = createAgentExecutor({
      query: () => {
        called += 1;
        return fakeHandle([okResult()]);
      },
    });
    for (const bad of [
      undefined,
      null,
      'text',
      {},
      { agent: {} },
      { agent: { prompt: '' } },
      { agent: { prompt: 'p', maxBudgetUsd: -1 } },
      { agent: { prompt: 'p', resume: '' } },
      { agent: { prompt: 'p', options: [] } },
    ]) {
      const result = await executor(session(bad), ctx());
      expect(result.outcome).toBe('error');
      expect(result.error).toMatch(/carries no agent run request/);
    }
    expect(called).toBe(0);
  });

  it('merges resume and maxBudgetUsd into options (later wins on collision)', async () => {
    const calls: Record<string, unknown>[] = [];
    const executor = createAgentExecutor({
      query: (args) => {
        calls.push(args.options ?? {});
        return fakeHandle([okResult()]);
      },
    });
    await executor(
      session({
        agent: {
          prompt: 'p',
          options: { model: 'claude-x', resume: 'stale', maxBudgetUsd: 9 },
          resume: 'fresh-id',
          maxBudgetUsd: 0.5,
        },
      }),
      ctx(),
    );
    expect(calls[0]).toEqual({ model: 'claude-x', resume: 'fresh-id', maxBudgetUsd: 0.5 });
  });
});

describe('message folding', () => {
  it('folds a success result: ok outcome, capped summary with cost tail, costUsd forwarded', async () => {
    const results: AgentRunResult[] = [];
    const executor = createAgentExecutor({
      query: () => fakeHandle([{ type: 'assistant' }, okResult({ result: 'x'.repeat(3000) })]),
      onResult: (_s, r) => results.push(r),
    });
    const result = await executor(session({ agent: { prompt: 'p' } }), ctx());
    expect(result.outcome).toBe('ok');
    expect(result.costUsd).toBe(0.1234);
    expect(result.summary).toContain('[cost $0.1234]');
    expect(result.summary!.length).toBeLessThan(2_100);
    expect(results).toHaveLength(1);
    expect(results[0]!.agentSessionId).toBe('agent-sess-1');
    expect(results[0]!.raw).toMatchObject({ type: 'result', subtype: 'success' });
  });

  it('folds a non-success result: error with subtype, machine code and provider bits', async () => {
    const executor = createAgentExecutor({
      query: () =>
        fakeHandle([
          okResult({
            subtype: 'error_max_turns',
            result: undefined,
            error_code: 'MAX_TURNS',
            providerError: { code: 'overloaded', status: 529, message: 'later' },
          }),
        ]),
    });
    const result = await executor(session({ agent: { prompt: 'p' } }), ctx());
    expect(result.outcome).toBe('error');
    expect(result.error).toContain("agent run ended 'error_max_turns'");
    expect(result.error).toContain('[MAX_TURNS]');
    expect(result.error).toContain('529');
    // The attempt still cost money — the estimate is forwarded regardless.
    expect(result.costUsd).toBe(0.1234);
  });

  it('the LAST result message wins and non-finite/negative costs are ignored', async () => {
    const executor = createAgentExecutor({
      query: () =>
        fakeHandle([
          okResult({ subtype: 'error_during_execution' }),
          okResult({ total_cost_usd: Number.NaN }),
        ]),
    });
    const result = await executor(session({ agent: { prompt: 'p' } }), ctx());
    expect(result.outcome).toBe('ok');
    expect(result.costUsd).toBeUndefined();
  });

  it('a stream that ends without a result message is an error', async () => {
    const executor = createAgentExecutor({
      query: () => fakeHandle([{ type: 'assistant' }]),
    });
    const result = await executor(session({ agent: { prompt: 'p' } }), ctx());
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/ended without a result message/);
  });

  it('relays every message to onMessage in order; a throwing seam never fails the attempt', async () => {
    const seen: unknown[] = [];
    const executor = createAgentExecutor({
      query: () => fakeHandle([{ type: 'system' }, { type: 'task_progress' }, okResult()]),
      onMessage: (_s, m) => {
        seen.push((m as { type: string }).type);
        throw new Error('seam blew up');
      },
      onResult: () => {
        throw new Error('seam blew up too');
      },
    });
    const result = await executor(session({ agent: { prompt: 'p' } }), ctx());
    expect(result.outcome).toBe('ok');
    expect(seen).toEqual(['system', 'task_progress', 'result']);
  });

  it('a mid-stream throw without an abort propagates (driver records it)', async () => {
    const executor = createAgentExecutor({
      query: () => ({
        async interrupt() {
          return {};
        },
        close() {},
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() {
          throw new Error('transport exploded');
        },
      }),
    });
    await expect(executor(session({ agent: { prompt: 'p' } }), ctx())).rejects.toThrow(
      'transport exploded',
    );
  });
});

describe('abort bridging (fake timers)', () => {
  it('abort -> interrupt(); a politely-ended stream needs no close()', async () => {
    const handle = hangingHandle([{ type: 'assistant' }]);
    const executor = createAgentExecutor({ query: () => handle });
    const controller = new AbortController();
    const pending = executor(session({ agent: { prompt: 'p' } }), ctx(controller.signal));
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    const result = await pending;
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/aborted before the agent run produced a result/);
    expect(handle.interrupts).toBe(1);
    expect(handle.closes).toBe(0);
  });

  it('a stream that ignores interrupt() is close()d after the grace window', async () => {
    const handle = hangingHandle([]);
    handle.interruptEnds = false; // interrupt does nothing — the hard path
    const executor = createAgentExecutor({ query: () => handle, interruptGraceMs: 2_000 });
    const controller = new AbortController();
    const pending = executor(session({ agent: { prompt: 'p' } }), ctx(controller.signal));
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(handle.closes).toBe(0); // still inside the grace window
    await vi.advanceTimersByTimeAsync(600);
    const result = await pending;
    expect(handle.interrupts).toBe(1);
    expect(handle.closes).toBe(1);
    expect(result.outcome).toBe('error');
  });

  it('a result captured before the abort still counts', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle: AgentQueryHandle = {
      async interrupt() {
        release?.();
        return {};
      },
      close() {},
      async *[Symbol.asyncIterator]() {
        yield okResult();
        await gate; // result already yielded; stream lingers
      },
    };
    const executor = createAgentExecutor({ query: () => handle });
    const controller = new AbortController();
    const pending = executor(session({ agent: { prompt: 'p' } }), ctx(controller.signal));
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    const result = await pending;
    expect(result.outcome).toBe('ok');
    expect(result.costUsd).toBe(0.1234);
  });

  it('a signal already aborted at entry interrupts immediately', async () => {
    const handle = hangingHandle([]);
    const executor = createAgentExecutor({ query: () => handle });
    const controller = new AbortController();
    controller.abort();
    const result = await executor(session({ agent: { prompt: 'p' } }), ctx(controller.signal));
    expect(result.outcome).toBe('error');
    expect(handle.interrupts).toBe(1);
  });
});

describe('named extractors', () => {
  it('extractPlainAgent validates shapes strictly', () => {
    expect(extractPlainAgent(session({ agent: { prompt: 'p' } }))).toEqual({ prompt: 'p' });
    expect(extractPlainAgent(session({ data: { agent: { prompt: 'q' } } }))).toEqual({
      prompt: 'q',
    });
    expect(extractPlainAgent(session(null))).toBeNull();
    expect(extractPlainAgent(session({ agent: { prompt: 42 } }))).toBeNull();
  });

  it('extractWorkflowNode reads payload.node.agent from the workflow envelope', () => {
    const payload = {
      node: { agent: { prompt: 'node work', maxBudgetUsd: 1 } },
      workflow: { graphId: 'g', runId: 'r', nodeId: 'n', deps: {} },
    };
    expect(extractWorkflowNode(session(payload))).toEqual({
      prompt: 'node work',
      maxBudgetUsd: 1,
    });
    expect(extractWorkflowNode(session({ workflow: {} }))).toBeNull();
    expect(extractWorkflowNode(session({ node: {} }))).toBeNull();
  });

  it('extractGoalRound recognizes a round payload, hands it to the formatter, re-validates', () => {
    const extract = extractGoalRound((p) => ({
      prompt: `${p.goal.description}${p.feedback === null ? '' : ` | feedback: ${p.feedback}`} (round ${p.round})`,
    }));
    const round = {
      goal: { id: 'g1', description: 'ship it' },
      data: undefined,
      feedback: 'not yet',
      round: 2,
    };
    expect(extract(session(round))).toEqual({ prompt: 'ship it | feedback: not yet (round 2)' });
    expect(extract(session({ goal: { id: 'g1' }, round: 1, feedback: null }))).toBeNull();
    expect(extract(session({ agent: { prompt: 'p' } }))).toBeNull();
    // A formatter returning a malformed request fails loud, same as every path.
    const badFormat = extractGoalRound(() => ({ prompt: '' }));
    expect(badFormat(session(round))).toBeNull();
  });
});
