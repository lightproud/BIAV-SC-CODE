/**
 * Database layer — uses sql.js (SQLite compiled to WebAssembly).
 * No native compilation needed — works on any platform and Node version.
 *
 * Provides a compatibility wrapper that mimics better-sqlite3's synchronous API
 * so all other files (chat.ts, conversations.ts, etc.) need zero changes.
 */
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
// @ts-ignore — sql.js ships no type declarations
import initSqlJs from 'sql.js'
type SqlJsDatabase = any

// ---------------------------------------------------------------------------
// Compatibility wrapper: mimics better-sqlite3 API on top of sql.js
// ---------------------------------------------------------------------------

interface StatementLike {
  run(...params: any[]): { changes: number; lastInsertRowid: number }
  all(...params: any[]): any[]
  get(...params: any[]): any | undefined
}

export interface CompatDatabase {
  prepare(sql: string): StatementLike
  exec(sql: string): void
  pragma(pragmaStr: string): any
  close(): void
}

function createCompatDb(raw: SqlJsDatabase, dbPath: string): CompatDatabase {
  // Auto-save: write db to disk after mutations
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleSave() {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      try {
        const data = raw.export()
        const buffer = Buffer.from(data)
        fs.writeFileSync(dbPath, buffer)
      } catch { /* best effort */ }
    }, 500)
  }

  // Flush any pending save immediately (for close / exit)
  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    try {
      const data = raw.export()
      const buffer = Buffer.from(data)
      fs.writeFileSync(dbPath, buffer)
    } catch { /* best effort */ }
  }

  const compat: CompatDatabase = {
    prepare(sql: string): StatementLike {
      return {
        run(...params: any[]) {
          raw.run(sql, params)
          scheduleSave()
          // sql.js doesn't expose changes/lastInsertRowid easily in .run()
          // but callers in this codebase don't use the return value
          return { changes: 0, lastInsertRowid: 0 }
        },
        all(...params: any[]): any[] {
          const stmt = raw.prepare(sql)
          if (params.length > 0) stmt.bind(params)
          const results: any[] = []
          while (stmt.step()) {
            results.push(stmt.getAsObject())
          }
          stmt.free()
          return results
        },
        get(...params: any[]): any | undefined {
          const stmt = raw.prepare(sql)
          if (params.length > 0) stmt.bind(params)
          let result: any = undefined
          if (stmt.step()) {
            result = stmt.getAsObject()
          }
          stmt.free()
          return result
        },
      }
    },

    exec(sql: string) {
      raw.exec(sql)
      scheduleSave()
    },

    pragma(pragmaStr: string): any {
      // sql.js supports PRAGMA via exec/run
      try {
        const stmt = raw.prepare(`PRAGMA ${pragmaStr}`)
        let result: any = undefined
        if (stmt.step()) {
          result = stmt.getAsObject()
        }
        stmt.free()
        return result
      } catch {
        // Some PRAGMAs (like journal_mode = WAL) are not supported in sql.js
        // (WebAssembly SQLite runs in-memory, WAL is for file-based only)
        return undefined
      }
    },

    close() {
      flushSave()
      raw.close()
    },
  }

  // Save on process exit
  process.on('exit', flushSave)
  process.on('SIGINT', flushSave)

  return compat
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let db: CompatDatabase

export function getDb(): CompatDatabase {
  return db
}

export async function initDatabase() {
  const userDataPath = app.getPath('userData')
  const dbDir = path.join(userDataPath, 'data')
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

  const dbPath = path.join(dbDir, 'biav.db')

  // Initialize sql.js
  const SQL = await initSqlJs()

  // Load existing database or create new one
  let rawDb: SqlJsDatabase
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    rawDb = new SQL.Database(buffer)
  } else {
    rawDb = new SQL.Database()
  }

  db = createCompatDb(rawDb, dbPath)

  // PRAGMAs — WAL not supported in sql.js, but foreign_keys works
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

  // Migrate: add columns if missing
  const cols = db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[]
  if (!cols.some((c) => c.name === 'system_prompt')) {
    db.exec("ALTER TABLE conversations ADD COLUMN system_prompt TEXT DEFAULT NULL")
  }
  if (!cols.some((c) => c.name === 'project_id')) {
    db.exec("ALTER TABLE conversations ADD COLUMN project_id TEXT DEFAULT NULL REFERENCES projects(id) ON DELETE SET NULL")
  }
  if (!cols.some((c) => c.name === 'is_pinned')) {
    db.exec("ALTER TABLE conversations ADD COLUMN is_pinned INTEGER DEFAULT 0")
  }

  // Tool calls table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT,
      tool_name TEXT NOT NULL,
      server_name TEXT NOT NULL DEFAULT 'built-in',
      input_json TEXT NOT NULL DEFAULT '{}',
      result_text TEXT,
      is_error INTEGER NOT NULL DEFAULT 0,
      approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tool_calls_conv
      ON tool_calls(conversation_id, created_at);
  `)

  // FTS5 virtual table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      conversation_id UNINDEXED,
      message_id UNINDEXED
    );
  `)

  // Triggers for FTS sync
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

  // Migrate: populate FTS from existing messages
  const ftsCount = (db.prepare('SELECT COUNT(*) as cnt FROM messages_fts').get() as { cnt: number }).cnt
  const msgCount = (db.prepare('SELECT COUNT(*) as cnt FROM messages').get() as { cnt: number }).cnt
  if (ftsCount === 0 && msgCount > 0) {
    db.exec(`
      INSERT INTO messages_fts(content, conversation_id, message_id)
      SELECT content, conversation_id, id FROM messages;
    `)
  }
}
