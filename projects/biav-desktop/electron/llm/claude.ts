import Anthropic from '@anthropic-ai/sdk'

interface ClaudeOptions {
  messages: { role: string; content: string }[]
  model: string
  apiKey: string
  systemPrompt?: string
  signal?: AbortSignal
}

export async function* streamClaude(opts: ClaudeOptions): AsyncGenerator<string> {
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
      yield event.delta.text
    }
  }
}
