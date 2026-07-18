/**
 * Gap-adoption tests (0.71.0, keeper ruling 2026-07-18):
 *  - G2 claim leases: claimLeaseMs stamps leaseUntil, sweepExpiredLeases
 *    settles expired running claims into the retry path (multi-driver safe,
 *    lease-less records untouched), the driver sweeps each tick, and
 *    recordOutcome spends the lease.
 *  - G3 seedFirstRun: a footprint-less spec fires its single most recent due
 *    point on the first tick — under BOTH catchUp modes — instead of never
 *    firing at all on short-lived hosts; scheduleSessionId is public.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LedgerDriver } from '../src/driver.js';
import { TaskLedger } from '../src/ledger/ledger.js';
import type { LedgerStore, SessionFilter } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../src/ledger/types.js';
import { Scheduler, scheduleSessionId } from '../src/schedule/scheduler.js';

function memoryStore(): LedgerStore {
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

const T0 = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('G2 claim leases', () => {
  it('claimLeaseMs stamps leaseUntil on claimDue and claimSession', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), claimLeaseMs: 5_000 });
    await ledger.dispatch({ id: 'a', intent: 'x' });
    const [claimed] = await ledger.claimDue(T0);
    expect(claimed!.leaseUntil).toBe(T0 + 5_000);

    await ledger.dispatch({ id: 'b', intent: 'x' });
    const single = await ledger.claimSession('b', T0 + 1);
    expect(single.leaseUntil).toBe(T0 + 1 + 5_000);
  });

  it('without claimLeaseMs claims carry a null lease and are never swept', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    await ledger.dispatch({ id: 'a', intent: 'x' });
    const [claimed] = await ledger.claimDue(T0);
    expect(claimed!.leaseUntil).toBeNull();
    expect(await ledger.sweepExpiredLeases(Number.MAX_SAFE_INTEGER)).toEqual([]);
    expect((await ledger.getSession('a'))!.state).toBe('running');
  });

  it('rejects a non-positive or non-finite claimLeaseMs', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new TaskLedger({ store: memoryStore(), claimLeaseMs: bad })).toThrow(RangeError);
    }
  });

  it('sweepExpiredLeases settles ONLY expired leases into the retry path', async () => {
    const ledger = new TaskLedger({
      store: memoryStore(),
      claimLeaseMs: 5_000,
      retry: { maxAttempts: 3, baseDelayMs: 100, factor: 2, maxDelayMs: 1_000 },
    });
    await ledger.dispatch({ id: 'dead', intent: 'x' });
    await ledger.claimDue(T0);
    await ledger.dispatch({ id: 'alive', intent: 'x', runAt: T0 + 1_000 });
    await ledger.claimDue(T0 + 4_000); // alive's lease runs to T0+9000

    const swept = await ledger.sweepExpiredLeases(T0 + 6_000);
    expect(swept.map((s) => s.id)).toEqual(['dead']);
    const dead = (await ledger.getSession('dead'))!;
    expect(dead.state).toBe('retrying');
    expect(dead.lastError).toContain('lease-expired');
    expect(dead.leaseUntil).toBeNull();
    expect((await ledger.getSession('alive'))!.state).toBe('running');
    const rows = await ledger.listQueries('dead');
    expect(rows.length).toBe(1);
    expect(rows[0]!.outcome).toBe('error');
  });

  it('an expired lease on the LAST attempt exhausts into failed', async () => {
    const ledger = new TaskLedger({
      store: memoryStore(),
      claimLeaseMs: 1_000,
      retry: { maxAttempts: 1, baseDelayMs: 100, factor: 2, maxDelayMs: 1_000 },
    });
    await ledger.dispatch({ id: 'a', intent: 'x' });
    await ledger.claimDue(T0);
    await ledger.sweepExpiredLeases(T0 + 2_000);
    expect((await ledger.getSession('a'))!.state).toBe('failed');
  });

  it('recordOutcome spends the lease on a normal settle', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), claimLeaseMs: 5_000 });
    await ledger.dispatch({ id: 'a', intent: 'x' });
    await ledger.claimDue(T0);
    const done = await ledger.recordOutcome('a', {
      outcome: 'ok',
      startedAt: T0,
      endedAt: T0 + 10,
    });
    expect(done.state).toBe('done');
    expect(done.leaseUntil).toBeNull();
  });

  it('the driver sweeps expired leases each tick and re-runs the session', async () => {
    const ledger = new TaskLedger({
      store: memoryStore(),
      claimLeaseMs: 2_000,
      retry: { maxAttempts: 3, baseDelayMs: 500, factor: 1, maxDelayMs: 500 },
    });
    // Simulate a dead driver's orphan: claimed, never settled.
    await ledger.dispatch({ id: 'orphan', intent: 'x' });
    await ledger.claimDue(T0);

    const driver = new LedgerDriver({
      ledger,
      pollIntervalMs: 1_000,
      executor: async () => ({ outcome: 'ok', summary: 'recovered' }),
    });
    driver.start();
    // Tick 1 (T0+1000): lease not yet expired — nothing to sweep or claim.
    await vi.advanceTimersByTimeAsync(1_100);
    expect((await ledger.getSession('orphan'))!.state).toBe('running');
    // Tick 2 (T0+2000): lease expired -> swept to retrying (backoff 500ms);
    // tick 3 claims and completes it.
    await vi.advanceTimersByTimeAsync(2_100);
    await driver.stop();
    const final = (await ledger.getSession('orphan'))!;
    expect(final.state).toBe('done');
    const rows = await ledger.listQueries('orphan');
    expect(rows.map((q) => q.outcome)).toEqual(['error', 'ok']);
    expect(rows[0]!.error).toContain('lease-expired');
  });
});

describe('G3 seedFirstRun + scheduleSessionId', () => {
  it('scheduleSessionId formats the documented fire-point id', () => {
    expect(scheduleSessionId('job', 123)).toBe('sched:job:123');
  });

  it('without seedFirstRun a footprint-less spec does not fire on a short run (prior behavior)', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    const scheduler = new Scheduler({
      ledger,
      specs: [{ id: 'job', intent: 'x', every: 1_000 }],
      pollIntervalMs: 100,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(250); // boots after fire points, exits fast
    await scheduler.stop();
    expect(await ledger.listSessions()).toEqual([]);
  });

  it('seedFirstRun fires exactly the single most recent due point (catchUp latest)', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    const scheduler = new Scheduler({
      ledger,
      specs: [{ id: 'job', intent: 'x', every: 1_000, catchUp: 'latest' }],
      pollIntervalMs: 100,
      seedFirstRun: true,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(250);
    await scheduler.stop();
    const ids = (await ledger.listSessions()).map((s) => s.id);
    expect(ids).toEqual([scheduleSessionId('job', T0)]);
  });

  it("seedFirstRun under catchUp 'all' seeds the same single point (no history replay)", async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    const scheduler = new Scheduler({
      ledger,
      specs: [{ id: 'job', intent: 'x', every: 1_000, catchUp: 'all' }],
      pollIntervalMs: 100,
      seedFirstRun: true,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(250);
    await scheduler.stop();
    const ids = (await ledger.listSessions()).map((s) => s.id);
    expect(ids).toEqual([scheduleSessionId('job', T0)]);
  });

  it('seedFirstRun defers to an existing footprint (recovery unchanged)', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    // Footprint: the T0-2000 point already fired in some earlier run.
    await ledger.dispatch({ id: scheduleSessionId('job', T0 - 2_000), intent: 'x' });
    const scheduler = new Scheduler({
      ledger,
      specs: [{ id: 'job', intent: 'x', every: 1_000, catchUp: 'all' }],
      pollIntervalMs: 100,
      seedFirstRun: true,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(250);
    await scheduler.stop();
    const fireIds = (await ledger.listSessions()).map((s) => s.id).sort();
    // Recovery from the footprint compensates T0-1000 and T0 — seeding never
    // overrides a real footprint.
    expect(fireIds).toEqual([
      scheduleSessionId('job', T0 - 2_000),
      scheduleSessionId('job', T0 - 1_000),
      scheduleSessionId('job', T0),
    ].sort());
  });

  it('seedFirstRun with dailyAt fires the most recent daily point once', async () => {
    // T0 = 1970-01-01T00:16:40Z; dailyAt 00:10 UTC — most recent point is
    // 00:10 today (epoch 600_000).
    const ledger = new TaskLedger({ store: memoryStore() });
    const scheduler = new Scheduler({
      ledger,
      specs: [{ id: 'daily', intent: 'x', dailyAt: { hour: 0, minute: 10 }, catchUp: 'all' }],
      pollIntervalMs: 100,
      seedFirstRun: true,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(250);
    await scheduler.stop();
    const ids = (await ledger.listSessions()).map((s) => s.id);
    expect(ids).toEqual([scheduleSessionId('daily', 600_000)]);
  });
});
