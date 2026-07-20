/**
 * Memory mount routing (BPT-EXTENSION, memory governance spec S1).
 *
 * Options.memory.mounts declares which memory subtrees this query may touch
 * and with what rights. Enforcement happens at the SDK tool layer — after R4
 * path validation, BEFORE the store is called — never via prompt discipline:
 *
 *  - a write command whose target is not inside a read-write mount is
 *    rejected with a structured, model-readable error; the MOST SPECIFIC
 *    containing mount decides, so a read-only mount nested inside a
 *    read-write one keeps its subtree protected, and a recursive delete /
 *    rename whose subtree contains a read-only mount is rejected too;
 *  - a path inside no mount at all is rejected for reads too;
 *  - a directory that is a strict ANCESTOR of a mount stays viewable so the
 *    model can navigate to its mounts, but its listing is FILTERED down to
 *    entries on the path to (or inside) a mount — sibling subtrees such as
 *    another user's directory never appear.
 *
 * Mounts are per-query state: the embedder instantiates them from its own
 * session context (e.g. team read-only + this user's directory read-write for
 * a user session; team read-write for a synthesis batch task). No mounts
 * configured -> the whole /memories tree stays read-write (pre-S1 behavior).
 */

import type { MemoryMount } from '../../types.js';
import { ConfigurationError } from '../../errors.js';
import { MEMORY_ROOT, MemoryPathError, validateMemoryPath } from './paths.js';

export type ResolvedMemoryMount = {
  /** Canonical virtual path (validateMemoryPath output). */
  path: string;
  mode: 'read-only' | 'read-write';
};

/** null = no mounts configured (unrestricted, pre-S1 behavior). */
export type ResolvedMemoryMounts = ResolvedMemoryMount[] | null;

/**
 * Validate + canonicalize Options.memory.mounts at query construction time.
 * A malformed mount is a CONSUMER error (ConfigurationError), unlike a bad
 * model-supplied path (tool_result error).
 */
export function resolveMemoryMounts(
  mounts: MemoryMount[] | undefined,
): ResolvedMemoryMounts {
  if (mounts === undefined) return null;
  if (mounts.length === 0) {
    throw new ConfigurationError(
      'options.memory.mounts must not be empty: an empty mount list would make ' +
        'every memory path inaccessible (omit mounts for unrestricted access)',
    );
  }
  return mounts.map((m) => {
    if (m.mode !== 'read-only' && m.mode !== 'read-write') {
      throw new ConfigurationError(
        `options.memory.mounts: invalid mode '${String(m.mode)}' for ${String(
          m.path,
        )} (expected 'read-only' or 'read-write')`,
      );
    }
    let canonical: string;
    try {
      // Trailing slashes collapse in canonicalization, so "/memories/team/"
      // and "/memories/team" declare the same mount.
      canonical = validateMemoryPath(m.path);
    } catch (e) {
      if (e instanceof MemoryPathError) {
        throw new ConfigurationError(
          `options.memory.mounts: invalid mount path ${String(m.path)} — ${e.message}`,
        );
      }
      throw e;
    }
    return { path: canonical, mode: m.mode };
  });
}

/** True when `path` equals `root` or is a descendant of it. */
function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root + '/');
}

/** True when `path` is a strict ancestor of `mountPath` (incl. MEMORY_ROOT). */
function isAncestorOf(path: string, mountPath: string): boolean {
  return path !== mountPath && within(mountPath, path);
}

export type MountReadAccess =
  /** Inside a mount: full read access to the subtree. */
  | 'full'
  /** Strict ancestor of >=1 mount: viewable for navigation, listing filtered. */
  | 'ancestor'
  /** Not reachable from any mount. */
  | null;

/** Read access classification for one canonical path. */
export function mountReadAccess(
  mounts: ResolvedMemoryMounts,
  path: string,
): MountReadAccess {
  if (mounts === null) return 'full';
  if (mounts.some((m) => within(path, m.path))) return 'full';
  if (mounts.some((m) => isAncestorOf(path, m.path))) return 'ancestor';
  return null;
}

/** Most specific mount containing `path`: the longest mount path wins
 *  (nesting); duplicate declarations of the same path with conflicting modes
 *  resolve read-only (restrictive). */
