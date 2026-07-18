/**
 * assessMemoryStoreHealth (keeper memo 2026-07-18 §2): the on-demand deep
 * scan behind the black-pool dream trigger. Covers the five memo dimensions:
 * directory waterlines (soft 48 warning), rot (mtime-honest), capacity
 * headroom, supersede-chain integrity, read/write ratio.
 */

import { describe, expect, it } from 'vitest';

import {
  assessMemoryStoreHealth,
  createMemoryHealth,
  DEFAULT_SOFT_WATERLINE,
  type MemoryDirEntry,
  type MemoryEntryStat,
  type MemoryFileOps,
} from '../src/tools/memory/index.js';

const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000;

/** In-memory ops with optional per-file mtimes. */
function opsFrom(
  entries: Record<string, { content: string; mtimeMs?: number }>,
): MemoryFileOps {
  const files = new Map(Object.entries(entries));
  const isDir = (p: string): boolean =>
    p === '/memories' || [...files.keys()].some((f) => f.startsWith(p + '/'));
  return {
    async stat(p): Promise<MemoryEntryStat | null> {
      const f = files.get(p);
      if (f !== undefined) {
        return {
          kind: 'file',
          sizeBytes: Buffer.byteLength(f.content, 'utf8'),
          ...(f.mtimeMs !== undefined ? { mtimeMs: f.mtimeMs } : {}),
        };
      }
      return isDir(p) ? { kind: 'directory', sizeBytes: 0 } : null;
    },
    async list(p): Promise<MemoryDirEntry[]> {
      const seen = new Map<string, MemoryDirEntry>();
      for (const [f, v] of files) {
        if (!f.startsWith(p + '/')) continue;
        const rest = f.slice(p.length + 1);
        const name = rest.split('/')[0]!;
        if (rest.includes('/')) {
          seen.set(name, { name, kind: 'directory', sizeBytes: 0 });
        } else {
          seen.set(name, {
            name,
            kind: 'file',
            sizeBytes: Buffer.byteLength(v.content, 'utf8'),
            ...(v.mtimeMs !== undefined ? { mtimeMs: v.mtimeMs } : {}),
          });
        }
      }
      return [...seen.values()];
    },
    async read(p): Promise<string> {
      return files.get(p)!.content;
    },
    async write(): Promise<void> {},
    async delete(): Promise<void> {},
    async rename(): Promise<void> {},
  };
}

