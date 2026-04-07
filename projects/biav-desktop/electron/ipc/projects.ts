import { ipcMain } from 'electron'
import { getDb } from './db'
import { randomUUID } from 'crypto'

export function registerProjectHandlers() {
  ipcMain.handle('projects:list', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all()
  })

  ipcMain.handle('projects:create', (_e, data: { name: string; description?: string; system_prompt?: string }) => {
    const db = getDb()
    const id = randomUUID()
    db.prepare(
      'INSERT INTO projects (id, name, description, system_prompt) VALUES (?, ?, ?, ?)'
    ).run(id, data.name, data.description ?? '', data.system_prompt ?? '')
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  })

  ipcMain.handle('projects:update', (_e, id: string, data: { name?: string; description?: string; system_prompt?: string }) => {
    const db = getDb()
    const fields: string[] = []
    const values: any[] = []
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.system_prompt !== undefined) { fields.push('system_prompt = ?'); values.push(data.system_prompt) }
    if (fields.length === 0) return { ok: true }
    fields.push("updated_at = datetime('now')")
    values.push(id)
    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  })

  ipcMain.handle('projects:delete', (_e, id: string) => {
    const db = getDb()
    // Conversations in this project get project_id set to NULL via ON DELETE SET NULL
    db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    return { ok: true }
  })

  ipcMain.handle('projects:conversations', (_e, projectId: string) => {
    const db = getDb()
    return db.prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
  })

  ipcMain.handle('projects:move', (_e, conversationId: string, projectId: string | null) => {
    const db = getDb()
    db.prepare('UPDATE conversations SET project_id = ? WHERE id = ?').run(projectId, conversationId)
    return { ok: true }
  })
}
