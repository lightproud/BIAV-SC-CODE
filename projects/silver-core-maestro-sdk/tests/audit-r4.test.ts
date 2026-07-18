/**
 * T56 audit round 4 — regression locks. One lock (or group) per confirmed
 * defect, asserting the FIXED behavior; each failed on the pre-fix code.
 * Findings R4-A/B/C1-C4/AF1 (fault-injection + dual-host lenses) and
 * R4-HI-1..4 (hostile-input lens); battle report r4 is the detail authority.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TaskLedger,
  DuplicateSessionError,
  ClaimConflictError,
} from '../src/ledger/ledger.js';
import { InvalidTransitionError } from '../src/ledger/state.js';
import {
  runLedgerStoreContractSuite,
  ledgerStoreContractCheckNames,
} from '../src/ledger/contract-suite.js';
import type { LedgerStore, SessionFilter } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../src/ledger/types.js';
import { Scheduler } from '../src/schedule/scheduler.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * In-memory store; `cas: true` implements putSessionIf (the audit-r4 seam);
 * `hop` injects randomized microtask yields to force real interleavings
 * between two TaskLedger hosts sharing the store.
 */
function memoryStore(opts: { cas?: boolean; hop?: () => number } = {}): LedgerStore & {
  raw: () => { sessions: Map<string, SessionRecord>; queries: QueryRecord[] };
} {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  const yieldSome = async (): Promise<void> => {
    if (opts.hop === undefined) return;
    const hops = Math.floor(opts.hop() * 3);
    for (let i = 0; i < hops; i += 1) await Promise.resolve();
  };
  const store: LedgerStore & { raw: () => { sessions: Map<string, SessionRecord>; queries: QueryRecord[] } } = {
    raw: () => ({ sessions, queries }),
    async putSession(r) {
      await yieldSome();
      sessions.set(r.id, { ...r });
    },
    async getSession(id) {
      await yieldSome();
      const r = sessions.get(id);
      return r === undefined ? null : { ...r };
    },
    async listSessions(filter?: SessionFilter) {
      await yieldSome();
      let all = [...sessions.values()];
      if (filter?.states !== undefined) all = all.filter((s) => filter.states!.includes(s.state));
      if (filter?.dueBefore !== undefined) {
        all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= filter.dueBefore!);
      }
      return all.map((s) => ({ ...s }));
    },
    async appendQuery(r) {
      await yieldSome();
      queries.push({ ...r });
    },
    async listQueries(sessionId) {
      await yieldSome();
      return queries.filter((q) => q.sessionId === sessionId).map((q) => ({ ...q }));
    },
  };
  if (opts.cas === true) {
    store.putSessionIf = async (r, expected) => {
      // The compare and the write are a single synchronous block — atomic
      // with respect to other store calls, as the seam contract requires.
      await yieldSome();
      const current = sessions.get(r.id);
      if (expected === null) {
        if (current !== undefined) return false;
        sessions.set(r.id, { ...r });
        return true;
      }
      if (current === undefined || (current.revision ?? 0) !== expected) return false;
      sessions.set(r.id, { ...r });
      return true;
    };
  }
  return store;
}

const T0 = 1_000_000;

describe('R4-A/C4/AF1: attempt fencing in recordOutcome', () => {
  it('a lease-swept attempt whose session was re-claimed cannot commit its late outcome (doc promise now real)', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock: { now: () => T0 }, claimLeaseMs: 100 });
    await ledger.dispatch({ id: 'S', intent: 'w', maxAttempts: 3, runAt: T0 });
    const [first] = await ledger.claimDue(T0);
    expect(first!.attempts).toBe(1);
    // Lease expires; sweep settles attempt 1; the session is re-claimed for
    // attempt 2 in the same tick (exactly what LedgerDriver does).
    await ledger.sweepExpiredLeases(T0 + 150);
    // (fixed clock: the sweep scheduled the retry at T0 + backoff(1) = T0+1s)
    const [second] = await ledger.claimDue(T0 + 2_000);
    expect(second!.attempts).toBe(2);
    // The overrunning attempt-1 executor finally reports — FENCED out.
    await expect(
      ledger.recordOutcome('S', {
        outcome: 'ok',
        summary: 'stale-result-from-attempt-1',
        startedAt: T0,
        endedAt: T0 + 150,
        attempt: 1,
      }),
    ).rejects.toThrow(InvalidTransitionError);
    // The LIVE attempt still records normally.
    const settled = await ledger.recordOutcome('S', {
      outcome: 'ok',
      startedAt: T0 + 200,
      endedAt: T0 + 250,
      attempt: 2,
    });
    expect(settled.state).toBe('done');
    const rows = await ledger.listQueries('S');
    expect(rows.find((q) => q.attempt === 2)?.summary).toBeUndefined();
  });

  it('rejects a non-integer or < 1 attempt fence value', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: { now: () => T0 } });
    await ledger.dispatch({ id: 'S', intent: 'w', runAt: T0 });
    await ledger.claimDue(T0);
    for (const attempt of [0, -1, 1.5, Number.NaN]) {
      await expect(
        ledger.recordOutcome('S', { outcome: 'ok', startedAt: T0, endedAt: T0, attempt }),
      ).rejects.toThrow(RangeError);
    }
  });
});

