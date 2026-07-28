/**
 * External SessionStore adapter layer (options.sessionStore).
 *
 * Three pieces:
 *  1. encodeProjectKey - official project-key encoding for an absolute cwd.
 *  2. InMemorySessionStore - reference/test implementation of the PUBLIC
 *     SessionStore surface (append/load/listSessions/delete/listSubkeys).
 *  3. MirroringSessionStore - implements the INTERNAL transcript-store
 *     interface by dual-writing to a local JSONL store AND an external public
 *     store (best-effort mirror + retry + resume-across-hosts load fallback).
 *
 * Two types are named `SessionStore`: the PUBLIC one in ../types.js and the
 * INTERNAL transcript one in ../internal/contracts.js. Both are imported here
 * under aliases so neither collides.
 */

import { createHash, randomUUID } from 'node:crypto';

import type {
  SessionStore as ExternalSessionStore,
  SessionKey,
  SessionStoreEntry,
  SessionStoreListEntry,
  SDKMirrorErrorMessage,
} from '../types.js';
import type {
  SessionStore as InternalTranscriptStore,
  StoredSession,
} from '../internal/contracts.js';

const NUL = '\u0000';
const DEFAULT_LOAD_TIMEOUT_MS = 60_000;
/** Node's setTimeout ceiling: a larger delay silently overflows to ~1ms, so an
 *  `Options.loadTimeoutMs` meant to RELAX the mirror budget (e.g. 30 days as
 *  "practically never") would instead reject EVERY external load/append after
 *  1ms. Same clamp the transports / hook runner / monitor already apply. */
const MAX_LOAD_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_BACKOFF_BASE_MS = 50;
const DEFAULT_DEBOUNCE_MS = 20;
const MAX_APPEND_ATTEMPTS = 3;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Encode an absolute cwd into a project key. The human-readable portion
 * replaces every character outside [A-Za-z0-9] with '-', but that mapping is
 * lossy (`/srv/app-1`, `/srv/app_1`, and `/srv/app/1` all collapse to the same
 * string), which would let distinct working directories collide onto one key
 * and cross-contaminate sessions in an external SessionStore. To keep the key
 * injective we append a short hash of the RAW cwd, so distinct paths always
 * produce distinct keys while the readable prefix is preserved.
 */
export function encodeProjectKey(cwd: string): string {
  const readable = cwd.replace(/[^A-Za-z0-9]/g, '-');
  const digest = createHash('sha256').update(cwd).digest('hex').slice(0, 12);
  return `${readable}-${digest}`;
}

// ---------------------------------------------------------------------------
// InMemorySessionStore - reference implementation of the PUBLIC surface
// ---------------------------------------------------------------------------

/**
 * In-memory reference implementation of the public SessionStore. Entries are
 * keyed by `projectKey\0sessionId\0subpath`; append dedups by entry.uuid and
 * deleting a main key cascades to every subkey.
 */
export class InMemorySessionStore implements ExternalSessionStore {
  private readonly data = new Map<string, SessionStoreEntry[]>();
  private readonly mtimes = new Map<string, number>();

  /** Escape a key component so the NUL-joined composite key stays injective
   *  even when a component itself contains NUL (ids arrive straight from an
   *  embedder's request): without this, {sessionId:'a', subpath:'b\0c'} and
   *  {sessionId:'a\0b', subpath:'c'} collide onto ONE key, and deleting
   *  session 'a' cascades into session 'a\0x'. '%' is escaped first so the
   *  encoding stays reversible. */
  private static escapeComponent(c: string): string {
    return c.split('%').join('%25').split(NUL).join('%00');
  }

  private static unescapeComponent(c: string): string {
    return c.split('%00').join(NUL).split('%25').join('%');
  }

  private keyStr(key: SessionKey): string {
    const esc = InMemorySessionStore.escapeComponent;
    return `${esc(key.projectKey)}${NUL}${esc(key.sessionId)}${NUL}${esc(key.subpath ?? '')}`;
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    // Match FileSessionStore's empty-batch early-return (J4): an empty append
    // must not mint a phantom key — it would list as a fresh-mtime session and
    // continue:true could pick it over the real latest conversation.
    if (entries.length === 0) return;
    const k = this.keyStr(key);
    let list = this.data.get(k);
    if (list === undefined) {
      list = [];
      this.data.set(k, list);
    }
    const seen = new Set<string>();
    for (const e of list) {
      if (typeof e.uuid === 'string') seen.add(e.uuid);
    }
    for (const e of entries) {
      if (typeof e.uuid === 'string') {
        if (seen.has(e.uuid)) continue;
        seen.add(e.uuid);
      }
      list.push(e);
    }
    this.mtimes.set(k, Date.now());
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const list = this.data.get(this.keyStr(key));
    return list === undefined ? null : list.slice();
  }

