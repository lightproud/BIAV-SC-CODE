/**
 * Bash built-in tool (module D).
 *
 * Runs a shell command via `bash -c` (falling back to `sh` when bash is not
 * installed). Command failure (non-zero exit, timeout, signal) is reported as
 * an isError tool result - the only throw paths are AbortError (cancellation)
 * and total spawn impossibility (neither bash nor sh can be spawned).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolvePosixShells, SHELL_NOT_FOUND_GUIDANCE } from './shell-resolve.js';
import { createTreeKiller } from './kill-plan.js';
import { AbortError, ConfigurationError } from '../errors.js';
import { BASH_DESCRIPTION, BASH_WIN32_NOTE, buildBashSandboxNote } from './descriptions.js';
import { planShellSpawn, resolveSpawnEnv } from '../sandbox/backend.js';
import { detectSandboxEvidence, sandboxFailureHint } from '../sandbox/evidence.js';
import { sliceTailSurrogateSafe } from '../internal/text.js';
import type { BashStructuredOutput } from '../types/tool-outputs.js';
import type { BashLimits, SandboxContext } from '../types.js';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
/**
 * Cap on the TOTAL characters one Bash call returns — stdout and stderr share
 * ONE allowance (tail-kept: the EARLIEST chars are dropped and a single leading
 * marker says how many). Exported for TOOL_OUTPUT_CAPS (tools/output-caps.ts).
 *
 * It was PER STREAM until 2026-07-29: two independent CappedStream instances,
 * each bounded at 30,000, so the real ceiling was double what both this
 * constant's own doc and the EXPORTED `TOOL_OUTPUT_CAPS.bash` promised.
 * Measured, 50,000 bytes to each stream in one call returned 60,352 characters
 * against a stated cap of 30,000 — and that export exists precisely so a
 * consumer can mirror this engine's context accounting without re-deriving it,
 * so the error rode straight into the consumer's ledger at 2x.
 *
 * Resolved toward the DOCUMENTED semantics on the keeper's 2026-07-29 ruling
 * ("align with official Claude Code"): the official prompt corpus states the
 * contract to the model as a single quantity — "Bash output is limited to
 * ${MAX_OUTPUT_CHARS} chars" (system-reminder-read-truncation-retry-guidance),
 * "If the output exceeds ${MAX_OUTPUT_CHARS_FN()} characters, output will be
 * truncated" (tool-description-powershell) — with no per-stream language
 * anywhere in it. The name keeps its old `STREAM_` prefix only so the export
 * surface does not churn; the semantics are total.
 *
 * The one-line truncation marker is metadata ABOUT the cut, added after the
 * trim, so a truncated result is cap + marker.
 */
export const STREAM_CAP_CHARS = 30_000;
/** Official maximum the configured cap is clamped to (Claude Code's own
 *  BASH_MAX_OUTPUT_LENGTH ceiling). */
export const MAX_STREAM_CAP_CHARS = 150_000;

/** Resolve the effective output cap: options.bashLimits.maxOutputChars wins,
 *  then the official BASH_MAX_OUTPUT_LENGTH env var, then the 30000 default —
 *  every source clamped to the official 150000 ceiling. Non-finite / non-int /
 *  non-positive values are IGNORED (fall through), never propagated: a NaN cap
 *  would destroy every capped output (0.98.0 numeric-boundary lens). */
export function resolveBashOutputCap(
  limits?: BashLimits,
  env?: Record<string, string | undefined>,
): number {
  const candidates: unknown[] = [
    limits?.maxOutputChars,
    env?.['BASH_MAX_OUTPUT_LENGTH'] !== undefined
      ? Number.parseInt(env['BASH_MAX_OUTPUT_LENGTH'] as string, 10)
      : undefined,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isInteger(c) && c > 0) {
      return Math.min(c, MAX_STREAM_CAP_CHARS);
    }
  }
  return STREAM_CAP_CHARS;
}
const KILL_GRACE_MS = 2_000;
/**
 * After the direct shell exits, how long to let its stdout/stderr pipes flush
 * before settling. Bounds the wait when a background descendant inherited the
 * pipes and holds them open indefinitely (the 'close' event would otherwise
 * never fire). The common case settles earlier, on 'close'.
 */
const FLUSH_GRACE_MS = 200;

