/**
 * In-memory LedgerStore for tests — the single implementation.
 *
 * This fake was pasted into 12 test modules and had drifted into 9 "distinct"
 * bodies, almost all of which differed only cosmetically (`record` vs `r`,
 * hoisted vs inline filter locals). The genuine variations were four optional
 * extras, all of which are folded in here:
 *
 *  - direct access to the backing `sessions` / `queries` collections, and the
 *    `dump()` / `rows()` / `raw()` accessors different suites preferred;
 *  - `opts.cas` — install the optional `putSessionIf` compare-and-set seam;
 *  - `opts.hop` — await a pseudo-random number of microtask hops inside every
 *    method, so an interleaving test can shuffle concurrent store calls;
 *  - `failNextPutSession()` — make exactly the next putSession throw.
 *
 * With no options the behaviour is exactly the plain copies': a straight
 * Map-backed store that deep-copies on the way in and out.
 */

import type { LedgerStore, SessionFilter } from '../../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../../src/ledger/types.js';

export type MemoryStore = LedgerStore & {
  /** Backing collections, exposed for assertions on persisted shape. */
  sessions: Map<string, SessionRecord>;
  queries: QueryRecord[];
  /** Copies of the backing collections (mutation-safe assertion helpers). */
  dump: () => SessionRecord[];
  rows: () => QueryRecord[];
  raw: () => { sessions: Map<string, SessionRecord>; queries: QueryRecord[] };
  /** Arm a one-shot failure on the NEXT putSession call. */
  failNextPutSession: () => void;
};

export function memoryStore(
  opts: { cas?: boolean; hop?: () => number } = {},
): MemoryStore {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  let failPut = false;

  /** With `opts.hop`, insert a pseudo-random run of microtask hops so
   *  concurrent callers interleave differently per seed. No-op by default. */
  const yieldSome = async (): Promise<void> => {
    if (opts.hop === undefined) return;
    const hops = Math.floor(opts.hop() * 3);
    for (let i = 0; i < hops; i += 1) await Promise.resolve();
  };

  const store: MemoryStore = {
    sessions,
    queries,
    dump: () => [...sessions.values()].map((s) => ({ ...s })),
    rows: () => queries.map((q) => ({ ...q })),
    raw: () => ({ sessions, queries }),
    failNextPutSession() {
      failPut = true;
    },
    async putSession(r) {
      await yieldSome();
      if (failPut) {
        failPut = false;
        throw new Error('store hiccup');
      }
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
