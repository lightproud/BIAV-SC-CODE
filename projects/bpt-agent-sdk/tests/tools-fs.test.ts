/**
 * Module C (fs tools) test suite: Read / Write / Edit built-in tools.
 *
 * Contract under test: docs/ARCHITECTURE.md section C + src/internal/contracts.ts
 * (BuiltinTool / ToolContext / ToolResultPayload). All filesystem work happens
 * in mkdtemp sandboxes that are removed after every test.
 */

import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readTool } from '../src/tools/read.js';
import { writeTool } from '../src/tools/write.js';
import { editTool } from '../src/tools/edit.js';
import { AbortError } from '../src/errors.js';
import type { ToolContext } from '../src/internal/contracts.js';

/** Sandboxes created during the current test; removed in afterEach. */
let sandboxes: string[] = [];

async function makeSandbox(prefix = 'bpt-fs-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
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

function abortedCtx(cwd: string): ToolContext {
  const ac = new AbortController();
  ac.abort();
  return makeCtx(cwd, { signal: ac.signal });
}

/** cat -n style line: right-aligned 6-char number, tab, text. */
function catLine(n: number, text: string): string {
  return `${String(n).padStart(6)}\t${text}`;
}

let sandbox: string;

beforeEach(async () => {
  sandboxes = [];
  sandbox = await makeSandbox();
});

afterEach(async () => {
  await Promise.all(
    sandboxes.map((d) => rm(d, { recursive: true, force: true })),
  );
  sandboxes = [];
});

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

describe('Read tool', () => {
  it('exposes the documented tool metadata', () => {
    expect(readTool.name).toBe('Read');
    expect(readTool.readOnly).toBe(true);
    expect(readTool.inputSchema.required).toContain('file_path');
  });

  it('formats a normal file in exact cat -n style (6-char right-aligned number + tab)', async () => {
    const file = path.join(sandbox, 'plain.txt');
    await writeFile(file, 'aa\nbb\ncc\n', 'utf8');

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    expect(res.content).toBe(
      [catLine(1, 'aa'), catLine(2, 'bb'), catLine(3, 'cc')].join('\n'),
    );
  });

  it('resolves relative paths against ctx.cwd', async () => {
    await mkdir(path.join(sandbox, 'sub'), { recursive: true });
    await writeFile(path.join(sandbox, 'sub', 'rel.txt'), 'hello\n', 'utf8');

    const res = await readTool.execute(
      { file_path: 'sub/rel.txt' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    expect(res.content).toBe(catLine(1, 'hello'));
  });

  it('honors 1-based offset and limit, and appends a continuation hint', async () => {
    const file = path.join(sandbox, 'five.txt');
    await writeFile(file, 'L1\nL2\nL3\nL4\nL5\n', 'utf8');

    const res = await readTool.execute(
      { file_path: file, offset: 2, limit: 2 },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    const content = String(res.content);
    expect(content).toContain(catLine(2, 'L2'));
    expect(content).toContain(catLine(3, 'L3'));
    expect(content).not.toContain('L1');
    expect(content).not.toContain('L4');
    // Continuation hint names the shown window, the total, and the next offset.
    expect(content).toMatch(/lines 2-3 of 5/);
    expect(content).toMatch(/offset=4/);
  });

  it('clamps zero/negative offsets to line 1', async () => {
    const file = path.join(sandbox, 'clamp.txt');
    await writeFile(file, 'one\ntwo\n', 'utf8');

    for (const offset of [0, -7]) {
      const res = await readTool.execute(
        { file_path: file, offset },
        makeCtx(sandbox),
      );
      expect(res.isError).toBeFalsy();
      expect(res.content).toBe([catLine(1, 'one'), catLine(2, 'two')].join('\n'));
    }
  });

  it('returns isError with the total line count when offset is past EOF', async () => {
    const file = path.join(sandbox, 'small.txt');
    await writeFile(file, 'a\nb\nc\nd\ne\n', 'utf8');

    const res = await readTool.execute(
      { file_path: file, offset: 6 },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/5 lines/);
  });

  it('caps output at 2000 lines by default with a truncation hint', async () => {
    const total = 2005;
    const body = Array.from({ length: total }, (_, i) => `line-${i + 1}`).join('\n') + '\n';
    const file = path.join(sandbox, 'big.txt');
    await writeFile(file, body, 'utf8');

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    const content = String(res.content);
    expect(content).toContain(catLine(1, 'line-1'));
    expect(content).toContain(catLine(2000, 'line-2000'));
    expect(content).not.toContain('line-2001');
    expect(content).toMatch(/lines 1-2000 of 2005/);
    expect(content).toMatch(/offset=2001/);
  });

  it('returns a system-reminder-style note (not an error) for an empty file', async () => {
    const file = path.join(sandbox, 'empty.txt');
    await writeFile(file, '', 'utf8');

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    expect(String(res.content)).toMatch(/<system-reminder>.*empty.*<\/system-reminder>/s);
  });

  it('returns isError for a missing file', async () => {
    const res = await readTool.execute(
      { file_path: path.join(sandbox, 'no-such-file.txt') },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/does not exist/i);
  });

  it('returns isError for a directory target', async () => {
    const dir = path.join(sandbox, 'a-directory');
    await mkdir(dir);

    const res = await readTool.execute({ file_path: dir }, makeCtx(sandbox));

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/directory/i);
  });

  it('returns isError for a binary file (NUL bytes)', async () => {
    const file = path.join(sandbox, 'blob.bin');
    await writeFile(file, Buffer.from([0x62, 0x00, 0x01, 0xff, 0x00]));

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/binary/i);
  });

  it('truncates individual lines at 2000 characters', async () => {
    const long = 'x'.repeat(2500);
    const file = path.join(sandbox, 'long-line.txt');
    await writeFile(file, `${long}\nshort\n`, 'utf8');

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    const content = String(res.content);
    expect(content).toContain(catLine(1, 'x'.repeat(2000)));
    expect(content).not.toContain('x'.repeat(2001));
    expect(content).toContain(catLine(2, 'short'));
  });

  it('strips CR from CRLF line endings', async () => {
    const file = path.join(sandbox, 'crlf.txt');
    await writeFile(file, 'first\r\nsecond\r\n', 'utf8');

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    expect(res.content).toBe([catLine(1, 'first'), catLine(2, 'second')].join('\n'));
    expect(String(res.content)).not.toContain('\r');
  });

  // Regression (finding #11, P2): Read must refuse an oversized file instead of
  // buffering it whole into memory (OOM). A text-looking file that slips past
  // the 8KB binary sniff must be rejected by the byte-size guard.
  it('rejects a file larger than the byte cap instead of OOMing', async () => {
    const file = path.join(sandbox, 'huge.log');
    // 51MB of ASCII 'a' (no NUL, so it passes the binary sniff) exceeds the
    // 50MB Read cap.
    await writeFile(file, Buffer.alloc(51 * 1024 * 1024, 0x61));

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBe(true);
    const content = String(res.content);
    expect(content).toMatch(/read cap/i);
    expect(content).toMatch(/Grep/);
  });

  it('still reads a normal small file after the byte-cap guard', async () => {
    const file = path.join(sandbox, 'normal.txt');
    await writeFile(file, 'x\ny\n', 'utf8');

    const res = await readTool.execute({ file_path: file }, makeCtx(sandbox));

    expect(res.isError).toBeFalsy();
    expect(res.content).toBe([catLine(1, 'x'), catLine(2, 'y')].join('\n'));
  });
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

describe('Write tool', () => {
  it('exposes the documented tool metadata', () => {
    expect(writeTool.name).toBe('Write');
    expect(writeTool.readOnly).toBe(false);
    expect(writeTool.isFileEdit).toBe(true);
  });

  it('creates a new file, mkdir -p style, and reports creation with a byte count', async () => {
    const rel = path.join('deep', 'nested', 'dir', 'new.txt');

    const res = await writeTool.execute(
      { file_path: rel, content: 'hello' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    const content = String(res.content);
    expect(content).toMatch(/creat/i);
    expect(content).toContain('5 bytes');
    const onDisk = await readFile(path.join(sandbox, rel), 'utf8');
    expect(onDisk).toBe('hello');
  });

  it('reports overwrite (not creation) on an existing file, with a UTF-8 byte count', async () => {
    const file = path.join(sandbox, 'exists.txt');
    await writeFile(file, 'old', 'utf8');

    const res = await writeTool.execute(
      { file_path: file, content: 'héllo' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    const content = String(res.content);
    expect(content).toMatch(/overw/i);
    expect(content).not.toMatch(/creat/i);
    // 'héllo' is 6 bytes in UTF-8, not 5 characters.
    expect(content).toContain('6 bytes');
    expect(await readFile(file, 'utf8')).toBe('héllo');
  });

  it('returns isError when the target is a directory', async () => {
    const dir = path.join(sandbox, 'target-dir');
    await mkdir(dir);

    const res = await writeTool.execute(
      { file_path: dir, content: 'nope' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/directory/i);
    // Directory must be left intact.
    expect((await stat(dir)).isDirectory()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

describe('Edit tool', () => {
  it('exposes the documented tool metadata', () => {
    expect(editTool.name).toBe('Edit');
    expect(editTool.readOnly).toBe(false);
    expect(editTool.isFileEdit).toBe(true);
  });

  it('performs a single unique replacement, reporting count and a cat -n context snippet', async () => {
    const file = path.join(sandbox, 'edit-one.txt');
    await writeFile(file, 'line1\nline2\nold line3\nline4\nline5\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: 'old line3', new_string: 'new line3' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    const content = String(res.content);
    expect(content).toMatch(/1 occurrence\b/);
    // Snippet shows the edit site in cat -n format.
    expect(content).toContain(catLine(3, 'new line3'));
    expect(await readFile(file, 'utf8')).toBe(
      'line1\nline2\nnew line3\nline4\nline5\n',
    );
  });

  it('replaces every occurrence with replace_all and reports the multi count', async () => {
    const file = path.join(sandbox, 'edit-all.txt');
    await writeFile(file, 'foo a\nfoo b\nfoo c\n', 'utf8');

    const res = await editTool.execute(
      {
        file_path: file,
        old_string: 'foo',
        new_string: 'bar',
        replace_all: true,
      },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    expect(String(res.content)).toMatch(/3 occurrences/);
    expect(await readFile(file, 'utf8')).toBe('bar a\nbar b\nbar c\n');
  });

  it('returns isError when old_string === new_string', async () => {
    const file = path.join(sandbox, 'same.txt');
    await writeFile(file, 'anything\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: 'anything', new_string: 'anything' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    // File must be untouched.
    expect(await readFile(file, 'utf8')).toBe('anything\n');
  });

  it('returns isError when old_string is not found', async () => {
    const file = path.join(sandbox, 'notfound.txt');
    await writeFile(file, 'alpha beta\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: 'gamma', new_string: 'delta' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/not found/i);
    expect(await readFile(file, 'utf8')).toBe('alpha beta\n');
  });

  it('returns isError naming the count for an ambiguous match without replace_all', async () => {
    const file = path.join(sandbox, 'ambiguous.txt');
    await writeFile(file, 'dup here\ndup there\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: 'dup', new_string: 'uniq' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/2 occurrences/);
    expect(await readFile(file, 'utf8')).toBe('dup here\ndup there\n');
  });

  it('returns isError for an empty old_string', async () => {
    const file = path.join(sandbox, 'emptyold.txt');
    await writeFile(file, 'content\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: '', new_string: 'x' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('content\n');
  });

  it('returns isError for a binary target', async () => {
    const file = path.join(sandbox, 'edit.bin');
    await writeFile(file, Buffer.from([0x41, 0x00, 0x42]));

    const res = await editTool.execute(
      { file_path: file, old_string: 'A', new_string: 'B' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/binary/i);
  });

  it('returns isError for a missing file', async () => {
    const res = await editTool.execute(
      {
        file_path: path.join(sandbox, 'ghost.txt'),
        old_string: 'a',
        new_string: 'b',
      },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/does not exist/i);
  });
});

// ---------------------------------------------------------------------------
// Containment (resolveWithin behavior through the tools)
// ---------------------------------------------------------------------------

describe('path containment', () => {
  it('rejects absolute paths outside cwd for Read, Write and Edit, naming allowed roots', async () => {
    const outside = await makeSandbox('bpt-fs-outside-');
    const target = path.join(outside, 'secret.txt');
    await writeFile(target, 'secret\n', 'utf8');
    const ctx = makeCtx(sandbox);

    const readRes = await readTool.execute({ file_path: target }, ctx);
    const writeRes = await writeTool.execute(
      { file_path: target, content: 'x' },
      ctx,
    );
    const editRes = await editTool.execute(
      { file_path: target, old_string: 'secret', new_string: 'public' },
      ctx,
    );

    for (const res of [readRes, writeRes, editRes]) {
      expect(res.isError).toBe(true);
      const content = String(res.content);
      expect(content).toMatch(/outside the allowed directories/i);
      // The deny message names the allowed roots (at least the cwd).
      expect(content).toContain(sandbox);
    }
    // The outside file must be untouched by the denied Write/Edit.
    expect(await readFile(target, 'utf8')).toBe('secret\n');
  });

  it('allows access inside an additionalDirectories entry', async () => {
    const extra = await makeSandbox('bpt-fs-extra-');
    const ctx = makeCtx(sandbox, { additionalDirectories: [extra] });
    const target = path.join(extra, 'shared.txt');

    const writeRes = await writeTool.execute(
      { file_path: target, content: 'shared data' },
      ctx,
    );
    expect(writeRes.isError).toBeFalsy();

    const readRes = await readTool.execute({ file_path: target }, ctx);
    expect(readRes.isError).toBeFalsy();
    expect(readRes.content).toBe(catLine(1, 'shared data'));

    const editRes = await editTool.execute(
      { file_path: target, old_string: 'shared', new_string: 'common' },
      ctx,
    );
    expect(editRes.isError).toBeFalsy();
    expect(await readFile(target, 'utf8')).toBe('common data');
  });

  it('enforces path.sep boundaries: a sibling dir sharing a name prefix is NOT contained', async () => {
    // cwd = <root>/proj ; sibling = <root>/projX — plain startsWith on the
    // root string would wrongly admit the sibling.
    const root = await makeSandbox('bpt-fs-prefix-');
    const cwd = path.join(root, 'proj');
    const sibling = path.join(root, 'projX');
    await mkdir(cwd);
    await mkdir(sibling);
    const target = path.join(sibling, 'file.txt');
    await writeFile(target, 'sibling content\n', 'utf8');
    const ctx = makeCtx(cwd);

    const readRes = await readTool.execute({ file_path: target }, ctx);
    expect(readRes.isError).toBe(true);
    expect(String(readRes.content)).toMatch(/outside the allowed directories/i);

    const writeRes = await writeTool.execute(
      { file_path: target, content: 'clobber' },
      ctx,
    );
    expect(writeRes.isError).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('sibling content\n');
  });

  it('boundary check also applies to additionalDirectories entries', async () => {
    const root = await makeSandbox('bpt-fs-prefix2-');
    const allowed = path.join(root, 'data');
    const lookalike = path.join(root, 'database');
    await mkdir(allowed);
    await mkdir(lookalike);
    await writeFile(path.join(lookalike, 'f.txt'), 'x\n', 'utf8');
    const ctx = makeCtx(sandbox, { additionalDirectories: [allowed] });

    const res = await readTool.execute(
      { file_path: path.join(lookalike, 'f.txt') },
      ctx,
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/outside the allowed directories/i);
  });

  it('relative traversal escaping cwd is rejected', async () => {
    const outside = await makeSandbox('bpt-fs-escape-');
    const rel = path.relative(sandbox, path.join(outside, 'esc.txt'));
    // Sanity: the relative path really escapes the sandbox.
    expect(rel.startsWith('..')).toBe(true);

    const res = await writeTool.execute(
      { file_path: rel, content: 'escaped' },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/outside the allowed directories/i);
  });
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe('abort handling', () => {
  it('Read rejects with AbortError on a pre-aborted signal (no isError payload)', async () => {
    const file = path.join(sandbox, 'abort-read.txt');
    await writeFile(file, 'data\n', 'utf8');

    await expect(
      readTool.execute({ file_path: file }, abortedCtx(sandbox)),
    ).rejects.toBeInstanceOf(AbortError);
  });

  it('Write rejects with AbortError on a pre-aborted signal and writes nothing', async () => {
    const file = path.join(sandbox, 'abort-write.txt');

    await expect(
      writeTool.execute(
        { file_path: file, content: 'never' },
        abortedCtx(sandbox),
      ),
    ).rejects.toBeInstanceOf(AbortError);

    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('Edit rejects with AbortError on a pre-aborted signal and leaves the file intact', async () => {
    const file = path.join(sandbox, 'abort-edit.txt');
    await writeFile(file, 'original\n', 'utf8');

    await expect(
      editTool.execute(
        { file_path: file, old_string: 'original', new_string: 'changed' },
        abortedCtx(sandbox),
      ),
    ).rejects.toBeInstanceOf(AbortError);

    expect(await readFile(file, 'utf8')).toBe('original\n');
  });
});
