/**
 * Streaming-input mode: feed multiple user turns through an AsyncIterable.
 * The session keeps its history between turns, so the second question can
 * refer back to the first.
 *
 * Run:  ANTHROPIC_API_KEY=... npx tsx examples/streaming-input.ts
 */

import { query } from '../src/index.js';
import type { SDKUserMessage } from '../src/index.js';

function userTurn(text: string): SDKUserMessage {
  return {
    type: 'user',
    session_id: '', // stamped by the SDK
    parent_tool_use_id: null,
    message: { role: 'user', content: text },
  };
}

async function* turns(): AsyncGenerator<SDKUserMessage> {
  yield userTurn('Remember the number 17. Just acknowledge it briefly.');
  yield userTurn('What number did I ask you to remember? Reply with only the number.');
}

const q = query({
  prompt: turns(),
  options: { maxTurns: 4 },
});

for await (const message of q) {
  if (message.type === 'user') {
    process.stdout.write(`> user turn\n`);
  } else if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') process.stdout.write(`${block.text}\n`);
    }
  } else if (message.type === 'result') {
    process.stdout.write(`[result] subtype=${message.subtype}\n`);
  }
}
