import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import { getDb } from './db'

export function registerExportHandlers() {
  ipcMain.handle(
    'conversations:export',
    async (_e, id: string, format: 'md' | 'json') => {
      try {
        const db = getDb()
        const conversation = db
          .prepare('SELECT * FROM conversations WHERE id = ?')
          .get(id) as any
        if (!conversation) {
          return { ok: false, error: 'Conversation not found' }
        }

        const messages = db
          .prepare(
            'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
          )
          .all(id) as any[]

        let content: string
        let defaultFileName: string
        const safeTitle = conversation.title.replace(/[/\\?%*:|"<>]/g, '_')

        if (format === 'md') {
          const lines: string[] = [`# ${conversation.title}`, '']
          for (const msg of messages) {
            const label =
              msg.role === 'user'
                ? 'User'
                : msg.role === 'assistant'
                  ? 'Assistant'
                  : 'System'
            lines.push(`## ${label}`, '', msg.content, '')
          }
          content = lines.join('\n')
          defaultFileName = `${safeTitle}.md`
        } else {
          content = JSON.stringify({ conversation, messages }, null, 2)
          defaultFileName = `${safeTitle}.json`
        }

        const win = BrowserWindow.getFocusedWindow()
        const result = await dialog.showSaveDialog(win!, {
          title: '导出对话',
          defaultPath: defaultFileName,
          filters:
            format === 'md'
              ? [{ name: 'Markdown', extensions: ['md'] }]
              : [{ name: 'JSON', extensions: ['json'] }],
        })

        if (result.canceled || !result.filePath) {
          return { ok: false, error: 'Cancelled' }
        }

        fs.writeFileSync(result.filePath, content, 'utf-8')
        return { ok: true, path: result.filePath }
      } catch (err: any) {
        return { ok: false, error: err.message ?? String(err) }
      }
    },
  )
}
