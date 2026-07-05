/**
 * Bash built-in tool (module D).
 *
 * Runs a shell command via `bash -c` (falling back to `sh` when bash is not
 * installed). Command failure (non-zero exit, timeout, signal) is reported as
 * an isError tool result - the only throw paths are AbortError (cancellation)
 * and total spawn impossibility (neither bash nor sh can be spawned).
 */

import { spawn } from 'node:child_process';
import { resolvePosixShells, SHELL_NOT_FOUND_GUIDANCE } from './shell-resolve.js';
import { planProcessKill } from './kill-plan.js';
import { AbortError } from '../errors.js';
import { BASH_DESCRIPTION, buildBashSandboxNote } from './descriptions.js';
import { planShellSpawn } from '../sandbox/backend.js';
import { detectSandboxEvidence, sandboxFailureHint } from '../sandbox/evidence.js';
import type { SandboxContext } from '../types.js';
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
  disableSandbox: boolean,
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    // Wrap through the sandbox backend (default-on) unless unsandboxed or the
    // escape hatch is engaged for this call. The wrapped argv still spawns with
    // detached:true, so the process-group kill semantics below are unchanged.
    const plan = planShellSpawn(shell, command, ctx, disableSandbox);
    // detached:true puts the shell (or bwrap, which becomes the group leader)
    // in its own process group so termination can signal the WHOLE tree, not
    // just the direct child. --unshare-pid + SIGKILL escalation still reap it.
    const child = spawn(plan.command, plan.args, {
      cwd: ctx.cwd,
      env: { ...(ctx.env as NodeJS.ProcessEnv), ...plan.envOverlay },
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

    // Terminate the shell's whole tree, platform-correctly (planProcessKill):
    // POSIX signals the process group (-pid); Windows uses taskkill /T /F
    // (process groups/negative-pid do nothing there - the same latent bug the
    // background KillShell had, surfaced by the posix-hazard guard 2026-07-05).
    let winKilled = false;
    const killGroup = (sig: NodeJS.Signals): void => {
      const plan = planProcessKill(child.pid, sig);
      try {
        if (plan.kind === 'group') {
          process.kill(-plan.pid, plan.signal as NodeJS.Signals); // win-ok: posix branch of planProcessKill
        } else if (plan.kind === 'child') {
          child.kill(plan.signal as NodeJS.Signals);
        } else {
          if (winKilled) return;
          winKilled = true;
          const tk = spawn('taskkill', ['/PID', String(plan.pid), '/T', '/F'], { stdio: 'ignore' });
          tk.on('error', (e) => ctx.debug(`Bash: taskkill failed for pid ${plan.pid}: ${e.message}`));
          tk.unref();
        }
      } catch (err) {
        // Benign when the tree already exited; anything else goes to debug
        // rather than being swallowed (the old empty catch hid Windows misses).
        ctx.debug(`Bash: kill(${sig}) failed: ${err instanceof Error ? err.message : String(err)}`);
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

/**
 * Build the Bash tool, gated on the active sandbox (G-SANDBOX):
 *   - description: BASH_DESCRIPTION alone when unsandboxed; + the faithful
 *     sandbox note (default/mandatory mode) when a sandbox is active.
 *   - schema: `dangerouslyDisableSandbox` is ALWAYS present (E7-02, official
 *     parity — the official tool ships it unconditionally). Its semantics are
 *     state-honest, so the always-on schema never opens a silent escape:
 *       - no sandbox active: the flag is a no-op (nothing to escape);
 *       - sandbox active + allowEscape: the engine routes the call through the
 *         permission gate as its OWN ask (see loop.ts sandboxEscape — never
 *         auto-allowed except under bypassPermissions);
 *       - mandatory mode (allowEscape false): execute() refuses by policy.
 *     The gating red line still applies to the DESCRIPTION: the sandbox note
 *     (and mandatory-mode "disabled by policy" wording) stays state-gated.
 * `createBashTool()` with no argument returns the unsandboxed tool with a
 * byte-identical description (locks tests that import `bashTool` directly).
 */
export function createBashTool(sandbox?: SandboxContext): BuiltinTool {
  const active = sandbox !== undefined;
  const mode = sandbox?.allowEscape === false ? 'mandatory' : 'default';
  const description = active
    ? BASH_DESCRIPTION + '\n\n' + buildBashSandboxNote(mode, sandbox.allowNetwork)
    : BASH_DESCRIPTION;
  const properties: Record<string, unknown> = {
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
      description: 'Short human-readable description of what the command does.',
    },
    run_in_background: {
      type: 'boolean',
      description:
        'Run the command in the background and return a shell id ' +
        'immediately (read output with BashOutput, stop with KillShell).',
    },
    // Always in the schema (official parity); state-honest at runtime — see
    // the createBashTool docstring for the per-state semantics.
    dangerouslyDisableSandbox: {
      type: 'boolean',
      description:
        'Set this to true to dangerously override sandbox mode and run ' +
        'commands without sandboxing.',
    },
  };
  return {
    name: 'Bash',
    description,
    inputSchema: { type: 'object', properties, required: ['command'] },
    readOnly: false,
    execute,
  };
}

/** The default (unsandboxed) Bash tool — description byte-identical to
 *  pre-sandbox; the schema carries the always-on escape param (no-op here). */
export const bashTool: BuiltinTool = createBashTool();

async function execute(
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

    // v0.6 sandbox escape hatch. By the time execute() runs, the permission
    // gate has already routed a `dangerouslyDisableSandbox` Bash call to an ask
    // (Bash is non-read-only, so it never auto-allows except under
    // bypassPermissions or a matching allow rule) and it was authorized.
    const escapeRequested = input['dangerouslyDisableSandbox'] === true;
    if (escapeRequested && ctx.sandbox !== undefined && !ctx.sandbox.allowEscape) {
      // Mandatory mode: the parameter is disabled by policy. Refuse the escape
      // (a policy refusal) rather than silently running outside the sandbox.
      return {
        content:
          'Bash: all commands must run in sandbox mode — the ' +
          '`dangerouslyDisableSandbox` parameter is disabled by policy.',
        isError: true,
      };
    }
    // Only honor the escape when a sandbox is active AND the escape is allowed;
    // a stale flag on an unsandboxed host is ignored (not an error).
    const disableSandbox =
      escapeRequested && ctx.sandbox !== undefined && ctx.sandbox.allowEscape;
    if (escapeRequested && ctx.sandbox === undefined) {
      ctx.debug('Bash: dangerouslyDisableSandbox ignored (no sandbox active on this context)');
    }

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
      // Windows-aware shell resolution (see shell-resolve.ts): candidates are
      // tried in order; an empty list means no POSIX shell on this host.
      const bgShells = resolvePosixShells(ctx.env as Record<string, string | undefined>);
      let launched: ReturnType<typeof ctx.shells.spawnBackground> | { error: string } = {
        error: SHELL_NOT_FOUND_GUIDANCE,
      };
      for (const shell of bgShells) {
        launched = ctx.shells.spawnBackground(shell, command, ctx, disableSandbox);
        if (!('error' in launched)) break;
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

    // Windows-aware shell resolution (2026-07-05 BPT Windows pilot: bare
    // 'bash'/'sh' names ENOENT on a stock Windows box). Candidates are tried
    // in order; ENOENT falls through to the next, any other spawn error is
    // terminal for that attempt chain.
    const shells = resolvePosixShells(ctx.env as Record<string, string | undefined>);
    let outcome: RunOutcome = {
      kind: 'spawn-error',
      error: Object.assign(new Error(SHELL_NOT_FOUND_GUIDANCE), { code: 'ENOENT' }),
    };
    for (const shell of shells) {
      if (ctx.signal.aborted) throw new AbortError();
      outcome = await runShell(shell, effective, ctx, timeoutMs, disableSandbox);
      if (!(outcome.kind === 'spawn-error' && outcome.error.code === 'ENOENT')) break;
      ctx.debug(`Bash: ${shell} not found, trying the next shell candidate`);
    }
    if (outcome.kind === 'spawn-error') {
      // Spawn impossibility is the only legitimate throw for this tool. When
      // the whole candidate chain missed, the message carries the actionable
      // guidance (Git Bash / CLAUDE_CODE_GIT_BASH_PATH) instead of raw ENOENT.
      const detail = outcome.error.code === 'ENOENT' ? SHELL_NOT_FOUND_GUIDANCE : outcome.error.message;
      throw new Error(`Bash: failed to spawn a shell: ${detail}`);
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
    // When the command ran sandboxed and the failure matches a sandbox
    // signature, surface the evidence + retry path (mirrors the official
    // failure-with-evidence guidance). Timeouts are handled above and are not
    // sandbox evidence.
    let hint = '';
    if (ctx.sandbox !== undefined && !disableSandbox) {
      const sig = detectSandboxEvidence(outcome.code, outcome.stderr, ctx.sandbox.allowNetwork);
      if (sig !== null) hint = '\n\n' + sandboxFailureHint(sig, ctx.sandbox.allowEscape);
    }
    return {
      content: failure + (streams.length > 0 ? `\n${streams}` : '') + hint,
      isError: true,
    };
}
