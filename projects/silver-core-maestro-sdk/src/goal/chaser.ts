/**
 * GoalChaser — cross-query goal re-initiation over the task ledger
 * (campaign 5, SCS-REQ orchestrator-sdk §3 "跨会话目标循环"). Division of
 * labor: the engine-side goal (agent SDK) owns attainment WITHIN one query;
 * this component owns ACROSS-query rounds — each round is one ledger session,
 * executed by the host's LedgerDriver, never here. Goal semantics live only
 * in the session payload (scenario layer); the ledger schema is untouched.
 * All time goes through the injected clock; observability is the host-injected
 * onEvent seam (data out, rendering host-side).
 */

import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import type { TaskLedger } from '../ledger/ledger.js';
import { DuplicateSessionError } from '../ledger/ledger.js';
import type { SessionRecord } from '../ledger/types.js';
import type { GoalAction, GoalVerdict } from './decision.js';
import { nextGoalAction } from './decision.js';

/** Deterministic per-round session id — the idempotency/resume key. */
export function goalRoundSessionId(goalId: string, round: number): string {
  return `goal:${goalId}:round-${round}`;
}

export interface GoalRunConfig {
  /** Goal identity (non-empty; part of every round's session id). */
  id: string;
  /** Host-language statement of the goal, carried to every round's payload. */
  description: string;
  /** Cross-query round budget (default 5). */
  maxRounds?: number;
  /** Forwarded as each round session's maxAttempts (unset = ledger default). */
  maxAttemptsPerRound?: number;
  /** Opaque host data, forwarded untouched as payload.data. */
  payload?: unknown;
}

/** Envelope dispatched as each round session's payload (scenario layer). */
export interface GoalRoundPayload {
  goal: { id: string; description: string };
  data: unknown;
  /** Previous round verdict's feedback; null on the first round. */
  feedback: string | null;
  round: number;
}

/**
 * Host-injected judge: round data in, verdict out — no rendering. A FAILED
 * round is still judged (its verdict may continue the chase with feedback).
 */
export type GoalEvaluator = (round: {
  round: number;
  session: SessionRecord;
  summary: string | null;
}) => Promise<GoalVerdict>;

export type GoalChaserEvent =
  | {
      type: 'goal:round';
      goalId: string;
      round: number;
      session: SessionRecord;
      verdict: GoalVerdict;
      action: GoalAction;
    }
  | { type: 'goal:settled'; goalId: string; action: Exclude<GoalAction, 'continue'>; rounds: number };

export interface GoalChaserOptions {
  ledger: TaskLedger;
  evaluator: GoalEvaluator;
  clock?: Clock;
  /** Terminal-state poll cadence while awaiting a round (default 300 ms). */
  pollIntervalMs?: number;
  /**
   * Cap on waiting for a round session to reach a terminal state. Unset =
   * wait indefinitely (driver convention) — but a stopped driver leaves a
   * round parked in 'retrying' forever, so hosts that stop their driver
   * should set this escape hatch (review finding 2026-07-18).
   */
  drainTimeoutMs?: number;
  /** Observability seam mirroring driver conventions; callback errors are swallowed. */
  onEvent?: (event: GoalChaserEvent) => void;
}

export interface GoalChaseResult {
  action: Exclude<GoalAction, 'continue'>;
  /** Every round session of this goal, in round order, at terminal state. */
  rounds: SessionRecord[];
}

export class GoalChaser {
  readonly #ledger: TaskLedger;
  readonly #evaluator: GoalEvaluator;
  readonly #clock: Clock;
  readonly #pollIntervalMs: number;
  readonly #drainTimeoutMs: number | undefined;
  readonly #onEvent: ((event: GoalChaserEvent) => void) | undefined;

