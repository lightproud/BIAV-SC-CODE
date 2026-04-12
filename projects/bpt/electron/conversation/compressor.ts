/**
 * compressor.ts — Conversation history compression.
 *
 * Why: Prime Directive T3 — history must be compressed when it exceeds
 * the dynamic budget. The budget is NOT a fixed percentage — it's
 * calculated by subtracting system prompt, tool schemas, and output
 * reserve from the model's context window (Aider-style split budget).
 *
 * Phase 1 strategy: Use Haiku to generate a summary of dropped turns,
 * preserving key decisions, facts, and user preferences. Falls back to
 * a plain placeholder if the summarization call fails.
 */

import type { LlmMessage } from '../llm/provider';
import { getConfig } from '../core/config';
import { getHistoryBudget, getCompressionThreshold, estimateTokens } from '../llm/token-accounting';
import { logger } from '../core/logger';

interface CompressionResult {
  messages: LlmMessage[];
  wasCompressed: boolean;
  droppedTurns: number;
}

/**
 * Overhead context that competes with history for the context window.
 * Passed by the orchestrator (stream.ts) which knows the actual values.
 */
export interface ContextOverhead {
  systemPromptTokens: number;
  toolSchemaTokens: number;
  maxOutputTokens: number;
}

/**
 * Compress conversation history if it exceeds the dynamic budget.
 *
 * Two independent triggers (either one fires compression):
 * 1. Turn count exceeds compressionTriggerTurns (default 20)
 * 2. Estimated history tokens exceed the dynamic budget
 *    (= contextWindow * 95% - system - tools - output reserve)
 *
 * When overhead is provided, the budget is precise: history gets
 * whatever space is left after system, tools, and output. When overhead
 * is null (legacy path), falls back to 90% of context window.
 *
 * Strategy once triggered:
 * 1. Keep the last `keepTurns` message pairs (user+assistant) verbatim.
 * 2. Summarize everything before that into a condensed context block
 *    using Haiku (cheap, fast).
 * 3. If Haiku call fails, fall back to a plain placeholder.
 */
export async function compressHistory(
  messages: LlmMessage[],
  model: string,
  overhead?: ContextOverhead | null,
): Promise<CompressionResult> {
  const maxTurns = (getConfig('compressionTriggerTurns') as number) ?? 20;
  const keepTurns = 10; // Keep the last 10 user+assistant pairs

  // Calculate history budget: dynamic (precise) or fallback (percentage)
  const historyBudget = overhead
    ? getHistoryBudget(model, overhead.systemPromptTokens, overhead.toolSchemaTokens, overhead.maxOutputTokens)
    : getCompressionThreshold(model);

  // Count turns (a turn = one user message)
  const turns = countTurns(messages);
  const estimatedTokens = estimateHistoryTokens(messages);

  // Trigger on whichever threshold is hit first
  const turnTriggered = turns > maxTurns;
  const tokenTriggered = estimatedTokens > historyBudget;

  if (!turnTriggered && !tokenTriggered) {
    return { messages, wasCompressed: false, droppedTurns: 0 };
  }

  if (tokenTriggered) {
    const budgetSource = overhead ? 'dynamic' : 'fallback';
    logger.info('compressor',
      `Token threshold triggered (${budgetSource}): ~${Math.round(estimatedTokens)} history tokens > ${historyBudget} budget` +
      (overhead ? ` (sys:${overhead.systemPromptTokens} tools:${overhead.toolSchemaTokens} out:${overhead.maxOutputTokens})` : ''),
    );
  }

  // Find the cut point: keep the last `keepTurns * 2` messages
  const keepCount = keepTurns * 2;
  const dropCount = messages.length - keepCount;

  if (dropCount <= 0) {
    return { messages, wasCompressed: false, droppedTurns: 0 };
  }

  const droppedTurns = Math.floor(dropCount / 2);
  const droppedMessages = messages.slice(0, dropCount);
  const keptMessages = messages.slice(dropCount);

  // Attempt Haiku summarization of dropped turns
  const summary = await summarizeDroppedTurns(droppedMessages, droppedTurns);

  // Use 'user' role, not 'system' — Anthropic API has special handling for
  // system role and it should only appear as the systemPrompt parameter.
  const compressed: LlmMessage[] = [
    {
      role: 'user',
      content: summary,
    },
    ...keptMessages,
  ];

  return {
    messages: compressed,
    wasCompressed: true,
    droppedTurns,
  };
}

