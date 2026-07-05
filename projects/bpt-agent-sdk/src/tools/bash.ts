/**
 * Bash built-in tool (module D).
 *
 * Runs a shell command via `bash -c` (falling back to `sh` when bash is not
 * installed). Command failure (non-zero exit, timeout, signal) is reported as
 * an isError tool result - the only throw paths are AbortError (cancellation)
 * and total spawn impossibility (neither bash nor sh can be spawned).
 */

import { spawn } from 'node:child_process';
import { AbortError } from '../errors.js';
import { BASH_DESCRIPTION } from './descriptions.js';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const STREAM_CAP_CHARS = 30_000;
const KILL_GRACE_MS = 2_000;
/**
 * After the direct shell exits, how long to let its stdout/stderr pipes flush
 * before settling. Bounds the wait when a background descendant inherited the
 * pipes and holds them open indefinitely (the 'close' event would otherwise
 * never fire). The common case settles earlier, on 'close'.
 */
const FLUSH_GRACE_MS = 200;

/** Accumulates stream output, keeping only the first STREAM_CAP_CHARS chars. */
class CappedStream {
  private buf = '';
  private truncated = false;

  append(chunk: string): void {
    if (this.truncated) return;
    const remaining = STREAM_CAP_CHARS - this.buf.length;
    if (chunk.length <= remaining) {
      this.buf += chunk;
    } else {
      this.buf += chunk.slice(0, remaining);
      this.truncated = true;
    }
  }

  text(): string {
    return this.truncated ? `${this.buf}\n[truncated]` : this.buf;
  }
}

type RunOutcome =
  | { kind: 'spawn-error'; error: NodeJS.ErrnoException }
  | {
      kind: 'exit';
      code: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
      aborted: boolean;
    };

/** Spawn one shell and wait for it to finish; never rejects. */
function runShell(
  shell: string,
  command: string,
  ctx: ToolContext,
  timeoutMs: number,
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    // detached:true puts the shell in its own process group (pgid == pid) so
    // termination can signal the WHOLE tree (shell + pipeline/background
    // descendants), not just the direct shell. Without this, killing the
    // shell orphans its children and leaves them running.
    const child = spawn(shell, ['-c', command], {
      cwd: ctx.cwd,
      env: ctx.env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    const stdout = new CappedStream();
    const stderr = new CappedStream();
    let settled = false;
    let spawned = false;
    let timedOut = false;
    let aborted = false;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let killTimer: NodeJS.Timeout | undefined;
    let flushTimer: NodeJS.Timeout | undefined;

    // Signal the shell's entire process group; fall back to the direct child
    // when the pid is unknown. ESRCH (group already gone) is expected and
    // swallowed.
    const killGroup = (sig: NodeJS.Signals): void => {
      const pid = child.pid;
      try {
        if (pid !== undefined) {
          process.kill(-pid, sig);
        } else {
          child.kill(sig);
        }
      } catch {
        /* group/process already gone or cannot be signalled */
      }
    };

    // SIGTERM first; escalate to SIGKILL after a grace period. Both target the
    // process group so no descendant survives.
    const terminate = (): void => {
      killGroup('SIGTERM');
      if (killTimer === undefined) {
        killTimer = setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS);
        killTimer.unref?.();
      }
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timeoutTimer.unref?.();

    const onAbort = (): void => {
      aborted = true;
      terminate();
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    // 'abort' does not fire retroactively for an already-aborted signal.
    if (ctx.signal.aborted) onAbort();

    const cleanup = (): void => {
      clearTimeout(timeoutTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        kind: 'exit',
        code: exitCode,
        signal: exitSignal,
        stdout: stdout.text(),
        stderr: stderr.text(),
        timedOut,
        aborted,
      });
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => stdout.append(d));
    child.stderr?.on('data', (d: string) => stderr.append(d));

    child.once('spawn', () => {
      spawned = true;
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      if (!spawned) {
        // Failed before ever starting (e.g. ENOENT: shell missing).
        settled = true;
        cleanup();
        resolve({ kind: 'spawn-error', error });
        return;
      }
      // Post-spawn errors (e.g. kill failures) are folded into the result.
      settled = true;
      cleanup();
      resolve({
        kind: 'exit',
        code: null,
        signal: null,
        stdout: stdout.text(),
        stderr: `${stderr.text()}\n[process error] ${error.message}`.trim(),
        timedOut,
        aborted,
      });
    });

    // Settle on the DIRECT shell's 'exit', not 'close'. 'close' waits for every
    // descendant that inherited the stdout/stderr pipes to exit, so a lingering
    // background child (e.g. `echo ok; sleep 6 &`) would keep the promise
    // pending forever - the P0 deadlock. After exit we give the pipes a short
    // grace to flush, then settle regardless of any pipe-holding descendant.
    child.on('exit', (code, signal) => {
      if (settled || exited) return;
      exited = true;
      exitCode = code;
      exitSignal = signal;
      flushTimer = setTimeout(finish, FLUSH_GRACE_MS);
      flushTimer.unref?.();
    });

    // The common case: all stdio closes shortly after exit (no lingering
    // pipe-holder). Settle immediately instead of waiting out the flush grace.
    child.on('close', (code, signal) => {
      if (settled) return;
      if (!exited) {
        exited = true;
        exitCode = code;
        exitSignal = signal;
      }
      finish();
    });
  });
}

