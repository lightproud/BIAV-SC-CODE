import { describe, it, expect } from 'vitest';
import { TaskLedger, DuplicateSessionError } from '../src/ledger/ledger.js';
import { InvalidTransitionError } from '../src/ledger/state.js';
import type { LedgerStore, SessionFilter } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../src/ledger/types.js';

/** Minimal in-memory store for unit tests (hosts inject their own). */
function memoryStore(): LedgerStore & { sessions: Map<string, SessionRecord> } {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  return {
    sessions,
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

function testClock(startAt = 1_000) {
  let t = startAt;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const seq = () => {
  let n = 0;
  return () => `id-${(n += 1)}`;
};

describe('TaskLedger.dispatch', () => {
  it('creates a pending session, due now, attempts 0', async () => {
    const clock = testClock(5_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock, idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'patrol', payload: { shop: 42 } });
    expect(s).toMatchObject({
      id: 'id-1',
      intent: 'patrol',
      payload: { shop: 42 },
      state: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: 5_000,
      updatedAt: 5_000,
      nextRunAt: 5_000,
    });
  });

  it('honors runAt, maxAttempts override and explicit id', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: testClock() });
    const s = await ledger.dispatch({ intent: 'x', id: 'my-key', maxAttempts: 5, runAt: 9_999 });
    expect(s.id).toBe('my-key');
    expect(s.maxAttempts).toBe(5);
    expect(s.nextRunAt).toBe(9_999);
  });

  it('rejects duplicate explicit ids (idempotency key)', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: testClock() });
    await ledger.dispatch({ intent: 'x', id: 'dup' });
    await expect(ledger.dispatch({ intent: 'y', id: 'dup' })).rejects.toThrow(/already exists/);
  });

  it('rejects empty intent and bad maxAttempts', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: testClock() });
    await expect(ledger.dispatch({ intent: '' })).rejects.toThrow(TypeError);
    await expect(ledger.dispatch({ intent: 'x', maxAttempts: 0 })).rejects.toThrow(RangeError);
    await expect(ledger.dispatch({ intent: 'x', maxAttempts: 1.5 })).rejects.toThrow(RangeError);
  });
});

describe('TaskLedger.claimDue', () => {
  it('claims due pending sessions: running, attempts+1, nextRunAt cleared', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock, idFactory: seq() });
    await ledger.dispatch({ intent: 'a' });
    const claimed = await ledger.claimDue();
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ state: 'running', attempts: 1, nextRunAt: null });
  });

  it('does not claim sessions scheduled in the future', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock });
    await ledger.dispatch({ intent: 'later', runAt: 2_000 });
    expect(await ledger.claimDue()).toHaveLength(0);
    clock.advance(1_000);
    expect(await ledger.claimDue()).toHaveLength(1);
  });

  it('does not claim running or terminal sessions', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock });
    const s = await ledger.dispatch({ intent: 'a' });
    await ledger.claimDue();
    expect(await ledger.claimDue()).toHaveLength(0); // running not re-claimed
    await ledger.recordOutcome(s.id, { outcome: 'ok', startedAt: 1_000, endedAt: 1_001 });
    expect(await ledger.claimDue()).toHaveLength(0); // done not claimed
  });

  it('claims a due retrying session (retry path uses the same claim)', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({
      store: memoryStore(),
      clock,
      retry: { baseDelayMs: 500, factor: 2 },
    });
    const s = await ledger.dispatch({ intent: 'a' });
    await ledger.claimDue();
    const afterFail = await ledger.recordOutcome(s.id, {
      outcome: 'error',
      error: 'boom',
      startedAt: 1_000,
      endedAt: 1_001,
    });
    expect(afterFail.state).toBe('retrying');
    expect(afterFail.nextRunAt).toBe(1_500); // now + baseDelay after 1st failure
    expect(await ledger.claimDue()).toHaveLength(0); // not yet due
    clock.advance(500);
    const reclaimed = await ledger.claimDue();
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]).toMatchObject({ state: 'running', attempts: 2 });
  });
});

