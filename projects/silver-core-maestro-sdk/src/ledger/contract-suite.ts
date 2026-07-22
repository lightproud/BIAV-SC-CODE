/**
 * LedgerStore contract test suite (testbed gap G1, keeper adoption ruling
 * 2026-07-18): a self-contained, framework-free checker any LedgerStore
 * implementation can be run through — the deliverable counterpart of the
 * agent SDK's runMemoryStoreContractSuite. A hosting application validates
 * its injected store with
 *
 *   const report = await runLedgerStoreContractSuite(() => makeMyStore());
 *
 * — passing is the definition of contract compliance. Every check receives a
 * FRESH store from the factory, so checks are order-independent and a
 * partially-failing implementation still yields a full report. The checks
 * are exactly the documented contract notes on the LedgerStore interface:
 * putSession is create-or-replace by full row, listSessions applies BOTH
 * filter fields, appendQuery is append-only, listQueries returns a session's
 * rows in append order, and returned records are safe copies.
 */

import type { LedgerStore } from './store.js';
import type { QueryRecord, SessionRecord } from './types.js';

/** Same-file sentinel: a check failure (caught into the report, never thrown
 *  across the suite boundary). */
class ContractCheckFailure extends Error {
  override name = 'ContractCheckFailure';
}

export type LedgerStoreContractResult = {
  name: string;
  ok: boolean;
  /** Failure detail when ok is false. */
  error?: string;
};

export type LedgerStoreContractReport = {
  passed: boolean;
  total: number;
  failed: number;
  results: LedgerStoreContractResult[];
};

function fail(label: string, detail: string): never {
  throw new ContractCheckFailure(`${label}: ${detail}`);
}

function assertDeepEq(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(label, `\n  expected: ${e}\n  actual:   ${a}`);
}

const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  intent: 'contract',
  state: 'pending',
  attempts: 0,
  maxAttempts: 3,
  createdAt: 1_000,
  updatedAt: 1_000,
  nextRunAt: 1_000,
  ...over,
});

const query = (over: Partial<QueryRecord> = {}): QueryRecord => ({
  id: 'q1',
  sessionId: 's1',
  attempt: 1,
  startedAt: 1_000,
  endedAt: 1_001,
  outcome: 'ok',
  ...over,
});

type Check = (store: LedgerStore) => Promise<void>;

