/**
 * QueryRecord.costUsd (design round 3 ruling D2): cost as a generic
 * dimension of the query surface. The ledger transcribes, never computes;
 * NaN / negative / infinite costs are rejected where they enter; the driver
 * forwards an ExecutorResult.costUsd verbatim into the query row.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LedgerDriver } from '../src/driver.js';
import { TaskLedger } from '../src/ledger/ledger.js';
import { isTerminal } from '../src/ledger/state.js';
import { memoryStore } from './helpers/memory-store.js';

const T0 = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('recordOutcome costUsd', () => {
  it('persists costUsd verbatim onto the query row; absent stays absent', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    await ledger.dispatch({ id: 'job', intent: 'work', maxAttempts: 3 });
    await ledger.claimSession('job');
    await ledger.recordOutcome('job', {
      outcome: 'error',
      error: 'first try',
      startedAt: T0,
      endedAt: T0 + 5,
      costUsd: 0.25,
    });
    await ledger.claimSession('job');
    await ledger.recordOutcome('job', {
      outcome: 'ok',
      startedAt: T0 + 10,
      endedAt: T0 + 15,
    });
    const rows = await ledger.listQueries('job');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.costUsd).toBe(0.25);
    expect(rows[1]!.costUsd).toBeUndefined();
    // Cumulative session cost = sum over listQueries (the design-doc read path).
    const total = rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
    expect(total).toBe(0.25);
  });

  it('accepts zero, rejects NaN / Infinity / negative where they enter', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    await ledger.dispatch({ id: 'job', intent: 'work' });
    await ledger.claimSession('job');
    const base = { outcome: 'ok' as const, startedAt: T0, endedAt: T0 + 1 };
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0.01]) {
      await expect(ledger.recordOutcome('job', { ...base, costUsd: bad })).rejects.toThrow(
        RangeError,
      );
    }
    // The rejections never wrote: the session is still settleable, at zero cost.
    const settled = await ledger.recordOutcome('job', { ...base, costUsd: 0 });
    expect(settled.state).toBe('done');
    expect((await ledger.listQueries('job'))[0]!.costUsd).toBe(0);
  });
});

describe('driver forwarding', () => {
  it('an ExecutorResult.costUsd lands on the query row through the driver', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    await ledger.dispatch({ id: 'job', intent: 'work' });
    const driver = new LedgerDriver({
      ledger,
      executor: async () => ({ outcome: 'ok', summary: 'done', costUsd: 0.42 }),
      pollIntervalMs: 50,
    });
    driver.start();
    await vi.advanceTimersByTimeAsync(200);
    await driver.stop();
    const session = await ledger.getSession('job');
    expect(session !== null && isTerminal(session.state)).toBe(true);
    const rows = await ledger.listQueries('job');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe('ok');
    expect(rows[0]!.costUsd).toBe(0.42);
  });
});
