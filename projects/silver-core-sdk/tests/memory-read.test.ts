/**
 * MemoryStore.read (gap G4, 0.69.0): host-facing raw accessor — exact bytes
 * back, no reference decoration — while the six model-facing commands stay
 * byte-for-byte unchanged.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFilesystemMemoryStore } from '../src/tools/memory/local-store.js';
import { MemoryPathError } from '../src/tools/memory/paths.js';

const freshStore = () =>
  createLocalFilesystemMemoryStore(mkdtempSync(join(tmpdir(), 'mem-read-')));

describe('MemoryStore.read', () => {
  it('round-trips exact content, including blank and trailing lines', async () => {
    const store = freshStore();
    const content = 'line one\n\n  indented\nlast without newline';
    await store.create('/memories/notes.md', content);
    expect(await store.read!('/memories/notes.md')).toBe(content);
  });

  it('returns raw bytes where view decorates', async () => {
    const store = freshStore();
    await store.create('/memories/a.md', 'alpha\nbeta\n');
    const viewed = await store.view('/memories/a.md');
    expect(viewed).toContain('with line numbers');
    expect(viewed).toContain('\t');
    expect(await store.read!('/memories/a.md')).toBe('alpha\nbeta\n');
  });

  it('content that LOOKS like view decoration survives the round-trip', async () => {
    const store = freshStore();
    const tricky = "Here's the content of /memories/x.md with line numbers:\n     1\tnot a real header\n";
    await store.create('/memories/tricky.md', tricky);
    expect(await store.read!('/memories/tricky.md')).toBe(tricky);
  });

  it('throws the reference missing-path error for an absent file', async () => {
    const store = freshStore();
    await expect(store.read!('/memories/nope.md')).rejects.toThrow(
      'The path /memories/nope.md does not exist. Please provide a valid path.',
    );
  });

  it('rejects directories', async () => {
    const store = freshStore();
    await store.create('/memories/dir/file.md', 'x');
    await expect(store.read!('/memories/dir')).rejects.toThrow(
      'is a directory; read applies to files only',
    );
  });

  it('validates paths like every other command (R4)', async () => {
    const store = freshStore();
    await expect(store.read!('/etc/passwd')).rejects.toThrow(MemoryPathError);
    await expect(store.read!('/memories/../escape')).rejects.toThrow(MemoryPathError);
  });
});
