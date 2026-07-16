/**
 * Regression: StdioMcpConnection.close() must reap the server's WHOLE process
 * tree, not only the direct child. Real MCP servers are launched through a
 * wrapper (npx / cmd / uvx / python -m / node launcher) whose actual, long-
 * lived server is a GRANDCHILD; a bare `child.kill()` orphans it, and its
 * inherited handles keep the host from exiting on interrupt/teardown (BPT
 * 2026-07-13: "interrupt 后子进程超 grace 不退出，升级关进程").
 *
 * The fixture spawns a forever-sleeping grandchild and reports its pid via
 * serverInfo. After connect() + close(), the grandchild must be dead. This
 * guards BOTH halves of the fix: the `detached:true` spawn (group leader) and
 * the planProcessKill group/tree kill in close(). Revert either and the
 * grandchild survives and this fails.
 *
 * POSIX-only: the group-kill path is deterministic on Linux CI; the Windows
 * taskkill /T path can't be exercised there, so it is skipped off-Windows-CI.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { StdioMcpConnection } from '../src/mcp/stdio.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TREE_FIXTURE = path.join(HERE, 'fixtures', 'mcp-tree-server.mjs');

/** True while `pid` names a live process (kill 0 probes without signalling). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH -> gone; EPERM -> alive but not ours (won't happen for our own tree).
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Poll until `pid` is dead or the deadline passes. */
async function waitDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !isAlive(pid);
}

describe('StdioMcpConnection.close() reaps the server process tree', () => {
  let leakedGrandchild: number | undefined;

  afterEach(() => {
    // Never leak a forever-sleeping node if an assertion failed.
    if (leakedGrandchild !== undefined && isAlive(leakedGrandchild)) {
      try {
        process.kill(leakedGrandchild, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    leakedGrandchild = undefined;
  });

  it.skipIf(process.platform === 'win32')(
    'kills the grandchild, not just the wrapper',
    async () => {
      const conn = new StdioMcpConnection(
        { command: 'node', args: [TREE_FIXTURE] },
        { name: 'tree' },
      );
      await conn.connect();

      const grandchildPid = Number(conn.serverInfo()?.version);
      expect(Number.isInteger(grandchildPid) && grandchildPid > 0).toBe(true);
      leakedGrandchild = grandchildPid;
      // Sanity: the grandchild is alive while the server runs.
      expect(isAlive(grandchildPid)).toBe(true);

      await conn.close();

      // The whole tree — including the grandchild — must be gone shortly after.
      expect(await waitDead(grandchildPid, 3_000)).toBe(true);
      leakedGrandchild = undefined;
    },
  );
});
