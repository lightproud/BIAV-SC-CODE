/**
 * Standalone session-management helpers.
 *
 * getSessionMessages / renameSession / tagSession / deleteSession /
 * forkSession operate over either the LOCAL JSONL store or, when
 * options.sessionStore is passed, an EXTERNAL public store.
 *
 * These read raw persisted entries directly (rather than JsonlSessionStore.load
 * which collapses to API messages) so per-message uuid / parent_tool_use_id
 * survive into the returned SessionMessage[].
 */

import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import process from 'node:process';
import { join } from 'node:path';

import { ConfigurationError } from '../errors.js';

import type {
  SessionStore as ExternalSessionStore,
  SDKToolCallRecord,
  SessionKey,
  SessionMessage,
  SessionStoreEntry,
} from '../types.js';
import { JsonlSessionStore, isSafeSessionId, resolveSessionsDir } from './store.js';
import { encodeProjectKey } from './store-adapter.js';

export type SessionMutationOptions = {
  sessionDir?: string;
  /** Official option name: the session/project directory. Alias of
   *  sessionDir (sessionDir wins when both are set). */
  dir?: string;
  env?: Record<string, string | undefined>;
  /** External store; when set, all operations target it instead of local disk. */
  sessionStore?: ExternalSessionStore;
  /** Working dir used to derive the external project key. Default process.cwd(). */
  cwd?: string;
  /** Optional diagnostic sink (audit 2026-07-14 L-19b). Used to surface
   *  no-op mutations a host might otherwise read as success — e.g. a
   *  deleteSession against an external store that exposes no `delete`. */
  debug?: (msg: string) => void;
};

export type GetSessionMessagesOptions = SessionMutationOptions & {
  /** Official: maximum number of messages to return. */
  limit?: number;
  /** Official: number of messages to skip from the start. */
  offset?: number;
};

/** Resolve the official `dir` alias onto sessionDir (sessionDir wins). */
function sessionDirOf(options: SessionMutationOptions): string | undefined {
  return options.sessionDir ?? options.dir;
}

function mainKey(sessionId: string, options: SessionMutationOptions): SessionKey {
  return { projectKey: encodeProjectKey(options.cwd ?? process.cwd()), sessionId };
}