  async listSessions(projectKey: string): Promise<SessionStoreListEntry[]> {
    const latest = new Map<string, number>();
    const pkEnc = InMemorySessionStore.escapeComponent(projectKey);
    for (const k of this.data.keys()) {
      const [pk, sessionIdEnc, subpath] = k.split(NUL);
      if (pk !== pkEnc) continue;
      if (subpath !== '') continue; // main transcript only
      const sessionId = InMemorySessionStore.unescapeComponent(sessionIdEnc ?? '');
      const mtime = this.mtimes.get(k) ?? 0;
      const prev = latest.get(sessionId);
      if (prev === undefined || mtime > prev) latest.set(sessionId, mtime);
    }
    // Break mtime ties on the (unique) session id, matching
    // FileSessionStore.listSessions (audit r4 Rst-4) and JsonlSessionStore.list
    // (Rst-3). Two appends landing in the SAME millisecond are ordinary here
    // (Date.now() granularity), and without a tiebreak the stable sort kept
    // this.data insertion order — so the two shipped ExternalSessionStore
    // implementations answered "newest first" differently for identical data,
    // and `continue: true` resumed the FIRST-created same-ms session.
    return [...latest.entries()]
      .map(([sessionId, mtime]) => ({ sessionId, mtime }))
      .sort(
        (a, b) =>
          b.mtime - a.mtime ||
          (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0),
      );
  }

  async delete(key: SessionKey): Promise<void> {
    const isMain = key.subpath === undefined || key.subpath === '';
    if (isMain) {
      const esc = InMemorySessionStore.escapeComponent;
      const prefix = `${esc(key.projectKey)}${NUL}${esc(key.sessionId)}${NUL}`;
      for (const k of [...this.data.keys()]) {
        if (k.startsWith(prefix)) {
          this.data.delete(k);
          this.mtimes.delete(k);
        }
      }
      return;
    }
    const k = this.keyStr(key);
    this.data.delete(k);
    this.mtimes.delete(k);
  }

