/**
 * Audit wave 21 — one file could occupy two slots in a rewind plan.
 *
 * Both the per-turn first-touch dedup and the rewind plan keyed on the RAW
 * absolute path string. `path.resolve` collapses `.`/`..`, but two spellings
 * still name ONE file whenever a symlink is involved, or the filesystem is
 * case-insensitive (macOS / Windows — and a model varies the casing of a path
 * it types constantly). Each spelling got its own plan entry, and the later one
 * carries a MID-TURN pre-image, so the rewind wrote the earliest image and then
 * the mid-turn image over it — leaving the file at a state that existed at no
 * checkpoint, while reporting canRewind:true.
 *
 * permissions/rules.ts already learned this ("the kernel's open() FOLLOWS
 * symlinks"); the test uses a symlink so it proves the mechanism on any host.
 */

import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileCheckpointStore } from '../src/sessions/checkpoints.js';

let base: string;
let work: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'bpt-w21-ckpt-'));
  work = await mkdtemp(join(tmpdir(), 'bpt-w21-work-'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

let sessionSeq = 0;

function store(): FileCheckpointStore {
  const s = new FileCheckpointStore({ sessionDir: base, env: {}, debug: () => {} });
  s.bind(`sess-w21-${(sessionSeq += 1)}`);
  return s;
}

describe('wave21: rewind keys its plan on file identity', () => {
  it('a symlinked second spelling does not resurrect a mid-turn image', async () => {
    const real = join(work, 'real.txt');
    const link = join(work, 'link.txt');
    await writeFile(real, 'ORIGINAL', 'utf8');
    await symlink(real, link);

    const s = store();
    s.beginTurn('turn-1');
    // The tool writes through the link first...
    s.record(link, 'ORIGINAL');
    await writeFile(real, 'MIDDLE', 'utf8');
    // ...then edits the same file under its real name. First-touch-per-turn is
    // supposed to keep only the ORIGINAL pre-image.
    s.record(real, 'MIDDLE');
    await writeFile(real, 'FINAL', 'utf8');

    const res = await s.rewind('turn-1');
    expect(res.canRewind).toBe(true);
    // Before the fix this was 'MIDDLE': two plan entries, the later one
    // (the mid-turn image) applied last.
    expect(await readFile(real, 'utf8')).toBe('ORIGINAL');
    // And the file is named once, not twice.
    expect(res.restoredFiles).toHaveLength(1);
  });

  it('a creation recorded under one spelling is not undone by a modify under another', async () => {
    // Mixed kinds are the dangerous case: one entry says "delete" (created this
    // turn) and the other says "restore". Insertion order alone decided which
    // won, so the file could be left on disk when the checkpoint says it should
    // not exist.
    const real = join(work, 'made.txt');
    const link = join(work, 'made-link.txt');

    const s = store();
    s.beginTurn('turn-1');
    s.record(real, null); // created this turn
    await writeFile(real, 'v1', 'utf8');
    await symlink(real, link);
    s.record(link, 'v1'); // same file, second spelling, mid-turn image
    await writeFile(real, 'v2', 'utf8');

    const res = await s.rewind('turn-1');
    expect(res.canRewind).toBe(true);
    expect(res.deletedFiles).toEqual([real]);
    expect(res.restoredFiles).toEqual([]);
    await expect(readFile(real, 'utf8')).rejects.toThrow();
  });

  // --- negative controls -----------------------------------------------------

  it('two genuinely different files still get their own plan entries', async () => {
    const a = join(work, 'a.txt');
    const b = join(work, 'b.txt');
    await writeFile(a, 'A0', 'utf8');
    await writeFile(b, 'B0', 'utf8');

    const s = store();
    s.beginTurn('turn-1');
    s.record(a, 'A0');
    s.record(b, 'B0');
    await writeFile(a, 'A1', 'utf8');
    await writeFile(b, 'B1', 'utf8');

    const res = await s.rewind('turn-1');
    expect(res.restoredFiles.sort()).toEqual([a, b].sort());
    expect(await readFile(a, 'utf8')).toBe('A0');
    expect(await readFile(b, 'utf8')).toBe('B0');
  });

  it('an ordinary single-spelling turn rewinds exactly as before', async () => {
    const f = join(work, 'plain.txt');
    await writeFile(f, 'V0', 'utf8');
    const s = store();
    s.beginTurn('turn-1');
    s.record(f, 'V0');
    await writeFile(f, 'V1', 'utf8');
    const res = await s.rewind('turn-1');
    expect(res.canRewind).toBe(true);
    expect(res.restoredFiles).toEqual([f]);
    expect(await readFile(f, 'utf8')).toBe('V0');
  });

  it('dryRun still touches nothing', async () => {
    const f = join(work, 'dry.txt');
    await writeFile(f, 'V0', 'utf8');
    const s = store();
    s.beginTurn('turn-1');
    s.record(f, 'V0');
    await writeFile(f, 'V1', 'utf8');
    const res = await s.rewind('turn-1', { dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.restoredFiles).toEqual([f]);
    expect(await readFile(f, 'utf8')).toBe('V1');
  });
});
