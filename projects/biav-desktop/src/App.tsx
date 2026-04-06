import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useChat } from './hooks/useChat'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useTheme } from './hooks/useTheme'
import Sidebar from './components/Sidebar'
import ChatMessage from './components/ChatMessage'
import ChatInput from './components/ChatInput'
import DropZone from './components/DropZone'
import ModelSelector from './components/ModelSelector'
import SettingsModal from './components/SettingsModal'
import ShortcutsModal from './components/ShortcutsModal'
import ExportMenu from './components/ExportMenu'
import UpdateNotice from './components/UpdateNotice'
import ArtifactsPanel from './components/ArtifactsPanel'
import SystemPromptEditor from './components/SystemPromptEditor'
import { parseArtifacts } from './lib/parseArtifacts'
import ProjectEditor from './components/ProjectEditor'
import type { Conversation, Project, ProviderStatus, Attachment, Artifact } from './types'

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
    editAndResend,
    regenerate,
  } = useChat()

  const { theme, toggleTheme } = useTheme()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [showProjectEditor, setShowProjectEditor] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [provider, setProvider] = useState('claude')
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [showSettings, setShowSettings] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [showArtifacts, setShowArtifacts] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Global keyboard shortcuts
  const shortcuts = useMemo(() => ({
    'mod+n': () => resetChat(),
    'mod+,': () => setShowSettings(true),
    'mod+/': () => setShowShortcuts((v) => !v),
  }), [resetChat])

  useKeyboardShortcuts(shortcuts)

  // Load conversations, projects, and models on mount
  useEffect(() => {
    refreshConversations()
    refreshProjects()
    refreshModels()
  }, [])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Parse artifacts from messages
  useEffect(() => {
    const allMessages = [...messages]
    if (isStreaming && streamingContent) {
      allMessages.push({
        id: 'streaming',
        conversation_id: '',
        role: 'assistant',
        content: streamingContent,
        created_at: '',
      })
    }
    const parsed = parseArtifacts(allMessages)
    setArtifacts(parsed)
    if (parsed.length > 0 && !showArtifacts) {
      setShowArtifacts(true)
    }
  }, [messages, streamingContent, isStreaming])

  // Refresh conversation list when a new conversation is created
  useEffect(() => {
    if (conversationId) refreshConversations()
  }, [conversationId])

  async function refreshConversations() {
    const list = await window.biav.listConversations()
    setConversations(list)
  }

  async function refreshProjects() {
    const list = await window.biav.listProjects()
    setProjects(list)
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

  function handleSend(content: string, sendAttachments: Attachment[]) {
    sendMessage(content, provider, model, sendAttachments.length > 0 ? sendAttachments : undefined)
  }

  const handleFilesDropped = useCallback((dropped: Attachment[]) => {
    setAttachments((prev) => [...prev, ...dropped])
  }, [])

  async function handleFork(messageId: string) {
    if (!conversationId) return
    const result = await window.biav.forkConversation(conversationId, messageId)
    await refreshConversations()
    loadConversation(result.conversationId)
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
          theme={theme}
          onToggleTheme={toggleTheme}
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
          {artifacts.length > 0 && (
            <button
              className={`titlebar-no-drag p-1 rounded hover:bg-biav-border transition-colors ${showArtifacts ? 'text-biav-gold' : 'text-biav-muted'}`}
              onClick={() => setShowArtifacts(!showArtifacts)}
              title="切换 Artifacts 面板"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
          )}
          <ExportMenu conversationId={conversationId} />
          <ModelSelector
            providers={providers}
            provider={provider}
            model={model}
            onSelect={handleSelectModel}
          />
        </div>

        {/* Chat area wrapped with DropZone */}
        <DropZone onFilesDropped={handleFilesDropped}>
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
                  onFork={handleFork}
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onEdit={(id, content) => editAndResend(id, content, provider, model)}
                  onRegenerate={() => regenerate(provider, model)}
                />
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
            attachments={attachments}
            onAttachmentsChange={setAttachments}
          />
        </DropZone>
      </div>

      {/* Artifacts Panel */}
      {showArtifacts && artifacts.length > 0 && (
        <ArtifactsPanel
          artifacts={artifacts}
          onClose={() => setShowArtifacts(false)}
        />
      )}

      {/* Update Notice */}
      <UpdateNotice />

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          onClose={() => {
            setShowSettings(false)
            refreshModels()
          }}
        />
      )}

      {/* Shortcuts Modal */}
      {showShortcuts && (
        <ShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}
    </div>
  )
}
