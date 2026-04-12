/**
 * claude.ts — Anthropic SDK adapter implementing LlmProvider.
 *
 * Why Anthropic SDK directly: We need cache_control support for token
 * economy discipline (T1 red line). The SDK's streaming API gives us
 * per-event usage metrics which feed the 6-dimensional token meter.
 *
 * Why baseUrl is configurable: The company gateway is OpenAI-compatible
 * but may also proxy Anthropic API. We let users point baseUrl at either
 * the official API or their gateway.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, LlmRequestConfig, LlmStreamEvent, LlmMessage, LlmContentBlock } from './provider';
import type { ToolDescriptor, TokenUsage } from '../../src/types';
import { logger } from '../core/logger';

export class ClaudeProvider implements LlmProvider {
  readonly name = 'claude';
  private client: Anthropic;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string, apiKey: string) {
    this.client = new Anthropic({
      apiKey,
      baseURL: baseUrl || undefined,
    });
  }

  async stream(
    config: LlmRequestConfig,
    onEvent: (event: LlmStreamEvent) => void,
  ): Promise<void> {
    this.abortController = new AbortController();

    try {
      const tools = config.tools.map((t) => this.toAnthropicTool(t, config.cacheControl));
      const messages = config.messages.map((m) => this.toAnthropicMessage(m));

      // Build system prompt with cache_control if enabled
      const system = config.cacheControl
        ? [{ type: 'text' as const, text: config.systemPrompt, cache_control: { type: 'ephemeral' as const } }]
        : config.systemPrompt;

      const streamParams: Record<string, unknown> = {
        model: config.model,
        max_tokens: config.maxTokens,
        system,
        messages,
        stream: true,
      };

      if (tools.length > 0) {
        streamParams.tools = tools;
      }

      const response = await this.client.messages.create(
        streamParams as Anthropic.MessageCreateParams,
        { signal: this.abortController.signal },
      );

      // Handle streaming response
      // The SDK returns an async iterable for stream: true
      const stream = response as unknown as AsyncIterable<Record<string, unknown>>;

      let currentToolId = '';
      let currentToolName = '';
      let toolInputJson = '';

      for await (const event of stream) {
        const eventType = event.type as string;

        if (eventType === 'content_block_start') {
          const block = event.content_block as Record<string, unknown>;
          if (block.type === 'tool_use') {
            currentToolId = block.id as string;
            currentToolName = block.name as string;
            toolInputJson = '';
            onEvent({ type: 'tool_use_start', id: currentToolId, name: currentToolName });
          }
        } else if (eventType === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown>;
          if (delta.type === 'text_delta') {
            onEvent({ type: 'text_delta', text: delta.text as string });
          } else if (delta.type === 'input_json_delta') {
            toolInputJson += delta.partial_json as string;
            onEvent({ type: 'tool_use_delta', text: delta.partial_json as string });
          }
        } else if (eventType === 'content_block_stop') {
          if (currentToolId) {
            onEvent({ type: 'tool_use_end' });
            currentToolId = '';
          }
        } else if (eventType === 'message_delta') {
          const usage = event.usage as Record<string, number> | undefined;
          if (usage) {
            onEvent({
              type: 'message_end',
              usage: this.extractUsage(usage, event),
            });
          }
        } else if (eventType === 'message_stop') {
          // Final event — no additional data needed
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        logger.info('claude', 'Request aborted by user');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error('claude', 'Stream error', { error: message });
      onEvent({ type: 'error', error: message });
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private toAnthropicTool(
    tool: ToolDescriptor,
    cacheControl: boolean,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    };
    // Mark the LAST tool with cache_control so that the entire tools array
    // (which is prefix-matched) gets cached.
    if (cacheControl) {
      result.cache_control = { type: 'ephemeral' };
    }
    return result;
  }

  /**
   * Convert LlmMessage (camelCase) to Anthropic API format (snake_case).
   */
  private toAnthropicMessage(msg: LlmMessage): Record<string, unknown> {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }
    return {
      role: msg.role,
      content: msg.content.map((block: LlmContentBlock) => {
        if (block.type === 'tool_result') {
          return {
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: block.content,
            is_error: block.isError ?? false,
          };
        }
        return block;
      }),
    };
  }

  private extractUsage(
    usage: Record<string, number>,
    event: Record<string, unknown>,
  ): TokenUsage {
    // Anthropic returns: input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
    const msgUsage = (event.message as Record<string, unknown>)?.usage as Record<string, number> | undefined;
    const inputTokens = msgUsage?.input_tokens ?? 0;
    const cacheHit = msgUsage?.cache_read_input_tokens ?? 0;
    const cacheWrite = msgUsage?.cache_creation_input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;

    return {
      system: 0,       // We can't separate system from total input in the API response
      tools: 0,        // Same — these are approximations computed by token-accounting.ts
      history: 0,
      generation: outputTokens,
      cacheHit,
      cacheWrite,
      estimatedCostUsd: this.estimateCost(inputTokens, outputTokens, cacheHit, cacheWrite),
    };
  }

  /**
   * Rough cost estimation. Prices are per-million-tokens.
   * These should be configurable per-model; for now hardcode Sonnet 4 prices.
   */
  private estimateCost(
    input: number,
    output: number,
    cacheHit: number,
    cacheWrite: number,
  ): number {
    const inputPrice = 3.0;     // $3/M input
    const outputPrice = 15.0;   // $15/M output
    const cacheHitPrice = 0.3;  // $0.30/M cache read
    const cacheWritePrice = 3.75; // $3.75/M cache write

    const M = 1_000_000;
    const nonCachedInput = Math.max(0, input - cacheHit - cacheWrite);
    return (
      (nonCachedInput / M) * inputPrice +
      (output / M) * outputPrice +
      (cacheHit / M) * cacheHitPrice +
      (cacheWrite / M) * cacheWritePrice
    );
  }
}
