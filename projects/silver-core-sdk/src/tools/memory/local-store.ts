/**
 * Default local-filesystem MemoryStore (spec R3): maps the virtual
 * `/memories` prefix onto `<basePath>/memories` on disk. For development and
 * single-machine use; a hosting application injects its own store (or its
 * own `MemoryFileOps` backend via createMemoryStore) for anything else.
 *
 * Defense in depth beyond the SDK-layer virtual-path validation (R4):
 *  - the real path is resolved and re-checked against the memory root, and
 *  - a symlink inside the memory tree that points outside it is refused
 *    (realpath walk up to the deepest existing ancestor), so a hostile
 *    `/memories/link -> /etc` cannot turn later writes into /etc writes.
 * Restrictive modes (0o600 files / 0o700 dirs) keep memory content private
 * under permissive umasks, matching the reference local-filesystem helper.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MemoryStore } from '../../internal/contracts.js';
import { MemoryToolError } from '../../errors.js';
import { MEMORY_ROOT } from './paths.js';
import {
  createMemoryStore,
  type CreateMemoryStoreOptions,
  type MemoryDirEntry,
  type MemoryEntryStat,
  type MemoryFileOps,
} from './store.js';

const FILE_CREATE_MODE = 0o600;
const DIR_CREATE_MODE = 0o700;

async function validateNoSymlinkEscape(targetPath: string, memoryRoot: string): Promise<void> {
  const resolvedRoot = await fs.realpath(memoryRoot);
  let current = targetPath;
  for (;;) {
    try {
      const resolved = await fs.realpath(current);
      if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        throw new MemoryToolError(`Error: Path would escape the ${MEMORY_ROOT} directory`);
      }
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = path.dirname(current);
      if (parent === current || current === memoryRoot) return;
      current = parent;
    }
  }
}

/** Node-fs implementation of the storage primitives, rooted at a real
 *  directory. Exported for reuse/testing; most callers want
 *  createLocalFilesystemMemoryStore below. */
export function createLocalMemoryFileOps(memoryRootDir: string): MemoryFileOps {
  const rootAbs = path.resolve(memoryRootDir);

  /** Map a CANONICAL virtual path (validated upstream) to a real one, with
   *  belt-and-braces containment + symlink checks (defense in depth). */
  async function toReal(virtualPath: string): Promise<string> {
    const rel = virtualPath === MEMORY_ROOT ? '' : virtualPath.slice(MEMORY_ROOT.length + 1);
    const full = rel === '' ? rootAbs : path.resolve(rootAbs, rel);
    if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) {
      throw new MemoryToolError(`Error: Path ${virtualPath} would escape the ${MEMORY_ROOT} directory`);
    }
    await fs.mkdir(rootAbs, { recursive: true, mode: DIR_CREATE_MODE });
    await validateNoSymlinkEscape(full, rootAbs);
    return full;
  }

  return {
    async stat(p): Promise<MemoryEntryStat | null> {
      const real = await toReal(p);
      try {
        const st = await fs.stat(real);
        return {
          kind: st.isDirectory() ? 'directory' : 'file',
          sizeBytes: st.size,
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async list(p): Promise<MemoryDirEntry[]> {
      const real = await toReal(p);
      const names = await fs.readdir(real);
      const entries: MemoryDirEntry[] = [];
      for (const name of names) {
        try {
          const st = await fs.stat(path.join(real, name));
          entries.push({
            name,
            kind: st.isDirectory() ? 'directory' : 'file',
            sizeBytes: st.size,
          });
        } catch {
          // Entry vanished between readdir and stat; skip it.
        }
      }
      return entries;
    },
    async read(p): Promise<string> {
      return await fs.readFile(await toReal(p), 'utf8');
    },
    async write(p, content): Promise<void> {
      const real = await toReal(p);
      await fs.mkdir(path.dirname(real), { recursive: true, mode: DIR_CREATE_MODE });
      await fs.writeFile(real, content, { encoding: 'utf8', mode: FILE_CREATE_MODE });
    },
    async delete(p): Promise<void> {
      await fs.rm(await toReal(p), { recursive: true, force: false });
    },
    async rename(oldP, newP): Promise<void> {
      const realOld = await toReal(oldP);
      const realNew = await toReal(newP);
      await fs.mkdir(path.dirname(realNew), { recursive: true, mode: DIR_CREATE_MODE });
      await fs.rename(realOld, realNew);
    },
  };
}

/**
 * The SDK's built-in MemoryStore: virtual `/memories` mapped onto
 * `<baseDir>/memories`. The directory is created lazily on first use.
 */
export function createLocalFilesystemMemoryStore(
  baseDir: string,
  options: CreateMemoryStoreOptions = {},
): MemoryStore {
  return createMemoryStore(
    createLocalMemoryFileOps(path.join(baseDir, 'memories')),
    options,
  );
}
