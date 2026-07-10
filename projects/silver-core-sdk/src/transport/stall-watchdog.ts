/**
 * Background-subagent stall watchdog (official CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS
 * semantics): a resettable silence timer for subagents launched with
 * `run_in_background`. Official behavior — "Default 600000. Resets on each
 * stream event; on stall it aborts the subagent, marks the task failed, and
 * surfaces the error to the parent with any partial result. Does not apply to
 * synchronous subagents." (TS reference, 0.3.201 docs snapshot.)
 *
 * This module ships the mechanism (timer + env resolution); the subagent
 * runtime wires it around a background child's stream: `touch()` on every
 * stream event, `onStall` aborts the child's controller. `0` disables. Timers
 * are unref'd so an idle watchdog never keeps the process alive.
 */

/** Official default: 10 minutes of stream silence fails a background subagent. */
export const DEFAULT_ASYNC_AGENT_STALL_TIMEOUT_MS = 600_000;

/**
 * Resolve the stall timeout from the environment: a non-negative integer
 * CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS wins (0 disables); anything else falls
 * back to the official 600000 default.
 */
export function resolveStallTimeoutMs(
  env: Record<string, string | undefined>,
): number {
  const raw = env.CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS;
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return DEFAULT_ASYNC_AGENT_STALL_TIMEOUT_MS;
}

/**
 * Resettable silence timer. Construct with the resolved timeout and a stall
 * callback; call `touch()` on each observed stream event. Fires `onStall`
 * exactly once, after `timeoutMs` with no touch. `timeoutMs: 0` constructs a
 * disabled watchdog (never fires). `dispose()` cancels it.
 */
export class StallWatchdog {
  private readonly timeoutMs: number;
  private readonly onStall: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firedFlag = false;
  private disposed = false;

  constructor(opts: { timeoutMs: number; onStall: () => void }) {
    this.timeoutMs = Math.max(0, opts.timeoutMs);
    this.onStall = opts.onStall;
    this.arm();
  }

  /** True once the watchdog has fired (the subagent stalled). */
  get stalled(): boolean {
    return this.firedFlag;
  }

  /** Reset the silence timer — call on every stream event from the subagent. */
  touch(): void {
    if (this.firedFlag || this.disposed) return;
    this.arm();
  }

  /** Cancel the watchdog (subagent finished); safe to call more than once. */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    if (this.timeoutMs === 0) return; // disabled
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.firedFlag = true;
      this.timer = undefined;
      this.onStall();
    }, this.timeoutMs);
    // Don't let the watchdog alone keep the process alive.
    (this.timer as { unref?: () => void }).unref?.();
  }
}
