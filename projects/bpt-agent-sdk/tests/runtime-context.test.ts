/**
 * Runtime-assembly context gathering: the <env> facts and CLAUDE.md/AGENTS.md
 * loading behind settingSources. Exercises real fs/os/git probing in temp dirs.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  gatherEnvironment,
  loadProjectInstructions,
} from '../src/engine/runtime-context.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rtctx-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('gatherEnvironment', () => {
  it('reports platform, os, the supplied date, model, and non-repo by default', () => {
    const env = gatherEnvironment(dir, 'claude-haiku-4-5-20251001', '2026-07-05');
    expect(env.platform).toBeTruthy();
    expect(env.osVersion).toBeTruthy();
    expect(env.date).toBe('2026-07-05');
    expect(env.model).toBe('claude-haiku-4-5-20251001');
    expect(env.isGitRepo).toBe(false);
    expect(env.gitBranch).toBeUndefined();
  });

  it('detects a git repo and its branch when cwd is inside one', () => {
    // Skip gracefully if git is unavailable in the environment.
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' });
    } catch {
      return;
    }
    const run = (...args: string[]) =>
      execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    run('init', '-b', 'trunk');
    run('config', 'user.email', 't@t.t');
    run('config', 'user.name', 't');
    const env = gatherEnvironment(dir, 'm', '2026-07-05');
    expect(env.isGitRepo).toBe(true);
    expect(env.gitBranch).toBe('trunk');
  });
});

describe('loadProjectInstructions', () => {
  it('returns empty when no settingSources are requested', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), 'Do the thing.');
    expect(loadProjectInstructions(dir, undefined)).toBe('');
    expect(loadProjectInstructions(dir, [])).toBe('');
  });

  it('loads CLAUDE.md from cwd when project is requested', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), 'Always use tabs.');
    const out = loadProjectInstructions(dir, ['project']);
    expect(out).toContain('Always use tabs.');
    expect(out).toContain('CLAUDE.md');
  });

  it('collects ancestor CLAUDE.md files, most specific last', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), 'ROOT_RULE');
    const sub = join(dir, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'CLAUDE.md'), 'LEAF_RULE');
    const out = loadProjectInstructions(sub, ['project']);
    expect(out).toContain('ROOT_RULE');
    expect(out).toContain('LEAF_RULE');
    expect(out.indexOf('ROOT_RULE')).toBeLessThan(out.indexOf('LEAF_RULE'));
  });

  it('also picks up AGENTS.md', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'AGENT_RULE');
    expect(loadProjectInstructions(dir, ['local'])).toContain('AGENT_RULE');
  });
});
