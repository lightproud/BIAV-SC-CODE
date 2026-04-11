/**
 * Context compression — two-layer strategy to fit conversation into token budget.
 *
 * Layer 1 (LLM summary): When older messages exceed a threshold, use a cheap
 *   LLM call to summarize them into a concise paragraph. The summary replaces
 *   the original messages, preserving semantic meaning.
 *
 * Layer 2 (rule-based truncation): Fallback when LLM summary is unavailable
 *   or fails. Truncates older messages by character count.
 *
 * Both layers keep recent N turns intact for full fidelity.
 * System messages are always preserved in full.
 *
 * Uses character-based estimation: ~4 chars ≈ 1 token (rough but fast).
 */

import Anthropic from '@anthropic-ai/sdk'

interface Message {
  role: string
  content: any
}

export interface CompressionConfig {
  /** Anthropic API key — needed for LLM summary. If absent, falls back to rule-based. */
  apiKey?: string
  /** Model to use for summarization. Defaults to claude-3-5-haiku for cost efficiency. */
  summaryModel?: string
  /** Cached summary from a previous compression (avoids re-summarizing). */
  cachedSummary?: { upToIndex: number; text: string }
  /** Callback to persist the generated summary for future reuse. */
  onSummaryGenerated?: (summary: { upToIndex: number; text: string }) => void
}

const CHARS_PER_TOKEN = 4
const RECENT_TURNS_TO_KEEP = 10 // Keep last N user+assistant pairs intact
const OLD_MESSAGE_MAX_CHARS = 400
const OLD_TOOL_RESULT_MAX_CHARS = 200
// Trigger LLM summary when older messages exceed this fraction of budget
const SUMMARY_TRIGGER_RATIO = 0.4

function estimateTokens(text: string): number {
  if (!text) return 0
  const str = typeof text === 'string' ? text : JSON.stringify(text)
  return Math.ceil(str.length / CHARS_PER_TOKEN)
}

function contentToString(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(block => {
        if (block.type === 'text') return block.text || ''
        if (block.type === 'tool_use') return `[Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 100)})]`
        if (block.type === 'tool_result') {
          const c = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
          return `[Result: ${c.slice(0, 100)}]`
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return JSON.stringify(content)
}

function truncateText(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n[... truncated ...]'
}

function truncateContent(content: any, maxChars: number): any {
  if (typeof content === 'string') {
    return truncateText(content, maxChars)
  }
  // Array of content blocks (Claude format)
  if (Array.isArray(content)) {
    return content.map(block => {
      if (block.type === 'text' && block.text) {
        return { ...block, text: truncateText(block.text, maxChars) }
      }
      if (block.type === 'tool_result' && block.content) {
        return { ...block, content: truncateText(
          typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          OLD_TOOL_RESULT_MAX_CHARS
        )}
      }
      return block
    })
  }
  return content
}

/**
 * Summarize older messages using a cheap LLM call.
 * Returns a single summary string, or null on failure.
 */
async function summarizeMessages(
  messages: Message[],
  apiKey: string,
  model: string,
): Promise<string | null> {
  if (messages.length === 0) return null

  // Build a condensed transcript for summarization
  const transcript = messages.map(m => {
    const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role
    const text = contentToString(m.content)
    // Cap each message to avoid blowing up the summary prompt
    return `[${role}]: ${text.slice(0, 800)}`
  }).join('\n\n')

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0,
      system: 'You are a conversation summarizer. Produce a concise summary of the conversation below. Focus on: key decisions made, facts established, tools used and their results, current task state. Use bullet points. Write in the same language as the conversation. Be thorough but concise — aim for 200-400 words.',
      messages: [{
        role: 'user',
        content: `Summarize this conversation:\n\n${transcript}`,
      }],
    })

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')

    return text || null
  } catch {
    // LLM call failed — caller should fall back to rule-based
    return null
  }
}

