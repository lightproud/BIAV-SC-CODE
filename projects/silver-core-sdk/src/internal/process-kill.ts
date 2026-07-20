/**
 * Platform-aware process-tree termination planning.
 *
 * A naive `child.kill(signal)` reaps ONLY the direct child PID. Real spawned
 * children (a shell running a command, or an MCP server launched through an
 * `npx` / `cmd /c` / `uvx` / `python -m` wrapper) have their actual work in
 * GRANDCHILDREN, which survive that call — orphaned processes that keep their
 * inherited stdio handles open and can stop the host from exiting. Terminating
 * the whole tree needs a platform-specific move:
 *   - POSIX: signal the process GROUP (`process.kill(-pid, sig)`), which reaps
 *     every descendant — valid only when the child was spawned `detached:true`
 *     so it is a group leader;
 *   - Windows: `taskkill /PID <pid> /T /F` (`/T` = tree, `/F` = forced), since
 *     negative-pid / process groups are a no-op there.
 *
 * This pure planner isolates that decision so every spawn site (background
 * shells, foreground Bash, MCP stdio servers) shares ONE source of truth and
 * is unit-testable on any host (the Windows branch cannot spawn taskkill on
 * Linux CI, so it is planned here and executed by the caller). Moved to
 * `internal/` (from `tools/kill-plan.ts`) so `mcp/` — which may import only
 * everywhere-allowed modules — can reuse it without duplicating the logic.
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
  // pid 0 is NOT a real child: POSIX `process.kill(-0, sig)` / `process.kill(0)`
  // signals the CALLER's own process group, and Windows `taskkill /PID 0` is
  // equally wrong. A live child.pid is always positive, so treat 0 (and any
  // non-positive value) as "no pid" and fall back to best-effort child.kill
  // (latent — child.pid is normally positive; audit 2026-07-17 P4).
  if (pid === undefined || pid <= 0) return { kind: 'child', signal };
  if (platform === 'win32') return { kind: 'taskkill', pid };
  return { kind: 'group', pid, signal };
}