describe('TaskLedger.recordOutcome', () => {
  it('ok -> done, appends the query row with the attempt number', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock, idFactory: seq() });
    const s = await ledger.dispatch({ intent: 'a' });
    await ledger.claimDue();
    const done = await ledger.recordOutcome(s.id, {
      outcome: 'ok',
      summary: 'all good',
      startedAt: 1_000,
      endedAt: 1_050,
    });
    expect(done.state).toBe('done');
    expect(done.nextRunAt).toBeNull();
    const rows = await ledger.listQueries(s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sessionId: s.id,
      attempt: 1,
      outcome: 'ok',
      summary: 'all good',
      startedAt: 1_000,
      endedAt: 1_050,
    });
  });

  it('error with attempts exhausted -> failed, lastError kept', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock });
    const s = await ledger.dispatch({ intent: 'a', maxAttempts: 1 });
    await ledger.claimDue();
    const failed = await ledger.recordOutcome(s.id, {
      outcome: 'error',
      error: 'kaput',
      startedAt: 1_000,
      endedAt: 1_001,
    });
    expect(failed.state).toBe('failed');
    expect(failed.nextRunAt).toBeNull();
    expect(failed.lastError).toBe('kaput');
  });

  it('timeout without error text records the outcome as lastError', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock });
    const s = await ledger.dispatch({ intent: 'a', maxAttempts: 1 });
    await ledger.claimDue();
    const failed = await ledger.recordOutcome(s.id, {
      outcome: 'timeout',
      startedAt: 1_000,
      endedAt: 1_001,
    });
    expect(failed.lastError).toBe('timeout');
  });

  it('backoff grows per failed attempt and respects the session maxAttempts', async () => {
    const clock = testClock(0);
    const ledger = new TaskLedger({
      store: memoryStore(),
      clock,
      retry: { baseDelayMs: 100, factor: 3, maxDelayMs: 10_000 },
    });
    const s = await ledger.dispatch({ intent: 'a', maxAttempts: 3 });
    await ledger.claimDue();
    const r1 = await ledger.recordOutcome(s.id, { outcome: 'error', startedAt: 0, endedAt: 1 });
    expect(r1.nextRunAt).toBe(clock.now() + 100); // after attempt 1
    clock.advance(100);
    await ledger.claimDue();
    const r2 = await ledger.recordOutcome(s.id, { outcome: 'error', startedAt: 0, endedAt: 1 });
    expect(r2.state).toBe('retrying');
    expect(r2.nextRunAt).toBe(clock.now() + 300); // factor 3, after attempt 2
    clock.advance(300);
    await ledger.claimDue();
    const r3 = await ledger.recordOutcome(s.id, { outcome: 'error', startedAt: 0, endedAt: 1 });
    expect(r3.state).toBe('failed'); // attempt 3 of 3
    const rows = await ledger.listQueries(s.id);
    expect(rows.map((q) => q.attempt)).toEqual([1, 2, 3]);
  });

  it('rejects outcomes for unknown or non-running sessions', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock });
    await expect(
      ledger.recordOutcome('nope', { outcome: 'ok', startedAt: 0, endedAt: 1 }),
    ).rejects.toThrow(/unknown session/);
    const s = await ledger.dispatch({ intent: 'a' });
    await expect(
      ledger.recordOutcome(s.id, { outcome: 'ok', startedAt: 0, endedAt: 1 }),
    ).rejects.toThrowError(InvalidTransitionError); // pending, not running
  });
});

describe('TaskLedger.claimSession + DuplicateSessionError (review hardening 2026-07-18)', () => {
  it('claims exactly the named session and nothing else', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock });
    const a = await ledger.dispatch({ intent: 'a' });
    const b = await ledger.dispatch({ intent: 'b' }); // due too — must NOT be claimed
    const claimed = await ledger.claimSession(a.id);
    expect(claimed).toMatchObject({ id: a.id, state: 'running', attempts: 1, nextRunAt: null });
    expect((await ledger.getSession(b.id))?.state).toBe('pending');
  });
  it('throws on unknown id and on non-claimable states', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock });
    await expect(ledger.claimSession('nope')).rejects.toThrow(/unknown session/);
    const s = await ledger.dispatch({ intent: 'a' });
    await ledger.claimSession(s.id);
    await expect(ledger.claimSession(s.id)).rejects.toThrowError(InvalidTransitionError);
  });
  it('duplicate dispatch throws the TYPED DuplicateSessionError carrying the id', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: testClock() });
    await ledger.dispatch({ intent: 'x', id: 'dup' });
    try {
      await ledger.dispatch({ intent: 'y', id: 'dup' });
      expect.unreachable('must throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateSessionError);
      expect((e as DuplicateSessionError).sessionId).toBe('dup');
    }
  });
});