const CHECKS: Array<[string, Check]> = [
  [
    'getSession returns null for an unknown id',
    async (store) => {
      const got = await store.getSession('missing');
      if (got !== null) fail('unknown id', `expected null, got ${JSON.stringify(got)}`);
    },
  ],
  [
    'putSession/getSession round-trips a full row (payload, lastError, leaseUntil)',
    async (store) => {
      const rec = session({
        payload: { deep: [1, { two: 2 }] },
        lastError: 'boom',
        leaseUntil: 2_500,
      });
      await store.putSession(rec);
      assertDeepEq(await store.getSession('s1'), rec, 'round-trip');
    },
  ],
  [
    'putSession is create-or-replace by id (full row, never a partial patch)',
    async (store) => {
      await store.putSession(session({ lastError: 'old' }));
      await store.putSession(session({ state: 'running', attempts: 1, nextRunAt: null }));
      const got = await store.getSession('s1');
      if (got === null) fail('replace', 'row vanished');
      if (got.state !== 'running' || got.nextRunAt !== null) {
        fail('replace', `replacement row not honored: ${JSON.stringify(got)}`);
      }
      if ('lastError' in got && got.lastError !== undefined) {
        fail('replace', `stale field survived a full-row replace: lastError=${got.lastError}`);
      }
    },
  ],
  [
    'returned session records are copies, not live references into the store',
    async (store) => {
      await store.putSession(session());
      const viaGet = await store.getSession('s1');
      if (viaGet !== null) viaGet.state = 'failed';
      const [viaList] = await store.listSessions();
      if (viaList !== undefined) viaList.state = 'failed';
      const fresh = await store.getSession('s1');
      if (fresh?.state !== 'pending') {
        fail('copies', `caller mutation leaked into the store: state=${fresh?.state}`);
      }
    },
  ],
  [
    'listSessions without a filter returns every session',
    async (store) => {
      await store.putSession(session());
      await store.putSession(session({ id: 's2', state: 'done', nextRunAt: null }));
      const ids = (await store.listSessions()).map((s) => s.id).sort();
      assertDeepEq(ids, ['s1', 's2'], 'list-all');
    },
  ],
  [
    'listSessions applies the states filter',
    async (store) => {
      await store.putSession(session());
      await store.putSession(session({ id: 's2', state: 'retrying', nextRunAt: 2_000 }));
      await store.putSession(session({ id: 's3', state: 'done', nextRunAt: null }));
      const ids = (await store.listSessions({ states: ['pending', 'retrying'] }))
        .map((s) => s.id)
        .sort();
      assertDeepEq(ids, ['s1', 's2'], 'states filter');
    },
  ],
  [
    'listSessions applies dueBefore (nextRunAt non-null and <= dueBefore)',
    async (store) => {
      await store.putSession(session({ id: 'due', nextRunAt: 500 }));
      await store.putSession(session({ id: 'later', nextRunAt: 5_000 }));
      await store.putSession(session({ id: 'unscheduled', state: 'running', nextRunAt: null }));
      const ids = (await store.listSessions({ dueBefore: 1_000 })).map((s) => s.id);
      assertDeepEq(ids, ['due'], 'dueBefore filter');
    },
  ],
  [
    'listSessions applies BOTH filter fields together',
    async (store) => {
      await store.putSession(session({ id: 'hit', state: 'retrying', nextRunAt: 500 }));
      await store.putSession(session({ id: 'wrong-state', state: 'done', nextRunAt: 500 }));
      await store.putSession(session({ id: 'not-due', state: 'retrying', nextRunAt: 9_000 }));
      const ids = (await store.listSessions({ states: ['retrying'], dueBefore: 1_000 })).map(
        (s) => s.id,
      );
      assertDeepEq(ids, ['hit'], 'combined filter');
    },
  ],
  [
    'listQueries of an unknown session is empty',
    async (store) => {
      assertDeepEq(await store.listQueries('missing'), [], 'unknown session queries');
    },
  ],
  [
    'appendQuery is append-only and listQueries preserves append order',
    async (store) => {
      await store.appendQuery(query({ id: 'q1', outcome: 'error', error: 'x' }));
      await store.appendQuery(query({ id: 'q2', attempt: 2, outcome: 'timeout' }));
      await store.appendQuery(query({ id: 'q3', attempt: 3, summary: 'fine' }));
      const rows = await store.listQueries('s1');
      assertDeepEq(rows.map((q) => q.id), ['q1', 'q2', 'q3'], 'append order');
      if (rows[0]?.error !== 'x' || rows[2]?.summary !== 'fine') {
        fail('append order', 'row fields not preserved');
      }
    },
  ],
  [
    'listQueries isolates sessions from each other',
    async (store) => {
      await store.appendQuery(query({ id: 'qa', sessionId: 'a' }));
      await store.appendQuery(query({ id: 'qb', sessionId: 'b' }));
      await store.appendQuery(query({ id: 'qa2', sessionId: 'a', attempt: 2 }));
      assertDeepEq((await store.listQueries('a')).map((q) => q.id), ['qa', 'qa2'], 'isolation a');
      assertDeepEq((await store.listQueries('b')).map((q) => q.id), ['qb'], 'isolation b');
    },
  ],
  [
    "putSession/getSession round-trips a cancelled row (state 'cancelled', cancelledAt, cancelReason) and a 'cancelled' query outcome",
    async (store) => {
      // 0.76.0 (BPT P0-D1): a store must persist the cancelled terminal
      // byte-for-byte — a host restart must reload it as cancelled, never
      // resurrect it into the retry path.
      const rec = session({
        state: 'cancelled',
        attempts: 1,
        nextRunAt: null,
        leaseUntil: null,
        cancelledAt: 3_000,
        cancelReason: 'user',
      });
      await store.putSession(rec);
      assertDeepEq(await store.getSession('s1'), rec, 'cancelled round-trip');
      const listed = await store.listSessions({ states: ['cancelled'] });
      assertDeepEq(listed.map((s) => s.id), ['s1'], 'cancelled states filter');
      await store.appendQuery(query({ outcome: 'cancelled', error: 'user' }));
      const [row] = await store.listQueries('s1');
      if (row?.outcome !== 'cancelled') {
        fail('cancelled outcome', `expected 'cancelled', got ${row?.outcome}`);
      }
    },
  ],
  [
    'returned query records are copies, not live references into the store',
    async (store) => {
      await store.appendQuery(query());
      const [row] = await store.listQueries('s1');
      if (row !== undefined) row.outcome = 'error';
      const [fresh] = await store.listQueries('s1');
      if (fresh?.outcome !== 'ok') {
        fail('query copies', `caller mutation leaked into the store: outcome=${fresh?.outcome}`);
      }
    },
  ],
];

