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
   * Poll or bookkeeping failure. `session` is present when the failure
   * strands a specific session: recordOutcome failed twice (once + one
   * immediate retry), leaving the record in 'running'. That stranding is BY
   * DESIGN — the store is the source of truth, so the driver never invents
   * state to paper over a failing store; the host repairs from the event.
   */
  | { type: 'driver:error'; error: unknown; session?: SessionRecord };

export interface LedgerDriverOptions {
  ledger: TaskLedger;
  executor: Executor;
  /** Poll cadence for due sessions (default 1000 ms). */
  pollIntervalMs?: number;
  /** Per-attempt timeout; unset = attempts are never timed out by the driver. */
  queryTimeoutMs?: number;
  clock?: Clock;
  /** Observability seam: data out, rendering host-side. Callback errors are swallowed. */
  onEvent?: (event: DriverEvent) => void;
}

export class LedgerDriver {
  readonly #ledger: TaskLedger;
  readonly #executor: Executor;
  readonly #pollIntervalMs: number;
  readonly #queryTimeoutMs: number | undefined;
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
  readonly #inflight = new Set<Promise<void>>();
  readonly #controllers = new Set<AbortController>();

  constructor(opts: LedgerDriverOptions) {
    this.#ledger = opts.ledger;
    this.#executor = opts.executor;
    this.#pollIntervalMs = opts.pollIntervalMs ?? 1_000;
    this.#queryTimeoutMs = opts.queryTimeoutMs;
    this.#clock = opts.clock ?? systemClock;
    this.#onEvent = opts.onEvent;
    if (!Number.isFinite(this.#pollIntervalMs) || this.#pollIntervalMs < 0) {
      throw new RangeError(`LedgerDriver: pollIntervalMs must be a finite number >= 0`);
    }
    if (this.#queryTimeoutMs !== undefined && (!Number.isFinite(this.#queryTimeoutMs) || this.#queryTimeoutMs <= 0)) {
      throw new RangeError(`LedgerDriver: queryTimeoutMs must be a finite number > 0`);
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
    this.#running = false;
    if (this.#pollHandle !== null) {
      this.#clock.clearTimeout(this.#pollHandle);
      this.#pollHandle = null;
    }
    if (this.#tickPromise !== null) await this.#tickPromise;
    for (const controller of this.#controllers) controller.abort();
    await Promise.allSettled([...this.#inflight]);
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
      const claimed = await this.#ledger.claimDue(this.#clock.now());
      // Attempts are started even if stop() began while claimDue was in
      // flight: stop() awaits this tick and then aborts them, so the claims
      // settle into 'retrying' (resumable) instead of stranding in 'running'.
      for (const session of claimed) {
        const attempt = this.#runAttempt(session);
        const tracked: Promise<void> = attempt.finally(() => {
          this.#inflight.delete(tracked);
        });
        this.#inflight.add(tracked);
      }
    } catch (error) {
      this.#emit({ type: 'driver:error', error });
    }
    this.#scheduleTick(this.#pollIntervalMs, generation);
  }

  async #runAttempt(session: SessionRecord): Promise<void> {
    const controller = new AbortController();
    this.#controllers.add(controller);
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
    };
    let updated: SessionRecord;
    try {
      updated = await this.#ledger.recordOutcome(session.id, payload);
    } catch {
      // One immediate retry absorbs a transient store failure.
      try {
        updated = await this.#ledger.recordOutcome(session.id, payload);
      } catch (error) {
        // Both writes failed: the session stays 'running' in the store BY
        // DESIGN — the store is the source of truth, and inventing state
        // driver-side would fork it. The event carries the session so the
        // host can see exactly which record is stranded and repair it.
        this.#emit({ type: 'driver:error', error, session });
        return;
      }
    }
    this.#emit({
      type: 'attempt:settle',
      session: updated,
      outcome,
      ...(result.error !== undefined ? { error: result.error } : {}),
    });
    if (updated.state === 'done' || updated.state === 'failed') {
      this.#emit({ type: 'session:terminal', session: updated });
    }
  }
}
