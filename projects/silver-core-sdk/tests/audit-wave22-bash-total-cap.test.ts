/**
 * Keeper ruling 2026-07-29 (待裁③) — the Bash output cap is a TOTAL, not a
 * per-stream allowance.
 *
 * Both the constant's own doc and the EXPORTED `TOOL_OUTPUT_CAPS.bash` said
 * "max TOTAL characters one Bash call returns", but the implementation built
 * two independent CappedStream instances, each bounded at 30,000. Measured,
 * 50,000 bytes to each stream in one call returned 60,352 characters against a
 * stated cap of 30,000 — and that export exists precisely so a consumer can
 * mirror this engine's context accounting, so the error rode into the
 * consumer's ledger at 2x.
 *
 * Resolved toward the documented semantics on the keeper's ruling ("align with
 * official Claude Code"): the official prompt corpus states the contract to the
 * model as ONE quantity — "Bash output is limited to ${MAX_OUTPUT_CHARS} chars"
 * — with no per-stream language anywhere in it.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bashTool } from '../src/tools/bash.js';
import { TOOL_OUTPUT_CAPS } from '../src/tools/output-caps.js';
import type { ToolContext } from '../src/internal/contracts.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bpt-w22-bash-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function ctx(): ToolContext {
  return {
    cwd: dir,
    env: process.env,
    signal: new AbortController().signal,
    debug: () => {},
  } as unknown as ToolContext;
}

async function run(command: string) {
  const res = await bashTool.execute({ command }, ctx());
  const so = (
    res as { structuredOutput?: { stdout: string; stderr: string; truncated: boolean } }
  ).structuredOutput!;
  return { res, so, payload: typeof res.content === 'string' ? res.content : '' };
}

/** Command output only: the one-line truncation marker is metadata about the
 *  cut, added after the trim (documented on STREAM_CAP_CHARS). */
function outputChars(so: { stdout: string; stderr: string }): number {
  const marker = /^\[\d+ earlier chars dropped:[^\]]*\]\n/;
  return (
    so.stdout.replace(marker, '').length + so.stderr.replace(marker, '').length
  );
}

const flood = (n: number, ch: string, toStderr = false) =>
  `head -c ${n} /dev/zero | tr '\\0' '${ch}'${toStderr ? ' 1>&2' : ''}`;

describe('wave22: the Bash cap is one shared total', () => {
  it('both streams flooded stay within ONE allowance (was: double it)', async () => {
    const { so } = await run(`${flood(50000, 'a')}; ${flood(50000, 'b', true)}`);
    expect(outputChars(so)).toBe(TOOL_OUTPUT_CAPS.bash);
    expect(so.truncated).toBe(true);
  });

  it('the tail is what survives, across the pair', async () => {
    // stdout is the earliest output, so it is dropped first and the allowance
    // goes to stderr's tail.
    const { so } = await run(`${flood(50000, 'a')}; ${flood(50000, 'b', true)}`);
    expect(so.stdout).toBe('');
    expect(so.stderr.endsWith('b'.repeat(100))).toBe(true);
  });

  it('exactly ONE marker per call, reporting the call total', async () => {
    const { payload } = await run(`${flood(50000, 'a')}; ${flood(50000, 'b', true)}`);
    const markers = payload.match(/\[\d+ earlier chars dropped:/g) ?? [];
    expect(markers).toHaveLength(1);
    // 100,000 produced, 30,000 kept.
    expect(payload).toContain('[70000 earlier chars dropped:');
  });

  // --- negative controls -----------------------------------------------------

  it('a single stream under the cap is untouched and not flagged', async () => {
    const { so, payload } = await run(flood(1000, 'a'));
    expect(so.truncated).toBe(false);
    expect(payload).not.toContain('earlier chars dropped');
    expect(so.stdout.length).toBe(1000);
  });

  it('the two streams still render separately when both fit', async () => {
    const { payload } = await run(`${flood(10, 'a')}; ${flood(10, 'b', true)}`);
    expect(payload).toBe(`${'a'.repeat(10)}\n[stderr]\n${'b'.repeat(10)}`);
  });

  it('a single-stream flood still tail-keeps exactly the cap', async () => {
    const { so } = await run(flood(50000, 'a'));
    expect(outputChars(so)).toBe(TOOL_OUTPUT_CAPS.bash);
    expect(so.stdout.endsWith('a'.repeat(100))).toBe(true);
  });

  it('the pair right at the cap is not truncated', async () => {
    const half = TOOL_OUTPUT_CAPS.bash / 2;
    const { so } = await run(`${flood(half, 'a')}; ${flood(half, 'b', true)}`);
    expect(so.truncated).toBe(false);
    expect(outputChars(so)).toBe(TOOL_OUTPUT_CAPS.bash);
  });
});
