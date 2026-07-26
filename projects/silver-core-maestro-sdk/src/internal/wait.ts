/**
 * Internal (not exported from index.ts): the one abortable sleep both
 * long-running orchestration components use.
 *
 * Why it exists (design review 2026-07-26 F4): `WorkflowRun.run()` and
 * `GoalChaser.chase()` used to sleep on a bare
 * `new Promise(r => clock.setTimeout(r, ms))` — the handle was never cleared
 * and there was no way to interrupt the loop, so the ONLY exit was
 * drainTimeoutMs, which defaults to unset. A host that wanted to abandon a
 * run had to leave the promise hanging. LedgerDriver already spoke
 * AbortSignal (it hands one to every executor), so the fix is to use the
 * vocabulary the package already had rather than invent a second lifecycle
 * shape.
 */

import type { Clock } from '../clock.js';

/**
 * Sleep `ms` on the injected clock, resolving early if `signal` aborts.
 *
 * The timer handle is ALWAYS cleared — on the normal path, on abort, and
 * before rejecting — so an aborted loop leaves nothing pending on the clock
 * (a fake-timer test would otherwise still see the stale timer, and a real
 * host would hold the event loop open for the remainder of the interval).
 * Rejects with the signal's reason when aborted; resolving-then-checking
 * would let one more loop iteration run after the abort.
 */
export function waitOrAbort(clock: Clock, ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const handle = clock.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clock.clearTimeout(handle);
      // `signal` is necessarily present inside its own listener.
      reject((signal as AbortSignal).reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
