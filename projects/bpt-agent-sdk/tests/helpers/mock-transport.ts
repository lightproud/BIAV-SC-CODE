/**
 * Test helper: scripted Transport double.
 *
 * Feed it one RawMessageStreamEvent[] per expected stream() call; it replays
 * them in order and records every StreamRequest it receives.
 */

import type {
  StreamRequest,
  Transport,
} from '../../src/internal/contracts.js';
import type {
  APIAssistantMessage,
  ApiKeySource,
  ContentBlock,
  RawMessageStreamEvent,
  StopReason,
  Usage,
} from '../../src/types.js';
import { AbortError } from '../../src/errors.js';

export class MockTransport implements Transport {
  readonly requests: StreamRequest[] = [];
  private calls = 0;

  constructor(
    private readonly scripts: Array<
      RawMessageStreamEvent[] | (() => RawMessageStreamEvent[])
    >,
    private readonly source: ApiKeySource = 'user',
  ) {}

  apiKeySource(): ApiKeySource {
    return this.source;
  }

  async *stream(req: StreamRequest): AsyncGenerator<RawMessageStreamEvent, void> {
    this.requests.push(req);
    const idx = this.calls++;
    const script = this.scripts[idx];
    if (!script) {
      throw new Error(`MockTransport: unexpected stream() call #${idx + 1}`);
    }
    const events = typeof script === 'function' ? script() : script;
    for (const ev of events) {
      if (req.signal?.aborted) throw new AbortError();
      yield ev;
    }
  }
}

/** Build the standard event sequence for a plain-text assistant reply. */
export function textReplyEvents(
  text: string,
  opts: { model?: string; usage?: Partial<Usage>; stopReason?: StopReason } = {},
): RawMessageStreamEvent[] {
  const model = opts.model ?? 'claude-test-1';
  return [
    {
      type: 'message_start',
      message: baseMessage(model, [], opts.usage),
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: opts.stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: 7 },
    },
    { type: 'message_stop' },
  ];
}

/** Build the event sequence for a reply containing one tool_use block. */
export function toolUseReplyEvents(
  toolName: string,
  input: Record<string, unknown>,
  opts: { id?: string; model?: string; leadingText?: string } = {},
): RawMessageStreamEvent[] {
  const model = opts.model ?? 'claude-test-1';
  const id = opts.id ?? 'toolu_mock_1';
  const events: RawMessageStreamEvent[] = [
    { type: 'message_start', message: baseMessage(model, []) },
  ];
  let index = 0;
  if (opts.leadingText !== undefined) {
    events.push(
      { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index, delta: { type: 'text_delta', text: opts.leadingText } },
      { type: 'content_block_stop', index },
    );
    index += 1;
  }
  const json = JSON.stringify(input);
  events.push(
    {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id, name: toolName, input: {} },
    },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(0, Math.ceil(json.length / 2)) } },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(Math.ceil(json.length / 2)) } },
    { type: 'content_block_stop', index },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 11 },
    },
    { type: 'message_stop' },
  );
  return events;
}

function baseMessage(
  model: string,
  content: ContentBlock[],
  usage?: Partial<Usage>,
): APIAssistantMessage {
  return {
    id: `msg_mock_${Math.floor(Math.random() * 1e9)}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: usage?.input_tokens ?? 25,
      output_tokens: usage?.output_tokens ?? 0,
      cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
    },
  };
}
