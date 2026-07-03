/**
 * MessageAccumulator: folds raw Messages API stream events into the final
 * APIAssistantMessage. One accumulator instance per stream attempt.
 */

import { APIConnectionError } from '../errors.js';
import type {
  APIAssistantMessage,
  ContentBlock,
  RawMessageStreamEvent,
} from '../types.js';

/** In-progress content block state, keyed by stream index. */
type PendingBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      /** Input seeded by content_block_start (usually {}). */
      initialInput: Record<string, unknown>;
      /** Concatenated input_json_delta fragments. */
      partialJson: string;
      /** Parsed final input, set at content_block_stop. */
      input?: Record<string, unknown>;
    };

export class MessageAccumulator {
  private message: APIAssistantMessage | undefined;
  private readonly blocks = new Map<number, PendingBlock>();

  /** Feed one raw stream event; call in arrival order. */
  feed(event: RawMessageStreamEvent): void {
    switch (event.type) {
      case 'message_start':
        // Seed id/model/usage; content is rebuilt from block events.
        this.message = {
          ...event.message,
          content: [],
          usage: { ...event.message.usage },
        };
        return;

      case 'content_block_start': {
        this.requireMessage('content_block_start');
        const cb = event.content_block;
        switch (cb.type) {
          case 'text':
            this.blocks.set(event.index, { type: 'text', text: cb.text });
            return;
          case 'thinking':
            this.blocks.set(event.index, {
              type: 'thinking',
              thinking: cb.thinking,
              signature: cb.signature ?? '',
            });
            return;
          case 'redacted_thinking':
            this.blocks.set(event.index, {
              type: 'redacted_thinking',
              data: cb.data,
            });
            return;
          case 'tool_use':
            this.blocks.set(event.index, {
              type: 'tool_use',
              id: cb.id,
              name: cb.name,
              initialInput: cb.input ?? {},
              partialJson: '',
            });
            return;
        }
        return;
      }

      case 'content_block_delta': {
        const block = this.blocks.get(event.index);
        if (block === undefined) {
          throw new APIConnectionError(
            `Protocol error: content_block_delta for unopened block index ${event.index}`,
          );
        }
        const delta = event.delta;
        switch (delta.type) {
          case 'text_delta':
            if (block.type !== 'text') {
              throw this.mismatch(event.index, block.type, delta.type);
            }
            block.text += delta.text;
            return;
          case 'thinking_delta':
            if (block.type !== 'thinking') {
              throw this.mismatch(event.index, block.type, delta.type);
            }
            block.thinking += delta.thinking;
            return;
          case 'signature_delta':
            if (block.type !== 'thinking') {
              throw this.mismatch(event.index, block.type, delta.type);
            }
            block.signature += delta.signature;
            return;
          case 'input_json_delta':
            if (block.type !== 'tool_use') {
              throw this.mismatch(event.index, block.type, delta.type);
            }
            block.partialJson += delta.partial_json;
            return;
        }
        return;
      }

      case 'content_block_stop': {
        const block = this.blocks.get(event.index);
        if (block === undefined) {
          throw new APIConnectionError(
            `Protocol error: content_block_stop for unopened block index ${event.index}`,
          );
        }
        if (block.type === 'tool_use') {
          block.input = this.parseToolInput(event.index, block);
        }
        return;
      }

      case 'message_delta': {
        const msg = this.requireMessage('message_delta');
        msg.stop_reason = event.delta.stop_reason;
        msg.stop_sequence = event.delta.stop_sequence;
        // Usage merge: output_tokens replace; input-side fields keep max
        // (the API may re-report cumulative input counts).
        const u = msg.usage;
        const du = event.usage as Partial<{
          output_tokens: number;
          input_tokens: number;
          cache_creation_input_tokens: number | null;
          cache_read_input_tokens: number | null;
        }>;
        if (du.output_tokens !== undefined) {
          u.output_tokens = du.output_tokens;
        }
        if (du.input_tokens !== undefined && du.input_tokens !== null) {
          u.input_tokens = Math.max(u.input_tokens ?? 0, du.input_tokens);
        }
        if (
          du.cache_creation_input_tokens !== undefined &&
          du.cache_creation_input_tokens !== null
        ) {
          u.cache_creation_input_tokens = Math.max(
            u.cache_creation_input_tokens ?? 0,
            du.cache_creation_input_tokens,
          );
        }
        if (
          du.cache_read_input_tokens !== undefined &&
          du.cache_read_input_tokens !== null
        ) {
          u.cache_read_input_tokens = Math.max(
            u.cache_read_input_tokens ?? 0,
            du.cache_read_input_tokens,
          );
        }
        return;
      }

      case 'message_stop':
      case 'ping':
      case 'error':
        // message_stop needs no bookkeeping; ping is a keepalive; error
        // payloads are surfaced by the transport, never fed here.
        return;
    }
  }

  /** Produce the final assistant message after the stream ends. */
  finalize(): APIAssistantMessage {
    const msg = this.requireMessage('finalize');
    const indices = [...this.blocks.keys()].sort((a, b) => a - b);
    const content: ContentBlock[] = [];
    for (const index of indices) {
      const block = this.blocks.get(index) as PendingBlock;
      switch (block.type) {
        case 'text':
          content.push({ type: 'text', text: block.text });
          break;
        case 'thinking':
          content.push({
            type: 'thinking',
            thinking: block.thinking,
            signature: block.signature,
          });
          break;
        case 'redacted_thinking':
          content.push({ type: 'redacted_thinking', data: block.data });
          break;
        case 'tool_use':
          content.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            // Missing content_block_stop (truncated stream): parse whatever
            // JSON accumulated so far rather than dropping the block.
            input: block.input ?? this.parseToolInput(index, block),
          });
          break;
      }
    }
    msg.content = content;
    return msg;
  }

  private parseToolInput(
    index: number,
    block: Extract<PendingBlock, { type: 'tool_use' }>,
  ): Record<string, unknown> {
    if (block.partialJson === '') {
      // No deltas at all: keep whatever content_block_start seeded ({}).
      return block.initialInput;
    }
    try {
      return JSON.parse(block.partialJson) as Record<string, unknown>;
    } catch (err) {
      const snippet = block.partialJson.slice(0, 200);
      throw new APIConnectionError(
        `Failed to parse tool_use input JSON for tool "${block.name}" (block ${index}): ${snippet}`,
        err,
      );
    }
  }

  private requireMessage(context: string): APIAssistantMessage {
    if (this.message === undefined) {
      throw new APIConnectionError(
        `Protocol error: ${context} before message_start`,
      );
    }
    return this.message;
  }

  private mismatch(index: number, blockType: string, deltaType: string): APIConnectionError {
    return new APIConnectionError(
      `Protocol error: ${deltaType} for ${blockType} block at index ${index}`,
    );
  }
}
