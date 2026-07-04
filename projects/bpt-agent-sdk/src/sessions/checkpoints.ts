/**
 * Disk-backed file-checkpoint store.
 *
 * Layout under the sessions directory:
 *   checkpoints/{sessionId}/index.jsonl        - append-only change log
 *   checkpoints/{sessionId}/blobs/{seq}.blob   - captured pre-image bytes
 *
 * It survives a process restart on purpose: the official rewind flow happens
 * in a SECOND resuming query, so the checkpoint index must live on disk.
 *
 * record() is synchronous + best-effort (never throws) so fs tools can call it
 * from ctx.recordFileChange BEFORE mutating a file. rewind() reads the log,
 * builds a first-wins plan from the target checkpoint to the end, and restores
 * modified files / deletes created files.
 */

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { RewindFilesResult } from '../types.js';
import { ConfigurationError } from '../errors.js';
import { isSafeSessionId, resolveSessionsDir } from './store.js';

/** One recorded pre-mutation change (a line in index.jsonl). */
export type FileChange = {
  /** User-message UUID of the turn this change belongs to. */
  userMessageId: string;
  /** Absolute path that was (about to be) mutated. */
  absPath: string;
  /** Blob filename holding the pre-image, or null when the file was created. */
  blob: string | null;
  /** Monotonic sequence number (ordering across turns). */
  seq: number;
};

export type FileCheckpointStoreConfig = {
  sessionDir?: string;
  env?: Record<string, string | undefined>;
  debug?: (msg: string) => void;
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class FileCheckpointStore {
  private readonly baseDir: string;
  private readonly debug: (msg: string) => void;

  private dir: string | null = null;
  private seq = 0;
  private seenThisTurn = new Set<string>();
  private currentTurnId: string | null = null;

  constructor(cfg: FileCheckpointStoreConfig = {}) {
    this.baseDir = join(resolveSessionsDir(cfg.sessionDir, cfg.env), 'checkpoints');
    this.debug = cfg.debug ?? (() => undefined);
  }

  /** Point the store at one session's checkpoint dir; recover the seq counter. */
  bind(sessionId: string): void {
    if (!isSafeSessionId(sessionId)) {
      this.debug(
        `checkpoint store: refusing to bind unsafe session id ${JSON.stringify(sessionId)}`,
      );
      this.dir = null;
      return;
    }
    this.dir = join(this.baseDir, sessionId);
    this.seq = this.reconstructSeq();
    this.seenThisTurn = new Set();
    this.currentTurnId = null;
  }

  /** Start a new turn keyed by the user-message UUID; clear the per-turn set. */
  beginTurn(userMessageId: string): void {
    this.currentTurnId = userMessageId;
    this.seenThisTurn = new Set();
  }

  /**
   * Record a pre-mutation image. First touch of a path per turn wins; repeats
   * are ignored so the earliest pre-image is what a rewind restores. Never
   * throws.
   */
  record(absPath: string, preImage: string | null): void {
    if (this.dir === null) return;
    if (this.seenThisTurn.has(absPath)) return;
    this.seenThisTurn.add(absPath);
    const seq = this.seq;
    this.seq += 1;
    let blobName: string | null = null;
    try {
      mkdirSync(this.dir, { recursive: true });
      if (preImage !== null) {
        const blobs = this.blobsDir();
        mkdirSync(blobs, { recursive: true });
        blobName = `${seq}.blob`;
        writeFileSync(join(blobs, blobName), preImage, 'utf8');
      }
      const line: FileChange = {
        userMessageId: this.currentTurnId ?? '',
        absPath,
        blob: blobName,
        seq,
      };
      appendFileSync(this.indexPath(), `${JSON.stringify(line)}\n`, 'utf8');
    } catch (err) {
      this.debug(`checkpoint record failed for ${absPath}: ${errMessage(err)}`);
    }
  }

  /**
   * Restore files to their state at the given user-message checkpoint. Builds
   * a first-wins plan over every change from the target line to the end:
   * modified files (blob != null) are rewritten to their pre-image, created
   * files (blob == null) are deleted. dryRun computes the plan without touching
   * disk. The conversation is NOT rewound.
   */
  async rewind(
    userMessageId: string,
    options: { dryRun?: boolean } = {},
  ): Promise<RewindFilesResult> {
    const dryRun = options.dryRun === true;
    if (this.dir === null) {
      throw new ConfigurationError('File rewinding is not enabled');
    }
    const changes = this.readIndex();
    const startIdx = changes.findIndex((c) => c.userMessageId === userMessageId);
    if (startIdx === -1) {
      throw new ConfigurationError(
        `No file checkpoint found for message ${userMessageId}`,
      );
    }
    const window = changes.slice(startIdx);
    const plan = new Map<string, string | null>();
    for (const c of window) {
      if (!plan.has(c.absPath)) plan.set(c.absPath, c.blob);
    }

    const restoredFiles: string[] = [];
    const deletedFiles: string[] = [];
    for (const [absPath, blob] of plan) {
      if (blob !== null) {
        if (!dryRun) {
          try {
            const content = await readFile(join(this.blobsDir(), blob), 'utf8');
            await mkdir(dirname(absPath), { recursive: true });
            await writeFile(absPath, content, 'utf8');
          } catch (err) {
            this.debug(`checkpoint restore failed for ${absPath}: ${errMessage(err)}`);
            continue;
          }
        }
        restoredFiles.push(absPath);
      } else {
        if (!dryRun) {
          try {
            await rm(absPath, { force: true });
          } catch (err) {
            this.debug(`checkpoint delete failed for ${absPath}: ${errMessage(err)}`);
          }
        }
        deletedFiles.push(absPath);
      }
    }

    return { checkpointId: userMessageId, restoredFiles, deletedFiles, dryRun };
  }

  // -- internals -------------------------------------------------------------

  private indexPath(): string {
    return join(this.dir as string, 'index.jsonl');
  }

  private blobsDir(): string {
    return join(this.dir as string, 'blobs');
  }

  private reconstructSeq(): number {
    let raw: string;
    try {
      raw = readFileSync(this.indexPath(), 'utf8');
    } catch {
      return 0;
    }
    let max = -1;
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (t.length === 0) continue;
      try {
        const o = JSON.parse(t) as { seq?: unknown };
        if (typeof o.seq === 'number' && o.seq > max) max = o.seq;
      } catch {
        // Skip corrupt lines.
      }
    }
    return max + 1;
  }

  private readIndex(): FileChange[] {
    let raw: string;
    try {
      raw = readFileSync(this.indexPath(), 'utf8');
    } catch {
      return [];
    }
    const out: FileChange[] = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (t.length === 0) continue;
      try {
        const o = JSON.parse(t) as Partial<FileChange>;
        if (
          typeof o.absPath === 'string' &&
          typeof o.seq === 'number' &&
          (typeof o.blob === 'string' || o.blob === null)
        ) {
          out.push({
            userMessageId: typeof o.userMessageId === 'string' ? o.userMessageId : '',
            absPath: o.absPath,
            blob: o.blob ?? null,
            seq: o.seq,
          });
        }
      } catch {
        // Skip corrupt lines.
      }
    }
    out.sort((a, b) => a.seq - b.seq);
    return out;
  }
}

/**
 * Adapt a FileCheckpointStore into the synchronous ctx.recordFileChange
 * callback the fs tools invoke before mutating a file.
 */
export function makeCheckpointRecorder(
  store: FileCheckpointStore,
): (absPath: string, preImage: string | null) => void {
  return (absPath, preImage) => store.record(absPath, preImage);
}
