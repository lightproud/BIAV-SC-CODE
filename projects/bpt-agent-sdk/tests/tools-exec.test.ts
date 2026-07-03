/**
 * Module D tests - exec/search built-in tools (Bash, Glob, Grep).
 *
 * Contract under test: docs/ARCHITECTURE.md section "D - Exec/search tools"
 * plus the BuiltinTool contract in src/internal/contracts.ts. All filesystem
 * fixtures live in a mkdtemp sandbox cleaned up in afterAll. No network.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

import { bashTool } from '../src/tools/bash.js';
import { globTool } from '../src/tools/glob.js';
import { grepTool } from '../src/tools/grep.js';
import { AbortError } from '../src/errors.js';
import type {
  ToolContext,
  ToolResultPayload,
} from '../src/internal/contracts.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'bpt-tools-exec-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeCtx(
  cwd: string,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    cwd,
    additionalDirectories: [],
    env: { ...process.env },
    signal: new AbortController().signal,
    debug: () => {},
    ...overrides,
  };
}

/** Assert the payload content is a plain string and return it. */
function text(res: ToolResultPayload): string {
  expect(typeof res.content).toBe('string');
  return res.content as string;
}

async function makeDir(name: string): Promise<string> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

function abortedSignal(): AbortSignal {
  const ac = new AbortController();
  ac.abort();
  return ac.signal;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Count running processes whose full command line matches `pattern`. */
function pgrepCount(pattern: string): Promise<number> {
  return new Promise((resolve) => {
    execFile('pgrep', ['-f', pattern], (err, stdout) => {
      if (err) {
        // pgrep exits 1 when nothing matches (the wanted "all gone" case).
        resolve(0);
        return;
      }
      resolve(stdout.split('\n').filter((l) => l.trim().length > 0).length);
    });
  });
}

// ---------------------------------------------------------------------------
// Bash
// ---------------------------------------------------------------------------

describe('Bash tool', () => {
  it('exposes the documented tool surface', () => {
    expect(bashTool.name).toBe('Bash');
    expect(bashTool.readOnly).toBe(false);
    expect(bashTool.inputSchema.required).toContain('command');
  });

  it('captures stdout of a simple echo', async () => {
    const dir = await makeDir('bash-echo');
    const res = await bashTool.execute(
      { command: 'echo hello-silver' },
      makeCtx(dir),
    );
    expect(res.isError).toBeFalsy();
    expect(text(res)).toBe('hello-silver\n');
  });

  it('reports non-zero exit as isError with the exit code, without throwing', async () => {
    const dir = await makeDir('bash-exit');
    const res = await bashTool.execute({ command: 'exit 7' }, makeCtx(dir));
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('exit code 7');
  });

  it('captures stderr under a [stderr] marker', async () => {
    const dir = await makeDir('bash-stderr');
    const res = await bashTool.execute(
      { command: 'echo oops 1>&2' },
      makeCtx(dir),
    );
    expect(res.isError).toBeFalsy();
    const out = text(res);
    expect(out).toContain('[stderr]');
    expect(out).toContain('oops');
  });

  it('includes stdout, stderr and exit code together on failure', async () => {
    const dir = await makeDir('bash-both');
    const res = await bashTool.execute(
      { command: 'echo out-line; echo err-line 1>&2; exit 3' },
      makeCtx(dir),
    );
    expect(res.isError).toBe(true);
    const out = text(res);
    expect(out).toContain('exit code 3');
    expect(out).toContain('out-line');
    expect(out).toContain('[stderr]');
    expect(out).toContain('err-line');
  });

  it("returns '(no output)' for a silent successful command", async () => {
    const dir = await makeDir('bash-silent');
    const res = await bashTool.execute({ command: 'true' }, makeCtx(dir));
    expect(res.isError).toBeFalsy();
    expect(text(res)).toBe('(no output)');
  });

  it('times out promptly and reports isError with a timeout message', async () => {
    const dir = await makeDir('bash-timeout');
    const started = Date.now();
    const res = await bashTool.execute(
      { command: 'sleep 5', timeout: 300 },
      makeCtx(dir),
    );
    const elapsed = Date.now() - started;
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('timed out after 300ms');
    // sleep 5 must have been killed promptly, well before its natural end.
    expect(elapsed).toBeLessThan(3000);
  });

  it('caps stdout at 30000 chars with a [truncated] marker', async () => {
    const dir = await makeDir('bash-cap');
    const res = await bashTool.execute(
      { command: 'head -c 40000 /dev/zero | tr "\\0" a' },
      makeCtx(dir),
    );
    expect(res.isError).toBeFalsy();
    expect(text(res)).toBe(`${'a'.repeat(30000)}\n[truncated]`);
  });

  it('caps stdout and stderr independently (per-stream cap)', async () => {
    const dir = await makeDir('bash-cap2');
    const cmd =
      'big=$(head -c 40000 /dev/zero | tr "\\0" x); ' +
      'printf "%s" "$big"; printf "%s" "$big" 1>&2';
    const res = await bashTool.execute({ command: cmd }, makeCtx(dir));
    expect(res.isError).toBeFalsy();
    const parts = text(res).split('\n[stderr]\n');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(`${'x'.repeat(30000)}\n[truncated]`);
    expect(parts[1]).toBe(`${'x'.repeat(30000)}\n[truncated]`);
  });

  it('runs the command in ctx.cwd', async () => {
    const dir = await makeDir('bash-cwd');
    const res = await bashTool.execute({ command: 'pwd' }, makeCtx(dir));
    expect(res.isError).toBeFalsy();
    expect(text(res).trim()).toBe(await realpath(dir));
  });

  it('makes merged ctx.env visible to the command', async () => {
    const dir = await makeDir('bash-env');
    const ctx = makeCtx(dir, {
      env: { ...process.env, BPT_TEST_MERGED: 'silver-core-42' },
    });
    const res = await bashTool.execute(
      { command: 'printf "%s" "$BPT_TEST_MERGED"' },
      ctx,
    );
    expect(res.isError).toBeFalsy();
    expect(text(res)).toBe('silver-core-42');
  });

  it('throws AbortError for a pre-aborted signal', async () => {
    const dir = await makeDir('bash-preabort');
    const ctx = makeCtx(dir, { signal: abortedSignal() });
    await expect(
      bashTool.execute({ command: 'echo never' }, ctx),
    ).rejects.toBeInstanceOf(AbortError);
  });

  it('kills the process and throws AbortError when aborted mid-run', async () => {
    const dir = await makeDir('bash-midabort');
    const ac = new AbortController();
    const ctx = makeCtx(dir, { signal: ac.signal });
    const started = Date.now();
    const pending = bashTool.execute({ command: 'sleep 5' }, ctx);
    setTimeout(() => ac.abort(), 100);
    await expect(pending).rejects.toBeInstanceOf(AbortError);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  // Regression (finding #12, P0): a command that backgrounds a process which
  // inherits stdout/stderr must return when the DIRECT shell exits, not when
  // the whole pipe tree drains. Resolving on 'close' would hang until the
  // background child exits (or forever for a daemon).
  it('returns promptly when the shell exits but a background child holds the pipes open', async () => {
    const dir = await makeDir('bash-bg');
    const started = Date.now();
    // The shell backgrounds `sleep 8` (holding the stdout pipe) and exits at
    // once. Old 'close'-based settling would block for ~8s.
    const res = await bashTool.execute(
      { command: 'echo started; sleep 8 &', timeout: 30_000 },
      makeCtx(dir),
    );
    const elapsed = Date.now() - started;
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('started');
    // Must return near the shell's own exit, not near the background sleep's.
    expect(elapsed).toBeLessThan(3000);
  });

  // Regression (finding #12, P0): even under a timeout, a background child that
  // inherited the pipes must not keep the promise pending past the timeout.
  it('honors the timeout even when a background child keeps the pipes open', async () => {
    const dir = await makeDir('bash-bg-timeout');
    const started = Date.now();
    const res = await bashTool.execute(
      { command: 'echo up; sleep 9 &', timeout: 500 },
      makeCtx(dir),
    );
    const elapsed = Date.now() - started;
    // Shell exits immediately (the & returns control), so this is a success,
    // and it must settle in well under the background sleep's 9s.
    expect(res.isError).toBeFalsy();
    expect(elapsed).toBeLessThan(3000);
  });

  // Regression (finding #13, P1): grandchildren (pipeline members) must be
  // killed as a process group on timeout, not orphaned to keep running.
  it('kills orphaned grandchildren as a process group on timeout', async () => {
    const dir = await makeDir('bash-grandkids');
    // Distinctive long durations so any surviving orphan is unambiguous.
    const cmd = 'sleep 8611 | sleep 8612';
    // Sanity: nothing matching is running before we start.
    expect(await pgrepCount('sleep 861')).toBe(0);

    const res = await bashTool.execute({ command: cmd, timeout: 400 }, makeCtx(dir));
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('timed out');

    // Give SIGTERM a beat to reap the group, then confirm no orphan survived.
    await delay(400);
    expect(await pgrepCount('sleep 861')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Glob
// ---------------------------------------------------------------------------

describe('Glob tool', () => {
  it('exposes the documented tool surface', () => {
    expect(globTool.name).toBe('Glob');
    expect(globTool.readOnly).toBe(true);
    expect(globTool.inputSchema.required).toContain('pattern');
  });

  it('sorts results by mtime, newest first', async () => {
    const dir = await makeDir('glob-mtime');
    const now = Date.now();
    // Creation order (a, b, c) deliberately differs from mtime order.
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      await writeFile(path.join(dir, name), name);
    }
    await utimes(path.join(dir, 'a.txt'), new Date(now - 20_000), new Date(now - 20_000));
    await utimes(path.join(dir, 'b.txt'), new Date(now - 5_000), new Date(now - 5_000));
    await utimes(path.join(dir, 'c.txt'), new Date(now - 40_000), new Date(now - 40_000));

    const res = await globTool.execute({ pattern: '*.txt' }, makeCtx(dir));
    expect(res.isError).toBeFalsy();
    expect(text(res).split('\n')).toEqual([
      path.join(dir, 'b.txt'),
      path.join(dir, 'a.txt'),
      path.join(dir, 'c.txt'),
    ]);
  });

  it('ignores node_modules and .git', async () => {
    const dir = await makeDir('glob-ignore');
    await mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(path.join(dir, '.git'), { recursive: true });
    await writeFile(path.join(dir, 'keep.txt'), 'k');
    await writeFile(path.join(dir, 'node_modules', 'pkg', 'skip.txt'), 's');
    await writeFile(path.join(dir, '.git', 'skip.txt'), 's');

    const res = await globTool.execute({ pattern: '**/*.txt' }, makeCtx(dir));
    expect(res.isError).toBeFalsy();
    expect(text(res).split('\n')).toEqual([path.join(dir, 'keep.txt')]);
  });

  it("returns 'No files found' when nothing matches", async () => {
    const dir = await makeDir('glob-none');
    const res = await globTool.execute({ pattern: '*.zzz' }, makeCtx(dir));
    expect(res.isError).toBeFalsy();
    expect(text(res)).toBe('No files found');
  });

  it('caps results at 100 with a truncation note', async () => {
    const dir = await makeDir('glob-many');
    await Promise.all(
      Array.from({ length: 105 }, (_, i) =>
        writeFile(path.join(dir, `f${String(i).padStart(3, '0')}.txt`), 'x'),
      ),
    );
    const res = await globTool.execute({ pattern: '*.txt' }, makeCtx(dir));
    expect(res.isError).toBeFalsy();
    const lines = text(res).split('\n');
    expect(lines).toHaveLength(101);
    expect(lines[100]).toBe(
      '(Results truncated: showing first 100 of 105 matches)',
    );
    // The first 100 lines are all real paths inside the sandbox.
    for (const line of lines.slice(0, 100)) {
      expect(line.startsWith(dir + path.sep)).toBe(true);
    }
  });

  it('returns isError for a nonexistent search path', async () => {
    const dir = await makeDir('glob-nopath');
    const res = await globTool.execute(
      { pattern: '*', path: 'does-not-exist-xyz' },
      makeCtx(dir),
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('does not exist');
  });

  it('returns isError when the search path is a file', async () => {
    const dir = await makeDir('glob-filepath');
    await writeFile(path.join(dir, 'plain.txt'), 'x');
    const res = await globTool.execute(
      { pattern: '*', path: 'plain.txt' },
      makeCtx(dir),
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('not a directory');
  });

  it('throws AbortError for a pre-aborted signal', async () => {
    const dir = await makeDir('glob-preabort');
    const ctx = makeCtx(dir, { signal: abortedSignal() });
    await expect(
      globTool.execute({ pattern: '*' }, ctx),
    ).rejects.toBeInstanceOf(AbortError);
  });
});

// ---------------------------------------------------------------------------
// Grep
// ---------------------------------------------------------------------------

describe('Grep tool', () => {
  it('exposes the documented tool surface', () => {
    expect(grepTool.name).toBe('Grep');
    expect(grepTool.readOnly).toBe(true);
    expect(grepTool.inputSchema.required).toContain('pattern');
  });

  it('defaults to files_with_matches and skips binary files', async () => {
    const dir = await makeDir('grep-fwm');
    await writeFile(path.join(dir, 'plain.txt'), 'a needle here\n');
    await writeFile(path.join(dir, 'other.txt'), 'nothing relevant\n');
    await writeFile(
      path.join(dir, 'noise.bin'),
      Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from('needle')]),
    );
    const res = await grepTool.execute({ pattern: 'needle' }, makeCtx(dir));
    expect(res.isError).toBeFalsy();
    expect(text(res).split('\n')).toEqual([path.join(dir, 'plain.txt')]);
  });

  it('content mode shows line numbers by default (path:line:text)', async () => {
    const dir = await makeDir('grep-content');
    const file = path.join(dir, 'content.txt');
    await writeFile(file, 'one\ntwo needle\nthree\n');
    const res = await grepTool.execute(
      { pattern: 'needle', path: 'content.txt', output_mode: 'content' },
      makeCtx(dir),
    );
    expect(res.isError).toBeFalsy();
    expect(text(res)).toBe(`${file}:2:two needle`);
  });

  it('content mode with -n false omits line numbers', async () => {
    const dir = await makeDir('grep-non');
    const file = path.join(dir, 'content.txt');
    await writeFile(file, 'one\ntwo needle\nthree\n');
    const res = await grepTool.execute(
      {
        pattern: 'needle',
        path: 'content.txt',
        output_mode: 'content',
        '-n': false,
      },
      makeCtx(dir),
    );
    expect(res.isError).toBeFalsy();
    expect(text(res)).toBe(`${file}:two needle`);
  });

  it('count mode reports matching line counts per file', async () => {
    const dir = await makeDir('grep-count');
    const file = path.join(dir, 'counts.txt');
    await writeFile(file, 'needle\nno\nneedle\nneedle twice needle\nno\n');
    const res = await grepTool.execute(
      { pattern: 'needle', path: 'counts.txt', output_mode: 'count' },
      makeCtx(dir),
    );
    expect(res.isError).toBeFalsy();
    // 3 matching lines (line 4 counts once).
    expect(text(res)).toBe(`${file}:3`);
  });

  it('-i enables case-insensitive matching', async () => {
    const dir = await makeDir('grep-i');
    await writeFile(path.join(dir, 'case.txt'), 'Needle Soup\n');
    const sensitive = await grepTool.execute(
      { pattern: 'needle soup' },
      makeCtx(dir),
    );
    expect(text(sensitive)).toBe('No matches found');
    const insensitive = await grepTool.execute(
      { pattern: 'needle soup', '-i': true },
      makeCtx(dir),
    );
    expect(text(insensitive).split('\n')).toEqual([
      path.join(dir, 'case.txt'),
    ]);
  });

  const contextBody = 'one\ntwo MATCH\nthree\nfour\nfive\nsix MATCH\nseven\n';

  it('-C adds context with - separators and -- between hunks', async () => {
    const dir = await makeDir('grep-ctx-c');
    const file = path.join(dir, 'ctx.txt');
    await writeFile(file, contextBody);
    const res = await grepTool.execute(
      { pattern: 'MATCH', path: 'ctx.txt', output_mode: 'content', '-C': 1 },
      makeCtx(dir),
    );
    expect(res.isError).toBeFalsy();
    expect(text(res)).toBe(
      [
        `${file}-1-one`,
        `${file}:2:two MATCH`,
        `${file}-3-three`,
        '--',
        `${file}-5-five`,
        `${file}:6:six MATCH`,
        `${file}-7-seven`,
      ].join('\n'),
    );
  });

  it('-A adds after-context only', async () => {
    const dir = await makeDir('grep-ctx-a');
    const file = path.join(dir, 'ctx.txt');
    await writeFile(file, contextBody);
    const res = await grepTool.execute(
      { pattern: 'MATCH', path: 'ctx.txt', output_mode: 'content', '-A': 1 },
      makeCtx(dir),
    );
    expect(text(res)).toBe(
      [
        `${file}:2:two MATCH`,
        `${file}-3-three`,
        '--',
        `${file}:6:six MATCH`,
        `${file}-7-seven`,
      ].join('\n'),
    );
  });

  it('-B adds before-context only', async () => {
    const dir = await makeDir('grep-ctx-b');
    const file = path.join(dir, 'ctx.txt');
    await writeFile(file, contextBody);
    const res = await grepTool.execute(
      { pattern: 'MATCH', path: 'ctx.txt', output_mode: 'content', '-B': 1 },
      makeCtx(dir),
    );
    expect(text(res)).toBe(
      [
        `${file}-1-one`,
        `${file}:2:two MATCH`,
        '--',
        `${file}-5-five`,
        `${file}:6:six MATCH`,
      ].join('\n'),
    );
  });

  it('filters searched files by glob', async () => {
    const dir = await makeDir('grep-glob');
    await writeFile(path.join(dir, 'alpha.js'), 'const target = 1;\n');
    await writeFile(path.join(dir, 'beta.md'), 'target doc\n');
    const res = await grepTool.execute(
      { pattern: 'target', glob: '*.md' },
      makeCtx(dir),
    );
    expect(text(res).split('\n')).toEqual([path.join(dir, 'beta.md')]);
  });

  it('filters searched files by type (js vs md)', async () => {
    const dir = await makeDir('grep-type');
    await writeFile(path.join(dir, 'alpha.js'), 'const target = 1;\n');
    await writeFile(path.join(dir, 'beta.md'), 'target doc\n');

    const js = await grepTool.execute(
      { pattern: 'target', type: 'js' },
      makeCtx(dir),
    );
    expect(text(js).split('\n')).toEqual([path.join(dir, 'alpha.js')]);

    const md = await grepTool.execute(
      { pattern: 'target', type: 'md' },
      makeCtx(dir),
    );
    expect(text(md).split('\n')).toEqual([path.join(dir, 'beta.md')]);
  });

  it('rejects an unknown type with isError', async () => {
    const dir = await makeDir('grep-badtype');
    const res = await grepTool.execute(
      { pattern: 'x', type: 'zig' },
      makeCtx(dir),
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('unknown file type');
  });

  it('head_limit truncates output lines', async () => {
    const dir = await makeDir('grep-headlimit');
    const body = Array.from(
      { length: 10 },
      (_, i) => `match line ${i + 1}`,
    ).join('\n');
    await writeFile(path.join(dir, 'many.txt'), `${body}\n`);
    const res = await grepTool.execute(
      {
        pattern: 'match',
        path: 'many.txt',
        output_mode: 'content',
        head_limit: 3,
      },
      makeCtx(dir),
    );
    const file = path.join(dir, 'many.txt');
    expect(text(res).split('\n')).toEqual([
      `${file}:1:match line 1`,
      `${file}:2:match line 2`,
      `${file}:3:match line 3`,
    ]);
  });

  it('applies the default head_limit of 250', async () => {
    const dir = await makeDir('grep-headdefault');
    const body = Array.from(
      { length: 300 },
      (_, i) => `match line ${i + 1}`,
    ).join('\n');
    await writeFile(path.join(dir, 'many.txt'), `${body}\n`);
    const res = await grepTool.execute(
      { pattern: 'match', path: 'many.txt', output_mode: 'content' },
      makeCtx(dir),
    );
    const lines = text(res).split('\n');
    expect(lines).toHaveLength(250);
    expect(lines[249]).toBe(`${path.join(dir, 'many.txt')}:250:match line 250`);
  });

  it('head_limit 0 means unlimited', async () => {
    const dir = await makeDir('grep-headzero');
    const body = Array.from(
      { length: 300 },
      (_, i) => `match line ${i + 1}`,
    ).join('\n');
    await writeFile(path.join(dir, 'many.txt'), `${body}\n`);
    const res = await grepTool.execute(
      {
        pattern: 'match',
        path: 'many.txt',
        output_mode: 'content',
        head_limit: 0,
      },
      makeCtx(dir),
    );
    expect(text(res).split('\n')).toHaveLength(300);
  });

  it('multiline mode matches patterns spanning lines', async () => {
    const dir = await makeDir('grep-multiline');
    const file = path.join(dir, 'multi.txt');
    await writeFile(file, 'alpha\nbeta\ngamma\n');

    // Without multiline: '.' does not cross the newline, no match.
    const plain = await grepTool.execute(
      { pattern: 'alpha.beta', path: 'multi.txt' },
      makeCtx(dir),
    );
    expect(text(plain)).toBe('No matches found');

    const fwm = await grepTool.execute(
      { pattern: 'alpha.beta', path: 'multi.txt', multiline: true },
      makeCtx(dir),
    );
    expect(text(fwm)).toBe(file);

    // Content mode reports every line spanned by the match.
    const content = await grepTool.execute(
      {
        pattern: 'alpha.beta',
        path: 'multi.txt',
        multiline: true,
        output_mode: 'content',
      },
      makeCtx(dir),
    );
    expect(text(content)).toBe(`${file}:1:alpha\n${file}:2:beta`);
  });

  it('returns isError for an invalid regular expression', async () => {
    const dir = await makeDir('grep-badre');
    const res = await grepTool.execute({ pattern: '[unclosed' }, makeCtx(dir));
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('invalid regular expression');
  });

  it("reports 'No matches found' when only a binary file would match", async () => {
    const dir = await makeDir('grep-binonly');
    await writeFile(
      path.join(dir, 'bin.dat'),
      Buffer.concat([Buffer.from('needle'), Buffer.from([0, 0, 7])]),
    );
    const res = await grepTool.execute({ pattern: 'needle' }, makeCtx(dir));
    expect(res.isError).toBeFalsy();
    expect(text(res)).toBe('No matches found');
  });

  it("returns 'No matches found' when nothing matches", async () => {
    const dir = await makeDir('grep-none');
    await writeFile(path.join(dir, 'a.txt'), 'plain text\n');
    const res = await grepTool.execute(
      { pattern: 'zzz-not-there' },
      makeCtx(dir),
    );
    expect(res.isError).toBeFalsy();
    expect(text(res)).toBe('No matches found');
  });

  it('returns isError for a nonexistent search path', async () => {
    const dir = await makeDir('grep-nopath');
    const res = await grepTool.execute(
      { pattern: 'x', path: 'missing-dir-xyz' },
      makeCtx(dir),
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('does not exist');
  });

  it('throws AbortError for a pre-aborted signal', async () => {
    const dir = await makeDir('grep-preabort');
    const ctx = makeCtx(dir, { signal: abortedSignal() });
    await expect(
      grepTool.execute({ pattern: 'x' }, ctx),
    ).rejects.toBeInstanceOf(AbortError);
  });
});
