/**
 * Audit r4 (2026-07-17) — tools-fs cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - Y5-1: the F1 symlink-loop guard no longer drops symlinks that point to a
 *    regular file (Glob lists them; Grep searches through them), while the
 *    directory-symlink loop guard still holds.
 *  - Y5-2: Write preserves the prior file mode past the process umask (the
 *    group/other write bits survive an overwrite).
 *  - Y5-4: a filtered BashOutput releases a newline-less trailing partial once
 *    the stream stalls (interactive prompt surfaces), while a line split across
 *    polls is still protected (F4 untouched).
 *  - V6-1: Grep discloses files skipped for exceeding the 10MB scan cap instead
 *    of reporting a bare "No matches found".
 *  - V6-2: Glob's mtime sort has a deterministic path tiebreak.
 *  - V6-3: a negative head_limit is rejected, not collapsed to unlimited.
 *  - V6-4: Grep's binary sniff scans the whole buffer (text-header + binary-tail
 *    file is skipped, not emitted).
 *  - V6-5: formatCatN bounds the first line to the total-output cap and flags it.
 *  - Z3-2: Read tolerates a stray NUL deep in a large text file, yet still
 *    refuses a genuinely binary file.
 *  - Sfs-1: Edit writes atomically (tmp+rename → other hard link keeps the old
 *    content) and preserves the prior mode.
 *  - R7s-1: Grep's per-line clip never leaves a lone surrogate.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import {
  chmod,
  link,
  lstat,
  readFile,
  readdir,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { globTool } from '../src/tools/glob.js';
import { grepTool } from '../src/tools/grep.js';
import { readTool, createReadTool } from '../src/tools/read.js';
import { writeTool } from '../src/tools/write.js';
import { editTool } from '../src/tools/edit.js';
import { bashOutputTool } from '../src/tools/shells.js';
import { formatCatN } from '../src/tools/fsutil.js';
import type {
  BackgroundShell,
  ShellManager,
  ToolContext,
} from '../src/internal/contracts.js';

const posixIt = it.skipIf(process.platform === 'win32');

let sandboxes: string[] = [];
let sandbox: string;

async function makeSandbox(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'audit-r4-fs-'));
  sandboxes.push(dir);
  return dir;
}

function makeCtx(cwd: string, extra: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd,
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
    ...extra,
  };
}

/** A ctx whose read-before-write gate is armed and already unlocks `abs`. */
function gatedCtx(cwd: string, abs: string, extra: Partial<ToolContext> = {}): ToolContext {
  return makeCtx(cwd, { readFilePaths: new Set([abs]), ...extra });
}

function contentOf(r: { content: unknown }): string {
  return String(r.content);
}

