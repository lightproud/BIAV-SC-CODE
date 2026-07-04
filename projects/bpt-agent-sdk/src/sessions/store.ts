/**
 * JSONL session store.
 *
 * One `{sessionId}.jsonl` file per session under the sessions directory.
 * The first line is a meta record:
 *   { type: 'meta', sessionId, createdAt, cwd, firstPrompt }
 * Subsequent lines are the persisted user/assistant messages:
 *   { type: 'user' | 'assistant', message: { role, content }, ... }
 * Corrupt or unrecognized lines are skipped with a debug warning so a
 * damaged transcript never blocks a resume.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  APIMessageParam,
  ContentBlockParam,
  SDKSessionInfo,
} from '../types.js';
import type { SessionStore, StoredSession } from '../internal/contracts.js';

const JSONL_EXT = '.jsonl';
const SUMMARY_MAX_CHARS = 100;

/**
 * Safe session-id charset: alphanumerics plus `._-` only, and never the
 * traversal tokens `.`/`..` nor any string embedding `..`. Path separators
 * are excluded by the charset, so a sanitized id can only ever name a file
 * directly inside the sessions directory — never `../escape` or an absolute
 * path. Ids are attacker-controlled (resume/sessionId flow straight from an
 * embedder's request), so this is the single choke point that keeps
 * transcript reads and writes inside the store.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

export function isSafeSessionId(sessionId: string): boolean {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return false;
  if (sessionId === '.' || sessionId === '..') return false;
  if (sessionId.includes('..')) return false;
  return SAFE_SESSION_ID.test(sessionId);
}

/** True when a persisted content block is a tool_use block. */
function isToolUseBlock(b: unknown): b is { type: 'tool_use'; id: string } {
  return (
    typeof b === 'object' &&
    b !== null &&
    (b as { type?: unknown }).type === 'tool_use'
  );
}

/** True when a persisted content block is a tool_result block. */
function isToolResultBlock(
  b: unknown,
): b is { type: 'tool_result'; tool_use_id: string } {
  return (
    typeof b === 'object' &&
    b !== null &&
    (b as { type?: unknown }).type === 'tool_result'
  );
}

/**
 * Repair a reconstructed message list so it is always API-valid regardless of
 * which lines a damaged transcript dropped. Two orphan classes make every
 * resumed request 400 and are healed here:
 *  - A user tool_result block whose tool_use_id has no match in the
 *    immediately preceding assistant message (the tool_use line was lost, or
 *    two writers interleaved). The orphan block is dropped; if that empties
 *    the user message, the whole message is dropped.
 *  - A trailing assistant message carrying tool_use blocks with no following
 *    tool_result turn (the result line was lost). The whole message is dropped.
 * Every repair is debug-logged.
 */
function repairPairing(
  messages: APIMessageParam[],
  debug: (msg: string) => void,
  sessionId: string,
): APIMessageParam[] {
  const repaired: APIMessageParam[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg === undefined) continue;
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const prev = messages[i - 1];
      const allowed = new Set<string>();
      if (prev !== undefined && prev.role === 'assistant' && Array.isArray(prev.content)) {
        for (const b of prev.content) {
          if (isToolUseBlock(b)) allowed.add(b.id);
        }
      }
      let dropped = false;
      const filtered = msg.content.filter((b) => {
        if (isToolResultBlock(b) && !allowed.has(b.tool_use_id)) {
          dropped = true;
          return false;
        }
        return true;
      });
      if (dropped) {
        debug(
          `session store: dropped orphan tool_result block(s) in ${sessionId}${JSONL_EXT} (no matching preceding tool_use)`,
        );
      }
      if (filtered.length === 0) {
        debug(
          `session store: dropped emptied user message in ${sessionId}${JSONL_EXT} after orphan tool_result removal`,
        );
        continue;
      }
      repaired.push({ role: 'user', content: filtered });
      continue;
    }
    repaired.push(msg);
  }

  const last = repaired[repaired.length - 1];
  if (
    last !== undefined &&
    last.role === 'assistant' &&
    Array.isArray(last.content) &&
    last.content.some(isToolUseBlock)
  ) {
    debug(
      `session store: dropped trailing assistant tool_use in ${sessionId}${JSONL_EXT} (no following tool_result)`,
    );
    repaired.pop();
  }

  return repaired;
}

