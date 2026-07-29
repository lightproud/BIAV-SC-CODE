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
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { RewindFilesResult } from '../types.js';
import { ConfigurationError } from '../errors.js';
import { isSafeSessionId, resolveSessionsDir } from './store.js';

/**
 * Identity key for a path, so ONE file cannot occupy two slots.
 *
 * Both the per-turn first-touch dedup and the rewind plan keyed on the RAW
 * absolute string. `path.resolve` collapses `.`/`..`, but two spellings still
 * name one file whenever a SYMLINK is involved (`/w/link.ts` and its target
 * `/real/f.ts`) or the filesystem is case-insensitive (`/w/File.ts` vs
 * `/w/file.ts` — macOS and Windows, and a model varies the casing of a path it
 * types constantly). Each spelling then got its OWN plan entry, and the
 * later one carries a MID-TURN pre-image: the rewind writes the earliest image
 * first and the mid-turn image over it, leaving the file at a state that
 * existed at no checkpoint — while reporting canRewind:true and listing the
 * file as restored. Where one spelling was recorded as a CREATION (delete) and
 * the other as a modification (restore), insertion order alone decided whether
 * the file survived.
 *
 * permissions/rules.ts already learned exactly this ("the kernel's open()
 * FOLLOWS symlinks", plus the win32 case fold); this is the same
 * canonicalization one layer over. Best-effort and non-throwing: a path not yet
 * on disk resolves its longest existing ancestor and re-appends the tail, so a
 * file created this turn still shares its parent directory's identity, and a
 * path that resolves to nothing keeps its literal form (the previous behavior).
 */
function pathIdentity(p: string): string {
  let current = p;
  const tail: string[] = [];
  let resolved = p;
  for (;;) {
    try {
      const real = realpathSync(current);
      resolved = tail.length > 0 ? join(real, ...[...tail].reverse()) : real;
      break;
    } catch {
      const parent = dirname(current);
      if (parent === current) break; // reached the root; nothing resolved
      tail.push(basename(current));
      current = parent;
    }
  }
  return process.platform === 'win32' ? resolved.replace(/\\/g, '/').toLowerCase() : resolved;
}

/** One recorded pre-mutation change (a line in index.jsonl). */
export type FileChange = {
  /** User-message UUID of the turn this change belongs to. */
  userMessageId: string;
  /** Absolute path that was (about to be) mutated. */
  absPath: string;
  /** Blob filename holding the pre-image, or null when the file was created. */
  blob: string | null;
  /**
   * T74 option 甲 (keeper 2026-07-27): the pre-image EXCEEDED the blob-size
   * cap at record time, so no blob exists and this file CANNOT be rewound.
   * Deliberately a separate marker: `blob: null` alone means "file was
   * CREATED this turn" and rewind DELETES it — reusing null for an over-cap
   * pre-image would make rewind destroy the one file it cannot restore.
   */
  oversized?: true;
  /** Monotonic sequence number (ordering across turns). */
  seq: number;
};

/**
 * Per-file blob cap (T74 甲, default 10 MB): a pre-image larger than this is
 * recorded WITHOUT its bytes — the change stays in the timeline, marked
 * `oversized`, and rewind names the file as unrecoverable instead of touching
 * it. The honest-degradation trade-off the keeper ruled for: bounded disk in
 * exchange for an explicit, named gap — never a silent 500MB blob and never a
 * silently wrong rewind.
 */
export const DEFAULT_MAX_BLOB_BYTES = 10 * 1024 * 1024;

