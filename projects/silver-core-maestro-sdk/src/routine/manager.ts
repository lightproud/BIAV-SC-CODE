/**
 * RoutineManager — the duty-routine management surface (design round 3,
 * 2026-07-29: `maestro-sdk-agent-assembly-design-20260729.md` §5; keeper
 * rulings 裁4 / D4). The Scheduler is a DISPATCHER; this is the management
 * face a host UI reads and pokes: name a routine, enable / disable it,
 * trigger it now, and answer "when does it fire next / when did it last
 * fire / how did that go" — the direct data source of an inbox's duty
 * panel. Data plane only: every method returns records; rendering is the
 * host's (hard property §1.3 — and a "routine panel component" proposal is
 * over that line by definition).
 *
 * Enabled-state storage (ruling D4): PURE MEMORY. The full state is one
 * enabled table; a store seam for it would replay the P3 lesson (every host
 * hand-writing another error-prone store for one map). The host passes
 * `initiallyDisabled` at construction and persists flips itself off the
 * routine:enabled / routine:disabled events.
 *
 * Manual fires use the `manual:` id segment — NEVER `sched:` — because
 * Scheduler recovery rebuilds its footprint from `sched:` ids: a manual
 * fire in that namespace would advance the footprint and swallow every
 * missed fire point inside the compensation window (schedule/footprint.ts
 * is the single shared parser for both segments).
 */

import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import type { TaskLedger } from '../ledger/ledger.js';
import { DuplicateSessionError } from '../ledger/ledger.js';
import type { SessionRecord } from '../ledger/types.js';
import {
  MANUAL_FIRE_SEGMENT,
  SCHEDULE_FIRE_SEGMENT,
  parseFirePoint,
} from '../schedule/footprint.js';
import type { ScheduleSpec } from '../schedule/spec.js';
import { nextFireAt, validateSpec } from '../schedule/spec.js';
import type { SchedulerEvent } from '../schedule/scheduler.js';
import { Scheduler } from '../schedule/scheduler.js';

/** Deterministic manual-fire session id (mirror of scheduleSessionId). */
export function manualFireSessionId(specId: string, firedAt: number): string {
  return `${MANUAL_FIRE_SEGMENT}:${specId}:${firedAt}`;
}

/** A ScheduleSpec plus a human-readable name (data-plane field; the host renders it). */
export interface RoutineSpec extends ScheduleSpec {
  name?: string;
}

export interface RoutineStatus {
  spec: RoutineSpec;
  enabled: boolean;
  /**
   * Newest fire point across BOTH segments (scheduled + manual) — the
   * display truth of "when did this routine last do anything". null = no
   * footprint yet.
   */
  lastFireAt: number | null;
  /**
   * The next SCHEDULED fire point, computed from the `sched:` footprint
   * alone — deliberately NOT from lastFireAt: a manual fire never moves the
   * schedule, so the display must not either (a value <= now means a missed
   * point the Scheduler will fire on its next compensation pass). null when
   * the routine is disabled.
   */
  nextFireAt: number | null;
  /** Session record of the lastFireAt fire (state / lastError for the inbox). null = none. */
  lastSession: SessionRecord | null;
}

export type RoutineEvent =
  | { type: 'routine:enabled'; routineId: string }
  | { type: 'routine:disabled'; routineId: string }
  | { type: 'routine:manual-fire'; routineId: string; sessionId: string; firedAt: number }
  | SchedulerEvent;

export interface RoutineManagerOptions {
  ledger: TaskLedger;
  routines: readonly RoutineSpec[];
  /**
   * Routine ids that start disabled. Runtime flips surface as events; the
   * host persists the table and passes it back next boot (ruling D4 —
   * no RoutineStore seam). Unknown ids throw: a typo here would silently
   * leave the wrong routine running.
   */
  initiallyDisabled?: readonly string[];
  clock?: Clock;
  /** Forwarded to the internal Scheduler (default 1000 ms). */
  pollIntervalMs?: number;
  /** Forwarded to the internal Scheduler (gap G3 short-lived-host seeding). */
  seedFirstRun?: boolean;
  /** Observability seam: routine events + Scheduler passthrough. Errors swallowed. */
  onEvent?: (event: RoutineEvent) => void;
}

