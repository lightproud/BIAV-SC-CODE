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
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AbortError } from '../errors.js';
import { guardRegexPattern } from '../internal/regex-guard.js';
import { planShellSpawn, resolveSpawnEnv } from '../sandbox/backend.js';
import { createTreeKiller, terminalStatus } from './kill-plan.js';
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
  // Pending SIGTERM->SIGKILL escalation timers, cleared on process exit so a
  // recycled PGID is never signalled after the fact (audit 2026-07-10 L1).
  const killTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

    async spawnBackground(shell, command, ctx, disableSandbox = false) {
      const id = `bash_${nextId++}`;
      // Wrap through the sandbox backend (default-on) unless unsandboxed or the
      // escape hatch is engaged for this launch.
      const plan = planShellSpawn(shell, command, ctx, disableSandbox);
      const sandboxCtx = disableSandbox ? undefined : ctx.sandbox;
      let child;
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
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }

      // M11 (audit 2026-07-17): a detached spawn reports ENOENT ASYNCHRONOUSLY
      // (the 'error' event), so the try/catch above never sees a missing shell
      // — the launch was acked as running and only later flipped to 'failed',
      // silently. Wait for the spawn/error race (exactly one fires, promptly)
      // so a missing `bash` is a RETURNED error the caller's candidate chain
      // (bash -> sh, Windows Git Bash resolution) can fall through on.
      const spawnFailure = await new Promise<Error | null>((resolve) => {
        child.once('spawn', () => resolve(null));
        child.once('error', (err: Error) => resolve(err));
      });
      if (spawnFailure !== null) {
        const errno = spawnFailure as NodeJS.ErrnoException;
        return {
          error:
            errno.code === 'ENOENT'
              ? `spawn ${plan.command} ENOENT`
              : spawnFailure.message,
        };
      }

      // Terminate the shell's whole tree, platform-correctly: POSIX signals
      // the process group (-pid); Windows uses one taskkill /T /F pass.
      // Shared executor createTreeKiller (kill-plan.ts) — dedup with bash.ts
      // foreground killGroup, audit 2026-07-14 L-10.
      const killGroup = createTreeKiller(child, debug, ` for shell ${id}`);

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
        killRequested: false,
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
        // Cancel any pending SIGTERM->SIGKILL escalation timer: firing it
        // LATER would signal -pgid after the PGID could have been recycled to
        // an unrelated process group (audit 2026-07-10 L1). But a silent
        // cancel orphaned SIGTERM-ignoring descendants when only the DIRECT
        // shell died — so fire the SIGKILL NOW instead: live group members
        // pin the PGID against recycling, and an empty group is an ESRCH
        // no-op (audit 2026-07-17 L23).
        const pending = killTimers.get(id);
        if (pending !== undefined) {
          clearTimeout(pending);
          killTimers.delete(id);
          killGroup('SIGKILL');
        }
        rec.exitCode = code;
        rec.exitSignal = signal;
        // HONEST terminal status, decided from what actually happened - never
        // eagerly at the kill request. A process that ran to completion is
        // 'completed' even if a kill was requested but lost the race (the
        // BPT-reported lie: killed-forever despite exit 0).
        if (rec.status === 'running') {
          rec.status = terminalStatus(rec.killRequested, code);
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
      // Never signal a shell that already reached a terminal state: its PGID may
      // have been recycled to an unrelated process, and a SIGKILL-escalation
      // timer armed AFTER exit is never cleared by the exit handler (it only
      // clears timers armed before exit) — so it would fire on the recycled
      // group, the exact L1 hazard this module guards against.
      if (rec.status !== 'running') return false;
      // Record intent only; the terminal status is set by the exit handler
      // (terminalStatus) from what actually happens - not forced to 'killed'
      // here before the signal has even landed.
      rec.killRequested = true;
      rec.kill('SIGTERM');
      // Replace (never leak) any in-flight escalation timer: a second kill()
      // — e.g. a Monitor timeout racing an explicit KillShell — would otherwise
      // orphan the first timer and mis-delete the wrong entry when one fires.
      const existing = killTimers.get(id);
      if (existing !== undefined) clearTimeout(existing);
      const t = setTimeout(() => {
        killTimers.delete(id);
        rec.kill('SIGKILL');
      }, KILL_GRACE_MS);
      t.unref?.();
      killTimers.set(id, t);
      return true;
    },

    dispose() {
      for (const t of killTimers.values()) clearTimeout(t);
      killTimers.clear();
      for (const rec of shells.values()) {
        if (rec.status === 'running') {
          // Query teardown: force-kill and mark killed. Records are discarded
          // immediately below, so this status is not observed post-dispose.
          rec.killRequested = true;
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
// Per-subagent persistent-state fork (audit 2026-07-14 M-10)
// ---------------------------------------------------------------------------

/**
 * Fork the PERSISTENT-STATE namespace of a shell session for one spawned
 * subagent (audit 2026-07-14 M-10). Before this, every concurrent foreground
 * subagent shared the query's single cwd/env state file, so one batch-mate's
 * `cd`/`export` replayed into its siblings' (and the parent's) next Bash call
 * — cross-pollution plus a write race on the shared file. The fork:
 *   - creates a child state dir SEEDED from the parent's current cwd/env
 *     snapshot, so the child still sees the parent's persistent state as it
 *     was at spawn time, but its own mutations stay in its namespace and
 *     never leak to siblings or back to the parent;
 *   - nests the child dir UNDER the parent state dir, so the query-wide
 *     dispose() removes every fork with no extra lifecycle plumbing (a
 *     SendMessage continuation between-times still finds its state intact);
 *   - scopes ONLY the persistent state: spawnBackground/get/kill delegate to
 *     the query-wide manager, so children list, read and stop the SAME
 *     background shells as the root loop.
 * A parent with no state dir (persistence already degraded to stateless) has
 * nothing to fork or pollute and is returned as-is; a fork whose own mkdtemp
 * fails degrades that child to stateless ('' state dir) rather than falling
 * back onto the shared parent file.
 */
export function forkShellSession(parent: ShellManager): ShellManager {
  if (parent.stateDir === '') return parent;
  let childDir = '';
  try {
    childDir = mkdtempSync(join(parent.stateDir, 'fork-'));
    for (const name of ['cwd', 'env']) {
      try {
        copyFileSync(join(parent.stateDir, name), join(childDir, name));
      } catch {
        // No parent snapshot for this file yet (no foreground Bash ran
        // before the spawn) — the child simply starts without one.
      }
    }
  } catch {
    childDir = ''; // degrade to stateless, never back to the shared file
  }
  return {
    stateDir: childDir,
    spawnBackground: (shell, command, ctx, disableSandbox) =>
      parent.spawnBackground(shell, command, ctx, disableSandbox),
    get: (id) => parent.get(id),
    kill: (id) => parent.kill(id),
    // Scoped dispose: drop only this fork's namespace. Background shells
    // belong to the query-wide manager and are disposed there.
    dispose: () => {
      if (childDir !== '') {
        try {
          rmSync(childDir, { recursive: true, force: true });
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

/** Apply an optional per-line regex filter to an output chunk.
 *  Callers must pre-screen `filter` with guardRegexPattern (audit 2026-07-14
 *  M-2): this helper only handles SYNTACTIC invalidity (passes everything);
 *  ReDoS-risky patterns are rejected at the tool boundary with a descriptive
 *  error so the model can rephrase. */
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

/**
 * Consume a stream window for a FILTERED read (F4, audit 2026-07-17). The
 * cursor is a raw char offset, so a poll can land MID-LINE: the line-anchored
 * filter then tests both fragments ("ERR" now, "OR: x" next poll) and a line
 * matching `/^ERROR/` is dropped forever. When a filter is active on a
 * still-running shell, only complete lines (up to the last '\n') are consumed
 * — the trailing partial line stays unconsumed and is re-tested whole on the
 * next poll. Once the shell is terminal (or the stream hit its accumulation
 * cap, i.e. no more data is coming), everything is consumed.
 */
function consumeWindow(
  data: string,
  cursor: number,
  holdPartialTail: boolean,
): { chunk: string; nextCursor: number } {
  if (!holdPartialTail) {
    return { chunk: data.slice(cursor), nextCursor: data.length };
  }
  const lastNl = data.lastIndexOf('\n');
  const end = lastNl >= cursor ? lastNl + 1 : cursor;
  return { chunk: data.slice(cursor, end), nextCursor: end };
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
    // ReDoS guard (audit 2026-07-14 M-2, shared with Grep and hooks/matcher):
    // the filter regex runs per line over up to 500K chars of accumulated
    // shell output, synchronously. Reject risky patterns with a message the
    // model can act on, BEFORE the cursors advance (so no output is lost).
    if (filter !== undefined) {
      const guardReason = guardRegexPattern(filter);
      if (guardReason !== null) {
        return {
          content:
            `BashOutput: unsafe "filter" regular expression rejected: ` +
            `${guardReason}. Retry with a simpler filter (or none).`,
          isError: true,
        };
      }
      // Syntactic validity must ALSO be checked before the cursors advance:
      // filterLines' catch used to pass everything through unfiltered while
      // the cursor moved on — the model believed the output was filtered and
      // the raw window was unrecoverable (audit 2026-07-17 L18).
      try {
        new RegExp(filter);
      } catch (e) {
        return {
          content:
            `BashOutput: invalid "filter" regular expression: ` +
            `${(e as Error).message}. Fix the pattern and retry — no output ` +
            `was consumed.`,
          isError: true,
        };
      }
    }
    // F4: with an active filter on a running shell, hold back the trailing
    // partial line so the line-anchored regex never tests a chunk fragment.
    const holding = filter !== undefined && rec.status === 'running';
    const winOut = consumeWindow(
      rec.stdout,
      rec.cursorOut,
      holding && !rec.stdoutTruncated,
    );
    const winErr = consumeWindow(
      rec.stderr,
      rec.cursorErr,
      holding && !rec.stderrTruncated,
    );
    rec.cursorOut = winOut.nextCursor;
    rec.cursorErr = winErr.nextCursor;

    const parts: string[] = [describeStatus(rec)];
    const out = filterLines(winOut.chunk, filter);
    const err = filterLines(winErr.chunk, filter);
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

// ---------------------------------------------------------------------------
// TaskOutput / TaskStop built-in tools (official 0.3.201 names)
//
// These are the official-named surface for reading and stopping a background
// task. In this SDK a "background task" IS a background shell (spawned by Bash
// run_in_background or by Monitor), so both tools delegate to the SAME
// ShellManager that backs the legacy BashOutput / KillShell tools. Both
// surfaces ship during the transition: the reproduced Bash / Monitor tool
// descriptions steer the model to BashOutput / KillShell, while TaskOutput /
// TaskStop close the official drop-in tool-NAME gap (audit 2026-07-08). The
// official input schemas are reproduced (TaskOutput: task_id/block/timeout;
// TaskStop: task_id + deprecated shell_id alias); the runtime tolerates
// omitted block/timeout the way the CLI defaults them.
// ---------------------------------------------------------------------------

/** Blocking wait for TaskOutput when `timeout` is absent/invalid (ms). */
const TASK_OUTPUT_DEFAULT_TIMEOUT_MS = 60_000;
/** Hard cap on a model-supplied blocking timeout (audit 2026-07-10 P0-3): a
 *  blocking TaskOutput holds the engine's tool await, so an unbounded value
 *  would let one tool call defer interrupt()/close() teardown indefinitely. */
const TASK_OUTPUT_MAX_TIMEOUT_MS = 600_000;
/** Poll granularity while TaskOutput blocks for new output (ms). */
const TASK_OUTPUT_POLL_MS = 50;

/** Drain output accumulated since the last read and advance the cursors. */
function drainNewOutput(rec: BackgroundShell): string {
  const newOut = rec.stdout.slice(rec.cursorOut);
  const newErr = rec.stderr.slice(rec.cursorErr);
  rec.cursorOut = rec.stdout.length;
  rec.cursorErr = rec.stderr.length;
  const parts: string[] = [describeStatus(rec)];
  if (newOut.length > 0) parts.push(newOut);
  if (newErr.length > 0) parts.push(`[stderr]\n${newErr}`);
  if (newOut.length === 0 && newErr.length === 0) parts.push('(no new output)');
  if (rec.stdoutTruncated || rec.stderrTruncated) {
    parts.push('[output truncated at the accumulation cap]');
  }
  return parts.join('\n');
}

export const taskOutputTool: BuiltinTool = {
  name: 'TaskOutput',
  description:
    'Retrieve output from a running or completed background task (started with ' +
    'Bash run_in_background or Monitor), plus its current status. Returns the ' +
    'output accumulated since the previous TaskOutput read. Set `block: true` to ' +
    'wait up to `timeout` ms for new output before returning.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'The background task id (returned by Bash run_in_background or Monitor).',
      },
      block: {
        type: 'boolean',
        description: 'Wait for new output (up to `timeout` ms) before returning. Defaults to false.',
      },
      timeout: {
        type: 'number',
        description: 'Maximum time to wait when `block` is true, in milliseconds.',
      },
    },
    // Official 0.3.201 marks all three required (wire parity, conformance
    // run-wire TaskOutput facet). The runtime still tolerates omitted
    // block/timeout defensively (block defaults off, timeout to 60000ms).
    required: ['task_id', 'block', 'timeout'],
  },
  readOnly: true,

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    const id = input['task_id'];
    if (typeof id !== 'string' || id.length === 0) {
      return { content: "TaskOutput: 'task_id' must be a non-empty string.", isError: true };
    }
    if (ctx.shells === undefined) {
      return { content: `TaskOutput: ${NO_MANAGER}`, isError: true };
    }
    const rec = ctx.shells.get(id);
    if (rec === undefined) {
      return { content: `TaskOutput: no background task with id "${id}".`, isError: true };
    }
    if (input['block'] === true) {
      const timeout = Math.min(
        typeof input['timeout'] === 'number' && input['timeout'] > 0
          ? input['timeout']
          : TASK_OUTPUT_DEFAULT_TIMEOUT_MS,
        TASK_OUTPUT_MAX_TIMEOUT_MS,
      );
      const maxWaits = Math.max(1, Math.ceil(timeout / TASK_OUTPUT_POLL_MS));
      for (let i = 0; i < maxWaits; i++) {
        // interrupt()/close() must not wait out a model-chosen blocking window:
        // this await sits on the engine's tool path, and teardown (shell
        // dispose, subagent aborts, MCP close) queues behind it. Bail on abort
        // like every other builtin (audit 2026-07-10 P0-3).
        if (ctx.signal.aborted) throw new AbortError();
        const hasNew = rec.stdout.length > rec.cursorOut || rec.stderr.length > rec.cursorErr;
        if (hasNew || rec.status !== 'running') break;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, TASK_OUTPUT_POLL_MS);
          t.unref?.();
        });
      }
    }
    return { content: drainNewOutput(rec) };
  },
};

export const taskStopTool: BuiltinTool = {
  name: 'TaskStop',
  description:
    'Stop a running background task or shell by id (started with Bash ' +
    'run_in_background or Monitor). Pass `task_id`; `shell_id` is a deprecated ' +
    'alias for the same id.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'The background task id to stop.',
      },
      shell_id: {
        type: 'string',
        description: 'Deprecated: use task_id.',
      },
    },
  },
  readOnly: false,

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    const taskId =
      typeof input['task_id'] === 'string' && input['task_id'].length > 0
        ? input['task_id']
        : undefined;
    const shellId =
      typeof input['shell_id'] === 'string' && input['shell_id'].length > 0
        ? input['shell_id']
        : undefined;
    const id = taskId ?? shellId;
    if (id === undefined) {
      return {
        content: "TaskStop: provide a non-empty 'task_id' (or the deprecated 'shell_id').",
        isError: true,
      };
    }
    // Official v2.1.198: `task_id` also accepts an agent id — a background
    // subagent's agentId stops that subagent (bridge wired on the root loop).
    const agentOutcome = ctx.subagents?.stop(id);
    if (agentOutcome !== undefined) {
      return { content: agentOutcome };
    }
    if (ctx.shells === undefined) {
      return { content: `TaskStop: ${NO_MANAGER}`, isError: true };
    }
    const rec = ctx.shells.get(id);
    if (rec === undefined) {
      return { content: `TaskStop: no background task with id "${id}".`, isError: true };
    }
    if (rec.status !== 'running') {
      return { content: `TaskStop: task ${id} already ${rec.status}.` };
    }
    ctx.shells.kill(id);
    return { content: `Stopped background task ${id}.` };
  },
};
