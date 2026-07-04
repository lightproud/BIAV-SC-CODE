/**
 * Tokenizer-free token estimator.
 *
 * A heuristic, offline approximation of Messages API token counts used solely
 * to size context-compaction thresholds. It ships no external tokenizer and
 * makes no network call. Every constant below is an APPROXIMATION, documented
 * as such, in the same spirit as the estimate-only pricing table.
 *
 * Basis: Anthropic's public rule-of-thumb of ~4 characters per token for
 * English text. CJK / code / base64 drift from this; the compaction layer
 * absorbs the drift with a conservative trigger ratio and a reserved-output
 * margin (see engine/compaction.ts).
 */

import type {
  APIMessageParam,
  APIToolDefinition,
  ContentBlockParam,
} from '../types.js';

/** Rough characters-per-token for English text (Anthropic rule-of-thumb). */
const CHARS_PER_TOKEN = 4;
/** Structural framing charged per content block (type tag, delimiters). */
const PER_BLOCK_OVERHEAD_TOKENS = 3;
/** Structural framing charged per message (role + message envelope). */
const PER_MESSAGE_OVERHEAD_TOKENS = 8;
/**
 * Flat cost charged per image block. base64 payload length is NOT proportional
 * to the visual tokens the model bills, so images use a flat estimate.
 */
const IMAGE_TOKENS = 1600;

/** Estimate tokens for a raw text string (ceil of chars / 4). */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Estimate tokens for a message's content (string or block array). */
export function estimateContentTokens(
  content: string | ContentBlockParam[],
): number {
  if (typeof content === 'string') {
    return estimateTextTokens(content);
  }
  let total = 0;
  for (const block of content) {
    total += PER_BLOCK_OVERHEAD_TOKENS + estimateBlockTokens(block);
  }
  return total;
}

function estimateBlockTokens(block: ContentBlockParam): number {
  switch (block.type) {
    case 'text':
      return estimateTextTokens(block.text);
    case 'thinking':
      return estimateTextTokens(block.thinking);
    case 'redacted_thinking':
      return estimateTextTokens(block.data);
    case 'tool_use':
      return (
        estimateTextTokens(block.name) +
        estimateTextTokens(JSON.stringify(block.input))
      );
    case 'tool_result':
      return estimateToolResultTokens(block.content);
    case 'image':
      return IMAGE_TOKENS;
  }
}

function estimateToolResultTokens(
  content: import('../types.js').ToolResultBlockParam['content'],
): number {
  if (content === undefined) return 0;
  if (typeof content === 'string') {
    return estimateTextTokens(content);
  }
  let total = 0;
  for (const part of content) {
    if (part.type === 'text') {
      total += estimateTextTokens(part.text);
    } else {
      // image part
      total += IMAGE_TOKENS;
    }
  }
  return total;
}

/** Estimate tokens for one message (content + per-message overhead). */
export function estimateMessageTokens(msg: APIMessageParam): number {
  return PER_MESSAGE_OVERHEAD_TOKENS + estimateContentTokens(msg.content);
}

/** Estimate tokens for a list of messages (additive). */
export function estimateMessagesTokens(messages: APIMessageParam[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

/** Estimate tokens for the serialized tool-definition schemas. */
export function estimateToolDefsTokens(defs: APIToolDefinition[]): number {
  if (defs.length === 0) return 0;
  return Math.ceil(JSON.stringify(defs).length / CHARS_PER_TOKEN);
}