/** True when `s` contains a UTF-16 surrogate that is not part of a pair. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

beforeEach(async () => {
  sandboxes = [];
  sandbox = await makeSandbox();
});

afterEach(async () => {
  await Promise.all(sandboxes.map((d) => rm(d, { recursive: true, force: true })));
  sandboxes = [];
});

// ---------------------------------------------------------------------------
// Y5-1: symlinks-to-files survive the F1 loop guard
// ---------------------------------------------------------------------------

describe('Y5-1: symlink-to-file inclusion (loop guard unchanged)', () => {
  posixIt('Glob lists a symlink that points to a regular file', async () => {
    await writeFile(path.join(sandbox, 'real.txt'), 'hi\n', 'utf8');
    await symlink('real.txt', path.join(sandbox, 'link.txt'));

    const res = await globTool.execute({ pattern: '**/*.txt' }, makeCtx(sandbox));
    const names = contentOf(res).split('\n').map((l) => path.basename(l));
    expect(names).toContain('real.txt');
    expect(names).toContain('link.txt'); // previously dropped silently
  });

  posixIt('Grep searches through a symlink that points to a matching file', async () => {
    await writeFile(path.join(sandbox, 'real.txt'), 'has needleX here\n', 'utf8');
    await symlink('real.txt', path.join(sandbox, 'link.txt'));

    const res = await grepTool.execute(
      { pattern: 'needleX', output_mode: 'files_with_matches' },
      makeCtx(sandbox),
    );
    const names = contentOf(res).split('\n').map((l) => path.basename(l));
    expect(names).toContain('link.txt'); // the symlinked file is now searched
  });

  posixIt('a self-referential directory symlink still yields the file exactly once', async () => {
    await writeFile(path.join(sandbox, 'a.txt'), 'hello\n', 'utf8');
    await symlink('.', path.join(sandbox, 'loop'));

    const res = await globTool.execute({ pattern: '**/*.txt' }, makeCtx(sandbox));
    const lines = contentOf(res).split('\n');
    expect(lines.filter((l) => l.endsWith('a.txt'))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Y5-2: Write preserves mode past umask
// ---------------------------------------------------------------------------

describe('Y5-2: overwrite preserves the prior mode past umask', () => {
  posixIt('group/other write bits survive an overwrite under umask 022', async () => {
    const prevMask = process.umask(0o022);
    try {
      const file = path.join(sandbox, 'perm.txt');
      await writeFile(file, 'original\n', 'utf8');
      await chmod(file, 0o664); // group-write bit set, which umask 022 would strip
      const ctx = gatedCtx(sandbox, file);

      const res = await writeTool.execute({ file_path: file, content: 'updated\n' }, ctx);
      expect(res.isError).toBeFalsy();
      expect(((await stat(file)).mode & 0o777).toString(8)).toBe('664');
    } finally {
      process.umask(prevMask);
    }
  });
});

// ---------------------------------------------------------------------------
// Y5-4: filtered BashOutput releases a stalled prompt
// ---------------------------------------------------------------------------

function fakeShellRec(over: Partial<BackgroundShell> = {}): BackgroundShell {
  return {
    id: 'bash_1',
    command: 'test',
    pid: 1,
    stdout: '',
    stdoutTruncated: false,
    stderr: '',
    stderrTruncated: false,
    cursorOut: 0,
    cursorErr: 0,
    status: 'running',
    killRequested: false,
    exitCode: null,
    exitSignal: null,
    kill: () => {},
    ...over,
  };
}

function fakeShellManager(rec: BackgroundShell): ShellManager {
  return {
    stateDir: '',
    spawnBackground: async () => ({ error: 'unused' }),
    get: (id) => (id === rec.id ? rec : undefined),
    kill: () => false,
    dispose: () => {},
  };
}

describe('Y5-4: filtered read releases a stalled newline-less prompt', () => {
  it('a held prompt appears once the stream stalls between polls', async () => {
    const rec = fakeShellRec({ stdout: 'Password: ' }); // interactive prompt, no newline
    const ctx = makeCtx('/', { shells: fakeShellManager(rec) });

    // Poll 1: brand-new partial is held back (F4).
    const first = await bashOutputTool.execute(
      { bash_id: 'bash_1', filter: 'Password' },
      ctx,
    );
    expect(contentOf(first)).toContain('(no new output)');
    expect(rec.cursorOut).toBe(0);

    // Poll 2: no new bytes arrived — the tail is a stable prompt, so release it.
    const second = await bashOutputTool.execute(
      { bash_id: 'bash_1', filter: 'Password' },
      ctx,
    );
    expect(contentOf(second)).toContain('Password:');
    expect(rec.cursorOut).toBe('Password: '.length);
  });

  it('a line split across polls is still protected (F4 unbroken)', async () => {
    const rec = fakeShellRec({ stdout: 'ERR' });
    const ctx = makeCtx('/', { shells: fakeShellManager(rec) });

    const first = await bashOutputTool.execute({ bash_id: 'bash_1', filter: '^ERROR' }, ctx);
    expect(contentOf(first)).toContain('(no new output)');
    expect(rec.cursorOut).toBe(0);

    rec.stdout += 'OR: boom\nnext'; // stream GREW between polls -> not a stall
    const second = await bashOutputTool.execute({ bash_id: 'bash_1', filter: '^ERROR' }, ctx);
    expect(contentOf(second)).toContain('ERROR: boom');
    expect(rec.cursorOut).toBe('ERROR: boom\n'.length);
  });
});

// ---------------------------------------------------------------------------
// V6-1: Grep discloses oversize skips
// ---------------------------------------------------------------------------

describe('V6-1: oversize files are disclosed, not silently dropped', () => {
  it('an explicit >10MB file is reported as skipped, not "No matches found"', async () => {
    const file = path.join(sandbox, 'big.log');
    await writeFile(
      file,
      Buffer.concat([Buffer.from('NEEDLE\n'), Buffer.alloc(11 * 1024 * 1024, 0x61)]),
    );

    const res = await grepTool.execute({ pattern: 'NEEDLE', path: file }, makeCtx(sandbox));
    const out = contentOf(res);
    expect(out).toContain('skipped');
    expect(out).toContain('10MB');
    expect(out).toContain(file);
    expect(out).not.toBe('No matches found');
  });
});

// ---------------------------------------------------------------------------
// V6-2: Glob sort tiebreak
// ---------------------------------------------------------------------------

describe('V6-2: same-mtime files sort deterministically by path', () => {
  posixIt('equal-mtime files are ordered by path and stable across runs', async () => {
    const when = new Date('2020-01-01T00:00:00Z');
    for (const name of ['z.txt', 'a.txt', 'm.txt', 'b.txt']) {
      const p = path.join(sandbox, name);
      await writeFile(p, 'x\n', 'utf8');
      await utimes(p, when, when); // identical mtime => tiebreak decides order
    }

    const run1 = await globTool.execute({ pattern: '*.txt' }, makeCtx(sandbox));
    const run2 = await globTool.execute({ pattern: '*.txt' }, makeCtx(sandbox));
    expect(contentOf(run1)).toBe(contentOf(run2)); // deterministic

    const names = contentOf(run1).split('\n').map((l) => path.basename(l));
    expect(names).toEqual(['a.txt', 'b.txt', 'm.txt', 'z.txt']); // path-ascending
  });
});

// ---------------------------------------------------------------------------
// V6-3: negative head_limit rejected
// ---------------------------------------------------------------------------

describe('V6-3: a negative head_limit is rejected', () => {
  it('head_limit:-1 is an error, not a silent "unlimited"', async () => {
    await writeFile(path.join(sandbox, 'f.txt'), 'match\nmatch\n', 'utf8');
    const res = await grepTool.execute(
      { pattern: 'match', path: sandbox, output_mode: 'content', head_limit: -1 },
      makeCtx(sandbox),
    );
    expect(res.isError).toBe(true);
    expect(contentOf(res)).toContain('head_limit');
  });
});

// ---------------------------------------------------------------------------
// V6-4: whole-buffer binary sniff
// ---------------------------------------------------------------------------

describe('V6-4: a text-header/binary-tail file is skipped, not emitted', () => {
  it('a NUL past the first 8KB now marks the file binary', async () => {
    const file = path.join(sandbox, 'mixed.dat');
    await writeFile(
      file,
      Buffer.concat([
        Buffer.from(`NEEDLE ${'x'.repeat(9000)}\n`), // text header, NEEDLE up front
        Buffer.from([0x00]), // NUL at ~9008, past the old 8192-byte sniff
        Buffer.from('binary-tail\n'),
      ]),
    );

    const res = await grepTool.execute({ pattern: 'NEEDLE', path: file }, makeCtx(sandbox));
    expect(contentOf(res)).toBe('No matches found'); // file treated as binary, skipped whole
  });
});

// ---------------------------------------------------------------------------
// V6-5: formatCatN first-line cap
// ---------------------------------------------------------------------------

describe('V6-5: the first line honors the total-output cap', () => {
  it('a first line wider than maxOutputChars is bounded and flagged', async () => {
    const r = formatCatN(['x'.repeat(500)], 1, { maxOutputChars: 50, maxLineChars: 5000 });
    expect(r.charCapped).toBe(true); // footer will fire
    expect(r.text.length).toBeLessThanOrEqual(50); // no longer blows past the cap
    expect(r.linesEmitted).toBe(1); // still non-empty
  });
});

// ---------------------------------------------------------------------------
// Z3-2: Read tolerates a stray NUL in a large text file
// ---------------------------------------------------------------------------

describe('Z3-2: Read is lenient about a deep stray NUL, strict about real binaries', () => {
  it('a large text log with one NUL past its header is still readable', async () => {
    const file = path.join(sandbox, 'app.log');
    await writeFile(
      file,
      Buffer.concat([
        Buffer.from(`HEADERTEXT ${'x'.repeat(9000)}\n`),
        Buffer.from([0x00]), // stray NUL well past the 8KB display sniff
        Buffer.from('after-nul\n'),
      ]),
    );

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));
    expect(res.isError).toBeFalsy();
    expect(contentOf(res)).toContain('HEADERTEXT');
  });

  it('a file whose header is binary is still refused', async () => {
    const file = path.join(sandbox, 'blob.bin');
    await writeFile(file, Buffer.from([0x62, 0x00, 0x01, 0xff, 0x00]));
    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));
    expect(res.isError).toBe(true);
    expect(contentOf(res)).toMatch(/binary/i);
  });
});

