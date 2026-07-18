/**
 * Scheduler (SCS-REQ orchestrator-sdk §3 loop scaffold; §6.2 fixed-point
 * firing + missed-fire compensation + cross-restart recovery). DISPATCH-ONLY
 * component: it creates due sessions on the ledger; the LedgerDriver executes
 * them. Fire bookkeeping lives IN THE LEDGER — the session id encodes the
 * fire point (`sched:{specId}:{fireAt}`), so restart recovery is a scan and
 * duplicate fires collapse on the ledger's own already-exists check.
 */

import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import type { TaskLedger } from '../ledger/ledger.js';
import { DuplicateSessionError } from '../ledger/ledger.js';
import type { ScheduleSpec } from './spec.js';
import { firesBetween, validateSpec } from './spec.js';

export type SchedulerEvent =
  | { type: 'schedule:fire'; specId: string; fireAt: number; sessionId: string }
  | { type: 'schedule:error'; error: unknown };

export interface SchedulerOptions {
  ledger: TaskLedger;
  specs: readonly ScheduleSpec[];
  clock?: Clock;
  /** Poll cadence for due fire points (default 1000 ms). */
  pollIntervalMs?: number;
  /** Observability seam: data out, rendering host-side. Callback errors are swallowed. */
  onEvent?: (event: SchedulerEvent) => void;
}

export class Scheduler {
  readonly #ledger: TaskLedger;
  readonly #specs: ScheduleSpec[];
  readonly #clock: Clock;
  readonly #pollIntervalMs: number;
  readonly #onEvent: ((event: SchedulerEvent) => void) | undefined;

  #running = false;
  #pollHandle: unknown = null;
  #tickInFlight: Promise<void> | null = null;
  #recovered = false;
  /** Newest fire point handled per spec id (rebuilt from the ledger on start). */
  readonly #lastFired = new Map<string, number>();

  constructor(opts: SchedulerOptions) {
    this.#ledger = opts.ledger;
    this.#specs = [...opts.specs];
    this.#clock = opts.clock ?? systemClock;
    this.#pollIntervalMs = opts.pollIntervalMs ?? 1_000;
    this.#onEvent = opts.onEvent;
    if (!Number.isFinite(this.#pollIntervalMs) || this.#pollIntervalMs < 0) {
      throw new RangeError('Scheduler: pollIntervalMs must be a finite number >= 0');
    }
    const seen = new Set<string>();
    for (const spec of this.#specs) {
      validateSpec(spec);
      if (seen.has(spec.id)) {
        throw new Error(`Scheduler: duplicate spec id '${spec.id}'`);
      }
      seen.add(spec.id);
    }
  }

  /** Idempotent; recovery (ledger scan) runs inside the first tick. */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#recovered = false;
    // First poll on the next tick (delay 0): start() itself stays synchronous.
    this.#scheduleTick(0);
  }

  /** Stop polling; resolves after any in-flight tick settles. */
  async stop(): Promise<void> {
    this.#running = false;
    if (this.#pollHandle !== null) {
      this.#clock.clearTimeout(this.#pollHandle);
      this.#pollHandle = null;
    }
    if (this.#tickInFlight !== null) await this.#tickInFlight;
  }

  isRunning(): boolean {
    return this.#running;
  }

  #emit(event: SchedulerEvent): void {
    if (this.#onEvent === undefined) return;
    try {
      this.#onEvent(event);
    } catch {
      // The observability seam must never take the scheduler down.
    }
  }

  #scheduleTick(delayMs: number): void {
    if (!this.#running) return;
    this.#pollHandle = this.#clock.setTimeout(() => {
      const tick = this.#tick().finally(() => {
        if (this.#tickInFlight === tick) this.#tickInFlight = null;
      });
      this.#tickInFlight = tick;
    }, delayMs);
  }

  async #tick(): Promise<void> {
    if (!this.#running) return;
    try {
      if (!this.#recovered) {
        await this.#recover();
        this.#recovered = true;
      }
      const now = this.#clock.now();
      for (const spec of this.#specs) {
        if (!this.#running) break;
        try {
          await this.#fireDue(spec, now);
        } catch (error) {
          // One spec's failure must not starve the others this tick.
          this.#emit({ type: 'schedule:error', error });
        }
      }
    } catch (error) {
      this.#emit({ type: 'schedule:error', error });
    }
    this.#scheduleTick(this.#pollIntervalMs);
  }

  /**
   * Cross-restart recovery (§6.2): the newest fireAt per spec is parsed back
   * out of the ledger's session ids. Specs with no ledger footprint start at
   * now — deliberately no epoch backfill.
   */
  async #recover(): Promise<void> {
    const sessions = await this.#ledger.listSessions();
    const now = this.#clock.now();
    for (const spec of this.#specs) {
      const prefix = `sched:${spec.id}:`;
      let latest: number | null = null;
      for (const session of sessions) {
        if (!session.id.startsWith(prefix)) continue;
        const fireAt = Number(session.id.slice(prefix.length));
        if (!Number.isFinite(fireAt)) continue;
        if (latest === null || fireAt > latest) latest = fireAt;
      }
      this.#lastFired.set(spec.id, latest ?? now);
    }
  }

  async #fireDue(spec: ScheduleSpec, now: number): Promise<void> {
    const lastFired = this.#lastFired.get(spec.id) ?? now;
    const fires = firesBetween(spec, lastFired, now);
    if (fires.length === 0) return;
    // Missed-fire compensation: 'latest' (default) collapses a backlog into
    // its newest point; 'all' replays every due point (firesBetween cap applies).
    const due = (spec.catchUp ?? 'latest') === 'all' ? fires : fires.slice(-1);
    for (const fireAt of due) {
      const sessionId = `sched:${spec.id}:${fireAt}`;
      try {
        await this.#ledger.dispatch({
          id: sessionId,
          intent: spec.intent,
          payload: { schedule: { specId: spec.id, fireAt }, data: spec.payload },
          ...(spec.maxAttempts !== undefined ? { maxAttempts: spec.maxAttempts } : {}),
        });
        this.#emit({ type: 'schedule:fire', specId: spec.id, fireAt, sessionId });
      } catch (error) {
        // Idempotency via the ledger: another run already fired this point.
        // TYPED match only — a message match would also swallow coincidental
        // store errors (EEXIST) and drop the fire permanently.
        if (!(error instanceof DuplicateSessionError)) {
          throw error; // real failure: lastFired stays put, retried next tick
        }
      }
      this.#lastFired.set(spec.id, fireAt);
    }
  }
}
