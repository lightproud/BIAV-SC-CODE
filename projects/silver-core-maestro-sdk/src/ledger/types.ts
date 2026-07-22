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
 * requirement doc §4; `cancelled` added 0.76.0 (BPT P0-D1: a user-initiated
 * cancel is a first-class terminal outcome, ledger-distinguishable from
 * `failed` and never auto-rerun).
 *
 * - pending:   dispatched, waiting to be claimed for its first attempt
 * - running:   an attempt is in flight
 * - retrying:  last attempt failed, waiting for its scheduled retry
 * - failed:    terminal — attempts exhausted (or recorded as fatal)
 * - done:      terminal — an attempt succeeded
 * - cancelled: terminal — the host cancelled the session (cancelSession);
 *              no outgoing edges, never listed by claimDue, never swept
 */
export type SessionState = 'pending' | 'running' | 'retrying' | 'failed' | 'done' | 'cancelled';

/**
 * Query-level round result (the query row records outcomes only).
 * `cancelled` (0.76.0) marks an in-flight attempt cut short by
 * TaskLedger.cancelSession — it is written by cancelSession ONLY;
 * recordOutcome rejects it (cancellation is not an attempt outcome a host
 * executor may report, it is a session-level command).
 */
export type QueryOutcome = 'ok' | 'error' | 'timeout' | 'cancelled';

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
   * A manual-claim session (dispatched with runAt: null) keeps this null in
   * EVERY state — claimDue never lists it, including through retries.
   */
  nextRunAt: number | null;
  /**
   * True for sessions dispatched with runAt: null (manual-claim only). The
   * marker persists so the invariant survives failed attempts: recordOutcome
   * keeps nextRunAt null on 'retrying' when this is set (audit r2).
   */
  manualClaim?: boolean;
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
  /**
   * Optimistic-concurrency counter (audit r4): the ledger bumps this on every
   * session write, and — when the store implements the optional putSessionIf
   * seam — uses it to fence concurrent writers (dual-host claim exclusivity,
   * sweeper vs late lease-holder). Stores persist it like any other field;
   * legacy rows without it read as revision 0.
   */
  revision?: number;
  /**
   * Epoch ms the cancel took effect (0.76.0). Set by cancelSession ONLY —
   * present iff state is 'cancelled'; the first cancel's stamp is kept
   * through idempotent repeats. Absent on every pre-0.76.0 row.
   */
  cancelledAt?: number | null;
  /**
   * Host-supplied cancel reason (cancelSession opts.reason, e.g. 'user' |
   * 'operator' | 'superseded'), stored verbatim (0.76.0). lastError is NOT
   * repurposed for this — its "latest error/timeout summary" meaning stays
   * unpolluted, so audits can separate "why it failed" from "why it was
   * cancelled" field-by-field.
   */
  cancelReason?: string | null;
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
