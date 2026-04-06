/**
 * Context compression — trims conversation history to fit token budget.
 *
 * Strategy:
 *   1. Keep the most recent N turns intact (full fidelity)
 *   2. Older messages get truncated (first 200 chars + "...")
 *   3. Tool results in older messages get aggressively truncated
 *   4. System messages always kept in full
 *
 * Uses character-based estimation: ~4 chars ≈ 1 token (rough but fast).
 */

interface Message {
  role: string
  content: any
}

const CHARS_PER_TOKEN = 4
const RECENT_TURNS_TO_KEEP = 10 // Keep last N user+assistant pairs intact
const OLD_MESSAGE_MAX_CHARS = 400
const OLD_TOOL_RESULT_MAX_CHARS = 200

function estimateTokens(text: string): number {
  if (!text) return 0
  const str = typeof text === 'string' ? text : JSON.stringify(text)
  return Math.ceil(str.length / CHARS_PER_TOKEN)
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

export function compressHistory(
  messages: Message[],
  tokenBudget: number,
): Message[] {
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

  // Split into recent (keep full) and older (may truncate)
  const recentCount = Math.min(RECENT_TURNS_TO_KEEP * 2, convMsgs.length) // *2 for user+assistant pairs
  const recentMsgs = convMsgs.slice(-recentCount)
  const olderMsgs = convMsgs.slice(0, -recentCount || convMsgs.length)

  // Calculate recent messages token cost
  let recentTokens = 0
  for (const msg of recentMsgs) {
    recentTokens += estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))
  }

  const budgetForOlder = remainingBudget - recentTokens
  if (budgetForOlder <= 0) {
    // Only room for recent messages
    return [...systemMsgs, ...recentMsgs]
  }

  // Truncate older messages to fit budget
  const compressedOlder: Message[] = []
  let olderUsed = 0

  for (const msg of olderMsgs) {
    const truncated = truncateContent(msg.content, OLD_MESSAGE_MAX_CHARS)
    const tokens = estimateTokens(typeof truncated === 'string' ? truncated : JSON.stringify(truncated))

    if (olderUsed + tokens > budgetForOlder) {
      // Insert a summary marker and stop
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
