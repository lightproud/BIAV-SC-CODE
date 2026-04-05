import { useState, useEffect, useCallback, useRef } from 'react'
import type { Message } from '../types'

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const cleanup = window.biav.onChatStream((_event, data) => {
      switch (data.type) {
        case 'meta':
          setConversationId(data.conversationId)
          break
        case 'delta':
          setStreamingContent((prev) => prev + data.content)
          break
        case 'error':
          setIsStreaming(false)
          setStreamingContent('')
          setMessages((prev) => [
            ...prev,
            {
              id: 'error-' + Date.now(),
              conversation_id: '',
              role: 'assistant',
              content: `**错误**: ${data.error}`,
              created_at: new Date().toISOString(),
            },
          ])
          break
        case 'done':
          setIsStreaming(false)
          setStreamingContent((content) => {
            if (content) {
              setMessages((prev) => [
                ...prev,
                {
                  id: 'msg-' + Date.now(),
                  conversation_id: '',
                  role: 'assistant',
                  content,
                  created_at: new Date().toISOString(),
                },
              ])
            }
            return ''
          })
          break
      }
    })
    cleanupRef.current = cleanup
    return cleanup
  }, [])

  const sendMessage = useCallback(
    async (content: string, provider: string, model: string) => {
      const userMsg: Message = {
        id: 'user-' + Date.now(),
        conversation_id: conversationId || '',
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMsg])
      setIsStreaming(true)
      setStreamingContent('')

      await window.biav.sendMessage({
        conversationId,
        message: content,
        provider,
        model,
      })
    },
    [conversationId]
  )

  const stopStreaming = useCallback(async () => {
    await window.biav.stopStreaming()
    setIsStreaming(false)
  }, [])

  const loadConversation = useCallback(async (id: string) => {
    const msgs = await window.biav.getMessages(id)
    setMessages(msgs)
    setConversationId(id)
    setStreamingContent('')
    setIsStreaming(false)
  }, [])

  const resetChat = useCallback(() => {
    setMessages([])
    setConversationId(null)
    setStreamingContent('')
    setIsStreaming(false)
  }, [])

  return {
    messages,
    conversationId,
    isStreaming,
    streamingContent,
    sendMessage,
    stopStreaming,
    loadConversation,
    resetChat,
  }
}
