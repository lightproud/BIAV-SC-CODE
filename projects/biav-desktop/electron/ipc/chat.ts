import { ipcMain, BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'
import { streamChat } from '../llm'
import Store from 'electron-store'

const store = new Store()
let abortController: AbortController | null = null

export function registerChatHandlers() {
  ipcMain.handle('chat:send', async (event, req: {
    conversationId: string | null
    message: string
    provider: string
    model: string
  }) => {
    const db = getDb()
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    // Create or reuse conversation
    let conversationId = req.conversationId
    if (!conversationId) {
      conversationId = uuidv4()
      const title = req.message.slice(0, 50) + (req.message.length > 50 ? '…' : '')
      db.prepare(
        'INSERT INTO conversations (id, title, provider, model) VALUES (?, ?, ?, ?)'
      ).run(conversationId, title, req.provider, req.model)
    }

    // Save user message
    const userMsgId = uuidv4()
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, provider, model) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userMsgId, conversationId, 'user', req.message, req.provider, req.model)

    // Send metadata
    win.webContents.send('chat:stream', { type: 'meta', conversationId })

    // Get full history
    const history = db
      .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as { role: string; content: string }[]

    // Resolve API keys
    const apiKey = req.provider === 'claude'
      ? (store.get('anthropic_api_key', '') as string)
      : (store.get('openai_api_key', '') as string)

    const baseUrl = req.provider === 'openai'
      ? (store.get('openai_base_url', '') as string) || undefined
      : undefined

    if (!apiKey) {
      win.webContents.send('chat:stream', {
        type: 'error',
        error: `请先在设置中配置 ${req.provider === 'claude' ? 'Anthropic' : 'OpenAI'} API Key`,
      })
      return
    }

    // Stream response
    abortController = new AbortController()
    let fullContent = ''

    try {
      const stream = streamChat({
        provider: req.provider as 'claude' | 'openai',
        model: req.model,
        messages: history,
        apiKey,
        baseUrl,
        signal: abortController.signal,
      })

      for await (const chunk of stream) {
        fullContent += chunk
        win.webContents.send('chat:stream', { type: 'delta', content: chunk })
      }

      // Save assistant message
      const assistantMsgId = uuidv4()
      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, provider, model) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(assistantMsgId, conversationId, 'assistant', fullContent, req.provider, req.model)

      // Update conversation timestamp
      db.prepare('UPDATE conversations SET updated_at = datetime("now") WHERE id = ?').run(conversationId)

      win.webContents.send('chat:stream', { type: 'done' })
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        win.webContents.send('chat:stream', {
          type: 'error',
          error: err.message || '未知错误',
        })
      }
    } finally {
      abortController = null
    }
  })

  ipcMain.handle('chat:stop', () => {
    abortController?.abort()
    return { ok: true }
  })
}
