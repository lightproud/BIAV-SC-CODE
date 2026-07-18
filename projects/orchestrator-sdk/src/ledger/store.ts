/**
 * Storage seam of the task ledger (SCS-REQ orchestrator-sdk §4): the SDK
 * defines the interface ONLY — implementations are host-injected (BPT wires a
 * server-side DB; tests and examples write a few-line in-memory one). The SDK
 * itself is stateless and ships no batteries (§7 non-goals).
 */

import type { QueryRecord, SessionRecord, SessionState } from './types.js';

export interface SessionFilter {
  /** Restrict to these states (unset = all). */
  states?: readonly SessionState[];
  /** Restrict to sessions with nextRunAt !== null and nextRunAt <= dueBefore. */
  dueBefore?: number;
}

/**
 * Host-injected persistence. Contract notes an implementation must honor:
 * - putSession is create-or-replace by `record.id` (records are full rows,
 *   never partial patches).
 * - listSessions applies BOTH filter fields when present.
 * - appendQuery is append-only; listQueries returns a session's rows in
 *   append order.
 * - Methods may be backed by anything (memory, SQL, KV); the ledger and the
 *   driver never assume more than this interface.
 */
export interface LedgerStore {
  putSession(record: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  listSessions(filter?: SessionFilter): Promise<SessionRecord[]>;
  appendQuery(record: QueryRecord): Promise<void>;
  listQueries(sessionId: string): Promise<QueryRecord[]>;
}
