/**
 * AgentExecutor — the session-assembly part (design round 3, 2026-07-29:
 * `maestro-sdk-agent-assembly-design-20260729.md` §3; keeper rulings 裁2 /
 * D2 / D6). It fills the LedgerDriver's executor seat with an agent-SDK
 * `query()` call: extract the run request from the session payload, run the
 * query, relay every streamed message to the host's observability seam, and
 * fold the terminal result message into an ExecutorResult.
 *
 * INJECTED, never imported (ruling 裁2): the host hands its `query` function
 * in; this package re-declares the minimal structural shape below and keeps
 * zero imports of — and zero runtime dependency on — silver-core-agent-sdk
 * (hard property §1.2 "no privileged channel"; P1 ruling 2026-07-26 deleted
 * the peerDependency and this module must not resurrect it). The assembly
 * duty of the charter's positioning line is discharged by assembling the
 * SHAPE the host provides, not by importing the package.
 *
 * Deliberate non-features, each a ruling:
 * - no retry here (retries are the ledger state machine's job);
 * - no wall clock held for recurrence (the driver and scheduler hold time;
 *   the injected clock below only times the interrupt grace window);
 * - no prompt-text interpretation (slash parsing left the engine for good —
 *   the orchestration layer does not pick it up);
 * - no automatic cross-attempt resume (ruling D6): a retry RERUNS — the
 *   idempotency assumption every other ledger consumer already lives by.
 *   Recovery-with-context is the host's explicit act: reopenSession with a
 *   payload whose request carries `resume` (the agentSessionId handed out
 *   through onResult is the key).
 */

import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import type { Executor, ExecutorResult } from '../driver.js';
import type { SessionRecord } from '../ledger/types.js';
import type { GoalRoundPayload } from '../goal/chaser.js';

/**
 * Minimal structural shape of the agent SDK's `Query` handle — re-declared
 * verbatim-compatible, no cross-package import (the GoalVerdict discipline,
 * agent SDK subsystems.ts; changing this shape is a family-level ruling).
 * The real `query()` return value is a structural superset: hosts pass the
 * agent SDK's `query` straight in.
 */
export interface AgentQueryHandle extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>;
  close(): void;
}

