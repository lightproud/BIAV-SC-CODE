#!/usr/bin/env node
/**
 * Test fixture: minimal MCP stdio server speaking newline-delimited JSON-RPC
 * 2.0 on stdin/stdout. Plain node script, zero dependencies.
 *
 * Behavior:
 * - initialize            -> result { protocolVersion, capabilities, serverInfo }
 * - notifications/*       -> no response (notifications carry no id)
 * - tools/list            -> cursor pagination: page 1 (echo, pid) with
 *                            nextCursor, page 2 (marker, boom) without
 * - tools/call echo       -> { content: [{ type:'text', text: <args JSON> }] }
 * - tools/call pid        -> text = this process's pid (for kill assertions)
 * - tools/call marker     -> text = process.env.MCP_TEST_MARKER (env tests)
 * - tools/call boom       -> JSON-RPC error (client must convert to isError)
 * - unknown method        -> JSON-RPC error -32601 Method not found
 */

import process from 'node:process';

const PAGE_1 = {
  tools: [
    {
      name: 'echo',
      description: 'Echo the call arguments back as JSON text',
      inputSchema: { type: 'object', properties: { payload: { type: 'string' } } },
    },
    {
      name: 'pid',
      description: 'Report the fixture process id',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  nextCursor: 'cursor-page-2',
};

const PAGE_2 = {
  tools: [
    {
      name: 'marker',
      description: 'Report the MCP_TEST_MARKER environment variable',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'boom',
      description: 'Always answers with a JSON-RPC error',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
};

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function handle(msg) {
  const { id, method, params } = msg;
  // Notifications (no id) never get a response.
  if (id === undefined || id === null) return;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion:
          typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'echo-fixture', version: '9.9.9' },
      },
    });
    return;
  }

  if (method === 'tools/list') {
    const cursor = params?.cursor;
    if (cursor === undefined) {
      send({ jsonrpc: '2.0', id, result: PAGE_1 });
    } else if (cursor === 'cursor-page-2') {
      send({ jsonrpc: '2.0', id, result: PAGE_2 });
    } else {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `unknown cursor ${String(cursor)}` },
      });
    }
    return;
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (name === 'echo') {
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(args) }] },
      });
      return;
    }
    if (name === 'pid') {
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: String(process.pid) }] },
      });
      return;
    }
    if (name === 'marker') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: String(process.env.MCP_TEST_MARKER ?? '(unset)') }],
        },
      });
      return;
    }
    if (name === 'boom') {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: 'boom exploded as designed' },
      });
      return;
    }
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: `unknown tool ${String(name)}` },
    });
    return;
  }

  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
