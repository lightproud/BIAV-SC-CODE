/**
 * store.ts — SQLite conversation persistence via sql.js (pure WASM).
 *
 * Why sql.js instead of better-sqlite3: better-sqlite3 requires native C++
 * compilation (Visual Studio Build Tools on Windows). sql.js is pure WASM,
 * zero native dependencies, works everywhere Electron runs.
 *
 * Trade-off: sql.js runs in-memory and must be explicitly flushed to disk.
 * We flush after every write operation to ensure durability.
 *
 * Schema:
 *   conversations(id, title, gear, created_at, updated_at)
 *   messages(id, conversation_id, role, content_json, timestamp)
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../core/logger';

let db: SqlJsDatabase | null = null;
let dbPath = '';

/**
 * Flush the in-memory database to disk.
 * sql.js operates in-memory; this persists the current state.
 */
function flush(): void {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (err) {
    logger.error('store', 'Failed to flush database to disk', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Initialize the conversation database.
 * Creates tables if they don't exist.
 */
export async function initConversationDb(): Promise<void> {
  dbPath = path.join(app.getPath('userData'), 'conversations.db');
  logger.info('store', 'Opening conversation database', { path: dbPath });

  const SQL = await initSqlJs();

  // Load existing database from disk if it exists
  if (fs.existsSync(dbPath)) {
    try {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } catch (err) {
      logger.warn('store', 'Failed to load existing database, creating new', {
        error: err instanceof Error ? err.message : String(err),
      });
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      gear TEXT NOT NULL DEFAULT 'chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, timestamp)');

  flush();
  logger.info('store', 'Conversation database ready');
}

/**
 * Close the database connection.
 */
export function closeConversationDb(): void {
  if (db) {
    flush();
    db.close();
    db = null;
  }
}

// ── Conversation CRUD ──────────────────────────────────────────

interface ConvRow {
  id: string;
  title: string;
  gear: string;
  created_at: number;
  updated_at: number;
}

export function listConversations(): ConvRow[] {
  if (!db) return [];
  const stmt = db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC');
  const rows: ConvRow[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as ConvRow);
  }
  stmt.free();
  return rows;
}

export function createConversation(id: string, title: string, gear: string): ConvRow {
  if (!db) throw new Error('Database not initialized');
  const now = Date.now();
  db.run(
    'INSERT INTO conversations (id, title, gear, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, title, gear, now, now],
  );
  flush();
  return { id, title, gear, created_at: now, updated_at: now };
}

export function deleteConversation(id: string): void {
  if (!db) return;
  db.run('DELETE FROM conversations WHERE id = ?', [id]);
  flush();
}

export function updateConversationTitle(id: string, title: string): void {
  if (!db) return;
  db.run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', [title, Date.now(), id]);
  flush();
}

export function touchConversation(id: string): void {
  if (!db) return;
  db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [Date.now(), id]);
  flush();
}

// ── Message CRUD ───────────────────────────────────────────────

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content_json: string;
  timestamp: number;
}

export function getMessages(conversationId: string): MessageRow[] {
  if (!db) return [];
  const stmt = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC');
  stmt.bind([conversationId]);
  const rows: MessageRow[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as MessageRow);
  }
  stmt.free();
  return rows;
}

export function addMessage(
  id: string,
  conversationId: string,
  role: string,
  contentJson: string,
  timestamp: number,
): void {
  if (!db) return;

  // Ensure conversation exists
  const checkStmt = db.prepare('SELECT id FROM conversations WHERE id = ?');
  checkStmt.bind([conversationId]);
  const exists = checkStmt.step();
  checkStmt.free();

  if (!exists) {
    createConversation(conversationId, 'Untitled', 'chat');
  }

  db.run(
    'INSERT OR REPLACE INTO messages (id, conversation_id, role, content_json, timestamp) VALUES (?, ?, ?, ?, ?)',
    [id, conversationId, role, contentJson, timestamp],
  );

  touchConversation(conversationId);
}

export function deleteMessages(conversationId: string): void {
  if (!db) return;
  db.run('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
  flush();
}

/**
 * Get message count for a conversation (useful for compression decisions).
 */
export function getMessageCount(conversationId: string): number {
  if (!db) return 0;
  const stmt = db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?');
  stmt.bind([conversationId]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as { count: number };
    stmt.free();
    return row.count;
  }
  stmt.free();
  return 0;
}
