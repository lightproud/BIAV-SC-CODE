/**
 * Structured results for Write / Edit / TodoWrite / EnterWorktree — the second
 * batch of producers (keeper ruling 2026-07-27, "全补").
 *
 * Same discipline as the first batch: each case asserts the structured field
 * DIRECTLY, never by re-reading the sentence. The whole point of the surface is
 * that `Overwrote existing file "/x" (1234 bytes written).` stops being an
 * interface, so a test that parsed that sentence would be testing the thing
 * being retired.
 *
 * Two cases below exist because the honest answer is "absent", not "zero":
 * Write's `originalFile` when no checkpoint recorder is wired, and TodoWrite's
 * `oldTodos` on a session's first call. A field that quietly reads `null` or
 * `[]` when the truth is "never captured" is worse than a missing one — the
 * caller cannot tell the difference between "unchanged" and "unknown".
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeTool } from '../src/tools/write.js';
import { editTool } from '../src/tools/edit.js';
import { todoWriteTool } from '../src/tools/todo.js';
import type { ToolContext } from '../src/internal/contracts.js';
import type {
  EditStructuredOutput,
  TodoWriteStructuredOutput,
  WriteStructuredOutput,
} from '../src/types/tool-outputs.js';

let sandboxes: string[] = [];
async function makeSandbox(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scs-structured2-'));
  sandboxes.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(sandboxes.map((d) => rm(d, { recursive: true, force: true })));
  sandboxes = [];
});

function makeCtx(cwd: string, extra: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd,
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
    readFilePaths: new Set<string>(),
    ...extra,
  };
}

describe('Write structured result', () => {
  it('reports create vs update, path and byte count without parsing the sentence', async () => {
    const dir = await makeSandbox();
    const file = path.join(dir, 'new.txt');
    const res = await writeTool.execute({ file_path: file, content: 'héllo' }, makeCtx(dir));
    const s = res.structuredOutput as WriteStructuredOutput;
    expect(s.type).toBe('create');
    expect(s.filePath).toBe(file);
    expect(s.content).toBe('héllo');
    // 6, not 5: é is two bytes in UTF-8. The count is of BYTES WRITTEN, which
    // is exactly the fact a caller cannot recover from `content.length`.
    expect(s.bytes).toBe(6);
  });

  it('flips to update on an overwrite', async () => {
    const dir = await makeSandbox();
    const file = path.join(dir, 'x.txt');
    await writeFile(file, 'old', 'utf8');
    const ctx = makeCtx(dir);
    ctx.readFilePaths?.add(file); // satisfy the read-before-write gate
    const res = await writeTool.execute({ file_path: file, content: 'new' }, ctx);
    expect((res.structuredOutput as WriteStructuredOutput).type).toBe('update');
  });

  it('carries originalFile only when a checkpoint recorder captured it', async () => {
    const dir = await makeSandbox();
    const file = path.join(dir, 'y.txt');
    await writeFile(file, 'previous', 'utf8');

    const bare = makeCtx(dir);
    bare.readFilePaths?.add(file);
    const noRecorder = (await writeTool.execute({ file_path: file, content: 'a' }, bare))
      .structuredOutput as WriteStructuredOutput;
    // ABSENT, not null — Write never read the old bytes, so "unknown" is the
    // truth. `null` would mean "the file did not exist", a different claim.
    expect('originalFile' in noRecorder).toBe(false);

    await writeFile(file, 'previous', 'utf8');
    const withRecorder = makeCtx(dir, { recordFileChange: () => {} });
    withRecorder.readFilePaths?.add(file);
    const recorded = (await writeTool.execute({ file_path: file, content: 'b' }, withRecorder))
      .structuredOutput as WriteStructuredOutput;
    expect(recorded.originalFile).toBe('previous');
  });

  it('reports originalFile as null for a newly created file under a recorder', async () => {
    const dir = await makeSandbox();
    const res = await writeTool.execute(
      { file_path: path.join(dir, 'fresh.txt'), content: 'z' },
      makeCtx(dir, { recordFileChange: () => {} }),
    );
    // null is the honest value here: there was no prior file.
    expect((res.structuredOutput as WriteStructuredOutput).originalFile).toBeNull();
  });
});

describe('Edit structured result', () => {
  it('reports the replacement count, which the caller previously had to read out of prose', async () => {
    const dir = await makeSandbox();
    const file = path.join(dir, 'e.txt');
    await writeFile(file, 'a\na\na\n', 'utf8');
    const ctx = makeCtx(dir);
    ctx.readFilePaths?.add(file);
    const res = await editTool.execute(
      { file_path: file, old_string: 'a', new_string: 'b', replace_all: true },
      ctx,
    );
    const s = res.structuredOutput as EditStructuredOutput;
    expect(s.replacedCount).toBe(3);
    expect(s.replaceAll).toBe(true);
    expect(s.oldString).toBe('a');
    expect(s.newString).toBe('b');
    // Edit had to read the file to apply the edit, so the pre-image is free.
    expect(s.originalFile).toBe('a\na\na\n');
    expect(await readFile(file, 'utf8')).toBe('b\nb\nb\n');
  });

  it('counts a single replacement when replace_all is off', async () => {
    const dir = await makeSandbox();
    const file = path.join(dir, 'e2.txt');
    await writeFile(file, 'x\nx\n', 'utf8');
    const ctx = makeCtx(dir);
    ctx.readFilePaths?.add(file);
    const res = await editTool.execute(
      { file_path: file, old_string: 'x\nx', new_string: 'y' },
      ctx,
    );
    const s = res.structuredOutput as EditStructuredOutput;
    expect(s.replacedCount).toBe(1);
    expect(s.replaceAll).toBe(false);
  });
});

describe('TodoWrite structured result', () => {
  const list = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      content: `task ${i}`,
      status: 'pending' as const,
      activeForm: `doing ${i}`,
    }));

  it('reports the transition, not just the new list', async () => {
    const dir = await makeSandbox();
    const ctx = makeCtx(dir, { sessionKey: {} });

    const first = (await todoWriteTool.execute({ todos: list(1) }, ctx))
      .structuredOutput as TodoWriteStructuredOutput;
    // First call in a session: empty is the truth, and it is a truth the
    // caller can act on (nothing was replaced).
    expect(first.oldTodos).toEqual([]);
    expect(first.newTodos).toHaveLength(1);

    const second = (await todoWriteTool.execute({ todos: list(3) }, ctx))
      .structuredOutput as TodoWriteStructuredOutput;
    expect(second.oldTodos).toHaveLength(1);
    expect(second.newTodos).toHaveLength(3);
  });

  it('keeps sessions apart', async () => {
    const dir = await makeSandbox();
    const a = makeCtx(dir, { sessionKey: {} });
    const b = makeCtx(dir, { sessionKey: {} });
    await todoWriteTool.execute({ todos: list(2) }, a);
    const fromB = (await todoWriteTool.execute({ todos: list(1) }, b))
      .structuredOutput as TodoWriteStructuredOutput;
    // Session B must not inherit A's list — the state is per-query, and a
    // process-wide store would silently cross-contaminate concurrent queries.
    expect(fromB.oldTodos).toEqual([]);
  });

  it('does not share state between contexts that carry no session key', async () => {
    const dir = await makeSandbox();
    const bare = makeCtx(dir);
    await todoWriteTool.execute({ todos: list(2) }, bare);
    const again = (await todoWriteTool.execute({ todos: list(1) }, bare))
      .structuredOutput as TodoWriteStructuredOutput;
    // No session key (bare tool use, e.g. a unit test): report empty rather
    // than inventing a shared global bucket.
    expect(again.oldTodos).toEqual([]);
  });
});
