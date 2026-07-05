/**
 * Shell session manager (v0.5 "background Bash family").
 *
 * One ShellManager lives per query and provides:
 *  - Background shells: Bash `run_in_background: true` spawns a detached
 *    process group whose output accumulates here; the model polls it with
 *    BashOutput (incremental reads) and stops it with KillShell. Background
 *    shells survive across turns and die with the query (dispose()).
 *  - Persistent foreground state: a state directory whose cwd/env snapshot the
 *    Bash tool replays before each foreground command and re-captures after,
 *    so `cd` and exported variables persist across Bash calls (functions,
 *    aliases and unexported vars do not — documented PARTIAL vs the official
 *    persistent shell process).
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planShellSpawn } from '../sandbox/backend.js';
import { detectSandboxEvidence, sandboxFailureHint } from '../sandbox/evidence.js';
import type {
  BackgroundShell,
  BuiltinTool,
  ShellManager,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';

/** Per-stream accumulation cap for a background shell (chars). */
const BG_STREAM_CAP_CHARS = 500_000;

const KILL_GRACE_MS = 2_000;

export function createShellManager(debug: (msg: string) => void): ShellManager {
  const shells = new Map<string, BackgroundShell>();
  let nextId = 1;
  let stateDir: string;
  try {
    stateDir = mkdtempSync(join(tmpdir(), 'bpt-shell-'));
  } catch {
    // No usable tmp dir: persistence degrades to stateless; background still works.
    stateDir = '';
  }

  const append = (
    shellRec: BackgroundShell,
    stream: 'stdout' | 'stderr',
    chunk: string,
  ): void => {
    const truncatedKey = stream === 'stdout' ? 'stdoutTruncated' : 'stderrTruncated';
    if (shellRec[truncatedKey]) return;
    const current = shellRec[stream];
    const remaining = BG_STREAM_CAP_CHARS - current.length;
    if (chunk.length <= remaining) {
      shellRec[stream] = current + chunk;
    } else {
      shellRec[stream] = current + chunk.slice(0, remaining);
      shellRec[truncatedKey] = true;
    }
  };

  return {
    stateDir,

    spawnBackground(shell, command, ctx, disableSandbox = false) {
      const id = `bash_${nextId++}`;
      // Wrap through the sandbox backend (default-on) unless unsandboxed or the
      // escape hatch is engaged for this launch.
      const plan = planShellSpawn(shell, command, ctx, disableSandbox);
      const sandboxCtx = disableSandbox ? undefined : ctx.sandbox;
      let child;
      try {
        child = spawn(plan.command, plan.args, {
          cwd: ctx.cwd,
          env: { ...(ctx.env as NodeJS.ProcessEnv), ...plan.envOverlay },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }

      const killGroup = (sig: string): void => {
        const pid = child.pid;
        const signal = sig as NodeJS.Signals;
        try {
          if (pid !== undefined) process.kill(-pid, signal);
          else child.kill(signal);
        } catch {
          /* group already gone */
        }
      };

      const rec: BackgroundShell = {
        id,
        command,
        pid: child.pid,
        stdout: '',
        stdoutTruncated: false,
        stderr: '',
        stderrTruncated: false,
        cursorOut: 0,
        cursorErr: 0,
        status: 'running',
        exitCode: null,
        exitSignal: null,
        kill: killGroup,
      };
      shells.set(id, rec);

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (d: string) => append(rec, 'stdout', d));
      child.stderr?.on('data', (d: string) => append(rec, 'stderr', d));
      child.on('error', (err: Error) => {
        if (rec.status === 'running') {
          rec.status = 'failed';
          append(rec, 'stderr', `\n[process error] ${err.message}`);
        }
      });
      child.on('exit', (code, signal) => {
        rec.exitCode = code;
        rec.exitSignal = signal;
        if (rec.status === 'running') {
          rec.status = code === 0 ? 'completed' : 'failed';
        }
        // Surface sandbox failure evidence (mirrors foreground): when a
        // sandboxed background shell fails with a matching stderr signature,
        // append the retry-path hint so the next BashOutput read shows it.
        if (rec.status === 'failed' && sandboxCtx !== undefined) {
          const sig = detectSandboxEvidence(code, rec.stderr, sandboxCtx.allowNetwork);
          if (sig !== null) {
            append(rec, 'stderr', '\n' + sandboxFailureHint(sig, sandboxCtx.allowEscape));
          }
        }
      });
      // Never let a background shell keep the host process alive.
      child.unref();
      debug(`Bash: launched background shell ${id} (pid ${child.pid ?? '?'})`);
      return { id };
    },

    get(id) {
      return shells.get(id);
    },

    kill(id) {
      const rec = shells.get(id);
      if (rec === undefined) return false;
      if (rec.status === 'running') rec.status = 'killed';
      rec.kill('SIGTERM');
      const t = setTimeout(() => rec.kill('SIGKILL'), KILL_GRACE_MS);
      t.unref?.();
      return true;
    },

    dispose() {
      for (const rec of shells.values()) {
        if (rec.status === 'running') {
          rec.status = 'killed';
          rec.kill('SIGKILL');
        }
      }
      shells.clear();
      if (stateDir !== '') {
        try {
          rmSync(stateDir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// BashOutput / KillShell built-in tools
// ---------------------------------------------------------------------------

const NO_MANAGER =
  'No shell manager is available in this context; background shells are ' +
  'managed per query.';

function describeStatus(rec: BackgroundShell): string {
  if (rec.status === 'running') return 'status: running';
  const exit =
    rec.exitCode !== null
      ? `exit code ${rec.exitCode}`
      : `signal ${rec.exitSignal ?? 'unknown'}`;
  return `status: ${rec.status} (${exit})`;
}

/** Apply an optional per-line regex filter to an output chunk. */
function filterLines(chunk: string, filter: string | undefined): string {
  if (filter === undefined || filter.length === 0 || chunk.length === 0) {
    return chunk;
  }
  let re: RegExp;
  try {
    re = new RegExp(filter);
  } catch {
    return chunk; // an invalid filter passes everything rather than throwing
  }
  return chunk
    .split('\n')
    .filter((line) => re.test(line))
    .join('\n');
}

export const bashOutputTool: BuiltinTool = {
  name: 'BashOutput',
  description:
    'Read NEW output from a background shell started with Bash ' +
    'run_in_background (output since the previous BashOutput call), plus its ' +
    'current status. Optional `filter` is a regex applied per line.',
  inputSchema: {
    type: 'object',
    properties: {
      bash_id: {
        type: 'string',
        description: 'The background shell id returned by Bash.',
      },
      filter: {
        type: 'string',
        description:
          'Optional regular expression; only NEW output lines matching it are returned.',
      },
    },
    required: ['bash_id'],
  },
  readOnly: true,

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    const id = input['bash_id'];
    if (typeof id !== 'string' || id.length === 0) {
      return { content: "BashOutput: 'bash_id' must be a non-empty string.", isError: true };
    }
    if (ctx.shells === undefined) {
      return { content: `BashOutput: ${NO_MANAGER}`, isError: true };
    }
    const rec = ctx.shells.get(id);
    if (rec === undefined) {
      return { content: `BashOutput: no background shell with id "${id}".`, isError: true };
    }
    const filter = typeof input['filter'] === 'string' ? input['filter'] : undefined;
    const newOut = rec.stdout.slice(rec.cursorOut);
    const newErr = rec.stderr.slice(rec.cursorErr);
    rec.cursorOut = rec.stdout.length;
    rec.cursorErr = rec.stderr.length;

    const parts: string[] = [describeStatus(rec)];
    const out = filterLines(newOut, filter);
    const err = filterLines(newErr, filter);
    if (out.length > 0) parts.push(out);
    if (err.length > 0) parts.push(`[stderr]\n${err}`);
    if (out.length === 0 && err.length === 0) parts.push('(no new output)');
    if (rec.stdoutTruncated || rec.stderrTruncated) {
      parts.push('[output truncated at the accumulation cap]');
    }
    return { content: parts.join('\n') };
  },
};

export const killShellTool: BuiltinTool = {
  name: 'KillShell',
  description:
    'Kill a background shell started with Bash run_in_background, by its id.',
  inputSchema: {
    type: 'object',
    properties: {
      shell_id: {
        type: 'string',
        description: 'The background shell id returned by Bash.',
      },
    },
    required: ['shell_id'],
  },
  readOnly: false,

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    const id = input['shell_id'];
    if (typeof id !== 'string' || id.length === 0) {
      return { content: "KillShell: 'shell_id' must be a non-empty string.", isError: true };
    }
    if (ctx.shells === undefined) {
      return { content: `KillShell: ${NO_MANAGER}`, isError: true };
    }
    const rec = ctx.shells.get(id);
    if (rec === undefined) {
      return { content: `KillShell: no background shell with id "${id}".`, isError: true };
    }
    if (rec.status !== 'running') {
      return { content: `KillShell: shell ${id} already ${rec.status}.` };
    }
    ctx.shells.kill(id);
    return { content: `Killed background shell ${id}.` };
  },
};
