import Anthropic from '@anthropic-ai/sdk'

export async function* streamClaude(
  messages: { role: 'user' | 'assistant'; content: string }[],
  model: string,
  apiKey: string,
  systemPrompt?: string
): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey })

  const stream = await client.messages.stream({
    model,
    max_tokens: 8192,
    system: systemPrompt || undefined,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  })

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      yield event.delta.text
    }
  }
}
