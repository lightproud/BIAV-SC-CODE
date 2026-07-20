/**
 * Regression (audit 2026-07-14 L-5): a stdio MCP server that fails to spawn
 * (ENOENT etc.) fires the child 'error' event but NOT 'exit'. Before the fix
 * the 'error' handler failed the pending requests but left `closed`/`child`
 * untouched, so the connection stayed nominally "open" — a later request()
 * wrote to a dead stdin and hung for the full request timeout instead of
 * failing fast. The handler now flips closed state (mirroring 'exit'), so a
 * subsequent request rejects IMMEDIATELY with mcp_not_connected.
 */

import { describe, expect, it } from 'vitest';

import { StdioMcpConnection } from '../src/mcp/stdio.js';
import { McpError } from '../src/errors.js';

describe('StdioMcpConnection spawn error fails fast (L-5)', () => {
  it('a request after a spawn failure rejects promptly with mcp_not_connected, not after the request timeout', async () => {
    const conn = new StdioMcpConnection(
      { command: 'biav-nonexistent-mcp-command-xyz', args: [] },
      { name: 'ghost', requestTimeoutMs: 2_000 },
    );

    // connect() fails: the process cannot spawn, so the 'error' event fires and
    // rejects the in-flight initialize request.
    const connectErr = await conn.connect().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(connectErr).toBeInstanceOf(McpError);

    // The load-bearing assertion: a later request must reject RIGHT AWAY with
    // mcp_not_connected. Without the fix it wrote to a dead stdin and rejected
    // only after the 2000ms request timeout (mcp_request_timeout).
    const start = Date.now();
    const err = await conn.listTools().then(
      () => undefined,
      (e: unknown) => e,
    );
    const elapsed = Date.now() - start;
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe('mcp_not_connected');
    // Prompt: nowhere near the 2000ms request timeout.
    expect(elapsed).toBeLessThan(500);

    await conn.close();
  });
});
