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
import { homedir, platform as osPlatform, release, type as osType } from 'node:os';
import { dirname, join, parse as parsePath } from 'node:path';

import { resolveSettingSources } from '../internal/setting-sources.js';
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
    // audit r4 Z8-3: os.type() yields the capitalized OS name ('Linux 6.x',
    // matching the official <env> reproduction) where os.platform() lowercased
    // it ('linux'). The `platform:` line above stays lowercase by design.
    osVersion: safe(() => `${osType()} ${release()}`),
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
 * Load codebase instructions per the effective `settingSources`. Omitted
 * settingSources resolves to load-all (bump-pin ruling), so an absent field
 * loads user+project+local; an explicit `[]` loads nothing. 'project'/'local'
 * walk up from cwd collecting CLAUDE.md/AGENTS.md (root-most first, so the most
 * specific file lands last); 'user' reads ~/.claude/CLAUDE.md. Returns '' when
 * no sources are effective or nothing is found. Total size is capped.
 */
export function loadProjectInstructions(
  cwd: string,
  sources: SettingSource[] | undefined,
): string {
  const effective = resolveSettingSources(sources);
  if (effective.length === 0) return '';
  const parts: string[] = [];
  if (effective.includes('user')) {
    const userFile = join(homedir(), '.claude', 'CLAUDE.md');
    const txt = readIfFile(userFile);
    if (txt) parts.push(`# ${userFile}\n\n${txt}`);
  }
  if (effective.includes('project') || effective.includes('local')) {
    for (const file of walkUpInstructionFiles(cwd)) {
      const txt = readIfFile(file);
      if (txt) parts.push(`# ${file}\n\n${txt}`);
    }
  }
  const joined = parts.join('\n\n');
  if (Buffer.byteLength(joined, 'utf8') <= PROJECT_INSTRUCTIONS_CAP) return joined;
  // Over cap. Two fixes over the old `joined.slice(0, CAP)`:
  //  - The cap counts BYTES (its documented unit): the UTF-16 code-unit slice
  //    let CJK-heavy instructions run ~3x over the cap and could cut a
  //    surrogate pair in half.
  //  - Keep the MOST SPECIFIC instructions: parts are ordered root-most ->
  //    nearest-cwd, and head-slicing kept the least specific files while
  //    dropping the nearest-cwd CLAUDE.md. Drop root-ward parts first.
  const marker = '[...truncated: earlier instruction files omitted to fit the cap]';
  const budget = PROJECT_INSTRUCTIONS_CAP - Buffer.byteLength(`${marker}\n\n`, 'utf8');
  const kept: string[] = [];
  let used = 0;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i] as string;
    const size = Buffer.byteLength(part, 'utf8') + (kept.length > 0 ? 2 : 0);
    if (used + size > budget) {
      if (kept.length === 0) {
        // Even the single most specific part exceeds the cap: keep its head.
        kept.unshift(truncateUtf8(part, budget));
      }
      break;
    }
    kept.unshift(part);
    used += size;
  }
  return `${marker}\n\n${kept.join('\n\n')}`;
}

/** Truncate to at most `maxBytes` of UTF-8 without splitting a multi-byte
 *  sequence (a raw byte cut mid-sequence decodes to U+FFFD mojibake). */
function truncateUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  let end = Math.max(0, maxBytes);
  let i = end - 1;
  while (i >= 0 && ((buf[i] as number) & 0xc0) === 0x80) i -= 1;
  if (i >= 0) {
    const lead = buf[i] as number;
    const seqLen = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
    if (i + seqLen > end) end = i; // drop the incomplete tail sequence
  }
  return buf.subarray(0, end).toString('utf8');
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
