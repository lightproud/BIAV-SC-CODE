export type LLMProvider = 'claude' | 'openai'

export interface ModelParams {
  temperature: number
  maxTokens: number
}

export interface Attachment {
  name: string
  path: string
  type: string
  content: string
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
  model?: string
  provider?: string
  created_at: string
}

export interface Conversation {
  id: string
  title: string
  provider: string
  model: string
  system_prompt?: string | null
  project_id?: string | null
  is_pinned?: number
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
  description: string
  system_prompt: string
  created_at: string
  updated_at: string
}

export interface ProviderStatus {
  provider: string
  available: boolean
  models: { id: string; name: string }[]
}

export interface ArtifactVersion {
  content: string
  timestamp: number
  messageId: string
}

export interface Artifact {
  id: string
  type: 'code' | 'html' | 'markdown' | 'svg'
  title: string
  content: string
  language?: string
  versions: ArtifactVersion[]
  currentVersion: number
}

export interface UsageData {
  inputTokens: number
  outputTokens: number
  model: string
  estimatedCost: number
}

export interface SessionUsage {
  totalInput: number
  totalOutput: number
  totalCost: number
}

export interface Settings {
  anthropic_api_key: string
  openai_api_key: string
  openai_base_url: string
}

// Style types
export interface Style {
  id: string
  name: string
  description: string
  prompt: string  // injected as system-level instruction
  isBuiltin: boolean
  icon?: string  // emoji
}

// Clipboard types
export interface ClipboardEntry {
  text: string
  timestamp: number
  source: 'code' | 'message'
}

// Tool use types
export interface ToolUseEvent {
  toolName: string
  serverName: string
  toolArgs: Record<string, unknown>
  toolUseId: string
}

export interface ToolResultEvent {
  toolUseId: string
  toolName: string
  result?: any
  error?: string
  isError: boolean
}

export type ToolApprovalStatus = 'pending' | 'approved' | 'denied' | 'executing' | 'done'

export interface PendingToolUse {
  toolUseId: string
  toolName: string
  serverName: string
  toolArgs: Record<string, unknown>
  status: ToolApprovalStatus
  result?: any
  error?: string
}

// MCP types
export type MCPServerStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface MCPServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
}

export interface MCPServerInfo {
  name: string
  status: MCPServerStatus
  error?: string
  toolCount: number
}

export interface MCPTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface SearchResult {
  conversationId: string
  conversationTitle: string
  snippet: string
  messageRole: 'user' | 'assistant' | 'system'
  messageDate: string
}

// Electron IPC bridge type
declare global {
  interface Window {
    biav: {
      sendMessage: (req: {
        conversationId: string | null
        message: string
        provider: string
        model: string
        systemPrompt?: string
        stylePrompt?: string
        attachments?: Attachment[]
        temperature?: number
        maxTokens?: number
        enableThinking?: boolean
      }) => Promise<void>
      onChatStream: (callback: (event: any, data: any) => void) => () => void
      stopStreaming: () => Promise<void>
      editMessage: (req: { conversationId: string; messageId: string; content: string }) => Promise<void>
      regenerateMessage: (req: { conversationId: string; afterMessageId: string }) => Promise<void>
      getSystemPrompt: (conversationId: string) => Promise<string>
      setSystemPrompt: (conversationId: string, prompt: string) => Promise<{ ok: boolean }>
      listConversations: () => Promise<Conversation[]>
      getMessages: (conversationId: string) => Promise<Message[]>
      deleteConversation: (id: string) => Promise<void>
      renameConversation: (id: string, title: string) => Promise<{ ok: boolean }>
      pinConversation: (id: string, pinned: boolean) => Promise<{ ok: boolean }>
      forkConversation: (conversationId: string, messageId: string) => Promise<{ conversationId: string }>
      searchConversations: (query: string) => Promise<SearchResult[]>
      exportConversation: (id: string, format: 'md' | 'json') => Promise<{ ok: boolean; path?: string; error?: string }>
      importConversation: () => Promise<{ ok: boolean; conversationId?: string; error?: string }>
      listModels: () => Promise<ProviderStatus[]>
      getSettings: () => Promise<Settings>
      setSettings: (settings: Partial<Settings>) => Promise<void>
      readFile: (path: string) => Promise<{ name: string; content: string; mimeType: string }>
      parsePdf: (base64Data: string, fileName: string) => Promise<{ ok: boolean; content?: string; error?: string }>
      submitQuickEntry: (text: string) => Promise<void>
      hideQuickEntry: () => Promise<void>
      onQuickEntryReceived: (callback: (event: any, text: string) => void) => () => void
      // Theme
      onSystemThemeChange: (callback: (isDark: boolean) => void) => () => void

      platform: string
      versions: { electron: string; chrome: string; node: string }
      openExternal: (url: string) => Promise<void>

      // Projects
      listProjects: () => Promise<Project[]>
      createProject: (data: { name: string; description?: string; system_prompt?: string }) => Promise<Project>
      updateProject: (id: string, data: { name?: string; description?: string; system_prompt?: string }) => Promise<Project>
      deleteProject: (id: string) => Promise<{ ok: boolean }>
      listProjectConversations: (projectId: string) => Promise<Conversation[]>
      moveConversationToProject: (conversationId: string, projectId: string | null) => Promise<{ ok: boolean }>

      // Notifications
      showNotification: (title: string, body: string) => Promise<void>
      setNotificationsEnabled: (enabled: boolean) => Promise<void>

      // Usage
      getSessionUsage: (conversationId: string) => Promise<SessionUsage>

      // Context Menu
      showContextMenu: (type: string, data?: any) => Promise<void>
      onContextMenuAction: (callback: (event: any, payload: { action: string; data?: any }) => void) => () => void

      // Clipboard
      clipboardHistory: () => Promise<ClipboardEntry[]>
      clipboardAdd: (entry: { text: string; source: 'code' | 'message' }) => Promise<{ ok: boolean }>
      clipboardClear: () => Promise<{ ok: boolean }>

      // Updater
      checkForUpdate: () => Promise<void>
      downloadUpdate: () => Promise<void>
      installUpdate: () => Promise<void>
      onUpdateAvailable: (callback: (info: { version: string; releaseDate?: string }) => void) => () => void
      onUpdateDownloaded: (callback: (info: { version: string }) => void) => () => void

      // Tool approval
      approveToolUse: (toolUseId: string, approved: boolean, alwaysAllow?: boolean) => Promise<void>

      // MCP
      mcpListServers: () => Promise<MCPServerInfo[]>
      mcpStartServer: (name: string) => Promise<{ ok: boolean; error?: string }>
      mcpStopServer: (name: string) => Promise<{ ok: boolean }>
      mcpListTools: (serverName: string) => Promise<MCPTool[]>
      mcpCallTool: (serverName: string, toolName: string, args: Record<string, unknown>) => Promise<{ ok: boolean; result?: any; error?: string }>
      mcpGetConfig: () => Promise<MCPConfig>
      mcpSaveConfig: (config: MCPConfig) => Promise<{ ok: boolean }>

      // Styles
      listStyles: () => Promise<Style[]>
      saveStyle: (style: Omit<Style, 'isBuiltin'>) => Promise<Style>
      deleteStyle: (id: string) => Promise<{ ok: boolean }>
    }
  }
}
