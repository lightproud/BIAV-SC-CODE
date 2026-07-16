#!/usr/bin/env node
/**
 * Test fixture: minimal streamable-HTTP MCP server using node:http only.
 * Replies application/json JSON-RPC 2.0 bodies to POSTed requests.
 *
 * Behavior:
 * - initialize    -> 200 JSON result + response header Mcp-Session-Id so the
 *                    client must echo it on every subsequent request
 * - notification  -> 202 Accepted, empty body
 * - tools/list    -> one 'ping' tool
 * - tools/call ping -> text result echoing back the request headers the
 *                    fixture saw (mcp-session-id, mcp-protocol-version) plus
 *                    the call arguments, so tests can assert client behavior
 * - unknown method -> JSON-RPC error -32601
 *
 * Prints "PORT:<n>" on stdout once listening (ephemeral port on 127.0.0.1).
 */

import http from 'node:http';

const SESSION_ID = 'sess-fixture-123';
const PROTOCOL_VERSION = '2025-06-18';

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }),
      );
      return;
    }
    const { id, method, params } = msg;

    // Notifications: acknowledged with no body.
    if (id === undefined || id === null) {
      res.writeHead(202);
      res.end();
      return;
    }

    const respond = (payload, extraHeaders = {}) => {
      res.writeHead(200, { 'content-type': 'application/json', ...extraHeaders });
      res.end(JSON.stringify(payload));
    };

    if (method === 'initialize') {
      respond(
        {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'http-fixture', version: '2.0.0' },
          },
        },
        { 'Mcp-Session-Id': SESSION_ID },
      );
      return;
    }

    if (method === 'tools/list') {
      respond({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'ping',
              description: 'Report the request headers the fixture received',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      });
      return;
    }

    if (method === 'tools/call' && params?.name === 'ping') {
      respond({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sessionId: req.headers['mcp-session-id'] ?? null,
                protocolVersion: req.headers['mcp-protocol-version'] ?? null,
                args: params?.arguments ?? {},
              }),
            },
          ],
        },
      });
      return;
    }

    respond({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  });
});

server.listen(0, '127.0.0.1', () => {
  console.log(`PORT:${server.address().port}`);
});
