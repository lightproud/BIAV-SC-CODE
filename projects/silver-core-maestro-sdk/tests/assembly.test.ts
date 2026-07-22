/**
 * Assembly proof (construction cover §3.2, mirroring the agent-side §7.1
 * assembly test): using ONLY the package's public surface — imported through
 * the real package specifier, not source paths — a host assembles the full
 * ledger state flow with zero patches: pending -> running -> retrying (with
 * backoff) -> running -> done, the driver-timeout path, retry exhaustion into
 * failed, and host-side stop. Fake timers throughout; no real clock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TaskLedger,
  LedgerDriver,
  SESSION_STATES,
  type DriverEvent,
  type LedgerStore,
  type QueryRecord,
  type SessionFilter,
  type SessionRecord,
  type SessionState,
} from 'silver-core-maestro-sdk';

/** The host's own storage battery, written against the public seam only. */
function hostStore(): LedgerStore {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  return {
    async putSession(r) {
      sessions.set(r.id, { ...r });
    },
    async getSession(id) {
      const r = sessions.get(id);
      return r === undefined ? null : { ...r };
    },
    async listSessions(filter?: SessionFilter) {
      let all = [...sessions.values()];
      if (filter?.states !== undefined) all = all.filter((s) => filter.states!.includes(s.state));
      if (filter?.dueBefore !== undefined) {
        all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= filter.dueBefore!);
      }
      return all.map((s) => ({ ...s }));
    },
    async appendQuery(r) {
      queries.push({ ...r });
    },
    async listQueries(sessionId) {
      return queries.filter((q) => q.sessionId === sessionId).map((q) => ({ ...q }));
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('assembly: full state flow on public surface, fake timers only', () => {
  it('retrying path: error -> backoff -> retry -> done, all five states observed', async () => {
    const store = hostStore();
    const ledger = new TaskLedger({
      store,
      retry: { baseDelayMs: 1_000, factor: 2, maxAttempts: 3 },
    });
    const seenStates = new Set<SessionState>();
    const events: DriverEvent[] = [];
    let calls = 0;
    const driver = new LedgerDriver({
      ledger,
      executor: async () => {
        calls += 1;
        if (calls === 1) throw new Error('flaky downstream');
        return { outcome: 'ok', summary: 'second try worked' };
      },
      pollIntervalMs: 100,
      onEvent: (ev) => {
        events.push(ev);
        if (ev.type !== 'driver:error') seenStates.add(ev.session.state);
      },
    });

    const s = await ledger.dispatch({ intent: 'patrol' });
    seenStates.add(s.state); // pending
    driver.start();
    expect(driver.isRunning()).toBe(true);

    // First poll (t=0): claim + attempt 1 fails -> retrying with backoff.
    await vi.advanceTimersByTimeAsync(0);
    const afterFail = await ledger.getSession(s.id);
    expect(afterFail?.state).toBe('retrying');
    expect(afterFail?.attempts).toBe(1);
    expect(afterFail?.lastError).toBe('flaky downstream');
    const scheduledAt = afterFail!.nextRunAt!;
    expect(scheduledAt).toBe(Date.now() + 1_000);

    // Polls before the backoff elapses must NOT re-claim.
    await vi.advanceTimersByTimeAsync(500);
    expect((await ledger.getSession(s.id))?.state).toBe('retrying');

    // Backoff elapses -> reclaimed -> attempt 2 succeeds -> done.
    await vi.advanceTimersByTimeAsync(600);
    const doneRecord = await ledger.getSession(s.id);
    expect(doneRecord?.state).toBe('done');
    expect(doneRecord?.attempts).toBe(2);
    expect(doneRecord?.nextRunAt).toBeNull();

    // Query rows: one per attempt, outcomes error then ok.
    const rows = await ledger.listQueries(s.id);
    expect(rows.map((q) => [q.attempt, q.outcome])).toEqual([
      [1, 'error'],
      [2, 'ok'],
    ]);

    // attempt:start events surface the running state; with pending observed at
    // dispatch and terminal at settle, the closed set is fully exercised
    // once the exhaustion test below adds 'failed'.
    expect(events.some((e) => e.type === 'attempt:start' && e.session.state === 'running')).toBe(true);
    expect(events.filter((e) => e.type === 'session:terminal')).toHaveLength(1);
    for (const st of ['pending', 'running', 'retrying', 'done'] as const) {
      expect(seenStates.has(st)).toBe(true);
    }

    await driver.stop();
    expect(driver.isRunning()).toBe(false);
  });

  it('driver-timeout path: hanging executor -> timeout outcome -> exhaustion into failed', async () => {
    const store = hostStore();
    const ledger = new TaskLedger({
      store,
      retry: { baseDelayMs: 1_000, factor: 2 },
    });
    const outcomes: string[] = [];
    const driver = new LedgerDriver({
      ledger,
      executor: (_s, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted by driver')));
        }),
      pollIntervalMs: 100,
      queryTimeoutMs: 5_000,
      onEvent: (ev) => {
        if (ev.type === 'attempt:settle') outcomes.push(ev.outcome);
      },
    });

    const s = await ledger.dispatch({ intent: 'hangs forever', maxAttempts: 2 });
    driver.start();

    // Attempt 1: claimed at t=0, hangs, timed out at t=5000 -> retrying.
    await vi.advanceTimersByTimeAsync(0);
    expect((await ledger.getSession(s.id))?.state).toBe('running');
    await vi.advanceTimersByTimeAsync(5_000);
    const afterTimeout = await ledger.getSession(s.id);
    expect(afterTimeout?.state).toBe('retrying');
    expect(afterTimeout?.lastError).toBe('aborted by driver');

    // Backoff 1000ms, then attempt 2 also times out -> attempts exhausted -> failed.
    await vi.advanceTimersByTimeAsync(1_100);
    expect((await ledger.getSession(s.id))?.state).toBe('running');
    await vi.advanceTimersByTimeAsync(5_000);
    const failed = await ledger.getSession(s.id);
    expect(failed?.state).toBe('failed');
    expect(failed?.attempts).toBe(2);
    expect(failed?.nextRunAt).toBeNull();

    const rows = await ledger.listQueries(s.id);
    expect(rows.map((q) => q.outcome)).toEqual(['timeout', 'timeout']);
    expect(outcomes).toEqual(['timeout', 'timeout']);

    await driver.stop();
  });

  it('host-side stop aborts in-flight work and the ledger resumes it later', async () => {
    const store = hostStore();
    const ledger = new TaskLedger({ store, retry: { baseDelayMs: 1_000 } });
    const driver = new LedgerDriver({
      ledger,
      executor: (_s, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('host stopped the driver')));
        }),
      pollIntervalMs: 100,
    });
    const s = await ledger.dispatch({ intent: 'long haul' });
    driver.start();
    await vi.advanceTimersByTimeAsync(0);
    expect((await ledger.getSession(s.id))?.state).toBe('running');

    // stop() must abort the attempt and settle its bookkeeping (fake clock
    // never advances here: stop is not time-driven).
    await driver.stop();
    expect(driver.isRunning()).toBe(false);
    const parked = await ledger.getSession(s.id);
    expect(parked?.state).toBe('retrying'); // resumable through the normal path
    expect(parked?.lastError).toBe('host stopped the driver');

    // A restarted driver picks the session back up once its backoff is due.
    const driver2 = new LedgerDriver({
      ledger,
      executor: async () => ({ outcome: 'ok' }),
      pollIntervalMs: 100,
    });
    driver2.start();
    await vi.advanceTimersByTimeAsync(1_100);
    expect((await ledger.getSession(s.id))?.state).toBe('done');
    await driver2.stop();
  });

  it('the closed state set is exactly what the package declares', () => {
    expect(SESSION_STATES).toEqual(['pending', 'running', 'retrying', 'failed', 'done', 'cancelled']);
  });
});
