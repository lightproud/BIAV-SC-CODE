/**
 * Built-in file-backed external SessionStore (SM-B.a, SessionManager
 * proposal §5.1: "堵 G1" — persistence lands with ONE line of wiring).
 *
 * `fileSessionStore(dir)` returns an implementation of the PUBLIC
 * `SessionStore` contract from ../types.js (the same surface
 * `InMemorySessionStore` references) that persists each session key to its
 * own JSONL file:
 *
 *   {dir}/
 *     {enc(projectKey)}/
 *       {enc(sessionId)}/
 *         main.jsonl                 <- subpath === undefined | ''
 *         sub/
 *           {enc(subpath)}.jsonl     <- one file per subkey
 *
 * Every key component is percent-encoded byte-wise (only [A-Za-z0-9._-]
 * pass through) before it touches the filesystem, so an attacker-controlled
 * sessionId such as `../../etc/cron.d` can never traverse out of `dir`:
 * `/`, `\` and `%` are all escaped, and the exact names `.` / `..` / `` are
 * mapped to reserved escapes. The encoding is reversible, which is what lets
 * listSessions()/listSubkeys() recover the ORIGINAL ids from directory
 * names (a lossy sanitizer like store.ts's isSafeSessionId gate could not).
 * This mirrors the attack-surface stance documented on SAFE_SESSION_ID in
 * ./store.js: ids arrive straight from an embedder's request and this
 * encoder is the single choke point that keeps reads and writes inside the
 * store root.
 *
 * Durability / concurrency semantics (LOCK-FREE — the honest boundary):
 *  - append() serializes the whole batch to one string and issues ONE
 *    `fs.appendFile` (open with O_APPEND). Within a single process, Node
 *    serializes each appendFile through the thread pool as one open/write/
 *    close sequence, and for batch payloads up to typical entry sizes the
 *    data lands in a single write(2), so concurrent queries mirroring into
 *    the SAME session file do not interleave bytes mid-line; ordering
 *    ACROSS concurrently flushed batches is unspecified.
 *  - Cross-process: no lock file is taken and none is promised. O_APPEND
 *    keeps each write positioned at EOF atomically on local POSIX
 *    filesystems, so whole-line integrity holds in practice, but two
 *    processes appending the same session get an unspecified interleaving
 *    order, and NFS-style filesystems void even the positioning guarantee.
 *  - Crash tolerance: a process dying mid-write leaves a torn final line.
 *    load() tolerates that: any line that fails JSON.parse (torn tail or
 *    corrupt middle) is silently dropped, every intact line survives.
 *    append() also self-heals the torn tail: the FIRST append to each file
 *    per store instance checks the file's last byte and, when it is not a
 *    newline, prefixes the batch with '\n' — otherwise the fresh line would
 *    glue onto the torn tail and BOTH lines would be lost. A racing double
 *    check at worst writes an extra blank line, which load() skips.
 *  - Dedup: load() drops repeated `entry.uuid`s (first occurrence wins),
 *    matching InMemorySessionStore's append-side dedup. Doing it at read
 *    time keeps append() a single blind O_APPEND write and stays correct
 *    even when a retried batch was appended twice.
 */

import { Buffer } from 'node:buffer';
import { appendFile, mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
  SessionStoreListEntry,
} from '../types.js';

const MAIN_FILE = 'main.jsonl';
const SUB_DIR = 'sub';
const JSONL_EXT = '.jsonl';

/** Filename-safe bytes that pass through the encoder unescaped. */
const SAFE_BYTES: ReadonlySet<number> = (() => {
  const s = new Set<number>();
  const add = (from: string, to: string) => {
    for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c += 1) s.add(c);
  };
  add('A', 'Z');
  add('a', 'z');
  add('0', '9');
  for (const ch of '._-') s.add(ch.charCodeAt(0));
  return s;
})();

