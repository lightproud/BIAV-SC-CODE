import Database from 'better-sqlite3'
import path from 'path'
import type { Conversation, Message } from './types'

const DB_PATH = path.join(process.cwd(), 'data', 'biav.db')

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) {
    const fs = require('fs')
    const dir = path.dirname(DB_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT,
        provider TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    `)
  }
  return db
}

export function createConversation(conv: Conversation): void {
  const d = getDb()
  d.prepare(
    'INSERT INTO conversations (id, title, provider, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conv.id, conv.title, conv.provider, conv.model, conv.createdAt, conv.updatedAt)
}

export function updateConversationTitle(id: string, title: string): void {
  const d = getDb()
  d.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
    title,
    Date.now(),
    id
  )
}

export function listConversations(): Conversation[] {
  const d = getDb()
  const rows = d.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as any[]
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    provider: r.provider,
    model: r.model,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

export function getConversation(id: string): Conversation | null {
  const d = getDb()
  const r = d.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any
  if (!r) return null
  return {
    id: r.id,
    title: r.title,
    provider: r.provider,
    model: r.model,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function deleteConversation(id: string): void {
  const d = getDb()
  d.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id)
  d.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function addMessage(msg: Message): void {
  const d = getDb()
  d.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, model, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(msg.id, msg.conversationId, msg.role, msg.content, msg.model ?? null, msg.provider ?? null, msg.createdAt)
  d.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(msg.createdAt, msg.conversationId)
}

export function getMessages(conversationId: string): Message[] {
  const d = getDb()
  const rows = d
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId) as any[]
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    model: r.model,
    provider: r.provider,
    createdAt: r.created_at,
  }))
}
