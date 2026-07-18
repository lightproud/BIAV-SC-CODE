/**
 * Scheduler component tests (fake timers): dispatch-only firing on the
 * ledger, sched:{id}:{fireAt} session ids, cross-restart recovery with
 * 'latest' vs 'all' missed-fire compensation, duplicate-dispatch race
 * swallowing, error isolation, and stop() halting the loop.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskLedger } from '../src/ledger/ledger.js';
import type { LedgerStore, SessionFilter } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../src/ledger/types.js';
import { Scheduler, type SchedulerEvent } from '../src/schedule/scheduler.js';
import { ScheduleSpecError, type ScheduleSpec } from '../src/schedule/spec.js';

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

// Base time is itself a fire point of every=1000/anchor 0, so the first fire
// after start is exactly T0 + 1000 (strictly-greater semantics).
const T0 = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

const jobSpec = (over: Partial<ScheduleSpec> = {}): ScheduleSpec => ({
  id: 'job',
  intent: 'do-job',
  every: 1_000,
  ...over,
});

describe('Scheduler construction', () => {
  it('validates every spec (ScheduleSpecError) and rejects duplicate ids', () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    expect(() => new Scheduler({ ledger, specs: [{ id: 'x', intent: 'y' }] })).toThrow(ScheduleSpecError);
    expect(() => new Scheduler({ ledger, specs: [jobSpec(), jobSpec()] })).toThrow(/duplicate spec id 'job'/);
    expect(() => new Scheduler({ ledger, specs: [jobSpec()], pollIntervalMs: -1 })).toThrow(RangeError);
    expect(() => new Scheduler({ ledger, specs: [jobSpec()], pollIntervalMs: Number.NaN })).toThrow(RangeError);
  });
});

describe('Scheduler firing (fake timers)', () => {
  it('fires on time, dispatch-only, with the sched:{id}:{fireAt} session id and schedule payload', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    const events: SchedulerEvent[] = [];
    const scheduler = new Scheduler({
      ledger,
      specs: [jobSpec({ payload: { n: 1 }, maxAttempts: 5 })],
      pollIntervalMs: 100,
      onEvent: (e) => events.push(e),
    });
    expect(scheduler.isRunning()).toBe(false);
    scheduler.start();
    scheduler.start(); // idempotent
    expect(scheduler.isRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(950); // ticks through T0+900: nothing due yet
    expect(await ledger.listSessions()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(150); // tick at T0+1000 fires that point
    const sessions = await ledger.listSessions();
    expect(sessions).toHaveLength(1);
    const s = sessions[0]!;
    expect(s.id).toBe(`sched:job:${T0 + 1000}`);
    expect(s.intent).toBe('do-job');
    expect(s.maxAttempts).toBe(5);
    expect(s.payload).toEqual({ schedule: { specId: 'job', fireAt: T0 + 1000 }, data: { n: 1 } });
    // DISPATCH-ONLY: the scheduler never executes; the session waits for a driver.
    expect(s.state).toBe('pending');
    expect(s.attempts).toBe(0);
    expect(events).toEqual([
      { type: 'schedule:fire', specId: 'job', fireAt: T0 + 1000, sessionId: `sched:job:${T0 + 1000}` },
    ]);

    await vi.advanceTimersByTimeAsync(1_000); // next point
    expect((await ledger.listSessions()).map((x) => x.id)).toContain(`sched:job:${T0 + 2000}`);
    expect(await ledger.listSessions()).toHaveLength(2);

    await scheduler.stop();
  });

  it('stop() halts firing and isRunning flips', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    const scheduler = new Scheduler({ ledger, specs: [jobSpec()], pollIntervalMs: 100 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_050);
    expect(await ledger.listSessions()).toHaveLength(1);
    await scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await ledger.listSessions()).toHaveLength(1); // nothing fired while stopped
  });

  it("restart recovery + catchUp 'latest': no re-fire of ledgered points, one compensation fire", async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store });
    const s1 = new Scheduler({ ledger, specs: [jobSpec()], pollIntervalMs: 100 });
    s1.start();
    await vi.advanceTimersByTimeAsync(2_100); // fires T0+1000, T0+2000
    await s1.stop();
    expect((await ledger.listSessions()).map((s) => s.id).sort()).toEqual([
      `sched:job:${T0 + 1000}`,
      `sched:job:${T0 + 2000}`,
    ]);

    await vi.advanceTimersByTimeAsync(5_000); // "down" — points T0+3000..T0+7000 fall unfired

    const events: SchedulerEvent[] = [];
    const s2 = new Scheduler({ ledger, specs: [jobSpec()], pollIntervalMs: 100, onEvent: (e) => events.push(e) });
    s2.start();
    await vi.advanceTimersByTimeAsync(0); // first tick: recovery + compensation
    const ids = (await ledger.listSessions()).map((s) => s.id);
    expect(ids).toHaveLength(3); // already-fired points NOT re-fired
    expect(ids).toContain(`sched:job:${T0 + 7000}`); // only the LATEST missed point
    expect(events).toEqual([
      { type: 'schedule:fire', specId: 'job', fireAt: T0 + 7000, sessionId: `sched:job:${T0 + 7000}` },
    ]);

    // normal cadence resumes from the compensated point
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await ledger.listSessions()).map((s) => s.id)).toContain(`sched:job:${T0 + 8000}`);
    expect(await ledger.listSessions()).toHaveLength(4);
    await s2.stop();
  });

  it("restart recovery + catchUp 'all': every missed point replayed, ascending", async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store });
    const spec = jobSpec({ catchUp: 'all' });
    const s1 = new Scheduler({ ledger, specs: [spec], pollIntervalMs: 100 });
    s1.start();
    await vi.advanceTimersByTimeAsync(1_100); // fires T0+1000
    await s1.stop();

    await vi.advanceTimersByTimeAsync(4_000); // down: T0+2000..T0+5000 missed

    const events: SchedulerEvent[] = [];
    const s2 = new Scheduler({ ledger, specs: [spec], pollIntervalMs: 100, onEvent: (e) => events.push(e) });
    s2.start();
    await vi.advanceTimersByTimeAsync(0);
    const ids = (await ledger.listSessions()).map((s) => s.id).sort();
    expect(ids).toEqual([
      `sched:job:${T0 + 1000}`, // from run #1, not re-fired
      `sched:job:${T0 + 2000}`,
      `sched:job:${T0 + 3000}`,
      `sched:job:${T0 + 4000}`,
      `sched:job:${T0 + 5000}`,
    ]);
    expect(events.map((e) => (e.type === 'schedule:fire' ? e.fireAt : -1))).toEqual([
      T0 + 2000,
      T0 + 3000,
      T0 + 4000,
      T0 + 5000,
    ]);
    await s2.stop();
  });

  it('never-fired specs recover to now: no epoch backfill on a fresh ledger', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    // T0 is far from epoch; without the no-backfill rule this would flood
    // catchUp:'all' with a thousand historical points.
    const scheduler = new Scheduler({ ledger, specs: [jobSpec({ catchUp: 'all' })], pollIntervalMs: 100 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(await ledger.listSessions()).toHaveLength(0); // nothing before start is owed
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await ledger.listSessions()).map((s) => s.id)).toEqual([`sched:job:${T0 + 1000}`]);
    await scheduler.stop();
  });

  it('duplicate-dispatch race: already-exists is swallowed, no error event, cadence continues', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    const events: SchedulerEvent[] = [];
    const scheduler = new Scheduler({ ledger, specs: [jobSpec()], pollIntervalMs: 100, onEvent: (e) => events.push(e) });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(500);
    // Another run wins the race to the T0+1000 fire point:
    await ledger.dispatch({ id: `sched:job:${T0 + 1000}`, intent: 'someone-else' });
    await vi.advanceTimersByTimeAsync(600); // scheduler reaches T0+1000, dispatch collides
    expect(events.filter((e) => e.type === 'schedule:error')).toEqual([]);
    expect(events.filter((e) => e.type === 'schedule:fire')).toEqual([]); // skipped, not re-fired
    const won = await ledger.getSession(`sched:job:${T0 + 1000}`);
    expect(won?.intent).toBe('someone-else'); // the winner's record is untouched
    // lastFired advanced past the skipped duplicate: next point fires normally.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(events.filter((e) => e.type === 'schedule:fire').map((e) => (e.type === 'schedule:fire' ? e.fireAt : -1))).toEqual([
      T0 + 2000,
    ]);
    await scheduler.stop();
  });

  it('dispatch failure emits schedule:error, keeps lastFired, and retries next tick', async () => {
    const store = memoryStore();
    let failOnce = true;
    const failingStore: LedgerStore = {
      ...store,
      async putSession(r) {
        if (failOnce && r.id.startsWith('sched:')) {
          failOnce = false;
          throw new Error('store hiccup');
        }
        return store.putSession(r);
      },
    };
    const ledger = new TaskLedger({ store: failingStore });
    const events: SchedulerEvent[] = [];
    const scheduler = new Scheduler({ ledger, specs: [jobSpec()], pollIntervalMs: 100, onEvent: (e) => events.push(e) });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_050); // first attempt at T0+1000 fails
    const errors = events.filter((e) => e.type === 'schedule:error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { error: Error }).error.message).toBe('store hiccup');
    await vi.advanceTimersByTimeAsync(100); // next tick retries the SAME point
    expect((await ledger.listSessions()).map((s) => s.id)).toEqual([`sched:job:${T0 + 1000}`]);
    expect(events.filter((e) => e.type === 'schedule:fire')).toHaveLength(1);
    await scheduler.stop();
  });

  it('recovery failure emits schedule:error and is retried on the next tick', async () => {
    const store = memoryStore();
    let failOnce = true;
    const failingStore: LedgerStore = {
      ...store,
      async listSessions(filter?: SessionFilter) {
        if (failOnce) {
          failOnce = false;
          throw new Error('scan failed');
        }
        return store.listSessions(filter);
      },
    };
    const ledger = new TaskLedger({ store: failingStore });
    const events: SchedulerEvent[] = [];
    const scheduler = new Scheduler({ ledger, specs: [jobSpec()], pollIntervalMs: 100, onEvent: (e) => events.push(e) });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0); // recovery fails
    expect(events.filter((e) => e.type === 'schedule:error')).toHaveLength(1);
    // Recovered on tick 2 (lastFired = then-now T0+100); next point T0+1000 fires.
    await vi.advanceTimersByTimeAsync(1_100);
    expect((await ledger.listSessions()).map((s) => s.id)).toEqual([`sched:job:${T0 + 1000}`]);
    await scheduler.stop();
  });

  it('one broken spec does not starve the others in the same tick', async () => {
    const store = memoryStore();
    const brokenStore: LedgerStore = {
      ...store,
      async putSession(r) {
        if (r.id.startsWith('sched:bad:')) throw new Error('bad lane');
        return store.putSession(r);
      },
    };
    const ledger = new TaskLedger({ store: brokenStore });
    const events: SchedulerEvent[] = [];
    const scheduler = new Scheduler({
      ledger,
      specs: [
        { id: 'bad', intent: 'bad-job', every: 1_000 },
        { id: 'good', intent: 'good-job', every: 1_000 },
      ],
      pollIntervalMs: 100,
      onEvent: (e) => events.push(e),
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_050);
    expect((await ledger.listSessions()).map((s) => s.id)).toEqual([`sched:good:${T0 + 1000}`]);
    expect(events.filter((e) => e.type === 'schedule:error').length).toBeGreaterThanOrEqual(1);
    await scheduler.stop();
  });

  it('onEvent callback errors are swallowed; the scheduler keeps firing', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    const scheduler = new Scheduler({
      ledger,
      specs: [jobSpec()],
      pollIntervalMs: 100,
      onEvent: () => {
        throw new Error('host renderer exploded');
      },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await ledger.listSessions()).toHaveLength(2);
    expect(scheduler.isRunning()).toBe(true);
    await scheduler.stop();
  });
});
