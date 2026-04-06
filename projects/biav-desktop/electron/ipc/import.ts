import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'

function parseMarkdown(content: string): { title: string; messages: { role: string; content: string }[] } {
  const lines = content.split('\n')
  let title = 'Imported Conversation'
  const messages: { role: string; content: string }[] = []

  let currentRole: string | null = null
  let currentLines: string[] = []

  for (const line of lines) {
    // Extract title from # heading
    const titleMatch = line.match(/^#\s+(.+)$/)
    if (titleMatch && messages.length === 0 && currentRole === null) {
      title = titleMatch[1].trim()
      continue
    }

    // Detect role headings: ## User / ## Assistant / ## System
    const roleMatch = line.match(/^##\s+(User|Assistant|System)\s*$/i)
    if (roleMatch) {
      // Flush previous message
      if (currentRole) {
        const text = currentLines.join('\n').trim()
        if (text) {
          messages.push({ role: currentRole, content: text })
        }
      }
      currentRole = roleMatch[1].toLowerCase()
      currentLines = []
      continue
    }

    if (currentRole) {
      currentLines.push(line)
    }
  }

  // Flush last message
  if (currentRole) {
    const text = currentLines.join('\n').trim()
    if (text) {
      messages.push({ role: currentRole, content: text })
    }
  }

  return { title, messages }
}

export function registerImportHandlers() {
  ipcMain.handle('conversations:import', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win!, {
        title: '导入对话',
        filters: [
          { name: 'Supported Files', extensions: ['json', 'md'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, error: 'Cancelled' }
      }

      const filePath = result.filePaths[0]
      const raw = fs.readFileSync(filePath, 'utf-8')
      const ext = filePath.toLowerCase().endsWith('.json') ? 'json' : 'md'

      const db = getDb()
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
      const conversationId = uuidv4()

      if (ext === 'json') {
        const data = JSON.parse(raw)
        const conv = data.conversation
        const msgs = data.messages as any[]

        if (!conv || !Array.isArray(msgs)) {
          return { ok: false, error: 'Invalid JSON format: expected { conversation, messages }' }
        }

        db.prepare(
          `INSERT INTO conversations (id, title, provider, model, system_prompt, project_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          conversationId,
          conv.title || 'Imported Conversation',
          conv.provider || 'claude',
          conv.model || 'unknown',
          conv.system_prompt ?? null,
          null,
          now,
          now,
        )

        const insertMsg = db.prepare(
          `INSERT INTO messages (id, conversation_id, role, content, model, provider, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )

        for (const msg of msgs) {
          insertMsg.run(
            uuidv4(),
            conversationId,
            msg.role,
            msg.content,
            msg.model ?? null,
            msg.provider ?? null,
            msg.created_at ?? now,
          )
        }
      } else {
        // Markdown
        const { title, messages } = parseMarkdown(raw)

        db.prepare(
          `INSERT INTO conversations (id, title, provider, model, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(conversationId, title, 'claude', 'unknown', now, now)

        const insertMsg = db.prepare(
          `INSERT INTO messages (id, conversation_id, role, content, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )

        for (const msg of messages) {
          insertMsg.run(uuidv4(), conversationId, msg.role, msg.content, now)
        }
      }

      return { ok: true, conversationId }
    } catch (err: any) {
      return { ok: false, error: err.message ?? String(err) }
    }
  })
}