export class RoutineManager {
  readonly #ledger: TaskLedger;
  readonly #specs: RoutineSpec[];
  readonly #byId = new Map<string, RoutineSpec>();
  readonly #disabled = new Set<string>();
  readonly #clock: Clock;
  readonly #pollIntervalMs: number | undefined;
  readonly #seedFirstRun: boolean;
  readonly #onEvent: ((event: RoutineEvent) => void) | undefined;

  #running = false;
  /**
   * Run/rebuild generation: every start(), stop() and enabled-set change
   * bumps it, and a queued rebuild aborts once its generation is stale —
   * the same discipline the Scheduler/driver poll chains use, applied to
   * scheduler-instance swaps.
   */
  #generation = 0;
  #scheduler: Scheduler | null = null;
  /** Serializes scheduler swaps so stop(old) and start(new) never interleave. */
  #swapChain: Promise<void> = Promise.resolve();

  constructor(opts: RoutineManagerOptions) {
    this.#ledger = opts.ledger;
    this.#specs = [...opts.routines];
    this.#clock = opts.clock ?? systemClock;
    this.#pollIntervalMs = opts.pollIntervalMs;
    this.#seedFirstRun = opts.seedFirstRun === true;
    this.#onEvent = opts.onEvent;
    for (const spec of this.#specs) {
      validateSpec(spec);
      if (spec.name !== undefined && (typeof spec.name !== 'string' || spec.name.length === 0)) {
        throw new TypeError(`RoutineManager: routine '${spec.id}' name must be a non-empty string`);
      }
      if (this.#byId.has(spec.id)) {
        throw new Error(`RoutineManager: duplicate routine id '${spec.id}'`);
      }
      this.#byId.set(spec.id, spec);
    }
    for (const id of opts.initiallyDisabled ?? []) {
      this.#requireKnown(id);
      this.#disabled.add(id);
    }
  }

