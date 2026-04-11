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
import AboutModal from './components/AboutModal'
import ShortcutsModal from './components/ShortcutsModal'
import UpdateNotice from './components/UpdateNotice'
import WelcomeScreen from './components/WelcomeScreen'
import ArtifactsPanel from './components/ArtifactsPanel'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { parseArtifacts } from './lib/parseArtifacts'
import ProjectEditor from './components/ProjectEditor'
import UsageBar, { SessionUsageBar } from './components/UsageBar'
import StreamingStatus from './components/StreamingStatus'
import ModelParamsPanel from './components/ModelParams'
import ToolApproval from './components/ToolApproval'
import ToolResult from './components/ToolResult'
import ToolbarOverflowMenu from './components/ToolbarOverflowMenu'
import ClipboardHistory from './components/ClipboardHistory'
import type { Conversation, Project, ProviderStatus, Attachment, Artifact, ModelParams } from './types'

export default function App() {
  const {
    messages,
    conversationId,
    isStreaming,
    streamingContent,
    streamingThinking,
    streamingTokens,
    streamingDuration,
    sendMessage,
    stopStreaming,
    loadConversation,
    resetChat,
    editAndResend,
    regenerate,
    lastUsage,
    sessionUsage,
    titleUpdateCounter,
    pendingTools,
    approveToolUse,
  } = useChat()

  const { theme, mode, setMode } = useTheme()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [showProjectEditor, setShowProjectEditor] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [provider] = useState('claude')
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [showSettings, setShowSettings] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showClipboard, setShowClipboard] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [showArtifacts, setShowArtifacts] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [modelParams, setModelParams] = useState<ModelParams>({ temperature: 1.0, maxTokens: 8192 })
  const [enableThinking, setEnableThinking] = useState(false)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

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

  // Build the virtual list items: messages + tool events + optional streaming message + optional usage bar
  const virtualItems = useMemo(() => {
    const items: Array<{ type: 'message' | 'streaming' | 'usage' | 'tool_approval' | 'tool_result'; data?: any }> = messages.map((msg) => ({
      type: 'message' as const,
      data: msg,
    }))
    if (isStreaming && (streamingContent || streamingThinking)) {
      items.push({
        type: 'streaming',
        data: {
          id: 'streaming',
          conversation_id: '',
          role: 'assistant',
          content: streamingContent,
          created_at: '',
        },
      })
    }
    // Add pending tool items
    for (const tool of pendingTools) {
      if (tool.status === 'done') {
        items.push({ type: 'tool_result', data: tool })
      } else {
        items.push({ type: 'tool_approval', data: tool })
      }
    }
    if (!isStreaming && lastUsage) {
      items.push({ type: 'usage', data: lastUsage })
    }
    return items
  }, [messages, isStreaming, streamingContent, streamingThinking, lastUsage, pendingTools])

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

  // Load system prompt and refresh conversation list when conversation changes
  useEffect(() => {
    if (conversationId) {
      refreshConversations()
      window.bpt.getSystemPrompt(conversationId).then((p) => setSystemPrompt(p || ''))
    } else {
      setSystemPrompt('')
    }
  }, [conversationId])

  // Refresh sidebar when a smart title is generated for a new conversation
  useEffect(() => {
    if (titleUpdateCounter > 0) {
      refreshConversations()
    }
  }, [titleUpdateCounter])

  async function refreshConversations() {
    const list = await window.bpt.listConversations()
    setConversations(list)
  }

  async function refreshProjects() {
    const list = await window.bpt.listProjects()
    setProjects(list)
  }

  async function refreshModels() {
    const list = await window.bpt.listModels()
    setProviders(list)
  }

  async function handleDeleteConversation(id: string) {
    await window.bpt.deleteConversation(id)
    if (conversationId === id) resetChat()
    refreshConversations()
  }

  async function handleRenameConversation(id: string, title: string) {
    await window.bpt.renameConversation(id, title)
    refreshConversations()
  }

  async function handleCreateOrUpdateProject(data: { name: string; description: string; system_prompt: string }) {
    if (editingProject) {
      await window.bpt.updateProject(editingProject.id, data)
    } else {
      await window.bpt.createProject(data)
    }
    setShowProjectEditor(false)
    setEditingProject(null)
    refreshProjects()
  }

  async function handleDeleteProject(id: string) {
    await window.bpt.deleteProject(id)
    refreshProjects()
    refreshConversations()
  }

  async function handleMoveToProject(convId: string, projectId: string | null) {
    await window.bpt.moveConversationToProject(convId, projectId)
    refreshConversations()
  }

  async function handlePinConversation(id: string, pinned: boolean) {
    await window.bpt.pinConversation(id, pinned)
    refreshConversations()
  }

  function handleSelectModel(_p: string, m: string) {
    setModel(m)
  }

  function handleSend(content: string, sendAttachments: Attachment[]) {
    sendMessage(content, provider, model, sendAttachments.length > 0 ? sendAttachments : undefined, systemPrompt || undefined, modelParams, enableThinking)
  }

  async function handleSystemPromptChange(prompt: string) {
    setSystemPrompt(prompt)
    if (conversationId) {
      await window.bpt.setSystemPrompt(conversationId, prompt)
    }
  }

  const handleFilesDropped = useCallback((dropped: Attachment[]) => {
    setAttachments((prev) => [...prev, ...dropped])
  }, [])

  async function handleFork(messageId: string) {
    if (!conversationId) return
    const result = await window.bpt.forkConversation(conversationId, messageId)
    await refreshConversations()
    loadConversation(result.conversationId)
  }

  const isMac = window.bpt.platform === 'darwin'

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      {sidebarOpen && (
        <Sidebar
          conversations={conversations}
          projects={projects}
          activeId={conversationId}
          onSelect={loadConversation}
          onDelete={handleDeleteConversation}
          onRename={handleRenameConversation}
          onNewChat={resetChat}
          onOpenSettings={() => setShowSettings(true)}
          onAbout={() => setShowAbout(true)}
          onNewProject={() => { setEditingProject(null); setShowProjectEditor(true) }}
          onEditProject={(p) => { setEditingProject(p); setShowProjectEditor(true) }}
          onDeleteProject={handleDeleteProject}
          onMoveToProject={handleMoveToProject}
          onPin={handlePinConversation}
          onImport={async () => {
            const result = await window.bpt.importConversation()
            if (result.ok && result.conversationId) {
              await refreshConversations()
              loadConversation(result.conversationId)
            }
          }}
          theme={theme}
          themeMode={mode}
          onSetThemeMode={setMode}
        />
      )}

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Titlebar - thin, clean toolbar */}
        <div className={`titlebar-drag flex items-center gap-1 border-b border-bpt-border px-3 h-11 shrink-0 ${isMac ? 'pl-20' : ''} ${!isMac ? 'pr-[140px]' : ''}`}>
          {/* Sidebar toggle */}
          <button
            className="titlebar-no-drag p-1.5 rounded-md hover:bg-bpt-border/60 text-bpt-muted hover:text-bpt-text transition-colors"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="切换侧边�?
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {sidebarOpen ? (
                <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>
              ) : (
                <path d="M3 12h18M3 6h18M3 18h18" />
              )}
            </svg>
          </button>

          {/* Center spacer - this is the main drag area */}
          <div className="flex-1 min-w-0" />

          {/* Right side - only essential actions */}
          {artifacts.length > 0 && (
            <button
              className={`titlebar-no-drag p-1.5 rounded-md transition-colors ${showArtifacts ? 'text-bpt-gold bg-bpt-gold/10' : 'text-bpt-muted hover:text-bpt-text hover:bg-bpt-border/60'}`}
              onClick={() => setShowArtifacts(!showArtifacts)}
              title="Artifacts"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              {artifacts.length > 1 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-bpt-gold text-[9px] text-bpt-bg flex items-center justify-center font-medium">
                  {artifacts.length}
                </span>
              )}
            </button>
          )}

          {/* Overflow menu for secondary tools */}
          <ToolbarOverflowMenu
            conversationId={conversationId}
            systemPrompt={systemPrompt}
            onSystemPromptChange={handleSystemPromptChange}
            onOpenClipboard={() => setShowClipboard(true)}
          />
        </div>

        {/* Chat area wrapped with DropZone */}
        <DropZone onFilesDropped={handleFilesDropped}>
          {/* Messages */}
          {messages.length === 0 && !isStreaming ? (
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <WelcomeScreen
                providers={providers}
                onOpenSettings={() => setShowSettings(true)}
                onSuggestion={(text) => handleSend(text, [])}
              />
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              className="flex-1"
              data={virtualItems}
              followOutput="smooth"
              initialTopMostItemIndex={virtualItems.length - 1}
              itemContent={(index, item) => {
                const inner = (() => {
                  if (item.type === 'usage') {
                    return <UsageBar usage={item.data} />
                  }
                  if (item.type === 'tool_approval') {
                    return <ToolApproval tool={item.data} onApprove={approveToolUse} />
                  }
                  if (item.type === 'tool_result') {
                    return <ToolResult tool={item.data} />
                  }
                  if (item.type === 'streaming') {
                    return (
                      <ChatMessage
                        message={item.data}
                        isStreaming
                        streamingThinking={streamingThinking}
                        thinkingDuration={streamingDuration}
                      />
                    )
                  }
                  return (
                    <ChatMessage
                      message={item.data}
                      onEdit={(id, content) => editAndResend(id, content, provider, model)}
                      onRegenerate={() => regenerate(provider, model)}
                      onFork={handleFork}
                    />
                  )
                })()
                return (
                  <div className="max-w-3xl mx-auto px-4 pt-4">
                    {inner}
                  </div>
                )
              }}
            />
          )}

          {/* Session usage summary */}
          {(sessionUsage.totalInput > 0 || sessionUsage.totalOutput > 0) && (
            <div className="max-w-3xl mx-auto px-4">
              <SessionUsageBar
                totalInput={sessionUsage.totalInput}
                totalOutput={sessionUsage.totalOutput}
                totalCost={sessionUsage.totalCost}
              />
            </div>
          )}

          {/* Streaming status */}
          {isStreaming && (
            <StreamingStatus tokens={streamingTokens} duration={streamingDuration} />
          )}

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

        {/* Bottom status bar */}
        <div className="flex items-center gap-2 border-t border-bpt-border px-3 h-8 shrink-0 text-xs select-none">
          {/* Left: thinking toggle + model params */}
          <div className="flex items-center gap-1">
            {provider === 'claude' && (
              <button
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${enableThinking ? 'text-bpt-gold bg-bpt-gold/10' : 'text-bpt-muted hover:text-bpt-text hover:bg-bpt-border/60'}`}
                onClick={() => setEnableThinking(!enableThinking)}
                title={enableThinking ? '深度思考已开�? : '深度思考已关闭'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a7 7 0 0 0-7 7c0 3 2 5.5 4 7.5.5.5 1 1.5 1 2.5h4c0-1 .5-2 1-2.5 2-2 4-4.5 4-7.5a7 7 0 0 0-7-7z" />
                  <path d="M9 22h6" />
                </svg>
                <span>思�?/span>
              </button>
            )}
            <ModelParamsPanel
              params={modelParams}
              onChange={setModelParams}
            />
          </div>

          <div className="flex-1" />

          {/* Right: model selector */}
          <ModelSelector
            providers={providers}
            provider={provider}
            model={model}
            onSelect={handleSelectModel}
          />
        </div>
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

      {/* About Modal */}
      {showAbout && (
        <AboutModal onClose={() => setShowAbout(false)} />
      )}

      {/* Clipboard History Modal */}
      {showClipboard && (
        <ClipboardHistory onClose={() => setShowClipboard(false)} />
      )}

      {/* Project Editor Modal */}
      {showProjectEditor && (
        <ProjectEditor
          project={editingProject}
          onSave={handleCreateOrUpdateProject}
          onClose={() => { setShowProjectEditor(false); setEditingProject(null) }}
        />
      )}
    </div>
  )
}
