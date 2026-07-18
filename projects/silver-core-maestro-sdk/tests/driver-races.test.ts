/**
 * Driver race regressions (audit batch B, 2026-07-18):
 *   B1 stop() must not resolve while a tick's claimDue is in flight — the
 *      claim is parked (abort path) BEFORE stop resolves, never executed after.
 *   B2 stop()-then-start() while a tick is in flight must not fork two
 *      concurrent poll chains (generation counter).
 *   B3 recordOutcome failure: one immediate retry; a double failure emits
 *      driver:error CARRYING the session (stranded in 'running' by design —
 *      the store is the source of truth); a single transient failure recovers.
 * Fake timers throughout; no real clock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LedgerDriver, type DriverEvent } from '../src/driver.js';
import { TaskLedger } from '../src/ledger/ledger.js';
import type { LedgerStore, SessionFilter } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../src/ledger/types.js';

function memStore(): LedgerStore {
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Store whose FIRST listSessions call blocks until the gate opens. */
function gatedStore(): { store: LedgerStore; open: () => void } {
  const base = memStore();
  const gate = deferred();
  let gated = true;
  const store: LedgerStore = {
    ...base,
    async listSessions(filter?: SessionFilter) {
      if (gated) {
        gated = false;
        await gate.promise;
      }
      return base.listSessions(filter);
    },
  };
  return { store, open: gate.resolve };
}

function driverErrors(events: DriverEvent[]): Extract<DriverEvent, { type: 'driver:error' }>[] {
  return events.filter(
    (e): e is Extract<DriverEvent, { type: 'driver:error' }> => e.type === 'driver:error',
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('driver races (audit batch B)', () => {
  it('B1: stop() awaits an in-flight claimDue; the claim is parked before stop resolves and nothing runs after', async () => {
    const { store, open } = gatedStore();
    const ledger = new TaskLedger({ store, retry: { baseDelayMs: 1_000 } });
    const claimSpy = vi.spyOn(ledger, 'claimDue');
    const driver = new LedgerDriver({
      ledger,
      // Hangs until aborted: only the stop() abort path can settle it.
      executor: (_s, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('stopped mid-claim')));
        }),
      pollIntervalMs: 100,
    });
    const s = await ledger.dispatch({ intent: 'claimed during stop' });
    driver.start();
    // Tick fires at t=0 and blocks inside claimDue (gated listSessions).
    await vi.advanceTimersByTimeAsync(0);
    expect(claimSpy).toHaveBeenCalledTimes(1);

    let stopResolved = false;
    const stopP = driver.stop().then(() => {
      stopResolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    // The tick is still in flight: stop() must still be pending.
    expect(stopResolved).toBe(false);

    open();
    await vi.advanceTimersByTimeAsync(0);
    await stopP;
    // The claim landed during stop(), was aborted, and settled to a
    // resumable state — not left 'running', not executed to completion.
    const parked = await ledger.getSession(s.id);
    expect(parked?.state).toBe('retrying');
    expect(parked?.lastError).toBe('stopped mid-claim');

    // No polls after stop resolved.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(claimSpy).toHaveBeenCalledTimes(1);
  });

  it('B2: start-stop-start while a tick is in flight yields exactly one poll chain', async () => {
    const { store, open } = gatedStore();
    const ledger = new TaskLedger({ store });
    const claimSpy = vi.spyOn(ledger, 'claimDue');
    const driver = new LedgerDriver({
      ledger,
      executor: async () => ({ outcome: 'ok' }),
      pollIntervalMs: 100,
    });
    driver.start();
    // Tick 1 (generation 1) fires at t=0 and blocks inside claimDue.
    await vi.advanceTimersByTimeAsync(0);
    expect(claimSpy).toHaveBeenCalledTimes(1);

    // Host stops and immediately restarts without awaiting stop() first.
    const stopP = driver.stop();
    driver.start();
    open();
    await vi.advanceTimersByTimeAsync(0);
    await stopP;
    // Tick 1 finished but may not extend its chain (stale generation);
    // generation 2's first tick has run: exactly 2 claims so far.
    expect(claimSpy).toHaveBeenCalledTimes(2);

    // Over 5 more intervals a single chain polls exactly 5 more times.
    // A forked double chain would poll ~10 times.
    await vi.advanceTimersByTimeAsync(500);
    expect(claimSpy).toHaveBeenCalledTimes(7);

    await driver.stop();
  });

  it('B3: recordOutcome double failure emits driver:error carrying the stranded session', async () => {
    const ledger = new TaskLedger({ store: memStore(), retry: { baseDelayMs: 1_000 } });
    const recordSpy = vi
      .spyOn(ledger, 'recordOutcome')
      .mockRejectedValue(new Error('store down'));
    const events: DriverEvent[] = [];
    const driver = new LedgerDriver({
      ledger,
      executor: async () => ({ outcome: 'ok', summary: 'work done' }),
      pollIntervalMs: 100,
      onEvent: (ev) => {
        events.push(ev);
      },
    });
    const s = await ledger.dispatch({ intent: 'bookkeeping will fail' });
    driver.start();
    await vi.advanceTimersByTimeAsync(0);
    await driver.stop();

    // Exactly one immediate retry: two recordOutcome calls total.
    expect(recordSpy).toHaveBeenCalledTimes(2);
    const errs = driverErrors(events);
    expect(errs).toHaveLength(1);
    // The event names the stranded session so the host can repair it.
    expect(errs[0]!.session?.id).toBe(s.id);
    expect(events.some((e) => e.type === 'attempt:settle')).toBe(false);
    // Pinned by design: a persistently failing store leaves the session in
    // 'running' — the store is the source of truth, the driver never forks it.
    expect((await ledger.getSession(s.id))?.state).toBe('running');
  });

  it('B3: a single transient recordOutcome failure recovers via the immediate retry', async () => {
    const ledger = new TaskLedger({ store: memStore(), retry: { baseDelayMs: 1_000 } });
    const original = ledger.recordOutcome.bind(ledger);
    let failuresLeft = 1;
    const recordSpy = vi.spyOn(ledger, 'recordOutcome').mockImplementation(async (id, res) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('transient store hiccup');
      }
      return original(id, res);
    });
    const events: DriverEvent[] = [];
    const driver = new LedgerDriver({
      ledger,
      executor: async () => ({ outcome: 'ok', summary: 'kept result' }),
      pollIntervalMs: 100,
      onEvent: (ev) => {
        events.push(ev);
      },
    });
    const s = await ledger.dispatch({ intent: 'transient bookkeeping failure' });
    driver.start();
    await vi.advanceTimersByTimeAsync(0);
    await driver.stop();

    expect(recordSpy).toHaveBeenCalledTimes(2);
    expect(driverErrors(events)).toHaveLength(0);
    // The executor result survived the first failed write.
    const settles = events.filter((e) => e.type === 'attempt:settle');
    expect(settles).toHaveLength(1);
    const done = await ledger.getSession(s.id);
    expect(done?.state).toBe('done');
    const rows = await ledger.listQueries(s.id);
    expect(rows.map((q) => [q.outcome, q.summary])).toEqual([['ok', 'kept result']]);
  });
});
