import { streamClaude } from './claude'
import { streamOpenAI } from './openai'
import type { StreamChunk, AnthropicTool } from './claude'

export type { StreamChunk, LLMUsage, ToolCall, AnthropicTool } from './claude'

export interface StreamChatOptions {
  provider: 'claude' | 'openai'
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
      temperature: rest.temperature,
      maxTokens: rest.maxTokens,
      enableThinking: rest.enableThinking,
      tools: rest.tools,
    })
  } else {
    // Convert Anthropic tool format to OpenAI format
    const openaiTools = rest.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }))

    yield* streamOpenAI({
      messages: systemMsg ? [systemMsg, ...chatMessages] : chatMessages,
      model: rest.model,
      apiKey: rest.apiKey,
      baseUrl: rest.baseUrl,
      signal: rest.signal,
      temperature: rest.temperature,
      maxTokens: rest.maxTokens,
      tools: openaiTools,
    })
  }
}
