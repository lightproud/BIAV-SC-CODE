/**
 * The `cancelled` closed terminal + TaskLedger.cancelSession (0.76.0, BPT
 * requirement P0-D1). The acceptance list is BPT's own, transcribed 1:1
 * (cases 1-7; case 8 — the store contract suite — lives in
 * ledger-contract-suite.test.ts and the new cancelled round-trip check):
 * a user cancel must be ledger-distinguishable from a failure, and a
 * cancelled session must NEVER run again — not on the backoff schedule,
 * not through the lease sweep, not after a host restart.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskLedger } from '../src/ledger/ledger.js';
import { InvalidTransitionError } from '../src/ledger/state.js';
import { LedgerDriver, type DriverEvent } from '../src/driver.js';
import type { LedgerStore, SessionFilter } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../src/ledger/types.js';

function memoryStore(): LedgerStore & {
  sessions: Map<string, SessionRecord>;
  queries: QueryRecord[];
} {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  return {
    sessions,
    queries,
    async putSession(record) {
      sessions.set(record.id, { ...record });
    },
    async getSession(id) {
      const r = sessions.get(id);
      return r === undefined ? null : { ...r };
    },
    async listSessions(filter?: SessionFilter) {
      let all = [...sessions.values()];
      if (filter?.states !== undefined) {
        all = all.filter((s) => filter.states!.includes(s.state));
      }
      if (filter?.dueBefore !== undefined) {
        all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= filter.dueBefore!);
      }
      return all.map((s) => ({ ...s }));
    },
    async appendQuery(record) {
      queries.push({ ...record });
    },
    async listQueries(sessionId) {
      return queries.filter((q) => q.sessionId === sessionId).map((q) => ({ ...q }));
    },
  };
}

/** memoryStore + a compliant putSessionIf (revision CAS), audit-r4 style. */
function casStore() {
  const base = memoryStore();
  return {
    ...base,
    sessions: base.sessions,
    queries: base.queries,
    async putSessionIf(record: SessionRecord, expected: number | null) {
      const current = base.sessions.get(record.id);
      if (expected === null) {
        if (current !== undefined) return false;
      } else if ((current?.revision ?? 0) !== expected) {
        return false;
      }
      base.sessions.set(record.id, { ...record });
      return true;
    },
  } satisfies LedgerStore & Record<string, unknown>;
}

function testClock(startAt = 1_000) {
  let t = startAt;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const seq = () => {
  let n = 0;
  return () => `id-${(n += 1)}`;
};

describe('cancelSession — from pending (acceptance 1)', () => {
  it('lands in cancelled with nextRunAt null; claimDue never lists it again', async () => {
    const clock = testClock(1_000);
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock, idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    const cancelled = await ledger.cancelSession(s.id, { reason: 'user' });
    expect(cancelled).toMatchObject({
      state: 'cancelled',
      nextRunAt: null,
      leaseUntil: null,
      cancelledAt: 1_000,
      cancelReason: 'user',
      attempts: 0,
    });
    expect(await ledger.claimDue()).toHaveLength(0);
    clock.advance(1_000_000);
    expect(await ledger.claimDue()).toHaveLength(0);
  });

  it('appends NO query row (no attempt was in flight)', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock: testClock(), idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    await ledger.cancelSession(s.id, { reason: 'user' });
    expect(await ledger.listQueries(s.id)).toHaveLength(0);
  });

  it('a manual-claim session (runAt: null) cancels the same way', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: testClock(), idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'inline', runAt: null });
    const cancelled = await ledger.cancelSession(s.id);
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.nextRunAt).toBeNull();
    await expect(ledger.claimSession(s.id)).rejects.toThrowError(InvalidTransitionError);
  });

  it('defaults cancelReason to null and cancelledAt to the clock when opts are omitted', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: testClock(7_777), idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    const cancelled = await ledger.cancelSession(s.id);
    expect(cancelled.cancelledAt).toBe(7_777);
    expect(cancelled.cancelReason).toBeNull();
  });

  it('honors an explicit cancelledAt', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: testClock(1_000), idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    const cancelled = await ledger.cancelSession(s.id, { cancelledAt: 123_456 });
    expect(cancelled.cancelledAt).toBe(123_456);
  });
});

