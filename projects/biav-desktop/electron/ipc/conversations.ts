import { ipcMain } from 'electron'
import { getDb } from './db'

export function registerConversationHandlers() {
  ipcMain.handle('conversations:list', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all()
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
}
