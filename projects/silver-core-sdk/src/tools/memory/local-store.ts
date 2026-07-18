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

import { Buffer } from 'node:buffer';
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

// Real-filesystem path limits: a segment over NAME_MAX (255 bytes on Linux /
// macOS) or a whole path over PATH_MAX (4096 on Linux) makes fs throw a raw
// ENAMETOOLONG. Bounding them here turns an overly long virtual path into a
// structured MemoryToolError instead (audit r4 U4-7).
const MAX_PATH_COMPONENT_BYTES = 255;
const MAX_PATH_BYTES = 4096;

// Monotonic suffix so concurrent atomic writes in one process never collide on
// a temp name (audit r4 U4-4).
let tmpWriteCounter = 0;

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
    // Path length bound (audit r4 U4-7): fail with a structured error rather
    // than letting fs raise a raw ENAMETOOLONG errno for an over-long path.
    if (Buffer.byteLength(full, 'utf8') > MAX_PATH_BYTES) {
      throw new MemoryToolError(
        `Error: Path ${virtualPath} is too long (exceeds ${MAX_PATH_BYTES} bytes)`,
      );
    }
    for (const seg of rel === '' ? [] : rel.split('/')) {
      if (Buffer.byteLength(seg, 'utf8') > MAX_PATH_COMPONENT_BYTES) {
        throw new MemoryToolError(
          `Error: Path ${virtualPath} has a segment longer than ${MAX_PATH_COMPONENT_BYTES} bytes`,
        );
      }
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
      const dir = path.dirname(real);
      await fs.mkdir(dir, { recursive: true, mode: DIR_CREATE_MODE });
      // Atomic write (audit r4 U4-4): write to a sibling temp file then rename
      // over the target, so a crash / abort / ENOSPC mid-write leaves the
      // ORIGINAL file intact instead of a truncated or empty one — a bare
      // fs.writeFile truncates in place before the new bytes land. The temp
      // name is dot-prefixed (excluded from listings) and process/counter
      // -unique to avoid concurrent collisions; it is removed on failure.
      const tmp = path.join(
        dir,
        `.${path.basename(real)}.${process.pid}.${(tmpWriteCounter += 1)}.tmp`,
      );
      try {
        await fs.writeFile(tmp, content, { encoding: 'utf8', mode: FILE_CREATE_MODE });
        await fs.rename(tmp, real);
      } catch (err) {
        await fs.rm(tmp, { force: true }).catch(() => {});
        throw err;
      }
    },
    async delete(p): Promise<void> {
      await fs.rm(await toReal(p), { recursive: true, force: false });
    },
    async rename(oldP, newP): Promise<void> {
      const realOld = await toReal(oldP);
      const realNew = await toReal(newP);
      await fs.mkdir(path.dirname(realNew), { recursive: true, mode: DIR_CREATE_MODE });
      // No-clobber rename (audit r4 Sfs-2): the engine checks the destination
      // is free, but fs.rename would still silently overwrite a file created
      // in the TOCTOU window before this call. link() is atomic and fails
      // EEXIST when the destination already exists, closing the window for
      // files; then drop the source name. Directories cannot be hardlinked
      // (link throws EPERM) and some filesystems reject link outright — fall
      // back to fs.rename there (its own no-clobber for non-empty dirs still
      // holds).
      try {
        await fs.link(realOld, realNew);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new MemoryToolError(`Error: The destination ${newP} already exists`);
        }
        await fs.rename(realOld, realNew);
        return;
      }
      await fs.unlink(realOld);
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
