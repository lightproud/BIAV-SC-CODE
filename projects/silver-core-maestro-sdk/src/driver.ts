/**
 * LedgerDriver (SCS-REQ orchestrator-sdk §4): the live component. The host
 * starts it; from then on it holds the clock — polling the ledger for due
 * work, timing attempts out, and letting the ledger's state machine advance
 * records. Life-and-death stays with the host: start()/stop() are the host's
 * discretion, and everything the driver observes is surfaced as data through
 * the onEvent seam (rendering is host-side, hard property §1.3).
 */

import type { Clock } from './clock.js';
import { systemClock } from './clock.js';
import type { OutcomeInput, TaskLedger } from './ledger/ledger.js';
import { InvalidTransitionError, isTerminal } from './ledger/state.js';
import type { QueryOutcome, SessionRecord } from './ledger/types.js';

export interface ExecutorContext {
  /** 1-based attempt number (the claim already counted it). */
  attempt: number;
  /** Aborted on per-attempt timeout and on driver stop. */
  signal: AbortSignal;
}

export type ExecutorResult = {
  outcome: 'ok' | 'error';
  error?: string;
  summary?: string;
};

/**
 * The host's work function — typically wrapping a silver-core-agent-sdk query()
 * call. A rejection is recorded as an 'error' outcome; the driver never
 * crashes on executor failure.
 */
export type Executor = (session: SessionRecord, ctx: ExecutorContext) => Promise<ExecutorResult>;

export type DriverEvent =
  | { type: 'attempt:start'; session: SessionRecord }
  | { type: 'attempt:settle'; session: SessionRecord; outcome: QueryOutcome; error?: string }
  | { type: 'session:terminal'; session: SessionRecord }
  /**
   * Poll or bookkeeping failure. `session` is present ONLY when the failure
   * verifiably strands a specific session: recordOutcome failed twice (once
   * + one immediate retry) AND the record still reads 'running' — the
   * carried record is the CURRENT store row (r5). That stranding is BY
   * DESIGN — the store is the source of truth, so the driver never invents
   * state to paper over a failing store; the host repairs from the event.
   * A bookkeeping rejection whose session was already settled elsewhere
   * (e.g. a lease sweep — self-healing on the retry path) emits WITHOUT a
   * session: there is nothing to repair. One rejection emits NOTHING at
   * all (0.76.0): a session the host cancelled mid-flight — the late
   * result's InvalidTransitionError is the cancel contract working, not a
   * malfunction.
   */
  | { type: 'driver:error'; error: unknown; session?: SessionRecord };

export interface LedgerDriverOptions {
  ledger: TaskLedger;
  executor: Executor;
  /** Poll cadence for due sessions (default 1000 ms). */
  pollIntervalMs?: number;
  /** Per-attempt timeout; unset = attempts are never timed out by the driver. */
  queryTimeoutMs?: number;
  /**
   * Cap on attempts in flight at once (integer >= 1; unset = UNBOUNDED, the
   * pre-0.78.0 behavior byte-for-byte).
   *
   * Why it exists (design review 2026-07-26 F2): a tick used to claim every
   * due session and start them all, so peak concurrency equalled the size of
   * the due backlog — measured at 200 concurrent attempts for 200 due
   * sessions. Three ordinary paths produce a backlog: a scheduler catching up
   * after downtime (`catchUp: 'all'`, up to firesBetween's cap of 100 fire
   * points at once), a wide workflow fan-out (every dep-free node becomes
   * ready together), and a host restart over a store full of pending rows.
   * Where an attempt is a paid API call that is a cost/rate-limit event, not
   * a throughput win.
   *
   * A host CANNOT implement this itself by queueing inside its executor: by
   * then the attempt is already claimed (state `running`, attempts
   * incremented, claim lease started), so queued work burns its lease while
   * waiting. The cap therefore has to live where the claiming happens — the
   * driver claims only as many as it has free slots, and the rest stay
   * untouched in the store, due, for a later tick. Nothing about their record
   * changes in the meantime.
   */
  maxConcurrent?: number;
  clock?: Clock;
  /** Observability seam: data out, rendering host-side. Callback errors are swallowed. */
  onEvent?: (event: DriverEvent) => void;
}

export class LedgerDriver {
  readonly #ledger: TaskLedger;
  readonly #executor: Executor;
  readonly #pollIntervalMs: number;
  readonly #queryTimeoutMs: number | undefined;
  readonly #maxConcurrent: number | undefined;
  readonly #clock: Clock;
  readonly #onEvent: ((event: DriverEvent) => void) | undefined;

