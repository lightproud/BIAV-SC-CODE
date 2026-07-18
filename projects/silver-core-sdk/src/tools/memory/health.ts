/**
 * Memory-store health assessment (keeper memo 2026-07-18 §2): an on-demand
 * deep scan of a memory tree that turns "how is the memory doing" into
 * numbers a host can gate on. The black-pool dream mechanism consumes this
 * as its trigger surface (directory waterlines / rot / capacity headroom /
 * supersede-chain integrity), so every dimension degrades HONESTLY: a
 * backend that cannot provide mtimes gets staleness marked unavailable, it
 * is never fabricated.
 *
 * This is deliberately NOT part of the per-run SDKMemoryHealth counters:
 * those are cheap per-query invocation tallies snapshotted synchronously
 * into result metrics; this is an async store scan a host runs when it
 * decides to (e.g. a scheduled tidy-up task). Pass the counters in to get
 * the read/write ratio stamped alongside the scan.
 */

import type { SDKMemoryHealth } from '../../types.js';
import { MEMORY_ROOT } from './paths.js';
import {
  DEFAULT_MEMORY_LIMITS,
  type MemoryFileOps,
  type MemoryLimits,
} from './store.js';

/** Per-directory file-count waterline (limit = R8 maxFilesPerDirectory). */
export type MemoryDirectoryWaterline = {
  /** Virtual directory path. */
  path: string;
  /** Direct FILE children (subdirectories have their own waterline). */
  files: number;
  /** The hard per-directory cap (R8). */
  limit: number;
  /** Slots left before the hard cap (never negative). */
  remaining: number;
  /** files >= softWaterline — the early-warning line (default 48 of 64). */
  warn: boolean;
};

/** Rot report. `available: false` when the backend provides no mtimes —
 *  annotated, never guessed. */
export type MemoryStalenessReport =
  | { available: false; note: string }
  | {
      available: true;
      staleAfterDays: number;
      /** Files older than staleAfterDays. */
      staleFiles: number;
      /** Up to 20 stale paths, oldest first. */
      staleList: string[];
      oldestFile: { path: string; ageDays: number } | null;
    };

/** Supersede-chain integrity: every `supersedes: /memories/...` reference
 *  found in file content, checked against the tree. */
export type MemorySupersedeReport = {
  /** Total /memories-path supersede references found. */
  references: number;
  /** References whose target no longer exists. */
  broken: Array<{ file: string; target: string }>;
  /** true when no reference is broken. */
  intact: boolean;
};

export type MemoryStoreAssessment = {
  /** Files / directories / total UTF-8 bytes scanned. */
  files: number;
  directories: number;
  totalBytes: number;
  /** The limits the assessment judged against. */
  limits: MemoryLimits;
  /** One entry per scanned directory (root included). */
  waterlines: MemoryDirectoryWaterline[];
  /** Paths of directories at/over the soft waterline. */
  warnDirectories: string[];
  capacity: {
    largestFile: { path: string; sizeBytes: number } | null;
    /** maxFileBytes minus the largest file (null when no files). */
    largestFileHeadroomBytes: number | null;
    /** Files over half the per-file byte cap — consolidation candidates. */
    filesOverHalfByteLimit: number;
    fullestDirectory: { path: string; files: number; remaining: number } | null;
  };
  staleness: MemoryStalenessReport;
  supersede: MemorySupersedeReport;
  /** reads/writes from the provided per-run counters; null without counters
   *  or when writes is 0. */
  readWriteRatio: number | null;
  /** Echo of the counters the ratio was computed from, when provided. */
  counters?: SDKMemoryHealth;
  /** True when the scan hit the maxEntries bound — numbers are then a
   *  lower bound, not the whole tree. */
  truncatedScan: boolean;
};

export type AssessMemoryStoreHealthOptions = {
  /** Missing fields take DEFAULT_MEMORY_LIMITS (R8). */
  limits?: Partial<MemoryLimits>;
  /** Early-warning file count per directory. Default 48. */
  softWaterline?: number;
  /** A file counts as stale after this many days without modification.
   *  Default 30. */
  staleAfterDays?: number;
  /** Per-run counters (result.metrics.memoryHealth) for the ratio. */
  counters?: SDKMemoryHealth;
  /** Scan bound (entries visited). Default 4096. */
  maxEntries?: number;
  /** Clock injection (ms since epoch). Default Date.now. */
  now?: () => number;
};

export const DEFAULT_SOFT_WATERLINE = 48;
export const DEFAULT_STALE_AFTER_DAYS = 30;
const DEFAULT_MAX_ENTRIES = 4096;
const STALE_LIST_CAP = 20;
const DAY_MS = 86_400_000;

/** Matches the S6 frontmatter convention `supersedes: <targets>` (comma
 *  separated); only /memories/... path tokens are checkable references. */
const SUPERSEDES_LINE_RE = /^\s*(?:supersedes|superseded_by)\s*:\s*(.+)\s*$/gim;

