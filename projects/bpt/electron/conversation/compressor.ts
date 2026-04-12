/**
 * compressor.ts — Conversation history compression.
 *
 * Why: Prime Directive T3 — history > 20 turns or > 60k tokens must be
 * compressed. We keep the most recent K turns verbatim and summarize
 * everything before that into a single "compressed context" block.
 *
 * Phase 0: Simple truncation (drop oldest turns). Phase 1 will use
 * an LLM call to generate a summary of dropped turns.
 */

import type { LlmMessage } from '../llm/provider';
import { getConfig } from '../core/config';

interface CompressionResult {
  messages: LlmMessage[];
  wasCompressed: boolean;
  droppedTurns: number;
}

/**
 * Compress conversation history if it exceeds configured thresholds.
 *
 * Phase 0 strategy: Keep the last `keepTurns` message pairs (user+assistant).
 * Drop everything before that. A placeholder message notes what was dropped.
 *
 * Phase 1 strategy: Use Haiku to summarize dropped turns into a condensed
 * context block that preserves key facts and decisions.
 */
export function compressHistory(messages: LlmMessage[]): CompressionResult {
  const maxTurns = (getConfig('compressionTriggerTurns') as number) ?? 20;
  const keepTurns = 10; // Keep the last 10 user+assistant pairs

  // Count turns (a turn = one user message + one assistant response)
  const turns = countTurns(messages);

  if (turns <= maxTurns) {
    return { messages, wasCompressed: false, droppedTurns: 0 };
  }

  // Find the cut point: keep the last `keepTurns * 2` messages
  const keepCount = keepTurns * 2;
  const dropCount = messages.length - keepCount;

  if (dropCount <= 0) {
    return { messages, wasCompressed: false, droppedTurns: 0 };
  }

  const droppedTurns = Math.floor(dropCount / 2);

  // Phase 0: Simple drop with placeholder
  const compressed: LlmMessage[] = [
    {
      role: 'system',
      content: `[Earlier conversation compressed: ${droppedTurns} turns omitted. ` +
        `This conversation has been ongoing — the user may reference earlier context.]`,
    },
    ...messages.slice(dropCount),
  ];

  return {
    messages: compressed,
    wasCompressed: true,
    droppedTurns,
  };
}

function countTurns(messages: LlmMessage[]): number {
  return messages.filter((m) => m.role === 'user').length;
}

/**
 * Check if compression should be triggered based on estimated token count.
 */
export function shouldCompress(messages: LlmMessage[]): boolean {
  const maxTurns = (getConfig('compressionTriggerTurns') as number) ?? 20;
  const maxTokens = (getConfig('compressionTriggerTokens') as number) ?? 60000;

  const turns = countTurns(messages);
  if (turns > maxTurns) return true;

  // Rough token estimate
  const totalChars = messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + content.length;
  }, 0);
  const estimatedTokens = totalChars / 4;

  return estimatedTokens > maxTokens;
}
