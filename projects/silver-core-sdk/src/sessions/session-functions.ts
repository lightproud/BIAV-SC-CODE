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
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      const o = JSON.parse(t);
      if (o !== null && typeof o === 'object') out.push(o as Record<string, unknown>);
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
  if (e.message === undefined) return null;
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
 * Return the persisted transcript as SessionMessage[]. When a compaction
 * summary chain is present the post-compaction view is followed; otherwise the
 * raw user/assistant sequence is returned.
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
    const loaded = await store.load(mainKey(sessionId, options));
    const entries = (loaded ?? []).map((e) =>
      rewriteEntry(e as Record<string, unknown>, sessionId, newId),
    ) as SessionStoreEntry[];
    await store.append(mainKey(newId, options), entries);
    return newId;
  }
  const entries = await readLocalEntries(sessionId, options);
  const store = new JsonlSessionStore({ sessionDir: sessionDirOf(options), env: options.env });
  for (const e of entries) {
    store.append(newId, rewriteEntry(e, sessionId, newId));
  }
  return newId;
}

/** Rewrite session-id fields to newId and mint a fresh message uuid. */
function rewriteEntry(
  e: Record<string, unknown>,
  oldId: string,
  newId: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...e };
  if (typeof out.sessionId === 'string') out.sessionId = newId;
  if (typeof out.session_id === 'string') out.session_id = newId;
  if (out.sessionId === oldId) out.sessionId = newId;
  if (typeof out.uuid === 'string') out.uuid = randomUUID();
  return out;
}
