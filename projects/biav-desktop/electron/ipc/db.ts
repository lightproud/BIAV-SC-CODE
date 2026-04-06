import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

let db: Database.Database

export function getDb(): Database.Database {
  return db
}

export function initDatabase() {
  const userDataPath = app.getPath('userData')
  const dbDir = path.join(userDataPath, 'data')
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

  const dbPath = path.join(dbDir, 'biav.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      system_prompt TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      system_prompt TEXT DEFAULT NULL,
      project_id TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS usage (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_usage_conv
      ON usage(conversation_id, created_at);
  `)

  // Migrate: add system_prompt column if missing
  const cols = db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[]
  if (!cols.some((c) => c.name === 'system_prompt')) {
    db.exec("ALTER TABLE conversations ADD COLUMN system_prompt TEXT DEFAULT NULL")
  }

  // Migrate: add project_id column if missing
  if (!cols.some((c) => c.name === 'project_id')) {
    db.exec("ALTER TABLE conversations ADD COLUMN project_id TEXT DEFAULT NULL REFERENCES projects(id) ON DELETE SET NULL")
  }

  // Migrate: add is_pinned column if missing
  if (!cols.some((c) => c.name === 'is_pinned')) {
    db.exec("ALTER TABLE conversations ADD COLUMN is_pinned INTEGER DEFAULT 0")
  }

  // FTS5 virtual table for full-text search on message content
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      conversation_id UNINDEXED,
      message_id UNINDEXED
    );
  `)

  // Triggers to keep FTS in sync with messages table
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_fts_insert
    AFTER INSERT ON messages
    BEGIN
      INSERT INTO messages_fts(content, conversation_id, message_id)
      VALUES (NEW.content, NEW.conversation_id, NEW.id);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_delete
    AFTER DELETE ON messages
    BEGIN
      DELETE FROM messages_fts WHERE message_id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_update
    AFTER UPDATE OF content ON messages
    BEGIN
      DELETE FROM messages_fts WHERE message_id = OLD.id;
      INSERT INTO messages_fts(content, conversation_id, message_id)
      VALUES (NEW.content, NEW.conversation_id, NEW.id);
    END;
  `)

  // Migrate: populate FTS from existing messages not yet indexed
  const ftsCount = (db.prepare('SELECT COUNT(*) as cnt FROM messages_fts').get() as { cnt: number }).cnt
  const msgCount = (db.prepare('SELECT COUNT(*) as cnt FROM messages').get() as { cnt: number }).cnt
  if (ftsCount === 0 && msgCount > 0) {
    db.exec(`
      INSERT INTO messages_fts(content, conversation_id, message_id)
      SELECT content, conversation_id, id FROM messages;
    `)
  }
}
