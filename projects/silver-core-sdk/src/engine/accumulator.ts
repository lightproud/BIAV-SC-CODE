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
  | { type: 'text'; text: string; citations?: unknown[] }
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
    }
  // Finding M1 — forward-compatibility: a block type this accumulator does not
  // model (e.g. server_tool_use / web_search_tool_result, or any future type)
  // is kept VERBATIM instead of leaving its index unregistered, which made the
  // block's first content_block_delta throw "delta for unopened block index"
  // and kill an otherwise-healthy turn. Deltas on an opaque block are ignored;
  // the raw block round-trips into the finalized message.
  | { type: 'opaque'; raw: ContentBlock };

export class MessageAccumulator {
  private message: APIAssistantMessage | undefined;
  private readonly blocks = new Map<number, PendingBlock>();
  /** Indices whose content_block_stop arrived (E3 salvage: closed = whole). */
  private readonly closedIndices = new Set<number>();

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
          default:
            // Finding M1 — unmodeled block type: register it opaquely so its
            // later deltas do not throw, and it survives into the message.
            this.blocks.set(event.index, { type: 'opaque', raw: cb as ContentBlock });
            return;
        }
      }

      case 'content_block_delta': {
        const block = this.blocks.get(event.index);
        if (block === undefined) {
          throw new APIConnectionError(
            `Protocol error: content_block_delta for unopened block index ${event.index}`,
          );
        }
        // Finding M1 — deltas targeting an opaque (unmodeled) block are ignored
        // rather than mismatched against a known delta type.
        if (block.type === 'opaque') return;
        const delta = event.delta;
        // S2 (BPT audit 2026-07-07): citations arrive as their own delta type
        // (not in the typed union) and must be collected onto the text block
        // instead of silently dropped. Handled before the typed switch.
        if ((delta as { type?: string }).type === 'citations_delta') {
          if (block.type === 'text') {
            const citation = (delta as { citation?: unknown }).citation;
            if (citation !== undefined) {
              (block.citations ??= []).push(citation);
            }
          }
          return;
        }
        switch (delta.type) {
          case 'text_delta':
            if (block.type !== 'text') {
              throw this.mismatch(event.index, block.type, delta.type);
            }
            // S3 (BPT audit 2026-07-07): a field-omitting / gateway-rewritten
            // frame must be a no-op append, not `+= undefined` (which writes the
            // literal "undefined"). The same guard as input_json_delta below.
            block.text += delta.text ?? '';
            return;
          case 'thinking_delta':
            if (block.type !== 'thinking') {
              throw this.mismatch(event.index, block.type, delta.type);
            }
            block.thinking += delta.thinking ?? '';
            return;
          case 'signature_delta':
            if (block.type !== 'thinking') {
              throw this.mismatch(event.index, block.type, delta.type);
            }
            // A missing signature here is the WORST case: `+= undefined` poisons
            // the thinking block's signature and the API 400s "Invalid signature"
            // on every subsequent replay — the wedged conversation this guards.
            block.signature += delta.signature ?? '';
            return;
          case 'input_json_delta':
            if (block.type !== 'tool_use') {
              throw this.mismatch(event.index, block.type, delta.type);
            }
            // S3 (BPT audit 2026-07-07): a non-conformant / gateway-rewritten
            // frame may omit partial_json; `+= undefined` would append the
            // literal "undefined" and poison the buffer (JSON.parse then throws).
            block.partialJson += delta.partial_json ?? '';
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
        this.closedIndices.add(event.index);
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
          content.push({
              type: 'text',
              text: block.text,
              ...(block.citations !== undefined ? { citations: block.citations } : {}),
            });
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
        case 'opaque':
          // Finding M1 — round-trip the unmodeled block verbatim.
          content.push(block.raw);
          break;
      }
    }
    msg.content = content;
    return msg;
  }

  /**
   * Salvage pass for a TRUNCATED stream (E3): build an assistant message from
   * what the connection delivered WHOLE before dropping. Kept: closed blocks
   * of every type; text blocks even when unclosed (the received prefix is the
   * honest partial answer - the official arm surfaces it too). Dropped:
   * unclosed tool_use (a mid-transmission input must never execute) and
   * unclosed thinking (an incomplete signature would 400 any resend).
   * Returns undefined when message_start never arrived or nothing whole
   * remains - the caller then falls back to the error path.
   */
  salvageTruncated(): APIAssistantMessage | undefined {
    if (this.message === undefined) {
      return undefined;
    }
    const indices = [...this.blocks.keys()].sort((a, b) => a - b);
    const content: ContentBlock[] = [];
    for (const index of indices) {
      const block = this.blocks.get(index) as PendingBlock;
      const closed = this.closedIndices.has(index);
      switch (block.type) {
        case 'text':
          if (block.text.length > 0) {
            content.push({
              type: 'text',
              text: block.text,
              ...(block.citations !== undefined ? { citations: block.citations } : {}),
            });
          }
          break;
        case 'thinking':
          if (closed) {
            content.push({
              type: 'thinking',
              thinking: block.thinking,
              signature: block.signature,
            });
          }
          break;
        case 'redacted_thinking':
          // Delivered whole in content_block_start; safe either way.
          content.push({ type: 'redacted_thinking', data: block.data });
          break;
        case 'tool_use':
          if (closed && block.input !== undefined) {
            content.push({
              type: 'tool_use',
              id: block.id,
              name: block.name,
              input: block.input,
            });
          }
          break;
        case 'opaque':
          // Finding M1 — keep an unmodeled block only if it arrived WHOLE
          // (content_block_stop seen), mirroring the closed-block salvage rule.
          if (closed) content.push(block.raw);
          break;
      }
    }
    if (content.length === 0) {
      return undefined;
    }
    const msg = this.message;
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
