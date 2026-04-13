/**
 * logger.ts — Structured logger + token usage SQLite via sql.js (pure WASM).
 *
 * Why sql.js instead of better-sqlite3: better-sqlite3 requires native C++
 * compilation (Visual Studio Build Tools on Windows). sql.js is pure WASM,
 * zero native dependencies, works everywhere Electron runs.
 *
 * Trade-off: sql.js runs in-memory and must be explicitly flushed to disk.
 * Token log is append-only so flush after every write is acceptable.
 *
 * Why SQLite for token logs: token usage data is append-only, query-heavy
 * (sum by conversation, sum by day, export to CSV), and must survive app
 * restarts. SQLite is the simplest durable store that fits this pattern.
 *
 * Why JSON for general logs: structured logs are AI-friendly. When Light
 * pastes a log into Claude Code for debugging, Claude can parse JSON
 * much faster than free-form text.
 */

import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';

// ── General Logger ──────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    module,
    message,
    ...(data ? { data } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (module: string, msg: string, data?: Record<string, unknown>) => log('debug', module, msg, data),
  info: (module: string, msg: string, data?: Record<string, unknown>) => log('info', module, msg, data),
  warn: (module: string, msg: string, data?: Record<string, unknown>) => log('warn', module, msg, data),
  error: (module: string, msg: string, data?: Record<string, unknown>) => log('error', module, msg, data),
};

// ── Token Usage SQLite ──────────────────────────────────────────

let db: SqlJsDatabase | null = null;
let dbPath = '';

/**
 * Flush the in-memory token log database to disk.
 */
function flush(): void {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (err) {
    logger.error('token-log', 'Failed to flush token log to disk', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Initialize the token log database.
 * Must be called (and awaited) before logTokenUsage / getTokenHistory.
 */
export async function initTokenLogDb(): Promise<void> {
  dbPath = path.join(app.getPath('userData'), 'token-log.sqlite');

  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    try {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } catch (err) {
      logger.warn('token-log', 'Failed to load existing token log, creating new', {
        error: err instanceof Error ? err.message : String(err),
      });
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS token_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      system_tokens INTEGER DEFAULT 0,
      tools_tokens INTEGER DEFAULT 0,
      history_tokens INTEGER DEFAULT 0,
      generation_tokens INTEGER DEFAULT 0,
      cache_hit_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0,
      tools_used TEXT DEFAULT '[]',
      gear TEXT DEFAULT 'chat'
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_token_log_conv ON token_log(conversation_id)');

  flush();
}

/**
 * Close the token log database.
 */
export function closeTokenLogDb(): void {
  if (db) {
    flush();
    db.close();
    db = null;
  }
}

export function logTokenUsage(entry: Record<string, unknown>): void {
  if (!db) return;

  db.run(
    `INSERT INTO token_log (conversation_id, timestamp, system_tokens, tools_tokens,
      history_tokens, generation_tokens, cache_hit_tokens, cache_write_tokens,
      estimated_cost_usd, tools_used, gear)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(entry.conversationId ?? ''),
      Date.now(),
      Number(entry.system ?? 0),
      Number(entry.tools ?? 0),
      Number(entry.history ?? 0),
      Number(entry.generation ?? 0),
      Number(entry.cacheHit ?? 0),
      Number(entry.cacheWrite ?? 0),
      Number(entry.estimatedCostUsd ?? 0),
      JSON.stringify(entry.toolsUsed ?? []),
      String(entry.gear ?? 'chat'),
    ],
  );
  flush();
}

export function getTokenHistory(conversationId: string): unknown[] {
  if (!db) return [];

  const stmt = db.prepare(
    'SELECT * FROM token_log WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT 100',
  );
  stmt.bind([conversationId]);

  const rows: unknown[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}
