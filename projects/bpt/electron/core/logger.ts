/**
 * logger.ts — Structured logger + token usage SQLite.
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
import { app } from 'electron';
import Database from 'better-sqlite3';

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

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath('userData'), 'token-log.sqlite');
  db = new Database(dbPath);

  db.exec(`
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
    );
    CREATE INDEX IF NOT EXISTS idx_token_log_conv ON token_log(conversation_id);
  `);

  return db;
}

export function logTokenUsage(entry: Record<string, unknown>): void {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO token_log (conversation_id, timestamp, system_tokens, tools_tokens,
      history_tokens, generation_tokens, cache_hit_tokens, cache_write_tokens,
      estimated_cost_usd, tools_used, gear)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    entry.conversationId ?? '',
    Date.now(),
    entry.system ?? 0,
    entry.tools ?? 0,
    entry.history ?? 0,
    entry.generation ?? 0,
    entry.cacheHit ?? 0,
    entry.cacheWrite ?? 0,
    entry.estimatedCostUsd ?? 0,
    JSON.stringify(entry.toolsUsed ?? []),
    entry.gear ?? 'chat',
  );
}

export function getTokenHistory(conversationId: string): unknown[] {
  const d = getDb();
  const stmt = d.prepare(
    'SELECT * FROM token_log WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT 100',
  );
  return stmt.all(conversationId);
}
