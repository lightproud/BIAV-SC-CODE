export type LLMProvider = 'claude' | 'openai'

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

export interface Artifact {
  id: string
  type: 'code' | 'html' | 'markdown' | 'svg'
  title: string
  content: string
  language?: string
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
        attachments?: Attachment[]
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
      forkConversation: (conversationId: string, messageId: string) => Promise<{ conversationId: string }>
      exportConversation: (id: string, format: 'md' | 'json') => Promise<{ ok: boolean; path?: string; error?: string }>
      listModels: () => Promise<ProviderStatus[]>
      getSettings: () => Promise<Settings>
      setSettings: (settings: Partial<Settings>) => Promise<void>
      readFile: (path: string) => Promise<{ name: string; content: string; mimeType: string }>
      submitQuickEntry: (text: string) => Promise<void>
      hideQuickEntry: () => Promise<void>
      onQuickEntryReceived: (callback: (event: any, text: string) => void) => () => void
      platform: string

      // Projects
      listProjects: () => Promise<Project[]>
      createProject: (data: { name: string; description?: string; system_prompt?: string }) => Promise<Project>
      updateProject: (id: string, data: { name?: string; description?: string; system_prompt?: string }) => Promise<Project>
      deleteProject: (id: string) => Promise<{ ok: boolean }>
      listProjectConversations: (projectId: string) => Promise<Conversation[]>
      moveConversationToProject: (conversationId: string, projectId: string | null) => Promise<{ ok: boolean }>

      // Usage
      getSessionUsage: (conversationId: string) => Promise<SessionUsage>

      // Context Menu
      showContextMenu: (type: string, data?: any) => Promise<void>
      onContextMenuAction: (callback: (event: any, payload: { action: string; data?: any }) => void) => () => void

      // Updater
      checkForUpdate: () => Promise<void>
      downloadUpdate: () => Promise<void>
      installUpdate: () => Promise<void>
      onUpdateAvailable: (callback: (info: { version: string; releaseDate?: string }) => void) => () => void
      onUpdateDownloaded: (callback: (info: { version: string }) => void) => () => void
    }
  }
}