export type FileCheckpointStoreConfig = {
  sessionDir?: string;
  env?: Record<string, string | undefined>;
  debug?: (msg: string) => void;
  /** Per-file pre-image blob cap in bytes (T74 甲). Default 10 MB. */
  maxBlobBytes?: number;
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class FileCheckpointStore {
  private readonly baseDir: string;
  private readonly debug: (msg: string) => void;

  private dir: string | null = null;
  private seq = 0;
  /** Whether this instance already checked the index tail for a torn append
   *  (M-9 self-heal, mirrors JsonlSessionStore.append). */
  private indexTailChecked = false;
  private seenThisTurn = new Set<string>();
  private currentTurnId: string | null = null;
  // Finding M3 — per-instance blob token. `seq` is recovered from the index at
  // bind() and advanced only in-process, so two FileCheckpointStores bound to
  // the SAME session (two concurrent local queries with file checkpointing)
  // both start at the same seq and would write the same `{seq}.blob` path —
  // one overwriting the other, so a later rewind restored the WRONG file's
  // bytes. Qualifying the blob name with an instance-unique token makes writes
  // collision-free; the index line stores the full name, so rewind still reads
  // the exact pre-image it recorded.
  private readonly token = randomUUID().slice(0, 8);
  private readonly maxBlobBytes: number;

  constructor(cfg: FileCheckpointStoreConfig = {}) {
    this.baseDir = join(resolveSessionsDir(cfg.sessionDir, cfg.env), 'checkpoints');
    this.debug = cfg.debug ?? (() => undefined);
    this.maxBlobBytes = cfg.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES;
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
    // J2 (audit r2): the torn-tail check is per BOUND SESSION, not per
    // instance — rebinding this store to a second session must re-arm the
    // M-9 self-heal, or a torn tail in the NEW session's index (crashed
    // writer) survives untouched: the first append glues onto the torn line,
    // readIndex then drops both, and the just-written blob can't be rewound.
    // (JsonlSessionStore keeps a per-FILE Set for exactly this reason.)
    this.indexTailChecked = false;
  }

  /** Start a new turn keyed by the user-message UUID; clear the per-turn set. */
  beginTurn(userMessageId: string): void {
    this.currentTurnId = userMessageId;
    this.seenThisTurn = new Set();
    // Finding L4 — record a turn-position marker so a turn that changes NO file
    // still has a place in the timeline. Without it, rewind(userMessageId)
    // could only target turns that happened to mutate a file, so a user could
    // not roll back to the state as-of a chat-only turn. The marker carries no
    // absPath, so readIndex() (which requires one) excludes it from the restore
    // plan; it exists purely for positioning. The marker does NOT consume a seq
    // — it records the seq the turn's FIRST file-change will take, so the record
    // seq space (0,1,2,…) is unperturbed and rewind's `seq >= markerSeq` window
    // still starts exactly at this turn. Best-effort, never throws.
    if (this.dir === null) return;
    // Same sibling-instance re-sync as record() (audit 2026-07-17 L49).
    this.seq = Math.max(this.seq, this.nextSeqFromIndex());
    const seq = this.seq;
    try {
      mkdirSync(this.dir, { recursive: true });
      this.appendIndexLine(
        `${JSON.stringify({ userMessageId, seq, marker: 'turn_start' })}\n`,
      );
    } catch (err) {
      this.debug(`checkpoint turn marker failed: ${errMessage(err)}`);
    }
  }

  /**
   * Record a pre-mutation image. First touch of a path per turn wins; repeats
   * are ignored so the earliest pre-image is what a rewind restores. Never
   * throws.
   */
  record(absPath: string, preImage: string | null): void {
    if (this.dir === null) return;
    // Dedup on file IDENTITY, not on the spelling the caller happened to use.
    const identity = pathIdentity(absPath);
    if (this.seenThisTurn.has(identity)) return;
    this.seenThisTurn.add(identity);
    // Re-sync against the on-disk index before taking a number: a SECOND
    // store instance bound to the same session appends to the same index,
    // and two instance-local counters would hand out duplicate seq numbers —
    // a rewind then restores the wrong instance's pre-image on the tie
    // (audit 2026-07-17 L49).
    this.seq = Math.max(this.seq, this.nextSeqFromIndex());
    const seq = this.seq;
    this.seq += 1;
    let blobName: string | null = null;
    // T74 甲: an over-cap pre-image is recorded without its bytes, marked
    // `oversized` so rewind treats it as unrecoverable rather than as a
    // created-file deletion. Judged in BYTES (blob files are what they cost
    // on disk), announced in the debug channel at record time.
    const oversized =
      preImage !== null && Buffer.byteLength(preImage, 'utf8') > this.maxBlobBytes;
    try {
      mkdirSync(this.dir, { recursive: true });
      if (preImage !== null && !oversized) {
        const blobs = this.blobsDir();
        mkdirSync(blobs, { recursive: true });
        blobName = `${seq}-${this.token}.blob`;
        writeFileSync(join(blobs, blobName), preImage, 'utf8');
      }
      if (oversized) {
        this.debug(
          `checkpoint: pre-image of ${absPath} exceeds the ${this.maxBlobBytes}-byte ` +
            `blob cap — recorded without bytes; this file cannot be rewound past this point`,
        );
      }
      const line: FileChange = {
        userMessageId: this.currentTurnId ?? '',
        absPath,
        blob: blobName,
        ...(oversized ? { oversized: true as const } : {}),
        seq,
      };
      this.appendIndexLine(`${JSON.stringify(line)}\n`);
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
      // `dir` is null only when bind() never ran, or ran and REFUSED the
      // session id as unsafe. Saying "not enabled" named the wrong cause: the
      // feature is on (this store exists), the store just has no session dir.
      throw new ConfigurationError(
        'File rewinding is unavailable: this checkpoint store is not bound to a ' +
          'session (bind() was never called, or the session id was rejected as unsafe)',
      );
    }
    const changes = this.readIndex();
    // Position the target turn. audit r4 V3-3: prefer the turn_start MARKER seq
    // (the turn's true timeline position) over its first file-change seq. A
    // concurrent sibling instance's interleaved records can push the first
    // file-change seq ABOVE the marker, which would then exclude those
    // in-window records from the undo plan. The marker is always <= the first
    // change seq (record() re-syncs upward from what beginTurn saw), so this
    // only ever widens the window to the correct start. Fall back to the first
    // file-change seq for turns with no marker (transcripts predating L4).
    const markerSeq = this.turnMarkerSeq(userMessageId);
    const direct = changes.find((c) => c.userMessageId === userMessageId);
    const startSeq = markerSeq ?? (direct !== undefined ? direct.seq : null);
    if (startSeq === null) {
      // Official soft-fail shape: an unknown checkpoint resolves with
      // canRewind:false + error (T2-2) instead of throwing. Configuration
      // misuse (store not bound) still throws above.
      return {
        canRewind: false,
        error: `No file checkpoint found for message ${userMessageId}`,
        checkpointId: userMessageId,
        restoredFiles: [],
        deletedFiles: [],
        dryRun,
      };
    }
    // changes is seq-sorted; every change at or after the target's position is
    // undone (a no-file-change target simply yields an empty, valid plan).
    const window = changes.filter((c) => c.seq >= startSeq);
    // Keyed on file IDENTITY (see pathIdentity) so two spellings of one file
    // cannot each claim a slot; the recorded spelling is kept for the write.
    const plan = new Map<
      string,
      { absPath: string; blob: string | null; oversized: boolean }
    >();
    for (const c of window) {
      const identity = pathIdentity(c.absPath);
      if (!plan.has(identity)) {
        plan.set(identity, {
          absPath: c.absPath,
          blob: c.blob,
          oversized: c.oversized === true,
        });
      }
    }

    const restoredFiles: string[] = [];
    const deletedFiles: string[] = [];
    // audit r4 Sfs-3: a pre-image readFile / rm that throws is skipped (never
    // counted as restored/deleted — L48), but a rewind that could not apply its
    // whole plan must NOT still report canRewind:true, or the caller reads an
    // INCOMPLETE rewind as success while the on-disk state silently diverges
    // from the checkpoint.
    const failedFiles: string[] = [];
    // T74 甲: files whose pre-image exceeded the blob cap at record time. The
    // rewind must NOT touch them (no bytes to restore, and deleting would
    // destroy the only copy) — it names them instead, and the whole rewind
    // honestly reports incomplete: the on-disk state will not match the
    // checkpoint, and pretending otherwise is the one forbidden outcome.
    const unrewindableFiles: string[] = [];
    for (const { absPath, blob, oversized } of plan.values()) {
      if (oversized) {
        unrewindableFiles.push(absPath);
        continue;
      }
      if (blob !== null) {
        if (!dryRun) {
          try {
            const content = await readFile(join(this.blobsDir(), blob), 'utf8');
            await mkdir(dirname(absPath), { recursive: true });
            await writeFile(absPath, content, 'utf8');
          } catch (err) {
            this.debug(`checkpoint restore failed for ${absPath}: ${errMessage(err)}`);
            failedFiles.push(absPath);
            continue;
          }
        }
        restoredFiles.push(absPath);
      } else {
        if (!dryRun) {
          try {
            await rm(absPath, { force: true });
          } catch (err) {
            // Same soft-fail as the restore branch: a failed rm must not be
            // reported as deleted (audit 2026-07-17 L48).
            this.debug(`checkpoint delete failed for ${absPath}: ${errMessage(err)}`);
            failedFiles.push(absPath);
            continue;
          }
        }
        deletedFiles.push(absPath);
      }
    }

    // Official fields lead (canRewind/filesChanged); insertions/deletions are
    // deliberately absent (no diff engine — see the type's JSDoc). The
    // pre-alignment fields ride along as deprecated dual-track. A partial
    // failure (audit r4 Sfs-3) reports canRewind:false + an error so the
    // incomplete rewind is not mistaken for a clean one.
    const incomplete = failedFiles.length > 0 || unrewindableFiles.length > 0;
    const reasons: string[] = [];
    if (failedFiles.length > 0) {
      reasons.push(
        `${failedFiles.length} file(s) could not be restored or deleted ` +
          `(${failedFiles.join(', ')})`,
      );
    }
    if (unrewindableFiles.length > 0) {
      reasons.push(
        `${unrewindableFiles.length} file(s) have no recorded pre-image — their ` +
          `content exceeded the checkpoint blob cap when they were modified, so ` +
          `they were left AS THEY ARE and cannot be rewound ` +
          `(${unrewindableFiles.join(', ')})`,
      );
    }
    return {
      canRewind: !incomplete,
      ...(incomplete ? { error: `rewind incomplete: ${reasons.join('; ')}` } : {}),
      filesChanged: [...restoredFiles, ...deletedFiles],
      checkpointId: userMessageId,
      restoredFiles,
      deletedFiles,
      dryRun,
    };
  }

  // -- internals -------------------------------------------------------------

  private indexPath(): string {
    return join(this.dir as string, 'index.jsonl');
  }

  /**
   * Append one already-newline-terminated line to index.jsonl with the M-9
   * torn-tail self-heal (mirrors JsonlSessionStore.append): the FIRST append
   * per instance checks the file's last byte and, if a previous process died
   * mid-append leaving no trailing newline, prefixes this line with '\n' so the
   * fresh record does not glue onto the torn tail (which would lose BOTH lines
   * on readIndex and leave a just-written blob unreferenced/unrewindable).
   * The index file survives across processes on purpose (see the file header).
   */
  private appendIndexLine(line: string): void {
    const file = this.indexPath();
    let out = line;
    if (!this.indexTailChecked) {
      this.indexTailChecked = true;
      if (this.endsWithoutNewlineSync(file)) out = `\n${line}`;
    }
    appendFileSync(file, out, 'utf8');
  }

  /** True when `file` exists, is non-empty, and its last byte is not '\n'. */
  private endsWithoutNewlineSync(file: string): boolean {
    let fd: number;
    try {
      fd = openSync(file, 'r');
    } catch {
      return false; // ENOENT etc.: nothing to heal
    }
    try {
      const size = fstatSync(fd).size;
      if (size === 0) return false;
      const buf = Buffer.alloc(1);
      readSync(fd, buf, 0, 1, size - 1);
      return buf[0] !== 0x0a;
    } finally {
      closeSync(fd);
    }
  }

  private blobsDir(): string {
    return join(this.dir as string, 'blobs');
  }

  /** The next seq the on-disk index implies. Unlike reconstructSeq (which
   *  bind() uses and which treats EVERY line's seq as consumed), this
   *  distinguishes turn_start MARKERS: a marker records the seq its turn's
   *  first file-change WILL take (unconsumed), so it caps `next` at its own
   *  value rather than value+1 — keeping marker == first-change-seq alignment
   *  while still fencing off a sibling instance's appended records (L49). */
  private nextSeqFromIndex(): number {
    let raw: string;
    try {
      raw = readFileSync(this.indexPath(), 'utf8');
    } catch {
      return 0;
    }
    let next = 0;
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (t.length === 0) continue;
      try {
        const o = JSON.parse(t) as { seq?: unknown; marker?: unknown };
        if (typeof o.seq !== 'number') continue;
        next = Math.max(next, o.marker === 'turn_start' ? o.seq : o.seq + 1);
      } catch {
        // Skip corrupt lines.
      }
    }
    return next;
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

  /** Finding L4 — earliest turn_start marker seq for a user message, or null.
   *  Lets rewind() position a turn that recorded no file change. */
  private turnMarkerSeq(userMessageId: string): number | null {
    let raw: string;
    try {
      raw = readFileSync(this.indexPath(), 'utf8');
    } catch {
      return null;
    }
    let min: number | null = null;
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (t.length === 0) continue;
      try {
        const o = JSON.parse(t) as { userMessageId?: unknown; seq?: unknown; marker?: unknown };
        if (
          o.marker === 'turn_start' &&
          o.userMessageId === userMessageId &&
          typeof o.seq === 'number' &&
          (min === null || o.seq < min)
        ) {
          min = o.seq;
        }
      } catch {
        // Skip corrupt lines.
      }
    }
    return min;
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
            // T74 甲: dropping this on read would turn an over-cap record back
            // into a "created" record — and rewind would delete the file.
            ...(o.oversized === true ? { oversized: true as const } : {}),
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
