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

/**
 * Per-model pricing from https://docs.anthropic.com/en/docs/about-claude/pricing
 * Prices are per million tokens. Cache hit = 0.1x base input, cache write (5min) = 1.25x base input.
 */
interface ModelPricing {
  input: number;
  output: number;
  cacheHit: number;
  cacheWrite: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Opus 4.6
  'claude-opus-4-6':            { input: 5,  output: 25, cacheHit: 0.50, cacheWrite: 6.25 },
  // Opus 4.5
  'claude-opus-4-5':            { input: 5,  output: 25, cacheHit: 0.50, cacheWrite: 6.25 },
  'claude-opus-4-5-20251101':   { input: 5,  output: 25, cacheHit: 0.50, cacheWrite: 6.25 },
  // Sonnet 4.6
  'claude-sonnet-4-6':          { input: 3,  output: 15, cacheHit: 0.30, cacheWrite: 3.75 },
  // Sonnet 4.5
  'claude-sonnet-4-5':          { input: 3,  output: 15, cacheHit: 0.30, cacheWrite: 3.75 },
  'claude-sonnet-4-5-20250929': { input: 3,  output: 15, cacheHit: 0.30, cacheWrite: 3.75 },
  // Sonnet 4
  'claude-sonnet-4-20250514':   { input: 3,  output: 15, cacheHit: 0.30, cacheWrite: 3.75 },
  // Haiku 4.5
  'claude-haiku-4-5':           { input: 1,  output: 5,  cacheHit: 0.10, cacheWrite: 1.25 },
  'claude-haiku-4-5-20251001':  { input: 1,  output: 5,  cacheHit: 0.10, cacheWrite: 1.25 },
  // Haiku 3.5
  'claude-3-5-haiku-20241022':  { input: 0.8, output: 4, cacheHit: 0.08, cacheWrite: 1.00 },
};

// Default to Sonnet 4.6 pricing for unknown models
const DEFAULT_PRICING: ModelPricing = { input: 3, output: 15, cacheHit: 0.30, cacheWrite: 3.75 };

export class ClaudeProvider implements LlmProvider {
  readonly name = 'claude';
  private client: Anthropic;
  private abortController: AbortController | null = null;
  private currentModel = '';

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
    this.currentModel = config.model;

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

      // Track input-side usage from message_start (input_tokens, cache metrics).
      // Output-side usage comes from message_delta.
      let inputTokens = 0;
      let cacheHit = 0;
      let cacheWrite = 0;

      for await (const event of stream) {
        const eventType = event.type as string;

        if (eventType === 'message_start') {
          // message_start carries the full Message object with input usage
          const msg = event.message as Record<string, unknown> | undefined;
          const msgUsage = msg?.usage as Record<string, number> | undefined;
          if (msgUsage) {
            inputTokens = msgUsage.input_tokens ?? 0;
            cacheHit = msgUsage.cache_read_input_tokens ?? 0;
            cacheWrite = msgUsage.cache_creation_input_tokens ?? 0;
          }
        } else if (eventType === 'content_block_start') {
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
          const deltaUsage = event.usage as Record<string, number> | undefined;
          if (deltaUsage) {
            const outputTokens = deltaUsage.output_tokens ?? 0;
            onEvent({
              type: 'message_end',
              usage: {
                system: 0,
                tools: 0,
                history: 0,
                generation: outputTokens,
                cacheHit,
                cacheWrite,
                estimatedCostUsd: this.estimateCost(inputTokens, outputTokens, cacheHit, cacheWrite),
              },
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

  /**
   * Model-aware cost estimation using official Anthropic pricing.
   * Looks up the current model in MODEL_PRICING; falls back to Sonnet 4.6 rates.
   */
  private estimateCost(
    input: number,
    output: number,
    cacheHit: number,
    cacheWrite: number,
  ): number {
    const p = MODEL_PRICING[this.currentModel] ?? DEFAULT_PRICING;
    const M = 1_000_000;
    const nonCachedInput = Math.max(0, input - cacheHit - cacheWrite);
    return (
      (nonCachedInput / M) * p.input +
      (output / M) * p.output +
      (cacheHit / M) * p.cacheHit +
      (cacheWrite / M) * p.cacheWrite
    );
  }
}
