import { streamClaude } from './claude'
import { streamOpenAI } from './openai'
import type { StreamChunk } from './claude'

export type { StreamChunk, LLMUsage } from './claude'

export interface StreamChatOptions {
  provider: 'claude' | 'openai'
  model: string
  messages: { role: string; content: string }[]
  apiKey: string
  baseUrl?: string
  signal?: AbortSignal
}

export async function* streamChat(opts: StreamChatOptions): AsyncGenerator<StreamChunk> {
  const { provider, messages, ...rest } = opts

  // Extract system message if present
  const systemMsg = messages.find((m) => m.role === 'system')
  const chatMessages = messages.filter((m) => m.role !== 'system')

  if (provider === 'claude') {
    yield* streamClaude({
      messages: chatMessages,
      model: rest.model,
      apiKey: rest.apiKey,
      systemPrompt: systemMsg?.content,
      signal: rest.signal,
    })
  } else {
    yield* streamOpenAI({
      messages: systemMsg ? [systemMsg, ...chatMessages] : chatMessages,
      model: rest.model,
      apiKey: rest.apiKey,
      baseUrl: rest.baseUrl,
      signal: rest.signal,
    })
  }
}