function formatStreams(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.length > 0) parts.push(stdout);
  if (stderr.length > 0) parts.push(`[stderr]\n${stderr}`);
  return parts.join('\n');
}

/**
 * Wrap a foreground command with the persistent-state replay/capture prologue
 * (v0.5). Before the command: restore the previous call's cwd and re-source
 * its exported env. After it (EXIT trap, so `exit N` still persists): capture
 * cwd + `export -p`. Functions/aliases/unexported vars do NOT persist — this
 * is a state-file replay, not a long-lived shell process (docs/COMPAT.md).
 * The state dir comes from mkdtemp, so single-quoting it is safe.
 */
function withPersistentState(command: string, stateDir: string): string {
  return [
    `__bpt_state='${stateDir}'`,
    'if [ -f "$__bpt_state/cwd" ]; then cd -- "$(cat "$__bpt_state/cwd")" 2>/dev/null || true; fi',
    'if [ -f "$__bpt_state/env" ]; then { . "$__bpt_state/env"; } 2>/dev/null || true; fi',
    '__bpt_persist() {',
    '  pwd > "$__bpt_state/cwd" 2>/dev/null || true',
    '  export -p > "$__bpt_state/env" 2>/dev/null || true',
    '}',
    'trap __bpt_persist EXIT',
    command,
  ].join('\n');
}

export const bashTool: BuiltinTool = {
  name: 'Bash',
  description: BASH_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute.',
      },
      timeout: {
        type: 'number',
        description: `Timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
      },
      description: {
        type: 'string',
        description:
          'Short human-readable description of what the command does.',
      },
      run_in_background: {
        type: 'boolean',
        description:
          'Run the command in the background and return a shell id ' +
          'immediately (read output with BashOutput, stop with KillShell).',
      },
    },
    required: ['command'],
  },
  readOnly: false,

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    const command = input['command'];
    if (typeof command !== 'string' || command.length === 0) {
      return {
        content: "Bash: 'command' must be a non-empty string.",
        isError: true,
      };
    }
    if (ctx.signal.aborted) throw new AbortError();

    const rawTimeout = input['timeout'];
    const timeoutMs =
      typeof rawTimeout === 'number' &&
      Number.isFinite(rawTimeout) &&
      rawTimeout > 0
        ? Math.min(rawTimeout, MAX_TIMEOUT_MS)
        : DEFAULT_TIMEOUT_MS;

    // Background launch (v0.5): detach via the ShellManager and ack with the
    // shell id; the model polls with BashOutput / stops with KillShell.
    // Background shells ignore `timeout` (they live until exit/kill/query end).
    if (input['run_in_background'] === true) {
      if (ctx.shells === undefined) {
        return {
          content:
            'Bash: run_in_background is not available in this context ' +
            '(no shell manager).',
          isError: true,
        };
      }
      let launched = ctx.shells.spawnBackground('bash', command, ctx);
      if ('error' in launched) {
        launched = ctx.shells.spawnBackground('sh', command, ctx);
      }
      if ('error' in launched) {
        return {
          content: `Bash: failed to launch background shell: ${launched.error}`,
          isError: true,
        };
      }
      return {
        content:
          `Command running in background with id: ${launched.id}\n` +
          'Use BashOutput to read its output and KillShell to stop it.',
      };
    }

    // Foreground: replay + persist cwd/env across calls when a state dir exists.
    const effective =
      ctx.shells !== undefined && ctx.shells.stateDir !== ''
        ? withPersistentState(command, ctx.shells.stateDir)
        : command;

    let outcome = await runShell('bash', effective, ctx, timeoutMs);
    if (outcome.kind === 'spawn-error' && outcome.error.code === 'ENOENT') {
      if (ctx.signal.aborted) throw new AbortError();
      ctx.debug('Bash: bash not found, falling back to sh');
      outcome = await runShell('sh', effective, ctx, timeoutMs);
    }
    if (outcome.kind === 'spawn-error') {
      // Spawn impossibility is the only legitimate throw for this tool.
      throw new Error(
        `Bash: failed to spawn a shell: ${outcome.error.message}`,
      );
    }

    if (outcome.aborted || ctx.signal.aborted) throw new AbortError();

    const streams = formatStreams(outcome.stdout, outcome.stderr);

    if (outcome.timedOut) {
      return {
        content:
          `Command timed out after ${timeoutMs}ms` +
          (streams.length > 0 ? `\n${streams}` : ''),
        isError: true,
      };
    }

    if (outcome.code === 0) {
      return { content: streams.length > 0 ? streams : '(no output)' };
    }

    const failure =
      outcome.code !== null
        ? `Command failed with exit code ${outcome.code}`
        : `Command terminated by signal ${outcome.signal ?? 'unknown'}`;
    return {
      content: failure + (streams.length > 0 ? `\n${streams}` : ''),
      isError: true,
    };
  },
};
