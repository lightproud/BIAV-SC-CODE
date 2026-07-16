/**
 * Read total-output character cap (BPT request 2026-07-06).
 *
 * Covers the spec's boundary matrix: line-limit vs char-cap precedence, the
 * consistent footer (§B — never claims more lines than it returned), the
 * per-line truncation marker (§C), the Grep hint (§D), configurable limits
 * (§E), and the never-empty invariant (total cap > per-line cap => >= ~25
 * lines). formatCatN is also unit-tested directly.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createReadTool, readTool } from '../src/tools/read.js';
import {
  MAX_READ_OUTPUT_CHARS,
  MAX_LINE_CHARS,
  formatCatN,
} from '../src/tools/fsutil.js';
import { createBuiltinTools } from '../src/tools/index.js';
import { AbortError } from '../src/errors.js';
import type { ToolContext } from '../src/internal/contracts.js';

let sandboxes: string[] = [];
async function makeSandbox(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bpt-readcap-'));
  sandboxes.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(sandboxes.map((d) => rm(d, { recursive: true, force: true })));
  sandboxes = [];
});

function makeCtx(cwd: string): ToolContext {
  return {
    cwd,
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
  };
}

async function writeFileLines(dir: string, name: string, lines: string[]): Promise<string> {
  const p = path.join(dir, name);
  await writeFile(p, lines.join('\n'), 'utf8');
  return p;
}

function contentOf(res: { content: unknown }): string {
  return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
}

describe('formatCatN (unit)', () => {
  it('reports linesEmitted, charCapped=false when everything fits', () => {
    const r = formatCatN(['a', 'b', 'c'], 1);
    expect(r.linesEmitted).toBe(3);
    expect(r.charCapped).toBe(false);
    expect(r.truncatedLines).toBe(0);
    expect(r.text.split('\n')).toHaveLength(3);
  });

  it('stops on a line boundary at the total-char cap and flags charCapped', () => {
    // 200 lines of ~100 chars each ~= 20K; cap at 5000 -> ~40-50 lines.
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} ` + 'x'.repeat(90));
    const r = formatCatN(lines, 1, { maxOutputChars: 5000 });
    expect(r.charCapped).toBe(true);
    expect(r.linesEmitted).toBeGreaterThan(0);
    expect(r.linesEmitted).toBeLessThan(200);
    expect(r.text.length).toBeLessThanOrEqual(5000);
  });

  it('always emits the first line even if it alone exceeds the total cap (never empty)', () => {
    const r = formatCatN(['x'.repeat(500)], 1, { maxOutputChars: 10 });
    expect(r.linesEmitted).toBe(1);
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('marks a per-line truncation with the original length (§C), not a silent slice', () => {
    const long = 'y'.repeat(MAX_LINE_CHARS + 5000);
    const r = formatCatN([long], 1);
    expect(r.truncatedLines).toBe(1);
    expect(r.text).toContain(`…[line truncated: ${MAX_LINE_CHARS + 5000} chars total]`);
    // the kept portion is exactly maxLineChars of the original
    expect(r.text).toContain('y'.repeat(MAX_LINE_CHARS));
  });

  it('honors custom maxLineChars / maxOutputChars', () => {
    const r = formatCatN(['z'.repeat(100)], 1, { maxLineChars: 10 });
    expect(r.truncatedLines).toBe(1);
    expect(r.text).toContain('…[line truncated: 100 chars total]');
  });
});

describe('Read total-output cap (boundary matrix)', () => {
  it('§3 case 1: line limit hits first, char cap not reached -> plain line footer', async () => {
    const dir = await makeSandbox();
    // 3000 short lines: the 2000-line limit bounds it well before 50K chars.
    const file = await writeFileLines(dir, 'many-short.txt', Array.from({ length: 3000 }, (_, i) => `l${i}`));
    const res = await readTool.execute({ file_path: file }, makeCtx(dir));
    const c = contentOf(res);
    expect(c).toContain('Showing lines 1-2000 of 3000. Use offset=2001 to continue reading.');
    expect(c).not.toContain('truncated at');
  });

  it('§3 case 2: char cap hits first -> footer reports truncated at cap + offset', async () => {
    const dir = await makeSandbox();
    // 2000 lines x 500 chars ~= 1MB: the 50K char cap bounds it near line ~90.
    const file = await writeFileLines(dir, 'wide.txt', Array.from({ length: 2000 }, () => 'w'.repeat(500)));
    const res = await readTool.execute({ file_path: file }, makeCtx(dir));
    const c = contentOf(res);
    expect(c).toContain(`output truncated at ${MAX_READ_OUTPUT_CHARS} chars`);
    // footer must name the REAL last line (< 2000), not claim all 2000
    const m = c.match(/Showing lines 1-(\d+) of 2000/);
    expect(m).not.toBeNull();
    const lastShown = Number(m![1]);
    expect(lastShown).toBeLessThan(2000);
    expect(lastShown).toBeGreaterThanOrEqual(25); // never-empty invariant
    expect(c).toContain(`Use offset=${lastShown + 1} to continue reading.`);
    // §B consistency: the actual body has exactly `lastShown` numbered rows
    const body = c.split('\n\n(')[0];
    expect(body.split('\n')).toHaveLength(lastShown);
  });

  it('§3 case 3: offset continuation reads the window after the cap', async () => {
    const dir = await makeSandbox();
    const file = await writeFileLines(dir, 'wide.txt', Array.from({ length: 2000 }, (_, i) => `${i}:` + 'w'.repeat(500)));
    const first = contentOf(await readTool.execute({ file_path: file }, makeCtx(dir)));
    const off = Number(first.match(/Use offset=(\d+)/)![1]);
    const second = contentOf(await readTool.execute({ file_path: file, offset: off }, makeCtx(dir)));
    // the second read starts exactly where the first stopped
    expect(second).toContain(`${String(off).padStart(6)}\t${off - 1}:`);
  });

  it('§3 case 4: a 45K single line is per-line truncated + marked, still bounded', async () => {
    const dir = await makeSandbox();
    const file = await writeFileLines(dir, 'onelong.txt', ['head', 'z'.repeat(45000), 'tail']);
    const res = await readTool.execute({ file_path: file }, makeCtx(dir));
    const c = contentOf(res);
    expect(c).toContain('…[line truncated: 45000 chars total]');
    expect(c).toContain('head');
    expect(c).toContain('tail'); // 3 short-ish lines, no total cap hit
  });

  it('a complete small read has no footer at all', async () => {
    const dir = await makeSandbox();
    const file = await writeFileLines(dir, 'small.txt', ['one', 'two', 'three']);
    const c = contentOf(await readTool.execute({ file_path: file }, makeCtx(dir)));
    expect(c).not.toContain('Showing lines');
    expect(c).not.toContain('truncated');
  });

  it('§E: createReadTool with a tight cap truncates sooner; createBuiltinTools threads readLimits', async () => {
    const dir = await makeSandbox();
    const file = await writeFileLines(dir, 'medium.txt', Array.from({ length: 500 }, (_, i) => `line ${i} ` + 'q'.repeat(80)));
    const tight = createReadTool({ maxOutputChars: 3000 });
    const c = contentOf(await tight.execute({ file_path: file }, makeCtx(dir)));
    expect(c).toContain('output truncated at 3000 chars');

    const tools = createBuiltinTools({ readLimits: { maxOutputChars: 3000 } });
    const read = tools.get('Read')!;
    const c2 = contentOf(await read.execute({ file_path: file }, makeCtx(dir)));
    expect(c2).toContain('output truncated at 3000 chars');
  });

  it('§3 exemption: an empty file returns the empty note before any cap logic', async () => {
    const dir = await makeSandbox();
    const file = path.join(dir, 'empty.txt');
    await writeFile(file, '', 'utf8');
    const c = contentOf(await readTool.execute({ file_path: file }, makeCtx(dir)));
    expect(c).toContain('exists but is empty');
    expect(c).not.toContain('truncated');
  });

  it('aborts cleanly', async () => {
    const dir = await makeSandbox();
    const file = await writeFileLines(dir, 'x.txt', ['a']);
    const ac = new AbortController();
    ac.abort();
    await expect(
      readTool.execute({ file_path: file }, { ...makeCtx(dir), signal: ac.signal }),
    ).rejects.toBeInstanceOf(AbortError);
  });
});