describe('cancelSession — from retrying (acceptance 2)', () => {
  it('drops the scheduled retry: due time passes and nothing runs again', async () => {
    const clock = testClock(1_000);
    const store = memoryStore();
    const ledger = new TaskLedger({
      store,
      clock,
      idFactory: seq(),
      retry: { baseDelayMs: 500, factor: 2 },
    });
    const s = await ledger.dispatch({ intent: 'loop' });
    await ledger.claimDue();
    await ledger.recordOutcome(s.id, {
      outcome: 'error',
      error: 'boom',
      startedAt: 1_000,
      endedAt: 1_001,
    });
    expect((await ledger.getSession(s.id))?.state).toBe('retrying');
    const cancelled = await ledger.cancelSession(s.id, { reason: 'user' });
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.nextRunAt).toBeNull();
    clock.advance(10_000); // far past the 500ms backoff
    expect(await ledger.claimDue()).toHaveLength(0);
  });

  it('keeps the earlier failure row and appends nothing for the cancel', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock, idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    await ledger.claimDue();
    await ledger.recordOutcome(s.id, { outcome: 'error', error: 'boom', startedAt: 1_000, endedAt: 1_001 });
    await ledger.cancelSession(s.id, { reason: 'user' });
    const rows = await ledger.listQueries(s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attempt: 1, outcome: 'error', error: 'boom' });
    // lastError keeps the FAILURE text — the cancel reason lives in cancelReason.
    const final = await ledger.getSession(s.id);
    expect(final?.lastError).toBe('boom');
    expect(final?.cancelReason).toBe('user');
  });
});

describe('cancelSession — from running (acceptance 3)', () => {
  it('writes the in-flight attempt epitaph: one cancelled row, lease cleared', async () => {
    const clock = testClock(1_000);
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock, idFactory: seq(), claimLeaseMs: 60_000 });
    const s = await ledger.dispatch({ intent: 'loop' });
    const [claimed] = await ledger.claimDue();
    expect(claimed?.leaseUntil).toBe(61_000);
    clock.advance(500);
    const cancelled = await ledger.cancelSession(s.id, { reason: 'user' });
    expect(cancelled).toMatchObject({
      state: 'cancelled',
      nextRunAt: null,
      leaseUntil: null,
      cancelledAt: 1_500,
      cancelReason: 'user',
      attempts: 1,
    });
    const rows = await ledger.listQueries(s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attempt: 1,
      outcome: 'cancelled',
      error: 'user',
      startedAt: 1_000, // the claim's stamp
      endedAt: 1_500,
    });
  });

  it('omits the row error field when no reason is given', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock, idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    await ledger.claimDue();
    await ledger.cancelSession(s.id);
    const [row] = await ledger.listQueries(s.id);
    expect(row?.outcome).toBe('cancelled');
    expect(row?.error).toBeUndefined();
  });

  it('the aborted executor\'s late recordOutcome throws and appends nothing', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock, idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    await ledger.claimDue();
    await ledger.cancelSession(s.id, { reason: 'user' });
    // The driver's fenced write (attempt 1) — and an unfenced legacy write.
    await expect(
      ledger.recordOutcome(s.id, { outcome: 'error', error: 'aborted', startedAt: 1_000, endedAt: 1_001, attempt: 1 }),
    ).rejects.toThrowError(InvalidTransitionError);
    await expect(
      ledger.recordOutcome(s.id, { outcome: 'ok', startedAt: 1_000, endedAt: 1_001 }),
    ).rejects.toThrowError(InvalidTransitionError);
    expect(await ledger.listQueries(s.id)).toHaveLength(1); // the epitaph row only
  });
});

describe('cancelSession — idempotency (acceptance 4)', () => {
  it('repeat cancel returns the stored record, keeps the FIRST stamps, appends nothing', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock, idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    await ledger.claimDue();
    const first = await ledger.cancelSession(s.id, { reason: 'user' });
    clock.advance(5_000);
    const again = await ledger.cancelSession(s.id, { reason: 'operator', cancelledAt: 99_999 });
    expect(again.cancelledAt).toBe(first.cancelledAt);
    expect(again.cancelReason).toBe('user');
    expect(again.revision).toBe(first.revision); // no write happened
    expect(await ledger.listQueries(s.id)).toHaveLength(1);
  });
});

