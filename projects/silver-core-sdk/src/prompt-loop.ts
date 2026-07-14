/**
 * /loop interval-loop primitive. BPT-EXTENSION — the official SDK has no
 * recurring-prompt facility; in Claude Code the `/loop` surface is a skill
 * layered on the CLI harness. This module is the SDK-side primitive so a
 * host (BPT Desktop) only needs a thin bridge: parse the user's `/loop`
 * invocation here, then drive its own query submission through the
 * controller. Without it an unrecognized `/loop 10m <task>` passes through
 * the slash-command expansion layer as a one-shot plain prompt and the
 * recurrence semantics are silently lost (the 2026-07-14 gap report).
 *
 * Grammar (single source of truth — hosts must not re-implement it):
 *   /loop [<interval>] <prompt-or-slash-command>
 * where <interval> is `<number><unit>` with unit s|sec|secs|m|min|mins|
 * h|hr|hrs (case-insensitive), e.g. `30s`, `10m`, `1.5h`. Omitted interval
 * defaults to 10m (Claude Code's documented default). A first token that
 * starts with a digit but is NOT a valid interval is rejected rather than
 * silently treated as prompt text — misreading a typo'd interval as the
 * task would loop the wrong thing every 10 minutes (fail-closed, house
 * rule).
 *
 * Scheduling semantics mirror the Claude Code skill: run once immediately
 * on start, then FIXED-DELAY — the next run is scheduled `intervalMs`
 * after the previous run SETTLES, so runs never overlap and a slow
 * iteration cannot stampede the host. The controller never executes
 * anything itself; the host-supplied `run` callback owns the actual query.
 *
 * NOT registered in BUILTIN_SLASH_COMMANDS: the engine loop does not
 * execute /loop (a query cannot re-invoke itself over wall-clock time), and
 * advertising a command the engine would swallow as plain text is exactly
 * the dishonesty red line. `LOOP_SLASH_COMMAND` is exported as metadata for
 * hosts that DO wire the bridge to merge into their command menus.
 */

import { ConfigurationError } from './errors.js';
import type { SlashCommand } from './types.js';

/** Default cadence when the invocation omits the interval token. */
export const DEFAULT_LOOP_INTERVAL_MS = 600_000;
export const DEFAULT_LOOP_INTERVAL_LABEL = '10m';

/** Floor: sub-second loops are always a mistake at this layer. */
export const MIN_LOOP_INTERVAL_MS = 1_000;
/**
 * Ceiling: Node's setTimeout treats delays above 2^31-1 ms as overflow and
 * fires them IMMEDIATELY, which would turn "every 30 days" into a hot loop.
 */
export const MAX_LOOP_INTERVAL_MS = 2_147_483_647;

/** Menu metadata for hosts that wire the bridge (see module header). */
export const LOOP_SLASH_COMMAND: SlashCommand = {
  name: 'loop',
  description:
    'Run a prompt or slash command on a recurring interval (defaults to 10m)',
  argumentHint: '[interval] <prompt-or-command>',
};

export type LoopDirective = {
  intervalMs: number;
  /** The interval as written (`'30s'`), or the default label when omitted. */
  intervalLabel: string;
  explicitInterval: boolean;
  /** The task text; may itself be a slash command the host resubmits. */
  prompt: string;
};

export type LoopCommandParse =
  | { ok: true; directive: LoopDirective }
  | { ok: false; error: string };

const LOOP_INVOCATION_RE = /^\/loop(?:\s+([\s\S]+))?$/;
const INTERVAL_TOKEN_RE = /^(\d+(?:\.\d+)?)(s|secs?|m|mins?|h|hrs?)$/i;

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

