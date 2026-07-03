/**
 * Basic usage: one string prompt, print assistant text and the final result.
 *
 * Run:  ANTHROPIC_API_KEY=... npx tsx examples/basic.ts
 */

import { query } from '../src/index.js';

const q = query({
  prompt:
    'List the files in the current directory and summarize what this project is in two sentences.',
  options: {
    maxTurns: 10,
  },
});

for await (const message of q) {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') process.stdout.write(`${block.text}\n`);
    }
  } else if (message.type === 'result') {
    process.stdout.write(
      `\n[result] subtype=${message.subtype} turns=${message.num_turns} ` +
        `cost=$${message.total_cost_usd.toFixed(4)}\n`,
    );
  }
}
