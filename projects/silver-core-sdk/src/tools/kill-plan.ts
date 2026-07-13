/**
 * Background-shell termination planning (2026-07-05 BPT Windows pilot,
 * incident #3): the old kill path (a) forced status to 'killed' the instant
 * kill() was called - before any signal took effect - so a process that ran
 * to normal completion was reported 'killed' forever; and (b) signalled with
 * `process.kill(-pid, sig)`, a POSIX process-GROUP call that does nothing on
 * Windows, with the failure swallowed by an empty catch. Result on Windows:
 * KillShell was a no-op that lied.
 *
 * `terminalStatus` isolates the exit-honesty decision so it is unit-testable
 * on any host. The platform kill planner it used to define moved to
 * `internal/process-kill.ts` (so `mcp/` can reuse the same source of truth);
 * it is re-exported here unchanged for the existing tool-layer consumers.
 */

export { planProcessKill, type KillPlan } from '../internal/process-kill.js';

/**
 * The HONEST terminal status of a background shell, decided from what actually
 * happened at exit - never eagerly at the kill request. `code` is the exit
 * code (null when the process died by a signal).
 *
 *   - kill was requested AND the process did not exit 0  -> 'killed'
 *     (POSIX signal death has code null; Windows taskkill /F yields a nonzero
 *      code - both are "we asked, it was terminated");
 *   - the process exited 0                               -> 'completed'
 *     (honest even if a kill was requested but lost the race - it finished
 *      its work, which is exactly the BPT-reported lie this fixes);
 *   - any other non-kill nonzero/signal exit             -> 'failed'.
 */
export function terminalStatus(
  killRequested: boolean,
  code: number | null,
): 'killed' | 'completed' | 'failed' {
  if (killRequested && code !== 0) return 'killed';
  return code === 0 ? 'completed' : 'failed';
}
