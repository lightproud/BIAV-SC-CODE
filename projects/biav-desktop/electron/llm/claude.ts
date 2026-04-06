import Anthropic from '@anthropic-ai/sdk'

export interface LLMUsage {
  inputTokens: number
  outputTokens: number
  model: string
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface StreamChunk {
  type: 'text' | 'thinking' | 'usage' | 'tool_use'
  text?: string
  usage?: LLMUsage
  toolCall?: ToolCall
}

// Models that support extended thinking
const THINKING_MODELS = [
  'claude-3-5-sonnet',
  'claude-sonnet-4',
  'claude-opus-4',
]

function supportsThinking(model: string): boolean {
  return THINKING_MODELS.some((m) => model.startsWith(m))
}

export interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

interface ClaudeOptions {
  messages: { role: string; content: any }[]
  model: string
  apiKey: string
  systemPrompt?: string
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
  enableThinking?: boolean
  tools?: AnthropicTool[]
}

export async function* streamClaude(opts: ClaudeOptions): AsyncGenerator<StreamChunk> {
  const client = new Anthropic({ apiKey: opts.apiKey })

  const useThinking = opts.enableThinking && supportsThinking(opts.model)

  const requestParams: any = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8192,
    system: opts.systemPrompt || undefined,
    messages: opts.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  }

  if (opts.tools && opts.tools.length > 0) {
    requestParams.tools = opts.tools
  }

  if (useThinking) {
    // Extended thinking requires temperature=1 and no explicit temperature setting
    requestParams.thinking = { type: 'enabled', budget_tokens: 10000 }
  } else {
    requestParams.temperature = opts.temperature
  }

  const stream = client.messages.stream(requestParams)

  // Track tool_use blocks being built
  let currentToolUse: { id: string; name: string; inputJson: string } | null = null

  for await (const event of stream) {
    if (opts.signal?.aborted) break

    if (event.type === 'content_block_start') {
      const block = (event as any).content_block
      if (block?.type === 'tool_use') {
        currentToolUse = { id: block.id, name: block.name, inputJson: '' }
      }
    } else if (event.type === 'content_block_delta') {
      if (event.delta.type === 'thinking_delta') {
        yield { type: 'thinking', text: (event.delta as any).thinking }
      } else if (event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text }
      } else if ((event.delta as any).type === 'input_json_delta' && currentToolUse) {
        currentToolUse.inputJson += (event.delta as any).partial_json
      }
    } else if (event.type === 'content_block_stop') {
      if (currentToolUse) {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(currentToolUse.inputJson || '{}')
        } catch { /* empty */ }
        yield {
          type: 'tool_use',
          toolCall: {
            id: currentToolUse.id,
            name: currentToolUse.name,
            input,
          },
        }
        currentToolUse = null
      }
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