/**
 * Summarize dropped conversation turns using Haiku.
 * Returns a formatted context note. Falls back to a plain placeholder
 * if the LLM call fails or is unavailable.
 */
async function summarizeDroppedTurns(
  droppedMessages: LlmMessage[],
  droppedTurns: number,
): Promise<string> {
  const fallback =
    `[Context note: Earlier conversation compressed — ${droppedTurns} turns omitted. ` +
    `This conversation has been ongoing. The user may reference earlier context.]`;

  const endpoint = getConfig('endpoint') as {
    baseUrl: string;
    apiKey: string;
    provider?: string;
  } | undefined;

  if (!endpoint?.apiKey) return fallback;

  try {
    // Build a compact representation of the dropped conversation
    const transcript = droppedMessages.map((m) => {
      const text = typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content);
      // Cap each message to avoid blowing up the summarization request
      return `[${m.role}]: ${text.slice(0, 500)}`;
    }).join('\n');

    // Cap total transcript to ~4000 chars (~1000 tokens) for the summarizer
    const cappedTranscript = transcript.slice(0, 4000);

    const prompt = `You are a conversation compressor. Summarize the following ${droppedTurns} conversation turns into a concise context note (max 300 words) that preserves:
1. Key decisions made and their rationale
2. Important facts discovered or established
3. User preferences or corrections expressed
4. Tool results that informed decisions
5. Any unresolved questions or pending items

Do NOT include pleasantries, greetings, or redundant phrasing. Write in the same language as the conversation.

Conversation to summarize:
${cappedTranscript}

Write ONLY the summary, no preamble:`;

    const isOpenAi = endpoint.provider === 'openai';
    const summarizerModel = isOpenAi ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001';
    const baseUrl = (endpoint.baseUrl || '').replace(/\/+$/, '');

    const url = isOpenAi
      ? `${baseUrl}/v1/chat/completions`
      : `${baseUrl || 'https://api.anthropic.com'}/v1/messages`;

    const body = isOpenAi
      ? { model: summarizerModel, messages: [{ role: 'user', content: prompt }], max_tokens: 800 }
      : { model: summarizerModel, max_tokens: 800, messages: [{ role: 'user', content: prompt }] };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (isOpenAi) {
      headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
    } else {
      headers['x-api-key'] = endpoint.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000), // 15s timeout — compression must not stall the conversation
    });

    if (!response.ok) {
      logger.warn('compressor', `Haiku summarization returned ${response.status}, using fallback`);
      return fallback;
    }

    const result = await response.json() as Record<string, unknown>;

    // Extract text (handle both Anthropic and OpenAI response formats)
    let summaryText = '';
    if (isOpenAi) {
      const choices = result.choices as Array<Record<string, unknown>>;
      const msg = choices?.[0]?.message as Record<string, unknown>;
      summaryText = (msg?.content as string) ?? '';
    } else {
      const content = result.content as Array<Record<string, unknown>>;
      summaryText = (content?.[0]?.text as string) ?? '';
    }

    if (!summaryText.trim()) {
      logger.warn('compressor', 'Empty summary from Haiku, using fallback');
      return fallback;
    }

    logger.info('compressor', `Summarized ${droppedTurns} turns into ${summaryText.length} chars`);
    return `[Compressed context — ${droppedTurns} earlier turns summarized by AI]\n${summaryText.trim()}`;
  } catch (err) {
    logger.warn('compressor', 'Haiku summarization failed, using fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

function countTurns(messages: LlmMessage[]): number {
  return messages.filter((m) => m.role === 'user').length;
}

/**
 * Estimate total tokens in conversation history.
 * Delegates to token-accounting.estimateTokens() for consistent CJK-aware counting.
 */
function estimateHistoryTokens(messages: LlmMessage[]): number {
  return messages.reduce((sum, m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + estimateTokens(text);
  }, 0);
}

/**
 * Check if compression should be triggered.
 * Accepts optional overhead for precise budget; falls back to percentage threshold.
 */
export function shouldCompress(messages: LlmMessage[], model: string, overhead?: ContextOverhead | null): boolean {
  const maxTurns = (getConfig('compressionTriggerTurns') as number) ?? 20;

  const turns = countTurns(messages);
  if (turns > maxTurns) return true;

  const budget = overhead
    ? getHistoryBudget(model, overhead.systemPromptTokens, overhead.toolSchemaTokens, overhead.maxOutputTokens)
    : getCompressionThreshold(model);

  return estimateHistoryTokens(messages) > budget;
}