export type JsonlSessionStoreConfig = {
  /** Explicit directory override (options.sessionDir). */
  sessionDir?: string;
  /** Environment consulted for BPT_AGENT_HOME (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Debug logger; store failures are reported here, never thrown. */
  debug?: (msg: string) => void;
};

/**
 * Directory resolution order:
 *   sessionDir option > $BPT_AGENT_HOME/sessions > ~/.bpt-agent/sessions
 */
export function resolveSessionsDir(
  sessionDir?: string,
  env?: Record<string, string | undefined>,
): string {
  if (sessionDir !== undefined && sessionDir.length > 0) return sessionDir;
  const home = (env ?? process.env).BPT_AGENT_HOME;
  if (home !== undefined && home.length > 0) return join(home, 'sessions');
  return join(homedir(), '.bpt-agent', 'sessions');
}

export class JsonlSessionStore implements SessionStore {
  private readonly dir: string;
  private readonly debug: (msg: string) => void;

  constructor(cfg: JsonlSessionStoreConfig = {}) {
    this.dir = resolveSessionsDir(cfg.sessionDir, cfg.env);
    this.debug = cfg.debug ?? (() => undefined);
  }

  /** Absolute path of one session's transcript file. */
  filePath(sessionId: string): string {
    return join(this.dir, `${sessionId}${JSONL_EXT}`);
  }

  /**
   * Best-effort synchronous append: a failed transcript write must never
   * crash the agent run, so errors are debug-logged and swallowed.
   */
  append(sessionId: string, entry: Record<string, unknown>): void {
    if (!isSafeSessionId(sessionId)) {
      this.debug(
        `session store: refusing append for unsafe session id ${JSON.stringify(sessionId)} (would escape the sessions directory)`,
      );
      return;
    }
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.filePath(sessionId), `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (err) {
      this.debug(
        `session store: append failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async load(sessionId: string): Promise<StoredSession | null> {
    if (!isSafeSessionId(sessionId)) {
      this.debug(
        `session store: refusing load for unsafe session id ${JSON.stringify(sessionId)} (would escape the sessions directory)`,
      );
      return null;
    }
    const file = this.filePath(sessionId);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      return null;
    }

    let createdAt: number | undefined;
    let firstPrompt: string | undefined;
    let cwd: string | undefined;
    const messages: APIMessageParam[] = [];

    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]?.trim();
      if (line === undefined || line.length === 0) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.debug(
          `session store: skipping corrupt line ${i + 1} in ${sessionId}${JSONL_EXT} (invalid JSON)`,
        );
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null) {
        this.debug(
          `session store: skipping corrupt line ${i + 1} in ${sessionId}${JSONL_EXT} (not an object)`,
        );
        continue;
      }
      const entry = parsed as Record<string, unknown>;

      if (entry.type === 'meta') {
        if (typeof entry.createdAt === 'number') createdAt = entry.createdAt;
        if (typeof entry.firstPrompt === 'string') firstPrompt = entry.firstPrompt;
        if (typeof entry.cwd === 'string') cwd = entry.cwd;
        continue;
      }

      if (entry.type === 'user' || entry.type === 'assistant') {
        const message = entry.message as { content?: unknown } | undefined;
        const content = message?.content;
        if (typeof content === 'string' || Array.isArray(content)) {
          messages.push({
            role: entry.type,
            content: content as string | ContentBlockParam[],
          });
          continue;
        }
      }

      this.debug(
        `session store: skipping unrecognized line ${i + 1} in ${sessionId}${JSONL_EXT}`,
      );
    }

    let lastModified = createdAt ?? Date.now();
    try {
      const st = await stat(file);
      lastModified = st.mtimeMs;
      if (createdAt === undefined) {
        createdAt = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
      }
    } catch {
      // File raced away between read and stat; keep what we parsed.
    }

    return {
      sessionId,
      messages: repairPairing(messages, this.debug, sessionId),
      createdAt: createdAt ?? lastModified,
      lastModified,
      firstPrompt,
      cwd,
    };
  }

  async list(): Promise<StoredSession[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const sessions: StoredSession[] = [];
    for (const name of names) {
      if (!name.endsWith(JSONL_EXT)) continue;
      const loaded = await this.load(name.slice(0, -JSONL_EXT.length));
      if (loaded !== null) sessions.push(loaded);
    }
    sessions.sort((a, b) => b.lastModified - a.lastModified);
    return sessions;
  }

  async latestSessionId(): Promise<string | null> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return null;
    }
    let latest: { id: string; mtimeMs: number } | null = null;
    for (const name of names) {
      if (!name.endsWith(JSONL_EXT)) continue;
      try {
        const st = await stat(join(this.dir, name));
        if (latest === null || st.mtimeMs > latest.mtimeMs) {
          latest = { id: name.slice(0, -JSONL_EXT.length), mtimeMs: st.mtimeMs };
        }
      } catch {
        // Raced deletion; skip.
      }
    }
    return latest?.id ?? null;
  }
}

