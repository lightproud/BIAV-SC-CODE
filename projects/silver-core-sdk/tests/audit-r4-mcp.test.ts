/**
 * Audit r4 (2026-07-17) — MCP cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - Z6-1: HTTP initialize rejects a server-negotiated protocol version this
 *    client does not support (spec: SHOULD disconnect) instead of echoing an
 *    unknown version into every later request header.
 *  - Z6-2: stdio initialize applies the same unsupported-version check.
 *  - Z6-3: a server-initiated request delivered on a PLAIN-JSON body (batch) is
 *    answered like the SSE path, not left waiting.
 *  - Rmcp-1: a stdio server's final response written WITHOUT a trailing newline
 *    (then exit) is flushed at EOF and still resolves its waiter.
 *  - Rmcp-2: a timed-out/aborted stdio request emits notifications/cancelled so
 *    the server stops working.
 *  - R7e-1: tool(..., { annotations: null }) degrades to "no annotations"
 *    instead of throwing at tool-definition time.
 *  - R7e-2: a null tool entry in createSdkMcpServer fails fast with a typed
 *    ConfigurationError, not a cryptic TypeError.
 *  - R7s-8: a truncated MCP HTTP error detail never leaves a lone surrogate.
 *  - Y7-3: a server literally named `__proto__` is preserved as an own property
 *    without polluting the returned map's prototype.
 *
 * Fixtures are inline (node -e scripts / node:http servers) so no new fixture
 * files are added; conventions follow tests/mcp.test.ts.
 */

import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { HttpMcpConnection } from '../src/mcp/http.js';
import { StdioMcpConnection } from '../src/mcp/stdio.js';
import { createSdkMcpServer, tool } from '../src/mcp/sdk-server.js';
import { loadProjectMcpServers } from '../src/mcp/project-config.js';
import { ConfigurationError, McpError } from '../src/errors.js';
import type { CallToolResult } from '../src/types.js';

// A lone (unpaired) UTF-16 surrogate: a high surrogate not followed by a low,
// or a low not preceded by a high.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function textOf(result: CallToolResult): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

/** Start an inline node:http server; returns its /mcp URL and a stop() fn. */
async function startHttpServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ---------------------------------------------------------------------------
// Z6-1 / Z6-2: protocol-version support check
// ---------------------------------------------------------------------------

describe('Z6-1: HTTP initialize rejects an unsupported negotiated protocol version', () => {
  it('a future protocol version fails connect with a clear McpError', async () => {
    const srv = await startHttpServer((req, res, body) => {
      const { id } = JSON.parse(body) as { id: number | string | null };
      if (id === undefined || id === null) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2999-12-31',
            capabilities: {},
            serverInfo: { name: 'future', version: '9.9.9' },
          },
        }),
      );
    });
    try {
      const conn = new HttpMcpConnection({ type: 'http', url: srv.url });
      const err = await conn.connect().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(McpError);
      expect(String((err as McpError).message)).toContain('unsupported protocol version');
      expect(String((err as McpError).message)).toContain('2999-12-31');
      await conn.close();
    } finally {
      await srv.stop();
    }
  });
});

describe('Z6-2: stdio initialize rejects an unsupported negotiated protocol version', () => {
  const oldVersionScript = `
'use strict';
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id === undefined || m.id === null) continue;
    if (m.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '1999-01-01', capabilities: {}, serverInfo: { name: 'oldsrv', version: '0.0.1' } } }) + '\\n');
    }
  }
});
`;

  it('an ancient protocol version fails connect with a clear McpError', async () => {
    const conn = new StdioMcpConnection(
      { type: 'stdio', command: process.execPath, args: ['-e', oldVersionScript] },
      { name: 'old' },
    );
    const err = await conn.connect().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(McpError);
    expect(String((err as McpError).message)).toContain('unsupported protocol version');
    expect(String((err as McpError).message)).toContain('1999-01-01');
    await conn.close();
  });
});

// ---------------------------------------------------------------------------
// Z6-3: plain-JSON body carrying a server-initiated request is answered
// ---------------------------------------------------------------------------

