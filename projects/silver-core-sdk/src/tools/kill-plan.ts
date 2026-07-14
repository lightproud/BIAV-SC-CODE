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
 * `createTreeKiller` is the tool-layer EXECUTOR of that plan (audit 2026-07-14
 * L-10): foreground Bash and the background ShellManager used to carry two
 * near-identical `killGroup` closures; they now share this one.
 */

import { spawn } from 'node:child_process';
import { planProcessKill } from '../internal/process-kill.js';

export { planProcessKill };
export type { KillPlan } from '../internal/process-kill.js';

/** The minimal child surface the killer needs (satisfied by ChildProcess). */
type KillableChild = {
  pid?: number | undefined;
  kill(signal: NodeJS.Signals): boolean;
};

/**
 * Build a kill function that terminates `child`'s WHOLE process tree,
 * platform-correctly (executes the planProcessKill plan): POSIX signals the
 * process group (-pid, valid because every consumer spawns `detached:true`);
 * Windows fires ONE `taskkill /PID <pid> /T /F` pass — tree + forced — so the
 * SIGTERM->SIGKILL escalation collapses to a single call (the closure's
 * `winKilled` latch makes the second a no-op). Extracted from the duplicated
 * `killGroup` closures in bash.ts (foreground) and shells.ts
 * (spawnBackground) — audit 2026-07-14 L-10.
 *
 * Failures are best-effort by design: benign when the tree already exited,
 * anything else goes to `debug` rather than being swallowed (the old empty
 * catch hid the Windows miss that made KillShell a silent no-op).
 * `killFailContext` is appended verbatim to the kill-failure debug line
 * (e.g. ` for shell bash_1`) so per-shell attribution survives the dedup.
 */
export function createTreeKiller(
  child: KillableChild,
  debug: (msg: string) => void,
  killFailContext = '',
): (sig: string) => void {
  let winKilled = false;
  return (sig: string): void => {
    const plan = planProcessKill(child.pid, sig);
    try {
      if (plan.kind === 'group') {
        process.kill(-plan.pid, plan.signal as NodeJS.Signals); // win-ok: posix branch of planProcessKill
      } else if (plan.kind === 'child') {
        child.kill(plan.signal as NodeJS.Signals);
      } else {
        // taskkill (Windows): fire once, best-effort, never blocks.
        if (winKilled) return;
        winKilled = true;
        const tk = spawn('taskkill', ['/PID', String(plan.pid), '/T', '/F'], {
          stdio: 'ignore',
        });
        tk.on('error', (e) => debug(`Bash: taskkill failed for pid ${plan.pid}: ${e.message}`));
        tk.unref();
      }
    } catch (err) {
      debug(
        `Bash: kill(${sig}) failed${killFailContext}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
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
