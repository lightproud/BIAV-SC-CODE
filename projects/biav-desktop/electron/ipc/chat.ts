import { ipcMain, BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'
import { streamChat, type LLMUsage } from '../llm'
import Store from 'electron-store'

// Per-million-token pricing: [input, output]
const MODEL_PRICING: Record<string, [number, number]> = {
  'claude-sonnet-4-20250514': [3, 15],
  'claude-3-5-sonnet-20241022': [3, 15],
  'claude-3-5-haiku-20241022': [1, 5],
  'claude-3-opus-20240229': [15, 75],
  'claude-3-haiku-20240307': [0.25, 1.25],
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4-turbo': [10, 30],
  'gpt-4': [30, 60],
  'gpt-3.5-turbo': [0.5, 1.5],
  'o1': [15, 60],
  'o1-mini': [3, 12],
  'o3-mini': [1.1, 4.4],
}

function estimateCost(usage: LLMUsage): number {
  const pricing = MODEL_PRICING[usage.model]
  if (!pricing) return 0
  const [inputRate, outputRate] = pricing
  return (usage.inputTokens * inputRate + usage.outputTokens * outputRate) / 1_000_000
}

const store = new Store()
let abortController: AbortController | null = null

export function registerChatHandlers() {
  ipcMain.handle('chat:send', async (event, req: {
    conversationId: string | null
    message: string
    provider: string
    model: string
    systemPrompt?: string
    attachments?: { name: string; path: string; type: string; content: string }[]
  }) => {
    const db = getDb()
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    // Create or reuse conversation
    let conversationId = req.conversationId
    let isNewConversation = false
    if (!conversationId) {
      conversationId = uuidv4()
      isNewConversation = true
      const title = req.message.slice(0, 50) + (req.message.length > 50 ? '…' : '')
      db.prepare(
        'INSERT INTO conversations (id, title, provider, model, system_prompt) VALUES (?, ?, ?, ?, ?)'
      ).run(conversationId, title, req.provider, req.model, req.systemPrompt || null)
    } else if (req.systemPrompt !== undefined) {
      // Update system_prompt if provided on an existing conversation
      db.prepare('UPDATE conversations SET system_prompt = ? WHERE id = ?').run(req.systemPrompt || null, conversationId)
    }

    // Build message content with attachments
    const attachments = req.attachments || []
    let messageForDb = req.message
    let messageForLLM = req.message

    // Separate image attachments from text attachments
    const imageAttachments = attachments.filter((a) => a.type.startsWith('image/'))
    const textAttachments = attachments.filter((a) => !a.type.startsWith('image/'))

    if (textAttachments.length > 0) {
      const attachmentText = textAttachments
        .map((a) => '```' + a.name + '\n' + a.content + '\n```')
        .join('\n\n')
      messageForDb = attachmentText + '\n\n' + req.message
      messageForLLM = messageForDb
    }

    // Save user message
    const userMsgId = uuidv4()
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, provider, model) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userMsgId, conversationId, 'user', messageForDb, req.provider, req.model)

    // Send metadata
    win.webContents.send('chat:stream', { type: 'meta', conversationId })

    // Get full history
    const history = db
      .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as { role: string; content: string }[]

    // Prepend system prompt if set
    const conv = db.prepare('SELECT system_prompt FROM conversations WHERE id = ?').get(conversationId) as { system_prompt: string | null } | undefined
    if (conv?.system_prompt) {
      history.unshift({ role: 'system', content: conv.system_prompt })
    }

    // For Claude with image attachments, modify the last user message to use content blocks
    if (req.provider === 'claude' && imageAttachments.length > 0) {
      const lastMsg = history[history.length - 1]
      if (lastMsg && lastMsg.role === 'user') {
        const contentBlocks: any[] = imageAttachments.map((img) => {
          // content is a data URL like "data:image/png;base64,..."
          const base64Data = img.content.replace(/^data:[^;]+;base64,/, '')
          const mediaType = img.type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
          return {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          }
        })
        contentBlocks.push({ type: 'text', text: lastMsg.content })
        ;(lastMsg as any).content = contentBlocks
      }
    }

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

      let usageData: LLMUsage | null = null

      for await (const chunk of stream) {
        if (chunk.type === 'text' && chunk.text) {
          fullContent += chunk.text
          win.webContents.send('chat:stream', { type: 'delta', content: chunk.text })
        } else if (chunk.type === 'usage' && chunk.usage) {
          usageData = chunk.usage
        }
      }

      // Save assistant message
      const assistantMsgId = uuidv4()
      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, provider, model) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(assistantMsgId, conversationId, 'assistant', fullContent, req.provider, req.model)

      // Save usage data
      if (usageData && conversationId) {
        const cost = estimateCost(usageData)
        const usageId = uuidv4()
        db.prepare(
          'INSERT INTO usage (id, conversation_id, model, input_tokens, output_tokens, estimated_cost) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(usageId, conversationId, usageData.model, usageData.inputTokens, usageData.outputTokens, cost)

        win.webContents.send('chat:stream', {
          type: 'usage',
          usage: {
            inputTokens: usageData.inputTokens,
            outputTokens: usageData.outputTokens,
            model: usageData.model,
            estimatedCost: cost,
          },
        })
      }

      // Generate smart title for new conversations based on user's first message
      if (isNewConversation && conversationId) {
        const firstSentence = req.message.replace(/\n/g, ' ').replace(/[.!?。！？].*$/, '').trim()
        const smartTitle = firstSentence.length > 40
          ? firstSentence.slice(0, 39) + '…'
          : firstSentence || req.message.slice(0, 40)
        db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(smartTitle, conversationId)
        win.webContents.send('chat:stream', { type: 'titleUpdate', title: smartTitle })
      }

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

  ipcMain.handle('chat:edit', async (_event, req: {
    conversationId: string
    messageId: string
    content: string
  }) => {
    const db = getDb()
    // Delete all messages after the given message
    const msg = db.prepare('SELECT created_at FROM messages WHERE id = ?').get(req.messageId) as { created_at: string } | undefined
    if (msg) {
      db.prepare(
        'DELETE FROM messages WHERE conversation_id = ? AND created_at > ?'
      ).run(req.conversationId, msg.created_at)
      // Update the message content
      db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(req.content, req.messageId)
    }
  })

  ipcMain.handle('chat:regenerate', async (_event, req: {
    conversationId: string
    afterMessageId: string
  }) => {
    const db = getDb()
    // Delete all messages after the given message ID
    const msg = db.prepare('SELECT created_at FROM messages WHERE id = ?').get(req.afterMessageId) as { created_at: string } | undefined
    if (msg) {
      db.prepare(
        'DELETE FROM messages WHERE conversation_id = ? AND created_at > ?'
      ).run(req.conversationId, msg.created_at)
    }
  })

  ipcMain.handle('usage:session', async (_event, conversationId: string) => {
    const db = getDb()
    const row = db.prepare(
      'SELECT COALESCE(SUM(input_tokens), 0) as totalInput, COALESCE(SUM(output_tokens), 0) as totalOutput, COALESCE(SUM(estimated_cost), 0) as totalCost FROM usage WHERE conversation_id = ?'
    ).get(conversationId) as { totalInput: number; totalOutput: number; totalCost: number }
    return row
  })
}
