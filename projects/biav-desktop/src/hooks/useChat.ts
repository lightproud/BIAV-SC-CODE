import { useState, useEffect, useCallback, useRef } from 'react'
import type { Message, Attachment, UsageData, SessionUsage, ModelParams, PendingToolUse } from '../types'

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingThinking, setStreamingThinking] = useState('')
  const [streamingTokens, setStreamingTokens] = useState(0)
  const [streamingDuration, setStreamingDuration] = useState(0)
  const streamingStartRef = useRef<number | null>(null)
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [lastUsage, setLastUsage] = useState<UsageData | null>(null)
  const [sessionUsage, setSessionUsage] = useState<SessionUsage>({ totalInput: 0, totalOutput: 0, totalCost: 0 })
  const [titleUpdateCounter, setTitleUpdateCounter] = useState(0)
  const [pendingTools, setPendingTools] = useState<PendingToolUse[]>([])
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const cleanup = window.biav.onChatStream((_event, data) => {
      switch (data.type) {
        case 'meta':
          setConversationId(data.conversationId)
          break
        case 'thinking':
          if (!streamingStartRef.current) {
            streamingStartRef.current = Date.now()
            setStreamingDuration(0)
            durationTimerRef.current = setInterval(() => {
              if (streamingStartRef.current) {
                setStreamingDuration(Math.round((Date.now() - streamingStartRef.current) / 1000))
              }
            }, 200)
          }
          setStreamingThinking((prev) => prev + data.text)
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
        case 'tool_use':
          setPendingTools((prev) => [
            ...prev,
            {
              toolUseId: data.toolUseId,
              toolName: data.toolName,
              serverName: data.serverName,
              toolArgs: data.toolArgs,
              status: 'pending',
            },
          ])
          break
        case 'tool_executing':
          setPendingTools((prev) =>
            prev.map((t) =>
              t.toolUseId === data.toolUseId ? { ...t, status: 'executing' } : t
            )
          )
          break
        case 'tool_result':
          setPendingTools((prev) =>
            prev.map((t) =>
              t.toolUseId === data.toolUseId
                ? {
                    ...t,
                    status: 'done',
                    result: data.result,
                    error: data.error,
                  }
                : t
            )
          )
          break
        case 'error':
          setIsStreaming(false)
          setStreamingContent('')
          setStreamingThinking('')
          setStreamingTokens(0)
          setStreamingDuration(0)
          streamingStartRef.current = null
          if (durationTimerRef.current) { clearInterval(durationTimerRef.current); durationTimerRef.current = null }
          setPendingTools([])
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
          streamingStartRef.current = null
          if (durationTimerRef.current) { clearInterval(durationTimerRef.current); durationTimerRef.current = null }
          setStreamingThinking((thinking) => {
            setStreamingContent((content) => {
              if (content) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: 'msg-' + Date.now(),
                    conversation_id: '',
                    role: 'assistant',
                    content,
                    thinking: thinking || undefined,
                    created_at: new Date().toISOString(),
                  },
                ])
              }
              return ''
            })
            return ''
          })
          setPendingTools([])
          break
      }
    })
    cleanupRef.current = cleanup
    return cleanup
  }, [])

  const approveToolUse = useCallback(async (toolUseId: string, approved: boolean, alwaysAllow?: boolean) => {
    setPendingTools((prev) =>
      prev.map((t) =>
        t.toolUseId === toolUseId
          ? { ...t, status: approved ? 'approved' : 'denied' }
          : t
      )
    )
    await window.biav.approveToolUse(toolUseId, approved, alwaysAllow)
  }, [])

  const sendMessage = useCallback(
    async (content: string, provider: string, model: string, attachments?: Attachment[], systemPrompt?: string, modelParams?: ModelParams, enableThinking?: boolean) => {
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
      setStreamingThinking('')
      setStreamingTokens(0)
      setStreamingDuration(0)
      setPendingTools([])
      streamingStartRef.current = null

      await window.biav.sendMessage({
        conversationId,
        message: content,
        provider,
        model,
        systemPrompt,
        attachments,
        temperature: modelParams?.temperature,
        maxTokens: modelParams?.maxTokens,
        enableThinking,
      })
    },
    [conversationId]
  )

  const stopStreaming = useCallback(async () => {
    await window.biav.stopStreaming()
    setIsStreaming(false)
    setPendingTools([])
  }, [])

  const loadConversation = useCallback(async (id: string) => {
    const msgs = await window.biav.getMessages(id)
    setMessages(msgs)
    setConversationId(id)
    setStreamingContent('')
    setStreamingThinking('')
    setIsStreaming(false)
    setLastUsage(null)
    setPendingTools([])
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
    setStreamingThinking('')
    setIsStreaming(false)
    setStreamingTokens(0)
    setStreamingDuration(0)
    streamingStartRef.current = null
    if (durationTimerRef.current) { clearInterval(durationTimerRef.current); durationTimerRef.current = null }
    setLastUsage(null)
    setSessionUsage({ totalInput: 0, totalOutput: 0, totalCost: 0 })
    setPendingTools([])
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
      setPendingTools([])

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
      setPendingTools([])

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
    streamingThinking,
    streamingTokens,
    streamingDuration,
    lastUsage,
    sessionUsage,
    titleUpdateCounter,
    pendingTools,
    sendMessage,
    stopStreaming,
    loadConversation,
    resetChat,
    editAndResend,
    regenerate,
    approveToolUse,
  }
}
