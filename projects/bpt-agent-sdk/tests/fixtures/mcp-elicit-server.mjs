#!/usr/bin/env node
/**
 * Test fixture: minimal MCP stdio server that ISSUES a server-initiated
 * `elicitation/create` request mid-tool-call (newline-delimited JSON-RPC 2.0,
 * zero dependencies). The heavier fixture the onElicitation coverage gap
 * called for (white-box batch 3).
 *
 * Behavior:
 * - initialize        -> result (capabilities: tools + elicitation)
 * - tools/list        -> one 'ask' tool
 * - tools/call ask    -> sends `elicitation/create` (id 9001) to the CLIENT,
 *                        waits for the client's reply on stdin, then answers
 *                        the original tools/call with a text result embedding
 *                        the reply: ELICITED action=<action> value=<name field>
 * - unknown method    -> JSON-RPC error -32601
 */

import process from 'node:process';

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

let pendingCall = null; // { id } of the tools/call awaiting the elicitation reply

function handle(msg) {
  const { id, method, params } = msg;

  // The client's response to OUR elicitation/create request: it carries our
  // request id (9001) and a result, no method.
  if (method === undefined && id === 9001) {
    const action = msg.result?.action ?? 'missing';
    const value = msg.result?.content?.name ?? '';
    if (pendingCall !== null) {
      send({
        jsonrpc: '2.0',
        id: pendingCall.id,
        result: {
          content: [{ type: 'text', text: `ELICITED action=${action} value=${value}` }],
        },
      });
      pendingCall = null;
    }
    return;
  }

  if (id === undefined || id === null) return; // notifications

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion:
          typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {}, elicitation: {} },
        serverInfo: { name: 'elicit-fixture', version: '1.0.0' },
      },
    });
    return;
  }

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'ask',
            description: 'Asks the host a question via elicitation before answering',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    });
    return;
  }

  if (method === 'tools/call' && params?.name === 'ask') {
    pendingCall = { id };
    send({
      jsonrpc: '2.0',
      id: 9001,
      method: 'elicitation/create',
      params: {
        message: 'What is your name?',
        requestedSchema: {
          type: 'object',
          properties: { name: { type: 'string', description: 'your name' } },
          required: ['name'],
        },
      },
    });
    return;
  }

  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${String(method)}` } });
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line.length === 0) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      // ignore malformed lines
    }
  }
});
process.stdin.on('end', () => process.exit(0));
