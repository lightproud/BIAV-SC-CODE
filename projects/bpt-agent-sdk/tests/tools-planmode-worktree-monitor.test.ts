/**
 * B4b batch unit tests: ExitPlanMode / EnterWorktree / Monitor built-in tools
 * plus the shared git-worktree helpers (src/internal/worktree.ts).
 *
 * EnterWorktree and the worktree helpers run against REAL throwaway git repos
 * (fixture pattern from tests/subagents.test.ts), cleaned in afterEach.
 * Monitor runs real background shells via createShellManager, disposed in
 * afterEach.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  ShellManager,
  ToolContext,
  ToolResultPayload,
} from '../src/internal/contracts.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import { createShellManager } from '../src/tools/shells.js';
import { createBuiltinTools } from '../src/tools/index.js';
import { exitPlanModeTool } from '../src/tools/exitplanmode.js';
import type { ToolContextWithPermissionGate } from '../src/tools/exitplanmode.js';
import { enterWorktreeTool, peekWorktreeSession } from '../src/tools/enterworktree.js';
import { DEFAULT_MONITOR_TIMEOUT_MS, monitorTool } from '../src/tools/monitor.js';
import {
  addNamedWorktree,
  addWorktree,
  listWorktrees,
  removeWorktreeIfClean,
  repoToplevel,
  worktreeBranch,
} from '../src/internal/worktree.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];
let managers: ShellManager[] = [];
afterEach(() => {
  for (const m of managers) m.dispose();
  managers = [];
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
  tempDirs = [];
});

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: '/tmp',
    additionalDirectories: [],
    env: process.env as Record<string, string | undefined>,
    signal: new AbortController().signal,
    debug: () => {},
    ...overrides,
  };
}

function text(r: ToolResultPayload): string {
  return String(r.content);
}

/** A real throwaway git repo with one committed file (subagents.test.ts pattern). */
function makeGitRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'bpt-b4b-repo-'));
  tempDirs.push(repo);
  const git = (...args: string[]): void => {
    const r = spawnSync(
      'git',
      ['-c', 'user.email=t@test', '-c', 'user.name=t', ...args],
      { cwd: repo, encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  git('init', '-q');
  writeFileSync(join(repo, 'seed.txt'), 'seed\n');
  git('add', 'seed.txt');
  git('commit', '-q', '-m', 'seed');
  return repo;
}

function makeShells(): ShellManager {
  const m = createShellManager(() => {});
  managers.push(m);
  return m;
}

async function until(cond: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ---------------------------------------------------------------------------
// Registry: all three ship by default
// ---------------------------------------------------------------------------

describe('B4b registry', () => {
  it('registers Monitor, ExitPlanMode and EnterWorktree by default', () => {
    const tools = createBuiltinTools({ env: {} });
    expect(tools.has('Monitor')).toBe(true);
    expect(tools.has('ExitPlanMode')).toBe(true);
    expect(tools.has('EnterWorktree')).toBe(true);
  });

  it('permission posture: ExitPlanMode readOnly (callable in plan mode), the others not', () => {
    expect(exitPlanModeTool.readOnly).toBe(true);
    expect(monitorTool.readOnly).toBe(false);
    expect(enterWorktreeTool.readOnly).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ExitPlanMode
// ---------------------------------------------------------------------------

describe('ExitPlanMode', () => {
  function gateCtx(mode: 'plan' | 'default' = 'plan'): {
    ctx: ToolContext;
    gate: DefaultPermissionGate;
  } {
    const gate = new DefaultPermissionGate({ debug: () => {}, mode });
    const ctx = makeCtx() as ToolContextWithPermissionGate;
    ctx.permissionGate = gate;
    return { ctx, gate };
  }

  it('exits plan mode through the wired permission gate', async () => {
    const { ctx, gate } = gateCtx('plan');
    const r = await exitPlanModeTool.execute({}, ctx);
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain('plan -> default');
    expect(gate.getMode()).toBe('default');
  });

  it('errors when the session is not in plan mode (mode untouched)', async () => {
    const { ctx, gate } = gateCtx('default');
    const r = await exitPlanModeTool.execute({}, ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('not in plan mode');
    expect(text(r)).toContain('default');
    expect(gate.getMode()).toBe('default');
  });

  it('errors honestly when no permission gate is wired on the context', async () => {
    const r = await exitPlanModeTool.execute({}, makeCtx());
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('permission-mode controller');
    expect(text(r)).toContain('NOT');
  });

  it('echoes allowedPrompts and states they are NOT applied', async () => {
    const { ctx, gate } = gateCtx('plan');
    const r = await exitPlanModeTool.execute(
      { allowedPrompts: [{ tool: 'Bash', prompt: 'run the test suite' }] },
      ctx,
    );
    expect(r.isError).toBeUndefined();
    expect(gate.getMode()).toBe('default');
    expect(text(r)).toContain('NOT applied');
    expect(text(r)).toContain('run the test suite');
  });

  it('validates allowedPrompts shape (tool literal + non-empty prompt)', async () => {
    const { ctx, gate } = gateCtx('plan');
    const bad = [
      { allowedPrompts: 'x' },
      { allowedPrompts: [{ tool: 'Write', prompt: 'p' }] },
      { allowedPrompts: [{ tool: 'Bash', prompt: '' }] },
      { allowedPrompts: [null] },
    ];
    for (const input of bad) {
      const r = await exitPlanModeTool.execute(input as Record<string, unknown>, ctx);
      expect(r.isError, JSON.stringify(input)).toBe(true);
    }
    // Invalid input never flips the mode.
    expect(gate.getMode()).toBe('plan');
  });
});

// ---------------------------------------------------------------------------
// EnterWorktree
// ---------------------------------------------------------------------------

describe('EnterWorktree', () => {
  it('creates a named worktree under .claude/worktrees/ and switches ctx.cwd', async () => {
    const repo = makeGitRepo();
    const ctx = makeCtx({ cwd: repo, readFilePaths: new Set() });
    const r = await enterWorktreeTool.execute({ name: 'feature-x' }, ctx);
    expect(r.isError, text(r)).toBeUndefined();
    const dir = join(repo, '.claude', 'worktrees', 'feature-x');
    expect(text(r)).toContain(`worktreePath: ${dir}`);
    expect(text(r)).toContain('worktreeBranch: feature-x');
    expect(ctx.cwd).toBe(dir);
    expect(existsSync(join(dir, 'seed.txt'))).toBe(true);
    // Registered with git, on the named branch.
    const listed = await listWorktrees(repo);
    expect('paths' in listed && listed.paths).toContain(dir);
    expect(await worktreeBranch(dir)).toBe('feature-x');
    // Session state tracked.
    expect(peekWorktreeSession(ctx)).toMatchObject({
      originalCwd: repo,
      dir,
      branch: 'feature-x',
      createdByThisSession: true,
    });
  });

  it('generates a random name when none is given', async () => {
    const repo = makeGitRepo();
    const ctx = makeCtx({ cwd: repo, readFilePaths: new Set() });
    const r = await enterWorktreeTool.execute({}, ctx);
    expect(r.isError, text(r)).toBeUndefined();
    expect(ctx.cwd).toContain(join(repo, '.claude', 'worktrees'));
    expect(text(r)).toMatch(/worktreeBranch: wt-[0-9a-f]{8}/);
  });

  it('rewrites the Bash persistent-state cwd snapshot when shells are wired', async () => {
    const repo = makeGitRepo();
    const shells = makeShells();
    const ctx = makeCtx({ cwd: repo, readFilePaths: new Set(), shells });
    const r = await enterWorktreeTool.execute({ name: 'wt-bash' }, ctx);
    expect(r.isError, text(r)).toBeUndefined();
    expect(shells.stateDir).not.toBe('');
    expect(readFileSync(join(shells.stateDir, 'cwd'), 'utf8')).toBe(ctx.cwd);
  });

  it('rejects creating a second worktree while already in a worktree session', async () => {
    const repo = makeGitRepo();
    const ctx = makeCtx({ cwd: repo, readFilePaths: new Set() });
    await enterWorktreeTool.execute({ name: 'first' }, ctx);
    const r = await enterWorktreeTool.execute({ name: 'second' }, ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('already in a worktree session');
  });

  it('switches into an existing registered worktree via path', async () => {
    const repo = makeGitRepo();
    // Register a worktree outside the tool (plain `git worktree add`).
    const wt = mkdtempSync(join(tmpdir(), 'bpt-b4b-wt-'));
    tempDirs.push(wt);
    rmSync(wt, { recursive: true, force: true }); // git wants to create it
    const add = spawnSync('git', ['worktree', 'add', '--detach', wt], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(add.status, add.stderr).toBe(0);

    const ctx = makeCtx({ cwd: repo, readFilePaths: new Set() });
    const r = await enterWorktreeTool.execute({ path: wt }, ctx);
    expect(r.isError, text(r)).toBeUndefined();
    expect(ctx.cwd).toBe(wt);
    expect(text(r)).toContain('Entered existing worktree');
    expect(peekWorktreeSession(ctx)?.createdByThisSession).toBe(false);
  });

  it('rejects a path that is not a registered worktree, and the main checkout', async () => {
    const repo = makeGitRepo();
    const stranger = mkdtempSync(join(tmpdir(), 'bpt-b4b-stranger-'));
    tempDirs.push(stranger);
    const ctx = makeCtx({ cwd: repo, readFilePaths: new Set() });
    const r1 = await enterWorktreeTool.execute({ path: stranger }, ctx);
    expect(r1.isError).toBe(true);
    expect(text(r1)).toContain('not a registered worktree');
    const r2 = await enterWorktreeTool.execute({ path: repo }, ctx);
    expect(r2.isError).toBe(true);
    expect(text(r2)).toContain('main repository checkout');
    expect(ctx.cwd).toBe(repo); // cwd untouched on failure
  });

  it('validates inputs: mutual exclusion, bad name, non-repo cwd', async () => {
    const repo = makeGitRepo();
    const ctx = makeCtx({ cwd: repo, readFilePaths: new Set() });
    const both = await enterWorktreeTool.execute({ name: 'a', path: '/x' }, ctx);
    expect(both.isError).toBe(true);
    expect(text(both)).toContain('mutually exclusive');
    const badName = await enterWorktreeTool.execute({ name: '../evil' }, ctx);
    expect(badName.isError).toBe(true);
    expect(text(badName)).toContain('invalid worktree name');

    const plain = mkdtempSync(join(tmpdir(), 'bpt-b4b-plain-'));
    tempDirs.push(plain);
    const ctxPlain = makeCtx({ cwd: plain, readFilePaths: new Set() });
    const notRepo = await enterWorktreeTool.execute({}, ctxPlain);
    expect(notRepo.isError).toBe(true);
    expect(text(notRepo)).toContain('not inside a git repository');
  });
});

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

describe('Monitor', () => {
  it('starts a background watch and reports taskId / timeoutMs / BashOutput handoff', async () => {
    const shells = makeShells();
    const ctx = makeCtx({ cwd: tmpdir(), shells });
    const r = await monitorTool.execute(
      { command: "printf 'evt-1\\nevt-2\\n'", description: 'two events' },
      ctx,
    );
    expect(r.isError, text(r)).toBeUndefined();
    const id = /taskId: (bash_\d+)/.exec(text(r))?.[1];
    expect(id).toBeTruthy();
    expect(text(r)).toContain(`timeoutMs: ${DEFAULT_MONITOR_TIMEOUT_MS}`);
    expect(text(r)).toContain('BashOutput');
    expect(text(r)).toContain('KillShell');
    // Events accumulate on the registered background shell.
    await until(() => shells.get(id!)?.stdout.includes('evt-2') === true);
    expect(shells.get(id!)!.stdout).toContain('evt-1');
  });

  it('kills a non-persistent watch when timeout_ms elapses', async () => {
    const shells = makeShells();
    const ctx = makeCtx({ cwd: tmpdir(), shells });
    const r = await monitorTool.execute(
      { command: 'sleep 30', description: 'stuck watch', timeout_ms: 150 },
      ctx,
    );
    expect(r.isError, text(r)).toBeUndefined();
    const id = /taskId: (bash_\d+)/.exec(text(r))![1]!;
    expect(shells.get(id)!.status).toBe('running');
    await until(() => shells.get(id)!.status === 'killed');
  });

  it('persistent: true disables the timeout (watch survives past timeout_ms)', async () => {
    const shells = makeShells();
    const ctx = makeCtx({ cwd: tmpdir(), shells });
    const r = await monitorTool.execute(
      { command: 'sleep 30', description: 'log tail', timeout_ms: 100, persistent: true },
      ctx,
    );
    expect(r.isError, text(r)).toBeUndefined();
    expect(text(r)).toContain('persistent: true');
    const id = /taskId: (bash_\d+)/.exec(text(r))![1]!;
    await new Promise((res) => setTimeout(res, 350));
    expect(shells.get(id)!.status).toBe('running');
    shells.kill(id);
  });

  it('rejects the unshipped ws source with an explicit error (and one-of violations)', async () => {
    const shells = makeShells();
    const ctx = makeCtx({ cwd: tmpdir(), shells });
    const ws = await monitorTool.execute(
      { ws: { url: 'wss://example.test' }, description: 'd' },
      ctx,
    );
    expect(ws.isError).toBe(true);
    expect(text(ws)).toContain('not supported');
    const both = await monitorTool.execute(
      { command: 'true', ws: { url: 'wss://x' }, description: 'd' },
      ctx,
    );
    expect(both.isError).toBe(true);
    expect(text(both)).toContain('exactly one');
  });

  it('validates command / description / timeout_ms and requires a shell manager', async () => {
    const shells = makeShells();
    const ctx = makeCtx({ cwd: tmpdir(), shells });
    for (const input of [
      { description: 'd' }, // no source at all
      { command: '', description: 'd' },
      { command: 'true', description: '' },
      { command: 'true' },
      { command: 'true', description: 'd', timeout_ms: -1 },
      { command: 'true', description: 'd', timeout_ms: 'soon' },
    ]) {
      const r = await monitorTool.execute(input as Record<string, unknown>, ctx);
      expect(r.isError, JSON.stringify(input)).toBe(true);
    }
    const noMgr = await monitorTool.execute(
      { command: 'true', description: 'd' },
      makeCtx(),
    );
    expect(noMgr.isError).toBe(true);
    expect(text(noMgr)).toContain('no shell manager');
  });
});

// ---------------------------------------------------------------------------
// Shared worktree helpers (src/internal/worktree.ts)
// ---------------------------------------------------------------------------

describe('internal/worktree helpers', () => {
  it('addWorktree creates a detached temp worktree; removeWorktreeIfClean removes it when clean', async () => {
    const repo = makeGitRepo();
    const wt = await addWorktree(repo);
    expect('dir' in wt, JSON.stringify(wt)).toBe(true);
    const dir = (wt as { dir: string }).dir;
    tempDirs.push(dir);
    expect(existsSync(join(dir, 'seed.txt'))).toBe(true);
    expect(await removeWorktreeIfClean(repo, dir)).toBe('removed');
    expect(existsSync(dir)).toBe(false);
  });

  it('removeWorktreeIfClean KEEPS a dirty worktree (never destroys work)', async () => {
    const repo = makeGitRepo();
    const wt = await addWorktree(repo);
    const dir = (wt as { dir: string }).dir;
    tempDirs.push(dir);
    writeFileSync(join(dir, 'untracked.txt'), 'dirty\n');
    expect(await removeWorktreeIfClean(repo, dir)).toBe('kept');
    expect(existsSync(join(dir, 'untracked.txt'))).toBe(true);
  });

  it('addWorktree fails honestly outside a git repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'bpt-b4b-nogit-'));
    tempDirs.push(plain);
    const wt = await addWorktree(plain);
    expect('error' in wt).toBe(true);
  });

  it('repoToplevel / addNamedWorktree / listWorktrees round-trip', async () => {
    const repo = makeGitRepo();
    const top = await repoToplevel(join(repo));
    expect('dir' in top && (top as { dir: string }).dir).toBe(repo);
    const created = await addNamedWorktree(repo, 'helper-wt');
    expect('dir' in created, JSON.stringify(created)).toBe(true);
    const dir = (created as { dir: string }).dir;
    expect(dir).toBe(join(repo, '.claude', 'worktrees', 'helper-wt'));
    const listed = await listWorktrees(repo);
    expect('paths' in listed && (listed as { paths: string[] }).paths).toContain(dir);
    // Duplicate name -> honest error (branch/dir already exists).
    const dup = await addNamedWorktree(repo, 'helper-wt');
    expect('error' in dup).toBe(true);
    // The worktrees dir is excluded from the main checkout's status (best-effort).
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
    expect(status.stdout).not.toContain('.claude');
  });
});
