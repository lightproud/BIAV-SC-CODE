'use client'

import { useState, useEffect, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import ChatMessage from '@/components/ChatMessage'
import ChatInput from '@/components/ChatInput'
import ModelSelector from '@/components/ModelSelector'
import { useChat } from '@/hooks/useChat'
import type { Conversation, LLMProvider } from '@/lib/types'

export default function Home() {
  const [provider, setProvider] = useState<LLMProvider>('claude')
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const {
    messages,
    isStreaming,
    conversationId,
    sendMessage,
    stopStreaming,
    loadConversation,
    resetChat,
  } = useChat()

  // Load conversations
  const refreshConversations = async () => {
    try {
      const res = await fetch('/api/conversations')
      setConversations(await res.json())
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshConversations()
  }, [])

  // Refresh list when conversation changes
  useEffect(() => {
    if (conversationId) refreshConversations()
  }, [conversationId])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = (text: string) => {
    sendMessage(text, provider, model)
  }

  const handleNewChat = () => {
    resetChat()
  }

  const handleSelectConversation = (id: string) => {
    loadConversation(id)
  }

  const handleDeleteConversation = async (id: string) => {
    await fetch('/api/conversations', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (conversationId === id) resetChat()
    refreshConversations()
  }

  return (
    <div className="h-screen flex">
      {/* Sidebar */}
      {sidebarOpen && (
        <Sidebar
          conversations={conversations}
          activeId={conversationId}
          onSelect={handleSelectConversation}
          onNew={handleNewChat}
          onDelete={handleDeleteConversation}
        />
      )}

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-biav-border">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-biav-text-dim hover:text-biav-text transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <ModelSelector
            provider={provider}
            model={model}
            onSelect={(p, m) => {
              setProvider(p)
              setModel(m)
            }}
          />

          <div className="flex-1" />

          {isStreaming && (
            <button
              onClick={stopStreaming}
              className="text-xs px-3 py-1 rounded-lg border border-biav-risk text-biav-risk
                         hover:bg-biav-risk hover:text-biav-bg transition-colors"
            >
              Stop
            </button>
          )}
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <h2 className="font-serif text-2xl text-biav-gold-bright font-bold mb-2">
                Brain in a Vat
              </h2>
              <p className="text-biav-text-dim text-sm max-w-md">
                B.I.A.V. Studio AI Assistant
              </p>
              <div className="mt-8 w-16 h-px bg-biav-gold opacity-40" />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  isStreaming={isStreaming && i === messages.length - 1 && msg.role === 'assistant'}
                />
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </main>
    </div>
  )
}
