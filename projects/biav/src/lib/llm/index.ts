import type { LLMProvider } from '../types'
import { streamClaude } from './claude'
import { streamOpenAI } from './openai'
import { streamOllama } from './ollama'

export async function* streamChat(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  provider: LLMProvider,
  model: string
): AsyncGenerator<string> {
  // Separate system prompt for Claude (which uses a dedicated system parameter)
  const systemMsg = messages.find((m) => m.role === 'system')
  const chatMessages = messages.filter((m) => m.role !== 'system') as {
    role: 'user' | 'assistant'
    content: string
  }[]

  switch (provider) {
    case 'claude': {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
      yield* streamClaude(chatMessages, model, apiKey, systemMsg?.content)
      break
    }

    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
      yield* streamOpenAI(messages, model, apiKey, process.env.OPENAI_BASE_URL)
      break
    }

    case 'ollama': {
      yield* streamOllama(messages, model, process.env.OLLAMA_BASE_URL)
      break
    }

    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

export { listOllamaModels } from './ollama'