function intervalTokenToMs(token: string): number | null {
  const m = INTERVAL_TOKEN_RE.exec(token);
  if (!m) return null;
  const unitMs = UNIT_MS[(m[2] ?? '').toLowerCase().charAt(0)];
  if (unitMs === undefined) return null;
  const ms = Math.round(Number(m[1] ?? '') * unitMs);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Parse a `/loop` invocation. Returns null when the input is not a /loop
 * command at all (route it as usual); `{ ok: false }` when it IS /loop but
 * unusable — hosts must surface that error instead of passing the text
 * through as a plain prompt.
 */
export function parseLoopCommand(input: string): LoopCommandParse | null {
  const m = LOOP_INVOCATION_RE.exec(input.trim());
  if (!m) return null;
  const args = m[1]?.trim() ?? '';
  if (!args) {
    return { ok: false, error: '/loop requires a prompt or slash command to run' };
  }
  const first = /^(\S+)([\s\S]*)$/.exec(args);
  const token = first?.[1] ?? args;
  const rest = (first?.[2] ?? '').trimStart();

  let intervalMs = DEFAULT_LOOP_INTERVAL_MS;
  let intervalLabel = DEFAULT_LOOP_INTERVAL_LABEL;
  let explicitInterval = false;
  let prompt = args;

  const tokenMs = intervalTokenToMs(token);
  if (tokenMs !== null) {
    if (tokenMs < MIN_LOOP_INTERVAL_MS) {
      return { ok: false, error: `/loop interval must be at least 1s (got "${token}")` };
    }
    if (tokenMs > MAX_LOOP_INTERVAL_MS) {
      return { ok: false, error: `/loop interval must be at most ${MAX_LOOP_INTERVAL_MS} ms (got "${token}")` };
    }
    if (!rest) {
      return { ok: false, error: '/loop requires a prompt or slash command after the interval' };
    }
    intervalMs = tokenMs;
    intervalLabel = token;
    explicitInterval = true;
    prompt = rest;
  } else if (/^\d/.test(token)) {
    return {
      ok: false,
      error: `/loop: "${token}" is not a valid interval (use e.g. 30s, 10m, 1.5h)`,
    };
  }

  return {
    ok: true,
    directive: { intervalMs, intervalLabel, explicitInterval, prompt },
  };
}

export type LoopStopReason = 'stopped' | 'aborted' | 'max_iterations' | 'error';

export type PromptLoopSummary = {
  /** run() invocations that settled (including the one that errored). */
  iterations: number;
  stopReason: LoopStopReason;
  /** Present when stopReason is 'error'. */
  error?: unknown;
};

export type LoopErrorDecision = 'stop' | 'continue';

export type PromptLoopOptions = {
  prompt: string;
  /**
   * Host-owned executor: submit `prompt` as a fresh turn/query and resolve
   * when it settles. `iteration` is 1-based. Rejections route to `onError`.
   */
  run: (prompt: string, iteration: number) => unknown | Promise<unknown>;
  /** Default DEFAULT_LOOP_INTERVAL_MS; integer within [MIN, MAX]. */
  intervalMs?: number;
  /** Stop after this many settled runs (default: unbounded). */
  maxIterations?: number;
  /** Run the first iteration immediately on start() (default true). */
  immediate?: boolean;
  signal?: AbortSignal;
  /**
   * Policy when run() rejects: 'stop' (default — a silently failing loop is
   * worse than a dead one) or 'continue', or a callback deciding per error.
   */
  onError?: LoopErrorDecision | ((error: unknown, iteration: number) => LoopErrorDecision);
};

export type PromptLoopController = {
  /** Idempotent; a stopped loop cannot be restarted. */
  start(): void;
  /** Idempotent. Cancels a pending timer; an in-flight run settles first. */
  stop(): void;
  readonly running: boolean;
  readonly iterations: number;
  /** Resolves (never rejects) once the loop has fully stopped. */
  done: Promise<PromptLoopSummary>;
};

export function createPromptLoop(options: PromptLoopOptions): PromptLoopController {
  const {
    prompt,
    run,
    intervalMs = DEFAULT_LOOP_INTERVAL_MS,
    maxIterations,
    immediate = true,
    signal,
    onError = 'stop',
  } = options;
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new ConfigurationError('createPromptLoop: prompt must be a non-empty string');
  }
  if (
    !Number.isInteger(intervalMs) ||
    intervalMs < MIN_LOOP_INTERVAL_MS ||
    intervalMs > MAX_LOOP_INTERVAL_MS
  ) {
    throw new ConfigurationError(
      `createPromptLoop: intervalMs must be an integer in [${MIN_LOOP_INTERVAL_MS}, ${MAX_LOOP_INTERVAL_MS}]`,
    );
  }
  if (maxIterations !== undefined && (!Number.isInteger(maxIterations) || maxIterations < 1)) {
    throw new ConfigurationError('createPromptLoop: maxIterations must be a positive integer');
  }

  let started = false;
  let finished = false;
  let inFlight = false;
  let iterations = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Set by stop()/abort while a run is in flight; applied when it settles. */
  let pendingStop: LoopStopReason | undefined;

  let resolveDone!: (summary: PromptLoopSummary) => void;
  const done = new Promise<PromptLoopSummary>((resolve) => {
    resolveDone = resolve;
  });

  const onAbort = () => requestStop('aborted');

  function finish(stopReason: LoopStopReason, error?: unknown): void {
    if (finished) return;
    finished = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    signal?.removeEventListener('abort', onAbort);
    resolveDone(error === undefined ? { iterations, stopReason } : { iterations, stopReason, error });
  }

  function requestStop(reason: LoopStopReason): void {
    if (finished) return;
    if (inFlight) {
      // Keep the strongest reason: an abort must not be downgraded.
      if (pendingStop !== 'aborted') pendingStop = reason;
      return;
    }
    finish(reason);
  }

  function scheduleNext(): void {
    timer = setTimeout(() => {
      timer = undefined;
      void runOnce();
    }, intervalMs);
  }

  async function runOnce(): Promise<void> {
    if (finished) return;
    inFlight = true;
    const iteration = iterations + 1;
    let error: unknown;
    let errored = false;
    try {
      await run(prompt, iteration);
    } catch (e) {
      errored = true;
      error = e;
    }
    iterations = iteration;
    inFlight = false;

    if (pendingStop !== undefined) {
      finish(pendingStop);
      return;
    }
    if (errored) {
      const decision = typeof onError === 'function' ? onError(error, iteration) : onError;
      if (decision !== 'continue') {
        finish('error', error);
        return;
      }
    }
    if (maxIterations !== undefined && iterations >= maxIterations) {
      finish('max_iterations');
      return;
    }
    scheduleNext();
  }

  return {
    start(): void {
      if (started || finished) return;
      started = true;
      if (signal?.aborted) {
        finish('aborted');
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      if (immediate) void runOnce();
      else scheduleNext();
    },
    stop(): void {
      requestStop('stopped');
    },
    get running(): boolean {
      return started && !finished;
    },
    get iterations(): number {
      return iterations;
    },
    done,
  };
}