/**
 * Accumulates stream output, keeping only the LAST STREAM_CAP_CHARS chars.
 *
 * Keeping the HEAD instead (the shape until 2026-07-27) dropped exactly what a
 * long command is run for: the build verdict, the test summary, the final
 * error all land in the closing lines, while the retained head was compiler
 * chatter. Claude Code truncates its command output from the front for the
 * same reason. The marker moves to the front with the cut.
 *
 * Memory: the buffer is trimmed AFTER appending, so the instantaneous peak is
 * STREAM_CAP_CHARS + one chunk rather than a hard 30,000 — stdout chunks are
 * far below that and the excess is released on the next trim.
 */
class CappedStream {
  private buf = '';
  private dropped = 0;

  /** The per-call resolved cap (resolveBashOutputCap), not the bare default:
   *  the two-tier knob and the SHARED-total semantics are independent changes
   *  that landed concurrently, and both belong here. */
  constructor(private readonly cap: number = STREAM_CAP_CHARS) {}

  append(chunk: string): void {
    this.buf += chunk;
    if (this.buf.length > this.cap) {
      const before = this.buf.length;
      this.buf = sliceTailSurrogateSafe(this.buf, this.cap);
      this.dropped += before - this.buf.length;
    }
  }

  /**
   * Whether the cap actually dropped chars from THIS stream — the fact the
   * structured result reports.
   *
   * Read from the counter, never re-derived by pattern-matching the rendered
   * text. Until 2026-07-29 `truncated` was computed as
   * `/^\[\d+ earlier chars dropped:/.test(outcome.stdout)`, i.e. from a string
   * the COMMAND controls: `printf '%s' '[42 earlier chars dropped: nothing]'`
   * (39 chars out, nothing dropped) measured
   * `{"exitCode":0,...,"truncated":true}` — a caller paging on the flag would
   * re-run the command redirected to a file for output that was already
   * complete. The counter cannot be forged by command output.
   */
  get droppedChars(): number {
    return this.dropped;
  }

  /** Retained bytes WITHOUT the truncation marker: the marker is written once
   *  for the whole call (applyTotalCap), not once per stream. */
  raw(): string {
    return this.buf;
  }
}

/** Truncation discipline (keeper 2026-07-27): how much, why, how to recover. */
function truncationMarker(dropped: number, cap: number = STREAM_CAP_CHARS): string {
  return (
    `[${dropped} earlier chars dropped: output exceeded the ` +
    `${cap}-char cap and only the tail is kept. For the full ` +
    `output, redirect to a file (command > out.log 2>&1) and read it.]\n`
  );
}

/**
 * Enforce the SHARED total cap across the pair and attach one marker.
 *
 * stdout renders first, so its head is the call's earliest output and is
 * dropped first; stderr's head goes only if stderr alone still exceeds the cap.
 * `priorDropped` carries what each stream's own memory bound already discarded,
 * so the marker reports the call's true total.
 */
function applyTotalCap(
  rawStdout: string,
  rawStderr: string,
  priorDropped: number,
  cap: number = STREAM_CAP_CHARS,
): { stdout: string; stderr: string; dropped: number } {
  let out = rawStdout;
  let err = rawStderr;
  let over = out.length + err.length - cap;
  if (over > 0 && out.length > 0) {
    const keep = Math.max(0, out.length - over);
    const trimmed = keep === 0 ? '' : sliceTailSurrogateSafe(out, keep);
    over -= out.length - trimmed.length;
    out = trimmed;
  }
  if (over > 0 && err.length > 0) {
    const keep = Math.max(0, err.length - over);
    err = keep === 0 ? '' : sliceTailSurrogateSafe(err, keep);
  }
  const dropped =
    priorDropped + (rawStdout.length - out.length) + (rawStderr.length - err.length);
  if (dropped === 0) return { stdout: out, stderr: err, dropped: 0 };
  const marker = truncationMarker(dropped, cap);
  if (out.length > 0 || err.length === 0) out = marker + out;
  else err = marker + err;
  return { stdout: out, stderr: err, dropped };
}