// ---------------------------------------------------------------------------
// listSessions / getSessionInfo helpers (re-exported from the package root)
// ---------------------------------------------------------------------------

export type SessionListOptions = {
  sessionDir?: string;
  /** Alias for sessionDir (the official option name); sessionDir wins if both set. */
  dir?: string;
  /** Cap the number of sessions returned (newest first). Omit for all. */
  limit?: number;
  /** Typed for compat; reading Claude Code's own session store is not supported. */
  includeWorkspace?: boolean;
  env?: Record<string, string | undefined>;
};

/** Resolve the `dir` alias onto `sessionDir` (sessionDir takes precedence). */
function resolveSessionDir(options: SessionListOptions): SessionListOptions {
  if (options.sessionDir === undefined && options.dir !== undefined) {
    return { ...options, sessionDir: options.dir };
  }
  return options;
}

function toSessionInfo(s: StoredSession, fileSize?: number): SDKSessionInfo {
  const firstLine = (s.firstPrompt ?? '').split('\n', 1)[0] ?? '';
  const summary =
    firstLine.length > SUMMARY_MAX_CHARS
      ? `${firstLine.slice(0, SUMMARY_MAX_CHARS)}...`
      : firstLine;
  return {
    sessionId: s.sessionId,
    summary,
    lastModified: s.lastModified,
    fileSize,
    firstPrompt: s.firstPrompt,
    cwd: s.cwd,
    createdAt: s.createdAt,
  };
}

/** List all sessions persisted by this SDK's JSONL store, newest first. */
export async function listSessions(
  options: SessionListOptions = {},
): Promise<SDKSessionInfo[]> {
  const resolved = resolveSessionDir(options);
  const store = new JsonlSessionStore(resolved);
  const sessions = await store.list();
  const capped =
    options.limit !== undefined && options.limit >= 0
      ? sessions.slice(0, options.limit)
      : sessions;
  const infos: SDKSessionInfo[] = [];
  for (const s of capped) {
    let fileSize: number | undefined;
    try {
      fileSize = (await stat(store.filePath(s.sessionId))).size;
    } catch {
      // Best-effort; size stays undefined.
    }
    infos.push(toSessionInfo(s, fileSize));
  }
  return infos;
}

/** Look up one persisted session by id; null when no transcript exists. */
export async function getSessionInfo(
  sessionId: string,
  options: SessionListOptions = {},
): Promise<SDKSessionInfo | null> {
  const store = new JsonlSessionStore(resolveSessionDir(options));
  const loaded = await store.load(sessionId);
  if (loaded === null) return null;
  let fileSize: number | undefined;
  try {
    fileSize = (await stat(store.filePath(sessionId))).size;
  } catch {
    // Best-effort; size stays undefined.
  }
  return toSessionInfo(loaded, fileSize);
}
