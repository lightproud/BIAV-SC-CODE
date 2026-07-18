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
import type { TaskLedger } from './ledger/ledger.js';
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
 * The host's work function — typically wrapping a @biav/agent-sdk query()
 * call. A rejection is recorded as an 'error' outcome; the driver never
 * crashes on executor failure.
 */
export type Executor = (session: SessionRecord, ctx: ExecutorContext) => Promise<ExecutorResult>;

export type DriverEvent =
  | { type: 'attempt:start'; session: SessionRecord }
  | { type: 'attempt:settle'; session: SessionRecord; outcome: QueryOutcome; error?: string }
  | { type: 'session:terminal'; session: SessionRecord }
  | { type: 'driver:error'; error: unknown };

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
  #pollHandle: unknown = null;
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
    // First poll on the next tick (delay 0): start() itself stays synchronous.
    this.#scheduleTick(0);
  }

  /**
   * Stop polling, abort in-flight attempts, and wait for their bookkeeping
   * to settle. Aborted attempts are recorded as 'error' outcomes, so a
   * stopped-then-restarted driver resumes them through the normal retry path.
   */
  async stop(): Promise<void> {
    this.#running = false;
    if (this.#pollHandle !== null) {
      this.#clock.clearTimeout(this.#pollHandle);
      this.#pollHandle = null;
    }
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

  #scheduleTick(delayMs: number): void {
    if (!this.#running) return;
    this.#pollHandle = this.#clock.setTimeout(() => {
      void this.#tick();
    }, delayMs);
  }

  async #tick(): Promise<void> {
    if (!this.#running) return;
    try {
      const claimed = await this.#ledger.claimDue(this.#clock.now());
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
    this.#scheduleTick(this.#pollIntervalMs);
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
    try {
      const updated = await this.#ledger.recordOutcome(session.id, {
        outcome,
        ...(result.error !== undefined ? { error: result.error } : {}),
        ...(result.summary !== undefined ? { summary: result.summary } : {}),
        startedAt,
        endedAt: this.#clock.now(),
      });
      this.#emit({
        type: 'attempt:settle',
        session: updated,
        outcome,
        ...(result.error !== undefined ? { error: result.error } : {}),
      });
      if (updated.state === 'done' || updated.state === 'failed') {
        this.#emit({ type: 'session:terminal', session: updated });
      }
    } catch (error) {
      this.#emit({ type: 'driver:error', error });
    }
  }
}
