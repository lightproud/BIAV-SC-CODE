/**
 * Task-ledger record shapes (SCS-REQ orchestrator-sdk §4).
 *
 * Two levels: session -> query. A session is the dispatch unit and carries
 * business intent; a query is one execution attempt record — one row per
 * round / per retry. goal never enters the ledger (scenario-layer semantics).
 */

/**
 * The CLOSED session state set (requirement §4: the SDK pins the state
 * machine; a uniform vocabulary is what makes one query surface serve every
 * scenario). Spelling finalized 2026-07-18 and inscribed back into the
 * requirement doc §4.
 *
 * - pending:  dispatched, waiting to be claimed for its first attempt
 * - running:  an attempt is in flight
 * - retrying: last attempt failed, waiting for its scheduled retry
 * - failed:   terminal — attempts exhausted (or recorded as fatal)
 * - done:     terminal — an attempt succeeded
 */
export type SessionState = 'pending' | 'running' | 'retrying' | 'failed' | 'done';

/** Query-level round result (the query row records outcomes only). */
export type QueryOutcome = 'ok' | 'error' | 'timeout';

/** Session record: the dispatch unit. State machine hangs at this level. */
export interface SessionRecord {
  id: string;
  /** Business intent carried by the dispatch unit (host vocabulary). */
  intent: string;
  /** Opaque host payload, stored round-trip, never interpreted by the SDK. */
  payload?: unknown;
  state: SessionState;
  /** Attempts made so far (incremented when an attempt is claimed). */
  attempts: number;
  /** Retry ceiling for this session. */
  maxAttempts: number;
  /** Epoch ms, from the injected clock. */
  createdAt: number;
  updatedAt: number;
  /**
   * When the driver should (re)run this session — the data-plane schedule:
   * set at dispatch, re-set to now+backoff on retrying, null while running
   * and once terminal. Persisted, so scheduling survives a host restart.
   */
  nextRunAt: number | null;
  /** Last attempt's error text (kept once set; cleared by nothing). */
  lastError?: string;
  /**
   * Claim lease (testbed gap G2, keeper adoption ruling 2026-07-18): when the
   * ledger is configured with claimLeaseMs, a claim stamps the moment this
   * attempt's claim expires. A `running` session whose lease has expired can
   * be safely settled by ANY driver via sweepExpiredLeases — the claiming
   * driver is dead or overrunning its lease. Absent/null = no lease (legacy
   * records and lease-less ledgers are never swept).
   */
  leaseUntil?: number | null;
}

/** Query record: one execution attempt. Rounds are appended, never edited. */
export interface QueryRecord {
  id: string;
  sessionId: string;
  /** 1-based attempt number within the session. */
  attempt: number;
  startedAt: number;
  endedAt: number;
  outcome: QueryOutcome;
  error?: string;
  /** Bounded, host-facing result summary (data plane; rendering is host-side). */
  summary?: string;
}