describe('R4-B: settled state never contradicts the committed query row', () => {
  it('a session settled by a lease sweep is never left contradicting its own row history (put failure path)', async () => {
    const store = memoryStore();
    let failPuts = false;
    const realPut = store.putSession.bind(store);
    store.putSession = async (r) => {
      if (failPuts) throw new Error('store down');
      await realPut(r);
    };
    const ledger = new TaskLedger({ store, clock: { now: () => T0 }, claimLeaseMs: 100 });
    await ledger.dispatch({ id: 'S', intent: 'w', maxAttempts: 1, runAt: T0 });
    await ledger.claimDue(T0);
    // Settle-then-append: with the session put down, recordOutcome commits
    // NOTHING (pre-fix, append-first, it committed the ok row and the later
    // sweep terminally FAILED a session whose only row said ok).
    failPuts = true;
    for (let i = 0; i < 2; i += 1) {
      await expect(
        ledger.recordOutcome('S', { outcome: 'ok', startedAt: T0, endedAt: T0 + 10, attempt: 1 }),
      ).rejects.toThrow(/store down/);
    }
    expect(store.raw().queries).toHaveLength(0);
    failPuts = false;
    const [swept] = await ledger.sweepExpiredLeases(T0 + 150);
    expect(swept!.state).toBe('failed');
    const rows = await ledger.listQueries('S');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe('error'); // state and row history agree
  });

  it('a crash between settle and append is repaired by the consistent-retry backfill', async () => {
    const store = memoryStore();
    let failAppends = false;
    const realAppend = store.appendQuery.bind(store);
    store.appendQuery = async (r) => {
      if (failAppends) throw new Error('append down');
      await realAppend(r);
    };
    const ledger = new TaskLedger({ store, clock: { now: () => T0 } });
    await ledger.dispatch({ id: 'S', intent: 'w', maxAttempts: 3, runAt: T0 });
    await ledger.claimDue(T0);
    failAppends = true;
    await expect(
      ledger.recordOutcome('S', { outcome: 'ok', startedAt: T0, endedAt: T0, attempt: 1 }),
    ).rejects.toThrow(/append down/);
    // State committed, row lost — the driver's immediate retry backfills it.
    expect((await ledger.getSession('S'))!.state).toBe('done');
    expect(store.raw().queries).toHaveLength(0);
    failAppends = false;
    const replay = await ledger.recordOutcome('S', {
      outcome: 'ok',
      summary: 'the result',
      startedAt: T0,
      endedAt: T0,
      attempt: 1,
    });
    expect(replay.state).toBe('done');
    const rows = await ledger.listQueries('S');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toBe('the result');
    // A DIVERGENT late outcome must not backfill a contradicting row.
    await expect(
      ledger.recordOutcome('S', { outcome: 'error', error: 'x', startedAt: T0, endedAt: T0, attempt: 1 }),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it('a caller retry with a DIVERGENT outcome against a live session converges to the committed row', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock: { now: () => T0 } });
    await ledger.dispatch({ id: 'S', intent: 'w', maxAttempts: 1, runAt: T0 });
    await ledger.claimDue(T0);
    // A committed row without a settled state (cross-host half-write): the
    // retry's divergent outcome must not override the recorded truth.
    store.raw().queries.push({
      id: 'q1', sessionId: 'S', attempt: 1, startedAt: T0, endedAt: T0, outcome: 'ok',
    });
    const settled = await ledger.recordOutcome('S', {
      outcome: 'error',
      error: 'second opinion',
      startedAt: T0,
      endedAt: T0,
      attempt: 1,
    });
    expect(settled.state).toBe('done'); // committed ok row is the truth
    expect((await ledger.listQueries('S'))[0]!.outcome).toBe('ok');
    expect((await ledger.listQueries('S'))).toHaveLength(1);
  });
});