/** Read every persisted JSONL entry for a local session (raw objects). */
async function readLocalEntries(
  sessionId: string,
  options: SessionMutationOptions,
): Promise<Record<string, unknown>[]> {
  if (!isSafeSessionId(sessionId)) return [];
  const dir = resolveSessionsDir(sessionDirOf(options), options.env);
  const file = join(dir, `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  // Finding H2 read-time uuid dedup (mirrors JsonlSessionStore.load): a
  // concurrent cross-host resume can double-materialize a transcript, and this
  // audit/export/fork read path must collapse it too — otherwise forkSession
  // rewrites each duplicate to a DISTINCT fresh uuid, baking the doubling in
  // permanently so load()'s own dedup can never collapse it again.
  const seenUuids = new Set<string>();
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      const o = JSON.parse(t);
      if (o !== null && typeof o === 'object') {
        const rec = o as Record<string, unknown>;
        if (typeof rec.uuid === 'string') {
          if (seenUuids.has(rec.uuid)) continue;
          seenUuids.add(rec.uuid);
        }
        out.push(rec);
      }
    } catch {
      // Skip corrupt lines.
    }
  }
  return out;
}

function entryToSessionMessage(
  e: Record<string, unknown>,
  sessionId: string,
): SessionMessage | null {
  const type = e.type;
  if (type !== 'user' && type !== 'assistant') return null;
  // Reject a missing OR malformed message (null / non-object): the resume path
  // (store.ts load) shape-checks message before use, but this audit/export path
  // fed `message` straight through, so a `{message:null}` line crashed any
  // consumer doing `.message.content` (e.g. auditSessionToolClaims).
  if (e.message === null || typeof e.message !== 'object') return null;
  return {
    type,
    uuid: typeof e.uuid === 'string' ? e.uuid : randomUUID(),
    session_id: typeof e.session_id === 'string' ? e.session_id : sessionId,
    message: e.message,
    parent_tool_use_id:
      typeof e.parent_tool_use_id === 'string' ? e.parent_tool_use_id : null,
    // Official field (0.3.202): read the persisted agentId of the spawning
    // subagent when present; transcripts whose metadata lacks it report null.
    parent_agent_id:
      typeof e.parent_agent_id === 'string' ? e.parent_agent_id : null,
  };
}

/**
 * Read every persisted entry (raw objects) for a session — local JSONL or the
 * external store. The shared low-level read under getSessionMessages /
 * getSessionToolCalls / getSessionAccounting (R1).
 */
export async function readSessionEntries(
  sessionId: string,
  options: SessionMutationOptions = {},
): Promise<Record<string, unknown>[]> {
  if (options.sessionStore !== undefined) {
    const loaded = await options.sessionStore.load(mainKey(sessionId, options));
    return (loaded ?? []) as Record<string, unknown>[];
  }
  return readLocalEntries(sessionId, options);
}

/**
 * Return the persisted transcript as SessionMessage[], in write order.
 *
 * This returns the FULL persisted user/assistant sequence. Compaction operates
 * on the live in-memory request view (engine/compaction.ts) and does NOT
 * rewrite the durable transcript — the folded-away messages stay on disk — so
 * there is no post-compaction chain to follow here, and audit/synthesis
 * consumers (e.g. auditSessionToolClaims) deliberately see the complete
 * history rather than the trimmed view a given turn happened to send.
 * (Corrected 2026-07-13: the prior doc claimed a post-compaction view was
 * followed, which the body never did.)
 */
export async function getSessionMessages(
  sessionId: string,
  options: GetSessionMessagesOptions = {},
): Promise<SessionMessage[]> {
  let entries: Record<string, unknown>[];
  if (options.sessionStore !== undefined) {
    const loaded = await options.sessionStore.load(mainKey(sessionId, options));
    entries = (loaded ?? []) as Record<string, unknown>[];
  } else {
    entries = await readLocalEntries(sessionId, options);
  }
  const out: SessionMessage[] = [];
  for (const e of entries) {
    const m = entryToSessionMessage(e, sessionId);
    if (m !== null) out.push(m);
  }
  // Official pagination: skip `offset` from the start, cap at `limit`.
  const offset = options.offset !== undefined && options.offset > 0 ? options.offset : 0;
  const end =
    options.limit !== undefined && options.limit >= 0 ? offset + options.limit : undefined;
  return offset > 0 || end !== undefined ? out.slice(offset, end) : out;
}

/**
 * Return the structured tool-call records persisted for a session (governance
 * spec S3), in write order. Together with getSessionMessages this is the
 * export surface for synthesis pipelines and audit tools: `type` distinguishes
 * text from tool calls without parsing natural language, and `timestamp`/`seq`
 * keep tool calls alignable with the message sequence. An incognito session
 * (S2) has no transcript, hence no records.
 */
export async function getSessionToolCalls(
  sessionId: string,
  options: SessionMutationOptions = {},
): Promise<SDKToolCallRecord[]> {
  let entries: Record<string, unknown>[];
  if (options.sessionStore !== undefined) {
    const loaded = await options.sessionStore.load(mainKey(sessionId, options));
    entries = (loaded ?? []) as Record<string, unknown>[];
  } else {
    entries = await readLocalEntries(sessionId, options);
  }
  const out: SDKToolCallRecord[] = [];
  for (const e of entries) {
    if (e.type !== 'tool_call') continue;
    if (typeof e.tool_use_id !== 'string' || typeof e.tool_name !== 'string') continue;
    out.push(e as unknown as SDKToolCallRecord);
  }
  return out;
}

/** Set the human-readable title for a session (last write wins). The official
 *  contract requires the title to be non-empty after trimming whitespace; the
 *  trimmed title is what gets persisted. */
export async function renameSession(
  sessionId: string,
  title: string,
  options: SessionMutationOptions = {},
): Promise<void> {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (trimmed.length === 0) {
    throw new ConfigurationError(
      'renameSession: title must be non-empty after trimming whitespace',
    );
  }
  await appendMeta(sessionId, { customTitle: trimmed }, options);
}

/** Set (or clear, when tag is null) the session tag. */
export async function tagSession(
  sessionId: string,
  tag: string | null,
  options: SessionMutationOptions = {},
): Promise<void> {
  await appendMeta(sessionId, { tag }, options);
}

async function appendMeta(
  sessionId: string,
  fields: Record<string, unknown>,
  options: SessionMutationOptions,
): Promise<void> {
  const entry = { type: 'meta_update', uuid: randomUUID(), ...fields };
  if (options.sessionStore !== undefined) {
    await options.sessionStore.append(mainKey(sessionId, options), [entry as SessionStoreEntry]);
    return;
  }
  const store = new JsonlSessionStore({ sessionDir: sessionDirOf(options), env: options.env });
  store.append(sessionId, entry);
}

/** Delete a session transcript (and its file-checkpoint dir, when local). */
export async function deleteSession(
  sessionId: string,
  options: SessionMutationOptions = {},
): Promise<void> {
  if (options.sessionStore !== undefined) {
    if (options.sessionStore.delete !== undefined) {
      await options.sessionStore.delete(mainKey(sessionId, options));
    } else {
      // audit 2026-07-14 L-19b: the external store has no delete capability, so
      // nothing was removed. Resolve (do NOT throw — that would break the
      // local-only happy path), but emit a debug line so a host is not misled
      // into believing the session's private data was actually deleted.
      options.debug?.(
        `deleteSession: external store exposes no delete(); session '${sessionId}' ` +
          `was NOT removed (no-op)`,
      );
    }
    return;
  }
  if (!isSafeSessionId(sessionId)) return;
  const dir = resolveSessionsDir(sessionDirOf(options), options.env);
  await rm(join(dir, `${sessionId}.jsonl`), { force: true });
  await rm(join(dir, 'checkpoints', sessionId), { recursive: true, force: true });
}

/**
 * Fork a session: copy its transcript under a fresh id, rewriting session-id
 * fields and remapping per-message uuids. Returns the new session id.
 */
export async function forkSession(
  sessionId: string,
  options: SessionMutationOptions = {},
): Promise<string> {
  const newId = randomUUID();
  if (options.sessionStore !== undefined) {
    const store = options.sessionStore;
    const loaded = (await store.load(mainKey(sessionId, options))) ?? [];
    const entries = rewriteEntries(
      loaded as unknown as Record<string, unknown>[],
      sessionId,
      newId,
    ) as SessionStoreEntry[];
    await store.append(mainKey(newId, options), entries);
    return newId;
  }
  const entries = await readLocalEntries(sessionId, options);
  const store = new JsonlSessionStore({ sessionDir: sessionDirOf(options), env: options.env });
  for (const e of rewriteEntries(entries, sessionId, newId)) {
    store.append(newId, e);
  }
  return newId;
}

/**
 * Rewrite a whole transcript for a fork: session-id fields to newId AND every
 * message uuid to a fresh one — but CONSISTENTLY, so cross-references between
 * records still resolve. A `pending_turn` record's `turn_ref` points at a user
 * message's uuid and a `turn_complete` record's `pending_uuid` points at the
 * pending_turn's uuid; rewriting each uuid independently (the old per-entry
 * rewrite) left those pointers dangling → the fork's write-ahead checkpoint
 * read as a permanently-interrupted turn (bad list/getSessionInfo metadata),
 * and a source ending on a user turn triggered a phantom redrive on resume
 * (a duplicate billed API call). A single old→new uuid map fixes all three.
 */
function rewriteEntries(
  entries: Record<string, unknown>[],
  oldId: string,
  newId: string,
): Record<string, unknown>[] {
  // Pass 1: assign a fresh uuid for every record that carries one.
  const uuidMap = new Map<string, string>();
  for (const e of entries) {
    if (typeof e.uuid === 'string' && !uuidMap.has(e.uuid)) {
      uuidMap.set(e.uuid, randomUUID());
    }
  }
  // Pass 2: rewrite session ids, the record's own uuid, and any uuid the record
  // REFERENCES (turn_ref / pending_uuid) via the same map.
  const remap = (v: unknown): unknown =>
    typeof v === 'string' && uuidMap.has(v) ? uuidMap.get(v) : v;
  return entries.map((e) => {
    const out: Record<string, unknown> = { ...e };
    if (typeof out.sessionId === 'string') out.sessionId = newId;
    if (typeof out.session_id === 'string') out.session_id = newId;
    if (out.sessionId === oldId) out.sessionId = newId;
    if (typeof out.uuid === 'string') out.uuid = uuidMap.get(out.uuid) ?? randomUUID();
    if (out.turn_ref !== undefined) out.turn_ref = remap(out.turn_ref);
    if (out.pending_uuid !== undefined) out.pending_uuid = remap(out.pending_uuid);
    return out;
  });
}
