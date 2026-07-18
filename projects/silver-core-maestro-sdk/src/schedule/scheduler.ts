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

/**
 * The ledger session id a Scheduler uses for one fire point (gap G3: this
 * format was previously a doc-comment-only contract; the workflow side has
 * had workflowSessionId all along). Hosts use it to pre-seed or audit fire
 * bookkeeping without hand-formatting strings.
 */
export function scheduleSessionId(specId: string, fireAt: number): string {
  return `sched:${specId}:${fireAt}`;
}

export interface SchedulerOptions {
  ledger: TaskLedger;
  specs: readonly ScheduleSpec[];
  clock?: Clock;
  /** Poll cadence for due fire points (default 1000 ms). */
  pollIntervalMs?: number;
  /**
   * Day-zero seeding for SHORT-LIVED hosts (gap G3). Recovery deliberately
   * does no epoch backfill: a spec with no ledger footprint starts at `now`.
   * Correct for a long-lived process, but a host that boots after the fire
   * point and exits seconds later (a daily CI run) then never fires at all —
   * every boot re-anchors at now and the footprint never appears. With
   * seedFirstRun, a footprint-less spec starts one cadence back instead
   * (every ?? 24 h), so its single most recent due point fires on the first
   * tick under EITHER catchUp mode, and every later boot recovers normally.
   * Default false (prior behavior byte-for-byte).
   */
  seedFirstRun?: boolean;
  /** Observability seam: data out, rendering host-side. Callback errors are swallowed. */
  onEvent?: (event: SchedulerEvent) => void;
}

export class Scheduler {
  readonly #ledger: TaskLedger;
  readonly #specs: ScheduleSpec[];
  readonly #clock: Clock;
  readonly #pollIntervalMs: number;
  readonly #seedFirstRun: boolean;
  readonly #onEvent: ((event: SchedulerEvent) => void) | undefined;

  #running = false;
  #pollHandle: unknown = null;
  /**
   * Run generation, bumped by every start(). A scheduled or in-flight tick
   * captures its generation and aborts silently once it no longer matches,
   * so a start() re-entered during an unsettled stop() cannot leave the old
   * tick alive to fork a second permanent poll chain.
   */
  #generation = 0;
  /** Every unsettled tick promise; stop() awaits a snapshot of this set. */
  readonly #ticksInFlight = new Set<Promise<void>>();
  #recovered = false;
  /** Newest fire point handled per spec id (rebuilt from the ledger on start). */
  readonly #lastFired = new Map<string, number>();

  constructor(opts: SchedulerOptions) {
    this.#ledger = opts.ledger;
    this.#specs = [...opts.specs];
    this.#clock = opts.clock ?? systemClock;
    this.#pollIntervalMs = opts.pollIntervalMs ?? 1_000;
    this.#seedFirstRun = opts.seedFirstRun === true;
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
    // New generation: a tick still in flight from a previous run detects the
    // mismatch and aborts instead of rescheduling alongside this run's chain.
    this.#generation += 1;
    // First poll on the next tick (delay 0): start() itself stays synchronous.
    this.#scheduleTick(0, this.#generation);
  }

  /** Stop polling; resolves after every in-flight tick settles. */
  async stop(): Promise<void> {
    this.#running = false;
    if (this.#pollHandle !== null) {
      this.#clock.clearTimeout(this.#pollHandle);
      this.#pollHandle = null;
    }
    // Snapshot: ticks started before this stop() must settle before we
    // resolve; ticks belonging to a subsequent start() are that run's problem.
    const pending = [...this.#ticksInFlight];
    if (pending.length > 0) await Promise.all(pending);
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

  #scheduleTick(delayMs: number, generation: number): void {
    if (!this.#running || generation !== this.#generation) return;
    this.#pollHandle = this.#clock.setTimeout(() => {
      // A cleared timer cannot fire, but a stale one can: stop() then start()
      // may have re-entered before this callback ran. Stale generation = abort.
      if (generation !== this.#generation) return;
      const tick = this.#tick(generation).finally(() => {
        this.#ticksInFlight.delete(tick);
      });
      this.#ticksInFlight.add(tick);
    }, delayMs);
  }

  async #tick(generation: number): Promise<void> {
    if (!this.#running || generation !== this.#generation) return;
    try {
      if (!this.#recovered) {
        await this.#recover();
        // A start() during the await above owns recovery for its own
        // generation; a stale tick must not mark it done (or reschedule).
        if (generation !== this.#generation) return;
        this.#recovered = true;
      }
      const now = this.#clock.now();
      for (const spec of this.#specs) {
        if (!this.#running || generation !== this.#generation) break;
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
    this.#scheduleTick(this.#pollIntervalMs, generation);
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
        const suffix = session.id.slice(prefix.length);
        // Strict digits-only (audit r2): Number('') and Number('  ') are 0,
        // so a malformed id like 'sched:x:' would recover lastFired = 0 and
        // trigger a catastrophic epoch catch-up.
        if (!/^\d+$/.test(suffix)) continue;
        const fireAt = Number(suffix);
        // Digits beyond the representable epoch range (audit r4): one
        // poisoned row like 'sched:x:99…9' would otherwise pin lastFired in
        // the far future and silently starve the spec forever. The bound is
        // the JS Date range (±8.64e15 ms), which also keeps it a safe integer.
        if (fireAt > 8_640_000_000_000_000) continue;
        if (latest === null || fireAt > latest) latest = fireAt;
      }
      // seedFirstRun (gap G3): a footprint-less spec starts one cadence back,
      // so the window (lastFired, now] holds AT MOST its single most recent
      // due point — identical fire set under catchUp 'latest' and 'all'.
      const fallback = this.#seedFirstRun ? now - (spec.every ?? 86_400_000) : now;
      this.#lastFired.set(spec.id, latest ?? fallback);
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
      const sessionId = scheduleSessionId(spec.id, fireAt);
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
