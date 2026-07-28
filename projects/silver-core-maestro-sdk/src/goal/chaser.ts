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
import { waitOrAbort } from '../internal/wait.js';
import type { TaskLedger } from '../ledger/ledger.js';
import { DuplicateSessionError } from '../ledger/ledger.js';
import { isTerminal } from '../ledger/state.js';
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
  /** Previous round verdict's reason; null on the first round. (Field name
   *  predates the 0.83.0 verdict unification and is kept — it is persisted
   *  payload schema, and "feedback" is what the next round consumes it as.) */
  feedback: string | null;
  round: number;
}

/**
 * Host-injected judge: round data in, verdict out — no rendering. A FAILED
 * round is still judged (its verdict may continue the chase with feedback).
 * The verdict shape is UNIFIED with the agent SDK's `options.goal` evaluator
 * (0.83.0): one host evaluator can serve both seams.
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
   *
   * `opts.signal` (0.78.0) abandons the chase: it is checked before every
   * terminal poll and interrupts the inter-poll sleep, rejecting with the
   * signal's reason. Round records stay in the ledger, so a later chase of the
   * same goal id resumes from them (design review 2026-07-26 F4 — previously
   * the only exit was drainTimeoutMs, unset by default).
   */
  async chase(
    config: GoalRunConfig,
    opts: { signal?: AbortSignal } = {},
  ): Promise<GoalChaseResult> {
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
      // Checked BEFORE the round is dispatched, the same discipline
      // WorkflowRun.run() applies before its tick: an abort that lands while
      // the (host-supplied, arbitrarily slow) evaluator is deciding must not
      // buy the chase one more round. Without this, an abandon signal raised
      // mid-evaluation still dispatched the NEXT round session, which the
      // host's driver then claimed and executed — real work initiated after
      // the host said stop, and only then did #awaitTerminal reject.
      opts.signal?.throwIfAborted();
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
      const terminal = await this.#awaitTerminal(pending.id, opts.signal);
      pending = null;
      // A cancelled round settles the chase WITHOUT consulting the evaluator
      // (0.78.0): the host said "stop, forever" about this round's session, so
      // there is nothing for the judge to rule on and re-initiating the next
      // round would defy the cancel. No `goal:round` event is emitted — that
      // event's contract requires a verdict, and none exists.
      if (terminal.state === 'cancelled') {
        rounds.push(terminal);
        this.#emit({
          type: 'goal:settled',
          goalId: config.id,
          action: 'cancelled',
          rounds: rounds.length,
        });
        return { action: 'cancelled', rounds };
      }
      const summary = await this.#lastOkSummary(terminal.id);
      const verdict = await this.#evaluator({ round, session: terminal, summary });
      // The verdict shape is the family-wide contract (0.83.0) and this is the
      // only door it enters by — so validate it here, as the agent SDK's twin
      // seam does (hooks/goal.ts `isVerdict`). Unvalidated, an off-vocabulary
      // or absent `status` fell through nextGoalAction's else-branch as
      // 'not_achieved': a host evaluator still speaking the pre-0.83.0
      // { achieved, feedback } shape — the exact trap the unification closed —
      // reported the goal MET and the chase silently dispatched maxRounds of
      // real, paid rounds and settled 'exhausted'. Both packages must refuse a
      // malformed verdict; the direction differs by seam (the agent side
      // fail-opens because blocking is its dangerous act, here continuing is).
      const candidate: unknown = verdict;
      if (
        typeof candidate !== 'object' ||
        candidate === null ||
        (verdict.status !== 'achieved' &&
          verdict.status !== 'not_achieved' &&
          verdict.status !== 'impossible')
      ) {
        throw new TypeError(
          `GoalChaser.chase: evaluator returned a malformed verdict for round ${round} of ` +
            `goal '${config.id}' — expected { status: 'achieved' | 'not_achieved' | 'impossible', ` +
            `reason?: string }, got ${JSON.stringify(verdict)}`,
        );
      }
      const action = nextGoalAction({ round, maxRounds, verdict });
      rounds.push(terminal);
      this.#emit({ type: 'goal:round', goalId: config.id, round, session: terminal, verdict, action });
      if (action !== 'continue') {
        this.#emit({ type: 'goal:settled', goalId: config.id, action, rounds: rounds.length });
        return { action, rounds };
      }
      // action === 'continue' implies status 'not_achieved' here; `?? null`:
      // an any-cast verdict without a reason must not smuggle `undefined`
      // into the next round's persisted payload (typed `| null`).
      feedback = verdict.reason ?? null;
      round += 1;
    }
  }

  /**
   * Poll getSession on the injected clock until the round reaches ANY terminal
   * state — including `cancelled` (0.78.0). Spelling this as
   * `done || failed` treated a cancelled round as still in flight and the
   * chase polled until its drain timeout, which is unset by default: a user
   * cancel hung the chase forever (design review 2026-07-26 F1).
   */
  async #awaitTerminal(sessionId: string, signal?: AbortSignal): Promise<SessionRecord> {
    const deadline =
      this.#drainTimeoutMs === undefined ? undefined : this.#clock.now() + this.#drainTimeoutMs;
    for (;;) {
      signal?.throwIfAborted();
      const session = await this.#ledger.getSession(sessionId);
      if (session !== null && isTerminal(session.state)) {
        return session;
      }
      if (deadline !== undefined && this.#clock.now() > deadline) {
        throw new Error(
          `GoalChaser: drain timeout — session '${sessionId}' still ` +
            `${session === null ? 'missing' : session.state} (is the driver running?)`,
        );
      }
      await waitOrAbort(this.#clock, this.#pollIntervalMs, signal);
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
