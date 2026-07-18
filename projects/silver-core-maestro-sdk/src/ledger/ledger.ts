/**
 * TaskLedger (SCS-REQ orchestrator-sdk §4): the public bookkeeping API over
 * the host-injected store, applying the pure state-machine core. It never
 * runs anything and holds no timers — execution and the clock's driving hand
 * belong to the driver; the ledger only computes and records.
 */

import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import type { LedgerStore, SessionFilter } from './store.js';
import type { QueryOutcome, QueryRecord, SessionRecord } from './types.js';
import type { RetryPolicy } from './state.js';
import { DEFAULT_RETRY_POLICY, backoffDelayMs, transition } from './state.js';

export interface TaskLedgerOptions {
  store: LedgerStore;
  /** Injectable time source (driver-grade Clock accepted; only now() is used). */
  clock?: Pick<Clock, 'now'>;
  /** Record id factory (default crypto.randomUUID). */
  idFactory?: () => string;
  /** Retry policy defaults for sessions that don't override maxAttempts. */
  retry?: Partial<RetryPolicy>;
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
  outcome: QueryOutcome;
  error?: string;
  summary?: string;
  startedAt: number;
  endedAt: number;
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

export class TaskLedger {
  readonly #store: LedgerStore;
  readonly #clock: Pick<Clock, 'now'>;
  readonly #idFactory: () => string;
  readonly #retry: RetryPolicy;

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
  }

  /**
   * Create a session in `pending`, due immediately unless runAt says later
   * (or runAt is null = manual-claim only, see DispatchInput.runAt).
   *
   * Duplicate-id guard: get-then-put, NOT atomic. The assumption is a single
   * writer per idempotency key (each key is minted and dispatched by exactly
   * one host-side flow); two concurrent dispatches of the SAME id can both
   * pass the get and last-write-wins. A true compare-and-swap needs store
   * cooperation and belongs to the LedgerStore implementation (the SDK
   * defines the seam only — library-not-framework).
   */
  async dispatch(input: DispatchInput): Promise<SessionRecord> {
    if (typeof input.intent !== 'string' || input.intent.length === 0) {
      throw new TypeError('dispatch: intent must be a non-empty string');
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
    if (input.id !== undefined) {
      const existing = await this.#store.getSession(input.id);
      if (existing !== null) {
        throw new DuplicateSessionError(input.id);
      }
    }
    const now = this.#clock.now();
    const record: SessionRecord = {
      id: input.id ?? this.#idFactory(),
      intent: input.intent,
      payload: input.payload,
      state: 'pending',
      attempts: 0,
      maxAttempts,
      createdAt: now,
      updatedAt: now,
      nextRunAt: input.runAt === undefined ? now : input.runAt,
    };
    await this.#store.putSession(record);
    return { ...record };
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
    const due = await this.#store.listSessions({
      states: ['pending', 'retrying'],
      dueBefore: now,
    });
    const claimed: SessionRecord[] = [];
    for (const session of due) {
      const next = transition(session.state, 'claim', session);
      const updated: SessionRecord = {
        ...session,
        state: next,
        attempts: session.attempts + 1,
        nextRunAt: null,
        updatedAt: now,
      };
      await this.#store.putSession(updated);
      claimed.push(updated);
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
   * session can start.
   */
  async claimSession(sessionId: string, now: number = this.#clock.now()): Promise<SessionRecord> {
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
    };
    await this.#store.putSession(updated);
    return { ...updated };
  }

  /**
   * Record one attempt's outcome: appends the query row, applies the pure
   * transition (retrying while attempts remain, terminal otherwise) and — on
   * retrying — schedules nextRunAt by exponential backoff.
   */
  async recordOutcome(sessionId: string, result: OutcomeInput): Promise<SessionRecord> {
    const session = await this.#store.getSession(sessionId);
    if (session === null) {
      throw new Error(`recordOutcome: unknown session '${sessionId}'`);
    }
    const next = transition(session.state, outcomeEvent[result.outcome], session);
    const query: QueryRecord = {
      id: this.#idFactory(),
      sessionId,
      attempt: session.attempts,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      outcome: result.outcome,
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
    };
    await this.#store.appendQuery(query);
    const now = this.#clock.now();
    const updated: SessionRecord = {
      ...session,
      state: next,
      updatedAt: now,
      nextRunAt:
        next === 'retrying'
          ? now + backoffDelayMs(session.attempts, { ...this.#retry, maxAttempts: session.maxAttempts })
          : null,
      ...(result.outcome !== 'ok'
        ? { lastError: result.error ?? result.outcome }
        : {}),
    };
    await this.#store.putSession(updated);
    return { ...updated };
  }

  // --- Query surface (§4: one query set serving every scenario). -----------

  getSession(id: string): Promise<SessionRecord | null> {
    return this.#store.getSession(id);
  }

  listSessions(filter?: SessionFilter): Promise<SessionRecord[]> {
    return this.#store.listSessions(filter);
  }

  listQueries(sessionId: string): Promise<QueryRecord[]> {
    return this.#store.listQueries(sessionId);
  }
}