describe('R4-C1: claim exclusivity', () => {
  it('same-instance concurrent claimDue never double-claims (per-session mutex; plain store)', async () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const store = memoryStore({ hop: mulberry32(seed) });
      const ledger = new TaskLedger({ store, clock: { now: () => T0 }, claimLeaseMs: 10_000 });
      await ledger.dispatch({ id: 's1', intent: 'w', runAt: T0 });
      const [a, b] = await Promise.all([ledger.claimDue(T0 + 1), ledger.claimDue(T0 + 1)]);
      expect(a!.length + b!.length).toBe(1);
      expect(store.raw().sessions.get('s1')!.attempts).toBe(1);
    }
  });

  it('dual-host claimDue over a putSessionIf store never double-claims within an unexpired lease', async () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const store = memoryStore({ cas: true, hop: mulberry32(seed) });
      const hostA = new TaskLedger({ store, clock: { now: () => T0 }, claimLeaseMs: 10_000 });
      const hostB = new TaskLedger({ store, clock: { now: () => T0 }, claimLeaseMs: 10_000 });
      await hostA.dispatch({ id: 's1', intent: 'w', runAt: T0 });
      const [a, b] = await Promise.all([hostA.claimDue(T0 + 1), hostB.claimDue(T0 + 1)]);
      // Pre-fix: 295/300 seeds granted the claim to BOTH hosts.
      expect(a!.length + b!.length).toBe(1);
      expect(store.raw().sessions.get('s1')!.attempts).toBe(1);
    }
  });

  it('dual-host claimSession over a putSessionIf store: exactly one wins, the loser gets a typed conflict/transition error', async () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const store = memoryStore({ cas: true, hop: mulberry32(seed) });
      const hostA = new TaskLedger({ store, clock: { now: () => T0 }, claimLeaseMs: 10_000 });
      const hostB = new TaskLedger({ store, clock: { now: () => T0 }, claimLeaseMs: 10_000 });
      await hostA.dispatch({ id: 's1', intent: 'w', runAt: null });
      const results = await Promise.allSettled([
        hostA.claimSession('s1', T0),
        hostB.claimSession('s1', T0),
      ]);
      const wins = results.filter((r) => r.status === 'fulfilled');
      expect(wins).toHaveLength(1);
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(
        loser.reason instanceof ClaimConflictError || loser.reason instanceof InvalidTransitionError,
      ).toBe(true);
      expect(store.raw().sessions.get('s1')!.attempts).toBe(1);
    }
  });

  it('dual-host dispatch of the same id over a putSessionIf store: one winner, loser gets DuplicateSessionError, no torn row', async () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const store = memoryStore({ cas: true, hop: mulberry32(seed) });
      const hostA = new TaskLedger({ store, clock: { now: () => T0 } });
      const hostB = new TaskLedger({ store, clock: { now: () => T0 } });
      const results = await Promise.allSettled([
        hostA.dispatch({ id: 'dup', intent: 'from-a', payload: { host: 'a' }, runAt: T0 }),
        hostB.dispatch({ id: 'dup', intent: 'from-b', payload: { host: 'b' }, runAt: T0 }),
      ]);
      const wins = results.filter((r) => r.status === 'fulfilled');
      expect(wins).toHaveLength(1);
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(loser.reason).toBeInstanceOf(DuplicateSessionError);
      const row = store.raw().sessions.get('dup')!;
      const winner = (wins[0] as PromiseFulfilledResult<SessionRecord>).value;
      expect(row.intent).toBe(winner.intent);
      expect((row.payload as { host: string }).host).toBe((winner.payload as { host: string }).host);
    }
  });
});