/**
 * OPTIONAL putSessionIf checks (audit r4): run only when the store under test
 * implements the conditional-put seam. A store without it is fully compliant
 * with the base contract — these never count against it.
 */
const CAS_CHECKS: Array<[string, Check]> = [
  [
    'putSessionIf(record, null) creates iff absent',
    async (store) => {
      const created = await store.putSessionIf!(session({ revision: 1 }), null);
      if (created !== true) fail('cas create', 'create-if-absent on an empty store returned false');
      const again = await store.putSessionIf!(session({ revision: 1, intent: 'rival' }), null);
      if (again !== false) fail('cas create', 'create-if-absent on an existing row returned true');
      const got = await store.getSession('s1');
      if (got?.intent !== 'contract') fail('cas create', 'losing create overwrote the row');
    },
  ],
  [
    'putSessionIf replaces iff the stored revision matches (stored.revision ?? 0)',
    async (store) => {
      await store.putSession(session({ revision: 1 }));
      const won = await store.putSessionIf!(session({ state: 'running', revision: 2 }), 1);
      if (won !== true) fail('cas replace', 'matching expected revision was rejected');
      const lost = await store.putSessionIf!(session({ state: 'done', revision: 2 }), 1);
      if (lost !== false) fail('cas replace', 'stale expected revision was accepted');
      const got = await store.getSession('s1');
      if (got?.state !== 'running') fail('cas replace', `losing write applied: state=${got?.state}`);
    },
  ],
  [
    'putSessionIf treats a legacy row without revision as revision 0',
    async (store) => {
      await store.putSession(session());
      const won = await store.putSessionIf!(session({ state: 'running', revision: 1 }), 0);
      if (won !== true) fail('cas legacy', 'expected revision 0 rejected for a legacy row');
    },
  ],
];

/** The check names, in run order (for report display / count pinning).
 *  Base checks only; pass { withPutSessionIf: true } to include the optional
 *  conditional-put checks appended when a store implements that seam. */
export function ledgerStoreContractCheckNames(opts?: { withPutSessionIf?: boolean }): string[] {
  const names = CHECKS.map(([name]) => name);
  return opts?.withPutSessionIf === true
    ? [...names, ...CAS_CHECKS.map(([name]) => name)]
    : names;
}

/**
 * Run every contract check, each against a fresh store from the factory.
 * Never throws — implementation failures land in the report. When the store
 * implements putSessionIf, the optional conditional-put checks run too.
 */
export async function runLedgerStoreContractSuite(
  makeStore: () => LedgerStore | Promise<LedgerStore>,
): Promise<LedgerStoreContractReport> {
  // The probe must not violate the never-throws contract: a throwing factory
  // falls back to the base checks, each of which lands the failure in the
  // report through its own makeStore call.
  let hasCas = false;
  try {
    hasCas = (await makeStore()).putSessionIf !== undefined;
  } catch {
    hasCas = false;
  }
  const checks = hasCas ? [...CHECKS, ...CAS_CHECKS] : CHECKS;
  const results: LedgerStoreContractResult[] = [];
  for (const [name, check] of checks) {
    try {
      await check(await makeStore());
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  return { passed: failed === 0, total: results.length, failed, results };
}
