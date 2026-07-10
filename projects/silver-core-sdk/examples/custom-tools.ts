/**
 * Custom tools via an in-process SDK MCP server.
 *
 * Run:  ANTHROPIC_API_KEY=... npx tsx examples/custom-tools.ts
 */

import { z } from 'zod';

import { createSdkMcpServer, query, tool } from '../src/index.js';

const calculator = createSdkMcpServer({
  name: 'calc',
  version: '1.0.0',
  tools: [
    tool(
      'add',
      'Add two numbers and return the sum.',
      { a: z.number(), b: z.number() },
      async (args) => ({
        content: [{ type: 'text', text: String(args.a + args.b) }],
      }),
    ),
  ],
});

const q = query({
  prompt: 'Use the add tool to compute 20 + 22, then state the result.',
  options: {
    mcpServers: { calc: calculator },
    allowedTools: ['mcp__calc__add'],
    maxTurns: 4,
  },
});

for await (const message of q) {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') process.stdout.write(`${block.text}\n`);
      if (block.type === 'tool_use') {
        process.stdout.write(
          `[tool_use] ${block.name} ${JSON.stringify(block.input)}\n`,
        );
      }
    }
  } else if (message.type === 'result') {
    process.stdout.write(`\n[result] subtype=${message.subtype}\n`);
  }
}
