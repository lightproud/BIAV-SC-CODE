/**
 * Reopen semantics (T67 / design review F5 — keeper ruling 2026-07-26, 甲案:
 * a NEW session that links back, not a `failed -> pending` edge).
 *
 * The ruling's substance, restated so a future reader does not "simplify" it
 * away: terminal immutability is what the CAS fence, idempotent dispatch and
 * "a restart never resurrects a settled session" all rest on. An in-place
 * reopen would make `done`/`failed` mean "settled for now" and put every
 * invariant that treats a terminal as final back up for audit. What was
 * missing was never an edge — it was the LINK. Hosts already reopened by
 * minting ids of their own (`store-patrol.mjs` appended `:r2`, `:r3`) and paid
 * for it with one logical job scattered across rows nothing tied together.
 */
import { describe, it, expect } from 'vitest';
import {
  TaskLedger,
  DuplicateSessionError,
  type LedgerStore,
  type QueryRecord,
  type SessionFilter,
  type SessionRecord,
} from 'silver-core-maestro-sdk';

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

const ledgerOf = (): TaskLedger => new TaskLedger({ store: hostStore() });

/** Dispatch `id` and drive it to a terminal state. */
async function settle(
  ledger: TaskLedger,
  id: string,
  outcome: 'ok' | 'error',
  opts: { maxAttempts?: number; payload?: unknown; intent?: string } = {},
): Promise<SessionRecord> {
  await ledger.dispatch({
    id,
    intent: opts.intent ?? 'work',
    maxAttempts: opts.maxAttempts ?? 1,
    ...(opts.payload !== undefined ? { payload: opts.payload } : {}),
  });
  const claimed = await ledger.claimSession(id, Date.now());
  return ledger.recordOutcome(id, {
    outcome,
    startedAt: 1,
    endedAt: 2,
    attempt: claimed.attempts,
    ...(outcome === 'error' ? { error: 'boom' } : {}),
  });
}

describe('reopenSession', () => {
  it('mints a linked successor and leaves the predecessor untouched', async () => {
    const ledger = ledgerOf();
    const first = await settle(ledger, 'job', 'error');
    expect(first.state).toBe('failed');
    const second = await ledger.reopenSession('job');
    expect([second.id, second.state, second.reopenOf, second.attemptRound]).toEqual([
      'job#r2',
      'pending',
      'job',
      2,
    ]);
    // Terminal immutability: the predecessor is byte-for-byte what it was.
    const predecessor = await ledger.getSession('job');
    expect([predecessor?.state, predecessor?.attempts]).toEqual(['failed', 1]);
    expect(predecessor?.reopenOf).toBeUndefined();
  });

  it('inherits intent / payload / maxAttempts, and each can be overridden', async () => {
    const ledger = ledgerOf();
    // maxAttempts 4 with an OK outcome: the point is the ceiling is inherited,
    // and 'done' is terminal in one attempt (an error would land in 'retrying').
    await settle(ledger, 'job', 'ok', { maxAttempts: 4, payload: { a: 1 }, intent: 'patrol' });
    const inherited = await ledger.reopenSession('job');
    expect([inherited.intent, inherited.maxAttempts]).toEqual(['patrol', 4]);
    expect(inherited.payload).toEqual({ a: 1 });

    await ledger.claimSession('job#r2', Date.now());
    await ledger.recordOutcome('job#r2', {
      outcome: 'ok', startedAt: 1, endedAt: 2, attempt: 1,
    });
    const overridden = await ledger.reopenSession('job#r2', {
      intent: 'patrol-v2',
      payload: { a: 2 },
      maxAttempts: 1,
    });
    expect([overridden.intent, overridden.maxAttempts]).toEqual(['patrol-v2', 1]);
    expect(overridden.payload).toEqual({ a: 2 });
  });

  it('the payload override matters: inheriting stale config reruns the wrong thing', async () => {
    // Not a hypothetical — the store-patrol e2e caught exactly this when the
    // example first switched to reopenSession: the retry inherited the old
    // target and re-hit the endpoint it was supposed to be moving off.
    const ledger = ledgerOf();
    await settle(ledger, 'job', 'error', { payload: { url: 'http://old/hang' } });
    const fresh = await ledger.reopenSession('job', { payload: { url: 'http://new/ok' } });
    expect(fresh.payload).toEqual({ url: 'http://new/ok' });
  });

  it('refuses a NON-terminal predecessor', async () => {
    const ledger = ledgerOf();
    await ledger.dispatch({ id: 'job', intent: 'work' });
    await expect(ledger.reopenSession('job')).rejects.toThrow(/is 'pending', not terminal/);
    await ledger.claimSession('job', Date.now());
    await expect(ledger.reopenSession('job')).rejects.toThrow(/is 'running', not terminal/);
  });

  it('refuses a CANCELLED predecessor unless forced, and says why', async () => {
    // "Stop this, forever" must not be undone by a routine retry loop.
    const ledger = ledgerOf();
    await ledger.dispatch({ id: 'job', intent: 'work' });
    await ledger.cancelSession('job', { reason: 'user' });
    await expect(ledger.reopenSession('job')).rejects.toThrow(/was cancelled \(user\)/);
    const forced = await ledger.reopenSession('job', { force: true });
    expect([forced.id, forced.reopenOf]).toEqual(['job#r2', 'job']);
  });

  it('reopens a DONE session too (rerun, not just repair)', async () => {
    const ledger = ledgerOf();
    await settle(ledger, 'job', 'ok');
    const again = await ledger.reopenSession('job');
    expect([again.state, again.attemptRound]).toEqual(['pending', 2]);
  });

  it('rejects an unknown predecessor', async () => {
    await expect(ledgerOf().reopenSession('nope')).rejects.toThrow(/unknown session 'nope'/);
  });

  it('uses `#` not `:` — `:` is the reserved session-key separator', async () => {
    // schedule / workflow / goal / delivery all forbid ':' inside their id
    // segments; a reopen id built with ':' would collide with those grammars.
    const ledger = ledgerOf();
    await settle(ledger, 'sched-like', 'error');
    const reopened = await ledger.reopenSession('sched-like');
    expect(reopened.id).not.toContain(':');
    expect(reopened.id).toContain('#r2');
  });

  it('successor ids are derived from the chain ROOT, not the predecessor', async () => {
    // Appending to the predecessor would accumulate: job#r2#r3#r4... The first
    // run of this very test caught it. Flat ids keep the chain greppable by one
    // prefix, which is what the hand-rolled `:rN` conventions were reaching for.
    const ledger = ledgerOf();
    await settle(ledger, 'job', 'error');
    const second = await ledger.reopenSession('job');
    await ledger.claimSession(second.id, Date.now());
    await ledger.recordOutcome(second.id, {
      outcome: 'error', error: 'boom', startedAt: 1, endedAt: 2, attempt: 1,
    });
    const third = await ledger.reopenSession(second.id);
    expect([second.id, third.id]).toEqual(['job#r2', 'job#r3']);
    expect(third.id).not.toContain('#r2#');
  });

  it('a racing second reopen loses on the duplicate-id guard', async () => {
    const ledger = ledgerOf();
    await settle(ledger, 'job', 'error');
    await ledger.reopenSession('job');
    await expect(ledger.reopenSession('job')).rejects.toBeInstanceOf(DuplicateSessionError);
  });

  it('an explicit id overrides the default convention', async () => {
    const ledger = ledgerOf();
    await settle(ledger, 'job', 'error');
    const custom = await ledger.reopenSession('job', { id: 'job-take-two' });
    expect([custom.id, custom.reopenOf, custom.attemptRound]).toEqual(['job-take-two', 'job', 2]);
  });
});