/**
 * Compress conversation history to fit within token budget.
 *
 * Two-layer approach:
 * 1. If config.apiKey is provided and older messages are large enough,
 *    use LLM to summarize them (or use cached summary).
 * 2. Otherwise, fall back to rule-based truncation.
 */
export async function compressHistory(
  messages: Message[],
  tokenBudget: number,
  config: CompressionConfig = {},
): Promise<Message[]> {
  if (messages.length === 0) return messages

  // Separate system messages from conversation
  const systemMsgs = messages.filter(m => m.role === 'system')
  const convMsgs = messages.filter(m => m.role !== 'system')

  // Calculate tokens used by system messages (always kept)
  let usedTokens = 0
  for (const msg of systemMsgs) {
    usedTokens += estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))
  }

  const remainingBudget = tokenBudget - usedTokens
  if (remainingBudget <= 0) return systemMsgs

  // Split into recent (keep full) and older (may compress)
  const recentCount = Math.min(RECENT_TURNS_TO_KEEP * 2, convMsgs.length) // *2 for user+assistant pairs
  const recentMsgs = convMsgs.slice(-recentCount)
  const olderMsgs = convMsgs.slice(0, -recentCount || convMsgs.length)

  // If no older messages, nothing to compress
  if (olderMsgs.length === 0) {
    return [...systemMsgs, ...recentMsgs]
  }

  // Calculate recent messages token cost
  let recentTokens = 0
  for (const msg of recentMsgs) {
    recentTokens += estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))
  }

  // Calculate older messages token cost
  let olderTokens = 0
  for (const msg of olderMsgs) {
    olderTokens += estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))
  }

  const budgetForOlder = remainingBudget - recentTokens
  if (budgetForOlder <= 0) {
    return [...systemMsgs, ...recentMsgs]
  }

  // Decide whether to use LLM summary
  const totalConvTokens = olderTokens + recentTokens
  const shouldSummarize = config.apiKey && totalConvTokens > remainingBudget * SUMMARY_TRIGGER_RATIO

  if (shouldSummarize) {
    // Check for cached summary that covers these older messages
    if (config.cachedSummary && config.cachedSummary.upToIndex >= olderMsgs.length) {
      // Use cached summary
      const summaryMsg: Message = {
        role: 'system',
        content: `[Conversation summary of earlier ${config.cachedSummary.upToIndex} messages]\n\n${config.cachedSummary.text}`,
      }
      return [...systemMsgs, summaryMsg, ...recentMsgs]
    }

    // Generate new summary via LLM
    const summaryModel = config.summaryModel || 'claude-3-5-haiku-20241022'
    const summaryText = await summarizeMessages(olderMsgs, config.apiKey!, summaryModel)

    if (summaryText) {
      // Cache the summary for reuse
      const summaryData = { upToIndex: olderMsgs.length, text: summaryText }
      config.onSummaryGenerated?.(summaryData)

      const summaryMsg: Message = {
        role: 'system',
        content: `[Conversation summary of earlier ${olderMsgs.length} messages]\n\n${summaryText}`,
      }
      return [...systemMsgs, summaryMsg, ...recentMsgs]
    }
    // LLM failed — fall through to rule-based
  }

  // Layer 2: Rule-based truncation (fallback)
  const compressedOlder: Message[] = []
  let olderUsed = 0

  for (const msg of olderMsgs) {
    const truncated = truncateContent(msg.content, OLD_MESSAGE_MAX_CHARS)
    const tokens = estimateTokens(typeof truncated === 'string' ? truncated : JSON.stringify(truncated))

    if (olderUsed + tokens > budgetForOlder) {
      compressedOlder.push({
        role: 'system',
        content: `[Earlier conversation history truncated — ${olderMsgs.length - compressedOlder.length} messages omitted to fit context window]`,
      })
      break
    }

    compressedOlder.push({ role: msg.role, content: truncated })
    olderUsed += tokens
  }

  return [...systemMsgs, ...compressedOlder, ...recentMsgs]
}