describe('Z6-3: a server request on a plain-JSON body is answered', () => {
  it('answers the server request AND returns our response', async () => {
    const replies: Array<{ id: unknown; error?: { code?: number } }> = [];
    const srv = await startHttpServer((req, res, body) => {
      const msg = JSON.parse(body) as {
        id: number | string | null;
        method?: string;
        error?: { code?: number };
      };
      const { id, method } = msg;
      // The client's fire-and-forget reply to our server-initiated request.
      if (method === undefined && msg.error) {
        replies.push({ id, error: msg.error });
        res.writeHead(202);
        res.end();
        return;
      }
      if (id === undefined || id === null) {
        res.writeHead(202);
        res.end();
        return;
      }
      if (method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              serverInfo: { name: 'pj', version: '1.0.0' },
            },
          }),
        );
        return;
      }
      if (method === 'tools/call') {
        // Plain application/json body carrying a JSON-RPC BATCH: a server-
        // initiated request AND our response. The client must answer the former.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify([
            { jsonrpc: '2.0', id: 'srv-req-1', method: 'ping' },
            { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'pong-json' }] } },
          ]),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'nope' } }));
    });

    try {
      const conn = new HttpMcpConnection({ type: 'http', url: srv.url });
      await conn.connect();
      const result = await conn.callTool('anything', {});
      expect(textOf(result)).toBe('pong-json');

      for (let i = 0; i < 40 && replies.length === 0; i++) await sleep(25);
      await conn.close();

      expect(replies.length).toBeGreaterThan(0);
      expect(replies[0]?.id).toBe('srv-req-1');
      expect(replies[0]?.error?.code).toBe(-32601);
    } finally {
      await srv.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Rmcp-1: stdio EOF flush of a newline-less final response
// ---------------------------------------------------------------------------

describe('Rmcp-1: a final response written without a trailing newline still resolves', () => {
  const noNewlineScript = `
'use strict';
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id === undefined || m.id === null) continue;
    if (m.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'nolf', version: '1.0.0' } } }) + '\\n');
    } else if (m.method === 'tools/call') {
      // Final response WITHOUT a trailing newline, then exit once flushed.
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'lastline' }] } }), () => process.exit(0));
    }
  }
});
`;

  it('flushStdout at close delivers the buffered response instead of mcp_server_exited', async () => {
    const conn = new StdioMcpConnection(
      { type: 'stdio', command: process.execPath, args: ['-e', noNewlineScript] },
      { name: 'nolf' },
    );
    await conn.connect();
    const result = await conn.callTool('x', {});
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe('lastline');
    await conn.close();
  });
});

// ---------------------------------------------------------------------------
// Rmcp-2: timeout emits notifications/cancelled
// ---------------------------------------------------------------------------

describe('Rmcp-2: a timed-out stdio request tells the server to cancel', () => {
  const hangCancelScript = `
'use strict';
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.method === 'notifications/cancelled') {
      process.stderr.write('GOTCANCEL:' + String(m.params && m.params.requestId) + '\\n');
      continue;
    }
    if (m.id === undefined || m.id === null) continue;
    if (m.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'hang', version: '1.0.0' } } }) + '\\n');
    }
    // tools/call is intentionally never answered (hang) to force a timeout.
  }
});
`;

  it('sends notifications/cancelled with the timed-out requestId', async () => {
    const debugLines: string[] = [];
    const conn = new StdioMcpConnection(
      { type: 'stdio', command: process.execPath, args: ['-e', hangCancelScript] },
      { name: 'hang', requestTimeoutMs: 250, debug: (msg) => debugLines.push(msg) },
    );
    try {
      await conn.connect(); // request id 1
      const err = await conn.callTool('x', {}).then(
        () => undefined,
        (e: unknown) => e,
      ); // request id 2 -> hangs -> times out
      expect(err).toBeInstanceOf(McpError);
      expect((err as McpError).code).toBe('mcp_request_timeout');

      // The server echoes the cancellation over stderr, which surfaces via debug.
      let seen = false;
      for (let i = 0; i < 80 && !seen; i++) {
        if (debugLines.some((l) => l.includes('GOTCANCEL:2'))) seen = true;
        else await sleep(25);
      }
      expect(seen).toBe(true);
    } finally {
      await conn.close();
    }
  });
});

// ---------------------------------------------------------------------------
// R7e-1 / R7e-2: sdk-server null guards at definition/construction time
// ---------------------------------------------------------------------------

describe('R7e-1: tool() tolerates a wrapped inner-null annotations', () => {
  it('{ annotations: null } does not throw and yields no annotations', () => {
    let def: ReturnType<typeof tool> | undefined;
    expect(() => {
      def = tool(
        'nully',
        'null annotations',
        { q: z.string() },
        async () => ({ content: [] }),
        { annotations: null } as unknown as { annotations?: undefined },
      );
    }).not.toThrow();
    expect(def?.annotations).toBeUndefined();

    // Valid forms are unaffected.
    const wrapped = tool('w', 'd', {}, async () => ({ content: [] }), {
      annotations: { readOnlyHint: true },
    });
    expect(wrapped.annotations).toEqual({ readOnlyHint: true });
    const bare = tool('b', 'd', {}, async () => ({ content: [] }), { destructiveHint: true });
    expect(bare.annotations).toEqual({ destructiveHint: true });
  });
});

describe('R7e-2: createSdkMcpServer rejects a null tool entry', () => {
  it('a null entry throws a typed ConfigurationError, not a cryptic TypeError', () => {
    const valid = tool('ok', 'fine', {}, async () => ({ content: [] }));
    expect(() =>
      createSdkMcpServer({
        name: 'srv',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [valid, null as any],
      }),
    ).toThrow(ConfigurationError);
  });
});

// ---------------------------------------------------------------------------
// R7s-8: surrogate-safe truncation of the MCP HTTP error detail
// ---------------------------------------------------------------------------

describe('R7s-8: a truncated MCP HTTP error detail never leaves a lone surrogate', () => {
  it('drops a split emoji at the 300-char cap instead of half-keeping it', async () => {
    // The astral codepoint straddles UTF-16 index 300 (299 x's, then the pair).
    const detail = 'x'.repeat(299) + '\u{1F600}' + 'tail-content-beyond-the-cap';
    const srv = await startHttpServer((req, res, body) => {
      const { id, method } = JSON.parse(body) as { id: number | string | null; method?: string };
      if (id === undefined || id === null) {
        res.writeHead(202);
        res.end();
        return;
      }
      if (method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              serverInfo: { name: 'err', version: '1.0.0' },
            },
          }),
        );
        return;
      }
      // Non-2xx with a long body whose truncation point splits the emoji.
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(detail);
    });
    try {
      const conn = new HttpMcpConnection({ type: 'http', url: srv.url });
      await conn.connect();
      const err = await conn.callTool('x', {}).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(McpError);
      const message = String((err as McpError).message);
      expect(message).toContain('HTTP 500');
      expect(message).toContain('...'); // truncated
      expect(message).not.toContain('\u{1F600}'); // split emoji dropped, not half-kept
      expect(LONE_SURROGATE.test(message)).toBe(false);
      await conn.close();
    } finally {
      await srv.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Y7-3: __proto__-named server is preserved without prototype pollution
// ---------------------------------------------------------------------------

describe('Y7-3: a server named __proto__ is an own property, no pollution', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it('the entry survives as an own property and the map prototype is untouched', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scsdk-mcp-'));
    // Raw JSON string: JSON.parse creates a safe OWN `__proto__` property (it
    // never invokes the prototype setter), reproducing the pre-fix bracket-
    // assignment hazard downstream.
    const raw =
      '{ "mcpServers": { "__proto__": { "command": "echo", "args": ["pwned"] }, ' +
      '"safe": { "command": "ls" } } }';
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), raw);

    const out = loadProjectMcpServers(tmpDir, ['project'], () => {});

    // Prototype chain untouched (the setter was never invoked).
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    // The __proto__-named server survives as a real own data property.
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    const protoEntry = Object.getOwnPropertyDescriptor(out, '__proto__')?.value;
    expect(protoEntry).toMatchObject({ command: 'echo', args: ['pwned'] });
    // The ordinary sibling is unaffected.
    expect(out.safe).toMatchObject({ command: 'ls' });
  });
});
