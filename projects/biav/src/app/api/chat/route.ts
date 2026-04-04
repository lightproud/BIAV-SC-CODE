import { NextRequest } from 'next/server'
import { streamChat } from '@/lib/llm'
import { addMessage, createConversation, getConversation, getMessages } from '@/lib/db'
import { v4 as uuid } from 'uuid'
import type { ChatRequest } from '@/lib/types'

export async function POST(req: NextRequest) {
  const body: ChatRequest = await req.json()
  const { provider, model } = body
  let { conversationId } = body

  // Create conversation if new
  if (!conversationId) {
    conversationId = uuid()
    const firstMsg = body.messages[body.messages.length - 1]?.content || ''
    createConversation({
      id: conversationId,
      title: firstMsg.slice(0, 50) || 'New conversation',
      provider,
      model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }

  // Save user message
  const userMsg = body.messages[body.messages.length - 1]
  if (userMsg && userMsg.role === 'user') {
    addMessage({
      id: uuid(),
      conversationId,
      role: 'user',
      content: userMsg.content,
      createdAt: Date.now(),
    })
  }

  // Build full message history from DB
  const history = getMessages(conversationId)
  const llmMessages = history.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }))

  // SSE stream
  const encoder = new TextEncoder()
  const assistantId = uuid()
  let fullContent = ''

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send conversation ID first
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'meta', conversationId })}\n\n`)
        )

        const gen = streamChat(llmMessages, provider, model)
        for await (const chunk of gen) {
          fullContent += chunk
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'delta', content: chunk })}\n\n`)
          )
        }

        // Save assistant message
        addMessage({
          id: assistantId,
          conversationId: conversationId!,
          role: 'assistant',
          content: fullContent,
          model,
          provider,
          createdAt: Date.now(),
        })

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
        controller.close()
      } catch (err: any) {
        const errorMsg = err.message || 'Unknown error'
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`)
        )
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
