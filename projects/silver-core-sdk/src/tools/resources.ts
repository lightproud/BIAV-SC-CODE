/**
 * Built-in MCP resource tools: ListMcpResourcesTool / ReadMcpResourceTool.
 *
 * They route to the MCP registry via ctx.mcpResources (wired by the engine).
 * When no registry is present (no MCP servers configured) the tools return a
 * not-configured error result. Clean-room implementation from public docs.
 */

import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError, isAbortError } from '../errors.js';

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

export const listMcpResourcesTool: BuiltinTool = {
  name: 'ListMcpResourcesTool',
  description:
    'List the resources exposed by connected MCP servers. Optionally restrict ' +
    'to a single server by name. Returns each resource with its uri, name, ' +
    'description, mimeType and owning server.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'Restrict the listing to this MCP server name (optional).',
      },
    },
  },
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();
    if (!ctx.mcpResources) {
      return errorResult('ListMcpResourcesTool: no MCP servers are configured.');
    }
    const rawServer = input['server'];
    const server = typeof rawServer === 'string' && rawServer.length > 0 ? rawServer : undefined;
    try {
      const resources = await ctx.mcpResources.list(server, ctx.signal);
      return { content: JSON.stringify(resources) };
    } catch (e) {
      if (isAbortError(e)) throw new AbortError('ListMcpResourcesTool was aborted');
      return errorResult(`ListMcpResourcesTool failed: ${(e as Error).message}`);
    }
  },
};

export const readMcpResourceTool: BuiltinTool = {
  name: 'ReadMcpResourceTool',
  description:
    'Read the contents of one MCP resource from a named server. Returns the ' +
    'resource contents (text and/or base64 blob) as JSON.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      server: { type: 'string', description: 'The MCP server that owns the resource.' },
      uri: { type: 'string', description: 'The resource uri to read.' },
    },
    required: ['server', 'uri'],
  },
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();
    if (!ctx.mcpResources) {
      return errorResult('ReadMcpResourceTool: no MCP servers are configured.');
    }
    const server = input['server'];
    const uri = input['uri'];
    if (typeof server !== 'string' || server.length === 0) {
      return errorResult('ReadMcpResourceTool: "server" must be a non-empty string.');
    }
    if (typeof uri !== 'string' || uri.length === 0) {
      return errorResult('ReadMcpResourceTool: "uri" must be a non-empty string.');
    }
    try {
      const contents = await ctx.mcpResources.read(server, uri, ctx.signal);
      return { content: JSON.stringify(contents) };
    } catch (e) {
      if (isAbortError(e)) throw new AbortError('ReadMcpResourceTool was aborted');
      return errorResult(`ReadMcpResourceTool failed: ${(e as Error).message}`);
    }
  },
};