/** The injected query function (typically silver-core-agent-sdk's `query`). */
export type AgentQueryFn = (args: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AgentQueryHandle;

/**
 * The data-plane run request carried in a session payload (assembled by the
 * Scheduler envelope, a workflow node payload, a goal-round formatter, or
 * the host directly).
 */
export interface AgentRunRequest {
  prompt: string;
  /** Forwarded verbatim to the query options (model / mcpServers / goal / ...). */
  options?: Record<string, unknown>;
  /** Agent-side session id to resume; merged into options.resume. */
  resume?: string;
  /** Merged into options.maxBudgetUsd (per-attempt budget cap; engine-enforced). */
  maxBudgetUsd?: number;
}

/** Payload convention read by the default extractor: `{ agent: {...} }`. */
export interface AgentRunPayload {
  agent: AgentRunRequest;
}

/** Rich per-attempt outcome handed to the onResult seam (host persists what it wants). */
export interface AgentRunResult {
  outcome: 'ok' | 'error';
  error?: string;
  summary?: string;
  /** Agent-side session id — the resume / accounting key. */
  agentSessionId?: string;
  /** The engine's own cost estimate for this query, transcribed verbatim. */
  costUsd?: number;
  /** The raw terminal result message, when one arrived. */
  raw?: unknown;
}

export interface AgentExecutorOptions {
  /** The injection seam (sole required option): the host's agent query function. */
  query: AgentQueryFn;
  /**
   * payload -> run request. Default: extractPlainAgent (reads payload.agent,
   * falling back to the Scheduler envelope's payload.data.agent). Returning
   * null fails LOUD: the attempt settles as an error through the normal
   * retry path — a payload without a run request must never burn attempts
   * silently (the /loop transparent-passthrough lesson, 2026-07-14).
   */
  extract?: (session: SessionRecord) => AgentRunRequest | null;
  /**
   * Message observability seam: every streamed message (including the
   * subagent task_started / task_progress / task_updated / task_notification
   * family) crosses here for the host's live view. Callback errors are
   * swallowed (driver onEvent discipline). Data out, rendering host-side.
   */
  onMessage?: (session: SessionRecord, message: unknown) => void;
  /** Result observability seam: the folded AgentRunResult. Errors swallowed. */
  onResult?: (session: SessionRecord, result: AgentRunResult) => void;
  /**
   * Grace window after an abort: the signal triggers `interrupt()` (polite
   * stop); if the stream has not ended when the window elapses, `close()`
   * (hard stop). Timed on the injected clock. Default 5000 ms.
   */
  interruptGraceMs?: number;
  clock?: Clock;
}

/** Cap applied to the ok-summary transcription of the result text. */
const SUMMARY_CAP = 2_000;

function truncate(text: string, cap: number): string {
  return text.length <= cap ? text : `${text.slice(0, cap)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validate an unknown value into an AgentRunRequest, or null. Shared by all
 * extractors so a malformed request fails the same LOUD way everywhere.
 */
function readRequest(value: unknown): AgentRunRequest | null {
  if (!isRecord(value)) return null;
  if (typeof value.prompt !== 'string' || value.prompt.length === 0) return null;
  const out: AgentRunRequest = { prompt: value.prompt };
  if (value.options !== undefined) {
    if (!isRecord(value.options) || Array.isArray(value.options)) return null;
    out.options = value.options as Record<string, unknown>;
  }
  if (value.resume !== undefined) {
    if (typeof value.resume !== 'string' || value.resume.length === 0) return null;
    out.resume = value.resume;
  }
  if (value.maxBudgetUsd !== undefined) {
    if (
      typeof value.maxBudgetUsd !== 'number' ||
      !Number.isFinite(value.maxBudgetUsd) ||
      value.maxBudgetUsd <= 0
    ) {
      return null;
    }
    out.maxBudgetUsd = value.maxBudgetUsd;
  }
  return out;
}

/**
 * Default extractor: `payload.agent`, else the Scheduler fire envelope's
 * `payload.data.agent` (so a ScheduleSpec whose payload is `{ agent: {...} }`
 * needs no custom extract).
 */
export function extractPlainAgent(session: SessionRecord): AgentRunRequest | null {
  if (!isRecord(session.payload)) return null;
  const direct = readRequest(session.payload.agent);
  if (direct !== null) return direct;
  const data = session.payload.data;
  if (isRecord(data)) return readRequest(data.agent);
  return null;
}

/**
 * Workflow-node extractor: reads `payload.node.agent` out of the
 * WorkflowNodePayload envelope ({ node, workflow }). Hosts that want the
 * convergence dep summaries folded into the prompt write their own extract —
 * the seam exists precisely for that.
 */
export function extractWorkflowNode(session: SessionRecord): AgentRunRequest | null {
  if (!isRecord(session.payload)) return null;
  const node = session.payload.node;
  if (!isRecord(node)) return null;
  return readRequest(node.agent);
}

function isGoalRoundPayload(value: unknown): value is GoalRoundPayload {
  if (!isRecord(value)) return false;
  const goal = value.goal;
  if (!isRecord(goal)) return false;
  if (typeof goal.id !== 'string' || goal.id.length === 0) return false;
  if (typeof goal.description !== 'string' || goal.description.length === 0) return false;
  if (!Number.isInteger(value.round) || (value.round as number) < 1) return false;
  return value.feedback === null || value.feedback === undefined || typeof value.feedback === 'string';
}

/**
 * Goal-round extractor factory: recognizes a GoalChaser round payload and
 * hands it to the host's formatter (prompt wording is scenario-layer
 * language — the SDK does not invent it; the previous round's verdict reason
 * arrives as payload.feedback for the formatter to inject). The formatted
 * request passes through the same validation as every other path.
 */
export function extractGoalRound(
  format: (payload: GoalRoundPayload, session: SessionRecord) => AgentRunRequest,
): (session: SessionRecord) => AgentRunRequest | null {
  return (session) => {
    if (!isGoalRoundPayload(session.payload)) return null;
    return readRequest(format(session.payload, session));
  };
}

/** Fold one terminal result message (structural read; unknown fields ignored). */
function foldResultMessage(message: Record<string, unknown>): AgentRunResult {
  const subtype = typeof message.subtype === 'string' ? message.subtype : undefined;
  const text = typeof message.result === 'string' ? message.result : undefined;
  const costUsd =
    typeof message.total_cost_usd === 'number' &&
    Number.isFinite(message.total_cost_usd) &&
    message.total_cost_usd >= 0
      ? message.total_cost_usd
      : undefined;
  const agentSessionId =
    typeof message.session_id === 'string' && message.session_id.length > 0
      ? message.session_id
      : undefined;
  if (subtype === 'success') {
    const summary =
      truncate(text ?? '', SUMMARY_CAP) +
      (costUsd !== undefined ? ` [cost $${costUsd.toFixed(4)}]` : '');
    return {
      outcome: 'ok',
      summary,
      ...(agentSessionId !== undefined ? { agentSessionId } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      raw: message,
    };
  }
  // Non-success: prefer the stable machine code, then the normalized
  // provider error — the agent SDK ships both so nobody string-matches.
  const errorCode = typeof message.error_code === 'string' ? message.error_code : undefined;
  const provider = isRecord(message.providerError) ? message.providerError : undefined;
  const providerBits = provider
    ? ['code', 'status', 'message']
        .map((k) => provider[k])
        .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
        .join(' ')
    : '';
  const parts = [
    `agent run ended '${subtype ?? 'unknown'}'`,
    errorCode !== undefined ? `[${errorCode}]` : '',
    providerBits,
    text !== undefined ? truncate(text, 300) : '',
  ].filter((p) => p !== '');
  return {
    outcome: 'error',
    error: parts.join(' '),
    ...(agentSessionId !== undefined ? { agentSessionId } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    raw: message,
  };
}

/**
 * Build an Executor that runs each claimed session as ONE agent query.
 *
 * Behavior spec (design doc §3.3):
 * - extract -> null or malformed = LOUD error outcome (normal retry path);
 * - options composition: request.options ← resume ← maxBudgetUsd (later
 *   wins on key collision);
 * - every streamed message crosses onMessage before folding;
 * - the last `type: 'result'` message decides the outcome; a stream that
 *   ends without one is an error;
 * - ctx.signal abort -> interrupt(), then close() after interruptGraceMs;
 *   a result captured before the abort still counts. The driver's own
 *   timedOut flag turns a timeout abort's outcome into 'timeout' — this
 *   executor never distinguishes who pressed stop;
 * - costUsd rides the ExecutorResult into the query row (ruling D2); the
 *   richer AgentRunResult (agentSessionId, raw message) exits via onResult.
 */
export function createAgentExecutor(opts: AgentExecutorOptions): Executor {
  if (typeof opts.query !== 'function') {
    throw new TypeError('createAgentExecutor: opts.query must be a function');
  }
  const graceMs = opts.interruptGraceMs ?? 5_000;
  if (!Number.isFinite(graceMs) || graceMs <= 0) {
    throw new RangeError(
      `createAgentExecutor: interruptGraceMs must be a finite number > 0, got ${graceMs}`,
    );
  }
  const clock = opts.clock ?? systemClock;
  const extract = opts.extract ?? extractPlainAgent;

  const emitMessage = (session: SessionRecord, message: unknown): void => {
    if (opts.onMessage === undefined) return;
    try {
      opts.onMessage(session, message);
    } catch {
      // The observability seam must never take the attempt down.
    }
  };
  const emitResult = (session: SessionRecord, result: AgentRunResult): void => {
    if (opts.onResult === undefined) return;
    try {
      opts.onResult(session, result);
    } catch {
      // Same discipline.
    }
  };
  const settle = (session: SessionRecord, run: AgentRunResult): ExecutorResult => {
    emitResult(session, run);
    return {
      outcome: run.outcome,
      ...(run.error !== undefined ? { error: run.error } : {}),
      ...(run.summary !== undefined ? { summary: run.summary } : {}),
      ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
    };
  };

  return async function agentExecutor(session, ctx): Promise<ExecutorResult> {
    const request = extract(session);
    if (request === null) {
      return settle(session, {
        outcome: 'error',
        error: `session '${session.id}' payload carries no agent run request`,
      });
    }
    const options: Record<string, unknown> = { ...(request.options ?? {}) };
    if (request.resume !== undefined) options.resume = request.resume;
    if (request.maxBudgetUsd !== undefined) options.maxBudgetUsd = request.maxBudgetUsd;

    const handle = opts.query({ prompt: request.prompt, options });

    let interrupted = false;
    let graceHandle: unknown = null;
    const onAbort = (): void => {
      interrupted = true;
      try {
        // interrupt() may itself reject (e.g. the stream already ended);
        // that must not become an unhandled rejection.
        void Promise.resolve(handle.interrupt()).catch(() => {});
      } catch {
        // A synchronous throw from interrupt() gets the same treatment.
      }
      graceHandle = clock.setTimeout(() => {
        try {
          handle.close();
        } catch {
          // close() after natural end is a no-op worth nothing.
        }
      }, graceMs);
    };
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener('abort', onAbort, { once: true });

    let resultMessage: Record<string, unknown> | null = null;
    try {
      for await (const message of handle) {
        emitMessage(session, message);
        if (isRecord(message) && message.type === 'result') {
          resultMessage = message;
        }
      }
    } catch (error) {
      // A stream broken by OUR interrupt/close is the abort playing out —
      // fold it below. Any other mid-stream failure propagates: the driver's
      // contract already records executor rejections as error outcomes.
      if (!interrupted) throw error;
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      if (graceHandle !== null) clock.clearTimeout(graceHandle);
    }

    if (resultMessage !== null) {
      // A result captured before (or despite) an abort is the truth.
      return settle(session, foldResultMessage(resultMessage));
    }
    return settle(session, {
      outcome: 'error',
      error: interrupted
        ? `session '${session.id}' attempt aborted before the agent run produced a result`
        : `session '${session.id}' agent message stream ended without a result message`,
    });
  };
}