  #requireKnown(id: string): RoutineSpec {
    const spec = this.#byId.get(id);
    if (spec === undefined) {
      throw new Error(`RoutineManager: unknown routine '${id}'`);
    }
    return spec;
  }

  #emit(event: RoutineEvent): void {
    if (this.#onEvent === undefined) return;
    try {
      this.#onEvent(event);
    } catch {
      // The observability seam must never take the manager down.
    }
  }

  #makeScheduler(): Scheduler | null {
    const enabled = this.#specs.filter((spec) => !this.#disabled.has(spec.id));
    if (enabled.length === 0) return null;
    return new Scheduler({
      ledger: this.#ledger,
      specs: enabled,
      clock: this.#clock,
      ...(this.#pollIntervalMs !== undefined ? { pollIntervalMs: this.#pollIntervalMs } : {}),
      ...(this.#seedFirstRun ? { seedFirstRun: true } : {}),
      onEvent: (event) => this.#emit(event),
    });
  }

  /**
   * Queue a scheduler swap for the CURRENT generation: stop the old
   * instance, then — only if no newer generation superseded this one —
   * build and start the replacement. Rebuild-safe under any interleaving of
   * enable/disable/stop because swaps are chained and generations are
   * checked after every await. Rebuilding (rather than hot-editing the
   * Scheduler's spec list) is free by design: the Scheduler's polling is
   * stateless, its footprint lives in the ledger, and its generation
   * discipline makes stop()/start() cheap.
   */
  #queueSwap(): Promise<void> {
    const generation = this.#generation;
    const task = this.#swapChain.then(async () => {
      const old = this.#scheduler;
      this.#scheduler = null;
      if (old !== null) await old.stop();
      if (!this.#running || generation !== this.#generation) return;
      const next = this.#makeScheduler();
      this.#scheduler = next;
      next?.start();
    });
    // Keep the chain alive even if a swap rejects (a Scheduler.stop failure
    // must not wedge every later swap behind a rejected link).
    this.#swapChain = task.catch(() => {});
    return task;
  }

  /** Idempotent. Synchronous like Scheduler.start(); the first swap is queued. */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#generation += 1;
    void this.#queueSwap();
  }

  /** Stop dispatching; resolves after the internal Scheduler fully stops. */
  async stop(): Promise<void> {
    this.#running = false;
    this.#generation += 1;
    await this.#swapChain;
    const current = this.#scheduler;
    this.#scheduler = null;
    if (current !== null) await current.stop();
  }

  isRunning(): boolean {
    return this.#running;
  }

  /** Enable a routine. Resolves once the schedule swap has landed. Idempotent. */
  async enable(id: string): Promise<void> {
    this.#requireKnown(id);
    if (!this.#disabled.has(id)) return;
    this.#disabled.delete(id);
    this.#generation += 1;
    this.#emit({ type: 'routine:enabled', routineId: id });
    if (this.#running) await this.#queueSwap();
  }

  /** Disable a routine (future fires only; in-flight sessions are untouched). */
  async disable(id: string): Promise<void> {
    this.#requireKnown(id);
    if (this.#disabled.has(id)) return;
    this.#disabled.add(id);
    this.#generation += 1;
    this.#emit({ type: 'routine:disabled', routineId: id });
    if (this.#running) await this.#queueSwap();
  }

  /**
   * Fire a routine NOW, bypassing the cadence. Works while stopped and on a
   * disabled routine (an explicit human act needs no running scheduler).
   * Idempotency key `manual:{id}:{firedAt}`: a same-millisecond double
   * click lands on DuplicateSessionError and adopts the existing session
   * (adopt-don't-crash, the GoalChaser/Scheduler discipline). The payload
   * envelope mirrors a scheduled fire's, plus `manual: true`, so one
   * executor serves both fire paths.
   */
  async triggerNow(id: string, opts: { payload?: unknown } = {}): Promise<SessionRecord> {
    const spec = this.#requireKnown(id);
    const firedAt = this.#clock.now();
    const sessionId = manualFireSessionId(id, firedAt);
    const payload = {
      schedule: { specId: id, fireAt: firedAt, manual: true },
      data: opts.payload !== undefined ? opts.payload : spec.payload,
    };
    let session: SessionRecord;
    let fresh = true;
    try {
      session = await this.#ledger.dispatch({
        id: sessionId,
        intent: spec.intent,
        payload,
        ...(spec.maxAttempts !== undefined ? { maxAttempts: spec.maxAttempts } : {}),
      });
    } catch (error) {
      if (!(error instanceof DuplicateSessionError)) throw error;
      const adopted = await this.#ledger.getSession(sessionId);
      if (adopted === null) throw error;
      session = adopted;
      fresh = false;
    }
    if (fresh) {
      this.#emit({ type: 'routine:manual-fire', routineId: id, sessionId, firedAt });
    }
    return session;
  }

  #statusOf(spec: RoutineSpec, sessions: readonly SessionRecord[], now: number): RoutineStatus {
    let schedLast: number | null = null;
    let displayLast: number | null = null;
    let lastSession: SessionRecord | null = null;
    for (const session of sessions) {
      const sched = parseFirePoint(session.id, spec.id, SCHEDULE_FIRE_SEGMENT);
      const manual = parseFirePoint(session.id, spec.id, MANUAL_FIRE_SEGMENT);
      const point = sched ?? manual;
      if (point === null) continue;
      if (sched !== null && (schedLast === null || sched > schedLast)) schedLast = sched;
      if (displayLast === null || point > displayLast) {
        displayLast = point;
        lastSession = session;
      }
    }
    const enabled = !this.#disabled.has(spec.id);
    // The same base the Scheduler itself would recover with — so the
    // displayed next point is what the dispatcher will actually do, missed
    // points included (a value <= now reads as "due, fires on catch-up").
    const base = schedLast ?? (this.#seedFirstRun ? now - (spec.every ?? 86_400_000) : now);
    return {
      spec,
      enabled,
      lastFireAt: displayLast,
      nextFireAt: enabled ? nextFireAt(spec, base) : null,
      lastSession,
    };
  }

  /** Status of every routine, in declaration order. One ledger scan per call. */
  async list(): Promise<RoutineStatus[]> {
    const sessions = await this.#ledger.listSessions();
    const now = this.#clock.now();
    return this.#specs.map((spec) => this.#statusOf(spec, sessions, now));
  }

  /** Status of one routine, or null for an unknown id (read path stays soft). */
  async get(id: string): Promise<RoutineStatus | null> {
    const spec = this.#byId.get(id);
    if (spec === undefined) return null;
    const sessions = await this.#ledger.listSessions();
    return this.#statusOf(spec, sessions, this.#clock.now());
  }
}
