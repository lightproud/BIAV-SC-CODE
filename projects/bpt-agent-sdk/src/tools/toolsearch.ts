/**
 * Deferred MCP tool loading ("tool search").
 *
 * DeferredMcpRegistry decorates a real McpRegistry. While ACTIVE it withholds
 * the schemas of MCP tools the model has not yet "loaded", so the per-turn
 * request omits their input_schema and saves context. A ToolSearch builtin
 * lets the model discover + load tools on demand; once loaded, the loop's
 * per-attempt tool-def rebuild surfaces their full schemas.
 *
 * has() stays true for ALL real tools even while inactive-in-schema, so a
 * lucky/hallucinated call still executes (this is context-saving, not access
 * control).
 */

import type {
  BuiltinTool,
  McpRegistry,
  McpToolEntry,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import type {
  JSONSchema,
  McpServerConfig,
  McpServerStatus,
  McpSetServersResult,
  CallToolResult,
} from '../types.js';

export const TOOL_SEARCH_NAME = 'ToolSearch';
export const DEFERRED_THRESHOLD = 50;

/** Whether deferred loading should be active for a given tool count. */
export function shouldActivate(opt: boolean | undefined, count: number): boolean {
  if (opt === true) return true;
  if (opt === false) return false;
  return count > DEFERRED_THRESHOLD;
}

export class DeferredMcpRegistry implements McpRegistry {
  private active = false;
  private readonly loaded = new Set<string>();
  private readonly debug: (msg: string) => void;

  constructor(
    private readonly inner: McpRegistry,
    opts: { debug?: (msg: string) => void } = {},
  ) {
    this.debug = opts.debug ?? (() => undefined);
  }

  // -- pass-through delegation -----------------------------------------------

  connectAll(): Promise<void> {
    return this.inner.connectAll();
  }

  statuses(): McpServerStatus[] {
    return this.inner.statuses();
  }

  call(
    qualifiedName: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    return this.inner.call(qualifiedName, args, signal);
  }

  reconnect(serverName: string): Promise<void> {
    return this.inner.reconnect(serverName);
  }

  setEnabled(serverName: string, enabled: boolean): void {
    this.inner.setEnabled(serverName, enabled);
  }

  setServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult> {
    return this.inner.setServers(servers);
  }

  closeAll(): Promise<void> {
    return this.inner.closeAll();
  }

  /** has() is intentionally NOT gated on `loaded` - all real tools stay callable. */
  has(qualifiedName: string): boolean {
    return this.inner.has(qualifiedName);
  }

  /** When active, only tools the model has loaded expose their schemas. */
  allTools(): McpToolEntry[] {
    const all = this.inner.allTools();
    if (!this.active) return all;
    return all.filter((t) => this.loaded.has(t.qualifiedName));
  }

  // -- deferred-loading surface ----------------------------------------------

  /** Every real tool, regardless of the loaded set (ToolSearch searches this). */
  catalog(): McpToolEntry[] {
    return this.inner.allTools();
  }

  markLoaded(names: string[]): void {
    for (const n of names) this.loaded.add(n);
  }

  isActive(): boolean {
    return this.active;
  }

  /** Decide activation from the option and the live real-tool count. */
  activateIfNeeded(opt: boolean | undefined): void {
    this.active = shouldActivate(opt, this.inner.allTools().length);
    if (this.active) this.debug(`[toolsearch] active (${this.inner.allTools().length} MCP tools deferred)`);
  }
}

function describeCatalog(catalog: McpToolEntry[]): string {
  if (catalog.length === 0) return 'No MCP tools are available.';
  const byServer = new Map<string, string[]>();
  for (const t of catalog) {
    let list = byServer.get(t.serverName);
    if (list === undefined) {
      list = [];
      byServer.set(t.serverName, list);
    }
    list.push(t.qualifiedName);
  }
  const lines: string[] = ['No tools matched. Available servers and tools:'];
  for (const [server, names] of byServer) {
    lines.push(`- ${server}: ${names.join(', ')}`);
  }
  return lines.join('\n');
}

function renderMatch(t: McpToolEntry): string {
  const schema: JSONSchema = t.inputSchema;
  return (
    `## ${t.qualifiedName}\n` +
    `${t.description ?? '(no description)'}\n` +
    `input_schema: ${JSON.stringify(schema)}`
  );
}

/**
 * Build the ToolSearch builtin. execute({query?,names?}) filters the deferred
 * registry's full catalog (substring match on qualifiedName/description, or an
 * exact names[] match), marks the matches loaded, and returns their schemas so
 * the model can call them on the next turn.
 */
export function makeToolSearchTool(reg: DeferredMcpRegistry): BuiltinTool {
  return {
    name: TOOL_SEARCH_NAME,
    description:
      'Search for and load additional tools whose schemas are not yet in ' +
      'context. Pass a `query` substring (matched against tool name and ' +
      'description) or an exact `names` array. Matching tools are loaded and ' +
      'their input schemas returned so you can call them on the next turn.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Substring matched against tool name and description.',
        },
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exact fully-qualified tool names to load.',
        },
      },
    },
    async execute(
      input: Record<string, unknown>,
      _ctx: ToolContext,
    ): Promise<ToolResultPayload> {
      const catalog = reg.catalog();
      const names = Array.isArray(input.names)
        ? input.names.filter((n): n is string => typeof n === 'string')
        : undefined;
      const query = typeof input.query === 'string' ? input.query.trim() : '';

      let matched: McpToolEntry[];
      if (names !== undefined && names.length > 0) {
        const set = new Set(names);
        matched = catalog.filter((t) => set.has(t.qualifiedName));
      } else if (query.length > 0) {
        const q = query.toLowerCase();
        matched = catalog.filter(
          (t) =>
            t.qualifiedName.toLowerCase().includes(q) ||
            (t.description ?? '').toLowerCase().includes(q),
        );
      } else {
        // No filter -> return guidance listing what is available.
        return { content: describeCatalog(catalog) };
      }

      if (matched.length === 0) {
        return { content: describeCatalog(catalog) };
      }

      reg.markLoaded(matched.map((t) => t.qualifiedName));
      const body = matched.map(renderMatch).join('\n\n');
      return {
        content:
          `Loaded ${matched.length} tool(s); you can now call them directly.\n\n${body}`,
      };
    },
  };
}