  #running = false;
  /**
   * Poll-chain generation. start() opens a new generation; every scheduled
   * tick carries the generation it was born under and refuses to reschedule
   * once it no longer matches. This guarantees at most ONE live poll chain
   * even across stop()-then-start() while a tick is still in flight.
   */
  #generation = 0;
  #pollHandle: unknown = null;
  /** The currently in-flight tick, if any; stop() awaits it (see stop()). */
  #tickPromise: Promise<void> | null = null;
  // Generation-tagged (audit r2): a STALE stop() — one that suspended at the
  // tick await while a non-awaited start() opened a new generation — must
  // abort and await ONLY its own generation's work, never the restarted one's.
  readonly #inflight = new Map<Promise<void>, number>();
  readonly #controllers = new Map<AbortController, number>();
  /**
   * Slots claimed by a tick but not yet landed in #inflight (the window while
   * its claimDue is awaited). Counted into the free-slot arithmetic so a
   * SECOND tick body running concurrently — a non-awaited stop()+start() can
   * put an old and a new generation in flight at once (audit r2) — does not
   * read the same pre-claim #inflight.size and each claim a full
   * maxConcurrent, launching 2x the cap of paid attempts.
   */
  #reserved = 0;

  constructor(opts: LedgerDriverOptions) {
    this.#ledger = opts.ledger;
    this.#executor = opts.executor;
    this.#pollIntervalMs = opts.pollIntervalMs ?? 1_000;
    this.#queryTimeoutMs = opts.queryTimeoutMs;
    this.#maxConcurrent = opts.maxConcurrent;
    this.#clock = opts.clock ?? systemClock;
    this.#onEvent = opts.onEvent;
    if (!Number.isFinite(this.#pollIntervalMs) || this.#pollIntervalMs < 0) {
      throw new RangeError(`LedgerDriver: pollIntervalMs must be a finite number >= 0`);
    }
    if (this.#queryTimeoutMs !== undefined && (!Number.isFinite(this.#queryTimeoutMs) || this.#queryTimeoutMs <= 0)) {
      throw new RangeError(`LedgerDriver: queryTimeoutMs must be a finite number > 0`);
    }
    // Integer, not merely finite: a fractional cap (2.5) would make the free-
    // slot arithmetic claim a non-integer batch bound, and 0 would mean "never
    // claim anything" — a silently dead driver.
    if (
      this.#maxConcurrent !== undefined &&
      (!Number.isInteger(this.#maxConcurrent) || this.#maxConcurrent < 1)
    ) {
      throw new RangeError(
        `LedgerDriver: maxConcurrent must be an integer >= 1 when given, got ${this.#maxConcurrent}`,
      );
    }
  }

  /** Idempotent: a running driver ignores further start() calls. */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    // New generation: a tick still in flight from a previous run can no
    // longer reschedule, so restart never forks a second poll chain.
    this.#generation += 1;
    // First poll on the next tick (delay 0): start() itself stays synchronous.
    this.#scheduleTick(0, this.#generation);
  }

  /**
   * Stop polling, abort in-flight attempts, and wait for their bookkeeping
   * to settle. Aborted attempts are recorded as 'error' outcomes, so a
   * stopped-then-restarted driver resumes them through the normal retry path.
   *
   * A tick whose claimDue is already in flight cannot be cancelled, so stop()
   * awaits it first: sessions that claim lands are parked through the abort
   * path below BEFORE stop() resolves — nothing is claimed or executed after.
   */
  async stop(): Promise<void> {
    const stoppedGeneration = this.#generation;
    this.#running = false;
    if (this.#pollHandle !== null) {
      this.#clock.clearTimeout(this.#pollHandle);
      this.#pollHandle = null;
    }
    if (this.#tickPromise !== null) await this.#tickPromise;
    // Abort/await ONLY work belonging to generations up to the one this
    // stop() call closed — a restart that happened while we awaited the tick
    // owns the newer generations and must not be touched (audit r2).
    for (const [controller, generation] of this.#controllers) {
      if (generation <= stoppedGeneration) controller.abort();
    }
    const toAwait = [...this.#inflight]
      .filter(([, generation]) => generation <= stoppedGeneration)
      .map(([promise]) => promise);
    await Promise.allSettled(toAwait);
  }

  isRunning(): boolean {
    return this.#running;
  }

  #emit(event: DriverEvent): void {
    if (this.#onEvent === undefined) return;
    try {
      this.#onEvent(event);
    } catch {
      // The observability seam must never take the driver down.
    }
  }

  #scheduleTick(delayMs: number, generation: number): void {
    // Generation gate: a tick born under an older start() must not extend
    // its chain — only the current generation's chain may schedule.
    if (!this.#running || generation !== this.#generation) return;
    this.#pollHandle = this.#clock.setTimeout(() => {
      this.#tickPromise = this.#tick(generation);
    }, delayMs);
  }

  async #tick(generation: number): Promise<void> {
    if (!this.#running || generation !== this.#generation) return;
    try {
      // Lease sweep first (gap G2): expired claims from a dead/overrunning
      // driver re-enter the retry path and may be re-claimed this very tick.
      // No-op on lease-less ledgers and lease-less records.
      await this.#ledger.sweepExpiredLeases(this.#clock.now());
      // Free-slot arithmetic (0.78.0): claim at most as many as we can run
      // right now. #inflight is counted across ALL generations on purpose —
      // a stopped generation's attempts are still executing until stop()
      // finishes awaiting them, and they still consume the host's budget.
      // Zero slots = claim nothing this tick and leave the backlog untouched
      // in the store; the sweep above still ran (it must not be skipped) and
      // the tick still reschedules through the shared tail below.
      const limit =
        this.#maxConcurrent === undefined
          ? undefined
          : Math.max(0, this.#maxConcurrent - this.#inflight.size - this.#reserved);
      // Reserve the slots SYNCHRONOUSLY (before the claimDue await yields), so
      // a concurrently-running tick body sees them consumed and never
      // double-claims the cap. Released once the claims have landed in
      // #inflight (or claimDue failed) — the read-compute-reserve above runs
      // to the await with no interleaving point, so the reservation is atomic
      // against the other tick.
      if (limit !== undefined) this.#reserved += limit;
      try {
        const claimed = limit === 0 ? [] : await this.#ledger.claimDue(this.#clock.now(), { limit });
        // Attempts are started even if stop() began while claimDue was in
        // flight: stop() awaits this tick and then aborts them, so the claims
        // settle into 'retrying' (resumable) instead of stranding in 'running'.
        for (const session of claimed) {
          const attempt = this.#runAttempt(session, generation);
          const tracked: Promise<void> = attempt.finally(() => {
            this.#inflight.delete(tracked);
          });
          this.#inflight.set(tracked, generation);
        }
      } finally {
        if (limit !== undefined) this.#reserved -= limit;
      }
    } catch (error) {
      this.#emit({ type: 'driver:error', error });
    }
    this.#scheduleTick(this.#pollIntervalMs, generation);
  }

  async #runAttempt(session: SessionRecord, generation: number): Promise<void> {
    const controller = new AbortController();
    this.#controllers.set(controller, generation);
    let timedOut = false;
    let timeoutHandle: unknown = null;
    if (this.#queryTimeoutMs !== undefined) {
      timeoutHandle = this.#clock.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.#queryTimeoutMs);
    }
    const startedAt = this.#clock.now();
    this.#emit({ type: 'attempt:start', session });
    let result: ExecutorResult;
    try {
      result = await this.#executor(session, {
        attempt: session.attempts,
        signal: controller.signal,
      });
    } catch (error) {
      result = {
        outcome: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (timeoutHandle !== null) this.#clock.clearTimeout(timeoutHandle);
      this.#controllers.delete(controller);
    }
    const outcome: QueryOutcome = timedOut ? 'timeout' : result.outcome === 'ok' ? 'ok' : 'error';
    // One payload, reused verbatim on retry: the executor result must not be
    // discarded just because the first bookkeeping write failed.
    const payload: OutcomeInput = {
      outcome,
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
      startedAt,
      endedAt: this.#clock.now(),
      // Fence on the claimed attempt (audit r4): if this attempt outran its
      // lease, was swept, and the session was re-claimed, this write must
      // throw instead of settling the session with a stale result.
      attempt: session.attempts,
    };
    let updated: SessionRecord;
    try {
      updated = await this.#ledger.recordOutcome(session.id, payload);
    } catch {
      // One immediate retry absorbs a transient store failure.
      try {
        updated = await this.#ledger.recordOutcome(session.id, payload);
      } catch (error) {
        // Both writes failed. Distinguish two very different worlds before
        // signaling (r5): if the record is still 'running' in the store, it
        // is genuinely STRANDED (the store is the source of truth, the
        // driver never invents state) and the event carries the CURRENT
        // record so the host repairs the right thing. If it is anything
        // else, a lease sweep already settled this attempt and the session
        // is self-healing on the normal retry path — a session-carrying
        // "repair me" signal here made hosts force-settle healthy records
        // (the pre-r5 event also carried a stale 'running' snapshot).
        let current: SessionRecord | null = null;
        try {
          current = await this.#ledger.getSession(session.id);
        } catch {
          current = null;
        }
        if (current !== null && current.state === 'running') {
          this.#emit({ type: 'driver:error', error, session: current });
        } else if (current?.state === 'cancelled' && error instanceof InvalidTransitionError) {
          // Host cancelled mid-flight (0.76.0): the rejection IS the design
          // — cancelSession already settled the session and wrote the
          // attempt's epitaph row; this late result has nothing to record
          // and nothing to repair, so no error event is emitted (a user
          // cancel must not read as a driver malfunction).
        } else {
          this.#emit({ type: 'driver:error', error });
        }
        return;
      }
    }
    this.#emit({
      type: 'attempt:settle',
      session: updated,
      outcome,
      ...(result.error !== undefined ? { error: result.error } : {}),
    });
    // Terminal vocabulary, not a literal pair (0.78.0): recordOutcome cannot
    // return a `cancelled` record today (it rejects that state outright), so
    // this is future-proofing rather than a behavior change — but it is the
    // same spelling that silently excluded `cancelled` in the scenario layer
    // when 0.76.0 added it, and the src-wide guard now forbids that spelling.
    if (isTerminal(updated.state)) {
      this.#emit({ type: 'session:terminal', session: updated });
    }
  }
}