function governingMount(
  mounts: ResolvedMemoryMount[],
  path: string,
): ResolvedMemoryMount | null {
  let best: ResolvedMemoryMount | null = null;
  for (const m of mounts) {
    if (!within(path, m.path)) continue;
    if (
      best === null ||
      m.path.length > best.path.length ||
      (m.path.length === best.path.length && m.mode === 'read-only')
    ) {
      best = m;
    }
  }
  return best;
}

/** True when writes to `path` are allowed. The MOST SPECIFIC containing mount
 *  decides: a read-only mount nested inside a read-write one protects its
 *  subtree instead of being overridden by the ancestor (audit 2026-07-17
 *  H2-3), and a read-write mount nested inside a read-only one keeps working
 *  — the two nesting directions are symmetric. */
export function mountAllowsWrite(mounts: ResolvedMemoryMounts, path: string): boolean {
  if (mounts === null) return true;
  const governing = governingMount(mounts, path);
  return governing !== null && governing.mode === 'read-write';
}

/** True when the subtree rooted at `path` contains a read-only mount — a
 *  recursive delete (or rename-away) of `path` would destroy read-only
 *  territory nested below it even though `path` itself sits in read-write
 *  territory (audit 2026-07-17 H2-3, recursive branch). */
export function subtreeContainsReadOnlyMount(
  mounts: ResolvedMemoryMounts,
  path: string,
): boolean {
  if (mounts === null) return false;
  return mounts.some((m) => m.mode === 'read-only' && within(m.path, path));
}

/** Human/model-readable list of the configured mounts for error messages. */
export function describeMounts(mounts: ResolvedMemoryMount[]): string {
  return mounts.map((m) => `${m.path} (${m.mode})`).join(', ');
}

/** Structured error for a path outside every mount (read or write). */
export function outsideMountsError(mounts: ResolvedMemoryMount[], path: string): string {
  return (
    `Error: ${path} is outside the memory areas mounted for this session. ` +
    `Accessible mounts: ${describeMounts(mounts)}`
  );
}

/** Structured error for a write into read-only territory. */
export function readOnlyMountError(mounts: ResolvedMemoryMount[], path: string): string {
  return (
    `Error: ${path} is read-only in this session — write commands (create, ` +
    `str_replace, insert, delete, rename) are not permitted there. ` +
    `Writable mounts: ${
      mounts.some((m) => m.mode === 'read-write')
        ? mounts
            .filter((m) => m.mode === 'read-write')
            .map((m) => m.path)
            .join(', ')
        : '(none)'
    }`
  );
}

/** Structured error for a recursive write (delete / rename source) whose
 *  target subtree contains read-only mounts. */
export function subtreeReadOnlyMountError(
  mounts: ResolvedMemoryMount[],
  path: string,
): string {
  const ro = mounts
    .filter((m) => m.mode === 'read-only' && within(m.path, path))
    .map((m) => m.path)
    .join(', ');
  return (
    `Error: ${path} contains read-only memory areas in this session (${ro}) — ` +
    `delete and rename cannot remove them. Operate on paths outside the ` +
    `read-only areas instead.`
  );
}

/**
 * Filter a directory-listing view of an ANCESTOR directory down to entries on
 * the path to (or inside) a mount. The listing format is contract-fixed by the
 * golden suite (`header\n` then `size\tabsolutePath[/]` lines), so a
 * line-level filter is stable. The header and the viewed directory's own line
 * always survive.
 */
export function filterAncestorListing(
  mounts: ResolvedMemoryMount[],
  viewedDir: string,
  listing: string,
): string {
  const lines = listing.split('\n');
  const kept: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (i === 0) {
      kept.push(line); // header
      continue;
    }
    const tab = line.indexOf('\t');
    if (tab < 0) {
      kept.push(line);
      continue;
    }
    const rawPath = line.slice(tab + 1);
    const entryPath = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
    if (entryPath === viewedDir || entryPath === MEMORY_ROOT) {
      kept.push(line);
      continue;
    }
    const visible = mounts.some(
      (m) => within(entryPath, m.path) || isAncestorOf(entryPath, m.path),
    );
    if (visible) kept.push(line);
  }
  return kept.join('\n');
}
