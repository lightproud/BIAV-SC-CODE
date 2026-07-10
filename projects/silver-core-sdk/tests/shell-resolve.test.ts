/**
 * POSIX shell resolution (2026-07-05 BPT Windows pilot incident: `spawn sh
 * ENOENT` - the Bash tool was unusable on the engine-swap's primary target
 * platform). Platform and fs probe are injected so every Windows path is
 * unit-testable from any host.
 */

import { describe, expect, it } from 'vitest';
import { resolvePosixShells, SHELL_NOT_FOUND_GUIDANCE } from '../src/tools/shell-resolve.js';

const WIN_ENV = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\light\\AppData\\Local',
};

describe('resolvePosixShells', () => {
  it('non-Windows keeps the historical bash -> sh chain', () => {
    expect(resolvePosixShells({}, 'linux')).toEqual(['bash', 'sh']);
    expect(resolvePosixShells({}, 'darwin')).toEqual(['bash', 'sh']);
  });

  it('CLAUDE_CODE_GIT_BASH_PATH is prepended on any platform (official-compatible knob)', () => {
    expect(resolvePosixShells({ CLAUDE_CODE_GIT_BASH_PATH: '/opt/gitbash/bash.exe' }, 'linux'))
      .toEqual(['/opt/gitbash/bash.exe', 'bash', 'sh']);
    const win = resolvePosixShells(
      { ...WIN_ENV, CLAUDE_CODE_GIT_BASH_PATH: 'D:\\tools\\bash.exe' },
      'win32',
      () => false,
    );
    expect(win).toEqual(['D:\\tools\\bash.exe']);
  });

  it('Windows probes Git Bash standard locations in order and keeps the hits', () => {
    const gitBin = 'C:\\Program Files\\Git\\bin\\bash.exe';
    const gitUsrBin = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe';
    const hits = new Set([gitBin, gitUsrBin]);
    const shells = resolvePosixShells(WIN_ENV, 'win32', (p) => hits.has(p));
    expect(shells).toEqual([gitBin, gitUsrBin]);
  });

  it('Windows finds a per-user (LocalAppData) Git install', () => {
    const userBash = 'C:\\Users\\light\\AppData\\Local\\Programs\\Git\\bin\\bash.exe';
    const shells = resolvePosixShells(WIN_ENV, 'win32', (p) => p === userBash);
    expect(shells).toEqual([userBash]);
  });

  it('Windows with no Git Bash resolves to an EMPTY list - never the bare names (WSL trap)', () => {
    const shells = resolvePosixShells(WIN_ENV, 'win32', () => false);
    expect(shells).toEqual([]);
    expect(shells).not.toContain('bash');
    expect(shells).not.toContain('sh');
  });

  it('the guidance message names both remedies', () => {
    expect(SHELL_NOT_FOUND_GUIDANCE).toContain('Git for Windows');
    expect(SHELL_NOT_FOUND_GUIDANCE).toContain('CLAUDE_CODE_GIT_BASH_PATH');
  });
});