describe('audit fixes 2026-07-18 (batch A)', () => {
  // A1: an explicit-undefined override must fall back to the default, not
  // override it — { maxDelayMs: undefined } previously poisoned the backoff
  // arithmetic into nextRunAt NaN (a permanent 'retrying' wedge).
  it('A1: constructor retry-merge drops undefined overrides so defaults apply', async () => {
    const clock = testClock(0);
    const ledger = new TaskLedger({
      store: memoryStore(),
      clock,
      // Simulates { maxDelayMs: cfg.cap } with cfg.cap unset.
      retry: { baseDelayMs: 100, factor: 1_000, maxDelayMs: undefined },
    });
    const s = await ledger.dispatch({ intent: 'a', maxAttempts: 3 });
    await ledger.claimDue();
    const r1 = await ledger.recordOutcome(s.id, { outcome: 'error', startedAt: 0, endedAt: 1 });
    expect(r1.nextRunAt).toBe(clock.now() + 100);
    clock.advance(100);
    await ledger.claimDue();
    // raw = 100 * 1000 = 100_000: must be capped by the DEFAULT maxDelayMs
    // (60_000), not by undefined/NaN.
    const r2 = await ledger.recordOutcome(s.id, { outcome: 'error', startedAt: 0, endedAt: 1 });
    expect(r2.state).toBe('retrying');
    expect(r2.nextRunAt).toBe(clock.now() + 60_000);
  });

  it('A2: dispatch rejects non-finite runAt with RangeError', async () => {
    const ledger = new TaskLedger({ store: memoryStore(), clock: testClock() });
    await expect(ledger.dispatch({ intent: 'x', runAt: NaN })).rejects.toThrowError(RangeError);
    await expect(ledger.dispatch({ intent: 'x', runAt: Infinity })).rejects.toThrowError(RangeError);
    await expect(ledger.dispatch({ intent: 'x', runAt: -Infinity })).rejects.toThrowError(RangeError);
    await expect(ledger.dispatch({ intent: 'x', runAt: NaN })).rejects.toThrow(
      /runAt must be a finite number or null/,
    );
  });

  it('A2/A3: runAt null = manual-claim only — invisible to claimDue, started by claimSession', async () => {
    const clock = testClock(1_000);
    const ledger = new TaskLedger({ store: memoryStore(), clock });
    const s = await ledger.dispatch({ intent: 'inline', runAt: null });
    expect(s.nextRunAt).toBeNull();
    expect(s.state).toBe('pending');
    // A co-resident driver polling claimDue must never see it, at any time.
    expect(await ledger.claimDue()).toHaveLength(0);
    clock.advance(1_000_000);
    expect(await ledger.claimDue()).toHaveLength(0);
    // claimSession is the only way to start it.
    const claimed = await ledger.claimSession(s.id);
    expect(claimed).toMatchObject({ id: s.id, state: 'running', attempts: 1, nextRunAt: null });
  });

  // A4 (documented, not changed): the duplicate-id guard is get-then-put and
  // assumes a single writer per idempotency key; a store that cannot show the
  // racing row at get() time gets a last-write-wins put, not an error. True
  // CAS belongs to the LedgerStore implementation. This pins that documented
  // semantics.
  it('A4: duplicate guard is get-then-put — an invisible racing row is overwritten, not rejected', async () => {
    const store = memoryStore();
    const blindStore: LedgerStore = {
      ...store,
      // Simulates the race window: the concurrent writer's row is not yet
      // visible to the reader.
      async getSession() {
        return null;
      },
    };
    const ledger = new TaskLedger({ store: blindStore, clock: testClock() });
    await ledger.dispatch({ intent: 'first', id: 'race' });
    const second = await ledger.dispatch({ intent: 'second', id: 'race' });
    expect(second.intent).toBe('second');
    expect(store.sessions.get('race')?.intent).toBe('second');
  });
});
