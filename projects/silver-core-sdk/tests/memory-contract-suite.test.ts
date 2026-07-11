/**
 * MemoryStore contract suite (spec R3 acceptance): the store-agnostic suite
 * passes for (a) the built-in local-filesystem store and (b) a from-scratch
 * in-memory MemoryFileOps backend wrapped by createMemoryStore — proving the
 * suite is implementation-independent and the primitives+engine path inherits
 * the reference behavior. A deliberately broken store fails, proving the
 * suite actually discriminates.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  createLocalFilesystemMemoryStore,
  createMemoryStore,
  memoryStoreContractCheckNames,
  runMemoryStoreContractSuite,
  type MemoryDirEntry,
  type MemoryEntryStat,
  type MemoryFileOps,
} from '../src/tools/memory/index.js';
import type { MemoryStore } from '../src/types.js';

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** A minimal, dependency-free in-memory backend: virtual path -> content. */
function inMemoryFileOps(): MemoryFileOps {
  const files = new Map<string, string>();
  const isDir = (p: string): boolean =>
    p === '/memories' || [...files.keys()].some((f) => f.startsWith(p + '/'));
  return {
    async stat(p): Promise<MemoryEntryStat | null> {
      if (files.has(p)) {
        return { kind: 'file', sizeBytes: Buffer.byteLength(files.get(p)!, 'utf8') };
      }
      return isDir(p) ? { kind: 'directory', sizeBytes: 0 } : null;
    },
    async list(p): Promise<MemoryDirEntry[]> {
      const seen = new Map<string, MemoryDirEntry>();
      for (const [f, content] of files) {
        if (!f.startsWith(p + '/')) continue;
        const rest = f.slice(p.length + 1);
        const name = rest.split('/')[0]!;
        if (rest.includes('/')) {
          seen.set(name, { name, kind: 'directory', sizeBytes: 0 });
        } else {
          seen.set(name, { name, kind: 'file', sizeBytes: Buffer.byteLength(content, 'utf8') });
        }
      }
      return [...seen.values()];
    },
    async read(p): Promise<string> {
      return files.get(p)!;
    },
    async write(p, content): Promise<void> {
      files.set(p, content);
    },
    async delete(p): Promise<void> {
      files.delete(p);
      for (const f of [...files.keys()]) {
        if (f.startsWith(p + '/')) files.delete(f);
      }
    },
    async rename(oldP, newP): Promise<void> {
      if (files.has(oldP)) {
        files.set(newP, files.get(oldP)!);
        files.delete(oldP);
        return;
      }
      for (const f of [...files.keys()]) {
        if (f.startsWith(oldP + '/')) {
          files.set(newP + f.slice(oldP.length), files.get(f)!);
          files.delete(f);
        }
      }
    },
  };
}

describe('runMemoryStoreContractSuite (R3)', () => {
  it('the built-in local-filesystem store passes the full suite', async () => {
    const report = await runMemoryStoreContractSuite(async () => {
      const dir = await mkdtemp(join(tmpdir(), 'bpt-mem-contract-'));
      tempDirs.push(dir);
      return createLocalFilesystemMemoryStore(dir);
    });
    const failures = report.results.filter((r) => !r.ok);
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.total).toBe(memoryStoreContractCheckNames().length);
  });

  it('a from-scratch in-memory MemoryFileOps backend passes the full suite', async () => {
    const report = await runMemoryStoreContractSuite(() =>
      createMemoryStore(inMemoryFileOps()),
    );
    const failures = report.results.filter((r) => !r.ok);
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('a broken store implementation fails the suite (the suite discriminates)', async () => {
    const broken: MemoryStore = {
      view: async () => 'wrong',
      create: async () => 'created, I guess',
      strReplace: async () => 'done',
      insert: async () => 'done',
      delete: async () => 'done',
      rename: async () => 'done',
    };
    const report = await runMemoryStoreContractSuite(() => broken);
    expect(report.passed).toBe(false);
    expect(report.failed).toBeGreaterThan(0);
  });

  it('check names are stable, non-empty identifiers', () => {
    const names = memoryStoreContractCheckNames();
    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(new Set(names).size).toBe(names.length);
  });
});
