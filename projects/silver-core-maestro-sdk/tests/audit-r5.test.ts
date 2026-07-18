/**
 * T56 audit round 5 — regression locks, one per confirmed finding (plus the
 * adopted leads), each asserting the FIXED behavior and failing on 0.73.0.
 * Findings: backfill-branch hardening (R5-1/2/3, new-code lens), the
 * settle-then-append window leaking to upper layers, the delivery channel
 * vs co-resident sweep, the driver's false "stranded" repair signal
 * (upper-layer lens). Battle report r5 is the detail authority.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskLedger, ClaimConflictError } from '../src/ledger/ledger.js';
import { InvalidTransitionError } from '../src/ledger/state.js';
import { LedgerDriver, type DriverEvent } from '../src/driver.js';
import { Scheduler } from '../src/schedule/scheduler.js';
import { createDeliveryChannel } from '../src/delivery/channel.js';
import type { LedgerStore, SessionFilter } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../src/ledger/types.js';

function memoryStore(opts: { cas?: boolean } = {}): LedgerStore & {
  raw: () => { sessions: Map<string, SessionRecord>; queries: QueryRecord[] };
} {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  const store: ReturnType<typeof memoryStore> = {
    raw: () => ({ sessions, queries }),
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
  if (opts.cas === true) {
    store.putSessionIf = async (r, expected) => {
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

describe('R5-3: backfill fenced against divergent rival rows (CAS put->append gap)', () => {
  it('a rival backfill with a DIVERGENT error is rejected; the true winner retry with the SAME payload heals', async () => {
    const store = memoryStore({ cas: true });
    let failAppends = false;
    const realAppend = store.appendQuery.bind(store);
    store.appendQuery = async (r) => {
      if (failAppends) throw new Error('append down');
      await realAppend(r);
    };
    const hostA = new TaskLedger({ store, clock: { now: () => T0 } });
    const hostB = new TaskLedger({ store, clock: { now: () => T0 } });
    await hostA.dispatch({ id: 'S', intent: 'w', maxAttempts: 1, runAt: T0 });
    await hostA.claimDue(T0);
    // A settles 'error' but its append crashes: state failed, lastError set,
    // row missing — the exact put->append gap.
    failAppends = true;
    await expect(
      hostA.recordOutcome('S', {
        outcome: 'error', error: 'real failure', startedAt: T0, endedAt: T0, attempt: 1,
      }),
    ).rejects.toThrow(/append down/);
    failAppends = false;
    // Pre-fix: B's divergent backfill ('timeout', different error) appended
    // unconditionally — two contradictory rows once A's retry also landed.
    await expect(
      hostB.recordOutcome('S', {
        outcome: 'timeout', error: 'late host backfill', startedAt: T0, endedAt: T0, attempt: 1,
      }),
    ).rejects.toThrow(InvalidTransitionError);
    expect(store.raw().queries).toHaveLength(0);
    // The true winner's consistent retry (same payload) backfills.
    const healed = await hostA.recordOutcome('S', {
      outcome: 'error', error: 'real failure', startedAt: T0, endedAt: T0, attempt: 1,
    });
    expect(healed.state).toBe('failed');
    const rows = await hostA.listQueries('S');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.error).toBe('real failure');
    expect(rows[0]!.error).toBe((await hostA.getSession('S'))!.lastError);
  });
});

describe('R5-2: retrying-state settle has the same backfill repair as terminal', () => {
  it('a consistent retry after an append crash on a RETRYING settle backfills instead of detonating', async () => {
    const store = memoryStore();
    let failAppends = false;
    const realAppend = store.appendQuery.bind(store);
    store.appendQuery = async (r) => {
      if (failAppends) throw new Error('append down');
      await realAppend(r);
    };
    const ledger = new TaskLedger({ store, clock: { now: () => T0 } });
    await ledger.dispatch({ id: 'S', intent: 'w', maxAttempts: 2, runAt: T0 });
    await ledger.claimDue(T0);
    failAppends = true;
    await expect(
      ledger.recordOutcome('S', { outcome: 'error', error: 'x', startedAt: T0, endedAt: T0, attempt: 1 }),
    ).rejects.toThrow(/append down/);
    expect((await ledger.getSession('S'))!.state).toBe('retrying');
    failAppends = false;
    // Pre-fix: threw InvalidTransitionError ('attempt:error' in 'retrying')
    // and the attempt-1 row was lost forever once attempt 2 was claimed.
    const repaired = await ledger.recordOutcome('S', {
      outcome: 'error', error: 'x', startedAt: T0, endedAt: T0, attempt: 1,
    });
    expect(repaired.state).toBe('retrying');
    const rows = await ledger.listQueries('S');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempt).toBe(1);
    // A DIVERGENT retry still detonates (no forged rows).
    await expect(
      ledger.recordOutcome('S', { outcome: 'error', error: 'forged', startedAt: T0, endedAt: T0, attempt: 1 }),
    ).rejects.toThrow(InvalidTransitionError);
  });
});

describe('R5-1: attempt-omitted consistent retry backfills (doc: current attempt assumed)', () => {
  it('an unfenced retry heals a lost terminal row exactly like a fenced one', async () => {
    const store = memoryStore();
    let failAppends = false;
    const realAppend = store.appendQuery.bind(store);
    store.appendQuery = async (r) => {
      if (failAppends) throw new Error('append down');
      await realAppend(r);
    };
    const ledger = new TaskLedger({ store, clock: { now: () => T0 } });
    await ledger.dispatch({ id: 'S', intent: 'w', maxAttempts: 1, runAt: T0 });
    await ledger.claimDue(T0);
    failAppends = true;
    await expect(
      ledger.recordOutcome('S', { outcome: 'ok', startedAt: T0, endedAt: T0 }),
    ).rejects.toThrow(/append down/);
    failAppends = false;
    // Pre-fix: the backfill guard required an EXPLICIT matching attempt, so
    // the unfenced retry threw and the row stayed lost.
    const healed = await ledger.recordOutcome('S', { outcome: 'ok', startedAt: T0, endedAt: T0 });
    expect(healed.state).toBe('done');
    expect(await ledger.listQueries('S')).toHaveLength(1);
  });
});

describe('R5 upper-layer A1: same-instance reads are serialized behind the settle+append', () => {
  it('a reader never observes terminal state with the settled row still missing', async () => {
    const store = memoryStore();
    let gate: (() => void) | null = null;
    const realAppend = store.appendQuery.bind(store);
    store.appendQuery = async (r) => {
      // Park the append until released — models any nonzero-latency store.
      await new Promise<void>((resolve) => (gate = resolve));
      await realAppend(r);
    };
    const ledger = new TaskLedger({ store, clock: { now: () => T0 } });
    await ledger.dispatch({ id: 'S', intent: 'w', maxAttempts: 1, runAt: T0 });
    await ledger.claimDue(T0);
    const settling = ledger.recordOutcome('S', {
      outcome: 'ok', summary: 'DEP-SUMMARY', startedAt: T0, endedAt: T0, attempt: 1,
    });
    // Let the settle reach the parked append (session already 'done' in the
    // raw store — the pre-fix window).
    await vi.waitFor(() => expect(gate).not.toBeNull());
    expect(store.raw().sessions.get('S')!.state).toBe('done');
    // Pre-fix: getSession returned 'done' while listQueries returned [] —
    // WorkflowRun persisted a null dep summary from exactly this read.
    const read = (async () => {
      const session = await ledger.getSession('S');
      const rows = await ledger.listQueries('S');
      return { session, rows };
    })();
    // The locked read must be pending until the append lands.
    let readSettled = false;
    void read.then(() => (readSettled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(readSettled).toBe(false);
    gate!();
    const { session, rows } = await read;
    await settling;
    expect(session!.state).toBe('done');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toBe('DEP-SUMMARY');
  });
});

describe('R5 upper-layer A2: deliver() vs co-resident lease sweep', () => {
  it('sink success mid-sweep: receipt {delivered: true}, no InvalidTransitionError escape', async () => {
    const store = memoryStore();
    let now = T0;
    const ledger = new TaskLedger({ store, clock: { now: () => now }, claimLeaseMs: 100 });
    let releaseSink: (() => void) | null = null;
    const channel = createDeliveryChannel({
      ledger,
      clock: { now: () => now },
      sink: () => new Promise<void>((resolve) => (releaseSink = resolve)),
    });
    const receiptP = channel.deliver({ body: 'hello' });
    await vi.waitFor(() => expect(releaseSink).not.toBeNull());
    // Co-resident driver tick: lease expires, sweep settles the audit session.
    now = T0 + 200;
    const swept = await ledger.sweepExpiredLeases(now);
    expect(swept).toHaveLength(1);
    releaseSink!();
    // Pre-fix: deliver() REJECTED with InvalidTransitionError although the
    // message was actually sent — the receipt was lost.
    const receipt = await receiptP;
    expect(receipt.delivered).toBe(true);
  });

  it('sink failure mid-sweep: receipt {delivered: false, error}, no throw', async () => {
    const store = memoryStore();
    let now = T0;
    const ledger = new TaskLedger({ store, clock: { now: () => now }, claimLeaseMs: 100 });
    let rejectSink: ((err: Error) => void) | null = null;
    const channel = createDeliveryChannel({
      ledger,
      clock: { now: () => now },
      sink: () => new Promise<void>((_resolve, reject) => (rejectSink = reject)),
    });
    const receiptP = channel.deliver({ body: 'hello' });
    await vi.waitFor(() => expect(rejectSink).not.toBeNull());
    now = T0 + 200;
    await ledger.sweepExpiredLeases(now);
    rejectSink!(new Error('sink down'));
    const receipt = await receiptP;
    expect(receipt.delivered).toBe(false);
    expect(receipt.error).toBe('sink down');
  });

  it('kill round: the absorb is NARROW — a generic claim-path store failure still rethrows', async () => {
    const store = memoryStore();
    let failPuts = false;
    const realPut = store.putSession.bind(store);
    store.putSession = async (r) => {
      if (failPuts && r.state === 'running') throw new Error('store down');
      await realPut(r);
    };
    const ledger = new TaskLedger({ store, clock: { now: () => T0 } });
    const channel = createDeliveryChannel({ ledger, clock: { now: () => T0 }, sink: async () => {} });
    failPuts = true;
    // Audit-before-send contract: a ledger/store failure is a hard error —
    // only ClaimConflictError converts to a failed receipt.
    await expect(channel.deliver({ body: 'hello' })).rejects.toThrow(/store down/);
  });

  it('kill round: bookkeeping actually lands on the happy path (record is not a no-op)', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock: { now: () => T0 } });
    const channel = createDeliveryChannel({ ledger, clock: { now: () => T0 }, sink: async () => {} });
    const receipt = await channel.deliver({ body: 'hello' });
    expect(receipt.delivered).toBe(true);
    const session = (await ledger.getSession(receipt.sessionId))!;
    expect(session.state).toBe('done');
    const rows = await ledger.listQueries(receipt.sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe('ok');
  });

  it('kill round: a generic recordOutcome store failure is NOT absorbed — deliver rethrows', async () => {
    const store = memoryStore();
    let armed = false;
    const realAppend = store.appendQuery.bind(store);
    store.appendQuery = async (r) => {
      if (armed) throw new Error('append exploded');
      await realAppend(r);
    };
    const ledger = new TaskLedger({ store, clock: { now: () => T0 } });
    const channel = createDeliveryChannel({
      ledger,
      clock: { now: () => T0 },
      sink: async () => {
        armed = true;
      },
    });
    // Only InvalidTransitionError/ClaimConflictError (lease-race semantics)
    // are absorbed; a real store failure must surface.
    await expect(channel.deliver({ body: 'hello' })).rejects.toThrow(/append exploded/);
  });

  it('claimSession losing the store CAS returns a failed receipt instead of throwing (lead)', async () => {
    const store = memoryStore({ cas: true });
    const realCas = store.putSessionIf!.bind(store);
    let sabotageNext = false;
    store.putSessionIf = async (r, expected) => {
      if (sabotageNext && r.state === 'running') {
        sabotageNext = false;
        return false; // rival won the claim CAS
      }
      return realCas(r, expected);
    };
    const ledger = new TaskLedger({ store, clock: { now: () => T0 } });
    const channel = createDeliveryChannel({
      ledger,
      clock: { now: () => T0 },
      sink: async () => {},
    });
    sabotageNext = true;
    const receipt = await channel.deliver({ body: 'hello' });
    expect(receipt.delivered).toBe(false);
    expect(receipt.error).toMatch(/concurrent writer/);
  });
});

describe('R5 upper-layer A3: driver:error repair signal only for genuinely stranded sessions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('after a lease sweep settles the attempt, the late fenced outcome emits driver:error WITHOUT a session', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({
      store,
      claimLeaseMs: 30,
      retry: { maxAttempts: 3, baseDelayMs: 60_000, factor: 2, maxDelayMs: 120_000 },
    });
    const events: DriverEvent[] = [];
    let releaseExecutor: (() => void) | null = null;
    const driver = new LedgerDriver({
      ledger,
      pollIntervalMs: 20,
      onEvent: (e) => events.push(e),
      executor: () =>
        new Promise((resolve) => {
          releaseExecutor = () => resolve({ outcome: 'ok' });
        }),
    });
    await ledger.dispatch({ id: 'S', intent: 'w', maxAttempts: 3, runAt: T0 });
    driver.start();
    await vi.advanceTimersByTimeAsync(25); // claim, executor parks
    expect(releaseExecutor).not.toBeNull();
    await vi.advanceTimersByTimeAsync(40); // lease expires; tick sweeps -> retrying
    releaseExecutor!();
    await vi.advanceTimersByTimeAsync(25); // late outcome fenced out
    await driver.stop();
    const errors = events.filter((e) => e.type === 'driver:error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    // Pre-fix: the event carried a STALE 'running' snapshot of a session the
    // store already had in healthy self-healing 'retrying' — hosts following
    // the repair guidance would force-settle a live record.
    for (const e of errors) {
      expect((e as { session?: SessionRecord }).session).toBeUndefined();
    }
    expect(store.raw().sessions.get('S')!.state).toBe('retrying');
  });

  it('a genuinely stranded session (store puts down) still emits WITH the current record', async () => {
    const store = memoryStore();
    let failPuts = false;
    const realPut = store.putSession.bind(store);
    store.putSession = async (r) => {
      if (failPuts) throw new Error('store down');
      await realPut(r);
    };
    const ledger = new TaskLedger({ store });
    const events: DriverEvent[] = [];
    const driver = new LedgerDriver({
      ledger,
      pollIntervalMs: 20,
      onEvent: (e) => events.push(e),
      executor: async () => {
        failPuts = true; // both bookkeeping writes will fail
        return { outcome: 'ok' };
      },
    });
    await ledger.dispatch({ id: 'S', intent: 'w', runAt: T0 });
    driver.start();
    await vi.advanceTimersByTimeAsync(25);
    failPuts = false;
    await driver.stop();
    const errors = events.filter(
      (e): e is Extract<DriverEvent, { type: 'driver:error' }> => e.type === 'driver:error',
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.session?.state).toBe('running');
  });
});

describe('R5 lead: fractional-every footprints survive scheduler restart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recovery parses a fractional fireAt suffix instead of silently re-anchoring', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store });
    // A fire footprint minted by a fractional cadence (validateSpec allows
    // every: 500.5, so ids like this exist in real ledgers).
    const fireAt = T0 - 249.5; // = anchor T0-1000.5 + 1.5 periods — value form is what matters
    store.raw().sessions.set(`sched:job:${fireAt}`, {
      id: `sched:job:${fireAt}`,
      intent: 'do-job',
      state: 'done',
      attempts: 1,
      maxAttempts: 1,
      createdAt: fireAt,
      updatedAt: fireAt,
      nextRunAt: null,
    });
    const scheduler = new Scheduler({
      ledger,
      specs: [{ id: 'job', intent: 'do-job', every: 500.5, anchorAt: 0, catchUp: 'all' }],
      pollIntervalMs: 100,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(150);
    // Pre-fix: /^\d+$/ rejected the fractional suffix, the footprint was
    // invisible, and recovery re-anchored at now (or seedFirstRun replayed
    // already-fired points). With the fix, only points AFTER the recovered
    // footprint fire.
    const fired = (await ledger.listSessions())
      .map((s) => s.id)
      .filter((id) => id.startsWith('sched:job:') && id !== `sched:job:${fireAt}`);
    for (const id of fired) {
      expect(Number(id.slice('sched:job:'.length))).toBeGreaterThan(fireAt);
    }
    await scheduler.stop();
  });
});
