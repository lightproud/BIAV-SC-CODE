/**
 * Injectable clock seam. The orchestrator SDK holds the molecule-side clock
 * (SCS-REQ orchestrator-sdk §1) — but always through this seam, never bare
 * globals, so hosts and tests can substitute a fake clock and the assembly
 * proof can run without a single real timer.
 */

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Node's timer delay is a 32-bit signed int. A LARGER delay does not sleep
 * longer — it overflows to 1 ms (with a TimeoutOverflowWarning), so a setting
 * meant to RELAX a deadline fires it immediately instead. That inversion is
 * silent under an injected fake clock, which just records the number.
 */
const TIMER_MAX_MS = 2_147_483_647;

/**
 * Default clock: delegates to the JS globals at CALL time, so environments
 * that patch globals (e.g. vitest fake timers) are honored without injection.
 *
 * Delays are capped at the 32-bit timer ceiling (~24.8 days) on the way to the
 * global, because every ms-valued knob in this package eventually lands here:
 * `LedgerDriver.queryTimeoutMs: 30 * 86_400_000` ("time an attempt out after a
 * month") passed the constructor's finite/>0 validation and then aborted EVERY
 * attempt ~1 ms after launch — the driver settled its first attempt as
 * `timeout` before the executor's first await resumed, and no work ever
 * completed. `pollIntervalMs` inverts the same way: a deliberately rare poll
 * becomes a 1 ms hammer on the store. Capping keeps the requested direction
 * (as long a delay as the platform can express); NaN/Infinity are passed
 * through untouched so the global's own semantics still apply. An INJECTED
 * clock is left alone — it owns its own time semantics.
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms > TIMER_MAX_MS ? TIMER_MAX_MS : ms),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};
