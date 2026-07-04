/**
 * Tokenizer-free token estimator.
 *
 * A heuristic, offline approximation of Messages API token counts used solely
 * to size context-compaction thresholds. It ships no external tokenizer and
 * makes no network call. Every constant below is an APPROXIMATION, documented
 * as such, in the same spirit as the estimate-only pricing table.
 *
 * Basis: Anthropic's public rule-of-thumb of ~4 characters per token for
 * English text. CJK scripts (Han / Hiragana / Katakana / Hangul) tokenize far
 * denser — roughly ~1 token per codepoint — so a flat 4-chars/token badly
 * undercounts Chinese/Japanese/Korean text (the primary workload of this
 * project). The estimator is therefore language-aware: it charges CJK
 * codepoints ~1 token each and other characters ~len/4. Remaining code /
 * base64 drift is absorbed by the compaction layer's conservative trigger
 * ratio and reserved-output margin (see engine/compaction.ts).
 */

import type {
  APIMessageParam,
  APIToolDefinition,
  ContentBlockParam,
} from '../types.js';

/** Rough characters-per-token for non-CJK (Latin/code) text. */
const CHARS_PER_TOKEN = 4;

/**
 * Whether a Unicode codepoint belongs to a dense CJK script that tokenizes at
 * roughly ~1 token per codepoint (rather than ~4 chars/token). Covers Han
 * (incl. extensions + compatibility), Hiragana, Katakana, and Hangul.
 */
function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0x3040 && cp <= 0x30ff) || // Hiragana + Katakana
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ideographs Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xff66 && cp <= 0xff9d) || // Halfwidth Katakana
    (cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
    (cp >= 0x3130 && cp <= 0x318f) || // Hangul Compatibility Jamo
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0x20000 && cp <= 0x3ffff) // CJK Unified Ideographs Ext B+ (astral)
  );
}
/** Structural framing charged per content block (type tag, delimiters). */
const PER_BLOCK_OVERHEAD_TOKENS = 3;
/** Structural framing charged per message (role + message envelope). */
const PER_MESSAGE_OVERHEAD_TOKENS = 8;
/**
 * Flat cost charged per image block. base64 payload length is NOT proportional
 * to the visual tokens the model bills, so images use a flat estimate.
 */
const IMAGE_TOKENS = 1600;

/**
 * Estimate tokens for a raw text string. Language-aware: CJK codepoints are
 * charged ~1 token each; all other characters are charged ~len/4. Pure and
 * allocation-free (single codepoint scan).
 */
export function estimateTextTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isCjkCodePoint(cp)) {
      cjk += 1;
    } else {
      // Count UTF-16 code units for the non-CJK bucket (matches the historical
      // string.length basis for Latin text).
      other += ch.length;
    }
  }
  return cjk + Math.ceil(other / CHARS_PER_TOKEN);
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
