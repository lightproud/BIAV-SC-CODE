/**
 * Session-store health assessment (keeper ruling 2026-07-27, sessions-domain
 * audit finding P1-S1): the sessions directory ACCUMULATES — one transcript
 * per session plus a checkpoint dir whose blobs hold the pre-image bytes of
 * every mutated file — and until now nothing answered "how is it doing".
 * `deleteSession` existed with no signal for when to use it: the exact
 * mechanism-without-discipline shape the memory store had before
 * `assessMemoryStoreHealth` (0.84.0). This is the same scan for the OTHER
 * cross-session persistence layer.
 *
 * Honesty rules mirror the memory scan: only the LOCAL filesystem layout is
 * assessable — an injected external sessionStore gets `available: false`, not
 * a fabricated zero. The scan is bounded; hitting the bound sets
 * `truncatedScan` so numbers read as a lower bound, never as the whole tree.
 * This module performs no deletion — the assessment is the trigger surface,
 * the host decides (spec N1: no background process, no scheduler).
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveSessionsDir } from './store.js';

const JSONL_EXT = '.jsonl';
const DAY_MS = 86_400_000;
const DEFAULT_STALE_AFTER_DAYS = 30;
const DEFAULT_MAX_ENTRIES = 8192;
const LIST_CAP = 20;

export type SessionStoreAssessment =
  | { available: false; note: string }
  | {
      available: true;
      /** Directory the scan ran over. */
      dir: string;
      /** Main-session transcripts found (one .jsonl each). */
      sessions: number;
      /** Total bytes of session transcripts. */
      transcriptBytes: number;
      /** Total bytes under checkpoints/ (index logs + pre-image blobs). */
      checkpointBytes: number;
      /** Sessions whose transcript is unmodified past the staleness line. */
      staleSessions: number;
      staleAfterDays: number;
      /** Up to 20 stale session ids, oldest first. */
      staleList: string[];
      /** Up to 20 largest sessions by transcript + checkpoint bytes. */
      largest: Array<{ sessionId: string; bytes: number }>;
      /** Checkpoint dirs whose session transcript no longer exists — deletion
       *  that missed its checkpoint half, or an external deletion path. */
      orphanCheckpointDirs: string[];
      /** True when the scan hit its entry bound — lower bound, not the tree. */
      truncatedScan: boolean;
    };

export type AssessSessionStoreHealthOptions = {
  /** Explicit sessions dir; default = the SDK's resolution (options.sessionDir
   *  -> $BPT_AGENT_HOME/sessions -> ~/.bpt-agent/sessions). */
  sessionDir?: string;
  env?: Record<string, string | undefined>;
  /** A session counts as stale after this many days without transcript
   *  modification. Default 30. */
  staleAfterDays?: number;
  /** Scan bound (filesystem entries visited). Default 8192. */
  maxEntries?: number;
  /** Clock injection (ms since epoch). Default Date.now. */
  now?: () => number;
};

async function dirSize(
  dir: string,
  budget: { left: number },
): Promise<{ bytes: number; truncated: boolean }> {
  let bytes = 0;
  let truncated = false;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, truncated: false };
  }
  for (const e of entries) {
    if ((budget.left -= 1) < 0) return { bytes, truncated: true };
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await dirSize(p, budget);
      bytes += sub.bytes;
      truncated = truncated || sub.truncated;
    } else {
      try {
        bytes += (await stat(p)).size;
      } catch {
        /* vanished mid-scan */
      }
    }
  }
  return { bytes, truncated };
}

/**
 * Deep-scan the LOCAL sessions directory. For a host running with an injected
 * external sessionStore, pass nothing and read `available: false` — the SDK
 * cannot see inside a store it did not build, and will not pretend to.
 */
export async function assessSessionStoreHealth(
  options: AssessSessionStoreHealthOptions = {},
): Promise<SessionStoreAssessment> {
  const dir = resolveSessionsDir(options.sessionDir, options.env);
  const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
  const now = (options.now ?? Date.now)();
  const budget = { left: options.maxEntries ?? DEFAULT_MAX_ENTRIES };

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return {
      available: false,
      note: `sessions directory ${dir} is absent or unreadable — nothing persisted there yet, or the host uses an external sessionStore this scan cannot see into`,
    };
  }

  let truncatedScan = false;
  let transcriptScanTruncated = false;
  const perSession = new Map<string, number>();
  const mtimes = new Map<string, number>();
  let transcriptBytes = 0;

  for (const name of names) {
    if (!name.endsWith(JSONL_EXT)) continue;
    if ((budget.left -= 1) < 0) {
      truncatedScan = true;
      transcriptScanTruncated = true;
      break;
    }
    const id = name.slice(0, -JSONL_EXT.length);
    try {
      const st = await stat(join(dir, name));
      transcriptBytes += st.size;
      perSession.set(id, st.size);
      mtimes.set(id, st.mtimeMs);
    } catch {
      /* vanished mid-scan */
    }
  }

  let checkpointBytes = 0;
  const orphanCheckpointDirs: string[] = [];
  try {
    const cpRoot = join(dir, 'checkpoints');
    const cpDirs = await readdir(cpRoot);
    for (const id of cpDirs) {
      if ((budget.left -= 1) < 0) {
        truncatedScan = true;
        break;
      }
      const sized = await dirSize(join(cpRoot, id), budget);
      checkpointBytes += sized.bytes;
      truncatedScan = truncatedScan || sized.truncated;
      if (perSession.has(id)) {
        perSession.set(id, (perSession.get(id) ?? 0) + sized.bytes);
      } else if (!transcriptScanTruncated) {
        orphanCheckpointDirs.push(id);
      } else {
        // The transcript scan stopped at the budget, so absence from
        // perSession does NOT mean the transcript is gone — confirm before
        // flagging, or a live session's checkpoints read as deletable orphans.
        try {
          await stat(join(dir, `${id}${JSONL_EXT}`));
        } catch {
          orphanCheckpointDirs.push(id);
        }
      }
    }
  } catch {
    /* no checkpoints dir — fine */
  }

  const staleCutoff = now - staleAfterDays * DAY_MS;
  // Both lists are sliced to LIST_CAP, so ties at the cutoff decide what the
  // caller SEES. mtime/byte ties are ordinary (files written in the same ms,
  // sessions of identical size) and the stable sort otherwise kept readdir
  // order — a filesystem-dependent sequence, so the reported staleList/largest
  // varied across runs and hosts for identical data. Break on the unique
  // session id (same discipline as store.ts Rst-3 / file-store.ts Rst-4).
  const byId = (a: readonly [string, number], b: readonly [string, number]): number =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  const stale = [...mtimes.entries()]
    .filter(([, m]) => m < staleCutoff)
    .sort((a, b) => a[1] - b[1] || byId(a, b));
  const largest = [...perSession.entries()]
    .sort((a, b) => b[1] - a[1] || byId(a, b))
    .slice(0, LIST_CAP)
    .map(([sessionId, bytes]) => ({ sessionId, bytes }));

  return {
    available: true,
    dir,
    sessions: perSession.size,
    transcriptBytes,
    checkpointBytes,
    staleSessions: stale.length,
    staleAfterDays,
    staleList: stale.slice(0, LIST_CAP).map(([id]) => id),
    largest,
    orphanCheckpointDirs: orphanCheckpointDirs.slice(0, LIST_CAP),
    truncatedScan,
  };
}