describe('R4-C2: one query row per attempt', () => {
  it('same-instance concurrent recordOutcome for one attempt appends exactly one row (mutex serializes)', async () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const store = memoryStore({ hop: mulberry32(seed) });
      const ledger = new TaskLedger({ store, clock: { now: () => T0 } });
      await ledger.dispatch({ id: 's1', intent: 'w', maxAttempts: 3, runAt: T0 });
      await ledger.claimDue(T0);
      const results = await Promise.allSettled([
        ledger.recordOutcome('s1', { outcome: 'error', error: 'x', startedAt: T0, endedAt: T0, attempt: 1 }),
        ledger.recordOutcome('s1', { outcome: 'error', error: 'x', startedAt: T0, endedAt: T0, attempt: 1 }),
      ]);
      // One settles the attempt; the second is a duplicate settle in state
      // 'retrying' (InvalidTransitionError) or an idempotent no-op replay.
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      expect(store.raw().queries.filter((q) => q.sessionId === 's1' && q.attempt === 1)).toHaveLength(1);
    }
  });

  it('ledger.listQueries canonicalizes cross-host duplicate rows to one per attempt (first wins)', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock: { now: () => T0 } });
    await ledger.dispatch({ id: 's1', intent: 'w', runAt: T0 });
    // Simulate the cross-host double-append a plain putSession store permits.
    store.raw().queries.push(
      { id: 'q1', sessionId: 's1', attempt: 1, startedAt: T0, endedAt: T0, outcome: 'ok' },
      { id: 'q2', sessionId: 's1', attempt: 1, startedAt: T0, endedAt: T0, outcome: 'error', error: 'dup' },
      { id: 'q3', sessionId: 's1', attempt: 2, startedAt: T0, endedAt: T0, outcome: 'ok' },
    );
    const rows = await ledger.listQueries('s1');
    expect(rows.map((q) => q.id)).toEqual(['q1', 'q3']);
  });
});

describe('R4-C3: sweeper cannot regress a committed terminal state', () => {
  it('same instance: holder commits done while sweep is mid-flight — done survives', async () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const store = memoryStore({ hop: mulberry32(seed) });
      let now = T0;
      const ledger = new TaskLedger({ store, clock: { now: () => now }, claimLeaseMs: 100 });
      await ledger.dispatch({ id: 's1', intent: 'w', maxAttempts: 3, runAt: T0 });
      await ledger.claimDue(T0);
      now = T0 + 150; // lease expired; the holder is late but alive
      await Promise.allSettled([
        ledger.sweepExpiredLeases(now),
        ledger.recordOutcome('s1', { outcome: 'ok', startedAt: T0, endedAt: now, attempt: 1 }),
      ]);
      const final = store.raw().sessions.get('s1')!;
      const rows = store.raw().queries.filter((q) => q.attempt === 1);
      // Legal races: holder first -> done (a late sweep adopts the ok row);
      // sweeper first -> the attempt is settled lease-expired and the late ok
      // is fenced out (lease semantics). ILLEGAL (the pre-fix defect): a
      // committed done regressed to retrying, or two rows for one attempt.
      expect(rows).toHaveLength(1);
      expect(final.state).toBe(rows[0]!.outcome === 'ok' ? 'done' : 'retrying');
    }
  });

  it('dual-host with putSessionIf: state stays consistent with the first committed row (done never regresses)', async () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const store = memoryStore({ cas: true, hop: mulberry32(seed) });
      let now = T0;
      const holder = new TaskLedger({ store, clock: { now: () => now }, claimLeaseMs: 100 });
      const sweeper = new TaskLedger({ store, clock: { now: () => now }, claimLeaseMs: 100 });
      await holder.dispatch({ id: 's1', intent: 'w', maxAttempts: 3, runAt: T0 });
      await holder.claimDue(T0);
      now = T0 + 150;
      await Promise.allSettled([
        sweeper.sweepExpiredLeases(now),
        holder.recordOutcome('s1', { outcome: 'ok', startedAt: T0, endedAt: now, attempt: 1 }),
      ]);
      const final = store.raw().sessions.get('s1')!;
      const rows = store.raw().queries.filter((q) => q.attempt === 1);
      expect(rows).toHaveLength(1);
      expect(final.state).toBe(rows[0]!.outcome === 'ok' ? 'done' : 'retrying');
    }
  });

  it('sweep per-session isolation: one session settle failing does not abandon the rest', async () => {
    const store = memoryStore();
    const realAppend = store.appendQuery.bind(store);
    store.appendQuery = async (r) => {
      if (r.sessionId === 'poison') throw new Error('append down');
      await realAppend(r);
    };
    const ledger = new TaskLedger({ store, clock: { now: () => T0 }, claimLeaseMs: 100 });
    for (const id of ['poison', 'healthy']) {
      await ledger.dispatch({ id, intent: 'w', maxAttempts: 1, runAt: T0 });
    }
    await ledger.claimDue(T0);
    // Pre-fix: the poison session's throw aborted the whole sweep (and the
    // already-settled list was lost to the caller).
    const swept = await ledger.sweepExpiredLeases(T0 + 150);
    expect(swept.map((s) => s.id)).toEqual(['healthy']);
    expect(store.raw().sessions.get('healthy')!.state).toBe('failed');
    // Settle-then-append: the poison session's STATE settled before its row
    // append failed (row backfillable); the essence of the lock is that the
    // healthy session was still swept and returned.
    expect(store.raw().sessions.get('poison')!.state).toBe('failed');
    expect(store.raw().queries.filter((q) => q.sessionId === 'poison')).toHaveLength(0);
  });
});

