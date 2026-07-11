/**
 * Memory tool golden-format tests (spec R1 acceptance): every command's
 * success and error return strings byte-compared against the official
 * memory-tool docs' reference formats, driven through the REAL tool execute
 * path (zod parse -> R4 validation -> local-filesystem store).
 */

import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLocalFilesystemMemoryStore } from '../src/tools/memory/index.js';
import { createMemoryTool } from '../src/tools/memory/memory-tool.js';
import type { MemoryStore } from '../src/types.js';
import type { BuiltinTool, ToolContext, ToolResultPayload } from '../src/internal/contracts.js';

let baseDir: string;
let store: MemoryStore;
let tool: BuiltinTool;

function ctx(): ToolContext {
  return {
    cwd: baseDir,
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
  };
}

async function run(input: Record<string, unknown>): Promise<ToolResultPayload> {
  return await tool.execute(input, ctx());
}

async function ok(input: Record<string, unknown>): Promise<string> {
  const res = await run(input);
  expect(res.isError, `unexpected error: ${String(res.content)}`).not.toBe(true);
  return res.content as string;
}

async function err(input: Record<string, unknown>): Promise<string> {
  const res = await run(input);
  expect(res.isError, `expected an error, got: ${String(res.content)}`).toBe(true);
  return res.content as string;
}

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'bpt-memory-'));
  store = createLocalFilesystemMemoryStore(baseDir);
  tool = createMemoryTool(store);
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('memory golden: view', () => {
  it('file content with 6-char right-aligned line numbers (docs example bytes)', async () => {
    await ok({ command: 'create', path: '/memories/notes.txt', file_text: 'Hello World\nThis is line two' });
    expect(await ok({ command: 'view', path: '/memories/notes.txt' })).toBe(
      "Here's the content of /memories/notes.txt with line numbers:\n" +
        '     1\tHello World\n' +
        '     2\tThis is line two',
    );
  });

  it('line numbers stay right-aligned into 2+ digits', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `L${i + 1}`).join('\n');
    await ok({ command: 'create', path: '/memories/many.txt', file_text: lines });
    const out = await ok({ command: 'view', path: '/memories/many.txt' });
    expect(out).toContain('\n     9\tL9\n    10\tL10\n');
  });

  it('view_range slices with true numbering; -1 means end of file', async () => {
    await ok({ command: 'create', path: '/memories/n.txt', file_text: 'l1\nl2\nl3\nl4\nl5' });
    expect(await ok({ command: 'view', path: '/memories/n.txt', view_range: [2, 3] })).toBe(
      "Here's the content of /memories/n.txt with line numbers:\n     2\tl2\n     3\tl3",
    );
    expect(await ok({ command: 'view', path: '/memories/n.txt', view_range: [4, -1] })).toBe(
      "Here's the content of /memories/n.txt with line numbers:\n     4\tl4\n     5\tl5",
    );
  });

  it('directory listing: docs header, du-style size + tab + path lines', async () => {
    await ok({ command: 'create', path: '/memories/a.txt', file_text: 'x'.repeat(1536) });
    await ok({ command: 'create', path: '/memories/b.txt', file_text: 'y'.repeat(2048) });
    const out = await ok({ command: 'view', path: '/memories' });
    const lines = out.split('\n');
    expect(lines[0]).toBe(
      "Here're the files and directories up to 2 levels deep in /memories, " +
        'excluding hidden items and node_modules:',
    );
    expect(lines[1]).toMatch(/^\S+\t\/memories$/);
    expect(lines[2]).toBe('1.5K\t/memories/a.txt');
    expect(lines[3]).toBe('2K\t/memories/b.txt');
  });

  it('directory listing is 2 levels deep, dirs marked with a trailing slash', async () => {
    await ok({ command: 'create', path: '/memories/sub/inner.txt', file_text: 'x' });
    await ok({ command: 'create', path: '/memories/sub/deep/toodeep.txt', file_text: 'y' });
    const out = await ok({ command: 'view', path: '/memories' });
    expect(out).toMatch(/\t\/memories\/sub\/$/m);
    expect(out).toMatch(/\t\/memories\/sub\/inner\.txt$/m);
    expect(out).toMatch(/\t\/memories\/sub\/deep\/$/m);
    expect(out).not.toContain('toodeep.txt');
  });

  it('hidden files and node_modules are excluded from listings', async () => {
    await ok({ command: 'create', path: '/memories/visible.txt', file_text: 'v' });
    await writeFile(join(baseDir, 'memories', '.hidden'), 'h');
    await mkdir(join(baseDir, 'memories', 'node_modules'), { recursive: true });
    const out = await ok({ command: 'view', path: '/memories' });
    // The header itself says "excluding hidden items and node_modules";
    // assert on entry lines, not the whole payload.
    expect(out).not.toContain('/memories/.hidden');
    expect(out).not.toContain('/memories/node_modules');
    expect(out).toContain('/memories/visible.txt');
  });

  it('missing path returns the docs message (is_error)', async () => {
    expect(await err({ command: 'view', path: '/memories/absent.txt' })).toBe(
      'The path /memories/absent.txt does not exist. Please provide a valid path.',
    );
  });

  it('a file beyond 999,999 lines returns the docs line-limit error', async () => {
    await ok({
      command: 'create',
      path: '/memories/huge.txt',
      file_text: 'x\n'.repeat(1_000_000),
    });
    expect(await err({ command: 'view', path: '/memories/huge.txt' })).toBe(
      'File /memories/huge.txt exceeds maximum line limit of 999,999 lines.',
    );
  });
});

