/**
 * Host storage battery for the testbed: silver-core-maestro-sdk's LedgerStore
 * contract over one JSON file, write-through with atomic rename.
 *
 * This is HOST code by design (the SDK ships no batteries, §7 non-goals of
 * the orchestrator requirement doc): the testbed's whole point is to be a
 * SECOND consumer implementing the seam from its documented contract alone —
 * putSession is create-or-replace by full row, listSessions applies both
 * filter fields, appendQuery is append-only, listQueries returns a session's
 * rows in append order. The contract suite (tests/store-contract.test.mjs)
 * checks this implementation against exactly those documented notes.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** @returns a LedgerStore persisted in `filePath` (created lazily). */
export function fileLedgerStore(filePath) {
  const state = existsSync(filePath)
    ? JSON.parse(readFileSync(filePath, 'utf8'))
    : { sessions: {}, queries: [] };
  const save = () => {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    renameSync(tmp, filePath);
  };
  return {
    async putSession(record) {
      state.sessions[record.id] = { ...record };
      save();
    },
    async getSession(id) {
      const r = state.sessions[id];
      return r === undefined ? null : { ...r };
    },
    async listSessions(filter) {
      let all = Object.values(state.sessions);
      if (filter?.states !== undefined) {
        all = all.filter((s) => filter.states.includes(s.state));
      }
      if (filter?.dueBefore !== undefined) {
        all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= filter.dueBefore);
      }
      return all.map((s) => ({ ...s }));
    },
    async appendQuery(record) {
      state.queries.push({ ...record });
      save();
    },
    async listQueries(sessionId) {
      return state.queries.filter((q) => q.sessionId === sessionId).map((q) => ({ ...q }));
    },
  };
}
