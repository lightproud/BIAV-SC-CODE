/**
 * store.ts — SQLite conversation persistence.
 *
 * Why SQLite instead of electron-store: Conversations contain large message
 * arrays with tool results. electron-store (JSON file) degrades with large
 * data and lacks query capability. SQLite gives us:
 * - Efficient storage for thousands of messages
 * - Query by conversation ID without loading everything
 * - ACID transactions for safe writes
 * - Foundation for future search/analytics
 *
 * Schema:
 *   conversations(id, title, gear, created_at, updated_at)
 *   messages(id, conversation_id, role, content_json, timestamp)
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import { logger } from '../core/logger';

let db: Database.Database | null = null;

/**
 * Initialize the conversation database.
 * Creates tables if they don't exist.
 */
export function initConversationDb(): void {
  const dbPath = path.join(app.getPath('userData'), 'conversations.db');
  logger.info('store', 'Opening conversation database', { path: dbPath });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      gear TEXT NOT NULL DEFAULT 'chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, timestamp);
  `);

  logger.info('store', 'Conversation database ready');
}

/**
 * Close the database connection.
 */
export function closeConversationDb(): void {
  db?.close();
  db = null;
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
  return db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as ConvRow[];
}

export function createConversation(id: string, title: string, gear: string): ConvRow {
  if (!db) throw new Error('Database not initialized');
  const now = Date.now();
  db.prepare(
    'INSERT INTO conversations (id, title, gear, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, title, gear, now, now);
  return { id, title, gear, created_at: now, updated_at: now };
}

export function deleteConversation(id: string): void {
  if (!db) return;
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

export function updateConversationTitle(id: string, title: string): void {
  if (!db) return;
  db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id);
}

export function touchConversation(id: string): void {
  if (!db) return;
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id);
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
  return db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC',
  ).all(conversationId) as MessageRow[];
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
  const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId);
  if (!conv) {
    createConversation(conversationId, 'Untitled', 'chat');
  }

  db.prepare(
    'INSERT OR REPLACE INTO messages (id, conversation_id, role, content_json, timestamp) VALUES (?, ?, ?, ?, ?)',
  ).run(id, conversationId, role, contentJson, timestamp);

  touchConversation(conversationId);
}

export function deleteMessages(conversationId: string): void {
  if (!db) return;
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
}

/**
 * Get message count for a conversation (useful for compression decisions).
 */
export function getMessageCount(conversationId: string): number {
  if (!db) return 0;
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
  ).get(conversationId) as { count: number };
  return row.count;
}