describe('memory golden: create', () => {
  it('success string', async () => {
    expect(await ok({ command: 'create', path: '/memories/new.txt', file_text: 'x' })).toBe(
      'File created successfully at: /memories/new.txt',
    );
  });

  it('existing file returns the docs error (reference default)', async () => {
    await ok({ command: 'create', path: '/memories/dup.txt', file_text: '1' });
    expect(await err({ command: 'create', path: '/memories/dup.txt', file_text: '2' })).toBe(
      'Error: File /memories/dup.txt already exists',
    );
  });

  it('createOverwrite opt-in flips create to overwrite (spec R1 configurable)', async () => {
    const ovStore = createLocalFilesystemMemoryStore(baseDir, { createOverwrite: true });
    const ovTool = createMemoryTool(ovStore);
    await ovTool.execute({ command: 'create', path: '/memories/o.txt', file_text: 'old' }, ctx());
    const res = await ovTool.execute(
      { command: 'create', path: '/memories/o.txt', file_text: 'new' },
      ctx(),
    );
    expect(res.isError).not.toBe(true);
    expect(res.content).toBe('File created successfully at: /memories/o.txt');
    const view = await ovStore.view('/memories/o.txt');
    expect(view).toContain('new');
    expect(view).not.toContain('old');
  });

  it('a directory path still refuses create even with overwrite on', async () => {
    const ovStore = createLocalFilesystemMemoryStore(baseDir, { createOverwrite: true });
    const ovTool = createMemoryTool(ovStore);
    await ovTool.execute({ command: 'create', path: '/memories/d/f.txt', file_text: 'x' }, ctx());
    const res = await ovTool.execute(
      { command: 'create', path: '/memories/d', file_text: 'clobber' },
      ctx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content).toBe('Error: File /memories/d already exists');
  });
});

describe('memory golden: str_replace', () => {
  it('success message with the +-2-line numbered snippet', async () => {
    await ok({
      command: 'create',
      path: '/memories/p.txt',
      file_text: 'l1\nl2\nFavorite color: blue\nl4\nl5\nl6',
    });
    expect(
      await ok({
        command: 'str_replace',
        path: '/memories/p.txt',
        old_str: 'Favorite color: blue',
        new_str: 'Favorite color: green',
      }),
    ).toBe(
      'The memory file has been edited. Here is the snippet showing the change ' +
        '(with line numbers):\n' +
        '     1\tl1\n     2\tl2\n     3\tFavorite color: green\n     4\tl4\n     5\tl5',
    );
  });

  it('omitted new_str deletes old_str (docs: new_str optional)', async () => {
    await ok({ command: 'create', path: '/memories/d.txt', file_text: 'keep DELETEME keep' });
    await ok({ command: 'str_replace', path: '/memories/d.txt', old_str: ' DELETEME' });
    expect(await ok({ command: 'view', path: '/memories/d.txt' })).toBe(
      "Here's the content of /memories/d.txt with line numbers:\n     1\tkeep keep",
    );
  });

  it('not-found / multiple-occurrence / missing-file docs errors', async () => {
    await ok({ command: 'create', path: '/memories/p.txt', file_text: 'dup\nmid\ndup' });
    expect(
      await err({ command: 'str_replace', path: '/memories/p.txt', old_str: 'absent', new_str: 'x' }),
    ).toBe('No replacement was performed, old_str `absent` did not appear verbatim in /memories/p.txt.');
    expect(
      await err({ command: 'str_replace', path: '/memories/p.txt', old_str: 'dup', new_str: 'x' }),
    ).toBe(
      'No replacement was performed. Multiple occurrences of old_str `dup` in lines: 1, 3. ' +
        'Please ensure it is unique',
    );
    expect(
      await err({ command: 'str_replace', path: '/memories/no.txt', old_str: 'a', new_str: 'b' }),
    ).toBe('Error: The path /memories/no.txt does not exist. Please provide a valid path.');
  });

  it('a directory path gets the file-does-not-exist error (docs directory handling)', async () => {
    await ok({ command: 'create', path: '/memories/dir/f.txt', file_text: 'x' });
    expect(
      await err({ command: 'str_replace', path: '/memories/dir', old_str: 'a', new_str: 'b' }),
    ).toBe('Error: The path /memories/dir does not exist. Please provide a valid path.');
  });
});

