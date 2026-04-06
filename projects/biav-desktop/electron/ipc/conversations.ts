import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'

export function registerConversationHandlers() {
  ipcMain.handle('conversations:list', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM conversations ORDER BY is_pinned DESC, updated_at DESC').all()
  })

  ipcMain.handle('conversations:pin', (_e, id: string, pinned: boolean) => {
    const db = getDb()
    db.prepare('UPDATE conversations SET is_pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id)
    return { ok: true }
  })

  ipcMain.handle('conversations:messages', (_e, conversationId: string) => {
    const db = getDb()
    return db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId)
  })

  ipcMain.handle('conversations:delete', (_e, id: string) => {
    const db = getDb()
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
    return { ok: true }
  })

  ipcMain.handle('conversations:getSystemPrompt', (_e, conversationId: string) => {
    const db = getDb()
    const row = db.prepare('SELECT system_prompt FROM conversations WHERE id = ?').get(conversationId) as { system_prompt: string | null } | undefined
    return row?.system_prompt || ''
  })

  ipcMain.handle('conversations:setSystemPrompt', (_e, conversationId: string, prompt: string) => {
    const db = getDb()
    db.prepare('UPDATE conversations SET system_prompt = ? WHERE id = ?').run(prompt || null, conversationId)
    return { ok: true }
  })

  ipcMain.handle('conversations:rename', (_e, id: string, title: string) => {
    const db = getDb()
    db.prepare('UPDATE conversations SET title = ?, updated_at = datetime("now") WHERE id = ?').run(title, id)
    return { ok: true }
  })

  ipcMain.handle('conversations:search', (_e, query: string) => {
    const db = getDb()
    if (!query || !query.trim()) return []

    const sanitized = query.trim()
    if (!sanitized) return []

    const likePattern = `%${sanitized}%`
    const results = db
      .prepare(
        `SELECT
          m.conversation_id AS conversationId,
          c.title AS conversationTitle,
          substr(m.content, max(1, instr(lower(m.content), lower(?)) - 40), 120) AS snippet,
          m.role AS messageRole,
          m.created_at AS messageDate
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.content LIKE ?
        ORDER BY m.created_at DESC
        LIMIT 50`
      )
      .all(sanitized, likePattern)

    return results
  })

  ipcMain.handle('conversations:fork', (_e, conversationId: string, messageId: string) => {
    const db = getDb()

    // Get original conversation
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any
    if (!conv) throw new Error('Conversation not found')

    // Get the fork-point message to determine its created_at
    const forkMsg = db.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId) as any
    if (!forkMsg) throw new Error('Message not found')

    // Get all messages up to and including the fork point
    const messages = db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? AND created_at <= ? ORDER BY created_at ASC'
    ).all(conversationId, forkMsg.created_at) as any[]

    // Create new conversation
    const newConvId = uuidv4()
    db.prepare(
      "INSERT INTO conversations (id, title, provider, model, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
    ).run(newConvId, conv.title + ' (分支)', conv.provider, conv.model, conv.project_id)

    // Copy messages
    const insertMsg = db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, model, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    for (const msg of messages) {
      insertMsg.run(uuidv4(), newConvId, msg.role, msg.content, msg.model, msg.provider, msg.created_at)
    }

    return { conversationId: newConvId }
  })
}
