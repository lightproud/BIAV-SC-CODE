/**
 * cite.ts — @Cite mechanism for injecting BPE chunks into conversation.
 *
 * Why @Cite: The core design inversion — users search Black Pool via UI
 * (zero LLM cost), then explicitly "cite" a chunk into the conversation.
 * The LLM only sees what the user chose, never searches the repo itself.
 *
 * A CiteBlock is a special content block type (see types.ts) that the
 * ChatView renders as an attached code/config snippet with source info.
 */

import type { BPEChunk, CiteBlock } from '../../src/types';

/**
 * Convert a BPE search result chunk into a CiteBlock for injection
 * into the conversation message array.
 *
 * Why truncate: Even user-selected chunks must respect token budget.
 * A 1-2MB config chunk would blow up the context. We cap at maxChars
 * and note the truncation.
 */
export function chunkToCiteBlock(chunk: BPEChunk, maxChars: number = 3000): CiteBlock {
  let text = chunk.text;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + `\n\n[... truncated, full content at ${chunk.file}:${chunk.lineStart}-${chunk.lineEnd}]`;
  }

  return {
    type: 'cite',
    source: chunk.file,
    lineStart: chunk.lineStart,
    lineEnd: chunk.lineEnd,
    text,
  };
}

/**
 * Format a CiteBlock as a text string for injection into the LLM's
 * user message. The LLM sees this as part of the user's message,
 * formatted as a fenced code block with source attribution.
 */
export function formatCiteForLlm(cite: CiteBlock): string {
  const location = cite.lineStart
    ? `${cite.source}:${cite.lineStart}-${cite.lineEnd ?? cite.lineStart}`
    : cite.source;

  return `\`\`\`\n// @Cite: ${location}\n${cite.text}\n\`\`\``;
}