describe('assessMemoryStoreHealth', () => {
  it('directory waterline: soft 48 warning fires per directory, remaining tracks the hard cap', async () => {
    const entries: Record<string, { content: string; mtimeMs?: number }> = {};
    for (let i = 0; i < 48; i += 1) {
      entries[`/memories/full/f${String(i).padStart(2, '0')}.md`] = {
        content: 'x',
        mtimeMs: NOW,
      };
    }
    entries['/memories/light/one.md'] = { content: 'x', mtimeMs: NOW };
    const a = await assessMemoryStoreHealth(opsFrom(entries), { now: () => NOW });
    expect(a.warnDirectories).toEqual(['/memories/full']);
    const full = a.waterlines.find((w) => w.path === '/memories/full')!;
    expect(full.files).toBe(48);
    expect(full.limit).toBe(64);
    expect(full.remaining).toBe(16);
    expect(full.warn).toBe(true);
    const light = a.waterlines.find((w) => w.path === '/memories/light')!;
    expect(light.warn).toBe(false);
    expect(DEFAULT_SOFT_WATERLINE).toBe(48);
    expect(a.capacity.fullestDirectory).toEqual({
      path: '/memories/full',
      files: 48,
      remaining: 16,
    });
  });

  it('rot: stale files counted against staleAfterDays with oldest-first list', async () => {
    const a = await assessMemoryStoreHealth(
      opsFrom({
        '/memories/fresh.md': { content: 'x', mtimeMs: NOW - DAY_MS },
        '/memories/old.md': { content: 'x', mtimeMs: NOW - 45 * DAY_MS },
        '/memories/older.md': { content: 'x', mtimeMs: NOW - 90 * DAY_MS },
      }),
      { now: () => NOW },
    );
    expect(a.staleness).toMatchObject({
      available: true,
      staleAfterDays: 30,
      staleFiles: 2,
      staleList: ['/memories/older.md', '/memories/old.md'],
    });
    if (a.staleness.available) {
      expect(a.staleness.oldestFile?.path).toBe('/memories/older.md');
      expect(a.staleness.oldestFile?.ageDays).toBeCloseTo(90, 5);
    }
  });

  it('rot: a backend without mtimes gets staleness marked unavailable, never guessed', async () => {
    const a = await assessMemoryStoreHealth(
      opsFrom({
        '/memories/a.md': { content: 'x', mtimeMs: NOW },
        '/memories/b.md': { content: 'x' },
      }),
      { now: () => NOW },
    );
    expect(a.staleness.available).toBe(false);
    if (!a.staleness.available) {
      expect(a.staleness.note).toContain('1 of 2');
    }
  });

  it('capacity: largest-file headroom and over-half-cap consolidation candidates', async () => {
    const big = 'y'.repeat(40_000);
    const a = await assessMemoryStoreHealth(
      opsFrom({
        '/memories/big.md': { content: big, mtimeMs: NOW },
        '/memories/small.md': { content: 'tiny', mtimeMs: NOW },
      }),
      { now: () => NOW },
    );
    expect(a.capacity.largestFile).toEqual({ path: '/memories/big.md', sizeBytes: 40_000 });
    expect(a.capacity.largestFileHeadroomBytes).toBe(65_536 - 40_000);
    expect(a.capacity.filesOverHalfByteLimit).toBe(1);
    expect(a.totalBytes).toBe(40_000 + 4);
    expect(a.files).toBe(2);
  });

  it('supersede chain: /memories path references are checked, broken links reported', async () => {
    const a = await assessMemoryStoreHealth(
      opsFrom({
        '/memories/cards/current.md': {
          content: '---\nsupersedes: /memories/cards/old.md\n---\nbody',
          mtimeMs: NOW,
        },
        '/memories/cards/old.md': { content: 'old', mtimeMs: NOW },
        '/memories/cards/dangling.md': {
          content: 'supersedes: /memories/cards/gone.md, /memories/cards/old.md',
          mtimeMs: NOW,
        },
      }),
      { now: () => NOW },
    );
    expect(a.supersede.references).toBe(3);
    expect(a.supersede.broken).toEqual([
      { file: '/memories/cards/dangling.md', target: '/memories/cards/gone.md' },
    ]);
    expect(a.supersede.intact).toBe(false);
  });

  it('read/write ratio comes from the provided counters; null without writes', async () => {
    const counters = createMemoryHealth();
    counters.reads = 9;
    counters.writes = 3;
    const withCounters = await assessMemoryStoreHealth(opsFrom({}), {
      counters,
      now: () => NOW,
    });
    expect(withCounters.readWriteRatio).toBe(3);
    expect(withCounters.counters).toEqual(counters);
    const noWrites = await assessMemoryStoreHealth(opsFrom({}), {
      counters: createMemoryHealth(),
      now: () => NOW,
    });
    expect(noWrites.readWriteRatio).toBeNull();
    const noCounters = await assessMemoryStoreHealth(opsFrom({}), { now: () => NOW });
    expect(noCounters.readWriteRatio).toBeNull();
    expect(noCounters.counters).toBeUndefined();
  });

  it('scan bound: maxEntries truncation is flagged, never silent', async () => {
    const entries: Record<string, { content: string; mtimeMs?: number }> = {};
    for (let i = 0; i < 30; i += 1) {
      entries[`/memories/f${i}.md`] = { content: 'x', mtimeMs: NOW };
    }
    const a = await assessMemoryStoreHealth(opsFrom(entries), {
      maxEntries: 10,
      now: () => NOW,
    });
    expect(a.truncatedScan).toBe(true);
    expect(a.files).toBeLessThanOrEqual(10);
    const full = await assessMemoryStoreHealth(opsFrom(entries), { now: () => NOW });
    expect(full.truncatedScan).toBe(false);
    expect(full.files).toBe(30);
  });

  it('empty tree: clean zeros, staleness available, supersede intact', async () => {
    const a = await assessMemoryStoreHealth(opsFrom({}), { now: () => NOW });
    expect(a.files).toBe(0);
    expect(a.directories).toBe(1);
    expect(a.totalBytes).toBe(0);
    expect(a.staleness.available).toBe(true);
    expect(a.supersede).toEqual({ references: 0, broken: [], intact: true });
    expect(a.capacity.largestFile).toBeNull();
    expect(a.capacity.fullestDirectory).toBeNull();
  });
});
