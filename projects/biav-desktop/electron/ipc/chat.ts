import { ipcMain, BrowserWindow, Notification } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'
import { streamChat, type LLMUsage, type AnthropicTool, type ToolCall } from '../llm'
import { MCPManager } from '../mcp/manager'
import Store from 'electron-store'
import { isWindowFocused, getMainWindow } from '../window-state'

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

// Pending tool approval system
const pendingApprovals = new Map<string, {
  resolve: (approved: boolean) => void
  alwaysAllow?: boolean
}>()
// Tools that the user has chosen to always allow
const alwaysAllowedTools = new Set<string>()

let mcpManagerRef: MCPManager | null = null

export function registerChatHandlers(mcpManager: MCPManager) {
  mcpManagerRef = mcpManager

  // Tool approval handler
  ipcMain.handle('chat:tool-approve', (_event, toolUseId: string, approved: boolean, alwaysAllow?: boolean) => {
    const pending = pendingApprovals.get(toolUseId)
    if (pending) {
      if (alwaysAllow) {
        pending.alwaysAllow = true
      }
      pending.resolve(approved)
      pendingApprovals.delete(toolUseId)
    }
  })

  ipcMain.handle('chat:send', async (event, req: {
    conversationId: string | null
    message: string
    provider: string
    model: string
    systemPrompt?: string
    attachments?: { name: string; path: string; type: string; content: string }[]
    temperature?: number
    maxTokens?: number
    enableThinking?: boolean
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
      .all(conversationId) as { role: string; content: any }[]

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

    // Gather MCP tools from all running servers
    const mcpTools = mcpManager.getAllTools()
    const anthropicTools: AnthropicTool[] = mcpTools.map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema || { type: 'object', properties: {} },
    }))

    // Build a lookup: toolName -> serverName
    const toolServerMap = new Map<string, string>()
    for (const { serverName, tool } of mcpTools) {
      toolServerMap.set(tool.name, serverName)
    }

    // Stream response with tool use loop
    abortController = new AbortController()
    let fullContent = ''
    let thinkingContent = ''

    // Messages for the ongoing conversation (may include tool results)
    let conversationMessages = [...history]

    try {
      let continueLoop = true
      while (continueLoop) {
        continueLoop = false

        const stream = streamChat({
          provider: req.provider as 'claude' | 'openai',
          model: req.model,
          messages: conversationMessages,
          apiKey,
          baseUrl,
          signal: abortController.signal,
          temperature: req.temperature,
          maxTokens: req.maxTokens,
          enableThinking: req.enableThinking,
          tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        })

        let usageData: LLMUsage | null = null
        const toolCalls: ToolCall[] = []
        let turnContent = ''

        for await (const chunk of stream) {
          if (chunk.type === 'thinking' && chunk.text) {
            thinkingContent += chunk.text
            win.webContents.send('chat:stream', { type: 'thinking', text: chunk.text })
          } else if (chunk.type === 'text' && chunk.text) {
            fullContent += chunk.text
            turnContent += chunk.text
            win.webContents.send('chat:stream', { type: 'delta', content: chunk.text })
          } else if (chunk.type === 'tool_use' && chunk.toolCall) {
            toolCalls.push(chunk.toolCall)
          } else if (chunk.type === 'usage' && chunk.usage) {
            usageData = chunk.usage
          }
        }

        // Save usage data for this turn
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

        // Handle tool calls
        if (toolCalls.length > 0) {
          // Build the assistant message with text + tool_use blocks for Claude format
          const assistantContent: any[] = []
          if (turnContent) {
            assistantContent.push({ type: 'text', text: turnContent })
          }
          for (const tc of toolCalls) {
            assistantContent.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })
          }

          // Add assistant message with tool_use to conversation
          conversationMessages.push({
            role: 'assistant',
            content: req.provider === 'claude' ? assistantContent : turnContent,
          })

          // Process each tool call
          const toolResults: any[] = []
          for (const tc of toolCalls) {
            const serverName = toolServerMap.get(tc.name) || mcpManager.findToolServer(tc.name) || 'unknown'

            // Send tool_use event to renderer
            win.webContents.send('chat:stream', {
              type: 'tool_use',
              toolName: tc.name,
              serverName,
              toolArgs: tc.input,
              toolUseId: tc.id,
            })

            // Check if this tool is always allowed
            let approved = alwaysAllowedTools.has(tc.name)

            if (!approved) {
              // Wait for user approval
              approved = await new Promise<boolean>((resolve) => {
                pendingApprovals.set(tc.id, { resolve })
              })

              // Check if user selected "always allow"
              const pending = pendingApprovals.get(tc.id)
              if (pending?.alwaysAllow) {
                alwaysAllowedTools.add(tc.name)
              }
            }

            if (approved) {
              // Execute the tool
              win.webContents.send('chat:stream', {
                type: 'tool_executing',
                toolUseId: tc.id,
              })

              try {
                const result = await mcpManager.callTool(serverName, tc.name, tc.input)
                win.webContents.send('chat:stream', {
                  type: 'tool_result',
                  toolUseId: tc.id,
                  toolName: tc.name,
                  result,
                  isError: false,
                })
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: tc.id,
                  content: typeof result === 'string' ? result : JSON.stringify(result),
                })
              } catch (err: any) {
                win.webContents.send('chat:stream', {
                  type: 'tool_result',
                  toolUseId: tc.id,
                  toolName: tc.name,
                  error: err.message,
                  isError: true,
                })
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: tc.id,
                  content: `Error: ${err.message}`,
                  is_error: true,
                })
              }
            } else {
              // User denied the tool call
              win.webContents.send('chat:stream', {
                type: 'tool_result',
                toolUseId: tc.id,
                toolName: tc.name,
                error: '用户拒绝了此工具调用',
                isError: true,
              })
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tc.id,
                content: 'The user denied this tool call.',
                is_error: true,
              })
            }
          }

          // Add tool results to conversation and continue the loop
          if (req.provider === 'claude') {
            // Claude expects tool_result messages as a user message
            conversationMessages.push({
              role: 'user',
              content: toolResults,
            })
          } else {
            // OpenAI expects tool results as separate messages
            for (const tr of toolResults) {
              conversationMessages.push({
                role: 'tool',
                content: tr.content,
                // OpenAI needs tool_call_id
                ...(tr.tool_use_id ? { tool_call_id: tr.tool_use_id } : {}),
              } as any)
            }
          }

          // Continue the conversation loop so the LLM can process tool results
          continueLoop = true
        }
      }

      // Save assistant message (full accumulated content)
      const assistantMsgId = uuidv4()
      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, provider, model) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(assistantMsgId, conversationId, 'assistant', fullContent, req.provider, req.model)

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

      // Show native notification if window is not focused
      if (!isWindowFocused() && fullContent.length > 0) {
        const body = fullContent.length > 100 ? fullContent.slice(0, 100) + '…' : fullContent
        const notification = new Notification({
          title: 'Brain in a Vat',
          body,
        })
        notification.on('click', () => {
          const mw = getMainWindow()
          if (mw) {
            mw.show()
            mw.focus()
          }
        })
        notification.show()
      }
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
    // Also reject any pending approvals
    for (const [id, pending] of pendingApprovals) {
      pending.resolve(false)
      pendingApprovals.delete(id)
    }
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
