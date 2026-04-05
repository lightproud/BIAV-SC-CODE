import OpenAI from 'openai'

interface OpenAIOptions {
  messages: { role: string; content: string }[]
  model: string
  apiKey: string
  baseUrl?: string
  signal?: AbortSignal
}

export async function* streamOpenAI(opts: OpenAIOptions): AsyncGenerator<string> {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseUrl || undefined,
  })

  const stream = await client.chat.completions.create({
    model: opts.model,
    stream: true,
    messages: opts.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
  })

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content
    if (text) {
      if (opts.signal?.aborted) break
      yield text
    }
  }
}
