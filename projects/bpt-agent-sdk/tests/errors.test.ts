/**
 * E6a + E6c unit tests: stable machine-readable error codes on every error
 * class, and the MCP subsystem's typed McpError (code + scene context) at
 * its real failure sites. The code table is documented in docs/ERRORS.md.
 */

import { describe, expect, it } from 'vitest';

import {
  AbortError,
  APIConnectionError,
  APIStatusError,
  ConfigurationError,
  McpError,
  NotImplementedError,
  errorCodeOf,
} from '../src/errors.js';
import { StdioMcpConnection } from '../src/mcp/stdio.js';
import { HttpMcpConnection } from '../src/mcp/http.js';
import { DefaultMcpRegistry } from '../src/mcp/registry.js';

// ---------------------------------------------------------------------------
// E6c: every error class carries a stable `code`
// ---------------------------------------------------------------------------

describe('E6c: stable error codes', () => {
  it('every core error class carries its class-default code', () => {
    expect(new AbortError().code).toBe('aborted');
    expect(new APIConnectionError('x').code).toBe('api_connection_failed');
    expect(new APIStatusError(500, 'api_error', 'x').code).toBe('api_status_error');
    expect(new NotImplementedError('feature').code).toBe('not_implemented');
    expect(new ConfigurationError('x').code).toBe('config_invalid');
  });

  it('APIConnectionError accepts a scenario code without changing name/message', () => {
    const err = new APIConnectionError('Malformed SSE payload', undefined, 'sse_malformed_frame');
    expect(err.code).toBe('sse_malformed_frame');
    expect(err.name).toBe('APIConnectionError');
    expect(err.message).toBe('Malformed SSE payload');
    // Drop-in surface: only gains fields, never changes existing ones.
    expect(new APIConnectionError('y', { cause: 1 }).cause).toEqual({ cause: 1 });
  });

  it('errorCodeOf reads SDK errors and refuses foreign errors', () => {
    expect(errorCodeOf(new AbortError())).toBe('aborted');
    expect(errorCodeOf(new McpError('mcp_rpc_error', 'x'))).toBe('mcp_rpc_error');
    // Node system errors also carry a string `code` (ENOENT etc.) - those are
    // NOT ours and must not leak into the stable enum.
    const foreign = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    expect(errorCodeOf(foreign)).toBeUndefined();
    expect(errorCodeOf('not an error')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// E6a: MCP failures are typed McpError with scene context
// ---------------------------------------------------------------------------

describe('E6a: McpError at real MCP failure sites', () => {
  it('carries code, serverLabel, transport and phase', () => {
    const err = new McpError('mcp_http_status', "MCP server 'srv' returned HTTP 503", {
      serverLabel: 'srv',
      transport: 'http',
      phase: 'request',
      httpStatus: 503,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('McpError');
    expect(err.code).toBe('mcp_http_status');
    expect(err.context.serverLabel).toBe('srv');
    expect(err.context.transport).toBe('http');
    expect(err.context.phase).toBe('request');
    expect(err.context.httpStatus).toBe(503);
  });

  it('stdio: request on a never-opened connection rejects mcp_not_connected', async () => {
    const conn = new StdioMcpConnection({ type: 'stdio', command: 'true' }, { name: 'echo' });
    await expect(conn.callTool('t', {})).rejects.toMatchObject({
      name: 'McpError',
      code: 'mcp_not_connected',
      context: { serverLabel: 'echo', transport: 'stdio', phase: 'request' },
    });
  });

  it('stdio: connect after close rejects mcp_connection_closed', async () => {
    const conn = new StdioMcpConnection({ type: 'stdio', command: 'true' }, { name: 'echo' });
    await conn.close();
    await expect(conn.connect()).rejects.toMatchObject({
      name: 'McpError',
      code: 'mcp_connection_closed',
      context: { transport: 'stdio', phase: 'connect' },
    });
  });

  it('http: unreachable/invalid responses keep AbortError vs McpError separated', async () => {
    const conn = new HttpMcpConnection(
      { type: 'http', url: 'http://127.0.0.1:1/mcp' },
      { name: 'dead' },
    );
    await conn.close();
    // After close, calls surface as AbortError (code 'aborted'), NOT McpError:
    // the two channels stay distinct for consumers.
    const err = await conn.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AbortError);
    expect(errorCodeOf(err)).toBe('aborted');
  });

  it('registry: readResource on an unknown server rejects mcp_unknown_server', async () => {
    const reg = new DefaultMcpRegistry({ servers: {} });
    const ac = new AbortController();
    await expect(reg.readResource('ghost', 'file:///x', ac.signal)).rejects.toMatchObject({
      name: 'McpError',
      code: 'mcp_unknown_server',
      context: { serverLabel: 'ghost' },
    });
  });

  it('registry: readResource on a non-connected server rejects mcp_not_connected', async () => {
    const reg = new DefaultMcpRegistry({
      servers: { srv: { type: 'stdio', command: 'true' } },
    });
    const ac = new AbortController();
    // Never connected: baseStatus is 'pending'.
    await expect(reg.readResource('srv', 'file:///x', ac.signal)).rejects.toMatchObject({
      name: 'McpError',
      code: 'mcp_not_connected',
      context: { serverLabel: 'srv' },
    });
  });
});
