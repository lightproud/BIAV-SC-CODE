/**
 * openai.ts — OpenAI-compatible API adapter implementing LlmProvider.
 *
 * Why: The company gateway exposes an OpenAI-compatible endpoint. Many Chinese
 * LLM providers (DeepSeek, Qwen, GLM) also use OpenAI-compatible APIs.
 * This adapter handles the differences from the Anthropic SDK:
 * - Different streaming format (SSE with data: lines)
 * - Different tool_use format (function calling)
 * - No cache_control (silently ignored)
 * - Different usage reporting fields
 */

import type { LlmProvider, LlmRequestConfig, LlmStreamEvent, LlmMessage, LlmContentBlock } from './provider';
import type { ToolDescriptor, TokenUsage } from '../../src/types';
import { logger } from '../core/logger';

export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  private baseUrl: string;
  private apiKey: string;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  async stream(
    config: LlmRequestConfig,
    onEvent: (event: LlmStreamEvent) => void,
  ): Promise<void> {
    this.abortController = new AbortController();

    try {
      const tools = config.tools.map((t) => this.toOpenAiTool(t));
      const messages = this.buildMessages(config.systemPrompt, config.messages);

      const body: Record<string, unknown> = {
        model: config.model,
        messages,
        max_tokens: config.maxTokens,
        stream: true,
      };

      if (tools.length > 0) {
        body.tools = tools;
      }

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalOutputTokens = 0;
      let totalInputTokens = 0;

      // Track function call state
      let currentToolCallId = '';
      let currentToolCallName = '';
      let toolCallArgs = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          let chunk: Record<string, unknown>;
          try {
            chunk = JSON.parse(data) as Record<string, unknown>;
          } catch {
            continue;
          }

          const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
          if (!choices || choices.length === 0) continue;

          const delta = choices[0].delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            onEvent({ type: 'text_delta', text: delta.content as string });
          }

          // Tool calls (OpenAI function calling format)
          const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
          if (toolCalls) {
            for (const tc of toolCalls) {
              const fn = tc.function as Record<string, unknown> | undefined;
              if (!fn) continue;

              if (fn.name) {
                // New tool call starting
                if (currentToolCallId) {
                  // End previous tool call
                  onEvent({ type: 'tool_use_end' });
                }
                currentToolCallId = (tc.id as string) || `tool_${Date.now()}`;
                currentToolCallName = fn.name as string;
                toolCallArgs = '';
                onEvent({ type: 'tool_use_start', id: currentToolCallId, name: currentToolCallName });
              }

              if (fn.arguments) {
                toolCallArgs += fn.arguments as string;
                onEvent({ type: 'tool_use_delta', text: fn.arguments as string });
              }
            }
          }

          // Check finish reason
          const finishReason = choices[0].finish_reason as string | null;
          if (finishReason) {
            if (currentToolCallId) {
              onEvent({ type: 'tool_use_end' });
              currentToolCallId = '';
            }
          }

          // Usage info (only in final chunk for some providers)
          const usage = chunk.usage as Record<string, number> | undefined;
          if (usage) {
            totalInputTokens = usage.prompt_tokens ?? totalInputTokens;
            totalOutputTokens = usage.completion_tokens ?? totalOutputTokens;
          }
        }
      }

      // Send message_end with usage
      onEvent({
        type: 'message_end',
        usage: {
          system: 0,
          tools: 0,
          history: 0,
          generation: totalOutputTokens,
          cacheHit: 0,
          cacheWrite: 0,
          estimatedCostUsd: this.estimateCost(totalInputTokens, totalOutputTokens),
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        logger.info('openai', 'Request aborted by user');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error('openai', 'Stream error', { error: message });
      onEvent({ type: 'error', error: message });
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    this.abortController?.abort();
  }

  private toOpenAiTool(tool: ToolDescriptor): Record<string, unknown> {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    };
  }

  private buildMessages(
    systemPrompt: string,
    messages: LlmMessage[],
  ): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }

      // Convert content blocks to OpenAI format
      const blocks = msg.content as LlmContentBlock[];
      if (blocks.length === 1 && blocks[0].type === 'text') {
        result.push({ role: msg.role, content: blocks[0].text });
        continue;
      }

      // Handle tool_result blocks — convert to OpenAI tool message format
      const toolResults = blocks.filter((b) => b.type === 'tool_result');
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          if (tr.type === 'tool_result') {
            result.push({
              role: 'tool',
              tool_call_id: tr.tool_use_id,
              content: tr.content,
            });
          }
        }
        continue;
      }

      // Handle assistant messages with tool calls
      const textParts = blocks.filter((b) => b.type === 'text');
      const toolUseParts = blocks.filter((b) => b.type === 'tool_use');

      const assistantMsg: Record<string, unknown> = {
        role: msg.role,
        content: textParts.length > 0
          ? textParts.map((t) => t.type === 'text' ? t.text : '').join('')
          : null,
      };

      if (toolUseParts.length > 0) {
        assistantMsg.tool_calls = toolUseParts.map((tc) => {
          if (tc.type !== 'tool_use') return {};
          return {
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          };
        });
      }

      result.push(assistantMsg);
    }

    return result;
  }

  /**
   * Rough cost estimation for OpenAI-compatible models.
   * Default to GPT-4o-mini pricing; actual cost depends on the model.
   */
  private estimateCost(input: number, output: number): number {
    const inputPrice = 0.15;   // $0.15/M input (GPT-4o-mini)
    const outputPrice = 0.60;  // $0.60/M output
    const M = 1_000_000;
    return (input / M) * inputPrice + (output / M) * outputPrice;
  }
}
