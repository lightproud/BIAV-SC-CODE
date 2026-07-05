/**
 * Runtime-assembly context gathering (open reproduction of the official Claude
 * Code runtime prompt): the `<env>` facts and the CLAUDE.md / AGENTS.md
 * codebase instructions. Kept in its own import-only module because it performs
 * I/O (clock, os, git, filesystem) that the pure prompts.ts must not.
 *
 * Failures are swallowed to a partial/empty result: a missing git binary, an
 * unreadable directory, or a non-repo cwd must never break query construction.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir, platform as osPlatform, release } from 'node:os';
import { dirname, join, parse as parsePath } from 'node:path';

import type { EnvironmentContext } from './prompts.js';
import type { SettingSource } from '../types.js';

/** Total cap on injected CLAUDE.md/AGENTS.md text (bytes), to bound the prompt. */
const PROJECT_INSTRUCTIONS_CAP = 32_768;
const INSTRUCTION_FILENAMES = ['CLAUDE.md', 'AGENTS.md'];

/**
 * Gather the `<env>` runtime facts. `date` is the caller-supplied ISO day (so
 * the pure prompt stays deterministic in tests); everything else is probed
 * here. Git probing runs a short, sandboxed `git` and degrades to
 * isGitRepo:false if git is absent or cwd is not a repo.
 */
export function gatherEnvironment(
  cwd: string,
  model: string,
  date: string,
): EnvironmentContext {
  const env: EnvironmentContext = {
    platform: safe(() => osPlatform()),
    osVersion: safe(() => `${osPlatform()} ${release()}`),
    date,
    model,
    isGitRepo: false,
  };
  const isRepo = safe(() =>
    git(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true',
  );
  if (isRepo) {
    env.isGitRepo = true;
    const branch = safe(() => git(cwd, ['branch', '--show-current']));
    if (branch) env.gitBranch = branch;
  }
  return env;
}

/**
 * Load codebase instructions per `settingSources`. 'project'/'local' walk up
 * from cwd collecting CLAUDE.md/AGENTS.md (root-most first, so the most
 * specific file lands last); 'user' reads ~/.claude/CLAUDE.md. Returns '' when
 * no sources are requested or nothing is found. Total size is capped.
 */
export function loadProjectInstructions(
  cwd: string,
  sources: SettingSource[] | undefined,
): string {
  if (!sources || sources.length === 0) return '';
  const parts: string[] = [];
  if (sources.includes('user')) {
    const userFile = join(homedir(), '.claude', 'CLAUDE.md');
    const txt = readIfFile(userFile);
    if (txt) parts.push(`# ${userFile}\n\n${txt}`);
  }
  if (sources.includes('project') || sources.includes('local')) {
    for (const file of walkUpInstructionFiles(cwd)) {
      const txt = readIfFile(file);
      if (txt) parts.push(`# ${file}\n\n${txt}`);
    }
  }
  const joined = parts.join('\n\n');
  return joined.length > PROJECT_INSTRUCTIONS_CAP
    ? `${joined.slice(0, PROJECT_INSTRUCTIONS_CAP)}\n\n[...truncated]`
    : joined;
}

/** Instruction files from the filesystem root down to cwd (most specific last). */
function walkUpInstructionFiles(cwd: string): string[] {
  const dirs: string[] = [];
  let dir = cwd;
  const root = parsePath(cwd).root;
  // Bound the walk so a deep tree cannot spin; 64 levels is far beyond real repos.
  for (let i = 0; i < 64; i++) {
    dirs.push(dir);
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dirs.reverse(); // root-most first
  const files: string[] = [];
  for (const d of dirs) {
    for (const name of INSTRUCTION_FILENAMES) {
      const p = join(d, name);
      if (existsSync(p)) files.push(p);
    }
  }
  return files;
}

function readIfFile(p: string): string | undefined {
  try {
    if (!existsSync(p) || !statSync(p).isFile()) return undefined;
    const txt = readFileSync(p, 'utf8').trim();
    return txt.length > 0 ? txt : undefined;
  } catch {
    return undefined;
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 2_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
