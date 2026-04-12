/**
 * provider.ts — LLMProvider abstraction.
 *
 * Why an abstraction: BPT must support switching models at runtime
 * (Day-0 差异化 #1: 模型自由). All LLM backends implement this interface.
 * Phase 0 ships Claude + OpenAI adapters; others are future work
 * but the interface is designed to accommodate them.
 *
 * Naming convention: All TypeScript types use camelCase.
 * Conversion to wire format (snake_case for Anthropic, etc.) happens
 * inside each adapter, not here.
 */

import type { ToolDescriptor, TokenUsage } from '../../src/types';

/** A single message in the LLM conversation format. */
export interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | LlmContentBlock[];
}

/**
 * Content blocks within a message. All fields use camelCase.
 * Adapters (claude.ts, openai.ts) convert to wire format as needed.
 */
export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

/** Events emitted during streaming. */
export type LlmStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; text: string }
  | { type: 'tool_use_end' }
  | { type: 'message_end'; usage: TokenUsage }
  | { type: 'error'; error: string };

/** Configuration for a single LLM request. */
export interface LlmRequestConfig {
  model: string;
  systemPrompt: string;
  messages: LlmMessage[];
  tools: ToolDescriptor[];
  maxTokens: number;
  /** Whether to use prompt caching (Anthropic-specific). */
  cacheControl: boolean;
}

/**
 * LLMProvider interface — all backends must implement this.
 */
export interface LlmProvider {
  readonly name: string;

  /**
   * Send a streaming request. The callback receives events as they arrive.
   * Returns when the stream is complete.
   */
  stream(
    config: LlmRequestConfig,
    onEvent: (event: LlmStreamEvent) => void,
  ): Promise<void>;

  /**
   * Abort the current streaming request, if any.
   */
  abort(): void;
}
