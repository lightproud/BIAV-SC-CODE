import { streamClaude } from './claude'
import type { StreamChunk, AnthropicTool } from './claude'

export type { StreamChunk, LLMUsage, ToolCall, AnthropicTool } from './claude'

export interface StreamChatOptions {
  provider: 'claude'
  model: string
  messages: { role: string; content: any }[]
  apiKey: string
  baseUrl?: string
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
  enableThinking?: boolean
  tools?: AnthropicTool[]
}

export async function* streamChat(opts: StreamChatOptions): AsyncGenerator<StreamChunk> {
  const { messages, ...rest } = opts

  // Extract system message if present
  const systemMsg = messages.find((m) => m.role === 'system')
  const chatMessages = messages.filter((m) => m.role !== 'system')

  yield* streamClaude({
    messages: chatMessages,
    model: rest.model,
    apiKey: rest.apiKey,
    baseUrl: rest.baseUrl,
    systemPrompt: systemMsg?.content,
    signal: rest.signal,
    temperature: rest.temperature,
    maxTokens: rest.maxTokens,
    enableThinking: rest.enableThinking,
    tools: rest.tools,
  })
}
