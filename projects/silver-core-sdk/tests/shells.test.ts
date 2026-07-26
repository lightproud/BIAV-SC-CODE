/**
 * v0.5 — background Bash family: ShellManager, Bash run_in_background +
 * persistent cwd/env state, BashOutput (incremental reads + filter),
 * KillShell.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import {
  createShellManager,
  bashOutputTool,
  forkShellSession,
  killShellTool,
  taskOutputTool,
  taskStopTool,
} from '../src/tools/shells.js';
import { bashTool } from '../src/tools/bash.js';
import type { ShellManager, ToolContext } from '../src/internal/contracts.js';

let sandbox: string;
let manager: ShellManager | undefined;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bpt-shells-'));
  manager = undefined;
});
afterEach(() => {
  manager?.dispose();
  // maxRetries: Windows keeps a handle on a just-reaped child's files for a
  // moment, so an immediate rmdir loses the race with EBUSY and fails the
  // test in TEARDOWN — nothing to do with what was under test (2026-07-26
  // platform probe). Retrying is the documented remedy; a no-op elsewhere.
  // 30 x 100ms: the first attempt at 10 x 50ms still lost the race on the
  // 2026-07-26 probe. Windows releases a dead child's handles asynchronously,
  // and this suite launches background shells. Left to FAIL if 3s is not
  // enough — that would be a real handle leak, not teardown noise.
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
});

function makeCtx(withManager: boolean): ToolContext {
  if (withManager && manager === undefined) {
    manager = createShellManager(() => {});
  }
  return {
    cwd: sandbox,
    additionalDirectories: [],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BPT_HTTP_CLIENT: 'fetch' },
    signal: new AbortController().signal,
    debug: () => {},
    ...(withManager ? { shells: manager } : {}),
  };
}

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function text(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

describe('ShellManager', () => {
  it('runs a background command to completion and accumulates output', async () => {
    const ctx = makeCtx(true);
    const launched = await manager!.spawnBackground('bash', 'echo bg-hello', ctx);
    expect('id' in launched).toBe(true);
    const id = (launched as { id: string }).id;
    await until(() => manager!.get(id)!.status !== 'running');
    const rec = manager!.get(id)!;
    expect(rec.status).toBe('completed');
    expect(rec.exitCode).toBe(0);
    expect(rec.stdout).toContain('bg-hello');
  });

  it('kill() terminates a running shell and marks it killed', async () => {
    const ctx = makeCtx(true);
    const { id } = await manager!.spawnBackground('bash', 'sleep 30', ctx) as { id: string };
    expect(manager!.get(id)!.status).toBe('running');
    expect(manager!.kill(id)).toBe(true);
    await until(() => manager!.get(id)!.exitSignal !== null || manager!.get(id)!.exitCode !== null);
    expect(manager!.get(id)!.status).toBe('killed');
  });

  it('kill() AFTER the process already completed reports completed, not a false killed (BPT incident #3)', async () => {
    const ctx = makeCtx(true);
    const { id } = await manager!.spawnBackground('bash', 'echo quick', ctx) as { id: string };
    // Let it finish on its own first.
    await until(() => manager!.get(id)!.status === 'completed');
    expect(manager!.get(id)!.exitCode).toBe(0);
    // A late kill request must NOT rewrite a completed run to 'killed'.
    manager!.kill(id);
    await new Promise((r) => setTimeout(r, 50));
    expect(manager!.get(id)!.status).toBe('completed');
  });

  it('dispose() removes the state dir', () => {
    makeCtx(true);
    const dir = manager!.stateDir;
    expect(dir.length).toBeGreaterThan(0);
    expect(fs.existsSync(dir)).toBe(true);
    manager!.dispose();
    expect(fs.existsSync(dir)).toBe(false);
    manager = undefined;
  });
});


/**
 * Assert the shell's cwd IS `dir` — WITHOUT comparing path spellings.
 *
 * Every string form of this assertion has now failed on some platform
 * (2026-07-26 probe): macOS resolves `/var` to `/private/var`; Git Bash reports
 * MSYS paths; and worse, Git Bash reaches ONE directory through TWO mounts, so
 * `pwd -P` legitimately answers `/tmp/x` or `/c/Users/.../Temp/x` depending on
 * how the shell got there. All of those are the same directory, and none of
 * them is what "the cwd persisted" means.
 *
 * So stop asking for a name and ask a question only the right directory can
 * answer: read a marker through a RELATIVE path. It resolves against whatever
 * the shell's actual cwd is, on any host, through any mount.
 */
