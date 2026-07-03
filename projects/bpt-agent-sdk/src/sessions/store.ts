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
      messages,
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
  env?: Record<string, string | undefined>;
};

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
  const store = new JsonlSessionStore(options);
  const sessions = await store.list();
  const infos: SDKSessionInfo[] = [];
  for (const s of sessions) {
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
  const store = new JsonlSessionStore(options);
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
