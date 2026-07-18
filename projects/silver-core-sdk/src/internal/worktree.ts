/**
 * Shared git-worktree helpers (B4b batch).
 *
 * Extracted so BOTH the subagent runtime (Agent tool `isolation: 'worktree'`,
 * E7-02) and the EnterWorktree built-in tool use one implementation of the
 * git plumbing. `addWorktree` / `removeWorktreeIfClean` reproduce the
 * runtime's helpers byte-for-byte in semantics (same temp-dir prefix, same
 * detached add, same keep-on-dirty / keep-on-error posture); the runtime's
 * own copies in src/subagents/runtime.ts are to be switched to import from
 * here in a follow-up wiring pass (that file is out of this batch's scope).
 *
 * The EnterWorktree-specific helpers (`repoToplevel`, `addNamedWorktree`,
 * `listWorktrees`, `worktreeBranch`) implement the official tool's behavior:
 * a NAMED worktree inside `<repo>/.claude/worktrees/` on a new branch, or
 * validated entry into an already-registered worktree of the same repository.
 * All helpers fail honestly (error string / thrown-free result shapes), never
 * silently.
 */

import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * Worktree isolation (Agent tool `isolation: 'worktree'`, E7-02): create a
 * temporary DETACHED git worktree of the repository at `repoCwd` for a child
 * to use as its cwd. mkdtemp yields an empty dir, which `git worktree add`
 * accepts as a target. Fails honestly (error string, temp dir removed) when
 * git is unavailable or `repoCwd` is not inside a git repository.
 */