describe('R4-HI-1: eager retry-policy validation', () => {
  it('rejects poisoned policies at the constructor, before any store write can be half-applied', () => {
    const store = memoryStore();
    for (const retry of [
      { factor: Number.NaN },
      { baseDelayMs: -1 },
      { maxDelayMs: Number.POSITIVE_INFINITY },
      { maxAttempts: 0 },
      { maxAttempts: 1.5 },
    ]) {
      expect(() => new TaskLedger({ store, retry })).toThrow(RangeError);
    }
  });
});

describe('R4-HI-2: claim/sweep now-parameter validation', () => {
  it('claimDue/claimSession/sweepExpiredLeases throw RangeError on non-finite now', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: { now: () => T0 }, claimLeaseMs: 100 });
    await ledger.dispatch({ id: 's1', intent: 'w', runAt: T0 });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      await expect(ledger.claimDue(bad)).rejects.toThrow(RangeError);
      await expect(ledger.claimSession('s1', bad)).rejects.toThrow(RangeError);
      await expect(ledger.sweepExpiredLeases(bad)).rejects.toThrow(RangeError);
    }
    // Pre-fix: claimSession(id, NaN) persisted NaN updatedAt/leaseUntil and
    // the next sweep falsely burned the attempt; claimDue(Infinity) persisted
    // an Infinity lease that permanently defeated the sweep safety net.
    const row = (await ledger.getSession('s1'))!;
    expect(row.state).toBe('pending');
    expect(Number.isFinite(row.updatedAt)).toBe(true);
  });
});

describe('R4-HI-3: scheduler recovery vs out-of-range fire suffixes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a digits-only suffix beyond the Date range no longer starves the spec', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store });
    // Poisoned footprint: digits-only, far beyond 8.64e15.
    store.raw().sessions.set('sched:job:99999999999999999999', {
      id: 'sched:job:99999999999999999999',
      intent: 'do-job',
      state: 'done',
      attempts: 1,
      maxAttempts: 1,
      createdAt: T0 - 1,
      updatedAt: T0 - 1,
      nextRunAt: null,
    });
    const scheduler = new Scheduler({
      ledger,
      specs: [{ id: 'job', intent: 'do-job', every: 1_000 }],
      pollIntervalMs: 100,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_100);
    // Pre-fix: lastFired recovered as 1e20, firesBetween window was empty
    // forever — zero fires, zero errors, silent starvation.
    const ids = (await ledger.listSessions()).map((s) => s.id);
    expect(ids).toContain(`sched:job:${T0 + 1000}`);
    await scheduler.stop();
  });
});

describe('R4-HI-4: outcome timestamp validation', () => {
  it('recordOutcome rejects non-finite startedAt/endedAt before touching the store', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock: { now: () => T0 } });
    await ledger.dispatch({ id: 's1', intent: 'w', runAt: T0 });
    await ledger.claimDue(T0);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        ledger.recordOutcome('s1', { outcome: 'ok', startedAt: bad, endedAt: T0 }),
      ).rejects.toThrow(RangeError);
      await expect(
        ledger.recordOutcome('s1', { outcome: 'ok', startedAt: T0, endedAt: bad }),
      ).rejects.toThrow(RangeError);
    }
    expect(store.raw().queries).toHaveLength(0);
  });
});

describe('R4 leads: dispatch id type / contract-suite CAS checks', () => {
  it('dispatch rejects a non-string or empty id', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    for (const id of [5, {}, ''] as unknown[] as string[]) {
      await expect(ledger.dispatch({ id, intent: 'w' })).rejects.toThrow(TypeError);
    }
  });

  it('runLedgerStoreContractSuite runs the putSessionIf checks on a CAS store and passes', async () => {
    const report = await runLedgerStoreContractSuite(() => memoryStore({ cas: true }));
    expect(report.passed).toBe(true);
    expect(report.total).toBe(ledgerStoreContractCheckNames({ withPutSessionIf: true }).length);
    expect(report.total).toBeGreaterThan(ledgerStoreContractCheckNames().length);
  });

  it('a plain store still passes the base suite untouched by the CAS checks', async () => {
    const report = await runLedgerStoreContractSuite(() => memoryStore());
    expect(report.passed).toBe(true);
    expect(report.total).toBe(ledgerStoreContractCheckNames().length);
  });
});