  constructor(opts: GoalChaserOptions) {
    const pollIntervalMs = opts.pollIntervalMs ?? 300;
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
      throw new RangeError('GoalChaser: pollIntervalMs must be a finite number >= 0');
    }
    this.#ledger = opts.ledger;
    this.#evaluator = opts.evaluator;
    this.#clock = opts.clock ?? systemClock;
    this.#pollIntervalMs = pollIntervalMs;
    if (opts.drainTimeoutMs !== undefined && (!Number.isFinite(opts.drainTimeoutMs) || opts.drainTimeoutMs <= 0)) {
      throw new RangeError('GoalChaser: drainTimeoutMs must be a finite number > 0');
    }
    this.#drainTimeoutMs = opts.drainTimeoutMs;
    this.#onEvent = opts.onEvent;
  }

  /**
   * Run the cross-query loop until a non-continue action. Resume contract:
   * one upfront scan for existing round ids finds where a previous chase
   * stopped — completed earlier rounds are kept as-is (never re-dispatched),
   * the latest existing round is awaited/re-judged (its verdict was never
   * persisted — goal semantics stay out of the ledger), and the chase
   * proceeds from there. The host's LedgerDriver must be running for rounds
   * to make progress.
   */
  async chase(config: GoalRunConfig): Promise<GoalChaseResult> {
    if (typeof config.id !== 'string' || config.id.length === 0) {
      throw new TypeError('GoalChaser.chase: config.id must be a non-empty string');
    }
    // ':' is the session-id segment separator (goal:{id}:round-{n}); a colon
    // in the goal id collides distinct goals onto one round record (review
    // finding 2026-07-18, same rule as workflow/schedule ids).
    if (config.id.includes(':')) {
      throw new TypeError(`GoalChaser.chase: config.id must not contain ':' (got '${config.id}')`);
    }
    if (typeof config.description !== 'string' || config.description.length === 0) {
      throw new TypeError('GoalChaser.chase: config.description must be a non-empty string');
    }
    const maxRounds = config.maxRounds ?? 5;
    if (!Number.isInteger(maxRounds) || maxRounds < 1) {
      throw new RangeError(`GoalChaser.chase: maxRounds must be an integer >= 1, got ${maxRounds}`);
    }

    // Resume scan: contiguous existing rounds from 1 upward until the first
    // gap. Deliberately UNBOUNDED by maxRounds: rounds beyond the budget can
    // exist (a previous chase ran with a larger budget), and stopping the
    // scan at maxRounds would re-judge a stale middle round as 'latest' while
    // dropping the later ones from the result (review finding 2026-07-18).
    // The exhaustion decision is applied against the true count below.
    const existing: SessionRecord[] = [];
    for (let n = 1; ; n += 1) {
      const session = await this.#ledger.getSession(goalRoundSessionId(config.id, n));
      if (session === null) break;
      existing.push(session);
    }

    // Earlier completed rounds enter the result untouched; only the latest
    // existing round re-enters the judge loop (feedback must be re-derived).
    const rounds: SessionRecord[] = existing.slice(0, Math.max(existing.length - 1, 0));
    let pending: SessionRecord | null =
      existing.length > 0 ? (existing[existing.length - 1] ?? null) : null;
    let round = existing.length > 0 ? existing.length : 1;
    let feedback: string | null = null;

    for (;;) {
      if (pending === null) {
        const sessionId = goalRoundSessionId(config.id, round);
        const payload: GoalRoundPayload = {
          goal: { id: config.id, description: config.description },
          data: config.payload,
          feedback,
          round,
        };
        try {
          pending = await this.#ledger.dispatch({
            id: sessionId,
            intent: `goal:${config.id}`,
            payload,
            ...(config.maxAttemptsPerRound !== undefined
              ? { maxAttempts: config.maxAttemptsPerRound }
              : {}),
          });
        } catch (error) {
          // A concurrent chase of the same goal id won the dispatch race for
          // this round. Adopt-don't-crash: the existing session IS this round
          // — await it like our own, so both chasers settle on the same round
          // records and single-chase semantics are preserved (review finding
          // 2026-07-18). Only the typed duplicate error is adopted; anything
          // else (store failure) still escapes.
          if (!(error instanceof DuplicateSessionError)) throw error;
          const adopted = await this.#ledger.getSession(sessionId);
          if (adopted === null) throw error;
          pending = adopted;
        }
      }
      const terminal = await this.#awaitTerminal(pending.id);
      pending = null;
      const summary = await this.#lastOkSummary(terminal.id);
      const verdict = await this.#evaluator({ round, session: terminal, summary });
      const action = nextGoalAction({ round, maxRounds, verdict });
      rounds.push(terminal);
      this.#emit({ type: 'goal:round', goalId: config.id, round, session: terminal, verdict, action });
      if (action !== 'continue') {
        this.#emit({ type: 'goal:settled', goalId: config.id, action, rounds: rounds.length });
        return { action, rounds };
      }
      // `?? null`: an any-cast verdict without feedback must not smuggle
      // `undefined` into the next round's persisted payload (typed `| null`).
      if (!verdict.achieved) feedback = verdict.feedback ?? null;
      round += 1;
    }
  }

  /** Poll getSession on the injected clock until the round is terminal. */
  async #awaitTerminal(sessionId: string): Promise<SessionRecord> {
    const deadline =
      this.#drainTimeoutMs === undefined ? undefined : this.#clock.now() + this.#drainTimeoutMs;
    for (;;) {
      const session = await this.#ledger.getSession(sessionId);
      if (session !== null && (session.state === 'done' || session.state === 'failed')) {
        return session;
      }
      if (deadline !== undefined && this.#clock.now() > deadline) {
        throw new Error(
          `GoalChaser: drain timeout — session '${sessionId}' still ` +
            `${session === null ? 'missing' : session.state} (is the driver running?)`,
        );
      }
      await new Promise<void>((resolve) => {
        this.#clock.setTimeout(resolve, this.#pollIntervalMs);
      });
    }
  }

  /** The round's last ok query row's summary, else null. */
  async #lastOkSummary(sessionId: string): Promise<string | null> {
    const queries = await this.#ledger.listQueries(sessionId);
    for (let i = queries.length - 1; i >= 0; i -= 1) {
      const row = queries[i];
      if (row !== undefined && row.outcome === 'ok') return row.summary ?? null;
    }
    return null;
  }

  #emit(event: GoalChaserEvent): void {
    if (this.#onEvent === undefined) return;
    try {
      this.#onEvent(event);
    } catch {
      // The observability seam must never take the chase down.
    }
  }
}
