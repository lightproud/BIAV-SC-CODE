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
 * Default clock: delegates to the JS globals at CALL time, so environments
 * that patch globals (e.g. vitest fake timers) are honored without injection.
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};
