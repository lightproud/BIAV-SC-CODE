/**
 * BPT Agent SDK - in-process SDK MCP server (module F).
 *
 * tool() and createSdkMcpServer() mirror the public claude-agent-sdk surface;
 * SdkMcpConnection dispatches calls directly to the registered handlers with
 * no wire protocol involved. Clean-room implementation from public docs only.
 */

import { z } from 'zod';
import type {
  CallToolResult,
  JSONSchema,
  McpSdkServerConfigWithInstance,
  SdkMcpServerInstance,
  SdkMcpToolDefinition,
} from '../types.js';
import { AbortError, isAbortError } from '../errors.js';

/**
 * Define one SDK MCP tool. The zod raw shape is converted to JSON Schema at
 * creation time (zod v4 native conversion, $schema marker stripped) and the
 * handler is wrapped with zod validation: invalid arguments produce an
 * isError text result instead of reaching the handler.
 */
export function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  inputSchema: S,
  handler: (args: z.infer<z.ZodObject<S>>, extra: unknown) => Promise<CallToolResult>,
): SdkMcpToolDefinition<z.infer<z.ZodObject<S>>> {
  const schema = z.object(inputSchema);
  const raw = z.toJSONSchema(schema) as unknown as Record<string, unknown>;
  const { $schema: _discard, ...inputJsonSchema } = raw;
  void _discard;

  const wrappedHandler = async (args: unknown, extra: unknown): Promise<CallToolResult> => {
    const parsed = schema.safeParse(args ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.map((p) => String(p)).join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      return {
        content: [{ type: 'text', text: `Invalid arguments for tool '${name}': ${issues}` }],
        isError: true,
      };
    }
    return await handler(parsed.data as z.infer<z.ZodObject<S>>, extra);
  };

  return {
    name,
    description,
    inputJsonSchema: inputJsonSchema as JSONSchema,
    handler: wrappedHandler,
  };
}

/**
 * Build an in-process SDK MCP server config, suitable for Options.mcpServers.
 * Duplicate tool names follow Map semantics: the last definition wins.
 */
export function createSdkMcpServer(options: {
  name: string;
  version?: string;
  // any: each definition carries its own (narrower) argument type; the map
  // stores them uniformly and dispatch goes through the zod-validated wrapper.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: Array<SdkMcpToolDefinition<any>>;
}): McpSdkServerConfigWithInstance {
  const tools = new Map<string, SdkMcpToolDefinition>();
  for (const def of options.tools ?? []) {
    tools.set(def.name, def as SdkMcpToolDefinition);
  }
  const instance: SdkMcpServerInstance = {
    name: options.name,
    version: options.version ?? '1.0.0',
    tools,
  };
  return { type: 'sdk', name: options.name, instance };
}

/**
 * In-process MCP connection over an SdkMcpServerInstance. Shape-compatible
 * with the stdio/http connections so the registry can treat all three alike.
 */
export class SdkMcpConnection {
  private readonly instance: SdkMcpServerInstance;
  private readonly debug: (msg: string) => void;

  constructor(instance: SdkMcpServerInstance, opts: { debug?: (msg: string) => void } = {}) {
    this.instance = instance;
    this.debug = opts.debug ?? (() => {});
  }

  /** In-process: nothing to establish. */
  async connect(_signal?: AbortSignal): Promise<void> {
    // No wire handshake for in-process servers.
  }

  serverInfo(): { name: string; version: string } {
    return { name: this.instance.name, version: this.instance.version };
  }

  async listTools(
    _signal?: AbortSignal,
  ): Promise<Array<{ name: string; description?: string; inputSchema: JSONSchema }>> {
    return [...this.instance.tools.values()].map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputJsonSchema,
    }));
  }

  /** Dispatch directly to the handler; exceptions become isError results. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    if (signal?.aborted) throw new AbortError();
    const def = this.instance.tools.get(name);
    if (!def) {
      return {
        content: [
          { type: 'text', text: `Unknown tool '${name}' on SDK MCP server '${this.instance.name}'` },
        ],
        isError: true,
      };
    }
    try {
      return await def.handler(args, { signal });
    } catch (err) {
      // Never swallow aborts; everything else becomes an isError text result.
      if (isAbortError(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.debug(`[mcp:${this.instance.name}] tool '${name}' threw: ${message}`);
      return {
        content: [{ type: 'text', text: `Tool '${name}' failed: ${message}` }],
        isError: true,
      };
    }
  }

  /** In-process: nothing to release. */
  async close(): Promise<void> {
    // Intentionally empty.
  }
}