/**
 * Encode one key component (projectKey / sessionId / subpath) into a single
 * safe filename. Byte-wise percent-encoding: bytes outside [A-Za-z0-9._-]
 * become `%XX`. Reversible via decodeKeyComponent. The only names the safe
 * charset could still produce that are dangerous as filenames — `.`, `..`
 * and the empty string — are mapped to reserved escape forms (`%2E`,
 * `%2E%2E`, `%`; a literal `%` in input always encodes to `%25`, so the
 * bare-`%` empty marker cannot collide).
 */
export function encodeKeyComponent(raw: string): string {
  if (raw === '') return '%';
  let out = '';
  for (const b of Buffer.from(raw, 'utf8')) {
    out += SAFE_BYTES.has(b)
      ? String.fromCharCode(b)
      : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  if (out === '.') return '%2E';
  if (out === '..') return '%2E%2E';
  return out;
}

/** Reverse encodeKeyComponent (used to list original ids from filenames). */
export function decodeKeyComponent(name: string): string {
  if (name === '%') return '';
  const bytes: number[] = [];
  for (let i = 0; i < name.length; i += 1) {
    const hex = name[i] === '%' ? name.slice(i + 1, i + 3) : '';
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
      continue;
    }
    bytes.push(name.charCodeAt(i));
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Expand a leading `~`/`~/` to the home directory (proposal usage shows
 *  `fileSessionStore('~/.bpt/sessions')`). */
function expandTilde(dir: string): string {
  if (dir === '~') return homedir();
  if (dir.startsWith('~/')) return join(homedir(), dir.slice(2));
  return dir;
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/**
 * A directory entry that cannot hold a session transcript: it either does not
 * exist (ENOENT) or is a plain file, so `join(entry, main.jsonl)` is not a
 * directory path (ENOTDIR). Both mean "not a session", never a fatal error —
 * a stray `.DS_Store` in the project dir must not abort the whole listing.
 */
function isNotASessionDir(err: unknown): boolean {
  if (isEnoent(err)) return true;
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === 'ENOTDIR'
  );
}

/**
 * File-backed implementation of the public SessionStore contract. See the
 * module doc for layout, path-safety and lock-free durability semantics.
 */
export class FileSessionStore implements SessionStore {
  private readonly root: string;

  /** Files whose tail byte was already verified by this instance. */
  private readonly tailChecked = new Set<string>();

  constructor(dir: string) {
    this.root = resolve(expandTilde(dir));
  }

  /** Directory holding everything for one (projectKey, sessionId). */
  private sessionDir(key: { projectKey: string; sessionId: string }): string {
    return join(
      this.root,
      encodeKeyComponent(key.projectKey),
      encodeKeyComponent(key.sessionId),
    );
  }

  /** JSONL file for one full key (main transcript or subkey). */
  private filePath(key: SessionKey): string {
    const base = this.sessionDir(key);
    const subpath = key.subpath ?? '';
    if (subpath === '') return join(base, MAIN_FILE);
    return join(base, SUB_DIR, `${encodeKeyComponent(subpath)}${JSONL_EXT}`);
  }

  /**
   * True when the file exists, is non-empty and does NOT end in a newline —
   * i.e. a previous process crashed mid-append and left a torn tail.
   */
  private async endsWithoutNewline(file: string): Promise<boolean> {
    let fh;
    try {
      fh = await open(file, 'r');
    } catch (err) {
      if (isEnoent(err)) return false;
      throw err;
    }
    try {
      const st = await fh.stat();
      if (st.size === 0) return false;
      const buf = Buffer.alloc(1);
      await fh.read(buf, 0, 1, st.size - 1);
      return buf[0] !== 0x0a;
    } finally {
      await fh.close();
    }
  }

  /**
   * Append a batch: one JSON object per line, whole batch in ONE
   * O_APPEND write call. Missing directories are created (mkdir -p).
   * The first append per file heals a crash-torn tail (see module doc).
   */
  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    if (entries.length === 0) return;
    // WV3-3 (audit r3): the sibling stores (InMemory / Jsonl) never throw from
    // append, and callers (forkSession copy loop / appendMeta / delete) invoke
    // it unguarded. An fs error here (ENAMETOOLONG / EACCES / ENOSPC) would
    // break those paths asymmetrically, so this best-effort transcript store
    // matches the non-throwing contract (same posture as FileCheckpointStore).
    try {
      const file = this.filePath(key);
      await mkdir(dirname(file), { recursive: true });
      let prefix = '';
      if (!this.tailChecked.has(file)) {
        this.tailChecked.add(file);
        if (await this.endsWithoutNewline(file)) prefix = '\n';
      }
      let payload = prefix;
      for (const e of entries) payload += `${JSON.stringify(e)}\n`;
      await appendFile(file, payload, { encoding: 'utf8', flag: 'a' });
    } catch {
      // best-effort: a transcript write failure must not break the caller.
    }
  }

  /**
   * Load the full entry list for a key, or null when the key was never
   * appended to. Torn/corrupt lines (crash mid-append is a NORMAL event)
   * are silently dropped; duplicate `uuid`s keep the first occurrence.
   */
  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath(key), 'utf8');
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
    const out: SessionStoreEntry[] = [];
    const seen = new Set<string>();
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // torn tail from a crash, or a corrupt middle line
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        continue; // JSONL entries are objects; scalars are line debris
      }
      const entry = parsed as SessionStoreEntry;
      if (typeof entry.uuid === 'string') {
        if (seen.has(entry.uuid)) continue;
        seen.add(entry.uuid);
      }
      out.push(entry);
    }
    return out;
  }

  /**
   * List sessions that have a MAIN transcript under a project key, newest
   * first (mtime of main.jsonl). Subkey-only sessions are not listed,
   * matching InMemorySessionStore.
   */
  async listSessions(projectKey: string): Promise<SessionStoreListEntry[]> {
    const projectDir = join(this.root, encodeKeyComponent(projectKey));
    let names: string[];
    try {
      names = await readdir(projectDir);
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
    const out: SessionStoreListEntry[] = [];
    for (const name of names) {
      try {
        const st = await stat(join(projectDir, name, MAIN_FILE));
        out.push({ sessionId: decodeKeyComponent(name), mtime: st.mtimeMs });
      } catch (err) {
        if (!isNotASessionDir(err)) throw err; // no main transcript -> not a session
      }
    }
    // audit r4 Rst-4: break mtime ties on the (unique) session id so the
    // newest-first ordering is deterministic — same-mtimeMs sessions otherwise
    // kept readdir order, an unspecified relative sequence across runs/hosts.
    out.sort(
      (a, b) =>
        b.mtime - a.mtime ||
        (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0),
    );
    return out;
  }

  /** Delete a subkey file, or (for a main key) the whole session directory
   *  — cascading to every subkey, matching InMemorySessionStore. */
  async delete(key: SessionKey): Promise<void> {
    const isMain = key.subpath === undefined || key.subpath === '';
    if (isMain) {
      await rm(this.sessionDir(key), { recursive: true, force: true });
      return;
    }
    await rm(this.filePath(key), { force: true });
  }

  /** List the ORIGINAL subpath strings that have subkey files. */
  async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
    const subDir = join(this.sessionDir(key), SUB_DIR);
    let names: string[];
    try {
      names = await readdir(subDir);
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
    const out: string[] = [];
    for (const name of names) {
      if (!name.endsWith(JSONL_EXT)) continue;
      out.push(decodeKeyComponent(name.slice(0, -JSONL_EXT.length)));
    }
    return out;
  }
}

/**
 * Built-in file store factory (SessionManager proposal §5.1): the one-line
 * wiring for `options.sessionStore` / the future SessionManager `store`
 * option. Persistence stays OFF unless the embedder passes this in (R1:
 * the library never writes to disk on its own initiative).
 */
export function fileSessionStore(dir: string): FileSessionStore {
  return new FileSessionStore(dir);
}
