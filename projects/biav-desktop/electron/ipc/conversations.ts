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
}
