import { useState, useEffect, useRef } from 'react'
import { useChat } from './hooks/useChat'
import Sidebar from './components/Sidebar'
import ChatMessage from './components/ChatMessage'
import ChatInput from './components/ChatInput'
import ModelSelector from './components/ModelSelector'
import SettingsModal from './components/SettingsModal'
import type { Conversation, ProviderStatus } from './types'

export default function App() {
  const {
    messages,
    conversationId,
    isStreaming,
    streamingContent,
    sendMessage,
    stopStreaming,
    loadConversation,
    resetChat,
  } = useChat()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [provider, setProvider] = useState('claude')
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [showSettings, setShowSettings] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Load conversations and models on mount
  useEffect(() => {
    refreshConversations()
    refreshModels()
  }, [])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Refresh conversation list when a new conversation is created
  useEffect(() => {
    if (conversationId) refreshConversations()
  }, [conversationId])

  async function refreshConversations() {
    const list = await window.biav.listConversations()
    setConversations(list)
  }

  async function refreshModels() {
    const list = await window.biav.listModels()
    setProviders(list)
  }

  async function handleDeleteConversation(id: string) {
    await window.biav.deleteConversation(id)
    if (conversationId === id) resetChat()
    refreshConversations()
  }

  function handleSelectModel(p: string, m: string) {
    setProvider(p)
    setModel(m)
  }

  function handleSend(content: string) {
    sendMessage(content, provider, model)
  }

  const isMac = window.biav.platform === 'darwin'

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      {sidebarOpen && (
        <Sidebar
          conversations={conversations}
          activeId={conversationId}
          onSelect={loadConversation}
          onDelete={handleDeleteConversation}
          onNewChat={resetChat}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Titlebar */}
        <div className={`titlebar-drag flex items-center gap-2 border-b border-biav-border px-4 h-12 shrink-0 ${isMac ? 'pl-20' : ''}`}>
          <button
            className="titlebar-no-drag p-1 rounded hover:bg-biav-border text-biav-muted"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="切换侧边栏"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <div className="flex-1" />
          <ModelSelector
            providers={providers}
            provider={provider}
            model={model}
            onSelect={handleSelectModel}
          />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {messages.length === 0 && !isStreaming && (
            <div className="flex flex-col items-center justify-center h-full text-biav-muted">
              <div className="text-4xl mb-4 font-serif text-biav-gold-bright">缸中之脑</div>
              <div className="text-sm">Brain in a Vat · Desktop</div>
            </div>
          )}
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isStreaming && streamingContent && (
              <ChatMessage
                message={{
                  id: 'streaming',
                  conversation_id: '',
                  role: 'assistant',
                  content: streamingContent,
                  created_at: '',
                }}
                isStreaming
              />
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          disabled={false}
        />
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          onClose={() => {
            setShowSettings(false)
            refreshModels()
          }}
        />
      )}
    </div>
  )
}
