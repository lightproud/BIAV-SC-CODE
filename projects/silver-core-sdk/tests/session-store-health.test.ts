/**
 * Sessions-domain health scan (audit P1-S1). Salvaged intact from the retired
 * cards-prescription suite (2.0.0 cards removal): these tests never depended
 * on cards — they shared a file by review-batch accident.
 */

import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assessSessionStoreHealth } from '../src/sessions/health.js';

describe('assessSessionStoreHealth (audit P1-S1)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bpt-sess-health-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const NOW = 1_800_000_000_000;
  const DAY = 86_400_000;

  it('reports absent-dir as unavailable, never a fabricated zero', async () => {
    const r = await assessSessionStoreHealth({ sessionDir: join(dir, 'nope') });
    expect(r.available).toBe(false);
    if (!r.available) expect(r.note).toContain('external sessionStore');
  });

  it('counts sessions, bytes, staleness and orphan checkpoint dirs', async () => {
    await writeFile(join(dir, 'fresh.jsonl'), 'x'.repeat(100));
    await writeFile(join(dir, 'old.jsonl'), 'y'.repeat(50));
    // The clock is injected, so BOTH mtimes must be set relative to NOW —
    // a real-clock mtime would land 30+ virtual days in NOW's past.
    const freshSec = (NOW - 1 * DAY) / 1000;
    await utimes(join(dir, 'fresh.jsonl'), freshSec, freshSec);
    const oldSec = (NOW - 40 * DAY) / 1000;
    await utimes(join(dir, 'old.jsonl'), oldSec, oldSec);
    // checkpoints: one for a live session, one orphan (transcript gone).
    await mkdir(join(dir, 'checkpoints', 'fresh', 'blobs'), { recursive: true });
    await writeFile(join(dir, 'checkpoints', 'fresh', 'blobs', '1.blob'), 'b'.repeat(30));
    await mkdir(join(dir, 'checkpoints', 'ghost'), { recursive: true });
    await writeFile(join(dir, 'checkpoints', 'ghost', 'index.jsonl'), 'z'.repeat(10));

    const r = await assessSessionStoreHealth({ sessionDir: dir, now: () => NOW });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.sessions).toBe(2);
    expect(r.transcriptBytes).toBe(150);
    expect(r.checkpointBytes).toBe(40);
    expect(r.staleSessions).toBe(1);
    expect(r.staleList).toEqual(['old']);
    expect(r.orphanCheckpointDirs).toEqual(['ghost']);
    // Largest folds checkpoint bytes into the owning session.
    expect(r.largest[0]).toEqual({ sessionId: 'fresh', bytes: 130 });
    expect(r.truncatedScan).toBe(false);
  });

  it('a hit scan bound reads as a lower bound, not the whole tree', async () => {
    for (let i = 0; i < 6; i++) {
      await writeFile(join(dir, `s${i}.jsonl`), 'x');
    }
    const r = await assessSessionStoreHealth({ sessionDir: dir, maxEntries: 3 });
    expect(r.available).toBe(true);
    if (r.available) expect(r.truncatedScan).toBe(true);
  });
});
