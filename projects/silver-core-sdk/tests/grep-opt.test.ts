/**
 * OPT-1 (count/files_with_matches complete by default + honest truncation) and
 * OPT-5 (full-scan telemetry signal) for the Grep tool. 2026-07-07.
 *
 * Before: every mode shared a flat DEFAULT_HEAD_LIMIT=250, so a `count` over a
 * repo with >250 matching files silently reported the first 250 — a WRONG
 * number with no indication. After: count/files_with_matches default to
 * complete (one small entry per file); content keeps the 250 flood guard; any
 * cap-induced truncation is announced; and a debug line reports scan coverage.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { grepTool } from '../src/tools/grep.js';
import { AbortError } from '../src/errors.js';
import type { ToolContext } from '../src/internal/contracts.js';

let sandboxes: string[] = [];
async function makeCorpus(nFiles: number, needleEvery = 1): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'grep-opt-'));
  sandboxes.push(dir);
  for (let i = 0; i < nFiles; i++) {
    if (i % 100 === 0) await mkdir(path.join(dir, `d${Math.floor(i / 100)}`), { recursive: true });
    const body = i % needleEvery === 0 ? 'alpha\nNEEDLE here\nbeta\n' : 'alpha\nbeta\ngamma\n';
    await writeFile(path.join(dir, `d${Math.floor(i / 100)}`, `f${i}.txt`), body);
  }
  return dir;
}
afterEach(async () => {
  await Promise.all(sandboxes.map((d) => rm(d, { recursive: true, force: true })));
  sandboxes = [];
});

function makeCtx(cwd: string, onDebug?: (m: string) => void): ToolContext {
  return {
    cwd,
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: onDebug ?? (() => {}),
  };
}
function contentOf(res: { content: unknown }): string {
  return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
}

describe('OPT-1: count / files_with_matches are complete by default', () => {
  it('count over >250 matching files reports ALL of them, not the first 250', async () => {
    const dir = await makeCorpus(300);
    const c = contentOf(await grepTool.execute({ pattern: 'NEEDLE', path: dir, output_mode: 'count' }, makeCtx(dir)));
    const lines = c.split('\n').filter((l) => /:\d+$/.test(l));
    expect(lines).toHaveLength(300); // complete, not capped at 250
    expect(c).not.toContain('truncated'); // complete -> no footer
  });

  it('files_with_matches over >250 files lists all of them', async () => {
    const dir = await makeCorpus(300);
    const c = contentOf(
      await grepTool.execute({ pattern: 'NEEDLE', path: dir, output_mode: 'files_with_matches' }, makeCtx(dir)),
    );
    expect(c.split('\n').filter((l) => l.endsWith('.txt'))).toHaveLength(300);
    expect(c).not.toContain('truncated');
  });

  it('an explicit head_limit still bounds count, and announces the truncation', async () => {
    const dir = await makeCorpus(300);
    const c = contentOf(
      await grepTool.execute({ pattern: 'NEEDLE', path: dir, output_mode: 'count', head_limit: 10 }, makeCtx(dir)),
    );
    expect(c.split('\n').filter((l) => /:\d+$/.test(l))).toHaveLength(10);
    expect(c).toContain('truncated at head_limit=10');
    expect(c).toContain('head_limit=0 for the complete result');
  });
});

describe('OPT-1: content mode keeps the 250 flood guard + honest footer', () => {
  it('content over a large match set caps at 250 lines and announces it', async () => {
    const dir = await makeCorpus(300);
    const c = contentOf(await grepTool.execute({ pattern: 'NEEDLE', path: dir, output_mode: 'content' }, makeCtx(dir)));
    const bodyLines = c.split('\n').filter((l) => l.includes('NEEDLE'));
    expect(bodyLines.length).toBeLessThanOrEqual(250);
    expect(c).toContain('truncated at head_limit=250');
  });

  it('a small complete content result has no footer', async () => {
    const dir = await makeCorpus(5);
    const c = contentOf(await grepTool.execute({ pattern: 'NEEDLE', path: dir, output_mode: 'content' }, makeCtx(dir)));
    expect(c).not.toContain('truncated');
  });
});

describe('OPT-5: full-scan telemetry on the debug channel', () => {
  it('a complete count reports full_scan=true and files_scanned == files_total', async () => {
    const dir = await makeCorpus(300);
    const logs: string[] = [];
    await grepTool.execute({ pattern: 'NEEDLE', path: dir, output_mode: 'count' }, makeCtx(dir, (m) => logs.push(m)));
    const scan = logs.find((l) => l.startsWith('grep.scan'));
    expect(scan).toBeDefined();
    expect(scan).toContain('full_scan=true');
    expect(scan).toContain('early_stop=false');
    expect(scan).toMatch(/files_total=300 files_scanned=300/);
  });

  it('a capped content search reports full_scan=false / early_stop=true (did not scan the whole corpus)', async () => {
    const dir = await makeCorpus(300);
    const logs: string[] = [];
    await grepTool.execute(
      { pattern: 'NEEDLE', path: dir, output_mode: 'content', head_limit: 50 },
      makeCtx(dir, (m) => logs.push(m)),
    );
    const scan = logs.find((l) => l.startsWith('grep.scan'));
    expect(scan).toContain('full_scan=false');
    expect(scan).toContain('early_stop=true');
  });
});

describe('OPT: unchanged basics still hold', () => {
  it('no matches -> No matches found, no footer', async () => {
    const dir = await makeCorpus(10);
    const c = contentOf(await grepTool.execute({ pattern: 'ZZ_ABSENT', path: dir, output_mode: 'count' }, makeCtx(dir)));
    expect(c).toBe('No matches found');
  });
  it('aborts cleanly', async () => {
    const dir = await makeCorpus(3);
    const ac = new AbortController();
    ac.abort();
    await expect(
      grepTool.execute({ pattern: 'NEEDLE', path: dir }, { ...makeCtx(dir), signal: ac.signal }),
    ).rejects.toBeInstanceOf(AbortError);
  });
});