  async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
    const esc = InMemorySessionStore.escapeComponent;
    const prefix = `${esc(key.projectKey)}${NUL}${esc(key.sessionId)}${NUL}`;
    const out: string[] = [];
    for (const k of this.data.keys()) {
      if (!k.startsWith(prefix)) continue;
      const subpath = k.slice(prefix.length);
      if (subpath !== '') out.push(InMemorySessionStore.unescapeComponent(subpath));
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// MirroringSessionStore - dual-write wrapper (INTERNAL transcript interface)
// ---------------------------------------------------------------------------

export type MirroringConfig = {
  /** Encoded project key for the current cwd. */
  projectKey: string;
  /** Flush cadence: eager (flush each append) or batched (debounce). */
  flush?: 'batched' | 'eager';
  /** Timeout for each external load()/append() attempt. */
  loadTimeoutMs?: number;
  /** Retry backoff base (ms); attempt N waits base * 2^(N-1). Testing hook. */
  backoffBaseMs?: number;
  /** Batched-mode debounce window (ms). Testing hook. */
  debounceMs?: number;
  debug?: (msg: string) => void;
};

/** Internal sentinel: a mirror append attempt exceeded its timeout budget. */
class MirrorTimeoutError extends Error {
  override name = 'MirrorTimeoutError';
  /** The budget is the whole point of this error: on the append path the text
   *  is what a host sees (the `mirror_error` system event carries it and
   *  nothing else), and without the number — plus the knob that sets it — a
   *  slow external store reads as "timed out" with nothing to turn. */
  constructor(timeoutMs: number) {
    super(
      `external sessionStore operation timed out after ${timeoutMs}ms (options.loadTimeoutMs)`,
    );
  }
}

/**
 * Wraps a local transcript store and mirrors every append to an external
 * public store. Implements the internal SessionStore interface so every
 * existing persist call site is untouched.
 */
export class MirroringSessionStore implements InternalTranscriptStore {
  private readonly projectKey: string;
  private readonly flushMode: 'batched' | 'eager';
  private readonly loadTimeoutMs: number;
  private readonly backoffBaseMs: number;
  private readonly debounceMs: number;
  private readonly debug: (msg: string) => void;

  private readonly buffers = new Map<string, SessionStoreEntry[]>();
  private readonly chains = new Map<string, Promise<void>>();
  // Finding H2 — coalesce concurrent same-process load()s for one session onto
  // a single materialization, so two racing query() resumes cannot each append
  // the external transcript into the local JSONL (2N lines on disk). The
  // read-side uuid dedup in JsonlSessionStore.load is the cross-process
  // backstop; this avoids the wasteful double-write in the common in-process
  // fan-out case.
  private readonly loadInFlight = new Map<string, Promise<StoredSession | null>>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private events: SDKMirrorErrorMessage[] = [];

  constructor(
    private readonly local: InternalTranscriptStore,
    private readonly external: ExternalSessionStore,
    config: MirroringConfig,
  ) {
    this.projectKey = config.projectKey;
    this.flushMode = config.flush ?? 'batched';
    // A non-finite budget (Number(unset env)) would land NaN in setTimeout,
    // which coerces to 0 — every mirror op failing after ~1ms instead of
    // waiting. Fall back to the default; clamp the finite range to the timer
    // ceiling so an over-large budget bounds rather than instantly expires.
    const rawLoadTimeout = config.loadTimeoutMs;
    this.loadTimeoutMs =
      rawLoadTimeout !== undefined && Number.isFinite(rawLoadTimeout) && rawLoadTimeout > 0
        ? Math.min(rawLoadTimeout, MAX_LOAD_TIMEOUT_MS)
        : DEFAULT_LOAD_TIMEOUT_MS;
    this.backoffBaseMs = config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.debug = config.debug ?? (() => undefined);
  }

  // -- internal SessionStore interface ---------------------------------------

  append(sessionId: string, entry: Record<string, unknown>): void {
    // (a) local write first - durable, unchanged behavior.
    this.local.append(sessionId, entry);
    // (b) normalize for the mirror (ensure a uuid so adapters can dedup).
    const normalized: SessionStoreEntry = {
      ...entry,
      type: typeof entry.type === 'string' ? (entry.type as string) : 'unknown',
      uuid: typeof entry.uuid === 'string' ? (entry.uuid as string) : randomUUID(),
    };
    let buf = this.buffers.get(sessionId);
    if (buf === undefined) {
      buf = [];
      this.buffers.set(sessionId, buf);
    }
    buf.push(normalized);
    // (c) schedule the flush.
    if (this.flushMode === 'eager') {
      queueMicrotask(() => {
        void this.flushKey(sessionId);
      });
    } else {
      this.scheduleDebounced();
    }
  }

  async load(sessionId: string): Promise<StoredSession | null> {
    const inFlight = this.loadInFlight.get(sessionId);
    if (inFlight !== undefined) return inFlight;
    const run = this.loadUncoalesced(sessionId);
    this.loadInFlight.set(sessionId, run);
    try {
      return await run;
    } finally {
      this.loadInFlight.delete(sessionId);
    }
  }

  private async loadUncoalesced(sessionId: string): Promise<StoredSession | null> {
    const localResult = await this.local.load(sessionId);
    if (localResult !== null) return localResult;
    // Miss: resume across hosts - pull the transcript from the external store.
    const key: SessionKey = { projectKey: this.projectKey, sessionId };
    let entries: SessionStoreEntry[] | null;
    try {
      entries = await this.withTimeout(this.external.load(key));
    } catch (err) {
      this.debug(`sessionStore load failed for ${sessionId}: ${errMessage(err)}`);
      return null;
    }
    if (entries === null || entries.length === 0) return null;
    return this.materializeAndLoad(sessionId, entries);
  }

  /** Materialize already-fetched external entries into the local JSONL (so all
   *  parse/repair logic is reused) and load the result. DELIBERATE side
   *  effect: the local JSONL acts as this host's cache of the external
   *  transcript (kept by design — audit 2026-07-17 L55). */
  private async materializeAndLoad(
    sessionId: string,
    entries: SessionStoreEntry[],
  ): Promise<StoredSession | null> {
    // Re-check after the (awaited) external fetch: a sibling loader for this
    // session may have materialized it while we were fetching. If so, reuse its
    // JSONL instead of appending a second copy (finding H2).
    const raced = await this.local.load(sessionId);
    if (raced !== null) return raced;
    for (const e of entries) {
      this.local.append(sessionId, e as Record<string, unknown>);
    }
    return this.local.load(sessionId);
  }

  /**
   * True when an external transcript is a subagent SIDECHAIN (its first record
   * is `sidechain_start`). The local JsonlSessionStore filters these out of
   * list()/latestSessionId() (store.ts isSidechainFile / loadInfo), but the
   * cross-host external fallbacks below bypassed that guard, so a mirrored
   * `<agentId>` child transcript could surface as a resumable session or be
   * picked as the newest to resume. Fetch-and-inspect the first record to
   * apply the same guard; on any error, do not hide the session.
   */
  private async externalIsSidechain(sessionId: string): Promise<boolean> {
    try {
      const key: SessionKey = { projectKey: this.projectKey, sessionId };
      const entries = await this.withTimeout(this.external.load(key));
      const first = entries?.[0] as { type?: unknown } | undefined;
      return first !== undefined && first.type === 'sidechain_start';
    } catch {
      return false;
    }
  }

  async list(): Promise<StoredSession[]> {
    const localList = await this.local.list();
    if (localList.length > 0) return localList;
    if (this.external.listSessions === undefined) return localList;
    let listed: SessionStoreListEntry[];
    try {
      listed = await this.withTimeout(this.external.listSessions(this.projectKey));
    } catch (err) {
      this.debug(`sessionStore listSessions failed: ${errMessage(err)}`);
      return localList;
    }
    const out: StoredSession[] = [];
    for (const { sessionId } of listed) {
      // ONE external fetch per session (audit 2026-07-17 L50): the sidechain
      // probe and the load below used to EACH pull the full transcript. The
      // single fetch now serves both the probe and the materialization.
      const key: SessionKey = { projectKey: this.projectKey, sessionId };
      let entries: SessionStoreEntry[] | null = null;
      try {
        entries = await this.withTimeout(this.external.load(key));
      } catch (err) {
        this.debug(`sessionStore list-load failed for ${sessionId}: ${errMessage(err)}`);
      }
      const first = entries?.[0] as { type?: unknown } | undefined;
      if (first !== undefined && first.type === 'sidechain_start') continue;
      // External unavailable/empty: fall back to a local cache hit (same
      // fail-open posture as the old externalIsSidechain catch).
      const s =
        entries === null || entries.length === 0
          ? await this.local.load(sessionId)
          : await this.materializeAndLoad(sessionId, entries);
      if (s !== null) out.push(s);
    }
    // Same-lastModified ties break on the (unique) session id, matching the
    // local JsonlSessionStore.list ordering (audit r4 Rst-3). Without it the
    // stable sort inherited the EXTERNAL store's listing order, so the same two
    // same-ms sessions listed newest-first differently depending on an
    // arbitrary remote enumeration — and disagreed with the local path.
    out.sort(
      (a, b) =>
        b.lastModified - a.lastModified ||
        (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0),
    );
    return out;
  }

  async latestSessionId(): Promise<string | null> {
    const local = await this.local.latestSessionId();
    if (local !== null) return local;
    if (this.external.listSessions === undefined) return null;
    try {
      const listed = await this.withTimeout(this.external.listSessions(this.projectKey));
      if (listed.length === 0) return null;
      // Newest first, then skip sidechain transcripts (the guard the local
      // store applies) — return the newest genuine conversation. Same-mtime
      // ties break on the (unique) id so this agrees with list() above and with
      // JsonlSessionStore.latestSessionId (audit r4 Rst-3); otherwise the
      // external store's arbitrary listing order decided which same-ms session
      // `continue: true` resumed.
      const sorted = [...listed].sort(
        (a, b) =>
          b.mtime - a.mtime ||
          (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0),
      );
      for (const e of sorted) {
        if (!(await this.externalIsSidechain(e.sessionId))) return e.sessionId;
      }
      return null;
    } catch (err) {
      this.debug(`sessionStore latest lookup failed: ${errMessage(err)}`);
      return null;
    }
  }

  /**
   * Duck-typed passthrough for the `filePath` concretion runtime.ts reads to
   * populate the SubagentStop hook's `agent_transcript_path`. `filePath` lives
   * on JsonlSessionStore, NOT on InternalTranscriptStore, so runtime.ts casts
   * the store to `{ filePath?: (id) => string }` — but this wrapper sat in
   * between and never forwarded, so the field was always undefined whenever an
   * external `sessionStore` was injected (even though the local JsonlSessionStore
   * DID write the child transcript under `<agentId>.jsonl`). Forward to the
   * wrapped local store when it exposes `filePath`; return undefined otherwise
   * (InMemorySessionStore / bare stubs stay unaffected). Same cast shape
   * runtime.ts uses on the raw store.
   */
  filePath(sessionId: string): string | undefined {
    const fn = (this.local as { filePath?: (id: string) => string } | undefined)?.filePath;
    return typeof fn === 'function' ? fn.call(this.local, sessionId) : undefined;
  }

  // -- mirror event + flush surface (query.ts drains these) ------------------

  /** Drain and return any queued mirror-error system messages. */
  takePendingEvents(): SDKMirrorErrorMessage[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Flush every buffered key; awaited in run()'s finally. Best-effort. */
  async flushAll(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const keys = new Set<string>([...this.buffers.keys(), ...this.chains.keys()]);
    await Promise.all([...keys].map((k) => this.flushKey(k)));
  }

  // -- internals -------------------------------------------------------------

  private scheduleDebounced(): void {
    if (this.debounceTimer !== null) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flushAll();
    }, this.debounceMs);
    if (typeof this.debounceTimer.unref === 'function') this.debounceTimer.unref();
  }

  /** Serialize per-key flushes so eager microtasks never interleave a batch. */
  private flushKey(sessionId: string): Promise<void> {
    const prev = this.chains.get(sessionId) ?? Promise.resolve();
    const next = prev.then(() => this.doFlush(sessionId));
    // Drop the chain entry once THIS link settles and nothing queued behind it
    // (the tail is still us). Without the prune both maps kept one permanent
    // entry per session id — and every SUBAGENT transcript is its own id
    // (runtime.ts appends child turns under `agentId`), so a long-lived
    // coordinator that spawns hundreds of children grew `chains`/`buffers`
    // without bound AND made each debounced flushAll() fan Promise.all over
    // every agent that ever ran. Same push-only leak shape as the background
    // finalizer set (audit r4 Stim-1).
    let tracked: Promise<void>;
    tracked = next.catch(() => undefined).then(() => {
      if (this.chains.get(sessionId) === tracked) this.chains.delete(sessionId);
    });
    this.chains.set(sessionId, tracked);
    return next;
  }

  private async doFlush(sessionId: string): Promise<void> {
    const buf = this.buffers.get(sessionId);
    if (buf === undefined || buf.length === 0) {
      // An emptied buffer is dead weight: append() re-creates it on demand.
      if (buf !== undefined) this.buffers.delete(sessionId);
      return;
    }
    const batch = buf.splice(0, buf.length);
    // Same reason: the array is drained, so release the map slot. `batch`
    // already holds the entries, and a concurrent append() simply installs a
    // fresh array under this key.
    this.buffers.delete(sessionId);
    const key: SessionKey = { projectKey: this.projectKey, sessionId };
    try {
      await this.appendWithRetry(key, batch);
    } catch (err) {
      // Final failure: local copy is durable, so drop the batch and surface.
      this.debug(`sessionStore mirror failed for ${sessionId}: ${errMessage(err)}`);
      this.events.push({
        type: 'system',
        subtype: 'mirror_error',
        uuid: randomUUID(),
        session_id: sessionId,
        error: errMessage(err),
      });
    }
  }

  private async appendWithRetry(key: SessionKey, batch: SessionStoreEntry[]): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt += 1) {
      try {
        await this.withTimeout(this.external.append(key, batch));
        return;
      } catch (err) {
        lastErr = err;
        // A timed-out attempt may still land - do NOT retry (avoid dupes).
        if (err instanceof MirrorTimeoutError) throw err;
        if (attempt < MAX_APPEND_ATTEMPTS) {
          await delay(this.backoffBaseMs * 2 ** (attempt - 1));
        }
      }
    }
    throw lastErr;
  }

  /**
   * Race a store operation against loadTimeoutMs. A late resolution of the
   * underlying promise is harmless (its handlers are attached), so a timed-out
   * append can still land in the backend later.
   */
  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new MirrorTimeoutError(this.loadTimeoutMs)),
        this.loadTimeoutMs,
      );
      if (typeof timer.unref === 'function') timer.unref();
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e: unknown) => {
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}
