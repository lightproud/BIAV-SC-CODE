/**
 * MultiEdit built-in tool: several exact-string replacements to ONE file as a
 * single atomic step. Sequential application on one snapshot (edit N sees edit
 * N-1's result), all-or-nothing on failure (nothing written), a single
 * pre-image recorded for rewind, and the same Read-before-write gate as Edit.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { multiEditTool } from '../src/tools/multiedit.js';
import { AbortError } from '../src/errors.js';
import type { ToolContext } from '../src/internal/contracts.js';

let sandboxes: string[] = [];

async function makeSandbox(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'multiedit-test-'));
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

let sandbox: string;

beforeEach(async () => {
  sandboxes = [];
  sandbox = await makeSandbox();
});

afterEach(async () => {
  await Promise.all(sandboxes.map((d) => rm(d, { recursive: true, force: true })));
  sandboxes = [];
});

describe('MultiEdit tool', () => {
  it('exposes the documented tool metadata', () => {
    expect(multiEditTool.name).toBe('MultiEdit');
    expect(multiEditTool.readOnly).toBe(false);
    expect(multiEditTool.isFileEdit).toBe(true);
  });

  it('applies several edits in order and writes the file once', async () => {
    const file = path.join(sandbox, 'multi.txt');
    await writeFile(file, 'alpha\nbeta\ngamma\n', 'utf8');

    const res = await multiEditTool.execute(
      {
        file_path: file,
        edits: [
          { old_string: 'alpha', new_string: 'ALPHA' },
          { old_string: 'gamma', new_string: 'GAMMA' },
        ],
      },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    expect(String(res.content)).toContain('Applied 2 edits');
    expect(await readFile(file, 'utf8')).toBe('ALPHA\nbeta\nGAMMA\n');
  });

  it('applies edits SEQUENTIALLY: a later edit sees an earlier edit\'s result', async () => {
    const file = path.join(sandbox, 'seq.txt');
    await writeFile(file, 'const oldName = 1;\nreturn oldName;\n', 'utf8');

    // Edit 1 renames every occurrence to newName; edit 2 then matches text that
    // only exists AFTER edit 1 ran.
    const res = await multiEditTool.execute(
      {
        file_path: file,
        edits: [
          { old_string: 'oldName', new_string: 'newName', replace_all: true },
          { old_string: 'return newName;', new_string: 'return newName + 1;' },
        ],
      },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    expect(await readFile(file, 'utf8')).toBe('const newName = 1;\nreturn newName + 1;\n');
  });

  it('honors replace_all within a single edit and reports the count', async () => {
    const file = path.join(sandbox, 'all.txt');
    await writeFile(file, 'x x x\n', 'utf8');

    const res = await multiEditTool.execute(
      { file_path: file, edits: [{ old_string: 'x', new_string: 'y', replace_all: true }] },
      makeCtx(sandbox),
    );

    expect(res.isError).toBeFalsy();
    expect(String(res.content)).toContain('replaced 3 occurrences');
    expect(await readFile(file, 'utf8')).toBe('y y y\n');
  });

  it('is ATOMIC: a failing edit writes nothing and names the failing index', async () => {
    const file = path.join(sandbox, 'atomic.txt');
    const original = 'one\ntwo\nthree\n';
    await writeFile(file, original, 'utf8');

    const res = await multiEditTool.execute(
      {
        file_path: file,
        edits: [
          { old_string: 'one', new_string: 'ONE' }, // would succeed
          { old_string: 'MISSING', new_string: 'X' }, // fails
          { old_string: 'three', new_string: 'THREE' }, // never reached
        ],
      },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toContain('edit #2');
    // The whole operation rolled back: the file is byte-for-byte the original,
    // NOT half-edited with edit #1 applied.
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('is ATOMIC on a non-unique match without replace_all', async () => {
    const file = path.join(sandbox, 'ambiguous.txt');
    const original = 'dup\ndup\n';
    await writeFile(file, original, 'utf8');

    const res = await multiEditTool.execute(
      { file_path: file, edits: [{ old_string: 'dup', new_string: 'x' }] },
      makeCtx(sandbox),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/2 occurrences/);
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('enforces the read-before-write gate (file untouched when not read)', async () => {
    const file = path.join(sandbox, 'gated.txt');
    const original = 'secret\n';
    await writeFile(file, original, 'utf8');

    // Gate armed (a Set) but this path is NOT in it.
    const res = await multiEditTool.execute(
      { file_path: file, edits: [{ old_string: 'secret', new_string: 'public' }] },
      makeCtx(sandbox, { readFilePaths: new Set<string>() }),
    );

    expect(res.isError).toBe(true);
    expect(String(res.content)).toContain('has not been read yet');
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('records EXACTLY ONE pre-image (the original text) for rewind, and registers the path', async () => {
    const file = path.join(sandbox, 'rewind.txt');
    const original = 'a\nb\nc\n';
    await writeFile(file, original, 'utf8');
    const calls: Array<{ abs: string; preImage: string | null }> = [];
    const readPaths = new Set([file]);

    const res = await multiEditTool.execute(
      {
        file_path: file,
        edits: [
          { old_string: 'a', new_string: 'A' },
          { old_string: 'b', new_string: 'B' },
          { old_string: 'c', new_string: 'C' },
        ],
      },
      gatedCtx(sandbox, file, {
        readFilePaths: readPaths,
        recordFileChange: (abs, preImage) => calls.push({ abs, preImage }),
      }),
    );

    expect(res.isError).toBeFalsy();
    // One snapshot for the whole batch — the ORIGINAL, not a half-edited state.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.abs).toBe(file);
    expect(calls[0]!.preImage).toBe(original);
    // Path registered so a follow-up Write/Edit is not gate-blocked.
    expect(readPaths.has(file)).toBe(true);
  });

  it('rejects an empty edits array', async () => {
    const file = path.join(sandbox, 'empty.txt');
    await writeFile(file, 'x\n', 'utf8');
    const res = await multiEditTool.execute(
      { file_path: file, edits: [] },
      makeCtx(sandbox),
    );
    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/at least one edit/);
  });

  it('rejects a no-op edit (old_string === new_string) atomically', async () => {
    const file = path.join(sandbox, 'noop.txt');
    const original = 'same\n';
    await writeFile(file, original, 'utf8');
    const res = await multiEditTool.execute(
      {
        file_path: file,
        edits: [
          { old_string: 'same', new_string: 'changed' },
          { old_string: 'q', new_string: 'q' },
        ],
      },
      makeCtx(sandbox),
    );
    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/identical/);
    // Structural validation happens up front, before any write.
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('rejects a missing file', async () => {
    const res = await multiEditTool.execute(
      { file_path: path.join(sandbox, 'nope.txt'), edits: [{ old_string: 'a', new_string: 'b' }] },
      makeCtx(sandbox),
    );
    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/does not exist/);
  });

  it('refuses a binary file', async () => {
    const file = path.join(sandbox, 'bin.dat');
    await writeFile(file, Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]));
    const res = await multiEditTool.execute(
      { file_path: file, edits: [{ old_string: '', new_string: 'x' }] },
      makeCtx(sandbox, { readFilePaths: new Set([file]) }),
    );
    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/binary/);
  });

  it('throws AbortError on a pre-aborted signal and leaves the file intact', async () => {
    const file = path.join(sandbox, 'abort.txt');
    const original = 'keep me\n';
    await writeFile(file, original, 'utf8');
    const ac = new AbortController();
    ac.abort();

    await expect(
      multiEditTool.execute(
        { file_path: file, edits: [{ old_string: 'keep me', new_string: 'gone' }] },
        makeCtx(sandbox, { signal: ac.signal, readFilePaths: new Set([file]) }),
      ),
    ).rejects.toBeInstanceOf(AbortError);
    expect(await readFile(file, 'utf8')).toBe(original);
  });
});