type RunOutcome =
  | { kind: 'spawn-error'; error: NodeJS.ErrnoException }
  | {
      kind: 'exit';
      code: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
      /** The call's output exceeded the SHARED STREAM_CAP_CHARS allowance
       *  (counter-derived, never re-sniffed from the rendered text). */
      truncated: boolean;
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
  capChars: number = STREAM_CAP_CHARS,
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    // Wrap through the sandbox backend (default-on) unless unsandboxed or the
    // escape hatch is engaged for this call. The wrapped argv still spawns with
    // detached:true, so the process-group kill semantics below are unchanged.
    const plan = planShellSpawn(shell, command, ctx, disableSandbox);
    // detached:true puts the shell (or bwrap, which becomes the group leader)
    // in its own process group so termination can signal the WHOLE tree, not
    // just the direct child. --unshare-pid + SIGKILL escalation still reap it.
    // spawn() throws SYNCHRONOUSLY for some invalid argv (e.g. a NUL byte in
    // the command -> ERR_INVALID_ARG_VALUE) rather than emitting an async
    // 'error' event, so it must be guarded or the throw rejects this executor
    // and escapes runShell (which "never rejects"). The background path
    // (shells.ts spawnBackground) already guards this; fold the throw into the
    // existing spawn-error outcome so execute() surfaces a ConfigurationError.
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(plan.command, plan.args, {
        cwd: ctx.cwd,
        env: resolveSpawnEnv(
          ctx.env as NodeJS.ProcessEnv,
          plan.envOverlay,
          ctx.sandbox,
          disableSandbox,
        ),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    } catch (error) {
      resolve({ kind: 'spawn-error', error: error as NodeJS.ErrnoException });
      return;
    }

    const stdout = new CappedStream(capChars);
    const stderr = new CappedStream(capChars);
    let settled = false;
    let spawned = false;
    let timedOut = false;
    let aborted = false;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let killTimer: NodeJS.Timeout | undefined;
    let flushTimer: NodeJS.Timeout | undefined;

    // Terminate the shell's whole tree, platform-correctly: POSIX signals the
    // process group (-pid); Windows uses one taskkill /T /F pass. Shared
    // executor createTreeKiller (kill-plan.ts) — dedup with shells.ts
    // spawnBackground, audit 2026-07-14 L-10.
    const killGroup = createTreeKiller(child, ctx.debug);

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
      // WV5-1 (audit r3): the process may have already EXITED and only be
      // waiting on the flush-grace window; setting timedOut then would mislabel
      // a successful command as timed out. Only fire when the child is still
      // genuinely running.
      if (settled || exited) return;
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
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
        // The direct shell exited with the SIGTERM->SIGKILL escalation still
        // armed: SIGTERM-ignoring descendants in the group may survive it.
        // Fire the SIGKILL now, while live members pin the PGID against
        // recycling (empty group -> ESRCH no-op); the delayed timer variant
        // risked the recycled-PGID hazard (audit 2026-07-17 L23).
        killGroup('SIGKILL');
      }
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      ctx.signal.removeEventListener('abort', onAbort);
    };

    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      const capped = applyTotalCap(
        stdout.raw(),
        stderr.raw(),
        stdout.droppedChars + stderr.droppedChars,
        capChars,
      );
      resolve({
        kind: 'exit',
        code: exitCode,
        signal: exitSignal,
        stdout: capped.stdout,
        stderr: capped.stderr,
        truncated: capped.dropped > 0,
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
      const capped = applyTotalCap(
        stdout.raw(),
        stderr.raw(),
        stdout.droppedChars + stderr.droppedChars,
        capChars,
      );
      resolve({
        kind: 'exit',
        code: null,
        signal: null,
        stdout: capped.stdout,
        // The process-error note is diagnostics ABOUT the failure, not command
        // output, so it rides outside the cap like the truncation marker.
        stderr: `${capped.stderr}\n[process error] ${error.message}`.trim(),
        truncated: capped.dropped > 0,
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
 *
 * `stateDir` is the caller's PER-CONTEXT namespace: the root loop replays the
 * query-wide dir, while each spawned subagent's ToolContext carries a forked
 * dir seeded from its parent at spawn time (shells.ts forkShellSession), so
 * concurrent batch-mates never replay each other's cd/exports and a child's
 * mutations never reach the parent's next call (audit 2026-07-14 M-10).
 *
 * The state dir comes from mkdtemp, so single-quoting it is safe against word
 * splitting. But on Windows mkdtemp returns a BACKSLASH path
 * (`C:\Users\…\bpt-shell-X`); embedded verbatim, those backslashes corrupt
 * `$__bpt_state` when it later expands inside the double-quoted `"$__bpt_state/cwd"`
 * references, so the replay/capture reads/writes a mangled path and the whole
 * wrapper fails — the command line degrades to `cat: '"/cwd"': No such file` and
 * exit 127 (BPT Windows incident 2026-07-08). bash/msys accept forward-slash
 * paths on Windows, so we normalize `\` -> `/` for the SCRIPT form ONLY. The
 * Node layer (shells.ts mkdtemp/rm/`join`) keeps the original OS path — those
 * APIs take either separator, and rewriting them risks an rmSync mismatch.
 * No-op on POSIX (mkdtemp paths have no backslashes there).
 */
export function withPersistentState(command: string, stateDir: string): string {
  return [
    ...stateReplayPrologue(stateDir),
    '__bpt_persist() {',
    '  pwd > "$__bpt_state/cwd" 2>/dev/null || true',
    '  export -p > "$__bpt_state/env" 2>/dev/null || true',
    '}',
    'trap __bpt_persist EXIT',
    command,
  ].join('\n');
}

/** Shared replay prologue: restore the previous foreground call's cwd + env. */
function stateReplayPrologue(stateDir: string): string[] {
  const bashStateDir = stateDir.replace(/\\/g, '/');
  return [
    `__bpt_state='${bashStateDir}'`,
    'if [ -f "$__bpt_state/cwd" ]; then cd -- "$(cat "$__bpt_state/cwd")" 2>/dev/null || true; fi',
    'if [ -f "$__bpt_state/env" ]; then { . "$__bpt_state/env"; } 2>/dev/null || true; fi',
  ];
}

/**
 * Replay-ONLY variant for background launches (F5, audit 2026-07-17). A
 * background command used to run with no persistent-state wrapper at all, so
 * a prior foreground `cd`/`export` silently did not apply — directly
 * contradicting the tool description ("working directory persists") and
 * Monitor's "same shell environment". Background shells now REPLAY the state
 * snapshot at launch but never capture back: a background process exits at an
 * arbitrary later time, and an EXIT trap there would clobber state persisted
 * by foreground commands that ran in between.
 */
export function withStateReplay(command: string, stateDir: string): string {
  return [...stateReplayPrologue(stateDir), command].join('\n');
}

/**
 * Windows-cmd habit correction (BPT pilot incident 2026-07-06: on Windows
 * hosts the model kept writing cmd.exe spellings — copy/move/del/findstr —
 * into the Bash tool, burning turns on retries). Two layers:
 *   - description layer: BASH_WIN32_NOTE is appended to the Bash description
 *     ONLY when the platform is win32 (createBashTool below — same
 *     conditional-assembly pattern as the sandbox note; non-win32
 *     descriptions stay byte-identical).
 *   - error layer (all platforms): when a command exits 127 (command not
 *     found) and its FIRST command word is a cmd.exe-only word, the error
 *     text gains a one-line correction (windowsCmdHint below).
 *
 * The word list is high-confidence only, to avoid false positives:
 * `dir` and `type` are deliberately EXCLUDED — `dir` is a real GNU coreutils
 * command and `type` is a bash builtin, so both succeed in bash and must not
 * be steered away from.
 */
const CMD_ONLY_WORDS = new Set([
  'copy',
  'move',
  'del',
  'erase',
  'xcopy',
  'robocopy',
  'findstr',
  'cls',
  'md',
  'rd',
  'ren',
]);

const CMD_NOT_FOUND_HINT =
  'Note: this shell is POSIX bash, not Windows cmd — use cp/mv/rm/grep ' +
  'instead of copy/move/del/findstr.';

/**
 * Return the cmd-habit correction to append to a failure, or '' when it does
 * not apply. Fires only on exit code 127 (command not found) with the first
 * command word in CMD_ONLY_WORDS. First-word extraction is deliberately
 * simple: trim, skip leading VAR=value env assignments, take the first
 * whitespace-delimited token (matched case-insensitively — cmd habits often
 * arrive uppercased). Compound commands (`&&`, `;`, pipes) are only checked
 * at the very front of the string: a cmd word later in the line does not
 * trigger the hint (kept simple by design; the 127 still surfaces normally).
 */
export function windowsCmdHint(command: string, exitCode: number | null): string {
  if (exitCode !== 127) return '';
  let first = '';
  for (const token of command.trim().split(/\s+/)) {
    // Skip leading environment assignments (FOO=bar cmd ...).
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    first = token;
    break;
  }
  return CMD_ONLY_WORDS.has(first.toLowerCase()) ? '\n\n' + CMD_NOT_FOUND_HINT : '';
}

/**
 * Common `128 + signal` exit codes -> POSIX signal name. Under bwrap the inner
 * command's signal death does not propagate as a Node `signal` on the outer
 * process (bwrap exits 128+N with its own signal=null), so a sandboxed segfault
 * surfaces as "exit code 139" while the SAME command unsandboxed reports
 * "signal SIGSEGV" — a cosmetic sandbox/non-sandbox divergence (audit
 * 2026-07-17 Q3).
 */
const SANDBOX_SIGNAL_BY_CODE: Readonly<Record<number, string>> = {
  130: 'SIGINT',
  131: 'SIGQUIT',
  132: 'SIGILL',
  134: 'SIGABRT',
  135: 'SIGBUS',
  136: 'SIGFPE',
  137: 'SIGKILL',
  139: 'SIGSEGV',
  141: 'SIGPIPE',
  143: 'SIGTERM',
};

/**
 * When a SANDBOXED command reports no Node signal but exits with a recognized
 * `128 + N` code, return a soft note naming the likely signal. Deliberately
 * additive (never overrides the reported exit code): a program can legitimately
 * `exit(139)`, so we clarify rather than assert. Empty for unsandboxed calls
 * (their signal deaths already surface as a real `signal`) and unrecognized
 * codes.
 */
export function sandboxSignalHint(code: number | null, sandboxed: boolean): string {
  if (!sandboxed || code === null) return '';
  const sig = SANDBOX_SIGNAL_BY_CODE[code];
  return sig === undefined
    ? ''
    : `\n\n(exit code ${code} under the sandbox typically means termination by ` +
        `${sig}; bwrap reports a signalled child as 128+signal rather than as a signal.)`;
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
 * byte-identical description on non-win32 hosts (locks tests that import
 * `bashTool` directly). On win32 the platform note (BASH_WIN32_NOTE) is
 * appended — same gated-assembly pattern as the sandbox note; `platform` is
 * injectable for tests only.
 */
export function createBashTool(
  sandbox?: SandboxContext,
  platform: NodeJS.Platform = process.platform,
  limits?: BashLimits,
): BuiltinTool {
  const capChars = resolveBashOutputCap(limits);
  const active = sandbox !== undefined;
  const mode = sandbox?.allowEscape === false ? 'mandatory' : 'default';
  let description = BASH_DESCRIPTION;
  // Gated like the sandbox note: appended ONLY on win32, so the non-win32
  // description stays byte-identical (conformance wire runs on Linux CI).
  if (platform === 'win32') description += '\n\n' + BASH_WIN32_NOTE;
  if (active) description += '\n\n' + buildBashSandboxNote(mode, sandbox.allowNetwork);
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
    // Bind the resolved output cap; the default (30000) path stays
    // behavior-identical to the pre-knob execute.
    execute: (input, ctx) => execute(input, ctx, capChars),
  };
}

/** The default (unsandboxed) Bash tool — description byte-identical to
 *  pre-sandbox on non-win32 hosts (win32 gains the gated platform note);
 *  the schema carries the always-on escape param (no-op here). */
export const bashTool: BuiltinTool = createBashTool();

/** Structured result shared by Bash's three terminal branches, so a consumer
 *  reads the same shape whether the command succeeded, failed or timed out —
 *  facts that were previously only recoverable by parsing the report string. */
function bashStructured(
  outcome: { stdout: string; stderr: string; code: number | null; truncated: boolean },
  opts: { interrupted: boolean; timedOutAfterMs?: number },
): BashStructuredOutput {
  return {
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    interrupted: opts.interrupted,
    exitCode: outcome.code,
    ...(opts.timedOutAfterMs !== undefined && { timedOutAfterMs: opts.timedOutAfterMs }),
    // Counter-derived, not text-sniffed — see CappedStream.truncated.
    truncated: outcome.truncated,
  };
}

async function execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
    capChars: number = STREAM_CAP_CHARS,
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
      // F5: background commands see the persistent cwd/env state too —
      // replay-only (no capture-back; see withStateReplay).
      const bgCommand =
        ctx.shells.stateDir !== ''
          ? withStateReplay(command, ctx.shells.stateDir)
          : command;
      // Windows-aware shell resolution (see shell-resolve.ts): candidates are
      // tried in order; an empty list means no POSIX shell on this host.
      const bgShells = resolvePosixShells(ctx.env as Record<string, string | undefined>);
      let launched: Awaited<ReturnType<typeof ctx.shells.spawnBackground>> = {
        error: SHELL_NOT_FOUND_GUIDANCE,
      };
      for (const shell of bgShells) {
        launched = await ctx.shells.spawnBackground(shell, bgCommand, ctx, disableSandbox);
        if (!('error' in launched)) break;
        // Mirror the foreground chain: only ENOENT falls through to the next
        // candidate. Any other spawn failure (e.g. EACCES on an explicit
        // CLAUDE_CODE_GIT_BASH_PATH) is terminal — silently degrading to a
        // different interpreter is the wrong-shell trap shell-resolve.ts
        // exists to prevent.
        if (!launched.error.includes('ENOENT')) break;
      }
      if ('error' in launched) {
        // ENOENT here has the same two causes as the foreground chain below:
        // the interpreter is missing, or `cwd` does not exist — and reporting
        // the second as the first sends the host chasing a shell install
        // (2026-07-26 probe; the foreground path got this disambiguation).
        const detail =
          launched.error.includes('ENOENT') && !existsSync(ctx.cwd)
            ? `working directory does not exist: ${ctx.cwd}`
            : launched.error;
        return {
          content: `Bash: failed to launch background shell: ${detail}`,
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
    // Plain-object sentinel (never thrown/escaped — only .code/.message are
    // read below), so no bare Error is constructed (error-discipline E6d).
    let outcome: RunOutcome = {
      kind: 'spawn-error',
      error: {
        name: 'Error',
        message: SHELL_NOT_FOUND_GUIDANCE,
        code: 'ENOENT',
      } as NodeJS.ErrnoException,
    };
    for (const shell of shells) {
      if (ctx.signal.aborted) throw new AbortError();
      outcome = await runShell(shell, effective, ctx, timeoutMs, disableSandbox, capChars);
      if (!(outcome.kind === 'spawn-error' && outcome.error.code === 'ENOENT')) break;
      ctx.debug(`Bash: ${shell} not found, trying the next shell candidate`);
    }
    if (outcome.kind === 'spawn-error') {
      // Spawn impossibility is the only legitimate throw for this tool. When
      // the whole candidate chain missed, the message carries the actionable
      // guidance (Git Bash / CLAUDE_CODE_GIT_BASH_PATH) instead of raw ENOENT.
      // Typed (audit 2026-07-10): this was the last bare `Error` in src/ — an
      // unspawnable shell is an environment/configuration problem, and the
      // stable `code` lets a host route it without parsing the message.
      // ENOENT from spawn has TWO causes and they need different advice: the
      // interpreter is missing, or `cwd` does not exist. Reporting the second
      // as the first told a host with a bad working directory to go install Git
      // Bash — a wrong answer that is worse than a raw errno because it sounds
      // authoritative (2026-07-26 platform probe, where a POSIX-only `/tmp`
      // resolved to a non-existent `C:\tmp`). Distinguish them.
      let detail: string;
      if (outcome.error.code !== 'ENOENT') {
        detail = outcome.error.message;
      } else if (!existsSync(ctx.cwd)) {
        detail = `working directory does not exist: ${ctx.cwd}`;
      } else {
        detail = SHELL_NOT_FOUND_GUIDANCE;
      }
      throw new ConfigurationError(`Bash: failed to spawn a shell: ${detail}`);
    }

    if (outcome.aborted || ctx.signal.aborted) throw new AbortError();

    const streams = formatStreams(outcome.stdout, outcome.stderr);

    if (outcome.timedOut) {
      return {
        content:
          `Command timed out after ${timeoutMs}ms` +
          (streams.length > 0 ? `\n${streams}` : ''),
        isError: true,
        structuredOutput: bashStructured(outcome, {
          interrupted: true,
          timedOutAfterMs: timeoutMs,
        }),
      };
    }

    if (outcome.code === 0) {
      return {
        content: streams.length > 0 ? streams : '(no output)',
        structuredOutput: bashStructured(outcome, { interrupted: false }),
      };
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
    // cmd-habit correction (all platforms): 127 + a cmd.exe-only first word
    // gets a one-line steer to the POSIX spellings. Checked against the
    // MODEL's command, not the persistent-state wrapper.
    const cmdHint = windowsCmdHint(command, outcome.code);
    // Sandboxed signal deaths arrive as 128+N with no Node signal; name the
    // likely signal so the report matches the unsandboxed path (audit Q3).
    const sigHint =
      outcome.signal === null
        ? sandboxSignalHint(outcome.code, ctx.sandbox !== undefined && !disableSandbox)
        : '';
    return {
      content: failure + (streams.length > 0 ? `\n${streams}` : '') + hint + cmdHint + sigHint,
      isError: true,
      structuredOutput: bashStructured(outcome, { interrupted: false }),
    };
}
