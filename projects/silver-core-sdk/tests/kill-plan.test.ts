/**
 * Background-shell kill planning + honest terminal status (2026-07-05 BPT
 * Windows pilot incident #3: KillShell was a silent no-op that reported
 * 'killed' forever even when the process ran to completion). Both decisions
 * are pure functions so the Windows branch is testable on Linux CI.
 */

import { describe, expect, it } from 'vitest';
import { planProcessKill, terminalStatus } from '../src/tools/kill-plan.js';

describe('planProcessKill', () => {
  it('POSIX signals the whole process group (-pid)', () => {
    expect(planProcessKill(1234, 'SIGTERM', 'linux')).toEqual({ kind: 'group', pid: 1234, signal: 'SIGTERM' });
    expect(planProcessKill(1234, 'SIGKILL', 'darwin')).toEqual({ kind: 'group', pid: 1234, signal: 'SIGKILL' });
  });

  it('Windows uses taskkill /T /F (no POSIX groups/signals there)', () => {
    expect(planProcessKill(1234, 'SIGTERM', 'win32')).toEqual({ kind: 'taskkill', pid: 1234 });
    // The signal is irrelevant on Windows - taskkill /F is one forcible pass.
    expect(planProcessKill(1234, 'SIGKILL', 'win32')).toEqual({ kind: 'taskkill', pid: 1234 });
  });

  it('no pid falls back to a direct child.kill on any platform', () => {
    expect(planProcessKill(undefined, 'SIGTERM', 'linux')).toEqual({ kind: 'child', signal: 'SIGTERM' });
    expect(planProcessKill(undefined, 'SIGKILL', 'win32')).toEqual({ kind: 'child', signal: 'SIGKILL' });
  });
});

describe('terminalStatus (the honesty fix)', () => {
  it('kill requested + signal death (code null) -> killed', () => {
    expect(terminalStatus(true, null)).toBe('killed'); // POSIX SIGTERM/SIGKILL
  });
  it('kill requested + forced nonzero (Windows taskkill /F) -> killed', () => {
    expect(terminalStatus(true, 1)).toBe('killed');
  });
  it('kill requested BUT process exited 0 first -> completed (NOT a false killed)', () => {
    // The exact BPT-reported lie: the 20-loop job finished (exit 0) yet was
    // marked killed. Honesty: it completed its work.
    expect(terminalStatus(true, 0)).toBe('completed');
  });
  it('no kill + exit 0 -> completed', () => {
    expect(terminalStatus(false, 0)).toBe('completed');
  });
  it('no kill + nonzero -> failed', () => {
    expect(terminalStatus(false, 2)).toBe('failed');
  });
  it('no kill + signal crash (code null) -> failed, not killed', () => {
    // A SIGSEGV crash we did not request is a failure, not a kill.
    expect(terminalStatus(false, null)).toBe('failed');
  });
});
