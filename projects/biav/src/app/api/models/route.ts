import { NextResponse } from 'next/server'
import { listOllamaModels } from '@/lib/llm'
import type { ProviderStatus } from '@/lib/types'

export async function GET() {
  const providers: ProviderStatus[] = []

  // Claude
  providers.push({
    provider: 'claude',
    available: !!process.env.ANTHROPIC_API_KEY,
    models: [
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      'claude-haiku-4-5-20251001',
    ],
  })

  // OpenAI
  providers.push({
    provider: 'openai',
    available: !!process.env.OPENAI_API_KEY,
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  })

  // Ollama
  const ollamaModels = await listOllamaModels(process.env.OLLAMA_BASE_URL)
  providers.push({
    provider: 'ollama',
    available: ollamaModels.length > 0,
    models: ollamaModels,
  })

  return NextResponse.json(providers)
}