describe('cancelSession — terminal rejection (acceptance 5)', () => {
  it('throws InvalidTransitionError on done', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: testClock(), idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    await ledger.claimDue();
    await ledger.recordOutcome(s.id, { outcome: 'ok', startedAt: 1_000, endedAt: 1_001 });
    await expect(ledger.cancelSession(s.id)).rejects.toThrowError(InvalidTransitionError);
  });

  it('throws InvalidTransitionError on failed', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: testClock(), idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop', maxAttempts: 1 });
    await ledger.claimDue();
    await ledger.recordOutcome(s.id, { outcome: 'error', error: 'x', startedAt: 1_000, endedAt: 1_001 });
    await expect(ledger.cancelSession(s.id)).rejects.toThrowError(InvalidTransitionError);
  });

  it('throws on an unknown session id', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: testClock() });
    await expect(ledger.cancelSession('missing')).rejects.toThrow(/unknown session 'missing'/);
  });

  it('rejects a non-string reason and a non-finite cancelledAt at the door', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: testClock() });
    await expect(
      ledger.cancelSession('x', { reason: 42 as unknown as string }),
    ).rejects.toThrowError(TypeError);
    await expect(ledger.cancelSession('x', { cancelledAt: NaN })).rejects.toThrowError(RangeError);
    await expect(ledger.cancelSession('x', { cancelledAt: Infinity })).rejects.toThrowError(RangeError);
  });
});

describe('cancelSession — lease sweep exemption (acceptance 6)', () => {
  it('a cancelled session is never swept, even past its old lease horizon', async () => {
    const clock = testClock(1_000);
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock, idFactory: seq(), claimLeaseMs: 5_000 });
    const s = await ledger.dispatch({ intent: 'loop' });
    await ledger.claimDue(); // lease until 6_000
    await ledger.cancelSession(s.id, { reason: 'user' });
    clock.advance(100_000); // far past the (cleared) lease
    expect(await ledger.sweepExpiredLeases()).toHaveLength(0);
    const final = await ledger.getSession(s.id);
    expect(final?.state).toBe('cancelled');
    expect(await ledger.listQueries(s.id)).toHaveLength(1); // still just the epitaph
  });
});

describe('cancelSession — restart survival (acceptance 7)', () => {
  it('a reloaded ledger over the same store keeps cancelled cancelled', async () => {
    const clock = testClock(1_000);
    const store = memoryStore();
    const first = new TaskLedger({ store, clock, idFactory: seq() });
    const s = await first.dispatch({ intent: 'loop' });
    await first.cancelSession(s.id, { reason: 'user' });
    // Host restart: a fresh TaskLedger (and driver poll) over the same rows.
    const reloaded = new TaskLedger({ store, clock: testClock(999_999), idFactory: seq() });
    const session = await reloaded.getSession(s.id);
    expect(session).toMatchObject({ state: 'cancelled', nextRunAt: null, cancelReason: 'user' });
    expect(await reloaded.claimDue()).toHaveLength(0);
    expect(await reloaded.sweepExpiredLeases()).toHaveLength(0);
  });
});

describe('recordOutcome rejects the reserved cancelled outcome', () => {
  it('throws RangeError before touching the store', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock: testClock(), idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    await ledger.claimDue();
    await expect(
      ledger.recordOutcome(s.id, { outcome: 'cancelled', startedAt: 1_000, endedAt: 1_001 }),
    ).rejects.toThrow(/reserved for cancelSession/);
    expect((await ledger.getSession(s.id))?.state).toBe('running');
    expect(store.queries).toHaveLength(0);
  });
});