describe('reopenChain', () => {
  /** Build job -> job#r2 -> job#r3, all failed except the last. */
  async function chainOfThree(ledger: TaskLedger): Promise<void> {
    await settle(ledger, 'job', 'error');
    const second = await ledger.reopenSession('job');
    await ledger.claimSession(second.id, Date.now());
    await ledger.recordOutcome(second.id, {
      outcome: 'error', error: 'boom', startedAt: 1, endedAt: 2, attempt: 1,
    });
    await ledger.reopenSession(second.id);
  }

  it('returns the whole chain oldest-first from ANY member', async () => {
    // The point of the API: an auditor holding one row should not have to know
    // whether it is the first or the last.
    const ledger = ledgerOf();
    await chainOfThree(ledger);
    const expected = ['job', 'job#r2', 'job#r3'];
    for (const entry of expected) {
      expect((await ledger.reopenChain(entry)).map((s) => s.id)).toEqual(expected);
    }
  });

  it('rounds increase monotonically along the chain', async () => {
    const ledger = ledgerOf();
    await chainOfThree(ledger);
    const rounds = (await ledger.reopenChain('job')).map((s) => s.attemptRound ?? 1);
    expect(rounds).toEqual([1, 2, 3]);
  });

  it('a session with no reopens is a chain of one', async () => {
    const ledger = ledgerOf();
    await settle(ledger, 'solo', 'ok');
    expect((await ledger.reopenChain('solo')).map((s) => s.id)).toEqual(['solo']);
  });

  it('an unknown id yields an empty chain, not a throw', async () => {
    expect(await ledgerOf().reopenChain('nope')).toEqual([]);
  });

  it('a self-referential row cannot hang the walk', async () => {
    // A hand-edited store (or a restore from a bad backup) can point a chain at
    // itself; the walk must terminate rather than spin.
    const store = hostStore();
    const ledger = new TaskLedger({ store });
    await ledger.dispatch({ id: 'loop', intent: 'work' });
    const row = (await store.getSession('loop')) as SessionRecord;
    await store.putSession({ ...row, reopenOf: 'loop' });
    expect((await ledger.reopenChain('loop')).map((s) => s.id)).toEqual(['loop']);
  });

  it('returns copies, not live store rows', async () => {
    const ledger = ledgerOf();
    await settle(ledger, 'job', 'error');
    const [row] = await ledger.reopenChain('job');
    (row as SessionRecord).intent = 'mutated';
    expect((await ledger.getSession('job'))?.intent).toBe('work');
  });
});
