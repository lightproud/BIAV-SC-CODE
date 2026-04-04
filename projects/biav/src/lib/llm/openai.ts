import OpenAI from 'openai'

export async function* streamOpenAI(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  model: string,
  apiKey: string,
  baseUrl?: string
): AsyncGenerator<string> {
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl || 'https://api.openai.com/v1',
  })

  const stream = await client.chat.completions.create({
    model,
    messages,
    stream: true,
  })

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) yield delta
  }
}
