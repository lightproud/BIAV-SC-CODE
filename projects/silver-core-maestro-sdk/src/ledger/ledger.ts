/**
 * TaskLedger (SCS-REQ orchestrator-sdk §4): the public bookkeeping API over
 * the host-injected store, applying the pure state-machine core. It never
 * runs anything and holds no timers — execution and the clock's driving hand
 * belong to the driver; the ledger only computes and records.
 *
 * Concurrency model (audit r4):
 * - Every mutating path is serialized PER SESSION in-process (a promise-chain
 *   mutex), so a single TaskLedger instance never races itself between its
 *   read and its write — concurrent recordOutcome calls cannot double-append,
 *   and a sweep cannot clobber an outcome committed by a co-resident caller.
 * - Cross-process fencing rides the store's OPTIONAL putSessionIf seam (see
 *   store.ts): when present, every session write is a compare-and-swap on the
 *   row's revision counter and rival hosts lose cleanly; when absent, run one
 *   claiming driver per store.
 * - recordOutcome accepts an optional attempt number: a fenced write from a
 *   lease-swept, re-claimed attempt throws InvalidTransitionError instead of
 *   stealing the live attempt's slot. The SDK's own callers (driver, delivery
 *   channel, lease sweep) always pass it.
 */

import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import type { LedgerStore, SessionFilter } from './store.js';
import type { QueryOutcome, QueryRecord, SessionRecord } from './types.js';
import type { RetryPolicy } from './state.js';
import { DEFAULT_RETRY_POLICY, InvalidTransitionError, backoffDelayMs, transition } from './state.js';

export interface TaskLedgerOptions {
  store: LedgerStore;
  /** Injectable time source (driver-grade Clock accepted; only now() is used). */
  clock?: Pick<Clock, 'now'>;
  /** Record id factory (default crypto.randomUUID). */
  idFactory?: () => string;
  /** Retry policy defaults for sessions that don't override maxAttempts. */
  retry?: Partial<RetryPolicy>;
  /**
   * Claim lease duration in ms (gap G2). When set, every claim stamps
   * leaseUntil = now + claimLeaseMs, and sweepExpiredLeases() can settle
   * `running` sessions whose lease has expired (dead driver / kill -9) back
   * into the normal retry path. Only EXPIRED leases are touched. Set it
   * comfortably above the worst-case attempt duration (driver queryTimeoutMs
   * included): a live attempt that outruns its lease will be swept, and its
   * late recordOutcome then fails with InvalidTransitionError — including
   * after the session has been re-claimed for the next attempt, PROVIDED the
   * caller passes the attempt number it is settling (the SDK's own callers
   * all do; audit r4 fencing). Cross-process sweep-vs-holder races are only
   * fully fenced when the store implements putSessionIf (see store.ts).
   * Unset = no leases (prior behavior byte-for-byte).
   */
  claimLeaseMs?: number;
}

export interface DispatchInput {
  /** Business intent (required, non-empty). */
  intent: string;
  payload?: unknown;
  maxAttempts?: number;
  /** Explicit id (host-side idempotency key); duplicate dispatch throws. */
  id?: string;
  /**
   * Earliest run time (epoch ms; must be finite — NaN/Infinity throw
   * RangeError, they would otherwise make the session never-due forever).
   * `null` = manual-claim only: nextRunAt persists as null, so claimDue NEVER
   * lists the session and claimSession is the only way to start it (the
   * race-free dispatch-then-run-inline pattern). Default: now.
   */
  runAt?: number | null;
}

export interface OutcomeInput {
  /**
   * The attempt's result. 'cancelled' is REJECTED here (RangeError):
   * cancellation is a session-level command owned by cancelSession, never
   * an outcome an executor may report.
   */
  outcome: QueryOutcome;
  error?: string;
  summary?: string;
  /** Epoch ms; must be finite (audit r4: NaN survives JSON round-trips as null). */
  startedAt: number;
  endedAt: number;
  /**
   * The attempt number this outcome settles (audit r4 fencing). When set and
   * it does not match the session's CURRENT attempt, recordOutcome throws
   * InvalidTransitionError — a stale writer (lease-swept attempt whose
   * session was re-claimed) can no longer steal the live attempt's query row
   * or terminally settle the session with an outdated result. Omitted =
   * unfenced legacy behavior (the current attempt is assumed).
   */
  attempt?: number;
}

