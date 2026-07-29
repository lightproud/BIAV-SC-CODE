/**
 * Acceptance tests for the 2026-07-28 拷问 rulings on the ten registered
 * alignment observations (COMPAT "2026-07-28 tools/memory alignment audit").
 * One describe per ruled behavior change; doc-only rulings have no test here.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readTool } from '../src/tools/read.js';
import { globTool } from '../src/tools/glob.js';
import { grepTool, shimRgDialect } from '../src/tools/grep.js';
import { askUserQuestionTool } from '../src/tools/askuserquestion.js';
import type { ToolContext, ToolResultPayload } from '../src/internal/contracts.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'align-rulings-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function ctx(cwd: string): ToolContext {
  return {
    cwd,
    additionalDirectories: [],
    env: { ...process.env },
    signal: new AbortController().signal,
    debug: () => {},
  } as ToolContext;
}

function text(res: ToolResultPayload): string {
  expect(typeof res.content).toBe('string');
  return res.content as string;
}

// #4 — ignore-set disclosure on zero matches
describe('拷问 #4: Glob/Grep disclose the hard-coded ignore set on zero matches', () => {
  it('Glob names the excludes instead of a bare "No files found"', async () => {
    const res = await globTool.execute({ pattern: '**/*.does-not-exist-zzz' }, ctx(root));
    expect(text(res)).toContain('node_modules and .git are always excluded');
  });

  it('Grep names the excludes on a no-match run', async () => {
    await writeFile(join(root, 'g.txt'), 'hello\n');
    const res = await grepTool.execute(
      { pattern: 'zzz-not-here', path: root },
      ctx(root),
    );
    expect(text(res)).toContain('node_modules and .git are always excluded');
  });
});

// #5 — Read path contract unified in the model-visible layer
describe('拷问 #5: Read visible-layer path contract', () => {
  it('schema says absolute-only (matching the description), impl stays lenient', async () => {
    const desc = (
      (readTool.inputSchema as { properties: Record<string, { description?: string }> })
        .properties['file_path']?.description ?? ''
    );
    expect(desc).toContain('absolute path');
    expect(desc).not.toContain('cwd-relative');
    // Leniency unchanged: a relative path still resolves against cwd.
    await writeFile(join(root, 'rel.txt'), 'x\n');
    const res = await readTool.execute({ file_path: 'rel.txt' }, ctx(root));
    expect(res.isError).toBeUndefined();
  });

  it('directory error points at Bash, like the description alternatives', async () => {
    const res = await readTool.execute({ file_path: root }, ctx(root));
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('Use the Bash tool');
    expect(text(res)).not.toContain('Glob');
  });
});

// #6 — rg-dialect shim + self-healing type error
describe('拷问 #6: Grep rg-dialect compatibility', () => {
  it('shimRgDialect rewrites POSIX classes and Python/rg named groups', () => {
    expect(shimRgDialect('[[:digit:]]+')).toBe('[0-9]+');
    expect(shimRgDialect('[a[:digit:]_]')).toBe('[a0-9_]');
    expect(shimRgDialect('(?P<year>[[:digit:]]{4})')).toBe('(?<year>[0-9]{4})');
    expect(shimRgDialect('(?P<w>x)(?P=w)')).toBe('(?<w>x)\\k<w>');
    // A plain JS pattern passes through untouched.
    expect(shimRgDialect('interface\\{\\}')).toBe('interface\\{\\}');
  });

  it('a POSIX-class pattern actually matches (end to end)', async () => {
    await writeFile(join(root, 'nums.txt'), 'abc 2026 def\n');
    const res = await grepTool.execute(
      { pattern: '[[:digit:]]{4}', path: root, output_mode: 'content' },
      ctx(root),
    );
    expect(text(res)).toContain('2026');
  });

  it('unknown type error lists supported types and offers glob', async () => {
    const res = await grepTool.execute(
      { pattern: 'x', type: 'cobol', path: root },
      ctx(root),
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('Supported:');
    expect(text(res)).toContain('`glob` parameter');
  });
});

// #7 — whole-file-equivalent reads hit the 256KB refusal
describe('拷问 #7: Read 256KB refusal covers whole-file-equivalent limits', () => {
  const bigFile = () => join(root, 'big.txt');

  beforeAll(async () => {
    // > 262144 bytes of text across many lines.
    await writeFile(bigFile(), `${'x'.repeat(99)}\n`.repeat(3000));
  });

  it('a bare huge limit no longer bypasses the refusal', async () => {
    const res = await readTool.execute({ file_path: bigFile(), limit: 999999 }, ctx(root));
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('exceeds maximum allowed size');
  });

  it('limit exactly at the default window is refused like a bare Read', async () => {
    const res = await readTool.execute({ file_path: bigFile(), limit: 2000 }, ctx(root));
    expect(res.isError).toBe(true);
  });

  it('a genuinely bounded read still passes: sub-default limit, or any offset', async () => {
    const small = await readTool.execute({ file_path: bigFile(), limit: 100 }, ctx(root));
    expect(small.isError).toBeUndefined();
    const offset = await readTool.execute(
      { file_path: bigFile(), offset: 2500, limit: 999999 },
      ctx(root),
    );
    expect(offset.isError).toBeUndefined();
  });
});

// #1 — AskUserQuestion preview acceptance rules
describe('拷问 #1: AskUserQuestion preview field', () => {
  const q = (opts: unknown[], multiSelect = false) => ({
    questions: [{ question: 'Pick?', header: 'Pick', options: opts, multiSelect }],
  });

  it('accepts preview on single-select and forwards it to the host', async () => {
    let seen: unknown;
    const c = {
      ...ctx(root),
      askUser: async (questions: unknown) => {
        seen = questions;
        return [{ header: 'Pick', answers: ['A'] }];
      },
    } as unknown as ToolContext;
    const res = await askUserQuestionTool.execute(
      q([{ label: 'A', preview: '<b>alpha</b>' }, 'B']),
      c,
    );
    expect(res.isError).toBeUndefined();
    const forwarded = (seen as Array<{ options: Array<{ preview?: string }> }>)[0];
    expect(forwarded?.options[0]?.preview).toBe('<b>alpha</b>');
  });

  it('rejects preview on a multiSelect question (official constraint)', async () => {
    const res = await askUserQuestionTool.execute(
      q([{ label: 'A', preview: '<b>x</b>' }, 'B'], true),
      ctx(root),
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('single-select');
  });
});
