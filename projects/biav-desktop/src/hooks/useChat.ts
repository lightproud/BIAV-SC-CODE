import { useState, useEffect, useCallback, useRef } from 'react'
import type { Message, Attachment, UsageData, SessionUsage } from '../types'

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingTokens, setStreamingTokens] = useState(0)
  const [streamingDuration, setStreamingDuration] = useState(0)
  const streamingStartRef = useRef<number | null>(null)
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [lastUsage, setLastUsage] = useState<UsageData | null>(null)
  const [sessionUsage, setSessionUsage] = useState<SessionUsage>({ totalInput: 0, totalOutput: 0, totalCost: 0 })
  const [titleUpdateCounter, setTitleUpdateCounter] = useState(0)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const cleanup = window.biav.onChatStream((_event, data) => {
      switch (data.type) {
        case 'meta':
          setConversationId(data.conversationId)
          break
        case 'delta':
          if (!streamingStartRef.current) {
            streamingStartRef.current = Date.now()
            setStreamingDuration(0)
            durationTimerRef.current = setInterval(() => {
              if (streamingStartRef.current) {
                setStreamingDuration(Math.round((Date.now() - streamingStartRef.current) / 1000))
              }
            }, 200)
          }
          setStreamingContent((prev) => {
            const updated = prev + data.content
            setStreamingTokens(Math.round(updated.length / 4))
            return updated
          })
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
        case 'usage':
          setLastUsage(data.usage)
          setSessionUsage((prev) => ({
            totalInput: prev.totalInput + data.usage.inputTokens,
            totalOutput: prev.totalOutput + data.usage.outputTokens,
            totalCost: prev.totalCost + data.usage.estimatedCost,
          }))
          break
        case 'titleUpdate':
          setTitleUpdateCounter((c) => c + 1)
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
    async (content: string, provider: string, model: string, attachments?: Attachment[], systemPrompt?: string) => {
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
        systemPrompt,
        attachments,
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
    setLastUsage(null)
    // Load session usage totals from DB
    try {
      const usage = await window.biav.getSessionUsage(id)
      setSessionUsage(usage)
    } catch {
      setSessionUsage({ totalInput: 0, totalOutput: 0, totalCost: 0 })
    }
  }, [])

  const resetChat = useCallback(() => {
    setMessages([])
    setConversationId(null)
    setStreamingContent('')
    setIsStreaming(false)
    setLastUsage(null)
    setSessionUsage({ totalInput: 0, totalOutput: 0, totalCost: 0 })
  }, [])

  const editAndResend = useCallback(
    async (messageId: string, newContent: string, provider: string, model: string) => {
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return

      // Truncate messages after the edited one and update content
      const truncated = messages.slice(0, idx)
      setMessages(truncated)

      // Persist the edit in the database
      if (conversationId) {
        await window.biav.editMessage({ conversationId, messageId, content: newContent })
      }

      // Re-send with updated content
      const userMsg: Message = {
        id: 'user-' + Date.now(),
        conversation_id: conversationId || '',
        role: 'user',
        content: newContent,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMsg])
      setIsStreaming(true)
      setStreamingContent('')

      await window.biav.sendMessage({
        conversationId,
        message: newContent,
        provider,
        model,
      })
    },
    [conversationId, messages]
  )

  const regenerate = useCallback(
    async (provider: string, model: string) => {
      // Find last user message
      const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user')
      if (lastUserIdx === -1) return

      const lastUserMsg = messages[lastUserIdx]

      // Remove everything after the last user message (the assistant response)
      setMessages(messages.slice(0, lastUserIdx + 1))

      // Delete the assistant message from DB
      if (conversationId) {
        await window.biav.regenerateMessage({ conversationId, afterMessageId: lastUserMsg.id })
      }

      // Re-send the last user message
      setIsStreaming(true)
      setStreamingContent('')

      await window.biav.sendMessage({
        conversationId,
        message: lastUserMsg.content,
        provider,
        model,
      })
    },
    [conversationId, messages]
  )

  return {
    messages,
    conversationId,
    isStreaming,
    streamingContent,
    lastUsage,
    sessionUsage,
    titleUpdateCounter,
    sendMessage,
    stopStreaming,
    loadConversation,
    resetChat,
    editAndResend,
    regenerate,
  }
}