async function expectShellCwdIs(ctx: ToolContext, dir: string, tag: string): Promise<void> {
  fs.writeFileSync(path.join(dir, `${tag}.marker`), tag);
  const out = await bashTool.execute({ command: `cat ./${tag}.marker` }, ctx);
  expect(text(out.content).trim(), `shell cwd is not ${dir}`).toBe(tag);
}

describe('Bash run_in_background + BashOutput + KillShell', () => {
  it('background launch acks with an id; BashOutput reads incrementally', async () => {
    const ctx = makeCtx(true);
    const launch = await bashTool.execute(
      { command: 'echo first; echo second', run_in_background: true },
      ctx,
    );
    expect(launch.isError).not.toBe(true);
    const idMatch = /id: (bash_\d+)/.exec(text(launch.content));
    expect(idMatch).not.toBeNull();
    const id = idMatch![1]!;

    await until(() => manager!.get(id)!.status !== 'running');
    const read1 = await bashOutputTool.execute({ bash_id: id }, ctx);
    const t1 = text(read1.content);
    expect(t1).toContain('status: completed');
    expect(t1).toContain('first');
    expect(t1).toContain('second');

    // Second read: cursor advanced, nothing new.
    const read2 = await bashOutputTool.execute({ bash_id: id }, ctx);
    expect(text(read2.content)).toContain('(no new output)');
  });

  it('BashOutput filter applies per line to NEW output only', async () => {
    const ctx = makeCtx(true);
    const { id } = await manager!.spawnBackground(
      'bash',
      'echo keep-me; echo drop-me',
      ctx,
    ) as { id: string };
    await until(() => manager!.get(id)!.status !== 'running');
    const read = await bashOutputTool.execute({ bash_id: id, filter: '^keep' }, ctx);
    const t = text(read.content);
    expect(t).toContain('keep-me');
    expect(t).not.toContain('drop-me');
  });

  it('KillShell stops a running background shell', async () => {
    const ctx = makeCtx(true);
    const { id } = await manager!.spawnBackground('bash', 'sleep 30', ctx) as { id: string };
    const killed = await killShellTool.execute({ shell_id: id }, ctx);
    expect(killed.isError).not.toBe(true);
    expect(text(killed.content)).toContain(`Killed background shell ${id}`);
    await until(() => manager!.get(id)!.exitSignal !== null || manager!.get(id)!.exitCode !== null);
    expect(manager!.get(id)!.status).toBe('killed');

    // Killing again reports the terminal status instead of erroring.
    const again = await killShellTool.execute({ shell_id: id }, ctx);
    expect(text(again.content)).toContain('already killed');
  });

  it('unknown ids and missing manager are tool errors', async () => {
    const withMgr = makeCtx(true);
    const noSuch = await bashOutputTool.execute({ bash_id: 'bash_999' }, withMgr);
    expect(noSuch.isError).toBe(true);
    const noSuchKill = await killShellTool.execute({ shell_id: 'bash_999' }, withMgr);
    expect(noSuchKill.isError).toBe(true);

    const bare = makeCtx(false);
    const noMgrOut = await bashOutputTool.execute({ bash_id: 'bash_1' }, bare);
    expect(noMgrOut.isError).toBe(true);
    const noMgrBg = await bashTool.execute(
      { command: 'echo x', run_in_background: true },
      bare,
    );
    expect(noMgrBg.isError).toBe(true);
  });
});

