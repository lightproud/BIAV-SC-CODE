import Anthropic from '@anthropic-ai/sdk'

export interface LLMUsage {
  inputTokens: number
  outputTokens: number
  model: string
}

export interface StreamChunk {
  type: 'text' | 'usage'
  text?: string
  usage?: LLMUsage
}

interface ClaudeOptions {
  messages: { role: string; content: string }[]
  model: string
  apiKey: string
  systemPrompt?: string
  signal?: AbortSignal
}

export async function* streamClaude(opts: ClaudeOptions): AsyncGenerator<StreamChunk> {
  const client = new Anthropic({ apiKey: opts.apiKey })

  const stream = client.messages.stream({
    model: opts.model,
    max_tokens: 8192,
    system: opts.systemPrompt || undefined,
    messages: opts.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  })

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      if (opts.signal?.aborted) break
      yield { type: 'text', text: event.delta.text }
    }
  }

  // Capture usage from the final message
  const finalMessage = await stream.finalMessage()
  if (finalMessage.usage) {
    yield {
      type: 'usage',
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        model: opts.model,
      },
    }
  }
}
