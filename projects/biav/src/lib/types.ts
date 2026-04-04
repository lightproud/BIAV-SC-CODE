export type LLMProvider = 'claude' | 'openai' | 'ollama'

export interface LLMConfig {
  provider: LLMProvider
  model: string
  apiKey?: string
  baseUrl?: string
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  model?: string
  provider?: LLMProvider
  createdAt: number
}

export interface Conversation {
  id: string
  title: string
  provider: LLMProvider
  model: string
  createdAt: number
  updatedAt: number
}

export interface ChatRequest {
  conversationId?: string
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  provider: LLMProvider
  model: string
}

export interface ProviderStatus {
  provider: LLMProvider
  available: boolean
  models: string[]
}
