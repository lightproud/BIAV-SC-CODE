/**
 * Monitor built-in tool (B4b batch) — HONEST SUBSET of the official tool.
 *
 * Official semantics (0.3.201 docs snapshot): "Runs a background source and
 * delivers each event to Claude so it can react without polling: `command`
 * runs a script and emits one event per stdout line, and `ws` opens a
 * WebSocket and emits one event per text frame. Provide exactly one of
 * `command` or `ws`." Official output: `{ taskId, timeoutMs, persistent? }`.
 *
 * Shipped subset (scope stated in the tool description — red line: the
 * description never promises the unshipped parts):
 *  - `command` source only. The `ws` source (official 2.1.195+) is NOT
 *    shipped: it is absent from the model-facing schema and rejected with an
 *    explicit error if supplied anyway (drop-in inputs fail loudly, never
 *    silently).
 *  - NO push delivery. Delivering events mid-loop needs an engine channel
 *    this SDK does not have (loop.ts only drains subagent results); events
 *    accumulate on a background shell in the per-query ShellManager registry
 *    (same registry as Bash run_in_background) and are read incrementally via
 *    BashOutput / stopped via KillShell (official text says TaskStop, which
 *    is unshipped here).
 *  - timeout_ms (default 600000) arms a kill timer unless `persistent: true`;
 *    a persistent watch runs until KillShell or query dispose.
 *
 * Like Bash, the tool is non-readOnly: it executes an arbitrary command and
 * goes through the permission gate under the same rules.
 */

import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError } from '../errors.js';
import { resolvePosixShells, SHELL_NOT_FOUND_GUIDANCE } from './shell-resolve.js';
import { MONITOR_DESCRIPTION } from './descriptions.js';

/** Default watch timeout (ms) when `timeout_ms` is omitted (this SDK's default). */
export const DEFAULT_MONITOR_TIMEOUT_MS = 600_000;

export const monitorTool: BuiltinTool = {
  name: 'Monitor',
  description: MONITOR_DESCRIPTION,
  readOnly: false, // runs an arbitrary command; same permission posture as Bash
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'Shell script to run as the background watch; each stdout line is one event.',
      },
      description: {
        type: 'string',
        description:
          'Short label for what is being watched (e.g. "errors in deploy.log").',
      },
      timeout_ms: {
        type: 'number',
        description:
          `Kill the watch after this many milliseconds (default ${DEFAULT_MONITOR_TIMEOUT_MS}). ` +
          'Ignored when persistent is true.',
      },
      persistent: {
        type: 'boolean',
        description:
          'Session-length watch: disables the timeout; runs until KillShell or the session ends.',
      },
    },
    required: ['command', 'description'],
  },
  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();

    // Official schema is one-of command|ws; the ws source is unshipped here.
    if (input['ws'] !== undefined) {
      if (input['command'] !== undefined) {
        return {
          content: 'Monitor failed: provide exactly one of "command" or "ws".',
          isError: true,
        };
      }
      return {
        content:
          'Monitor failed: the "ws" (WebSocket) source is not supported by ' +
          'this SDK; use a "command" source instead.',
        isError: true,
      };
    }
    const command = input['command'];
    if (typeof command !== 'string' || command.length === 0) {
      return { content: 'Monitor failed: "command" must be a non-empty string.', isError: true };
    }
    const description = input['description'];
    if (typeof description !== 'string' || description.length === 0) {
      return {
        content: 'Monitor failed: "description" must be a non-empty string.',
        isError: true,
      };
    }
    const rawTimeout = input['timeout_ms'];
    if (
      rawTimeout !== undefined &&
      (typeof rawTimeout !== 'number' || !Number.isFinite(rawTimeout) || rawTimeout <= 0)
    ) {
      return {
        content: 'Monitor failed: "timeout_ms" must be a positive number.',
        isError: true,
      };
    }
    const persistent = input['persistent'] === true;
    // Clamp to Node's 32-bit setTimeout ceiling: a larger delay silently
    // overflows to 1ms, firing the kill timer ~immediately and killing the
    // just-launched watch — the exact opposite of a long-lived watch request.
    const MAX_TIMER_MS = 2_147_483_647;
    const timeoutMs = Math.min(
      typeof rawTimeout === 'number' ? rawTimeout : DEFAULT_MONITOR_TIMEOUT_MS,
      MAX_TIMER_MS,
    );

    const shellsMgr = ctx.shells;
    if (shellsMgr === undefined) {
      return {
        content:
          'Monitor failed: no shell manager is available in this context; ' +
          'background watches are managed per query.',
        isError: true,
      };
    }

    // Same Windows-aware shell resolution + launch path as Bash run_in_background.
    const candidates = resolvePosixShells(ctx.env as Record<string, string | undefined>);
    let launched: { id: string } | { error: string } = { error: SHELL_NOT_FOUND_GUIDANCE };
    for (const shell of candidates) {
      launched = shellsMgr.spawnBackground(shell, command, ctx);
      if (!('error' in launched)) break;
    }
    if ('error' in launched) {
      return {
        content: `Monitor failed: could not launch the watch: ${launched.error}`,
        isError: true,
      };
    }
    const taskId = launched.id;

    // Kill timer (skipped for persistent watches). ShellManager.kill marks the
    // shell 'killed'; a watch that already exited is left as-is. unref'd so an
    // armed timer never keeps the host process alive.
    if (!persistent) {
      const timer = setTimeout(() => {
        const rec = shellsMgr.get(taskId);
        if (rec !== undefined && rec.status === 'running') {
          ctx.debug(`Monitor: watch ${taskId} timed out after ${timeoutMs}ms; killing`);
          shellsMgr.kill(taskId);
        }
      }, timeoutMs);
      timer.unref?.();
    }

    ctx.debug(
      `Monitor: started watch ${taskId} ("${description}", ` +
        `${persistent ? 'persistent' : `timeout ${timeoutMs}ms`})`,
    );
    const lines = [
      `Monitor started: ${description}`,
      `taskId: ${taskId}`,
      `timeoutMs: ${timeoutMs}`,
    ];
    if (persistent) lines.push('persistent: true (timeout disabled)');
    lines.push(
      `Each stdout line of the watch is one event. Read new events with ` +
        `BashOutput (bash_id: "${taskId}"); stop the watch with KillShell.`,
    );
    return { content: lines.join('\n') };
  },
};
