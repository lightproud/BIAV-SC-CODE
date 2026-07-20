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
  /**
   * OPTIONAL conditional put (audit r4): atomically replace the row iff its
   * stored revision matches `expectedRevision` (comparing stored.revision ?? 0),
   * or create it iff `expectedRevision === null` and no row exists. Returns
   * whether the write was applied. The comparison and write must be atomic
   * with respect to other store calls.
   *
   * Why it exists: putSession alone cannot give claim exclusivity across
   * PROCESSES — two hosts sharing a store can both pass a get-then-put claim
   * (reproduced in audit r4: 295/300 seeded interleavings double-claimed
   * within an unexpired lease). When the store provides this method the
   * ledger uses it for every session write and concurrent claims/settles are
   * fenced; without it, the ledger serializes its OWN calls per session
   * (in-process safety) but cross-process exclusivity is the host's problem
   * — run one claiming driver per store, or implement this seam.
   */
  putSessionIf?(record: SessionRecord, expectedRevision: number | null): Promise<boolean>;
}
