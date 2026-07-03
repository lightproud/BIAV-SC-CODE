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
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const STREAM_CAP_CHARS = 30_000;
const KILL_GRACE_MS = 2_000;

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
    const child = spawn(shell, ['-c', command], {
      cwd: ctx.cwd,
      env: ctx.env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout = new CappedStream();
    const stderr = new CappedStream();
    let settled = false;
    let spawned = false;
    let timedOut = false;
    let aborted = false;
    let killTimer: NodeJS.Timeout | undefined;

    // SIGTERM first; escalate to SIGKILL after a 2s grace period.
    const terminate = (): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* process may already be gone */
      }
      if (killTimer === undefined) {
        killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }, KILL_GRACE_MS);
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
      ctx.signal.removeEventListener('abort', onAbort);
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

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        kind: 'exit',
        code,
        signal,
        stdout: stdout.text(),
        stderr: stderr.text(),
        timedOut,
        aborted,
      });
    });
  });
}

function formatStreams(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.length > 0) parts.push(stdout);
  if (stderr.length > 0) parts.push(`[stderr]\n${stderr}`);
  return parts.join('\n');
}

export const bashTool: BuiltinTool = {
  name: 'Bash',
  description:
    'Execute a shell command with bash -c (sh fallback) in the working ' +
    'directory. Returns captured stdout/stderr; non-zero exit codes are ' +
    'reported as tool errors, not exceptions. Timeout in milliseconds ' +
    `defaults to ${DEFAULT_TIMEOUT_MS} (max ${MAX_TIMEOUT_MS}).`,
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

    let outcome = await runShell('bash', command, ctx, timeoutMs);
    if (outcome.kind === 'spawn-error' && outcome.error.code === 'ENOENT') {
      if (ctx.signal.aborted) throw new AbortError();
      ctx.debug('Bash: bash not found, falling back to sh');
      outcome = await runShell('sh', command, ctx, timeoutMs);
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
