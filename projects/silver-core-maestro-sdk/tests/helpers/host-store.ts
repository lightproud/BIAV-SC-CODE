/**
 * In-memory LedgerStore built ONLY from the package's public surface.
 *
 * Deliberately separate from tests/helpers/memory-store.ts: that one imports
 * `../../src/ledger/...`, while these consumers import the bare specifier
 * `silver-core-maestro-sdk`. That is the point of those suites — they prove a
 * host can implement the store seam with nothing but what the package exports.
 * Merging the two helpers would quietly hand them source-level types and cost
 * the property the suites exist to check.
 *
 * Four copies of this had accumulated (three identical, one adding the optional
 * deleteSession seam behind a flag); the flag now lives here.
 */

import type {
  LedgerStore,
  QueryRecord,
  SessionFilter,
  SessionRecord,
} from 'silver-core-maestro-sdk';

export function hostStore(opts: { withDelete?: boolean } = {}): LedgerStore {
  const sessions = new Map<string, SessionRecord>();
  let queries: QueryRecord[] = [];
  const store: LedgerStore = {
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
  if (opts.withDelete === true) {
    store.deleteSession = async (id) => {
      if (!sessions.has(id)) return false;
      sessions.delete(id);
      queries = queries.filter((q) => q.sessionId !== id);
      return true;
    };
  }
  return store;
}