// ---------------------------------------------------------------------------
// Sfs-1: Edit is atomic + mode-preserving
// ---------------------------------------------------------------------------

describe('Sfs-1: Edit writes atomically (tmp+rename)', () => {
  posixIt('a second hard link keeps the pre-edit content (rename mints a new inode)', async () => {
    const a = path.join(sandbox, 'a.txt');
    const b = path.join(sandbox, 'b.txt');
    const original = 'x\nOLD\ny\n';
    await writeFile(a, original, 'utf8');
    await link(a, b); // hard link: same inode as `a`

    const res = await editTool.execute(
      { file_path: a, old_string: 'OLD', new_string: 'NEW' },
      gatedCtx(sandbox, a),
    );
    expect(res.isError).toBeFalsy();
    expect(await readFile(a, 'utf8')).toContain('NEW'); // edited file updated
    // In-place O_TRUNC would have changed the shared inode; the atomic rename
    // gives `a` a fresh inode, so the other hard link keeps the old bytes.
    expect(await readFile(b, 'utf8')).toBe(original);
    const leftovers = (await readdir(sandbox)).filter((n) => n.includes('.tmp'));
    expect(leftovers).toEqual([]); // tmp cleaned up
  });

  posixIt('edit preserves the prior file mode past umask', async () => {
    const prevMask = process.umask(0o022);
    try {
      const file = path.join(sandbox, 'm.txt');
      await writeFile(file, 'a\nOLD\nb\n', 'utf8');
      await chmod(file, 0o664);

      const res = await editTool.execute(
        { file_path: file, old_string: 'OLD', new_string: 'NEW' },
        gatedCtx(sandbox, file),
      );
      expect(res.isError).toBeFalsy();
      expect(((await stat(file)).mode & 0o777).toString(8)).toBe('664');
    } finally {
      process.umask(prevMask);
    }
  });

  posixIt('edit through a symlink updates the target and keeps the link a link', async () => {
    const real = path.join(sandbox, 'real.txt');
    const linkP = path.join(sandbox, 'link.txt');
    await writeFile(real, 'a\nOLD\nb\n', 'utf8');
    await symlink('real.txt', linkP);

    const res = await editTool.execute(
      { file_path: linkP, old_string: 'OLD', new_string: 'NEW' },
      gatedCtx(sandbox, linkP),
    );
    expect(res.isError).toBeFalsy();
    expect(await readFile(real, 'utf8')).toContain('NEW');
    expect((await lstat(linkP)).isSymbolicLink()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R7s-1: Grep line clip is surrogate-safe
// ---------------------------------------------------------------------------

describe('R7s-1: clipped grep lines never leave a lone surrogate', () => {
  it('a surrogate pair straddling the 2000-char clip boundary is not split', async () => {
    // '😀' (U+1F600) occupies UTF-16 indices 1999 and 2000: a bare slice(0,2000)
    // keeps only its high surrogate.
    const longLine = `${'a'.repeat(1999)}\u{1F600}${'b'.repeat(80)}`;
    const file = path.join(sandbox, 'wide.txt');
    await writeFile(file, `${longLine}\n`, 'utf8');

    const res = await grepTool.execute(
      { pattern: 'a', path: file, output_mode: 'content', '-n': false },
      makeCtx(sandbox),
    );
    const out = contentOf(res);
    expect(out).toContain('[line truncated]'); // the clip actually fired
    expect(hasLoneSurrogate(out)).toBe(false); // and left no half-character
  });
});
