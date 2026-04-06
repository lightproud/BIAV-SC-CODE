import OpenAI from 'openai'
import type { StreamChunk, LLMUsage, ToolCall } from './claude'

interface OpenAIToolDef {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

interface OpenAIOptions {
  messages: { role: string; content: any }[]
  model: string
  apiKey: string
  baseUrl?: string
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
  tools?: OpenAIToolDef[]
}

export async function* streamOpenAI(opts: OpenAIOptions): AsyncGenerator<StreamChunk> {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseUrl || undefined,
  })

  const createParams: any = {
    model: opts.model,
    stream: true,
    stream_options: { include_usage: true },
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    messages: opts.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
  }

  if (opts.tools && opts.tools.length > 0) {
    createParams.tools = opts.tools
  }

  const stream = await client.chat.completions.create(createParams) as any

  let usage: LLMUsage | null = null
  // Track tool calls being assembled from deltas
  const toolCallAccum = new Map<number, { id: string; name: string; args: string }>()

  for await (const chunk of stream) {
    const choice = chunk.choices[0]
    if (choice) {
      const text = choice.delta?.content
      if (text) {
        if (opts.signal?.aborted) break
        yield { type: 'text', text }
      }

      // Accumulate tool call deltas
      const toolCalls = (choice.delta as any)?.tool_calls
      if (toolCalls) {
        for (const tc of toolCalls) {
          const idx = tc.index ?? 0
          if (!toolCallAccum.has(idx)) {
            toolCallAccum.set(idx, { id: tc.id || '', name: tc.function?.name || '', args: '' })
          }
          const acc = toolCallAccum.get(idx)!
          if (tc.id) acc.id = tc.id
          if (tc.function?.name) acc.name = tc.function.name
          if (tc.function?.arguments) acc.args += tc.function.arguments
        }
      }

      // When finish_reason is 'tool_calls', emit all accumulated tool calls
      if (choice.finish_reason === 'tool_calls') {
        for (const [, acc] of toolCallAccum) {
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(acc.args || '{}')
          } catch { /* empty */ }
          yield {
            type: 'tool_use',
            toolCall: {
              id: acc.id,
              name: acc.name,
              input,
            },
          }
        }
        toolCallAccum.clear()
      }
    }

    // The final chunk contains usage info
    if (chunk.usage) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
        model: opts.model,
      }
    }
  }

  if (usage) {
    yield { type: 'usage', usage }
  }
}
