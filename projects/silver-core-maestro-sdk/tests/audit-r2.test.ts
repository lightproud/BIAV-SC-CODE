/**
 * Regression locks for audit round 2 (T56): each test fails on the pre-fix
 * code. Src-side findings only — memory-tidy P1 locks live in its e2e,
 * load.ts fence-scanner locks in workflow-load.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { TaskLedger } from '../src/ledger/ledger.js';
import { InvalidTransitionError } from '../src/ledger/state.js';
import { LedgerDriver } from '../src/driver.js';
import { Scheduler } from '../src/schedule/scheduler.js';
import { nextFireAt, firesBetween } from '../src/schedule/spec.js';
import { validateGraph, GraphError } from '../src/workflow/graph.js';
import type { LedgerStore, SessionFilter } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../src/ledger/types.js';

function memoryStore(): LedgerStore & {
  sessions: Map<string, SessionRecord>;
  queries: QueryRecord[];
  failNextPutSession: () => void;
} {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  let failPut = false;
  return {
    sessions,
    queries,
    failNextPutSession() {
      failPut = true;
    },
    async putSession(r) {
      if (failPut) {
        failPut = false;
        throw new Error('store hiccup');
      }
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

const clockAt = (t: number) => ({ now: () => t });

describe('r2: recordOutcome idempotent across a caller retry (half-write split)', () => {
  it('a retry after a put-side failure settles once with exactly one row for the attempt', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock: clockAt(1_000) });
    const s = await ledger.dispatch({ intent: 'x' });
    await ledger.claimSession(s.id);
    store.failNextPutSession();
    await expect(
      ledger.recordOutcome(s.id, { outcome: 'ok', startedAt: 1, endedAt: 2 }),
    ).rejects.toThrow('store hiccup');
    // Settle-then-append (audit r4 reorder): the failed settle commits
    // NOTHING — under the r2-era append-first order this point held one row.
    expect(store.queries).toHaveLength(0);
    // The driver-style immediate retry:
    await ledger.recordOutcome(s.id, { outcome: 'ok', startedAt: 1, endedAt: 2 });
    expect(store.queries).toHaveLength(1); // one row per attempt, not two
    expect((await ledger.getSession(s.id))?.state).toBe('done');
    // A further replay cannot double-settle or double-append.
    await expect(
      ledger.recordOutcome(s.id, { outcome: 'ok', startedAt: 1, endedAt: 2 }),
    ).rejects.toThrow(InvalidTransitionError);
    expect(store.queries).toHaveLength(1);
  });
});

describe('r2: manual-claim (runAt: null) invariant survives failed attempts', () => {
  it('a retrying manual-claim session keeps nextRunAt null and stays invisible to claimDue', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock: clockAt(1_000) });
    const s = await ledger.dispatch({ intent: 'inline', runAt: null }); // maxAttempts default 3
    expect(s.manualClaim).toBe(true);
    await ledger.claimSession(s.id);
    const afterFail = await ledger.recordOutcome(s.id, {
      outcome: 'error',
      error: 'first try failed',
      startedAt: 1,
      endedAt: 2,
    });
    expect(afterFail.state).toBe('retrying');
    expect(afterFail.nextRunAt).toBeNull(); // NOT now+backoff
    expect(await ledger.claimDue(1_000_000)).toHaveLength(0); // never stolen
    // The inline caller can still retry it surgically.
    const reclaimed = await ledger.claimSession(s.id);
    expect(reclaimed.attempts).toBe(2);
  });
});

describe('r2: claimDue per-session put failure', () => {
  it('a failing put skips ONLY that session; earlier claims are still returned, nothing strands', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock: clockAt(1_000) });
    const a = await ledger.dispatch({ intent: 'a' });
    const b = await ledger.dispatch({ intent: 'b' });
    // First put (session a) succeeds, second (session b) fails:
    let puts = 0;
    const origPut = store.putSession.bind(store);
    store.putSession = async (r) => {
      puts += 1;
      if (puts === 2) throw new Error('store hiccup');
      await origPut(r);
    };
    const claimed = await ledger.claimDue();
    expect(claimed.map((s) => s.intent)).toEqual(['a']); // a returned, not stranded
    expect((await ledger.getSession(b.id))?.state).toBe('pending'); // b untouched, safe
    expect((await ledger.getSession(a.id))?.state).toBe('running');
  });
});

describe('r2: read surface returns copies', () => {
  it('mutating a record returned by getSession does not mutate ledger state', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store, clock: clockAt(1_000) });
    const s = await ledger.dispatch({ intent: 'x' });
    const read = await ledger.getSession(s.id);
    (read as SessionRecord).state = 'failed';
    expect((await ledger.getSession(s.id))?.state).toBe('pending');
  });
});

describe('r2: stale stop() must not abort the restarted generation', () => {
  it('stop()-then-start() without awaiting: the new generation attempt survives the stale abort', async () => {
    vi.useFakeTimers();
    try {
      const store = memoryStore();
      const ledger = new TaskLedger({ store });
      // claimDue blocks on first call so stop() suspends at the tick await.
      let releaseList: (() => void) | null = null;
      const origList = store.listSessions.bind(store);
      let firstList = true;
      store.listSessions = async (f?: SessionFilter) => {
        if (firstList) {
          firstList = false;
          await new Promise<void>((r) => (releaseList = r));
        }
        return origList(f);
      };
      const outcomes: string[] = [];
      const driver = new LedgerDriver({
        ledger,
        executor: async () => {
          await new Promise((r) => setTimeout(r, 200));
          return { outcome: 'ok' as const };
        },
        pollIntervalMs: 50,
        onEvent: (ev) => {
          if (ev.type === 'attempt:settle') outcomes.push(ev.outcome);
        },
      });
      await ledger.dispatch({ intent: 'work', maxAttempts: 1 });
      driver.start();
      await vi.advanceTimersByTimeAsync(0); // gen-1 tick starts, blocks in listSessions
      const stopP = driver.stop(); // suspends awaiting the blocked tick
      driver.start(); // NOT awaited stop: gen 2 opens
      await vi.advanceTimersByTimeAsync(0); // gen-2 tick claims and starts the attempt
      releaseList!(); // gen-1 tick settles; stale stop resumes
      await stopP;
      // The gen-2 attempt must complete normally, not be aborted by the stale stop.
      await vi.advanceTimersByTimeAsync(300);
      const all = await ledger.listSessions();
      expect(all[0]?.state).toBe('done');
      expect(outcomes).toEqual(['ok']);
      await driver.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('r2: scheduler recovery parses strict digit suffixes only', () => {
  it("a malformed 'sched:x:' id (empty suffix) does not recover lastFired = 0", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    try {
      const store = memoryStore();
      const ledger = new TaskLedger({ store });
      // Malformed row a conforming-but-messy store might carry:
      store.sessions.set('sched:beat:', {
        id: 'sched:beat:',
        intent: 'x',
        state: 'done',
        attempts: 1,
        maxAttempts: 1,
        createdAt: 1,
        updatedAt: 1,
        nextRunAt: null,
        payload: undefined,
      });
      const fired: string[] = [];
      const scheduler = new Scheduler({
        ledger,
        specs: [{ id: 'beat', intent: 'x', every: 1_000, catchUp: 'all' }],
        pollIntervalMs: 25,
        onEvent: (ev) => {
          if (ev.type === 'schedule:fire') fired.push(ev.sessionId);
        },
      });
      scheduler.start();
      await vi.advanceTimersByTimeAsync(1_100);
      await scheduler.stop();
      // Epoch catch-up from lastFired=0 would fire ~100 points; a fresh spec
      // fires at most one interval past start.
      expect(fired.length).toBeLessThanOrEqual(2);
      for (const id of fired) expect(Number(id.split(':')[2])).toBeGreaterThan(99_999);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('r2: spec arithmetic guards', () => {
  it('nextFireAt steps back when the division rounds up past the true smallest point', () => {
    // Construct a rounding-up division: exact (after-anchor)/every just below
    // an integer whose float division rounds to it.
    const every = 0.1;
    const after = 0.3; // 0.3/0.1 = 2.9999999999999996 in float -> floor 2 (safe)
    // and a known-up case: 0.29/0.1 = 2.9000000000000004; craft with 1.1:
    const spec = { id: 's', intent: 'x', every, anchorAt: 0 };
    const next = nextFireAt(spec, after);
    expect(next).toBeGreaterThan(after);
    // The invariant that matters: the PREVIOUS lattice point is not > after
    // (i.e. we did not skip a representable fire point).
    expect(next - every).toBeLessThanOrEqual(after + 1e-12);
  });
  it('firesBetween fast-forwards a huge backlog instead of enumerating it', () => {
    const spec = { id: 's', intent: 'x', every: 1_000, anchorAt: 0 };
    const start = Date.now();
    // A year of backlog at 1s cadence = ~31.5M points; enumeration would hang.
    const fires = firesBetween(spec, 0, 31_536_000_000, 100);
    const elapsed = Date.now() - start;
    expect(fires).toHaveLength(100);
    expect(fires[fires.length - 1]).toBe(31_536_000_000);
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('r2: graph deps shape validation', () => {
  it('rejects a string deps (not array) with GraphError instead of crashing readyNodes later', () => {
    expect(() =>
      validateGraph({
        id: 'g',
        nodes: [{ id: 'n', intent: 'x', deps: 'other' as unknown as string[] }],
      }),
    ).toThrowError(GraphError);
    expect(() =>
      validateGraph({
        id: 'g',
        nodes: [{ id: 'n', intent: 'x', deps: [42 as unknown as string] }],
      }),
    ).toThrow(/deps entries must be strings/);
  });
});
