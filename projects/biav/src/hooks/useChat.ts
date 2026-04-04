'use client'

import { useState, useCallback, useRef } from 'react'
import type { LLMProvider } from '@/lib/types'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(
    async (content: string, provider: LLMProvider, model: string) => {
      if (isStreaming) return

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setIsStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            messages: [{ role: 'user', content }],
            provider,
            model,
          }),
          signal: controller.signal,
        })

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const reader = res.body?.getReader()
        if (!reader) throw new Error('No reader')

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const dataLine = line.replace(/^data: /, '')
            if (!dataLine) continue

            try {
              const data = JSON.parse(dataLine)
              if (data.type === 'meta' && data.conversationId) {
                setConversationId(data.conversationId)
              } else if (data.type === 'delta') {
                setMessages((prev) => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + data.content,
                    }
                  }
                  return updated
                })
              } else if (data.type === 'error') {
                setMessages((prev) => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      content: `Error: ${data.error}`,
                    }
                  }
                  return updated
                })
              }
            } catch {
              // skip malformed JSON
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last.role === 'assistant') {
              updated[updated.length - 1] = {
                ...last,
                content: `Connection error: ${err.message}`,
              }
            }
            return updated
          })
        }
      } finally {
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [conversationId, isStreaming]
  )

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const loadConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}/messages`)
      const msgs = await res.json()
      setMessages(
        msgs
          .filter((m: any) => m.role !== 'system')
          .map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          }))
      )
      setConversationId(id)
    } catch {
      // ignore
    }
  }, [])

  const resetChat = useCallback(() => {
    setMessages([])
    setConversationId(null)
  }, [])

  return {
    messages,
    isStreaming,
    conversationId,
    sendMessage,
    stopStreaming,
    loadConversation,
    resetChat,
  }
}