export async function assessMemoryStoreHealth(
  ops: MemoryFileOps,
  options: AssessMemoryStoreHealthOptions = {},
): Promise<MemoryStoreAssessment> {
  const limits: MemoryLimits = { ...DEFAULT_MEMORY_LIMITS, ...options.limits };
  const softWaterline = options.softWaterline ?? DEFAULT_SOFT_WATERLINE;
  const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = (options.now ?? Date.now)();

  const waterlines: MemoryDirectoryWaterline[] = [];
  const filePaths = new Set<string>();
  const fileMtimes = new Map<string, number>();
  let files = 0;
  let directories = 0;
  let totalBytes = 0;
  let largestFile: { path: string; sizeBytes: number } | null = null;
  let filesOverHalfByteLimit = 0;
  let mtimeMissing = 0;
  let visited = 0;
  let truncatedScan = false;

  // Iterative BFS over the tree; a vanished directory mid-scan is skipped.
  const queue: string[] = [MEMORY_ROOT];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    directories += 1;
    let entries;
    try {
      entries = await ops.list(dir);
    } catch {
      continue;
    }
    let dirFiles = 0;
    for (const entry of entries) {
      if ((visited += 1) > maxEntries) {
        truncatedScan = true;
        break;
      }
      const child = `${dir}/${entry.name}`;
      if (entry.kind === 'directory') {
        queue.push(child);
        continue;
      }
      dirFiles += 1;
      files += 1;
      totalBytes += entry.sizeBytes;
      filePaths.add(child);
      if (largestFile === null || entry.sizeBytes > largestFile.sizeBytes) {
        largestFile = { path: child, sizeBytes: entry.sizeBytes };
      }
      if (entry.sizeBytes > limits.maxFileBytes / 2) filesOverHalfByteLimit += 1;
      if (entry.mtimeMs === undefined) mtimeMissing += 1;
      else fileMtimes.set(child, entry.mtimeMs);
    }
    waterlines.push({
      path: dir,
      files: dirFiles,
      limit: limits.maxFilesPerDirectory,
      remaining: Math.max(0, limits.maxFilesPerDirectory - dirFiles),
      warn: dirFiles >= softWaterline,
    });
    if (truncatedScan) break;
  }

  // Staleness (rot): honest only — every scanned file must carry an mtime.
  let staleness: MemoryStalenessReport;
  if (files === 0) {
    staleness = {
      available: true,
      staleAfterDays,
      staleFiles: 0,
      staleList: [],
      oldestFile: null,
    };
  } else if (mtimeMissing > 0) {
    staleness = {
      available: false,
      note:
        `backend provides no mtime for ${mtimeMissing} of ${files} files — ` +
        'staleness not assessable (MemoryDirEntry.mtimeMs is optional)',
    };
  } else {
    const byAge = [...fileMtimes.entries()].sort((a, b) => a[1] - b[1]);
    const staleCutoff = now - staleAfterDays * DAY_MS;
    const stale = byAge.filter(([, m]) => m < staleCutoff);
    const oldest = byAge[0];
    staleness = {
      available: true,
      staleAfterDays,
      staleFiles: stale.length,
      staleList: stale.slice(0, STALE_LIST_CAP).map(([p]) => p),
      oldestFile:
        oldest === undefined
          ? null
          : { path: oldest[0], ageDays: Math.max(0, (now - oldest[1]) / DAY_MS) },
    };
  }

  // Supersede-chain integrity: scan file content for the S6 frontmatter
  // convention. Only cap-sized files are read (an injected store may hold
  // bigger ones; reading those is not this scan's job).
  const supersede: MemorySupersedeReport = { references: 0, broken: [], intact: true };
  for (const filePath of filePaths) {
    try {
      const st = await ops.stat(filePath);
      if (st === null || st.kind !== 'file' || st.sizeBytes > limits.maxFileBytes) continue;
      const content = await ops.read(filePath);
      for (const match of content.matchAll(SUPERSEDES_LINE_RE)) {
        for (const raw of (match[1] ?? '').split(',')) {
          const target = raw.trim();
          if (!target.startsWith(`${MEMORY_ROOT}/`)) continue;
          supersede.references += 1;
          if (!filePaths.has(target)) {
            let exists = false;
            try {
              exists = (await ops.stat(target)) !== null;
            } catch {
              exists = false;
            }
            if (!exists) supersede.broken.push({ file: filePath, target });
          }
        }
      }
    } catch {
      // A file that vanished or cannot be read is not a broken chain.
    }
  }
  supersede.intact = supersede.broken.length === 0;

  const counters = options.counters;
  const readWriteRatio =
    counters !== undefined && counters.writes > 0
      ? counters.reads / counters.writes
      : null;

  const fullest = waterlines.reduce<MemoryDirectoryWaterline | null>(
    (best, w) => (best === null || w.files > best.files ? w : best),
    null,
  );

  return {
    files,
    directories,
    totalBytes,
    limits,
    waterlines,
    warnDirectories: waterlines.filter((w) => w.warn).map((w) => w.path),
    capacity: {
      largestFile,
      largestFileHeadroomBytes:
        largestFile === null ? null : Math.max(0, limits.maxFileBytes - largestFile.sizeBytes),
      filesOverHalfByteLimit,
      fullestDirectory:
        fullest === null || fullest.files === 0
          ? null
          : { path: fullest.path, files: fullest.files, remaining: fullest.remaining },
    },
    staleness,
    supersede,
    readWriteRatio,
    ...(counters !== undefined ? { counters: { ...counters } } : {}),
    truncatedScan,
  };
}
