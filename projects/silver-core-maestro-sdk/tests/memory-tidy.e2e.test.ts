/**
 * Memory tidy example (example 4, "综合整理任务") — e2e on FAKE timers (the
 * assembly-test clock discipline: no real clock, the test drives time).
 * Proves the full shape on the two packages' public surfaces: scheduled
 * dispatch -> health surface read -> fragment merge -> fragment delete ->
 * ledger closeout, against a real on-disk memory tree.
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error plain-JS example module (host-shape proof, no d.ts)
import { runMemoryTidy } from '../examples/memory-tidy.mjs';

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function sandbox(): Promise<{ root: string; memoriesDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'memory-tidy-e2e-'));
  tempDirs.push(root);
  return { root, memoriesDir: join(root, 'memories') };
}

/** Drive fake time until the run settles (bounded — a hang fails the test
 *  instead of spinning forever). */
async function drive<T>(run: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = run.then(
    (v) => {
      settled = true;
      return v;
    },
    (e) => {
      settled = true;
      throw e;
    },
  );
  for (let i = 0; i < 4000 && !settled; i += 1) {
    await vi.advanceTimersByTimeAsync(25);
  }
  expect(settled, 'run did not settle within the driven fake-time budget').toBe(true);
  return tracked;
}

describe('memory tidy example (e2e, fake timers)', () => {
  it('dispatch -> health read -> merge fragments -> delete -> ledger closeout', async () => {
    const { root, memoriesDir } = await sandbox();
    await mkdir(join(memoriesDir, 'fragments'), { recursive: true });
    await writeFile(join(memoriesDir, 'fragments', 'note-a.md'), 'alpha fact\n');
    await writeFile(join(memoriesDir, 'fragments', 'note-b.md'), 'beta fact\n');

    const { sessionId, session, result, digestOnDisk } = await drive(
      runMemoryTidy({
        memoriesDir,
        archiveDir: root,
        everyMs: 1_000,
        pollIntervalMs: 25,
        deadlineMs: 60_000,
      }),
    );

    // 台账收口: the tidy pass is one auditable ledger session.
    expect(sessionId).toMatch(/^sched:memory-tidy:/);
    expect(session.state).toBe('done');
    expect(result.summary).toContain('merged 2 fragment(s)');

    // 读健康面: the executor consumed the assessment before touching the store.
    expect(result.health.files).toBe(2);
    expect(result.merged).toBe(2);

    // 归并写卡: one digest card carrying both fragment bodies.
    const digest = await readFile(digestOnDisk, 'utf8');
    expect(digest).toContain('# Memory digest');
    expect(digest).toContain('alpha fact');
    expect(digest).toContain('beta fact');

    // 删碎片: the merged fragments are gone from disk.
    await expect(stat(join(memoriesDir, 'fragments', 'note-a.md'))).rejects.toThrow();
    await expect(stat(join(memoriesDir, 'fragments', 'note-b.md'))).rejects.toThrow();
  });

  it('healthy store: the pass closes out with nothing to tidy and creates no digest', async () => {
    const { root, memoriesDir } = await sandbox();
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, 'MEMORY.md'), '# index\n');

    const { session, result, digestOnDisk } = await drive(
      runMemoryTidy({
        memoriesDir,
        archiveDir: root,
        everyMs: 1_000,
        pollIntervalMs: 25,
        deadlineMs: 60_000,
      }),
    );

    expect(session.state).toBe('done');
    expect(result.merged).toBe(0);
    expect(result.summary).toContain('nothing to tidy');
    await expect(stat(digestOnDisk)).rejects.toThrow();
  });
});

describe('audit r2 P1 locks: full-content merge + digest preservation', () => {
  it('a fragment larger than the 16k view limit is merged WITHOUT truncation', async () => {
    const { root, memoriesDir } = await sandbox();
    await mkdir(join(memoriesDir, 'fragments'), { recursive: true });
    const big = 'x'.repeat(20_000) + '\nTAIL-MARKER-BEYOND-VIEW\n';
    await writeFile(join(memoriesDir, 'fragments', 'big.md'), big);
    const { session, digestOnDisk } = await drive(
      runMemoryTidy({ memoriesDir, archiveDir: root, everyMs: 1_000, pollIntervalMs: 25, deadlineMs: 60_000 }),
    );
    expect(session.state).toBe('done');
    // The old view-based merge dropped everything past ~16k: the tail marker
    // is the proof the FULL content reached the digest.
    const digestBody = await readFile(digestOnDisk, 'utf8');
    expect(digestBody).toContain('TAIL-MARKER-BEYOND-VIEW');
  });

  it('a second tidy pass EXTENDS the digest instead of destroying the first consolidation', async () => {
    const { root, memoriesDir } = await sandbox();
    await mkdir(join(memoriesDir, 'fragments'), { recursive: true });
    await writeFile(join(memoriesDir, 'fragments', 'first.md'), 'first-generation fact\n');
    await drive(runMemoryTidy({ memoriesDir, archiveDir: root, everyMs: 1_000, pollIntervalMs: 25, deadlineMs: 60_000 }));
    await writeFile(join(memoriesDir, 'fragments', 'second.md'), 'second-generation fact\n');
    const { digestOnDisk } = await drive(
      runMemoryTidy({ memoriesDir, archiveDir: join(root, 'run2'), everyMs: 1_000, pollIntervalMs: 25, deadlineMs: 60_000 }),
    );
    const digestBody = await readFile(digestOnDisk, 'utf8');
    expect(digestBody).toContain('first-generation fact'); // history preserved
    expect(digestBody).toContain('second-generation fact');
  });
});