export interface CancelSessionInput {
  /**
   * Cancel reason, stored verbatim as the session's cancelReason (and as the
   * in-flight attempt's query-row error text when cancelling from `running`).
   * Host vocabulary — e.g. 'user' | 'operator' | 'superseded'.
   */
  reason?: string;
  /** Epoch ms the cancel takes effect; defaults to the injected clock's now(). */
  cancelledAt?: number;
}

const outcomeEvent = {
  ok: 'attempt:ok',
  error: 'attempt:error',
  timeout: 'attempt:timeout',
} as const;

/**
 * Thrown by dispatch() on a duplicate explicit id. A TYPED error, so
 * idempotent dispatchers (scheduler, workflow run) can swallow exactly this
 * and nothing else — matching /already exists/ on the message would also
 * swallow coincidental store failures (e.g. a file store's EEXIST) and drop
 * fires permanently (review finding 2026-07-18).
 */
export class DuplicateSessionError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`dispatch: session '${sessionId}' already exists`);
    this.name = 'DuplicateSessionError';
    this.sessionId = sessionId;
  }
}

/**
 * Thrown when a session write loses the store-level compare-and-swap to a
 * concurrent writer (only possible on stores implementing putSessionIf) and
 * the operation cannot be transparently retried into a consistent result.
 */
export class ClaimConflictError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string, detail: string) {
    super(`session '${sessionId}': ${detail}`);
    this.name = 'ClaimConflictError';
    this.sessionId = sessionId;
  }
}

export class TaskLedger {
  readonly #store: LedgerStore;
  readonly #clock: Pick<Clock, 'now'>;
  readonly #idFactory: () => string;
  readonly #retry: RetryPolicy;
  readonly #claimLeaseMs: number | undefined;
  /** Per-session in-process mutex tails (deleted when the queue drains). */
  readonly #locks = new Map<string, Promise<void>>();