describe('cancelSession — CAS fencing (putSessionIf stores)', () => {
  it('cancels through the conditional put, bumping the revision', async () => {
    const store = casStore();
    const ledger = new TaskLedger({ store, clock: testClock(), idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    const cancelled = await ledger.cancelSession(s.id, { reason: 'user' });
    expect(cancelled.revision).toBe(2); // dispatch=1, cancel=2
    expect(store.sessions.get(s.id)?.state).toBe('cancelled');
  });

  it('re-reads and re-applies over an interleaved rival write (cancel still lands)', async () => {
    const store = casStore();
    const ledger = new TaskLedger({ store, clock: testClock(), idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    // Rival host bumps the row between our read and our put, exactly once.
    let intercepted = false;
    const honest = store.putSessionIf.bind(store);
    store.putSessionIf = async (record: SessionRecord, expected: number | null) => {
      if (!intercepted && record.state === 'cancelled') {
        intercepted = true;
        const current = store.sessions.get(record.id)!;
        // Rival claim: pending -> running, revision + 1.
        store.sessions.set(record.id, {
          ...current,
          state: 'running',
          attempts: current.attempts + 1,
          nextRunAt: null,
          revision: (current.revision ?? 0) + 1,
        });
        return honest(record, expected); // now stale -> false
      }
      return honest(record, expected);
    };
    const cancelled = await ledger.cancelSession(s.id, { reason: 'user' });
    expect(intercepted).toBe(true);
    expect(cancelled.state).toBe('cancelled');
    // The re-read saw the rival's running claim, so the cancel wrote the
    // in-flight attempt's epitaph row too.
    expect((await ledger.listQueries(s.id)).map((q) => q.outcome)).toEqual(['cancelled']);
  });

  it('surfaces ClaimConflictError when the CAS loses persistently', async () => {
    const store = casStore();
    const ledger = new TaskLedger({ store, clock: testClock(), idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'loop' });
    store.putSessionIf = async () => false; // pathological store: every write loses
    await expect(ledger.cancelSession(s.id)).rejects.toThrow(/cancel lost to concurrent writers/);
  });
});

describe('driver — a mid-flight cancel is not a malfunction', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops the late result silently: no driver:error, no extra rows, cancelled sticks', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const ledger = new TaskLedger({ store, idFactory: seq() });
    const events: DriverEvent[] = [];
    let releaseExecutor!: () => void;
    const executorGate = new Promise<void>((resolve) => (releaseExecutor = resolve));
    let signalSeen: AbortSignal | undefined;
    const driver = new LedgerDriver({
      ledger,
      executor: async (_session, ctx) => {
        signalSeen = ctx.signal;
        await executorGate;
        return { outcome: 'ok' as const, summary: 'too late' };
      },
      pollIntervalMs: 100,
      onEvent: (e) => events.push(e),
    });
    const s = await ledger.dispatch({ intent: 'loop' });
    driver.start();
    await vi.advanceTimersByTimeAsync(150); // claim + executor now in flight
    expect((await ledger.getSession(s.id))?.state).toBe('running');

    // Host-side cancel: settle the ledger, then release the executor late.
    await ledger.cancelSession(s.id, { reason: 'user' });
    releaseExecutor();
    await vi.advanceTimersByTimeAsync(500); // let bookkeeping settle + more polls

    await driver.stop();
    const final = await ledger.getSession(s.id);
    expect(final?.state).toBe('cancelled');
    expect(final?.cancelReason).toBe('user');
    // The epitaph row is the whole history — the late 'ok' recorded nothing.
    expect((await ledger.listQueries(s.id)).map((q) => q.outcome)).toEqual(['cancelled']);
    // No malfunction signal, no terminal event for the dropped result.
    expect(events.filter((e) => e.type === 'driver:error')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'session:terminal')).toHaveLength(0);
    expect(signalSeen).toBeDefined();
  });

  it('claimDue never re-claims a cancelled session across later polls', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const ledger = new TaskLedger({ store, idFactory: seq() });
    const started: string[] = [];
    const driver = new LedgerDriver({
      ledger,
      executor: async (session) => {
        started.push(session.id);
        return { outcome: 'ok' as const };
      },
      pollIntervalMs: 100,
    });
    const s = await ledger.dispatch({ intent: 'loop', runAt: 10_000 });
    await ledger.cancelSession(s.id, { reason: 'user' }); // cancelled BEFORE ever due
    driver.start();
    await vi.advanceTimersByTimeAsync(20_000); // due time long past
    await driver.stop();
    expect(started).toHaveLength(0);
    expect((await ledger.getSession(s.id))?.state).toBe('cancelled');
  });
});