describe('TaskOutput / TaskStop (official-name background-task surface)', () => {
  it('TaskOutput reads new output + status, then advances the cursor', async () => {
    const ctx = makeCtx(true);
    const { id } = await manager!.spawnBackground('bash', 'echo alpha; echo beta', ctx) as { id: string };
    await until(() => manager!.get(id)!.status !== 'running');

    const read1 = await taskOutputTool.execute({ task_id: id }, ctx);
    const t1 = text(read1.content);
    expect(read1.isError).not.toBe(true);
    expect(t1).toContain('status: completed');
    expect(t1).toContain('alpha');
    expect(t1).toContain('beta');

    const read2 = await taskOutputTool.execute({ task_id: id }, ctx);
    expect(text(read2.content)).toContain('(no new output)');
  });

  it('TaskOutput has NO filter param (official schema); a filter is ignored, not applied', async () => {
    const ctx = makeCtx(true);
    const { id } = await manager!.spawnBackground('bash', 'echo keep-me; echo drop-me', ctx) as {
      id: string;
    };
    await until(() => manager!.get(id)!.status !== 'running');
    // Passing `filter` (a BashOutput-only param) must not filter — both lines return.
    const read = await taskOutputTool.execute({ task_id: id, filter: '^keep' }, ctx);
    const t = text(read.content);
    expect(t).toContain('keep-me');
    expect(t).toContain('drop-me');
  });

  it('TaskOutput block:true returns quickly when new output arrives', async () => {
    const ctx = makeCtx(true);
    const { id } = await manager!.spawnBackground('bash', 'sleep 0.15; echo late', ctx) as { id: string };
    const read = await taskOutputTool.execute({ task_id: id, block: true, timeout: 5000 }, ctx);
    expect(read.isError).not.toBe(true);
    expect(text(read.content)).toContain('late');
  });

  it('TaskOutput block:true honors timeout on an idle running task', async () => {
    const ctx = makeCtx(true);
    const { id } = await manager!.spawnBackground('bash', 'echo now; sleep 30', ctx) as { id: string };
    await until(() => manager!.get(id)!.stdout.includes('now'));
    // Drain the initial output.
    await taskOutputTool.execute({ task_id: id }, ctx);
    // Now block with a short timeout: the task is still running but emits nothing.
    const start = Date.now();
    const read = await taskOutputTool.execute({ task_id: id, block: true, timeout: 250 }, ctx);
    expect(Date.now() - start).toBeGreaterThanOrEqual(200);
    expect(text(read.content)).toContain('(no new output)');
  });

  it('TaskOutput block:true bails with AbortError when the signal fires (P0-3)', async () => {
    const ctx = makeCtx(true);
    const controller = new AbortController();
    const abortableCtx = { ...ctx, signal: controller.signal };
    const { id } = await manager!.spawnBackground('bash', 'echo now; sleep 30', abortableCtx) as {
      id: string;
    };
    await until(() => manager!.get(id)!.stdout.includes('now'));
    await taskOutputTool.execute({ task_id: id }, abortableCtx); // drain
    // Model asked for a huge blocking window; the abort must cut through it.
    const start = Date.now();
    const pending = taskOutputTool.execute(
      { task_id: id, block: true, timeout: 86_400_000 },
      abortableCtx,
    );
    setTimeout(() => controller.abort(), 80);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  it('TaskStop stops a running task by task_id', async () => {
    const ctx = makeCtx(true);
    const { id } = await manager!.spawnBackground('bash', 'sleep 30', ctx) as { id: string };
    const stopped = await taskStopTool.execute({ task_id: id }, ctx);
    expect(stopped.isError).not.toBe(true);
    expect(text(stopped.content)).toContain(`Stopped background task ${id}`);
    await until(() => manager!.get(id)!.exitSignal !== null || manager!.get(id)!.exitCode !== null);
    expect(manager!.get(id)!.status).toBe('killed');
  });

  it('TaskStop accepts the deprecated shell_id alias', async () => {
    const ctx = makeCtx(true);
    const { id } = await manager!.spawnBackground('bash', 'sleep 30', ctx) as { id: string };
    const stopped = await taskStopTool.execute({ shell_id: id }, ctx);
    expect(stopped.isError).not.toBe(true);
    expect(text(stopped.content)).toContain(`Stopped background task ${id}`);
  });

  it('TaskStop on an already-terminal task reports status without erroring', async () => {
    const ctx = makeCtx(true);
    const { id } = await manager!.spawnBackground('bash', 'echo done', ctx) as { id: string };
    await until(() => manager!.get(id)!.status === 'completed');
    const stopped = await taskStopTool.execute({ task_id: id }, ctx);
    expect(stopped.isError).not.toBe(true);
    expect(text(stopped.content)).toContain('already completed');
  });

  it('unknown ids, missing id, and missing manager are tool errors', async () => {
    const withMgr = makeCtx(true);
    expect((await taskOutputTool.execute({ task_id: 'bash_999' }, withMgr)).isError).toBe(true);
    expect((await taskStopTool.execute({ task_id: 'bash_999' }, withMgr)).isError).toBe(true);
    // TaskStop with neither task_id nor shell_id.
    expect((await taskStopTool.execute({}, withMgr)).isError).toBe(true);

    const bare = makeCtx(false);
    expect((await taskOutputTool.execute({ task_id: 'bash_1' }, bare)).isError).toBe(true);
    expect((await taskStopTool.execute({ task_id: 'bash_1' }, bare)).isError).toBe(true);
  });
});

describe('Bash persistent cwd/env state', () => {
  it('cd persists across Bash calls when a shell manager is present', async () => {
    const ctx = makeCtx(true);
    const sub = path.join(sandbox, 'subdir');
    fs.mkdirSync(sub);
    await bashTool.execute({ command: `cd '${sub}'` }, ctx);
    await expectShellCwdIs(ctx, sub, 'cd-persists');
  });

  it('exported variables persist across Bash calls', async () => {
    const ctx = makeCtx(true);
    await bashTool.execute({ command: 'export BPT_STATE_PROBE=sticky' }, ctx);
    const out = await bashTool.execute({ command: 'echo "probe=$BPT_STATE_PROBE"' }, ctx);
    expect(text(out.content)).toContain('probe=sticky');
  });

  it('state persists even when the command exits non-zero', async () => {
    const ctx = makeCtx(true);
    const res = await bashTool.execute(
      { command: 'export BPT_FAIL_PROBE=kept; exit 3' },
      ctx,
    );
    expect(res.isError).toBe(true);
    expect(text(res.content)).toContain('exit code 3');
    const out = await bashTool.execute({ command: 'echo "fail=$BPT_FAIL_PROBE"' }, ctx);
    expect(text(out.content)).toContain('fail=kept');
  });

  it('without a shell manager Bash stays stateless (v0.1 semantics)', async () => {
    const ctx = makeCtx(false);
    const sub = path.join(sandbox, 'stateless');
    fs.mkdirSync(sub);
    await bashTool.execute({ command: `cd '${sub}'` }, ctx);
    // No manager: the cd must NOT stick — the next call is back at ctx.cwd.
    await expectShellCwdIs(ctx, sandbox, 'stateless');
  });
});

describe('forkShellSession — per-subagent persistent-state fork (audit 2026-07-14 M-10)', () => {
  const firstLine = (r: { content: unknown }): string =>
    text(r.content).trim().split('\n')[0] ?? '';

  it('two forked children do not inherit each other\'s cd; both see the parent cwd as of spawn', async () => {
    const ctx = makeCtx(true);
    const parentDir = path.join(sandbox, 'parent-dir');
    const aDir = path.join(sandbox, 'a-dir');
    fs.mkdirSync(parentDir);
    fs.mkdirSync(aDir);
    // Parent records a persistent cwd BEFORE the spawns.
    await bashTool.execute({ command: `cd '${parentDir}'` }, ctx);

    const ctxA: ToolContext = { ...ctx, shells: forkShellSession(manager!) };
    const ctxB: ToolContext = { ...ctx, shells: forkShellSession(manager!) };

    // A child sees the parent's persistent cwd that existed at spawn time.
    await expectShellCwdIs(ctxA, parentDir, 'fork-a-sees-parent');
    // A cd's away; B's SUBSEQUENT Bash call must NOT inherit A's cwd.
    await bashTool.execute({ command: `cd '${aDir}'` }, ctxA);
    await expectShellCwdIs(ctxB, parentDir, 'fork-b-sees-parent');
    // ... and A keeps its own cwd across its own calls.
    await expectShellCwdIs(ctxA, aDir, 'fork-a-keeps-own');
    // The parent's next foreground Bash is untouched by A's cd.
    await expectShellCwdIs(ctx, parentDir, 'fork-parent-untouched');
  });

  it('a child export does not leak to the parent; the child sees parent exports from spawn time', async () => {
    const ctx = makeCtx(true);
    await bashTool.execute({ command: 'export BPT_FORK_SEED=fromparent' }, ctx);
    const childCtx: ToolContext = { ...ctx, shells: forkShellSession(manager!) };
    // Seeded: the child sees the parent's exported env as of spawn.
    const seed = await bashTool.execute(
      { command: 'echo "seed=$BPT_FORK_SEED"' },
      childCtx,
    );
    expect(text(seed.content)).toContain('seed=fromparent');
    // The child's own export stays in its namespace.
    await bashTool.execute({ command: 'export BPT_FORK_LEAK=child' }, childCtx);
    const parentOut = await bashTool.execute(
      { command: 'echo "leak=${BPT_FORK_LEAK:-none}"' },
      ctx,
    );
    expect(text(parentOut.content)).toContain('leak=none');
  });

  it('background shells stay query-wide through a fork (get/kill delegate to the shared manager)', async () => {
    const ctx = makeCtx(true);
    const child = forkShellSession(manager!);
    const childCtx: ToolContext = { ...ctx, shells: child };
    const launch = await bashTool.execute(
      { command: 'echo bg-through-fork', run_in_background: true },
      childCtx,
    );
    const idMatch = /id: (bash_\d+)/.exec(text(launch.content));
    expect(idMatch).not.toBeNull();
    const id = idMatch![1]!;
    // Registered on the QUERY-WIDE manager, visible from both sides.
    await until(() => manager!.get(id)!.status !== 'running');
    expect(manager!.get(id)!.stdout).toContain('bg-through-fork');
    expect(child.get(id)).toBe(manager!.get(id));
  });

  it('fork dirs nest under the parent state dir and die with the query-wide dispose()', () => {
    makeCtx(true);
    const child = forkShellSession(manager!);
    expect(child.stateDir).not.toBe(manager!.stateDir);
    expect(child.stateDir.startsWith(manager!.stateDir)).toBe(true);
    expect(fs.existsSync(child.stateDir)).toBe(true);
    manager!.dispose();
    expect(fs.existsSync(child.stateDir)).toBe(false);
    manager = undefined;
  });

  it('a stateless parent (no state dir) is returned as-is — nothing to fork or pollute', () => {
    const stateless: ShellManager = {
      stateDir: '',
      spawnBackground: async () => ({ error: 'unused' }),
      get: () => undefined,
      kill: () => false,
      dispose: () => {},
    };
    expect(forkShellSession(stateless)).toBe(stateless);
  });
});
