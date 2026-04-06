import OpenAI from 'openai'
import type { StreamChunk, LLMUsage } from './claude'

interface OpenAIOptions {
  messages: { role: string; content: string }[]
  model: string
  apiKey: string
  baseUrl?: string
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
}

export async function* streamOpenAI(opts: OpenAIOptions): AsyncGenerator<StreamChunk> {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseUrl || undefined,
  })

  const stream = await client.chat.completions.create({
    model: opts.model,
    stream: true,
    stream_options: { include_usage: true },
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    messages: opts.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
  })

  let usage: LLMUsage | null = null

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content
    if (text) {
      if (opts.signal?.aborted) break
      yield { type: 'text', text }
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