  constructor(opts: TaskLedgerOptions) {
    this.#store = opts.store;
    this.#clock = opts.clock ?? systemClock;
    this.#idFactory = opts.idFactory ?? (() => crypto.randomUUID());
    // A Partial<RetryPolicy> may carry EXPLICIT undefined values (e.g.
    // { maxDelayMs: cfg.cap } where cfg.cap is unset); a plain spread would
    // let those override the defaults with undefined and poison the backoff
    // arithmetic — drop them so the default applies instead.
    const overrides = Object.fromEntries(
      Object.entries(opts.retry ?? {}).filter(([, value]) => value !== undefined),
    ) as Partial<RetryPolicy>;
    this.#retry = { ...DEFAULT_RETRY_POLICY, ...overrides };
    // Eager policy validation (audit r4): a poisoned policy (factor NaN,
    // negative baseDelayMs) used to detonate inside recordOutcome AFTER the
    // query row was appended — a half-write that wedged the session in
    // 'running' forever. Reject where the numbers enter instead.
    if (!Number.isInteger(this.#retry.maxAttempts) || this.#retry.maxAttempts < 1) {
      throw new RangeError(
        `TaskLedger: retry.maxAttempts must be an integer >= 1, got ${this.#retry.maxAttempts}`,
      );
    }
    for (const key of ['baseDelayMs', 'factor', 'maxDelayMs'] as const) {
      const value = this.#retry[key];
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`TaskLedger: retry.${key} must be a finite number >= 0, got ${value}`);
      }
    }
    if (
      opts.claimLeaseMs !== undefined &&
      (!Number.isFinite(opts.claimLeaseMs) || opts.claimLeaseMs <= 0)
    ) {
      throw new RangeError(
        `TaskLedger: claimLeaseMs must be a finite number > 0, got ${opts.claimLeaseMs}`,
      );
    }
    this.#claimLeaseMs = opts.claimLeaseMs;
  }

  /** Serialize fn behind every earlier mutation of the same session. */
  async #withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const tail = prev.then(() => new Promise<void>((resolve) => (release = resolve)));
    this.#locks.set(id, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      // Synchronous with release: nothing can enqueue between the two lines,
      // so deleting only when we are still the tail cannot orphan a waiter.
      if (this.#locks.get(id) === tail) this.#locks.delete(id);
    }
  }

  /**
   * Write a session row, bumping its revision. Uses the store's conditional
   * put when available (expected = the revision the caller read, or null for
   * create-only); plain putSession otherwise. Returns whether the write won.
   */
  async #putGuarded(record: SessionRecord, expected: number | null): Promise<boolean> {
    const stamped: SessionRecord = { ...record, revision: (expected ?? 0) + 1 };
    if (this.#store.putSessionIf !== undefined) {
      return this.#store.putSessionIf(stamped, expected);
    }
    await this.#store.putSession(stamped);
    return true;
  }

  /**
   * Create a session in `pending`, due immediately unless runAt says later
   * (or runAt is null = manual-claim only, see DispatchInput.runAt).
   *
   * Duplicate-id guard: in-process dispatches of the same id are serialized
   * by the per-session mutex, and on a putSessionIf store the create is a
   * true atomic create-if-absent (a cross-process race loser gets
   * DuplicateSessionError). On a plain putSession store, cross-PROCESS
   * dispatches of the same id can still both pass the get and last-write-wins
   * — the single-writer-per-idempotency-key assumption documented on the
   * store seam.
   */
  async dispatch(input: DispatchInput): Promise<SessionRecord> {
    if (typeof input.intent !== 'string' || input.intent.length === 0) {
      throw new TypeError('dispatch: intent must be a non-empty string');
    }
    // A non-string id (any-cast number, object) would become the row key via
    // coercion in some stores and a mismatch in others (audit r4 lead).
    if (input.id !== undefined && (typeof input.id !== 'string' || input.id.length === 0)) {
      throw new TypeError(`dispatch: id must be a non-empty string, got ${typeof input.id}`);
    }
    const maxAttempts = input.maxAttempts ?? this.#retry.maxAttempts;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError(`dispatch: maxAttempts must be an integer >= 1, got ${maxAttempts}`);
    }
    // A non-finite runAt (NaN/Infinity) fails every `<= now` due-check, so the
    // session would sit pending forever without ever being listed as due.
    if (input.runAt !== undefined && input.runAt !== null && !Number.isFinite(input.runAt)) {
      throw new RangeError(`dispatch: runAt must be a finite number or null, got ${input.runAt}`);
    }
    const id = input.id ?? this.#idFactory();
    return this.#withLock(id, async () => {
      const existing = await this.#store.getSession(id);
      if (existing !== null) {
        throw new DuplicateSessionError(id);
      }
      const now = this.#clock.now();
      const record: SessionRecord = {
        id,
        intent: input.intent,
        payload: input.payload,
        state: 'pending',
        attempts: 0,
        maxAttempts,
        createdAt: now,
        updatedAt: now,
        nextRunAt: input.runAt === undefined ? now : input.runAt,
        // Persisted marker (audit r2): the manual-claim-only property must
        // survive a failed attempt — without it, recordOutcome's retrying
        // branch would set a numeric nextRunAt and a co-resident driver's
        // claimDue would steal the retry, contradicting the documented
        // "claimSession is the only way to start it" contract.
        ...(input.runAt === null ? { manualClaim: true } : {}),
      };
      const won = await this.#putGuarded(record, null);
      if (!won) {
        throw new DuplicateSessionError(id);
      }
      return { ...record, revision: 1 };
    });
  }

  /**
   * Claim every due session (pending or retrying with nextRunAt <= now) for
   * an attempt: state -> running, attempts += 1, nextRunAt cleared. Returns
   * the claimed records; the caller (normally the driver) runs them.
   *
   * Sessions dispatched with runAt: null have no nextRunAt and are NEVER
   * listed here (the dueBefore filter requires nextRunAt !== null) — that is
   * what makes dispatch({ runAt: null }) + claimSession race-free against a
   * co-resident driver polling claimDue.
   */
  async claimDue(now: number = this.#clock.now()): Promise<SessionRecord[]> {
    if (!Number.isFinite(now)) {
      throw new RangeError(`claimDue: now must be a finite number, got ${now}`);
    }
    const due = await this.#store.listSessions({
      states: ['pending', 'retrying'],
      dueBefore: now,
    });
    const claimed: SessionRecord[] = [];
    for (const listed of due) {
      // Per-session isolation (audit r2): one session's failure must not
      // abandon the rest of the batch. A session whose claim write is not
      // applied is simply not returned; whatever the store actually holds
      // (untouched on fail-before-effect, running-with-lease on
      // apply-then-throw) is settled by the next poll or the lease sweep.
      try {
        const won = await this.#withLock(listed.id, async () => {
          // Re-read inside the lock (audit r4): the listing is a stale
          // snapshot — a concurrent claimSession/sweep/outcome may have moved
          // the session since.
          const session = await this.#store.getSession(listed.id);
          if (session === null) return null;
          if (session.state !== 'pending' && session.state !== 'retrying') return null;
          if (session.nextRunAt === null || session.nextRunAt > now) return null;
          const next = transition(session.state, 'claim', session);
          const updated: SessionRecord = {
            ...session,
            state: next,
            attempts: session.attempts + 1,
            nextRunAt: null,
            updatedAt: now,
            leaseUntil: this.#claimLeaseMs !== undefined ? now + this.#claimLeaseMs : null,
          };
          const applied = await this.#putGuarded(updated, session.revision ?? 0);
          return applied ? { ...updated, revision: (session.revision ?? 0) + 1 } : null;
        });
        if (won !== null) claimed.push(won);
      } catch {
        continue;
      }
    }
    return claimed;
  }

  /**
   * Claim ONE session by id for an attempt (state -> running, attempts += 1).
   * The surgical sibling of claimDue for callers that execute inline (the
   * delivery channel) — claimDue would claim EVERY due session in the store
   * and steal a co-resident driver's work (review finding 2026-07-18).
   * Unlike claimDue this claims regardless of nextRunAt — including null:
   * the caller created the session and is executing it now. Inline callers
   * should dispatch with runAt: null so the session is invisible to claimDue
   * in the dispatch->claim window; claimSession is then the ONLY way the
   * session can start. Throws ClaimConflictError if a rival host wins the
   * store-level compare-and-swap (putSessionIf stores only).
   */
  async claimSession(sessionId: string, now: number = this.#clock.now()): Promise<SessionRecord> {
    if (!Number.isFinite(now)) {
      throw new RangeError(`claimSession: now must be a finite number, got ${now}`);
    }
    return this.#withLock(sessionId, async () => {
      const session = await this.#store.getSession(sessionId);
      if (session === null) {
        throw new Error(`claimSession: unknown session '${sessionId}'`);
      }
      const next = transition(session.state, 'claim', session);
      const updated: SessionRecord = {
        ...session,
        state: next,
        attempts: session.attempts + 1,
        nextRunAt: null,
        updatedAt: now,
        leaseUntil: this.#claimLeaseMs !== undefined ? now + this.#claimLeaseMs : null,
      };
      const won = await this.#putGuarded(updated, session.revision ?? 0);
      if (!won) {
        throw new ClaimConflictError(sessionId, 'claim lost to a concurrent writer');
      }
      return { ...updated, revision: (session.revision ?? 0) + 1 };
    });
  }

  /**
   * Settle every `running` session whose claim lease has expired (gap G2):
   * the claiming driver is dead (kill -9, power loss) or overran its lease.
   * If the ledger already holds a committed query row for the expired attempt
   * (a crash between appendQuery and putSession), the session is settled
   * according to THAT row — the committed outcome is the truth, not a
   * fabricated lease-expired error (audit r4). Otherwise the attempt is
   * recorded as an error and the session re-enters the normal retry/backoff
   * path (or exhausts into failed). Sessions without a lease are NEVER
   * touched, and neither are cancelled sessions (0.76.0): the sweep lists
   * `running` alone, and cancelSession clears leaseUntil at the moment it
   * settles the terminal — a cancelled session can never look like an
   * expired claim. Per-session isolation: one session's settle failure
   * (including losing a race to the late lease-holder) skips that session
   * only.
   */
  async sweepExpiredLeases(now: number = this.#clock.now()): Promise<SessionRecord[]> {
    if (!Number.isFinite(now)) {
      throw new RangeError(`sweepExpiredLeases: now must be a finite number, got ${now}`);
    }
    // A lease-less ledger is a TRUE no-op — zero store calls (the driver
    // invokes this every poll tick; a leased record can only exist where some
    // ledger instance was configured with claimLeaseMs, and sweeping such
    // records is that configuration's job).
    if (this.#claimLeaseMs === undefined) return [];
    const running = await this.#store.listSessions({ states: ['running'] });
    const swept: SessionRecord[] = [];
    for (const session of running) {
      if (session.leaseUntil === undefined || session.leaseUntil === null) continue;
      if (session.leaseUntil > now) continue;
      try {
        swept.push(
          await this.recordOutcome(session.id, {
            outcome: 'error',
            error: `lease-expired: claim lease ran out at ${session.leaseUntil} (driver dead or overrunning)`,
            startedAt: session.updatedAt,
            endedAt: now,
            // Fence on the expired attempt: if the holder settled it (or the
            // session was re-claimed) between our listing and this write, the
            // fence/transition throws and the catch skips the session.
            attempt: session.attempts,
          }),
        );
      } catch {
        continue;
      }
    }
    return swept;
  }

  /**
   * Record one attempt's outcome: applies the pure transition (retrying while
   * attempts remain, terminal otherwise), schedules nextRunAt by exponential
   * backoff on retrying, then appends the query row. The session write is
   * the commit point (settle-then-append, audit r4); a crash between the two
   * loses the audit row, never the state, and a consistent caller retry
   * backfills the missing row.
   *
   * Reconciliation (audit r4): if a row for the current attempt is ALREADY
   * committed, the transition follows the COMMITTED row's outcome — a retry
   * or lease sweep arriving with a different outcome converges to the
   * ledger's own recorded truth instead of settling the session in
   * contradiction with its query history.
   */
  async recordOutcome(sessionId: string, result: OutcomeInput): Promise<SessionRecord> {
    // 'cancelled' is a session-level command, not an attempt outcome (0.76.0):
    // it may only enter the ledger through cancelSession, which owns the
    // terminal transition, the lease/nextRunAt clearing and the audit row.
    // Accepting it here would let an executor smuggle a cancel past the
    // cancel semantics (no cancelledAt stamp, retry arithmetic applied).
    if (result.outcome === 'cancelled') {
      throw new RangeError(
        "recordOutcome: outcome 'cancelled' is reserved for cancelSession()",
      );
    }
    for (const key of ['startedAt', 'endedAt'] as const) {
      // NaN/Infinity would be persisted verbatim into the append-only audit
      // row — and a JSON-backed store silently rewrites NaN to null,
      // violating the QueryRecord number contract (audit r4).
      if (!Number.isFinite(result[key])) {
        throw new RangeError(`recordOutcome: ${key} must be a finite number, got ${result[key]}`);
      }
    }
    if (
      result.attempt !== undefined &&
      (!Number.isInteger(result.attempt) || result.attempt < 1)
    ) {
      throw new RangeError(
        `recordOutcome: attempt must be an integer >= 1 when given, got ${result.attempt}`,
      );
    }
    return this.#withLock(sessionId, async () => {
      const session = await this.#store.getSession(sessionId);
      if (session === null) {
        throw new Error(`recordOutcome: unknown session '${sessionId}'`);
      }
      // The entry guard rejected 'cancelled'; re-assert the narrowing for
      // this closure (TS narrowing does not cross function boundaries).
      const attemptOutcome = result.outcome as Exclude<QueryOutcome, 'cancelled'>;
      // Attempt fencing (audit r4): a stale writer — an attempt that outran
      // its lease, was swept, and whose session has since been re-claimed —
      // must NOT commit against the live attempt. Keyed on the attempt
      // number the caller claims to be settling.
      if (result.attempt !== undefined && result.attempt !== session.attempts) {
        throw new InvalidTransitionError(
          session.state,
          outcomeEvent[attemptOutcome],
          `stale outcome: settles attempt ${result.attempt} but the session is on attempt ${session.attempts}`,
        );
      }
      // Cancelled is terminal with NO backfill repair (0.76.0): the cancel's
      // audit row belongs to cancelSession, and a late attempt result — the
      // in-flight executor the host aborted alongside its cancel — must not
      // settle or append anything. The driver drops exactly this rejection
      // instead of signaling a stranded session (see driver.ts).
      if (session.state === 'cancelled') {
        throw new InvalidTransitionError(session.state, outcomeEvent[attemptOutcome]);
      }
      const existing = await this.#store.listQueries(sessionId);
      const committed = existing.find((q) => q.attempt === session.attempts);
      // Backfill eligibility (audit r4, hardened in r5): a caller retry after
      // the settle put succeeded but the row append crashed may repair the
      // missing audit row. Conditions: no committed row; the caller settles
      // the CURRENT attempt (an omitted attempt is assumed current, per the
      // OutcomeInput doc — r5); and the payload is CONSISTENT with what the
      // settle recorded — outcome kind must match the settled state, and for
      // failure kinds the error text must equal the session's lastError (r5:
      // without the error-match gate, a rival host inside the winner's
      // put->append gap could backfill a DIVERGENT row with no CAS to stop
      // it). An ok-kind backfill has no recorded text to cross-check —
      // residual trust in the caller, documented.
      const backfillable = (settledAs: 'ok' | 'failure'): boolean =>
        committed === undefined &&
        (result.attempt ?? session.attempts) === session.attempts &&
        (settledAs === 'ok'
          ? result.outcome === 'ok'
          : result.outcome !== 'ok' &&
            (result.error ?? result.outcome) === session.lastError);
      // Terminal branch: the attempt is already settled; backfill or throw
      // exactly as the transition graph dictates (terminal states accept no
      // event) — never both, and a rejected call never touches the store.
      if (session.state === 'done' || session.state === 'failed') {
        if (backfillable(session.state === 'done' ? 'ok' : 'failure')) {
          await this.#store.appendQuery(this.#queryRow(sessionId, session.attempts, result));
          return { ...session };
        }
        throw new InvalidTransitionError(session.state, outcomeEvent[attemptOutcome]);
      }
      // Retrying backfill (r5): a failure settle that landed in 'retrying'
      // has the same put->append crash window as a terminal one, and the
      // documented repair contract ("a consistent caller retry backfills the
      // missing row") must hold there too — without this branch the retry
      // detonated on transition('retrying', attempt:*) and the row was lost
      // for good once the next attempt was claimed.
      if (session.state === 'retrying' && backfillable('failure')) {
        await this.#store.appendQuery(this.#queryRow(sessionId, session.attempts, result));
        return { ...session };
      }
      // A committed 'cancelled' row for the current attempt can only be
      // written by cancelSession, whose session put (state 'cancelled') lands
      // FIRST (settle-then-append) — reading such a row while the session
      // still shows a non-terminal state means this call raced a rival
      // host's cancel on a store without putSessionIf. The cancel is the
      // recorded truth; this attempt result is late and must not clobber
      // the cancel record (defensive; unreachable on a CAS-fenced store,
      // where the revision fence below would reject the write anyway).
      if (committed !== undefined && committed.outcome === 'cancelled') {
        throw new InvalidTransitionError(
          session.state,
          outcomeEvent[attemptOutcome],
          'attempt already cancelled by a concurrent cancelSession',
        );
      }
      // A committed row for the CURRENT attempt is the truth (audit r4): a
      // caller retry — or a lease sweep arriving with a fabricated error —
      // converges to the recorded outcome instead of settling the session in
      // contradiction with its own query history.
      const effective: Pick<OutcomeInput, 'outcome' | 'error'> = committed ?? result;
      const next = transition(
        session.state,
        outcomeEvent[effective.outcome as Exclude<QueryOutcome, 'cancelled'>],
        session,
      );
      const now = this.#clock.now();
      const updated: SessionRecord = {
        ...session,
        state: next,
        updatedAt: now,
        // A manual-claim session keeps nextRunAt null even through 'retrying'
        // (audit r2): the retry is still the inline caller's to start via
        // claimSession — claimDue must never see it.
        nextRunAt:
          next === 'retrying' && session.manualClaim !== true
            ? now + backoffDelayMs(session.attempts, { ...this.#retry, maxAttempts: session.maxAttempts })
            : null,
        // The attempt is settled either way — its claim lease is spent.
        leaseUntil: null,
        ...(effective.outcome !== 'ok'
          ? { lastError: effective.error ?? effective.outcome }
          : {}),
      };
      // Settle-then-append (audit r4): the session write is the COMMIT POINT,
      // so on a putSessionIf store a cross-host settle race (sweeper vs late
      // lease-holder) is decided before either side writes its query row —
      // the loser fails the CAS here and never appends, so the append-only
      // store cannot end up holding two contradictory rows for one attempt.
      // (The earlier append-first order let both racers append before the
      // session write picked a winner.) A crash inside the put-append window
      // loses the row, not the state — repaired by the backfill branch above.
      const won = await this.#putGuarded(updated, session.revision ?? 0);
      if (!won) {
        throw new ClaimConflictError(sessionId, 'outcome write lost to a concurrent writer');
      }
      if (committed === undefined) {
        await this.#store.appendQuery(this.#queryRow(sessionId, session.attempts, result));
      }
      return { ...updated, revision: (session.revision ?? 0) + 1 };
    });
  }

  /**
   * Cancel a session (0.76.0, BPT P0-D1): the host's "stop this, forever"
   * command — a first-class terminal, ledger-distinguishable from `failed`.
   * Legal from every non-terminal state:
   *
   * - pending / retrying: no attempt in flight — the session lands in
   *   `cancelled` with nextRunAt cleared (a scheduled retry is dropped, not
   *   deferred), and NO query row is appended (fabricating an attempt number
   *   would pollute the per-attempt audit history).
   * - running: the in-flight attempt is the host's to abort (the ledger
   *   holds no executors); this call records its epitaph — one query row
   *   with outcome 'cancelled' on the current attempt (error = opts.reason)
   *   — and clears leaseUntil so the spent claim can never be mistaken for
   *   an expired one. The aborted executor's own late recordOutcome then
   *   rejects with InvalidTransitionError, which the driver drops silently.
   *
   * Idempotent on an already-cancelled session: returns the stored record,
   * throws nothing, appends nothing, and keeps the FIRST cancel's
   * cancelledAt/cancelReason. On `done`/`failed` it throws
   * InvalidTransitionError — terminal states accept no event, a settled
   * outcome is not rewritable into a cancellation.
   *
   * Concurrency: per-session in-process mutex + the putSessionIf CAS fence,
   * like every other mutating path. A lost CAS is re-read and re-applied
   * (bounded): cancel is legal from every non-terminal state, so whatever
   * the rival wrote (a claim, a settle into retrying), the cancel still
   * lands; if the rival reached done/failed first, the re-read throws
   * InvalidTransitionError — the attempt genuinely finished before the
   * cancel. A crash between the session put (the commit point) and the
   * running-cancel's row append loses the audit row, never the state —
   * same settle-then-append discipline as recordOutcome, minus the backfill
   * (a repeat cancel cannot distinguish that window from a retrying-cancel
   * whose failure row was legitimately committed earlier, so it repairs
   * nothing rather than risk a wrong row).
   */
  async cancelSession(sessionId: string, opts?: CancelSessionInput): Promise<SessionRecord> {
    if (opts?.reason !== undefined && typeof opts.reason !== 'string') {
      throw new TypeError(`cancelSession: reason must be a string when given, got ${typeof opts.reason}`);
    }
    // A non-finite cancelledAt would poison the terminal timestamp verbatim
    // (JSON stores rewrite NaN to null — the audit r4 lesson, same guard).
    if (opts?.cancelledAt !== undefined && !Number.isFinite(opts.cancelledAt)) {
      throw new RangeError(
        `cancelSession: cancelledAt must be a finite number when given, got ${opts.cancelledAt}`,
      );
    }
    return this.#withLock(sessionId, async () => {
      // Bounded CAS retry: a rival's interleaved write (claim, settle) moves
      // the session between our read and our put, but cancel remains legal
      // from every non-terminal state — re-read and re-apply instead of
      // surfacing a transient conflict for a call that must win eventually.
      for (let round = 0; ; round += 1) {
        const session = await this.#store.getSession(sessionId);
        if (session === null) {
          throw new Error(`cancelSession: unknown session '${sessionId}'`);
        }
        if (session.state === 'cancelled') {
          // Idempotent repeat: the first cancel's record is the truth.
          return { ...session };
        }
        // Throws InvalidTransitionError on done/failed (terminal, no edges).
        const next = transition(session.state, 'cancel', session);
        const wasRunning = session.state === 'running';
        const now = this.#clock.now();
        const cancelledAt = opts?.cancelledAt ?? now;
        const updated: SessionRecord = {
          ...session,
          state: next,
          updatedAt: now,
          // Terminal: never due again — and the in-flight claim (if any) is
          // spent, so no residual lease can ever look expired to a sweeper.
          nextRunAt: null,
          leaseUntil: null,
          cancelledAt,
          cancelReason: opts?.reason ?? null,
        };
        const won = await this.#putGuarded(updated, session.revision ?? 0);
        if (!won) {
          if (round >= 4) {
            throw new ClaimConflictError(sessionId, 'cancel lost to concurrent writers repeatedly');
          }
          continue;
        }
        if (wasRunning) {
          // Epitaph row for the aborted in-flight attempt — appended AFTER
          // the session write (settle-then-append, audit r4 ordering).
          // startedAt = the claim's stamp (same convention as the lease
          // sweep); a row already committed for this attempt (a cross-host
          // settle we raced on a plain store) is the truth and is kept.
          const committed = (await this.#store.listQueries(sessionId)).find(
            (q) => q.attempt === session.attempts,
          );
          if (committed === undefined) {
            await this.#store.appendQuery({
              id: this.#idFactory(),
              sessionId,
              attempt: session.attempts,
              startedAt: session.updatedAt,
              endedAt: cancelledAt,
              outcome: 'cancelled',
              ...(opts?.reason !== undefined ? { error: opts.reason } : {}),
            });
          }
        }
        return { ...updated, revision: (session.revision ?? 0) + 1 };
      }
    });
  }

  #queryRow(sessionId: string, attempt: number, result: OutcomeInput): QueryRecord {
    return {
      id: this.#idFactory(),
      sessionId,
      attempt,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      outcome: result.outcome,
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
    };
  }

  // --- Query surface (§4: one query set serving every scenario). -----------

  // Read surface returns SHALLOW COPIES (audit r2): the store contract does
  // not promise defensive copies, and handing back live store rows would let
  // a host mutate ledger state through a read. (payload stays a shared
  // reference by design — it is host-owned opaque data.)
  //
  // Per-session reads take the session's mutex (r5): recordOutcome's
  // settle-then-append makes the terminal state briefly visible BEFORE its
  // query row lands, and a same-instance reader in that window saw
  // 'done' + zero rows — WorkflowRun then persisted a null dep summary and
  // GoalChaser judged a verdict on missing data. Serializing reads behind
  // in-flight mutations of the SAME ledger instance closes that window
  // where it was reproduced; a reader on a DIFFERENT instance/process can
  // still land inside another host's put->append gap (treat 'terminal but
  // row missing' as 'row not yet readable' if that matters to you).
  // listSessions is store-wide and takes no lock.
  async getSession(id: string): Promise<SessionRecord | null> {
    return this.#withLock(id, async () => {
      const row = await this.#store.getSession(id);
      return row === null ? null : { ...row };
    });
  }

  async listSessions(filter?: SessionFilter): Promise<SessionRecord[]> {
    return (await this.#store.listSessions(filter)).map((row) => ({ ...row }));
  }

  /**
   * A session's query rows in append order, canonicalized to ONE row per
   * attempt. Among duplicates the LAST committed row wins (r5): duplicates
   * only arise from cross-host races, and there the later append is the one
   * consistent with the session's settled record — the reproduced case is a
   * rival's unfenced backfill landing inside the settle winner's put->append
   * gap, where the winner's own row arrives second. (r4 shipped first-wins;
   * in the plain-store double-append race the pick was arbitrary either
   * way.) Raw rows remain available via the store directly.
   */
  async listQueries(sessionId: string): Promise<QueryRecord[]> {
    return this.#withLock(sessionId, async () => {
      const byAttempt = new Map<number, QueryRecord>();
      for (const row of await this.#store.listQueries(sessionId)) {
        byAttempt.set(row.attempt, row);
      }
      return [...byAttempt.values()].map((row) => ({ ...row }));
    });
  }
}
