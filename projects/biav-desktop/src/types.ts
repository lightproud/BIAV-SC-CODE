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
  created_at: string
  updated_at: string
}

export interface ProviderStatus {
  provider: string
  available: boolean
  models: { id: string; name: string }[]
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
        attachments?: Attachment[]
      }) => Promise<void>
      onChatStream: (callback: (event: any, data: any) => void) => () => void
      stopStreaming: () => Promise<void>
      editMessage: (req: { conversationId: string; messageId: string; content: string }) => Promise<void>
      regenerateMessage: (req: { conversationId: string; afterMessageId: string }) => Promise<void>
      listConversations: () => Promise<Conversation[]>
      getMessages: (conversationId: string) => Promise<Message[]>
      deleteConversation: (id: string) => Promise<void>
      exportConversation: (id: string, format: 'md' | 'json') => Promise<{ ok: boolean; path?: string; error?: string }>
      listModels: () => Promise<ProviderStatus[]>
      getSettings: () => Promise<Settings>
      setSettings: (settings: Partial<Settings>) => Promise<void>
      readFile: (path: string) => Promise<{ name: string; content: string; mimeType: string }>
      platform: string
    }
  }
}
