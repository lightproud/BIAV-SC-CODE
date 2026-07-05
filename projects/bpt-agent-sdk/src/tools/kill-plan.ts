/**
 * Background-shell termination planning (2026-07-05 BPT Windows pilot,
 * incident #3): the old kill path (a) forced status to 'killed' the instant
 * kill() was called - before any signal took effect - so a process that ran
 * to normal completion was reported 'killed' forever; and (b) signalled with
 * `process.kill(-pid, sig)`, a POSIX process-GROUP call that does nothing on
 * Windows, with the failure swallowed by an empty catch. Result on Windows:
 * KillShell was a no-op that lied.
 *
 * These two pure functions isolate the platform + honesty decisions so both
 * are unit-testable on any host (the Windows branch cannot spawn taskkill on
 * Linux CI, so it is planned here and executed by the caller).
 */

/** How to terminate a child, chosen by platform + pid availability. */
export type KillPlan =
  | { kind: 'group'; pid: number; signal: string } // POSIX: signal the whole process group (-pid)
  | { kind: 'taskkill'; pid: number } // Windows: taskkill /PID <pid> /T /F (tree, forced)
  | { kind: 'child'; signal: string }; // no pid: best-effort direct child.kill

export function planProcessKill(
  pid: number | undefined,
  signal: string,
  platform: NodeJS.Platform = process.platform,
): KillPlan {
  if (pid === undefined) return { kind: 'child', signal };
  if (platform === 'win32') return { kind: 'taskkill', pid };
  return { kind: 'group', pid, signal };
}

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
