/**
 * ToolContext builders for tool tests — the shared shape.
 *
 * `makeCtx` had 22 definitions across tests/ in 12 shapes. Two conventions
 * dominated and are both kept here, because they differ in call style rather
 * than in what they build:
 *
 *   toolContext({ ... })       — cwd defaults to tmpdir(); overrides last
 *   toolContextIn(cwd, { ... }) — cwd is the first argument
 *
 * Suites whose context genuinely differs (a real process env, a pre-armed
 * read-gate, a sandbox backend) pass that as an override instead of pasting a
 * ninth near-copy.
 */

import { tmpdir } from 'node:os';

import type { ToolContext } from '../../src/internal/contracts.js';

/** Tool context rooted at tmpdir(); `overrides` wins over every default. */
export function toolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: tmpdir(),
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
    ...overrides,
  };
}

/** Tool context rooted at an explicit cwd (the fs/exec suites' convention). */
export function toolContextIn(cwd: string, extra: Partial<ToolContext> = {}): ToolContext {
  return toolContext({ cwd, ...extra });
}

/** A context whose read-before-write gate is armed and already unlocks `abs`. */
export function gatedToolContext(
  cwd: string,
  abs: string,
  extra: Partial<ToolContext> = {},
): ToolContext {
  return toolContextIn(cwd, { readFilePaths: new Set([abs]), ...extra });
}