export async function addWorktree(
  repoCwd: string,
): Promise<{ dir: string; baseHead?: string } | { error: string }> {
  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), 'bpt-subagent-worktree-'));
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  try {
    await execFileP('git', ['worktree', 'add', '--detach', dir], { cwd: repoCwd });
    // Record the HEAD the child STARTED from, so cleanup can tell whether the
    // child committed (HEAD moved) and must be preserved — a detached worktree's
    // commits become unreferenced the moment the worktree is removed.
    let baseHead: string | undefined;
    try {
      const { stdout } = await execFileP('git', ['-C', dir, 'rev-parse', 'HEAD']);
      baseHead = stdout.trim() || undefined;
    } catch {
      baseHead = undefined; // no HEAD probe -> cleanup treats any commit as "kept"
    }
    return baseHead !== undefined ? { dir, baseHead } : { dir };
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Remove a temporary DETACHED worktree IF the child left NO work behind:
 * an empty `git status --porcelain` (nothing modified/staged/untracked) AND
 * HEAD still at `baseHead` (nothing committed). A dirty tree OR a moved HEAD is
 * KEPT — never destroy child work, committed or not, since a detached
 * worktree's commits go unreferenced (and are eventually gc'd) the instant the
 * worktree is removed. Any git failure also keeps it (fail-safe toward
 * preservation). When `baseHead` is unknown (the add-time probe failed) the
 * worktree is ALWAYS kept: without the starting HEAD there is no way to prove
 * the child did not commit, and a clean `git status` says nothing (commits
 * don't show in porcelain), so removal could orphan real work — preservation
 * wins over reclaiming a temp dir (audit 2026-07-17 P2; the prior form skipped
 * the moved-HEAD check entirely and removed any clean worktree whenever
 * baseHead was unknown, silently discarding a committed child's work). The
 * caller logs a 'kept' outcome.
 */
export async function removeWorktreeIfClean(
  repoCwd: string,
  dir: string,
  baseHead?: string,
): Promise<'removed' | 'kept'> {
  // No known starting HEAD -> cannot verify the child left no commits -> keep.
  if (baseHead === undefined) return 'kept';
  try {
    const { stdout } = await execFileP('git', ['-C', dir, 'status', '--porcelain']);
    if (stdout.trim().length > 0) return 'kept'; // uncommitted work
    // Committed work check: if HEAD moved past where the child started, the
    // worktree carries detached commits that removal would orphan — keep it.
    let head: string | undefined;
    try {
      const rp = await execFileP('git', ['-C', dir, 'rev-parse', 'HEAD']);
      head = rp.stdout.trim() || undefined;
    } catch {
      head = undefined;
    }
    if (head === undefined || head !== baseHead) return 'kept'; // committed / unreadable
    await execFileP('git', ['worktree', 'remove', dir], { cwd: repoCwd });
    return 'removed';
  } catch {
    return 'kept';
  }
}

// ---------------------------------------------------------------------------
// EnterWorktree-specific helpers
// ---------------------------------------------------------------------------

/** Directory (under the repo toplevel) that named worktrees are created in. */
export const WORKTREES_SUBDIR = join('.claude', 'worktrees');

/**
 * Resolve the repository toplevel for `cwd`, or an error when `cwd` is not
 * inside a git work tree (or git is unavailable).
 */
export async function repoToplevel(
  cwd: string,
): Promise<{ dir: string } | { error: string }> {
  try {
    const { stdout } = await execFileP('git', ['rev-parse', '--show-toplevel'], { cwd });
    const dir = stdout.trim();
    if (dir.length === 0) return { error: 'git rev-parse returned an empty toplevel' };
    return { dir };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * All worktree paths registered for the repository containing `cwd`
 * (`git worktree list --porcelain`, `worktree <path>` records — the main
 * checkout is included first).
 */
export async function listWorktrees(
  cwd: string,
): Promise<{ paths: string[] } | { error: string }> {
  try {
    const { stdout } = await execFileP('git', ['worktree', 'list', '--porcelain'], { cwd });
    const paths: string[] = [];
    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) paths.push(line.slice('worktree '.length).trim());
    }
    return { paths };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Current branch of the checkout at `dir`; undefined when detached. */
export async function worktreeBranch(dir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('git', ['-C', dir, 'branch', '--show-current']);
    const b = stdout.trim();
    return b.length > 0 ? b : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort: keep `.claude/worktrees/` out of `git status` of the main
 * checkout by adding it to `$GIT_COMMON_DIR/info/exclude` (a local, never
 * committed ignore file). Failures are swallowed — this is cosmetic only.
 */
async function excludeWorktreesDir(repoRoot: string): Promise<void> {
  try {
    const { stdout } = await execFileP('git', ['rev-parse', '--git-common-dir'], {
      cwd: repoRoot,
    });
    const gitDir = stdout.trim();
    if (gitDir.length === 0) return;
    const abs = isAbsolute(gitDir) ? gitDir : resolve(repoRoot, gitDir);
    const excludeFile = join(abs, 'info', 'exclude');
    const line = '.claude/worktrees/';
    const current = await readFile(excludeFile, 'utf8').catch(() => '');
    if (current.split('\n').some((l) => l.trim() === line)) return;
    await mkdir(join(abs, 'info'), { recursive: true });
    await appendFile(excludeFile, (current.endsWith('\n') || current === '' ? '' : '\n') + line + '\n');
  } catch {
    /* best-effort */
  }
}

/**
 * Create a NAMED worktree at `<repoRoot>/.claude/worktrees/<name>` on a new
 * branch `<name>`, branched from the current local HEAD. Fails honestly when
 * the target directory or the branch already exists (git's own error text is
 * surfaced). On success the worktrees dir is best-effort added to the repo's
 * local ignore file so the main checkout's `git status` stays clean.
 */
export async function addNamedWorktree(
  repoRoot: string,
  name: string,
): Promise<{ dir: string; branch: string } | { error: string }> {
  const dir = join(repoRoot, WORKTREES_SUBDIR, name);
  try {
    await mkdir(join(repoRoot, WORKTREES_SUBDIR), { recursive: true });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  try {
    await execFileP('git', ['worktree', 'add', '-b', name, dir], { cwd: repoRoot });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  await excludeWorktreesDir(repoRoot);
  return { dir, branch: name };
}