describe('memory golden: insert', () => {
  it('success string and insertion semantics (after insert_line; 0 = top)', async () => {
    await ok({ command: 'create', path: '/memories/t.txt', file_text: 'a\nc' });
    expect(await ok({ command: 'insert', path: '/memories/t.txt', insert_line: 1, insert_text: 'b' })).toBe(
      'The file /memories/t.txt has been edited.',
    );
    expect(await ok({ command: 'view', path: '/memories/t.txt' })).toBe(
      "Here's the content of /memories/t.txt with line numbers:\n     1\ta\n     2\tb\n     3\tc",
    );
    await ok({ command: 'insert', path: '/memories/t.txt', insert_line: 0, insert_text: 'top' });
    expect(await ok({ command: 'view', path: '/memories/t.txt', view_range: [1, 1] })).toBe(
      "Here's the content of /memories/t.txt with line numbers:\n     1\ttop",
    );
  });

  it('out-of-range and missing-file docs errors', async () => {
    await ok({ command: 'create', path: '/memories/t.txt', file_text: 'a\nb' });
    expect(await err({ command: 'insert', path: '/memories/t.txt', insert_line: 7, insert_text: 'x' })).toBe(
      'Error: Invalid `insert_line` parameter: 7. It should be within the range of lines of the file: [0, 2]',
    );
    expect(await err({ command: 'insert', path: '/memories/no.txt', insert_line: 0, insert_text: 'x' })).toBe(
      'Error: The path /memories/no.txt does not exist',
    );
  });
});

describe('memory golden: delete + rename', () => {
  it('delete success / missing / root-protection strings', async () => {
    await ok({ command: 'create', path: '/memories/old.txt', file_text: 'x' });
    expect(await ok({ command: 'delete', path: '/memories/old.txt' })).toBe(
      'Successfully deleted /memories/old.txt',
    );
    expect(await err({ command: 'delete', path: '/memories/old.txt' })).toBe(
      'Error: The path /memories/old.txt does not exist',
    );
    expect(await err({ command: 'delete', path: '/memories' })).toBe(
      'Error: Cannot delete the /memories directory itself',
    );
  });

  it('delete removes directories recursively', async () => {
    await ok({ command: 'create', path: '/memories/dir/a.txt', file_text: 'x' });
    await ok({ command: 'create', path: '/memories/dir/sub/b.txt', file_text: 'y' });
    expect(await ok({ command: 'delete', path: '/memories/dir' })).toBe(
      'Successfully deleted /memories/dir',
    );
    expect(await err({ command: 'view', path: '/memories/dir' })).toBe(
      'The path /memories/dir does not exist. Please provide a valid path.',
    );
  });

  it('rename success / missing-source / existing-destination / root strings', async () => {
    await ok({ command: 'create', path: '/memories/draft.txt', file_text: 'text' });
    expect(
      await ok({ command: 'rename', old_path: '/memories/draft.txt', new_path: '/memories/final.txt' }),
    ).toBe('Successfully renamed /memories/draft.txt to /memories/final.txt');
    expect(
      await err({ command: 'rename', old_path: '/memories/draft.txt', new_path: '/memories/x.txt' }),
    ).toBe('Error: The path /memories/draft.txt does not exist');
    await ok({ command: 'create', path: '/memories/other.txt', file_text: 'o' });
    expect(
      await err({ command: 'rename', old_path: '/memories/other.txt', new_path: '/memories/final.txt' }),
    ).toBe('Error: The destination /memories/final.txt already exists');
    expect(
      await err({ command: 'rename', old_path: '/memories', new_path: '/memories/moved' }),
    ).toBe('Error: Cannot rename the /memories directory itself');
  });
});

describe('memory tool: input validation + hardening', () => {
  it('unknown command returns a structured zod error', async () => {
    const res = await run({ command: 'obliterate', path: '/memories' });
    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/^Error: Invalid memory command/);
  });

  it('missing required fields are rejected per command', async () => {
    expect(await err({ command: 'create', path: '/memories/x.txt' })).toMatch(
      /^Error: Invalid memory command/,
    );
    expect(await err({ command: 'insert', path: '/memories/x.txt', insert_text: 'x' })).toMatch(
      /^Error: Invalid memory command/,
    );
  });

  it('a symlink pointing outside the memory root is refused (defense in depth)', async () => {
    const outside = join(baseDir, 'outside');
    await mkdir(outside, { recursive: true });
    await ok({ command: 'create', path: '/memories/seed.txt', file_text: 'x' });
    await symlink(outside, join(baseDir, 'memories', 'link'));
    const res = await run({
      command: 'create',
      path: '/memories/link/pwned.txt',
      file_text: 'x',
    });
    expect(res.isError).toBe(true);
  });
});
